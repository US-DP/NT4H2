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
from django.views.decorators.csrf import csrf_exempt

from accounts.authentication import get_auth_user

from ..engine_client import EngineRunnerClient
from ..models import GameSession, Player
from ._common import (
    _MAX_SEED_LEN,
    MAX_KICKED_IDS,
    _broadcast_room,
    _bump_player_stat,
    _bump_revision,
    _check_engine_id,
    _check_ids,
    _check_str,
    _for_update,
    _get_player_token,
    _get_session,
    _guard_post,
    _rate_limited,
    _require_host,
    _verify_player,
    _verify_player_or_host,
    reap_stale_rooms,
    security_logger,
)
from .engine import _revoke_ws_tickets, mark_finished

logger = logging.getLogger(__name__)


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
    if custom_sets is not None:
        if not isinstance(custom_sets, list) or len(custom_sets) > 8:
            return JsonResponse({"error": "too many customSets"}, status=400)
        entity_count = sum(
            len(s.get("cards", [])) + len(s.get("decks", [])) for s in custom_sets if isinstance(s, dict)
        )
        if entity_count > 500:
            return JsonResponse({"error": "customSets too large"}, status=400)
    # customDecks viaja al runner y se indexa en join: validar la forma
    # aquí (un no-dict provocaba AttributeError→500 en _register_custom_deck)
    # y quitar ownerPlayerId — el ownership lo estampa el backend al unirse;
    # un owner ajeno pre-registrado impedía al legítimo redefinir su mazo.
    decks = config.get("customDecks")
    if decks is not None:
        if not isinstance(decks, list) or len(decks) > _MAX_CUSTOM_DECKS:
            return JsonResponse({"error": "too many customDecks"}, status=400)
        clean = []
        for d in decks:
            if not _is_valid_custom_deck(d):
                return JsonResponse({"error": "Invalid customDecks entry"}, status=400)
            clean.append({k: v for k, v in d.items() if k != "ownerPlayerId"})
        config["customDecks"] = clean
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
        # Misma forma que CreateRoomSchema del runner (D432): playerId y
        # heroFace son obligatorios allí — sin validarlos aquí, el runner
        # respondía 400 después de crear la sala Django (desync).
        # playerId/heroId además por idSchema (sin '__*'/unsafe ids).
        if (err := _check_engine_id(h.get("playerId", ""), "playerId")) is not None:
            return err
        if (err := _check_engine_id(h.get("heroId", ""), "heroId")) is not None:
            return err
        if h.get("heroFace") not in ("FEMALE", "MALE"):
            return JsonResponse({"error": "Invalid heroFace"}, status=400)
        # Multiclase: mismos campos opcionales que CreateRoomSchema del
        # runner (secondDeckId ≤128 chars, playerAge entero ≥0). Sin
        # validarlos aquí se persistían y el roster del motor era un
        # desync silencioso.
        if (err := _check_str(h.get("secondDeckId", ""), "secondDeckId", 128)) is not None:
            return err
        if "playerAge" in h:
            age = h.get("playerAge")
            if not isinstance(age, int) or isinstance(age, bool) or not 0 <= age <= 200:
                return JsonResponse({"error": "Invalid playerAge"}, status=400)
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
                    # Multiclase: la segunda baraja y la edad del host
                    # también sobreviven al recreate de start_room.
                    second_deck_id=str(host_hero.get("secondDeckId", ""))[:100],
                    player_age=(
                        host_hero.get("playerAge")
                        if isinstance(host_hero.get("playerAge"), int)
                        and not isinstance(host_hero.get("playerAge"), bool)
                        else None
                    ),
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


@csrf_exempt
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

    rooms = (
        GameSession.objects.filter(status__in=["WAITING", "PLAYING"])
        # players__user__profile: to_dict() lee user.profile por jugador —
        # sin el prefetch eran ~2 queries extra por jugador por sala (N+1).
        .prefetch_related("players__user__profile").order_by("-created_at")[:50]
    )
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

    session = _get_session(room_id)
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
        "second_deck_id": data.get("secondDeckId", ""),
        "player_age": data.get("playerAge"),
        # Ausencia vs cadena vacía: un rejoin sin el campo no debe borrar
        # la selección anterior; "" informado sí la limpia.
        "custom_deck_present": "customDeckId" in data,
        "second_deck_present": "secondDeckId" in data,
        "player_age_present": "playerAge" in data,
    }
    invalid = _check_ids(
        data, "playerId", "name", "heroId", "deckId", "heroFace", "customDeckId", "secondDeckId", allow_empty=True
    )
    if invalid is not None:
        return invalid
    # playerId/heroId viajan al runner con idSchema (sin '__*'/unsafe):
    # en join son opcionales (rejoin), así que solo se validan si vienen.
    for key, field in (("playerId", "player_id"), ("heroId", "hero_id")):
        if fields[field] and (err := _check_engine_id(fields[field], key)) is not None:
            return err
    if fields["hero_face"] and fields["hero_face"] not in ("FEMALE", "MALE"):
        return JsonResponse({"error": "Invalid heroFace"}, status=400)
    # Multiclase: la edad declarada usa el mismo contrato que el runner
    # (entero ≥0); tope 200 para que quepa en PositiveSmallIntegerField.
    if fields["player_age"] is not None and (
        not isinstance(fields["player_age"], int)
        or isinstance(fields["player_age"], bool)
        or not 0 <= fields["player_age"] <= 200
    ):
        return JsonResponse({"error": "Invalid playerAge"}, status=400)
    if not fields["player_id"]:
        return JsonResponse({"error": "playerId is required"}, status=400)
    # Snapshot del mazo del Taller: el invitado trae su definición y se
    # registra en session.config.customDecks para el roster del runner.
    custom_deck = data.get("customDeck")
    if custom_deck is not None:
        if not _is_valid_custom_deck(custom_deck):
            return JsonResponse({"error": "Invalid customDeck"}, status=400)
        # El snapshot subido debe ser el mazo que el jugador dice usar:
        # sin esta igualdad cualquiera podía reescribir la definición del
        # customDeckId de otro miembro antes del start.
        if custom_deck["id"] != fields["custom_deck_id"]:
            return JsonResponse({"error": "customDeck.id must match customDeckId"}, status=400)
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
    # Multiclase: mismo criterio — rejoin sin el campo conserva la
    # segunda baraja y la edad anteriores.
    if fields.get("second_deck_present"):
        player.second_deck_id = fields["second_deck_id"]
    if fields.get("player_age_present"):
        player.player_age = fields["player_age"]
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
        # Y con cuenta vinculada el veto es por USUARIO: re-entrar con un
        # playerId nuevo pero el mismo JWT seguía funcionando (el veto
        # solo miraba player_id). Invitados sin cuenta solo pueden vetarse
        # por asiento — es lo máximo identificable que tienen.
        kicked_users = (session.config or {}).get("_kickedUserIds") or {}
        if user is not None and str(user.pk) in kicked_users.values():
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
                second_deck_id=fields.get("second_deck_id", ""),
                player_age=fields.get("player_age"),
                user=user,
            )
        else:
            rejoin_error = _rejoin_player(request, existing, fields, data)
            if rejoin_error is not None:
                return None, rejoin_error
            # Claim-guest implícito SOLO tras autenticar el rejoin: si se
            # vinculaba antes de validar el playerToken, cualquier cuenta
            # con JWT podía apropiarse la fila de un invitado mandando un
            # join con su playerId y un token incorrecto (el 403 devuelto
            # no deshacía el save dentro del atomic).
            if user is not None and existing.user_id is None:
                existing.user = user
                existing.save(update_fields=["user"])
            player = existing
        # Registrar el snapshot del mazo custom en la config de la sala:
        # el runner lo resuelve por customDeckId al construir la baraja.
        if fields.get("custom_deck"):
            deck_error = _register_custom_deck(session, fields["custom_deck"], fields["player_id"])
            if deck_error is not None:
                return None, deck_error
        _bump_revision(session)
    return player, session


# El CreateRoomSchema del runner limita customDecks a 8 (server.ts) — un
# tope mayor aquí permitía registrar mazos con los que la sala nunca
# podía arrancar (400 del runner enmascarado como 503).
_MAX_CUSTOM_DECKS = 8


def _register_custom_deck(session, custom_deck: dict, owner_player_id: str) -> JsonResponse | None:
    """Registra/actualiza el snapshot del mazo del Taller en session.config.

    ``customDecks`` se indexa por id: un rejoin con el mismo mazo sustituye
    la definición anterior en vez de duplicarla. El mazo queda ligado al
    owner que lo subió — otro jugador no puede redefinir un deckId ajeno.
    """
    cfg = dict(session.config or {})
    existing = cfg.get("customDecks", [])
    other = next((d for d in existing if d.get("id") == custom_deck["id"]), None)
    if other is not None and other.get("ownerPlayerId") not in (None, owner_player_id):
        return JsonResponse({"error": "customDeck id belongs to another player"}, status=409)
    decks = [d for d in existing if d.get("id") != custom_deck["id"]]
    if len(decks) >= _MAX_CUSTOM_DECKS:
        return JsonResponse({"error": "Too many custom decks in room"}, status=400)
    decks.append({**custom_deck, "ownerPlayerId": owner_player_id})
    cfg["customDecks"] = decks
    session.config = cfg
    session.save(update_fields=["config"])
    return None


@csrf_exempt
def join_room(request, room_id):
    """Join a room as a player."""
    data, guard_error = _guard_post(request, "join")
    if guard_error is not None:
        return guard_error
    session = _get_session(room_id)

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

    # Con el socket del lobby abierto el polling está desactivado: sin
    # este broadcast el roster de los demás clientes no crecía nunca.
    # Rejoins también llegan aquí (el cliente hace upsert por playerId).
    _broadcast_room(
        room_id,
        {
            "type": "room.player_joined",
            "player": player.to_dict(),
            "roomRevision": session.revision,
        },
    )

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
    session = _get_session(room_id)

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
    new_host_id = None
    room_finished = False
    token = _get_player_token(request, data)
    with transaction.atomic():
        session = _for_update(session)
        player = Player.objects.filter(session=session, player_id=player_id).first()
        if player is not None:
            # Abandono explícito en plena partida: cuenta en las
            # estadísticas de la cuenta vinculada (played/won/lost los
            # cierra mark_finished). En PLAYING solo abandona el propio
            # jugador — kick está vetado en PLAYING y el token de host era
            # un bypass que borraba filas ajenas en plena partida.
            if session.status == "PLAYING":
                if not token or not hmac.compare_digest(player.auth_token, token):
                    return JsonResponse({"error": "Only the player can leave mid-game"}, status=403)
                _bump_player_stat(player.user_id, games_abandoned=1)
            # Si se va el host, promocionar al conectado más antiguo (o al
            # último que quede) — en PLAYING sin esto skip_turn/close
            # quedaban inalcanzables hasta el reaper.
            if session.host_id == player_id:
                nxt = (
                    session.players.filter(is_connected=True).exclude(player_id=player_id).order_by("id").first()
                ) or session.players.exclude(player_id=player_id).order_by("id").first()
                if nxt is not None:
                    nxt.is_host = True
                    nxt.save(update_fields=["is_host"])
                    session.host_id = nxt.player_id
                    session.save(update_fields=["host_id"])
                    new_host_id = nxt.player_id
            # El abandono borra la fila (como kick): libera el hueco en
            # WAITING e impide reconectar en PLAYING — _verify_player ya no
            # lo reconoce, así que no puede pedir tickets ni mandar
            # comandos. El motor conserva su asiento en el roster.
            player.delete()
            # Veto solo cuando es el HOST quien retira a otro: el token
            # del requester debe ser el del host (un jugador que abandona
            # por su propio token en WAITING no queda vetado — era un
            # leave voluntario, no una expulsión).
            host_row = (
                session.players.filter(player_id=session.host_id).only("auth_token").first()
                if session.host_id != player_id
                else None
            )
            host_removal = (
                host_row is not None
                and session.status == "WAITING"
                and bool(token)
                and hmac.compare_digest(host_row.auth_token, token)
            )
            if host_removal:
                kicked = list(session.kicked_ids or [])
                if player_id not in kicked:
                    kicked.append(player_id)
                session.kicked_ids = kicked[-MAX_KICKED_IDS:]
                update_fields = ["kicked_ids"]
                if player.user_id:
                    cfg = dict(session.config or {})
                    kicked_users = dict(cfg.get("_kickedUserIds") or {})
                    kicked_users[player_id] = str(player.user_id)
                    kicked_users = {k: v for k, v in kicked_users.items() if k in kicked}
                    cfg["_kickedUserIds"] = kicked_users
                    session.config = cfg
                    update_fields.append("config")
                session.save(update_fields=update_fields)
        revision = _bump_revision(session)

        # Cleanup: sala WAITING abandonada por todos → borrar en runner y
        # Django. "Todos" = sin filas Player: is_connected ahora refleja
        # presencia WS real (un miembro que aún no abrió el socket no
        # cuenta como conectado pero tampoco abandona la sala).
        room_closed = session.status == "WAITING" and not session.players.exists()
        # Sala PLAYING que se queda sin ningún Player: la partida queda
        # abortada — sin esto host_id apuntaba a una fila borrada y la
        # sala era ingobernable hasta el reaper (48h).
        room_finished = session.status == "PLAYING" and not session.players.exists()

    if room_finished:
        mark_finished(session, None)

    # Revocar tickets WS emitidos pero sin consumir: un ticket pendiente
    # (~60 s) permitía reconectar y deshacer el abandono en silencio.
    _revoke_ws_tickets(room_id, player_id)

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
    if new_host_id is not None:
        _broadcast_room(
            room_id,
            {
                "type": "room.host_changed",
                "playerId": new_host_id,
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
    session = _get_session(room_id)

    player_id = data.get("playerId", "")
    player, error = _verify_player(session, player_id, _get_player_token(request, data))
    if error is not None:
        return error
    if session.status != "WAITING":
        return JsonResponse({"error": "Room is not open"}, status=403)

    if player is None:
        return JsonResponse({"error": "Player not found"}, status=403)

    # bool() sobre "false" da True — exigir bool real si el campo viene.
    ready = data.get("ready", True)
    if not isinstance(ready, bool):
        return JsonResponse({"error": "ready must be a boolean"}, status=400)
    # Lock de sesión: serializa con kick/start — un ready tardío no puede
    # resucitar a un jugador expulsado (su fila ya no existe: 403 arriba)
    # ni colarse entre la comprobación de "todos listos" y el start.
    with transaction.atomic():
        _for_update(session)
        # B-3: TOCTOU — el kick pudo comprometerse entre _verify_player y
        # este lock; re-comprobar la fila dentro del atomic (un save() sobre
        # una fila borrada no da error: actualiza 0 filas y aún así se
        # emitía room.player_ready a un jugador expulsado).
        if not session.players.filter(pk=player.pk).exists():
            return JsonResponse({"error": "Player not found"}, status=403)
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
            # Multiclase: sin estos campos el roster recreado perdía la
            # segunda baraja y la edad del desempate de líder.
            **({"secondDeckId": p.second_deck_id} if p.second_deck_id else {}),
            **({"playerAge": p.player_age} if p.player_age is not None else {}),
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
    """Start the game in a room (host only).

    Un solo lock de sesión cubre prechecks + recreate del runner +
    PLAYING: con dos transacciones separadas, un segundo start
    concurrente pasaba los prechecks, recreaba la sala del motor (delete
    + create) sobre una sala YA en PLAYING — borrando la partida que el
    primer start acababa de arrancar — y solo entonces chocaba con el
    chequeo de estado. La llamada HTTP al runner dentro del lock es
    deliberada: serializa los starts de la misma sala.
    """
    data, guard_error = _guard_post(request, "start")
    if guard_error is not None:
        return guard_error
    session = _get_session(room_id)

    # D431: verificar que quien arranca es realmente el host (token)
    player_id, error = _require_host(request, data, session, "start")
    if error is not None:
        return error

    with transaction.atomic():
        session = _for_update(session)
        # Escritura temprana: en WAL la transacción nace como lectura con
        # un snapshot; si el primer write se aplaza hasta session.save
        # (después de la llamada HTTP al runner), cualquier escritura
        # concurrente —p. ej. mark_player_connected de un socket— convierte
        # el UPDATE en SQLITE_BUSY_SNAPSHOT, que el busy_timeout NO
        # reintenta («database is locked»). Escribir primero toma el write
        # lock y convierte el conflicto en un BUSY reintentable.
        _bump_revision(session)
        if session.host_id != player_id:
            return JsonResponse({"error": "Only the host can start"}, status=403)
        if session.status != "WAITING":
            return JsonResponse({"error": "Room is not open"}, status=403)
        players = list(session.players.order_by("joined_at"))
        if not players:
            return JsonResponse({"error": "Not enough players"}, status=403)
        # Todos los invitados deben estar preparados; el host lo está
        # implícitamente al pulsar Iniciar.
        if any(not p.is_host and not p.is_ready for p in players):
            return JsonResponse({"error": "Not all players are ready"}, status=409)
        # Cada miembro debe tener héroe y mazo declarados — el roster del
        # motor se construye con todos los jugadores unidos; un invitado
        # sin héroe quedaría dentro de la sala pero incapaz de actuar.
        if any(not p.hero_id or not p.deck_id for p in players):
            return JsonResponse({"error": "All players must choose a hero"}, status=409)

        # Reconstruir la sala del motor con el roster completo: en create
        # solo viajaban los héroes del host; los invitados eligen al
        # entrar. Si el runner falla, la sala sigue en WAITING en vez de
        # arrancar con un roster incompleto.
        if not _recreate_engine_room(session, room_id, players):
            return JsonResponse({"error": "Engine runner unavailable"}, status=503)

        session.status = "PLAYING"
        session.save(update_fields=["status", "updated_at"])

    # Con el socket del lobby abierto el polling está apagado: sin este
    # broadcast el invitado nunca ve PLAYING ni el botón «Ir a la partida».
    _broadcast_room(
        room_id,
        {"type": "room.started", "roomRevision": session.revision},
    )
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
    session = _get_session(room_id)

    player_id, error = _require_host(request, data, session, "close the room")
    if error is not None:
        return error

    # Persistir la revisión final: broadcast de un revision+1 sin guardar
    # colisionaba con el siguiente bump real.
    with transaction.atomic():
        session = _for_update(session)
        # Re-check del host bajo lock ANTES de mark_finished: un
        # transfer_host concurrente no debe dejar al antiguo host abortar
        # la partida con su lectura stale (mark_finished es irreversible:
        # stats contabilizadas + broadcast room.finished).
        if session.host_id != player_id:
            return JsonResponse({"error": "Only the host can close the room"}, status=403)
        # Cerrar una sala PLAYING es abortar la partida: registrar el fin
        # (GAME_ENDED sin ganador + estadísticas + snapshot) antes de borrar.
        # Sin esto, el host podía destruir la partida a mitad y las
        # estadísticas nunca se contabilizaban.
        if session.status == "PLAYING":
            mark_finished(session, None)
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
