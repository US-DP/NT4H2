"""Shared plumbing for the game.views package.

Rate limiting por IP, guardas de entrada (método/tamaño/JSON/string),
autorización por token, revisiones de sala, persistencia de comandos y
broadcast por channel layer.
"""

import hmac
import json
import logging
import os
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F, Max, Q
from django.http import JsonResponse
from django.utils import timezone

from ..engine_client import EngineRunnerClient
from ..models import GameEvent, GameSession, Player
from ..store import rate_hit as _rate_hit

# get_object_or_404 no se importa aquí para no arrastrar shortcuts al
# plumbing; el helper _get_session lo trae solo.


def _get_session(room_id: str) -> GameSession:
    """GameSession con prefetch de players__user__profile.

    ``to_dict()`` lee ``player.user.profile`` por jugador — sin el
    prefetch eran ~2 queries extra por jugador (N+1) en cada respuesta
    con roster (join/ready/kick/transfer/start/room_state).
    """
    from django.shortcuts import get_object_or_404

    return get_object_or_404(
        GameSession.objects.prefetch_related("players__user__profile"),
        room_id=room_id,
    )


logger = logging.getLogger(__name__)
# Logger dedicado a eventos de seguridad (auditoría): rate limits,
# auth fallida, kicks, cierres WS. Facilita alertas sin ruido de app.
security_logger = logging.getLogger("game.security")

# Rate limiting por IP via game.store (cache compartida: Redis si
# REDIS_URL está, LocMem por proceso si no — antes era dict in-memory).
_RATE_MAX = 30  # peticiones mutadoras por IP y ventana


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
    "auth": 10,  # register/login — anti brute-force y enumeración de emails
    "read": 120,  # GET de estado/listado — holgado pero acotado (anti-enumeración)
    "default": _RATE_MAX,
}

# Registro de vetados por sala: acotado (más de 32 expulsiones en una
# sala que solo admite 4 jugadores ya indica abuso; se conservan los más
# recientes).
MAX_KICKED_IDS = 32


# C-2: el set de proxies se parseaba por cada petición de rate-limit;
# la env no cambia en runtime — leerla una vez.
_TRUSTED_PROXIES_CACHE: set[str] | None = None


def _trusted_proxies() -> set[str]:
    """Conjunto de IPs de proxies confiables para el X-Forwarded-For.

    Configurable con TRUSTED_PROXY_IPS (CSV). Por defecto vacío: XFF se
    ignora siempre — cualquier cliente podría falsificar su IP de
    rate-limit simplemente enviando la cabecera.
    """
    global _TRUSTED_PROXIES_CACHE
    if _TRUSTED_PROXIES_CACHE is None:
        raw = os.environ.get("TRUSTED_PROXY_IPS", "")
        _TRUSTED_PROXIES_CACHE = {ip.strip() for ip in raw.split(",") if ip.strip()}
    return _TRUSTED_PROXIES_CACHE


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


def _rate_limited(request, scope: str = "default") -> bool:
    """Devuelve True si la IP supera el límite del scope dado.

    Las claves son (scope, ip): un flood de kick no consume el cupo de
    ready, y viceversa. Overrides por env: ROOM_RATE_LIMIT_<SCOPE>
    (p.ej. ROOM_RATE_LIMIT_AUTH) tiene prioridad; ROOM_RATE_LIMIT_MAX
    es el fallback global — antes ese único env aplanaba TODOS los
    scopes (subirlo para una demo relajaba el anti-brute-force de auth).
    """
    per_scope = os.environ.get(f"ROOM_RATE_LIMIT_{scope.upper()}", "")
    limit = -1
    if per_scope:
        try:
            limit = int(per_scope)
        except ValueError:
            security_logger.warning("ROOM_RATE_LIMIT_%s=%r no es entero — ignorado", scope.upper(), per_scope)
            limit = -1
    if limit < 0:
        override = getattr(settings, "ROOM_RATE_LIMIT_MAX", None)
        limit = override if override is not None else _SCOPE_LIMITS.get(scope, _RATE_MAX)
    if limit <= 0:
        return False
    ip = _client_ip(request)
    limited = _rate_hit(scope, ip, limit)
    if limited:
        security_logger.warning("rate limit hit scope=%s ip=%s", scope, ip)
    return limited


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


# Mismas restricciones que idSchema del runner (D440, server.ts): los ids
# que viajan al motor no pueden empezar por '__' (centinelas internos
# como SPECTATOR_ID) ni ser claves peligrosas de objetos JS. Sin esta
# réplica, Django persistía el join y el fallo estallaba en start_room
# como un 503 "Engine unavailable" enmascarado.
_UNSAFE_ENGINE_IDS = {"__proto__", "constructor", "prototype"}


def _check_engine_id(value, field: str):
    """_check_str + restricciones de idSchema del runner. None si válido."""
    invalid = _check_str(value, field, allow_empty=False)
    if invalid is not None:
        return invalid
    if value.startswith("__") or value in _UNSAFE_ENGINE_IDS:
        return JsonResponse({"error": f"Invalid {field}"}, status=400)
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
    # Transfer-Encoding: chunked llega sin Content-Length — sin esta
    # comprobación el cap se saltaba entero. WSGI ya bufferiza el body,
    # así que aquí medimos lo recibido de verdad.
    if len(request.body) > MAX_BODY_BYTES:
        security_logger.warning(
            "oversized chunked body rejected (%s bytes) path=%s",
            len(request.body),
            request.path,
        )
        return {}, JsonResponse({"error": "Payload too large"}, status=413)
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
    El ``cid`` de extra se persiste también en la columna dedicada
    (dedup atómica por (session, cid)).
    """
    cid = extra.get("cid")
    # Lock de sesión: sin él, dos escritores REST concurrentes (p. ej.
    # skip_turn + GAME_ENDED) calculaban el mismo seq → IntegrityError
    # tragada y evento de auditoría perdido en silencio. Con el lock la
    # asignación de seq queda serializada con persist_event del consumer.
    for _attempt in range(2):
        try:
            with transaction.atomic():
                GameSession.objects.select_for_update().get(pk=session.pk)
                seq = (GameEvent.objects.filter(session=session).aggregate(m=Max("seq"))["m"] or 0) + 1
                GameEvent.objects.create(
                    session=session,
                    seq=seq,
                    event_type=event_type,
                    player_id=player_id,
                    cid=cid if isinstance(cid, str) else None,
                    data={"command": command_type, "accepted": True, **extra},
                )
            break
        except IntegrityError:
            # Colisión de seq/cid con un escritor no serializado — reintenta
            continue
        except Exception:  # noqa: PIE786  # pylint: disable=broad-exception-caught
            logger.warning("could not persist command event for %s", session.room_id, exc_info=True)
            break


def _bump_player_stat(user_id, avg_turn_seconds: float | None = None, **fields: int) -> None:
    """Incrementa contadores de PlayerStatistics de un usuario vinculado.

    Mejor esfuerzo: una cuenta sin fila de estadísticas se autocrea
    (usuarios creados por createsuperuser) y un fallo no tumba la vista.
    Import perezoso para no acoplar game → accounts en tiempo de carga.
    ``avg_turn_seconds`` es la media de ESTA partida: se fusiona con la
    histórica ponderando por total_turns.
    """
    if user_id is None or not fields:
        return
    try:
        from accounts.models import PlayerStatistics

        stats, _ = PlayerStatistics.objects.get_or_create(user_id=user_id)
        PlayerStatistics.objects.filter(pk=stats.pk).update(**{k: F(k) + v for k, v in fields.items()})
        if avg_turn_seconds is not None:
            stats.refresh_from_db()
            old_turns = stats.total_turns - fields.get("total_turns", 0)
            total = stats.total_turns
            if total > 0:
                stats.average_turn_seconds = (
                    stats.average_turn_seconds * old_turns + avg_turn_seconds * fields.get("total_turns", 0)
                ) / total
                stats.save(update_fields=["average_turn_seconds"])
    except Exception:  # noqa: PIE786  # pylint: disable=broad-exception-caught
        logger.warning("player statistics update failed for user %s", user_id, exc_info=True)


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
ROOM_PLAYING_GC_HOURS = int(os.environ.get("ROOM_PLAYING_GC_HOURS", "48"))


def reap_stale_rooms(now=None) -> list[str]:
    """Borra salas muertas en Django y, mejor esfuerzo, en el runner.

    - WAITING con cero jugadores conectados y sin mutaciones desde hace
      ROOM_WAITING_GC_MINUTES (updated_at como proxy de última actividad).
    - PLAYING sin actividad desde hace ROOM_PLAYING_GC_HOURS: no se
      borra — pasa a FINISHED para conservar eventos y snapshots; la
      regla de FINISHED la limpiará más tarde (salas zombi del runner).
    - FINISHED desde hace más de ROOM_FINISHED_GC_HOURS.

    Devuelve los room_id eliminados.
    """
    now = now or timezone.now()
    waiting_cutoff = now - timedelta(minutes=ROOM_WAITING_GC_MINUTES)
    finished_cutoff = now - timedelta(hours=ROOM_FINISHED_GC_HOURS)
    playing_cutoff = now - timedelta(hours=ROOM_PLAYING_GC_HOURS)
    # La actividad de una partida es su último GameEvent (comandos/chat),
    # no updated_at: los comandos WS se persisten con QuerySet.update(),
    # que no dispara auto_now — un juego activo de >48h quedaría marcado
    # FINISHED a mitad de partida.
    stale_playing = (
        GameSession.objects.filter(status="PLAYING")
        .annotate(last_event_at=Max("events__created_at"))
        .filter(
            Q(last_event_at__lt=playing_cutoff) | (Q(last_event_at__isnull=True) & Q(updated_at__lt=playing_cutoff))
        )
    )
    for session in stale_playing:
        # B-4: lock + re-check — dos reapers concurrentes (lazy en
        # list_rooms y el comando reap_rooms) o un mark_finished en curso
        # podían re-marcar/procesar la misma sala dos veces. Y B-6: la
        # transición va por mark_finished — el status a pelo perdía el
        # evento terminal GAME_ENDED, el snapshot final (replay) y las
        # estadísticas de cuenta de los jugadores.
        from .engine import mark_finished  # import perezoso: engine ya importa _common

        with transaction.atomic():
            locked = GameSession.objects.select_for_update().get(pk=session.pk)
            if locked.status != "PLAYING":
                continue
            # Re-verificar frescura bajo el lock: un comando pudo llegar
            # entre el annotate y ahora.
            last_event = locked.events.aggregate(m=Max("created_at"))["m"]
            if (last_event or locked.updated_at) >= playing_cutoff:
                continue
        mark_finished(locked, winner_id=None)
        try:
            EngineRunnerClient.delete_room(session.room_id)
        except Exception:  # noqa: PIE786  # pylint: disable=broad-exception-caught
            logger.warning("engine-runner delete_room failed for stale PLAYING room %s", session.room_id)
        security_logger.info("stale PLAYING room %s marked FINISHED", session.room_id)
    stale = list(
        GameSession.objects.filter(status="WAITING", updated_at__lt=waiting_cutoff).exclude(players__is_connected=True)
    )
    stale += GameSession.objects.filter(status="FINISHED", updated_at__lt=finished_cutoff)
    reaped: list[str] = []
    for session in stale:
        room_id = session.room_id
        # B-4: lock + re-check antes de borrar — un join/list concurrente
        # pudo recolocar la sala (jugador conectado, status cambiado) entre
        # el listado y el delete.
        with transaction.atomic():
            locked = GameSession.objects.select_for_update().filter(pk=session.pk).first()
            if locked is None:
                continue
            status = locked.status
            if locked.status == "WAITING" and (
                locked.updated_at >= waiting_cutoff or locked.players.filter(is_connected=True).exists()
            ):
                continue
            if locked.status == "FINISHED" and locked.updated_at >= finished_cutoff:
                continue
            locked.delete()
        try:
            EngineRunnerClient.delete_room(room_id)
        except Exception:  # noqa: PIE786  # pylint: disable=broad-exception-caught
            # fire-and-forget: el barrido no debe tumbar por un runner caído
            logger.warning("engine-runner delete_room failed for reaped room %s", room_id)
        # Cerrar los sockets abiertos de la sala borrada: el grupo del
        # channel layer sobrevive a la fila — sin el broadcast los
        # conectados quedaban colgados para siempre y handle_chat seguía
        # difundiendo mensajes de una sala inexistente.
        _broadcast_room(room_id, {"type": "room.closed", "reason": "reaped", "status": status})
        reaped.append(room_id)
        security_logger.info("reaped stale room %s (status=%s)", room_id, status)
    return reaped
