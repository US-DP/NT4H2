"""Puente con el engine-runner: estado proyectado y tickets WS efímeros."""

import logging
import secrets
import threading
import time

import httpx  # noqa: ASYNC127 - httpx sigue mantenido; la sugerencia httpx2 es errónea
from django.db.models import Max
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..engine_client import EngineRunnerClient
from ..models import GameEvent, GameSession, GameSnapshot
from ._common import (
    _broadcast_room,
    _bump_revision,
    _get_player_token,
    _guard_post,
    _persist_command_event,
    _rate_limited,
    _verify_player,
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
    except (httpx.HTTPError, ValueError):
        # D413: no exponer detalles internos del error al cliente
        logger.warning("engine-runner get_state failed for room %s", room_id)
        return JsonResponse({"error": "Engine runner unavailable"}, status=503)

    _sync_turn_clock(session, result)
    if session.turn_started_at is not None:
        result = {**result, "turnStartedAt": session.turn_started_at.isoformat()}
    return JsonResponse(result)


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
        revision=int(full.get("revision") or 0),
        state=full,
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


def mark_finished(session, winner_id: str | None) -> None:
    """Cierra la sala a FINISHED tras un GAME_ENDED del runner.

    Persiste el evento terminal, toma el snapshot final (la base del
    replay completo) y difunde room.finished para que los clientes
    muestren el resultado.
    """
    if session.status != "PLAYING":
        return
    session.status = "FINISHED"
    session.save(update_fields=["status", "updated_at"])
    _persist_command_event(session, None, "GAME_ENDED", event_type="GAME_ENDED", winnerId=winner_id)
    take_snapshot(session)
    revision = _bump_revision(session)
    _broadcast_room(
        session.room_id,
        {"type": "room.finished", "winnerId": winner_id, "roomRevision": revision},
    )


@csrf_exempt
def room_sync(request, room_id):
    """GET /api/rooms/<id>/sync/?after=<seq> — resincronización tras reconexión.

    Devuelve revisión, último seq y los eventos posteriores a ``after``
    (proyección compacta: sin payloads privados). Permite al cliente
    decidir si basta re-pedir su estado proyectado o reconstruir el log.
    """
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if _rate_limited(request, "read"):
        return JsonResponse({"error": "Too many requests"}, status=429)
    session = get_object_or_404(GameSession, room_id=room_id)
    player_id = request.GET.get("playerId") or ""
    _, error = _verify_player(session, player_id, _get_player_token(request))
    if error is not None:
        return error

    try:
        after = max(0, int(request.GET.get("after", "0")))
    except (TypeError, ValueError):
        return JsonResponse({"error": "Invalid after"}, status=400)

    qs = GameEvent.objects.filter(session=session, seq__gt=after).order_by("seq")
    events = list(qs[:200])
    latest = GameEvent.objects.filter(session=session).aggregate(m=Max("seq"))["m"] or 0
    return JsonResponse(
        {
            "roomRevision": session.revision,
            "latestSeq": latest,
            "events": [
                {
                    "seq": e.seq,
                    "type": e.event_type,
                    "playerId": e.player_id,
                    "command": (e.data or {}).get("command"),
                    "accepted": (e.data or {}).get("accepted"),
                }
                for e in events
            ],
            "truncated": qs.count() > len(events),
        }
    )


# --- Tickets efímeros para WebSocket (P0) -----------------------------------
# El token de jugador NUNCA viaja en la URL del socket: el cliente autentica
# por REST y obtiene un ticket de un solo uso vinculado a (sala, jugador).
# In-memory como _RATE_LIMITS — en multi-worker usar cache compartida.
_WS_TICKETS: dict[str, dict] = {}
_WS_TICKET_TTL = 60.0  # segundos
_WS_TICKET_LOCK = threading.Lock()


def _issue_ws_ticket(room_id: str, player_id: str) -> str:
    """Emite un ticket de un solo uso para (sala, jugador)."""
    now = time.monotonic()
    ticket = secrets.token_urlsafe(32)
    # El barrido de expirados y la inserción bajo el mismo lock —
    # consume_ws_ticket hace pop() concurrente y un dict iterado
    # fuera del lock lanza RuntimeError (dictionary changed size).
    with _WS_TICKET_LOCK:
        for k in [k for k, v in _WS_TICKETS.items() if v["exp"] < now]:
            _WS_TICKETS.pop(k, None)
        _WS_TICKETS[ticket] = {
            "room_id": room_id,
            "player_id": player_id,
            "exp": now + _WS_TICKET_TTL,
        }
    return ticket


def _revoke_ws_tickets(room_id: str, player_id: str) -> None:
    """Invalida los tickets ya emitidos de un jugador expulsado.

    Sin esto, un ticket emitido justo antes del kick seguía siendo
    válido ~60 s y permitía reconectar y chatear tras la expulsión.
    """
    with _WS_TICKET_LOCK:
        for k in [k for k, v in _WS_TICKETS.items() if v["room_id"] == room_id and v["player_id"] == player_id]:
            _WS_TICKETS.pop(k, None)


def consume_ws_ticket(ticket: str, room_id: str):
    """Consume el ticket (un solo uso). Devuelve player_id o None."""
    with _WS_TICKET_LOCK:
        entry = _WS_TICKETS.pop(ticket, None)
    if entry is None:
        return None
    if entry["exp"] < time.monotonic() or entry["room_id"] != room_id:
        return None
    return entry["player_id"]


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
