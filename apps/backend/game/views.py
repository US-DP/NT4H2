"""Views for the game app — REST API endpoints."""

import hmac
import json
import logging
import os
import threading
import time
from datetime import timedelta

import httpx  # noqa: ASYNC127 - httpx sigue mantenido; la sugerencia httpx2 es errónea
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import transaction
from django.db.models import F, Max
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .engine_client import EngineRunnerClient
from .models import CommunityStat, GameEvent, GameSession, LeaderboardEntry, Player

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
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
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
    raw = request.META.get("CONTENT_LENGTH")
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


def _guard_post(request, scope: str):
    """Guardas comunes de las vistas POST: método, rate limit, tamaño y JSON.

    Devuelve (data, None) o (None, respuesta de error).
    """
    if request.method != "POST":
        return None, JsonResponse({"error": "Method not allowed"}, status=405)
    if _rate_limited(request, scope):
        return None, JsonResponse({"error": "Too many requests"}, status=429)
    too_big = _check_body_size(request)
    if too_big is not None:
        return None, too_big
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


def _persist_command_event(session, player_id, command_type, **extra):
    """Graba un GameEvent COMMAND para acciones REST que mutan el motor.

    Los comandos WS los persiste el consumer; los inyectados por REST
    (skip_turn) necesitaban el mismo tratamiento para no dejar huecos
    en el log de auditoría/replay. Mejor esfuerzo: no tumba la vista.
    """
    try:
        with transaction.atomic():
            seq = (GameEvent.objects.filter(session=session).aggregate(m=Max("seq"))["m"] or 0) + 1
            GameEvent.objects.create(
                session=session,
                seq=seq,
                event_type="COMMAND",
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


@csrf_exempt
def health_check(request):
    """Health check endpoint."""
    return JsonResponse({"status": "ok", "service": "nt4h-backend"})


# Estadísticas de comunidad — informes anónimos opt-in (contadores
# agregados; nunca se persiste quién informa ni cuándo).
MAX_ACHIEVEMENTS_PER_REPORT = 50


@csrf_exempt
def stats_report(request):
    """Recibe un informe anónimo de desbloqueos del jugador.

    Body: {"unlocks": ["achievement-id", ...]}. Cada informe cuenta como
    UN reportero: `rarity` mide el % de informantes que tiene el logro.
    """
    data, guard_error = _guard_post(request, "stats")
    if guard_error is not None:
        return guard_error

    unlocks = data.get("unlocks")
    if not isinstance(unlocks, list):
        return JsonResponse({"error": "unlocks must be a list"}, status=400)
    ids = {str(a)[:50] for a in unlocks if isinstance(a, str) and 0 < len(a) <= 50 and a != "_total"}
    ids = set(list(ids)[:MAX_ACHIEVEMENTS_PER_REPORT])

    with transaction.atomic():
        total, _ = CommunityStat.objects.select_for_update().get_or_create(achievement_id="_total")
        total.reporters += 1
        total.save(update_fields=["reporters"])
        for achievement_id in ids:
            row, _ = CommunityStat.objects.select_for_update().get_or_create(achievement_id=achievement_id)
            row.reporters += 1
            row.save(update_fields=["reporters"])

    return JsonResponse({"ok": True})


def stats_community(request):
    """Devuelve % de informantes que posee cada logro ("rareza")."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if _rate_limited(request, "read"):
        return JsonResponse({"error": "Too many requests"}, status=429)
    rows = list(CommunityStat.objects.all())
    total = next((r.reporters for r in rows if r.achievement_id == "_total"), 0)
    rarity = (
        {r.achievement_id: round(r.reporters / total, 4) for r in rows if r.achievement_id != "_total"} if total else {}
    )
    return JsonResponse({"reports": total, "rarity": rarity})


@csrf_exempt
def leaderboard(request):
    """Clasificación pública opt-in.

    GET → top 25 por victorias {"entries": [{name, wins, games}]}.
    POST {"name": str, "won": bool} → suma 1 partida (+1 victoria si won).
    El cliente solo informa si el usuario activó la casilla pública.
    """
    if request.method == "GET":
        if _rate_limited(request, "read"):
            return JsonResponse({"error": "Too many requests"}, status=429)
        entries = LeaderboardEntry.objects.order_by("-wins", "-games", "name")[:25]
        return JsonResponse({"entries": [e.to_dict() for e in entries]})

    data, guard_error = _guard_post(request, "leaderboard")
    if guard_error is not None:
        return guard_error

    name = str(data.get("name", "")).strip()[:40]
    # Sanitizar: sin caracteres de control; el nombre vacío no clasifica
    name = "".join(c for c in name if ord(c) >= 32).strip()
    if not name or name.startswith("_"):
        return JsonResponse({"error": "name is required"}, status=400)
    won = data.get("won") is True

    with transaction.atomic():
        entry, _ = LeaderboardEntry.objects.select_for_update().get_or_create(name=name)
        entry.games += 1
        if won:
            entry.wins += 1
        entry.save(update_fields=["wins", "games", "updated_at"])

    return JsonResponse({"ok": True, "entry": entry.to_dict()})


@csrf_exempt
def _validate_create_config(config):
    """Límites de presupuesto para la config de sala.

    Los snapshots de sets del host viajan en la config: se acota tamaño y
    recuento antes de persistir o reenviar al runner (DoS / peticiones enormes).
    """
    if not isinstance(config, dict):
        return JsonResponse({"error": "Invalid config"}, status=400)
    try:
        config_bytes = len(json.dumps(config).encode("utf-8"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "Invalid config"}, status=400)
    if config_bytes > 256 * 1024:
        return JsonResponse({"error": "config too large"}, status=413)
    custom_sets = config.get("customSets")
    if custom_sets is None:
        return None
    if not isinstance(custom_sets, list) or len(custom_sets) > 8:
        return JsonResponse({"error": "too many customSets"}, status=400)
    entity_count = sum(len(s.get("cards", [])) + len(s.get("decks", [])) for s in custom_sets if isinstance(s, dict))
    if entity_count > 500:
        return JsonResponse({"error": "customSets too large"}, status=400)
    return None


def _engine_room_config(mode: str, max_players: int, seed: str, heroes: list, config: dict) -> dict:
    """Construye la config que viaja al runner: solo campos presentes."""
    engine_config = {
        "mode": mode,
        "playerCount": max_players,
        "seed": seed,
        "heroes": heroes,
        "useScenarios": config.get("useScenarios", True),
    }
    for key in (
        "scenarioIds",
        "soloMarketCardIds",
        "soloSupportHeroIds",
        "customDecks",
        "hordeCardIds",
        "warlordIds",
        "marketCardIds",
        "customSets",
    ):
        if config.get(key) is not None:
            engine_config[key] = config[key]
    return engine_config


def _parse_heroes(data: dict):
    """Valida la lista `heroes` del payload. Devuelve lista o JsonResponse."""
    heroes = data.get("heroes", [])
    if not isinstance(heroes, list):
        return JsonResponse({"error": "Invalid heroes"}, status=400)
    # D432: el runner exige >=1 héroe (Zod min(1)); validar aquí evita
    # crear una sala Django sin su contraparte en el motor (desync).
    if len(heroes) < 1 or len(heroes) > 4:
        return JsonResponse({"error": "heroes must contain between 1 and 4 entries"}, status=400)
    for h in heroes:
        if not isinstance(h, dict):
            return JsonResponse({"error": "Invalid hero entry"}, status=400)
        for key in ("heroId", "deckId"):
            if (err := _check_str(h.get(key, ""), key, allow_empty=False)) is not None:
                return err
    return heroes


def _parse_create_room_payload(data: dict):
    """Valida el payload de create_room. Devuelve dict de campos o JsonResponse de error."""
    mode = data.get("mode", "STANDARD")
    if mode not in ("STANDARD", "SOLO", "MULTICLASS"):
        return JsonResponse({"error": "Invalid mode"}, status=400)
    seed = data.get("seed", "")
    if (err := _check_str(seed, "seed", _MAX_SEED_LEN)) is not None:
        return err
    try:
        max_players = int(data.get("maxPlayers", 4))
    except (TypeError, ValueError):
        return JsonResponse({"error": "Invalid maxPlayers"}, status=400)
    if max_players < 1 or max_players > 4:
        return JsonResponse({"error": "maxPlayers must be between 1 and 4"}, status=400)
    host_id = data.get("hostId", "host")
    host_name = data.get("hostName", "Anfitrion")
    if (err := _check_str(host_id, "hostId", allow_empty=False)) is not None:
        return err
    if (err := _check_str(host_name, "hostName")) is not None:
        return err
    config = data.get("config", {})
    if (err := _validate_create_config(config)) is not None:
        return err
    heroes = _parse_heroes(data)
    if isinstance(heroes, JsonResponse):
        return heroes
    return {
        "mode": mode,
        "seed": seed,
        "max_players": max_players,
        "host_id": host_id,
        "host_name": host_name,
        "config": config,
        "heroes": heroes,
    }


def _create_session_with_host(parsed: dict):
    """Crea la sesión + host en una transacción.

    Reintenta ante colisión del room_id generado (unique) — sin el retry
    un IntegrityError escapaba como 500. Devuelve (session, host) o
    (None, None).
    """
    from django.db import IntegrityError

    # El héroe del host también se guarda en su fila Player: en start_room
    # el roster del motor se reconstruye con la elección de cada miembro
    # (los invitados declaran la suya al entrar por join).
    heroes = parsed["heroes"]
    host_id = parsed["host_id"]
    host_hero = next((h for h in heroes if h.get("playerId") == host_id), heroes[0] if heroes else {})

    for _attempt in range(3):
        try:
            with transaction.atomic():
                session = GameSession.objects.create(
                    mode=parsed["mode"],
                    seed=parsed["seed"],
                    max_players=parsed["max_players"],
                    host_id=host_id,
                    config=parsed["config"],
                    status="WAITING",
                )
                host = Player.objects.create(
                    session=session,
                    player_id=host_id,
                    name=parsed["host_name"],
                    is_host=True,
                    hero_id=str(host_hero.get("heroId", ""))[:100],
                    deck_id=str(host_hero.get("deckId", ""))[:100],
                    hero_face=str(host_hero.get("heroFace", ""))[:10],
                )
            return session, host
        except IntegrityError:
            continue
    return None, None


def create_room(request):
    """Create a new game room."""
    data, guard_error = _guard_post(request, "create")
    if guard_error is not None:
        return guard_error

    parsed = _parse_create_room_payload(data)
    if isinstance(parsed, JsonResponse):
        return parsed
    mode = parsed["mode"]
    seed = parsed["seed"]
    max_players = parsed["max_players"]
    host_id = parsed["host_id"]
    config = parsed["config"]
    heroes = parsed["heroes"]

    # D411: transacción atómica — evita salas huérfanas sin host.
    session, host = _create_session_with_host(parsed)
    if session is None:
        return JsonResponse({"error": "Could not allocate room"}, status=500)

    # Also create the room in the engine-runner. Una sala sin motor es
    # inútil (todos sus comandos 404): fallar cerrado y limpiar.
    try:
        # Reenviar al runner la config de contenido validada allá
        # (Zod + validación de sets). Los campos ausentes no se envían.
        engine_config = _engine_room_config(mode, max_players, seed or f"room-{session.room_id}", heroes, config)
        EngineRunnerClient.create_room(session.room_id, engine_config)
    except httpx.HTTPStatusError as exc:
        session.delete()
        # 400 del runner = config inválida (p. ej. un set del Taller que no
        # pasa la validación): propagar como 400, no 503.
        if exc.response is not None and exc.response.status_code == 400:
            try:
                detail = exc.response.json()
            except ValueError:
                detail = {"error": "Invalid game config"}
            return JsonResponse(detail, status=400)
        logger.exception("engine-runner create_room failed")
        return JsonResponse({"error": "Engine runner unavailable"}, status=503)
    except (httpx.HTTPError, ValueError):
        logger.exception("engine-runner create_room failed")
        session.delete()
        return JsonResponse({"error": "Engine runner unavailable"}, status=503)

    security_logger.info("room created %s by host %s", session.room_id, host_id)
    return JsonResponse(
        {
            "roomId": session.room_id,
            "status": "created",
            "hostId": host_id,
            # D431: el token solo se devuelve al cliente que crea la sala
            "hostToken": host.auth_token,
        }
    )


_LAST_REAP_AT = {"ts": 0.0}  # celda mutable — evita `global` en list_rooms
_REAP_INTERVAL = 60.0  # el barrido perezoso corre como máximo 1/min


@csrf_exempt
def list_rooms(request):
    """List public waiting rooms."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if _rate_limited(request, "read"):
        return JsonResponse({"error": "Too many requests"}, status=429)

    # Reaper perezoso: limpia salas muertas al listar (y por
    # `manage.py reap_rooms`), acotado a una pasada por minuto.
    now = time.monotonic()
    if now - _LAST_REAP_AT["ts"] > _REAP_INTERVAL:
        _LAST_REAP_AT["ts"] = now
        try:
            reap_stale_rooms()
        except Exception:  # noqa: PIE786  # pylint: disable=broad-exception-caught
            logger.warning("reap_stale_rooms failed", exc_info=True)

    rooms = GameSession.objects.filter(status__in=["WAITING", "PLAYING"]).order_by("-created_at")[:50]
    # Sin config privada: el listado público no sirve los customSets del
    # host ni los pools del motor a cualquiera (ver _PUBLIC_CONFIG_KEYS).
    return JsonResponse({"rooms": [r.to_dict(include_private_config=False) for r in rooms]})


@csrf_exempt
def room_state(request, room_id):
    """Get the state of a room."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if _rate_limited(request, "read"):
        return JsonResponse({"error": "Too many requests"}, status=429)

    session = get_object_or_404(GameSession, room_id=room_id)
    # Config privada (customSets del host, pools del motor) solo para
    # miembros autenticados: el código de sala es público en list_rooms,
    # así que sin credenciales se sirve la vista pública. Es el canal por
    # el que un invitado descarga los sets del host tras unirse.
    include_private = False
    pid = request.GET.get("playerId")
    if pid:
        _, err = _verify_player(session, pid, _get_player_token(request))
        if err is not None:
            return err
        include_private = True
    return JsonResponse(session.to_dict(include_private_config=include_private))


@csrf_exempt
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


def _parse_join_fields(data: dict):
    """Valida los campos de join_room. Devuelve dict o JsonResponse de error.

    Acota longitudes ANTES de persistir: un name de 2MB reventaba la
    columna max_length=100 con DataError (500) en vez de un 400 limpio.
    """
    fields = {
        "player_id": data.get("playerId", ""),
        "name": data.get("name", "Jugador"),
        "hero_id": data.get("heroId", ""),
        "deck_id": data.get("deckId", ""),
        "hero_face": data.get("heroFace", ""),
    }
    for value, field in (
        (fields["player_id"], "playerId"),
        (fields["name"], "name"),
        (fields["hero_id"], "heroId"),
        (fields["deck_id"], "deckId"),
        (fields["hero_face"], "heroFace"),
    ):
        invalid = _check_str(value, field)
        if invalid is not None:
            return invalid
    if fields["hero_face"] and fields["hero_face"] not in ("FEMALE", "MALE"):
        return JsonResponse({"error": "Invalid heroFace"}, status=400)
    if not fields["player_id"]:
        return JsonResponse({"error": "playerId is required"}, status=400)
    return fields


def _apply_join(request, session_pk: int, fields: dict, data: dict):
    """Aplica el join bajo select_for_update (D412, anti-TOCTOU).

    Devuelve (player, session) o (None, JsonResponse de error). El
    estado de la sala se re-chequea DENTRO del lock: un start
    concurrente no debe admitir jugadores en una sala ya PLAYING.
    """
    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session_pk)
        if session.status != "WAITING":
            return None, JsonResponse({"error": "Room is not open"}, status=403)
        # D440: un jugador expulsado no puede volver a entrar con el mismo
        # playerId (ni reutilizar su token — la identidad queda vetada).
        if fields["player_id"] in (session.kicked_ids or []):
            return None, JsonResponse(
                {"error": "Has sido expulsado de esta sala", "kicked": True},
                status=403,
            )
        existing = Player.objects.filter(session=session, player_id=fields["player_id"]).first()
        if existing is None:
            if session.players.count() >= session.max_players:
                return None, JsonResponse({"error": "Room is full"}, status=403)
            player = Player.objects.create(
                session=session,
                player_id=fields["player_id"],
                name=fields["name"],
                hero_id=fields["hero_id"],
                deck_id=fields["deck_id"],
                hero_face=fields["hero_face"],
            )
        else:
            # D431: un playerId ya registrado solo puede re-unirse con su token
            token = _get_player_token(request, data)
            if not token or not hmac.compare_digest(existing.auth_token, token):
                return None, JsonResponse({"error": "Invalid player token"}, status=403)
            player = existing
            player.is_connected = True
            player.name = fields["name"]
            # La elección solo se sobrescribe cuando viene informada —
            # un rejoin sin heroId no borra la selección anterior.
            if fields["hero_id"]:
                player.hero_id = fields["hero_id"]
            if fields["deck_id"]:
                player.deck_id = fields["deck_id"]
            if fields["hero_face"]:
                player.hero_face = fields["hero_face"]
            player.save()
        _bump_revision(session)
    return player, session


@csrf_exempt
def join_room(request, room_id):
    """Join a room as a player."""
    data, guard_error = _guard_post(request, "join")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    if session.status != "WAITING":
        return JsonResponse({"error": "Room is not open"}, status=403)

    fields = _parse_join_fields(data)
    if isinstance(fields, JsonResponse):
        return fields

    player, result = _apply_join(request, session.pk, fields, data)
    if player is None:
        return result
    session = result

    return JsonResponse(
        {
            "joined": True,
            "player": player.to_dict(),
            "room": session.to_dict(),
            # D431: el token solo se devuelve al cliente que se une
            "authToken": player.auth_token,
        }
    )


@csrf_exempt
def leave_room(request, room_id):
    """Leave a room."""
    data, guard_error = _guard_post(request, "leave")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    player_id = data.get("playerId", "")
    invalid = _check_str(player_id, "playerId", allow_empty=False)
    if invalid is not None:
        return invalid

    # D431: solo el propio jugador (o el host) puede abandonar/expulsar
    token = _get_player_token(request, data)
    _player, error = _verify_player(session, player_id, token)
    if error is not None:
        host = Player.objects.filter(session=session, player_id=session.host_id).first()
        if not host or not token or not hmac.compare_digest(host.auth_token, token):
            return error

    room_closed = False
    # select_for_update: un join/start concurrente no debe quedar a medio
    # camino con una sala borrada bajo sus pies (M7).
    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session.pk)
        Player.objects.filter(session=session, player_id=player_id).update(is_connected=False)
        revision = _bump_revision(session)

        # Cleanup: sala WAITING abandonada por todos → borrar en runner y Django
        if session.status == "WAITING" and not session.players.filter(is_connected=True).exists():
            room_closed = True

    # Avisar a las conexiones WS del jugador para que se cierren — sin
    # esto seguían recibiendo broadcasts y podían enviar comandos en
    # PLAYING tras abandonar por REST.
    _broadcast_room(
        room_id,
        {
            "type": "room.player_left",
            "playerId": player_id,
            "roomRevision": revision,
        },
    )

    if room_closed:
        try:
            EngineRunnerClient.delete_room(session.room_id)
        except httpx.HTTPError:
            logger.warning("engine-runner delete_room failed for %s", session.room_id)
        _broadcast_room(room_id, {"type": "room.closed", "reason": "all_left"})
        session.delete()
        return JsonResponse({"left": True, "roomClosed": True})

    return JsonResponse({"left": True})


@csrf_exempt
def set_ready(request, room_id):
    """Toggle the caller's ready flag in a waiting room."""
    data, guard_error = _guard_post(request, "ready")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    player_id = data.get("playerId", "")
    player, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error
    if session.status != "WAITING":
        return JsonResponse({"error": "Room is not open"}, status=403)

    ready = bool(data.get("ready", True))
    # Lock de sesión: serializa con kick/start — un ready tardío no puede
    # resucitar a un jugador expulsado (su fila ya no existe: 403 arriba)
    # ni colarse entre la comprobación de "todos listos" y el start.
    with transaction.atomic():
        GameSession.objects.select_for_update().get(pk=session.pk)
        player.is_ready = ready
        player.save(update_fields=["is_ready"])
        revision = _bump_revision(session)

    _broadcast_room(
        room_id,
        {
            "type": "room.player_ready",
            "playerId": player_id,
            "ready": ready,
            "roomRevision": revision,
        },
    )
    return JsonResponse({"ready": ready, "room": session.to_dict()})


def _recreate_engine_room(session, room_id: str, players: list) -> bool:
    """Recrea la sala del runner con el roster completo de jugadores.

    La sala del runner ya existe (con el roster parcial de create): se
    borra y recrea con el definitivo. En WAITING no hay estado de juego
    que perder — los comandos WS están cerrados hasta PLAYING.
    """
    heroes = [
        {
            "playerId": p.player_id,
            "heroId": p.hero_id,
            "heroFace": p.hero_face or "FEMALE",
            "deckId": p.deck_id,
        }
        for p in players
    ]
    engine_config = _engine_room_config(
        session.mode,
        session.max_players,
        session.seed or f"room-{room_id}",
        heroes,
        session.config or {},
    )
    try:
        EngineRunnerClient.delete_room(room_id)
    except httpx.HTTPError:
        # Si la sala ya no existe en el runner, mejor: solo recrear.
        logger.info("engine delete before start no-op for %s", room_id)
    try:
        EngineRunnerClient.create_room(room_id, engine_config)
    except httpx.HTTPError:
        logger.warning("engine recreate failed for start %s", room_id, exc_info=True)
        return False
    return True


@csrf_exempt
def start_room(request, room_id):
    """Start the game in a room (host only)."""
    data, guard_error = _guard_post(request, "start")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    player_id = data.get("playerId", "")
    invalid = _check_str(player_id, "playerId", allow_empty=False)
    if invalid is not None:
        return invalid
    if session.host_id != player_id:
        return JsonResponse({"error": "Only the host can start"}, status=403)
    # D431: verificar que quien arranca es realmente el host (token)
    _, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error

    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session.pk)
        # Re-verificar el host DENTRO del lock: una transfer_host
        # concurrente no puede dejar al viejo host autorizado por una
        # lectura stale de session.host_id.
        if session.host_id != player_id:
            return JsonResponse({"error": "Only the host can start"}, status=403)
        if session.status != "WAITING":
            return JsonResponse({"error": "Room is not open"}, status=403)
        players = list(session.players.order_by("joined_at"))
        if len(players) < 1:
            return JsonResponse({"error": "Not enough players"}, status=403)
        # Todos los invitados deben estar preparados; el host lo está
        # implícitamente al pulsar Iniciar.
        pending = [p for p in players if not p.is_host and not p.is_ready]
        if pending:
            return JsonResponse({"error": "Not all players are ready"}, status=409)
        # Cada miembro debe tener héroe y mazo declarados — el roster del
        # motor se construye con todos los jugadores unidos; un invitado
        # sin héroe quedaría dentro de la sala pero incapaz de actuar.
        missing = [p for p in players if not p.hero_id or not p.deck_id]
        if missing:
            return JsonResponse({"error": "All players must choose a hero"}, status=409)

    # Reconstruir la sala del motor con el roster completo: en create solo
    # viajaban los héroes del host; los invitados eligen al entrar. Se
    # hace ANTES de marcar PLAYING — si el runner falla, la sala sigue en
    # espera en vez de arrancar con un roster incompleto.
    if not _recreate_engine_room(session, room_id, players):
        return JsonResponse({"error": "Engine runner unavailable"}, status=503)

    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session.pk)
        if session.status != "WAITING":
            return JsonResponse({"error": "Room is not open"}, status=403)
        session.status = "PLAYING"
        session.save()
        _bump_revision(session)

    return JsonResponse({"started": True, "room": session.to_dict()})


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
    player_id = data.get("playerId", "")
    target_id = data.get("targetId", "")
    for value, field in ((player_id, "playerId"), (target_id, "targetId")):
        invalid = _check_str(value, field, allow_empty=False)
        if invalid is not None:
            return invalid
    if player_id != session.host_id:
        return JsonResponse({"error": "Only the host can kick"}, status=403)
    _, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error

    if target_id == session.host_id:
        return JsonResponse({"error": "targetId is required and cannot be the host"}, status=400)

    # Transacción + lock de sesión: serializa con start_room/set_ready para
    # que un kick no compita con un inicio ni un ready tardío resucite al
    # expulsado (el Player borrado no puede re-aparecer: su fila no existe).
    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session.pk)
        if session.host_id != player_id:
            return JsonResponse({"error": "Only the host can kick"}, status=403)
        if session.status != "WAITING":
            return JsonResponse({"error": "Room is not open"}, status=403)
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

    player_id = data.get("playerId", "")
    target_id = data.get("targetId", "")
    for value, field in ((player_id, "playerId"), (target_id, "targetId")):
        invalid = _check_str(value, field, allow_empty=False)
        if invalid is not None:
            return invalid
    if player_id != session.host_id:
        return JsonResponse({"error": "Only the host can unkick"}, status=403)
    _, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error

    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session.pk)
        if session.host_id != player_id:
            return JsonResponse({"error": "Only the host can unkick"}, status=403)
        if session.status != "WAITING":
            return JsonResponse({"error": "Room is not open"}, status=403)
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

    player_id = data.get("playerId", "")
    target_id = data.get("targetId", "")
    for value, field in ((player_id, "playerId"), (target_id, "targetId")):
        invalid = _check_str(value, field, allow_empty=False)
        if invalid is not None:
            return invalid
    if player_id != session.host_id:
        return JsonResponse({"error": "Only the host can transfer"}, status=403)
    _, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error

    if target_id == session.host_id:
        return JsonResponse({"error": "targetId is required and cannot be the host"}, status=400)

    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session.pk)
        if session.host_id != player_id:
            return JsonResponse({"error": "Only the host can transfer"}, status=403)
        if session.status != "WAITING":
            return JsonResponse({"error": "Room is not open"}, status=403)
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


@csrf_exempt
def close_room(request, room_id):
    """Cierra la sala explícitamente (solo host autenticado).

    Avisa a los clientes por WS antes de borrar: el mensaje room.closed
    llega con la revisión final y todos desmontan la sala.
    """
    data, guard_error = _guard_post(request, "close")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    player_id = data.get("playerId", "")
    invalid = _check_str(player_id, "playerId", allow_empty=False)
    if invalid is not None:
        return invalid
    if player_id != session.host_id:
        return JsonResponse({"error": "Only the host can close the room"}, status=403)
    _, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error

    # Persistir la revisión final: broadcast de un revision+1 sin guardar
    # colisionaba con el siguiente bump real.
    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session.pk)
        revision = _bump_revision(session)
    _broadcast_room(
        room_id,
        {
            "type": "room.closed",
            "roomRevision": revision,
        },
    )

    try:
        EngineRunnerClient.delete_room(session.room_id)
    except httpx.HTTPError:
        logger.warning("engine-runner delete_room failed for %s", session.room_id)
    session.delete()
    return JsonResponse({"closed": True})


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

    player_id = data.get("playerId", "")
    invalid = _check_str(player_id, "playerId", allow_empty=False)
    if invalid is not None:
        return invalid
    if player_id != session.host_id:
        return JsonResponse({"error": "Only the host can skip a turn"}, status=403)
    _, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error

    if session.status != "PLAYING":
        return JsonResponse({"error": "Room is not in play"}, status=409)

    # Jugador activo según la proyección pública del runner (sin playerId).
    try:
        state_data = EngineRunnerClient.get_state(room_id)
    except httpx.HTTPError:
        logger.warning("engine state fetch failed for skip-turn %s", room_id, exc_info=True)
        return JsonResponse({"error": "Engine unavailable"}, status=502)
    active_id = (state_data.get("state") or {}).get("activePlayerId")
    if not active_id:
        return JsonResponse({"error": "No active player"}, status=409)

    import secrets

    try:
        result = EngineRunnerClient.execute_command(
            room_id,
            cid=f"skip-{secrets.token_hex(8)}",
            player_id=active_id,
            command={"type": "END_TURN"},
        )
    except httpx.HTTPError:
        logger.warning("engine skip-turn failed for %s", room_id, exc_info=True)
        return JsonResponse({"error": "Engine unavailable"}, status=502)

    if not result.get("accepted"):
        return JsonResponse({"skipped": False, "reason": result.get("reason", "rejected")}, status=409)

    # Persistir como GameEvent como cualquier comando de partida — sin el
    # registro el END_TURN forzado quedaba fuera del log de auditoría.
    _persist_command_event(session, active_id, "END_TURN", by="skip_turn")

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


# --- Tickets efímeros para WebSocket (P0) -----------------------------------
# El token de jugador NUNCA viaja en la URL del socket: el cliente autentica
# por REST y obtiene un ticket de un solo uso vinculado a (sala, jugador).
# In-memory como _RATE_LIMITS — en multi-worker usar cache compartida.
_WS_TICKETS: dict[str, dict] = {}
_WS_TICKET_TTL = 60.0  # segundos
_WS_TICKET_LOCK = threading.Lock()


def _issue_ws_ticket(room_id: str, player_id: str) -> str:
    """Emite un ticket de un solo uso para (sala, jugador)."""
    import secrets

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
