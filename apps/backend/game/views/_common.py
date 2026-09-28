"""Shared plumbing for the game.views package.

Rate limiting por IP, guardas de entrada (método/tamaño/JSON/string),
autorización por token, revisiones de sala, persistencia de comandos y
broadcast por channel layer.
"""

import hmac
import json
import logging
import os
import time
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import transaction
from django.db.models import F, Max
from django.http import JsonResponse
from django.utils import timezone

from ..engine_client import EngineRunnerClient
from ..models import GameEvent, GameSession, Player

logger = logging.getLogger(__name__)
# Logger dedicado a eventos de seguridad (auditoría): rate limits,
# auth fallida, kicks, cierres WS. Facilita alertas sin ruido de app.
security_logger = logging.getLogger("game.security")

# Rate limiting por IP (in-memory; suficiente para una instancia — en
# despliegue multi-worker usar cache Redis compartida).
_RATE_LIMITS: dict[str, list[float]] = {}
_RATE_WINDOW = 60.0  # segundos
_RATE_MAX = 30  # peticiones mutadoras por IP y ventana
# Umbral de barrido perezoso: cuando el bucket supera este tamaño se
# purgan las ventanas ya caducadas (evita crecimiento sin límite).
_RATE_MAX_KEYS = 10_000


# Límites por scope: operaciones destructivas/pesadas tienen techo bajo;
# las de alta frecuencia (ready, estado) un techo holgado.
_SCOPE_LIMITS = {
    "create": 10,
    "join": 10,
    "start": 10,
    "kick": 5,
    "transfer": 5,
    "close": 5,
    "skip": 5,
    "leaderboard": 10,
    "ticket": 20,
    "ready": 60,  # toggle frecuente y barato durante el lobby
    "leave": 20,
    "stats": 5,
    "read": 120,  # GET de estado/listado — holgado pero acotado (anti-enumeración)
    "default": _RATE_MAX,
}

# Registro de vetados por sala: acotado (más de 32 expulsiones en una
# sala que solo admite 4 jugadores ya indica abuso; se conservan los más
# recientes).
MAX_KICKED_IDS = 32


def _trusted_proxies() -> set[str]:
    """Conjunto de IPs de proxies confiables para el X-Forwarded-For.

    Configurable con TRUSTED_PROXY_IPS (CSV). Por defecto vacío: XFF se
    ignora siempre — cualquier cliente podría falsificar su IP de
    rate-limit simplemente enviando la cabecera.
    """
    raw = os.environ.get("TRUSTED_PROXY_IPS", "")
    return {ip.strip() for ip in raw.split(",") if ip.strip()}


def _client_ip(request) -> str:
    """IP efectiva para rate limiting.

    Solo se honora X-Forwarded-For cuando REMOTE_ADDR es un proxy de
    confianza (TRUSTED_PROXY_IPS); en caso contrario se usa REMOTE_ADDR.
    """
    remote = request.META.get("REMOTE_ADDR", "")
    if remote and remote in _trusted_proxies():
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return remote or "?"


def _sweep_rate_limits(now: float) -> None:
    """Purga las ventanas caducadas cuando el bucket crece demasiado.

    Sin barrido, un atacante rotando IPs (o salas) inflaría el dict sin
    límite. Coste: O(n) solo cuando len > _RATE_MAX_KEYS.
    """
    for key in [k for k, ts in _RATE_LIMITS.items() if not ts or now - ts[-1] >= _RATE_WINDOW]:
        _RATE_LIMITS.pop(key, None)


def _rate_limited(request, scope: str = "default") -> bool:
    """Devuelve True si la IP supera el límite del scope dado.

    Las claves son (scope, ip): un flood de kick no consume el cupo de
    ready, y viceversa. Configurable globalmente con ROOM_RATE_LIMIT_MAX.
    """
    override = getattr(settings, "ROOM_RATE_LIMIT_MAX", None)
    limit = override if override is not None else _SCOPE_LIMITS.get(scope, _RATE_MAX)
    if limit <= 0:
        return False
    ip = _client_ip(request)
    key = f"{scope}:{ip}"
    now = time.monotonic()
    if len(_RATE_LIMITS) > _RATE_MAX_KEYS:
        _sweep_rate_limits(now)
    hits = [t for t in _RATE_LIMITS.get(key, []) if now - t < _RATE_WINDOW]
    if len(hits) >= limit:
        _RATE_LIMITS[key] = hits
        security_logger.warning("rate limit hit scope=%s ip=%s", scope, ip)
        return True
    hits.append(now)
    _RATE_LIMITS[key] = hits
    return False


# --- Límites de tamaño de entrada -------------------------------------------
# Rechazo temprano de bodies gigantes y campos desbordados antes de
# parsear/persistir (anti-DoS de memoria y de columnas).
MAX_BODY_BYTES = 256 * 1024  # REST: capa de 256KB por petición
_MAX_ID_LEN = 64  # hostId/playerId/name/heroId/targetId
_MAX_SEED_LEN = 200  # coincide con GameSession.seed (max_length=200)


def _check_body_size(request):
    """413 si Content-Length supera el cap; 400 si la cabecera es inválida."""
    raw = request.headers.get("content-length")
    if raw is None:
        return None
    try:
        length = int(raw)
    except (TypeError, ValueError):
        return JsonResponse({"error": "Invalid Content-Length"}, status=400)
    if length > MAX_BODY_BYTES:
        security_logger.warning("oversized body rejected (%s bytes) path=%s", length, request.path)
        return JsonResponse({"error": "Payload too large"}, status=413)
    return None


def _check_str(value, field: str, max_len: int = _MAX_ID_LEN, allow_empty: bool = True):
    """400 si ``value`` no es un str dentro del límite (None si es válido)."""
    if not isinstance(value, str) or len(value) > max_len or (not allow_empty and not value):
        return JsonResponse({"error": f"Invalid {field}"}, status=400)
    return None


def _check_ids(data: dict, *fields: str, allow_empty: bool = False):
    """Valida cada ``field`` de ``data`` con _check_str; devuelve error o None."""
    for field in fields:
        invalid = _check_str(data.get(field, ""), field, allow_empty=allow_empty)
        if invalid is not None:
            return invalid
    return None


def _require_host(request, data, session, verb: str) -> tuple[str, JsonResponse | None]:
    """Autoriza al host: playerId no vacío + es el host + token válido.

    Devuelve (player_id, None) o ("", JsonResponse de error).
    """
    player_id = data.get("playerId", "")
    invalid = _check_str(player_id, "playerId", allow_empty=False)
    if invalid is not None:
        return "", invalid
    if player_id != session.host_id:
        return "", JsonResponse({"error": f"Only the host can {verb}"}, status=403)
    _, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return "", error
    return player_id, None


def _require_host_locked(session, player_id: str, verb: str):
    """Re-check de host y WAITING bajo select_for_update (anti-TOCTOU)."""
    if session.host_id != player_id:
        return JsonResponse({"error": f"Only the host can {verb}"}, status=403)
    if session.status != "WAITING":
        return JsonResponse({"error": "Room is not open"}, status=403)
    return None


def _for_update(session):
    """Relee la sesión bajo lock (llamar dentro de transaction.atomic())."""
    return GameSession.objects.select_for_update().get(pk=session.pk)


def _verify_player_or_host(session, player_id: str, token):
    """Verifica (player_id, token); si falla, admite el token del host.

    Usado por leave_room: el host puede "sacar" a un jugador sin su token.
    """
    _, error = _verify_player(session, player_id, token)
    if error is None:
        return None
    host = Player.objects.filter(session=session, player_id=session.host_id).first()
    if not host or not token or not hmac.compare_digest(host.auth_token, token):
        return error
    return None


def _guard_post(request, scope: str) -> tuple[dict, JsonResponse | None]:
    """Guardas comunes de las vistas POST: método, rate limit, tamaño y JSON.

    Devuelve (data, None) o (dict vacío, respuesta de error). ``data``
    nunca es None: el dict vacío defensivo evita un 500 si una vista
    futura olvida comprobar la respuesta de error.
    """
    if request.method != "POST":
        return {}, JsonResponse({"error": "Method not allowed"}, status=405)
    if _rate_limited(request, scope):
        return {}, JsonResponse({"error": "Too many requests"}, status=429)
    too_big = _check_body_size(request)
    if too_big is not None:
        return {}, too_big
    return _parse_json_body(request)


def _parse_json_body(request):
    """Parsea el body JSON de un POST.

    Devuelve la pareja (data, None) o bien (dict vacío, respuesta de
    error). Un body que no es un objeto JSON — lista o escalar — devolvía
    un 500 al llamar a ``get`` sobre él; ahora es un 400 consistente en
    todas las vistas.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return {}, JsonResponse({"error": "Invalid JSON body"}, status=400)
    if not isinstance(data, dict):
        return {}, JsonResponse({"error": "Invalid JSON body"}, status=400)
    return data, None


def _get_player_token(request, data=None):
    """Extract the player auth token from header or body.

    SECURITY: no se acepta por query param — los GET quedan registrados en
    logs de acceso, proxies, historial del navegador y cabeceras Referer.
    """
    header = request.headers.get("X-Player-Token", "")
    if header:
        return header
    if isinstance(data, dict):
        return data.get("playerToken", "") or ""
    return ""


def _verify_player(session, player_id, token):
    """Verify that (player_id, token) matches a member of the session.

    D431. Returns (player, None) on success, or (None, JsonResponse) on
    failure.
    """
    if not player_id:
        return None, JsonResponse({"error": "playerId is required"}, status=400)
    player = Player.objects.filter(session=session, player_id=player_id).first()
    if player is None:
        security_logger.warning("auth failed: player %s not a member of room %s", player_id, session.room_id)
        return None, JsonResponse({"error": "Player is not a member of this room"}, status=403)
    if not token or not hmac.compare_digest(player.auth_token, token):
        security_logger.warning("auth failed: bad player token for %s in room %s", player_id, session.room_id)
        return None, JsonResponse({"error": "Invalid player token"}, status=403)
    return player, None


def _bump_revision(session):
    """Incrementa la revisión de la sala.

    Seguro bajo select_for_update; fuera de lock usa F() para no perder
    increments concurrentes.
    """
    GameSession.objects.filter(pk=session.pk).update(revision=F("revision") + 1)
    session.refresh_from_db(fields=["revision"])
    return session.revision


def _persist_command_event(session, player_id, command_type, event_type="COMMAND", **extra):
    """Graba un GameEvent para acciones REST que mutan el motor.

    Los comandos WS los persiste el consumer; los inyectados por REST
    (skip_turn, GAME_ENDED) necesitaban el mismo tratamiento para no
    dejar huecos en el log de auditoría/replay. Mejor esfuerzo: no tumba
    la vista. ``event_type`` permite registrar eventos terminales.
    """
    try:
        with transaction.atomic():
            seq = (GameEvent.objects.filter(session=session).aggregate(m=Max("seq"))["m"] or 0) + 1
            GameEvent.objects.create(
                session=session,
                seq=seq,
                event_type=event_type,
                player_id=player_id,
                data={"command": command_type, "accepted": True, **extra},
            )
    except Exception:  # noqa: PIE786  # pylint: disable=broad-exception-caught
        logger.warning("could not persist command event for %s", session.room_id, exc_info=True)


def _broadcast_room(room_id, message):
    """Envía un mensaje al grupo WS de la sala (mejor esfuerzo).

    El lobby también se refresca por polling cada 5s — el broadcast solo
    acelera la propagación de cambios de estado (ready, joins).
    """
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(f"game_{room_id}", {"type": "room.message", "message": message})
    except (RuntimeError, OSError):
        logger.warning("broadcast failed for room %s", room_id)


# --- Reaper de salas huérfanas ------------------------------------------------
# Salas WAITING sin nadie conectado y partidas FINISHED acumulaban filas
# (y salas en el runner) para siempre. El barrido se ejecuta de forma
# perezosa en list_rooms y también por `python manage.py reap_rooms`.
ROOM_WAITING_GC_MINUTES = int(os.environ.get("ROOM_WAITING_GC_MINUTES", "30"))
ROOM_FINISHED_GC_HOURS = int(os.environ.get("ROOM_FINISHED_GC_HOURS", "24"))


def reap_stale_rooms(now=None) -> list[str]:
    """Borra salas muertas en Django y, mejor esfuerzo, en el runner.

    - WAITING con cero jugadores conectados y sin mutaciones desde hace
      ROOM_WAITING_GC_MINUTES (updated_at como proxy de última actividad).
    - FINISHED desde hace más de ROOM_FINISHED_GC_HOURS.

    Devuelve los room_id eliminados.
    """
    now = now or timezone.now()
    waiting_cutoff = now - timedelta(minutes=ROOM_WAITING_GC_MINUTES)
    finished_cutoff = now - timedelta(hours=ROOM_FINISHED_GC_HOURS)
    stale = list(
        GameSession.objects.filter(status="WAITING", updated_at__lt=waiting_cutoff).exclude(players__is_connected=True)
    )
    stale += GameSession.objects.filter(status="FINISHED", updated_at__lt=finished_cutoff)
    reaped: list[str] = []
    for session in stale:
        room_id = session.room_id
        status = session.status  # capturar antes de delete()
        try:
            EngineRunnerClient.delete_room(room_id)
        except Exception:  # noqa: PIE786  # pylint: disable=broad-exception-caught
            # fire-and-forget: el barrido no debe tumbar por un runner caído
            logger.warning("engine-runner delete_room failed for reaped room %s", room_id)
        session.delete()
        reaped.append(room_id)
        security_logger.info("reaped stale room %s (status=%s)", room_id, status)
    return reaped
