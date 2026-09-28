"""Endpoints del ciclo de vida de una sala.

create/list/state, join (con mazos del Taller), leave, ready, start y
close. La moderación de jugadores vive en ./players y la propiedad de la
config enviada al runner en _engine_room_config/_recreate_engine_room.
"""

import hmac
import json
import logging
import time

import httpx  # noqa: ASYNC127 - httpx sigue mantenido; la sugerencia httpx2 es errónea
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt

from accounts.authentication import get_auth_user

from ..engine_client import EngineRunnerClient
from ..models import GameSession, Player
from ._common import (
    _MAX_SEED_LEN,
    _broadcast_room,
    _bump_revision,
    _check_ids,
    _check_str,
    _for_update,
    _get_player_token,
    _guard_post,
    _rate_limited,
    _require_host,
    _verify_player,
    _verify_player_or_host,
    reap_stale_rooms,
    security_logger,
)

logger = logging.getLogger(__name__)


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


def _create_session_with_host(parsed: dict, user=None):
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
                    user=user,
                )
            return session, host
        except IntegrityError:
            continue
    return None, None


def _create_engine_room(session, parsed):
    """Crea la sala en el engine-runner; en error limpia y devuelve respuesta.

    Una sala sin motor es inútil (todos sus comandos 404): fallar cerrado
    y borrar la sesión. Devuelve None en éxito o la JsonResponse de error.
    """
    # Reenviar al runner la config de contenido validada allá
    # (Zod + validación de sets). Los campos ausentes no se envían.
    engine_config = _engine_room_config(
        parsed["mode"],
        parsed["max_players"],
        parsed["seed"] or f"room-{session.room_id}",
        parsed["heroes"],
        parsed["config"],
    )
    try:
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
    return None


def create_room(request):
    """Create a new game room."""
    data, guard_error = _guard_post(request, "create")
    if guard_error is not None:
        return guard_error

    parsed = _parse_create_room_payload(data)
    if isinstance(parsed, JsonResponse):
        return parsed
    host_id = parsed["host_id"]

    # D411: transacción atómica — evita salas huérfanas sin host.
    # Si el creador lleva JWT, su Player de sala queda vinculado a la cuenta.
    session, host = _create_session_with_host(parsed, user=get_auth_user(request))
    if session is None or host is None:
        return JsonResponse({"error": "Could not allocate room"}, status=500)

    engine_error = _create_engine_room(session, parsed)
    if engine_error is not None:
        return engine_error

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
        "custom_deck_id": data.get("customDeckId", ""),
        # Ausencia vs cadena vacía: un rejoin sin el campo no debe borrar
        # la selección anterior; "" informado sí la limpia.
        "custom_deck_present": "customDeckId" in data,
    }
    invalid = _check_ids(data, "playerId", "name", "heroId", "deckId", "heroFace", "customDeckId", allow_empty=True)
    if invalid is not None:
        return invalid
    if fields["hero_face"] and fields["hero_face"] not in ("FEMALE", "MALE"):
        return JsonResponse({"error": "Invalid heroFace"}, status=400)
    if not fields["player_id"]:
        return JsonResponse({"error": "playerId is required"}, status=400)
    # Snapshot del mazo del Taller: el invitado trae su definición y se
    # registra en session.config.customDecks para el roster del runner.
    custom_deck = data.get("customDeck")
    if custom_deck is not None:
        if not _is_valid_custom_deck(custom_deck):
            return JsonResponse({"error": "Invalid customDeck"}, status=400)
        fields["custom_deck"] = {
            "id": custom_deck["id"],
            "cardDefinitionIds": [str(cid) for cid in custom_deck["cardDefinitionIds"]],
        }
    return fields


def _is_valid_custom_deck(deck) -> bool:
    """True si `customDeck` es un snapshot válido: id corto + ids acotados."""
    if not isinstance(deck, dict) or not isinstance(deck.get("id"), str):
        return False
    if len(deck["id"]) > 100:
        return False
    ids = deck.get("cardDefinitionIds")
    if not isinstance(ids, list) or len(ids) > 20:
        return False
    return all(isinstance(cid, str) and len(cid) <= 150 for cid in ids)


def _rejoin_player(request, player, fields: dict, data: dict):
    """Verifica el token y refresca la selección de un jugador que re-entra.

    Devuelve None si el rejoin es válido; JsonResponse 403 si el token no
    valida (D431: un playerId registrado solo puede re-unirse con su token).
    """
    token = _get_player_token(request, data)
    if not token or not hmac.compare_digest(player.auth_token, token):
        return JsonResponse({"error": "Invalid player token"}, status=403)
    player.is_connected = True
    player.name = fields["name"]
    # La elección solo se sobrescribe cuando viene informada —
    # un rejoin sin heroId no borra la selección anterior.
    for field, key in (("hero_id", "hero_id"), ("deck_id", "deck_id"), ("hero_face", "hero_face")):
        if fields[key]:
            setattr(player, field, fields[key])
    # Un rejoin sin el campo conserva la selección anterior;
    # "" informado la limpia a propósito.
    if fields.get("custom_deck_present"):
        player.custom_deck_id = fields["custom_deck_id"]
    player.save()
    return None


def _apply_join(request, session_pk: int, fields: dict, data: dict):
    """Aplica el join bajo select_for_update (D412, anti-TOCTOU).

    Devuelve (player, session) o (None, JsonResponse de error). El
    estado de la sala se re-chequea DENTRO del lock: un start
    concurrente no debe admitir jugadores en una sala ya PLAYING.
    """
    user = get_auth_user(request)
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
                custom_deck_id=fields.get("custom_deck_id", ""),
                user=user,
            )
        else:
            # Si el rejoin viene autenticado y la fila no tenía cuenta,
            # la vinculamos (equivalente a claim-guest implícito).
            if user is not None and existing.user_id is None:
                existing.user = user
                existing.save(update_fields=["user"])
            rejoin_error = _rejoin_player(request, existing, fields, data)
            if rejoin_error is not None:
                return None, rejoin_error
            player = existing
        # Registrar el snapshot del mazo custom en la config de la sala:
        # el runner lo resuelve por customDeckId al construir la baraja.
        if fields.get("custom_deck"):
            _register_custom_deck(session, fields["custom_deck"])
        _bump_revision(session)
    return player, session


def _register_custom_deck(session, custom_deck: dict) -> None:
    """Registra/actualiza el snapshot del mazo del Taller en session.config.

    ``customDecks`` se indexa por id: un rejoin con el mismo mazo sustituye
    la definición anterior en vez de duplicarla.
    """
    cfg = dict(session.config or {})
    decks = [d for d in cfg.get("customDecks", []) if d.get("id") != custom_deck["id"]]
    decks.append(custom_deck)
    cfg["customDecks"] = decks
    session.config = cfg
    session.save(update_fields=["config"])


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
    if isinstance(result, JsonResponse):
        return result
    if player is None:
        return JsonResponse({"error": "Join failed"}, status=500)
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
    error = _verify_player_or_host(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error

    # select_for_update: un join/start concurrente no debe quedar a medio
    # camino con una sala borrada bajo sus pies (M7).
    with transaction.atomic():
        session = _for_update(session)
        Player.objects.filter(session=session, player_id=player_id).update(is_connected=False)
        revision = _bump_revision(session)

        # Cleanup: sala WAITING abandonada por todos → borrar en runner y Django
        room_closed = session.status == "WAITING" and not session.players.filter(is_connected=True).exists()

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
        return _close_dead_room(session, room_id)

    return JsonResponse({"left": True})


def _close_dead_room(session, room_id):
    """Sala WAITING sin conectados: borra en el runner y en Django."""
    try:
        EngineRunnerClient.delete_room(session.room_id)
    except httpx.HTTPError:
        logger.warning("engine-runner delete_room failed for %s", session.room_id)
    _broadcast_room(room_id, {"type": "room.closed", "reason": "all_left"})
    session.delete()
    return JsonResponse({"left": True, "roomClosed": True})


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

    if player is None:
        return JsonResponse({"error": "Player not found"}, status=403)

    ready = bool(data.get("ready", True))
    # Lock de sesión: serializa con kick/start — un ready tardío no puede
    # resucitar a un jugador expulsado (su fila ya no existe: 403 arriba)
    # ni colarse entre la comprobación de "todos listos" y el start.
    with transaction.atomic():
        _for_update(session)
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
            **({"customDeckId": p.custom_deck_id} if p.custom_deck_id else {}),
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


def _start_prechecks(session, player_id: str) -> tuple[list, JsonResponse | None]:
    """Bajo lock: host vigente + WAITING + roster completo y preparado.

    Devuelve (players, None) o ([], JsonResponse de error). El host se
    re-verifica DENTRO del lock: un transfer_host concurrente no puede
    dejar al viejo host autorizado por una lectura stale de host_id.
    """
    with transaction.atomic():
        session = _for_update(session)
        if session.host_id != player_id:
            return [], JsonResponse({"error": "Only the host can start"}, status=403)
        if session.status != "WAITING":
            return [], JsonResponse({"error": "Room is not open"}, status=403)
        players = list(session.players.order_by("joined_at"))
        if not players:
            return [], JsonResponse({"error": "Not enough players"}, status=403)
        # Todos los invitados deben estar preparados; el host lo está
        # implícitamente al pulsar Iniciar.
        if any(not p.is_host and not p.is_ready for p in players):
            return [], JsonResponse({"error": "Not all players are ready"}, status=409)
        # Cada miembro debe tener héroe y mazo declarados — el roster del
        # motor se construye con todos los jugadores unidos; un invitado
        # sin héroe quedaría dentro de la sala pero incapaz de actuar.
        if any(not p.hero_id or not p.deck_id for p in players):
            return [], JsonResponse({"error": "All players must choose a hero"}, status=409)
    return players, None


def _mark_playing(session) -> tuple[GameSession, JsonResponse | None]:
    """Marca PLAYING bajo lock. Devuelve (session, None) o (session, error)."""
    with transaction.atomic():
        session = _for_update(session)
        if session.status != "WAITING":
            return session, JsonResponse({"error": "Room is not open"}, status=403)
        session.status = "PLAYING"
        session.save()
        _bump_revision(session)
    return session, None


@csrf_exempt
def start_room(request, room_id):
    """Start the game in a room (host only)."""
    data, guard_error = _guard_post(request, "start")
    if guard_error is not None:
        return guard_error
    session = get_object_or_404(GameSession, room_id=room_id)

    # D431: verificar que quien arranca es realmente el host (token)
    player_id, error = _require_host(request, data, session, "start")
    if error is not None:
        return error

    players, error = _start_prechecks(session, player_id)
    if error is not None:
        return error

    # Reconstruir la sala del motor con el roster completo: en create solo
    # viajaban los héroes del host; los invitados eligen al entrar. Se
    # hace ANTES de marcar PLAYING — si el runner falla, la sala sigue en
    # espera en vez de arrancar con un roster incompleto.
    if not _recreate_engine_room(session, room_id, players):
        return JsonResponse({"error": "Engine runner unavailable"}, status=503)

    session, error = _mark_playing(session)
    if error is not None:
        return error

    return JsonResponse({"started": True, "room": session.to_dict()})


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

    _, error = _require_host(request, data, session, "close the room")
    if error is not None:
        return error

    # Persistir la revisión final: broadcast de un revision+1 sin guardar
    # colisionaba con el siguiente bump real.
    with transaction.atomic():
        session = _for_update(session)
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
