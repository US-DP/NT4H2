"""Moderación y turnos de jugadores dentro de una sala."""

import logging
import secrets

import httpx  # noqa: ASYNC127 - httpx sigue mantenido; la sugerencia httpx2 es errónea
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt

from ..engine_client import EngineRunnerClient
from ..models import GameSession, Player
from ._common import (
    MAX_KICKED_IDS,
    _broadcast_room,
    _bump_revision,
    _check_ids,
    _for_update,
    _guard_post,
    _persist_command_event,
    _require_host,
    _require_host_locked,
)
from .engine import _revoke_ws_tickets

logger = logging.getLogger(__name__)


@csrf_exempt
def kick_player(request, room_id):
    """Expulsar a un jugador de la sala (solo host, sala en WAITING).

    A diferencia de leave (que marca desconectado), kick elimina el
    registro para que el jugador desaparezca del roster del lobby.
    """
    data, guard_error = _guard_post(request, "kick")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    # Solo el host autenticado puede expulsar
    invalid = _check_ids(data, "playerId", "targetId")
    if invalid is not None:
        return invalid
    target_id = data["targetId"]
    player_id, error = _require_host(request, data, session, "kick")
    if error is not None:
        return error

    if target_id == session.host_id:
        return JsonResponse({"error": "targetId is required and cannot be the host"}, status=400)

    # Transacción + lock de sesión: serializa con start_room/set_ready para
    # que un kick no compita con un inicio ni un ready tardío resucite al
    # expulsado (el Player borrado no puede re-aparecer: su fila no existe).
    with transaction.atomic():
        session = _for_update(session)
        locked_error = _require_host_locked(session, player_id, "kick")
        if locked_error is not None:
            return locked_error
        target = Player.objects.select_for_update().filter(session=session, player_id=target_id).first()
        if target is None:
            return JsonResponse({"error": "Player not found"}, status=404)
        # Revocación: registrar el playerId vetado ANTES de borrar la fila.
        # Lista acotada (MAX_KICKED_IDS): una sala de larga vida no puede
        # hacer crecer el JSONField sin límite.
        kicked = list(session.kicked_ids or [])
        if target_id not in kicked:
            kicked.append(target_id)
        kicked = kicked[-MAX_KICKED_IDS:]
        session.kicked_ids = kicked
        session.save(update_fields=["kicked_ids"])
        target.delete()
        revision = _bump_revision(session)

    # Revocar también los tickets WS ya emitidos — un ticket expedido
    # justo antes del kick seguiría siendo válido hasta ~60 s.
    _revoke_ws_tickets(room_id, target_id)

    # Mensaje específico: permite al expulsado mostrar un aviso y a su
    # conexión WS cerrarse (consumers.room_message cierra con 4401).
    _broadcast_room(
        room_id,
        {
            "type": "room.player_kicked",
            "playerId": target_id,
            "roomRevision": revision,
        },
    )
    return JsonResponse({"kicked": True, "room": session.to_dict()})


@csrf_exempt
def unkick_player(request, room_id):
    """Levanta el veto de un jugador expulsado (solo host, sala WAITING).

    "Permitir volver": la expulsión persiste durante la vida de la sala,
    pero el host puede revertirla si fue accidental. El jugador puede
    volver a entrar por /join/ con un token nuevo.
    """
    data, guard_error = _guard_post(request, "kick")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    invalid = _check_ids(data, "playerId", "targetId")
    if invalid is not None:
        return invalid
    target_id = data["targetId"]
    player_id, error = _require_host(request, data, session, "unkick")
    if error is not None:
        return error

    with transaction.atomic():
        session = _for_update(session)
        locked_error = _require_host_locked(session, player_id, "unkick")
        if locked_error is not None:
            return locked_error
        kicked = list(session.kicked_ids or [])
        if target_id not in kicked:
            return JsonResponse({"error": "Player is not kicked"}, status=404)
        kicked.remove(target_id)
        session.kicked_ids = kicked
        session.save(update_fields=["kicked_ids"])
        revision = _bump_revision(session)

    _broadcast_room(
        room_id,
        {
            "type": "room.player_unkicked",
            "playerId": target_id,
            "roomRevision": revision,
        },
    )
    return JsonResponse({"unkicked": True, "room": session.to_dict()})


@csrf_exempt
def transfer_host(request, room_id):
    """Transfiere el rol de anfitrión a otro jugador (solo host, WAITING).

    Útil cuando el host quiere ceder la sala sin expulsar a nadie. El
    objetivo debe ser miembro conectado de la misma sala.
    """
    data, guard_error = _guard_post(request, "transfer")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    invalid = _check_ids(data, "playerId", "targetId")
    if invalid is not None:
        return invalid
    target_id = data["targetId"]
    player_id, error = _require_host(request, data, session, "transfer")
    if error is not None:
        return error

    if target_id == session.host_id:
        return JsonResponse({"error": "targetId is required and cannot be the host"}, status=400)

    with transaction.atomic():
        session = _for_update(session)
        locked_error = _require_host_locked(session, player_id, "transfer")
        if locked_error is not None:
            return locked_error
        target = Player.objects.select_for_update().filter(session=session, player_id=target_id).first()
        if target is None:
            return JsonResponse({"error": "Player not found"}, status=404)
        if not target.is_connected:
            return JsonResponse({"error": "Target player is not connected"}, status=409)
        old_host = Player.objects.select_for_update().get(session=session, player_id=session.host_id)
        old_host.is_host = False
        old_host.save(update_fields=["is_host"])
        target.is_host = True
        target.save(update_fields=["is_host"])
        session.host_id = target_id
        session.save(update_fields=["host_id"])
        revision = _bump_revision(session)

    _broadcast_room(
        room_id,
        {
            "type": "room.host_changed",
            "playerId": target_id,
            "roomRevision": revision,
        },
    )
    return JsonResponse({"transferred": True, "room": session.to_dict()})


def _fetch_active_player(room_id: str):
    """Devuelve (activePlayerId, None) según el runner o (None, error)."""
    try:
        state_data = EngineRunnerClient.get_state(room_id)
    except httpx.HTTPError:
        logger.warning("engine state fetch failed for skip-turn %s", room_id, exc_info=True)
        return None, JsonResponse({"error": "Engine unavailable"}, status=502)
    active_id = (state_data.get("state") or {}).get("activePlayerId")
    if not active_id:
        return None, JsonResponse({"error": "No active player"}, status=409)
    return active_id, None


def _engine_end_turn(room_id: str, active_id: str, cid: str):
    """Inyecta END_TURN en el runner. Devuelve (result, None) o (None, error)."""
    try:
        result = EngineRunnerClient.execute_command(
            room_id,
            cid=cid,
            player_id=active_id,
            command={"type": "END_TURN"},
        )
    except httpx.HTTPError:
        logger.warning("engine skip-turn failed for %s", room_id, exc_info=True)
        return None, JsonResponse({"error": "Engine unavailable"}, status=502)
    return result, None


@csrf_exempt
def skip_turn(request, room_id):
    """El host fuerza el fin del turno del jugador activo (anti-AFK).

    Solo host autenticado y sala PLAYING. El END_TURN se inyecta con el
    playerId del jugador activo — el backend es la autoridad de la sala y
    el runner valida la regla de fase como siempre (si el comando no es
    legal ahora, devuelve la razón sin tocar el estado).
    """
    data, guard_error = _guard_post(request, "skip")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    _, error = _require_host(request, data, session, "skip a turn")
    if error is not None:
        return error

    if session.status != "PLAYING":
        return JsonResponse({"error": "Room is not in play"}, status=409)

    # Jugador activo según la proyección pública del runner (sin playerId).
    active_id, error = _fetch_active_player(room_id)
    if error is not None or active_id is None:
        return error or JsonResponse({"error": "No active player"}, status=409)

    cid = f"skip-{secrets.token_hex(8)}"
    result, error = _engine_end_turn(room_id, active_id, cid)
    if error is not None or result is None:
        return error or JsonResponse({"error": "Engine error"}, status=502)

    if not result.get("accepted"):
        return JsonResponse({"skipped": False, "reason": result.get("reason", "rejected")}, status=409)

    # Persistir como GameEvent como cualquier comando de partida — sin el
    # registro el END_TURN forzado quedaba fuera del log de auditoría.
    # El cid registrado permite la dedup persistente del consumer.
    _persist_command_event(session, active_id, "END_TURN", by="skip_turn", cid=cid)

    revision = _bump_revision(session)
    _broadcast_room(
        room_id,
        {
            "type": "game.command_result",
            "stateChanged": True,
            "command": "END_TURN",
            "playerId": active_id,
            "by": "skip_turn",
            "roomRevision": revision,
        },
    )
    return JsonResponse({"skipped": True, "playerId": active_id})
