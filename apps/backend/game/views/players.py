"""Moderación y turnos de jugadores dentro de una sala."""

import logging
import os
import secrets

import httpx  # noqa: ASYNC127 - httpx sigue mantenido; la sugerencia httpx2 es errónea
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
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
from .engine import _revoke_ws_tickets, mark_finished, restore_room_from_snapshot

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
        update_fields = ["kicked_ids"]
        # Veto también por CUENTA: con JWT, re-entrar con otro playerId
        # seguía permitido. El mapa playerId→userId vive en config (clave
        # privada `_kickedUserIds`; no viaja al runner ni al to_dict público)
        # y se poda junto a la lista de ids.
        if target.user_id:
            cfg = dict(session.config or {})
            kicked_users = dict(cfg.get("_kickedUserIds") or {})
            kicked_users[target_id] = str(target.user_id)
            kicked_users = {k: v for k, v in kicked_users.items() if k in kicked}
            cfg["_kickedUserIds"] = kicked_users
            session.config = cfg
            update_fields.append("config")
        session.save(update_fields=update_fields)
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
        update_fields = ["kicked_ids"]
        # Levantar también el veto por cuenta vinculada (espejo de kick).
        cfg = dict(session.config or {})
        kicked_users = dict(cfg.get("_kickedUserIds") or {})
        if target_id in kicked_users:
            del kicked_users[target_id]
            cfg["_kickedUserIds"] = kicked_users
            session.config = cfg
            update_fields.append("config")
        session.save(update_fields=update_fields)
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
        # first() en vez de get(): un host_id huérfano (host que abandonó
        # siendo el último en PLAYING) lanzaba DoesNotExist → 500.
        old_host = Player.objects.select_for_update().filter(session=session, player_id=session.host_id).first()
        if old_host is not None:
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


def _runner_get_state_with_restore(room_id: str) -> dict | None:
    """get_state tolerante, resucitando la sala del runner si faltó.

    Mismo patrón que room_engine_state: un 404 con sala PLAYING intenta
    restaurar desde el último GameSnapshot y reintenta una vez.
    """
    try:
        return EngineRunnerClient.get_state(room_id)
    except httpx.HTTPStatusError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            if not restore_room_from_snapshot(room_id):
                return None
            try:
                return EngineRunnerClient.get_state(room_id)
            except (httpx.HTTPError, ValueError):
                return None
        return None
    except (httpx.HTTPError, ValueError):
        return None


def _fetch_active_player(room_id: str):
    """Devuelve (activePlayerId, None) según el runner o (None, error)."""
    state_data = _runner_get_state_with_restore(room_id)
    if state_data is None:
        logger.warning("engine state fetch failed for skip-turn %s", room_id)
        return None, JsonResponse({"error": "Engine unavailable"}, status=502)
    active_id = (state_data.get("state") or {}).get("activePlayerId")
    if not active_id:
        return None, JsonResponse({"error": "No active player"}, status=409)
    return active_id, None


def _engine_end_turn(room_id: str, active_id: str, cid: str):
    """Inyecta END_TURN en el runner. Devuelve (result, None) o (None, error).

    Si la sala faltó entre el get_state y el comando (reinicio del
    runner), resucita una vez desde el snapshot y reintenta.
    """
    # El CommandSchema del runner exige `cid` dentro del command y que
    # coincida con el del envelope — sin él todo skip_turn era un 400.
    try:
        result = EngineRunnerClient.execute_command(
            room_id,
            cid=cid,
            player_id=active_id,
            command={"type": "END_TURN", "cid": cid},
        )
    except httpx.HTTPStatusError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            if not restore_room_from_snapshot(room_id):
                return None, JsonResponse({"error": "Engine unavailable"}, status=502)
            try:
                result = EngineRunnerClient.execute_command(
                    room_id,
                    cid=cid,
                    player_id=active_id,
                    command={"type": "END_TURN", "cid": cid},
                )
            except (httpx.HTTPError, ValueError):
                return None, JsonResponse({"error": "Engine unavailable"}, status=502)
        else:
            logger.warning("engine skip-turn failed for %s", room_id, exc_info=True)
            return None, JsonResponse({"error": "Engine unavailable"}, status=502)
    except (httpx.HTTPError, ValueError):  # ValueError: JSON malformado del runner
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

    # Re-verificar host + PLAYING bajo lock: una desconexión concurrente
    # pudo transferir el host entre la validación y el END_TURN (mismo
    # patrón anti-TOCTOU que close_room/kick_player).
    with transaction.atomic():
        locked = GameSession.objects.select_for_update().get(pk=session.pk)
        pid_check = data.get("playerId", "")
        if locked.host_id != pid_check:
            return JsonResponse({"error": "Only the host can skip a turn"}, status=403)
        if locked.status != "PLAYING":
            return JsonResponse({"error": "Room is not in play"}, status=409)
        session = locked

    # Jugador activo según la proyección pública del runner (sin playerId).
    active_id, error = _fetch_active_player(room_id)
    if error is not None or active_id is None:
        return error or JsonResponse({"error": "No active player"}, status=409)

    # Anti-griefing: el host no puede truncar un turno que acaba de
    # empezar. El guard se exige solo si el reloj de turno está sellado
    # (turn_started_at lo mantiene _sync_turn_clock al sondear estado)
    # y el jugador sigue CONECTADO — si se fue, el skip es inmediato.
    active_row = session.players.filter(player_id=active_id).only("is_connected").first()
    if active_row is not None and active_row.is_connected and session.turn_started_at is not None:
        min_seconds = int(os.environ.get("SKIP_TURN_MIN_SECONDS", "120"))
        elapsed = (timezone.now() - session.turn_started_at).total_seconds()
        if elapsed < min_seconds:
            return JsonResponse(
                {"skipped": False, "reason": "turn_too_early", "elapsed": int(elapsed)},
                status=409,
            )

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

    # Si el END_TURN forzado cierra la partida (último jugador vivo,
    # fin de la ronda final...), el GAME_ENDED del runner debe cerrar la
    # sesión igual que en el path WS — antes se descartaba y la sala
    # quedaba PLAYING sin stats ni snapshot hasta el reaper de 48h.
    game_ended = next(
        (e for e in (result.get("events") or []) if isinstance(e, dict) and e.get("type") == "GAME_ENDED"),
        None,
    )
    if game_ended is not None:
        mark_finished(session, game_ended.get("winnerId"))
        return JsonResponse(
            {"skipped": True, "playerId": active_id, "gameEnded": True},
        )

    revision = _bump_revision(session)
    _broadcast_room(
        room_id,
        {
            "type": "game.command_result",
            "cid": cid,
            "stateChanged": True,
            # Mismo contrato que el consumer: commandType + revision (antes
            # "command"/"roomRevision" — los clientes ignoraban el campo).
            "commandType": "END_TURN",
            "playerId": active_id,
            "by": "skip_turn",
            "accepted": True,
            "revision": revision,
        },
    )
    return JsonResponse({"skipped": True, "playerId": active_id})
