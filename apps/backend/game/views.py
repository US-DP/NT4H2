"""Views for the game app — REST API endpoints."""
import hmac
import json
import logging

from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt

from .engine_client import EngineRunnerClient
from .models import GameSession, Player

logger = logging.getLogger(__name__)

# Rate limiting por IP (in-memory; suficiente para una instancia — en
# despliegue multi-worker usar cache Redis compartida).
_RATE_LIMITS: dict[str, list[float]] = {}
_RATE_WINDOW = 60.0  # segundos
_RATE_MAX = 30  # peticiones mutadoras por IP y ventana


def _rate_limited(request) -> bool:
    """Devuelve True si la IP supera el límite de peticiones mutadoras."""
    import time

    ip = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip() or request.META.get("REMOTE_ADDR", "?")
    now = time.monotonic()
    hits = [t for t in _RATE_LIMITS.get(ip, []) if now - t < _RATE_WINDOW]
    if len(hits) >= _RATE_MAX:
        _RATE_LIMITS[ip] = hits
        return True
    hits.append(now)
    _RATE_LIMITS[ip] = hits
    return False


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
    """D431: verify that (player_id, token) matches a member of the session.
    Returns (player, None) on success, or (None, JsonResponse) on failure."""
    if not player_id:
        return None, JsonResponse({"error": "playerId is required"}, status=400)
    player = Player.objects.filter(session=session, player_id=player_id).first()
    if player is None:
        return None, JsonResponse({"error": "Player is not a member of this room"}, status=403)
    if not token or not hmac.compare_digest(player.auth_token, token):
        return None, JsonResponse({"error": "Invalid player token"}, status=403)
    return player, None


@csrf_exempt
def health_check(request):
    """Health check endpoint."""
    return JsonResponse({"status": "ok", "service": "nt4h-backend"})


@csrf_exempt
def create_room(request):
    """Create a new game room."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if _rate_limited(request):
        return JsonResponse({"error": "Too many requests"}, status=429)

    try:
        data = json.loads(request.body)
        if not isinstance(data, dict):
            return JsonResponse({"error": "Invalid JSON body"}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body"}, status=400)

    mode = data.get("mode", "STANDARD")
    if mode not in ("STANDARD", "SOLO", "MULTICLASS"):
        return JsonResponse({"error": "Invalid mode"}, status=400)
    seed = data.get("seed", "")
    try:
        max_players = int(data.get("maxPlayers", 4))
    except (TypeError, ValueError):
        return JsonResponse({"error": "Invalid maxPlayers"}, status=400)
    if max_players < 1 or max_players > 4:
        return JsonResponse({"error": "maxPlayers must be between 1 and 4"}, status=400)
    host_id = data.get("hostId", "host")
    host_name = data.get("hostName", "Anfitrion")
    config = data.get("config", {})
    if not isinstance(config, dict):
        return JsonResponse({"error": "Invalid config"}, status=400)
    heroes = data.get("heroes", [])
    if not isinstance(heroes, list):
        return JsonResponse({"error": "Invalid heroes"}, status=400)
    # D432: el runner exige >=1 héroe (Zod min(1)); validar aquí evita
    # crear una sala Django sin su contraparte en el motor (desync).
    if len(heroes) < 1 or len(heroes) > 4:
        return JsonResponse(
            {"error": "heroes must contain between 1 and 4 entries"}, status=400
        )

    # D411: transacción atómica — evita salas huérfanas sin host
    with transaction.atomic():
        session = GameSession.objects.create(
            mode=mode,
            seed=seed,
            max_players=max_players,
            host_id=host_id,
            config=config,
            status="WAITING",
        )
        host = Player.objects.create(
            session=session,
            player_id=host_id,
            name=host_name,
            is_host=True,
        )

    # Also create the room in the engine-runner. Una sala sin motor es
    # inútil (todos sus comandos 404): fallar cerrado y limpiar.
    try:
        EngineRunnerClient.create_room(session.room_id, {
            "mode": mode,
            "playerCount": max_players,
            "seed": seed or f"room-{session.room_id}",
            "heroes": heroes,
            "useScenarios": config.get("useScenarios", True),
        })
    except Exception as exc:
        logger.warning("engine-runner create_room failed: %s", exc)
        session.delete()
        return JsonResponse({"error": "Engine runner unavailable"}, status=503)

    return JsonResponse({
        "roomId": session.room_id,
        "status": "created",
        "hostId": host_id,
        # D431: el token solo se devuelve al cliente que crea la sala
        "hostToken": host.auth_token,
    })


@csrf_exempt
def list_rooms(request):
    """List public waiting rooms."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    rooms = GameSession.objects.filter(status="WAITING").order_by("-created_at")[:50]
    return JsonResponse({"rooms": [r.to_dict() for r in rooms]})


@csrf_exempt
def room_state(request, room_id):
    """Get the state of a room."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    session = get_object_or_404(GameSession, room_id=room_id)
    return JsonResponse(session.to_dict())


@csrf_exempt
def room_engine_state(request, room_id):
    """Get the game engine state of a room."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)

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
        return JsonResponse(result)
    except Exception:
        # D413: no exponer detalles internos del error al cliente
        logger.warning("engine-runner get_state failed for room %s", room_id)
        return JsonResponse({"error": "Engine runner unavailable"}, status=503)


@csrf_exempt
def join_room(request, room_id):
    """Join a room as a player."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if _rate_limited(request):
        return JsonResponse({"error": "Too many requests"}, status=429)

    session = get_object_or_404(GameSession, room_id=room_id)
    try:
        data = json.loads(request.body)
        if not isinstance(data, dict):
            return JsonResponse({"error": "Invalid JSON body"}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body"}, status=400)

    if session.status != "WAITING":
        return JsonResponse({"error": "Room is not open"}, status=403)

    player_id = data.get("playerId", "")
    name = data.get("name", "Jugador")
    hero_id = data.get("heroId", "")

    if not player_id:
        return JsonResponse({"error": "playerId is required"}, status=400)

    # D412: transacción + select_for_update — evita TOCTOU en joins concurrentes
    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session.pk)
        # Re-chequear el estado DENTRO del lock: un start concurrente no debe
        # permitir añadir jugadores a una sala ya PLAYING.
        if session.status != "WAITING":
            return JsonResponse({"error": "Room is not open"}, status=403)
        existing = Player.objects.filter(session=session, player_id=player_id).first()
        if existing is None:
            if session.players.count() >= session.max_players:
                return JsonResponse({"error": "Room is full"}, status=403)
            player = Player.objects.create(
                session=session,
                player_id=player_id,
                name=name,
                hero_id=hero_id,
            )
        else:
            # D431: un playerId ya registrado solo puede re-unirse con su token
            token = _get_player_token(request, data)
            if not token or not hmac.compare_digest(existing.auth_token, token):
                return JsonResponse({"error": "Invalid player token"}, status=403)
            player = existing
            player.is_connected = True
            player.name = name
            player.hero_id = hero_id
            player.save()

    return JsonResponse({
        "joined": True,
        "player": player.to_dict(),
        "room": session.to_dict(),
        # D431: el token solo se devuelve al cliente que se une
        "authToken": player.auth_token,
    })


@csrf_exempt
def leave_room(request, room_id):
    """Leave a room."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    session = get_object_or_404(GameSession, room_id=room_id)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        data = {}

    player_id = data.get("playerId", "")
    if not player_id:
        return JsonResponse({"error": "playerId is required"}, status=400)

    # D431: solo el propio jugador (o el host) puede abandonar/expulsar
    token = _get_player_token(request, data)
    player, error = _verify_player(session, player_id, token)
    if error is not None:
        host = Player.objects.filter(session=session, player_id=session.host_id).first()
        if not host or not token or not hmac.compare_digest(host.auth_token, token):
            return error
    Player.objects.filter(session=session, player_id=player_id).update(is_connected=False)

    # Cleanup: sala WAITING abandonada por todos → borrar en runner y Django
    if session.status == "WAITING" and not session.players.filter(
        is_connected=True
    ).exists():
        try:
            EngineRunnerClient.delete_room(session.room_id)
        except Exception:
            logger.warning(
                "engine-runner delete_room failed for %s", session.room_id
            )
        session.delete()
        return JsonResponse({"left": True, "roomClosed": True})

    return JsonResponse({"left": True})


@csrf_exempt
def start_room(request, room_id):
    """Start the game in a room (host only)."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    session = get_object_or_404(GameSession, room_id=room_id)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        data = {}

    player_id = data.get("playerId", "")
    if session.host_id != player_id:
        return JsonResponse({"error": "Only the host can start"}, status=403)
    # D431: verificar que quien arranca es realmente el host (token)
    _, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error

    with transaction.atomic():
        session = GameSession.objects.select_for_update().get(pk=session.pk)
        if session.status != "WAITING":
            return JsonResponse({"error": "Room is not open"}, status=403)
        if session.players.count() < 1:
            return JsonResponse({"error": "Not enough players"}, status=403)
        session.status = "PLAYING"
        session.save()

    return JsonResponse({"started": True, "room": session.to_dict()})
