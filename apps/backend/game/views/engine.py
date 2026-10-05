"""Puente con el engine-runner: estado proyectado y tickets WS efímeros."""

import logging

import httpx  # noqa: ASYNC127 - httpx sigue mantenido; la sugerencia httpx2 es errónea
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..engine_client import EngineRunnerClient
from ..models import GameEvent, GameSession, GameSnapshot
from ..store import (
    ws_ticket_consume,
    ws_ticket_create,
    ws_tickets_revoke,
)
from ._common import (
    _broadcast_room,
    _bump_player_stat,
    _bump_revision,
    _get_player_token,
    _guard_post,
    _persist_command_event,
    _rate_limited,
    _verify_player,
    security_logger,
)

logger = logging.getLogger(__name__)


def _sync_turn_clock(session: GameSession, state_data: dict) -> None:
    """Observa el activePlayerId del estado y sella cuándo empezó su turno.

    Lazy: solo se actualiza cuando el backend consulta el runner (los
    clientes re-piden estado tras cada comando, así que el reloj va al día).
    """
    active = ((state_data.get("state") or {}).get("activePlayerId")) or ""
    if active and active != session.turn_player_id:
        session.turn_player_id = active
        session.turn_started_at = timezone.now()
        session.save(update_fields=["turn_player_id", "turn_started_at"])


def room_engine_state(request, room_id):
    """Get the game engine state of a room."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    # Rate limit: cada llamada proxea al runner (GET HTTP upstream) y puede
    # escribir en BD (_sync_turn_clock) — N requests baratas amplifican.
    if _rate_limited(request, "read"):
        return JsonResponse({"error": "Too many requests"}, status=429)

    session = get_object_or_404(GameSession, room_id=room_id)
    # D425 (RF-J095): el estado se proyecta por jugador — el cliente indica
    # su playerId y recibe solo la información que le corresponde.
    # D431: la proyección requiere el token del jugador (evita IDOR —
    # sin token cualquiera podría pedir ?playerId=X y ver su mano).
    player_id = request.GET.get("playerId") or None
    if player_id:
        _, error = _verify_player(session, player_id, _get_player_token(request))
        if error is not None:
            return error
    try:
        result = EngineRunnerClient.get_state(room_id, player_id)
    except httpx.HTTPStatusError as exc:
        # Sala ausente en el runner (reinicio sin STATE_DIR): restaurar
        # desde el último GameSnapshot persistido y reintentar una vez
        # en vez de dejar la sala PLAYING zombi para siempre.
        missing = exc.response is not None and exc.response.status_code == 404
        result = None
        if missing and session.status == "PLAYING" and restore_room_from_snapshot(room_id):
            result = _try_get_state(room_id, player_id)
        if result is None:
            # D413: no exponer detalles internos del error al cliente
            logger.warning("engine-runner get_state failed for room %s", room_id)
            return JsonResponse({"error": "Engine runner unavailable"}, status=503)
    except (httpx.HTTPError, ValueError):
        # D413: no exponer detalles internos del error al cliente
        logger.warning("engine-runner get_state failed for room %s", room_id)
        return JsonResponse({"error": "Engine runner unavailable"}, status=503)

    _sync_turn_clock(session, result)
    if session.turn_started_at is not None:
        result = {**result, "turnStartedAt": session.turn_started_at.isoformat()}
    return JsonResponse(result)


def _try_get_state(room_id: str, player_id: str | None) -> dict | None:
    """get_state tolerante a fallos: devuelve el dict del runner o None."""
    try:
        return EngineRunnerClient.get_state(room_id, player_id)
    except (httpx.HTTPError, ValueError):
        return None


def restore_room_from_snapshot(room_id: str) -> bool:
    """Recrea en el runner una sala PLAYING desde su último GameSnapshot.

    Los snapshots dejan de ser almacenamiento muerto: el estado completo
    (manos, RNG, revisión) viaja al endpoint /restore del runner. Los sets
    del Taller viajan DENTRO del snapshot (full-state los incluye) para
    que el blob sea autocontenido; si el snapshot es antiguo y no los
    trae, se cae a session.config. Devuelve True si la sala quedó
    restaurada.
    """
    session = GameSession.objects.filter(room_id=room_id).first()
    if session is None or session.status != "PLAYING":
        return False
    snapshot = session.snapshots.first()  # ordering [-seq] → el más reciente
    if snapshot is None:
        return False
    body = dict(snapshot.state or {})
    if "customSets" not in body:
        # Snapshots anteriores a la inclusión de customSets en /full-state
        body["customSets"] = (session.config or {}).get("customSets") or []
    try:
        EngineRunnerClient.restore_room(room_id, body)
    except httpx.HTTPStatusError as exc:
        # B-10: 409 = la sala ya existe en el runner (una restauración
        # concurrente ganó la carrera, o el 404 inicial era una lectura
        # obsoleta). Es el resultado buscado: éxito, no fallo.
        if exc.response.status_code == 409:
            security_logger.info("room %s already alive in runner (restore 409)", room_id)
            return True
        logger.warning("restore from snapshot failed for %s", room_id, exc_info=True)
        return False
    except (httpx.HTTPError, ValueError):
        logger.warning("restore from snapshot failed for %s", room_id, exc_info=True)
        return False
    security_logger.info("room %s restored from snapshot seq=%s", room_id, snapshot.seq)
    return True


# --- Snapshots de estado del motor (Fase 2) -----------------------------------
# Checkpoints del estado completo del runner: base para replay futuro y
# recuperación ante pérdida de memoria/disco del runner. Se toman cada
# _SNAPSHOT_EVERY eventos de partida y al terminar la sala (mark_finished).
SNAPSHOT_EVERY_EVENTS = 50
MAX_SNAPSHOTS_PER_SESSION = 10


def take_snapshot(session) -> bool:
    """Guarda un GameSnapshot del estado completo del runner.

    Mejor esfuerzo: un runner caído no tumba el flujo del comando que lo
    disparó. Podado: conserva los últimos MAX_SNAPSHOTS_PER_SESSION.
    """
    try:
        full = EngineRunnerClient.get_full_state(session.room_id)
    except (httpx.HTTPError, ValueError):
        logger.warning("snapshot fetch failed for %s", session.room_id, exc_info=True)
        return False
    latest_seq = GameEvent.objects.filter(session=session).order_by("-seq").values_list("seq", flat=True).first() or 0
    GameSnapshot.objects.create(
        session=session,
        seq=latest_seq,
        state=full,  # `full` ya transporta revision/rngState/cids en el JSON
    )
    # Podar: una partida larga no puede acumular snapshots sin límite
    stale = (
        GameSnapshot.objects.filter(session=session)
        .order_by("-seq")
        .values_list("id", flat=True)[MAX_SNAPSHOTS_PER_SESSION:]
    )
    if stale:
        GameSnapshot.objects.filter(id__in=list(stale)).delete()
    return True


def _turn_durations(session) -> dict[str, list[float]]:
    """Duración aproximada de cada turno por jugador (segundos).

    Un turno empieza donde acaba el anterior: el tiempo entre END_TURN
    consecutivos es la duración del turno que cierra. El primer END_TURN
    mide desde el primer evento COMMAND de la partida.
    """
    end_turns = list(
        GameEvent.objects.filter(
            session=session,
            event_type="COMMAND",
            data__accepted=True,
        )
        .filter(Q(data__command__type="END_TURN") | Q(data__command="END_TURN"))
        .order_by("seq")
        .values_list("player_id", "created_at")
    )
    if not end_turns:
        return {}
    first_at = (
        GameEvent.objects.filter(session=session, event_type="COMMAND")
        .order_by("seq")
        .values_list("created_at", flat=True)
        .first()
    )
    durations: dict[str, list[float]] = {}
    prev_at = first_at
    for pid, at in end_turns:
        if prev_at is not None and pid:
            durations.setdefault(pid, []).append(max(0.0, (at - prev_at).total_seconds()))
        prev_at = at
    return durations


def _record_player_statistics(session, winner_id: str | None, roster=None) -> None:
    """Actualiza PlayerStatistics de los miembros con cuenta vinculada.

    Se llama al cerrar la partida: played+won/lost para todos,
    total_turns como recuento de END_TURN aceptados del jugador (los
    forzados por skip_turn también cuentan — le tocaba a él) y
    average_turn_seconds como media ponderada con el historial.

    ``roster`` = snapshot [(player_id, user_id)] tomado bajo el lock de
    mark_finished: un leave concurrente entre el cierre y el recuento
    excluía al jugador de games_played (auditoría).
    """
    durations = _turn_durations(session)
    if roster is None:
        roster = list(session.players.exclude(user_id__isnull=True).values_list("player_id", "user_id"))
    for player_id, user_id in roster:
        if user_id is None:
            continue
        won = winner_id is not None and player_id == winner_id
        turns = len(durations.get(player_id, []))
        avg = sum(durations[player_id]) / turns if turns else None
        _bump_player_stat(
            user_id,
            games_played=1,
            games_won=1 if won else 0,
            games_lost=0 if won else 1,
            total_turns=turns,
            avg_turn_seconds=avg,
        )


def mark_finished(session, winner_id: str | None) -> None:
    """Cierra la sala a FINISHED tras un GAME_ENDED del runner.

    Persiste el evento terminal, toma el snapshot final (la base del
    replay completo), actualiza las estadísticas de los jugadores con
    cuenta y difunde room.finished para que los clientes muestren el
    resultado.
    """
    # Lock de sesión: dos procesadores concurrentes del mismo GAME_ENDED
    # (consumer + reaper perezoso, o acks duplicados) no deben duplicar
    # el evento terminal ni las estadísticas de los jugadores.
    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session.pk)
        if session.status != "PLAYING":
            return
        session.status = "FINISHED"
        # El reloj de turno ya no aplica: limpiarlo para que la vista de
        # historial no muestre una partida cerrada con turno "en curso".
        session.turn_player_id = ""
        session.turn_started_at = None
        session.save(update_fields=["status", "turn_player_id", "turn_started_at", "updated_at"])
        # Roster congelado bajo el lock: un leave concurrente entre el
        # cierre y _record_player_statistics excluía al jugador de las
        # estadísticas de su cuenta.
        roster = list(session.players.values_list("player_id", "user_id"))
    _persist_command_event(session, None, "GAME_ENDED", event_type="GAME_ENDED", winnerId=winner_id)
    take_snapshot(session)
    _record_player_statistics(session, winner_id, roster=roster)
    revision = _bump_revision(session)
    _broadcast_room(
        session.room_id,
        {"type": "room.finished", "winnerId": winner_id, "roomRevision": revision},
    )


# (room_sync retirado: ningún cliente aplicaba el delta — tras una
#  reconexión siempre se re-pide la proyección completa del runner)

# --- Tickets efímeros para WebSocket (P0) -----------------------------------
# El token de jugador NUNCA viaja en la URL del socket: el cliente autentica
# por REST y obtiene un ticket de un solo uso vinculado a (sala, jugador).
# Estado en game.store (cache compartida: Redis multi-worker, LocMem en
# dev) — los dicts en memoria dejaban los tickets invisibles a otros
# workers.

_WS_TICKET_TTL = 60  # segundos


def _issue_ws_ticket(room_id: str, player_id: str) -> str:
    """Emite un ticket de un solo uso para (sala, jugador)."""
    return ws_ticket_create(room_id, player_id)


def _revoke_ws_tickets(room_id: str, player_id: str) -> None:
    """Invalida los tickets ya emitidos de un jugador expulsado.

    Sin esto, un ticket emitido justo antes del kick seguía siendo
    válido ~60 s y permitía reconectar y chatear tras la expulsión.
    """
    ws_tickets_revoke(room_id, player_id)


def consume_ws_ticket(ticket: str, room_id: str):
    """Consume el ticket (un solo uso). Devuelve player_id o None."""
    info = ws_ticket_consume(ticket)
    if info is None or info["room_id"] != room_id:
        return None
    return info["player_id"]


@csrf_exempt
def ws_ticket(request, room_id):
    """Emite un ticket efímero de WebSocket para el jugador autenticado.

    POST /api/rooms/<id>/ws-ticket/ {playerId, playerToken}
    → {ticket, expiresIn}
    """
    data, guard_error = _guard_post(request, "ticket")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    player_id = data.get("playerId", "")
    if player_id in session.kicked_ids:
        return JsonResponse({"error": "Player was kicked"}, status=403)
    _, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error

    ticket = _issue_ws_ticket(room_id, player_id)
    return JsonResponse({"ticket": ticket, "expiresIn": int(_WS_TICKET_TTL)})
