"""Tests básicos para el backend de juego."""

import json
from unittest import SkipTest
from unittest.mock import patch

import httpx  # noqa: ASYNC127 - httpx sigue mantenido; la sugerencia httpx2 es errónea
from django.test import Client, TestCase, override_settings

from .models import CommunityStat, GameEvent, GameSession, Player


def _ws_ticket_url(room_id: str, player_id: str) -> str:
    """URL de conexión WS con ticket efímero de un solo uso.

    La ruta legada ?playerId&token se retiró (token de larga vida en
    URLs/logs); los tests emiten el ticket directamente.
    """
    from .views import _issue_ws_ticket

    return f"/ws/game/{room_id}/?ticket={_issue_ws_ticket(room_id, player_id)}"


# Tipos de broadcast de presencia emitidos por el consumer al conectar/
# desconectar un socket de jugador. Los tests que esperan otro mensaje
# concreto deben saltarlos (llegan intercalados con connected/chat/etc.).
_WS_PRESENCE_TYPES = {"room.player_connected", "room.player_disconnected"}


async def _ws_next_non_presence(comm, timeout: float = 3) -> dict:
    """Lee hasta el próximo mensaje que no sea de presencia."""
    while True:
        msg = await comm.receive_json_from(timeout=timeout)
        if msg.get("type") not in _WS_PRESENCE_TYPES:
            return msg


@override_settings(ROOM_RATE_LIMIT_MAX=10000)
class RoomApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        # El rate limit por IP es un bucket global del proceso: entre tests
        # se acumularían peticiones y darían 429 espurios.
        from django.core.cache import cache

        cache.clear()  # rl:*, wst:*, spec:*, cmid:* — estado compartido

    def test_health_check(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    @patch("game.views.EngineRunnerClient.create_room")
    def test_create_room(self, mock_create):
        mock_create.return_value = {"ok": True}
        response = self.client.post(
            "/api/rooms/",
            data=json.dumps(
                {
                    "mode": "STANDARD",
                    "maxPlayers": 2,
                    "hostId": "h1",
                    "hostName": "Ana",
                    "heroes": [
                        {
                            "playerId": "p1",
                            "heroId": "hero.aranel",
                            "heroFace": "FEMALE",
                            "deckId": "explorer.default",
                        }
                    ],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("roomId", data)
        self.assertEqual(data["status"], "created")

    @patch("game.views.EngineRunnerClient.create_room")
    def test_create_room_csrf_exempt(self, mock_create):
        """Regresión: create_room debe ser csrf_exempt.

        El SPA no envía token CSRF y sin el decorador la creación de
        salas devolvía 403.
        """
        from django.test import Client

        mock_create.return_value = {"ok": True}
        client = Client(enforce_csrf_checks=True)
        response = client.post(
            "/api/rooms/",
            data=json.dumps(
                {
                    "mode": "STANDARD",
                    "maxPlayers": 2,
                    "hostId": "h1",
                    "hostName": "Ana",
                    "heroes": [
                        {
                            "playerId": "p1",
                            "heroId": "hero.aranel",
                            "heroFace": "FEMALE",
                            "deckId": "explorer.default",
                        }
                    ],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

    @patch("game.views.EngineRunnerClient.create_room")
    def test_create_room_engine_down_returns_503(self, mock_create):
        """Fail-closed: sin motor no se crea la sala (evita desync)."""
        mock_create.side_effect = httpx.ConnectError("Connection refused")
        response = self.client.post(
            "/api/rooms/",
            data=json.dumps(
                {
                    "mode": "STANDARD",
                    "maxPlayers": 2,
                    "hostId": "h1",
                    "heroes": [
                        {"playerId": "p1", "heroId": "hero.aranel", "heroFace": "FEMALE", "deckId": "explorer.default"}
                    ],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 503)
        self.assertFalse(GameSession.objects.exists())

    @patch("game.views.EngineRunnerClient.create_room")
    def test_create_room_no_heroes(self, mock_create):
        """Sin héroes el runner rechazaría (Zod min 1) — validar antes."""
        response = self.client.post(
            "/api/rooms/",
            data=json.dumps({"mode": "STANDARD", "maxPlayers": 2, "hostId": "h1", "heroes": []}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        mock_create.assert_not_called()

    def test_seed_not_exposed(self):
        """La seed del RNG nunca sale del servidor."""
        session = GameSession.objects.create(room_id="SEED01", mode="STANDARD", seed="top-secret", host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        response = self.client.get("/api/rooms/SEED01/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("seed", response.json())
        self.assertNotIn("top-secret", response.content.decode())

    @patch("game.views.EngineRunnerClient.delete_room")
    def test_leave_last_player_closes_room(self, mock_delete):
        """Sala WAITING vacía se limpia también en el runner."""
        session = GameSession.objects.create(room_id="CLOSE01", mode="STANDARD", max_players=2, host_id="h1")
        player = Player.objects.create(session=session, player_id="p1", name="Ana", is_connected=True)
        response = self.client.post(
            "/api/rooms/CLOSE01/leave/",
            data=json.dumps({"playerId": "p1", "playerToken": player.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get("roomClosed"))
        mock_delete.assert_called_once_with("CLOSE01")
        self.assertFalse(GameSession.objects.filter(room_id="CLOSE01").exists())

    def test_leave_requires_player_id(self):
        GameSession.objects.create(room_id="LEAVE01", mode="STANDARD", max_players=2, host_id="h1")
        response = self.client.post(
            "/api/rooms/LEAVE01/leave/",
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_room_method_not_allowed(self):
        response = self.client.get("/api/rooms/")
        self.assertEqual(response.status_code, 405)

    def test_join_room(self):
        session = GameSession.objects.create(room_id="TEST01", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)

        response = self.client.post(
            "/api/rooms/TEST01/join/",
            data=json.dumps({"playerId": "p2", "name": "Ben"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["joined"])

    def test_join_room_full(self):
        session = GameSession.objects.create(room_id="TEST02", mode="STANDARD", max_players=1, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)

        response = self.client.post(
            "/api/rooms/TEST02/join/",
            data=json.dumps({"playerId": "p2", "name": "Ben"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_join_room_not_waiting(self):
        session = GameSession.objects.create(
            room_id="TEST03", mode="STANDARD", max_players=2, host_id="h1", status="PLAYING"
        )
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)

        response = self.client.post(
            "/api/rooms/TEST03/join/",
            data=json.dumps({"playerId": "p2", "name": "Ben"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_room_state(self):
        session = GameSession.objects.create(room_id="TEST04", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)

        response = self.client.get("/api/rooms/TEST04/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["roomId"], "TEST04")
        self.assertEqual(len(data["players"]), 1)

    def test_list_rooms(self):
        GameSession.objects.create(room_id="TEST05", mode="STANDARD", max_players=2, host_id="h1", status="WAITING")
        GameSession.objects.create(room_id="TEST06", mode="STANDARD", max_players=2, host_id="h2", status="PLAYING")
        GameSession.objects.create(room_id="TEST06B", mode="STANDARD", max_players=2, host_id="h3", status="FINISHED")
        response = self.client.get("/api/rooms/list/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        # WAITING + PLAYING (el rejoin necesita ver partidas en curso);
        # FINISHED nunca aparece.
        room_ids = [r["roomId"] for r in data["rooms"]]
        self.assertIn("TEST05", room_ids)
        self.assertIn("TEST06", room_ids)
        self.assertNotIn("TEST06B", room_ids)

    def test_start_room_not_host(self):
        session = GameSession.objects.create(room_id="TEST07", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)

        response = self.client.post(
            "/api/rooms/TEST07/start/",
            data=json.dumps({"playerId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    @patch("game.views.EngineRunnerClient.delete_room")
    @patch("game.views.EngineRunnerClient.create_room")
    def test_start_room_host(self, mock_create, mock_delete):
        session = GameSession.objects.create(room_id="TEST08", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(
            session=session,
            player_id="h1",
            name="Ana",
            is_host=True,
            hero_id="hero.aranel",
            deck_id="explorer.default",
            hero_face="FEMALE",
        )

        response = self.client.post(
            "/api/rooms/TEST08/start/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["started"])
        self.assertEqual(data["room"]["status"], "PLAYING")
        # La sala del motor se reconstruye con el roster completo
        mock_delete.assert_called_once_with("TEST08")
        mock_create.assert_called_once()

    @patch("game.views.EngineRunnerClient.delete_room")
    @patch("game.views.EngineRunnerClient.create_room")
    def test_start_room_multiclass_preserves_second_deck_and_age(self, mock_create, mock_delete):
        """Multiclase: secondDeckId/playerAge sobreviven create → persist → recreate.

        Auditoría: el modelo Player no persistía esos campos y el roster
        recreado en start_room los perdía — el motor arrancaba el modo
        MULTICLASS sin segunda baraja (degradación silenciosa).
        """
        mock_create.return_value = {"ok": True}
        response = self.client.post(
            "/api/rooms/",
            data=json.dumps(
                {
                    "mode": "MULTICLASS",
                    "maxPlayers": 2,
                    "hostId": "h1",
                    "hostName": "Ana",
                    "heroes": [
                        {
                            "playerId": "h1",
                            "heroId": "hero.aranel",
                            "heroFace": "FEMALE",
                            "deckId": "explorer.default",
                            "secondDeckId": "warrior.default",
                            "playerAge": 34,
                        }
                    ],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        room_id = response.json()["roomId"]
        host_token = response.json()["hostToken"]
        host = Player.objects.get(session__room_id=room_id, player_id="h1")
        self.assertEqual(host.second_deck_id, "warrior.default")
        self.assertEqual(host.player_age, 34)

        # El invitado declara su segunda baraja al entrar
        join = self.client.post(
            f"/api/rooms/{room_id}/join/",
            data=json.dumps(
                {
                    "playerId": "p2",
                    "name": "Beto",
                    "heroId": "hero.beleth",
                    "heroFace": "MALE",
                    "deckId": "mage.default",
                    "secondDeckId": "rogue.default",
                    "playerAge": 51,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(join.status_code, 200)
        guest = Player.objects.get(session__room_id=room_id, player_id="p2")
        self.assertEqual(guest.second_deck_id, "rogue.default")
        self.assertEqual(guest.player_age, 51)

        # Marcar listo y arrancar: el recreate del runner debe llevar el
        # roster completo, segunda baraja y edad incluidas.
        self.client.post(
            f"/api/rooms/{room_id}/ready/",
            data=json.dumps({"playerId": "p2", "playerToken": guest.auth_token, "ready": True}),
            content_type="application/json",
        )
        mock_create.reset_mock()
        start = self.client.post(
            f"/api/rooms/{room_id}/start/",
            data=json.dumps({"playerId": "h1", "playerToken": host_token}),
            content_type="application/json",
        )
        self.assertEqual(start.status_code, 200)
        mock_create.assert_called_once()
        heroes = mock_create.call_args[0][1]["heroes"]
        by_id = {h["playerId"]: h for h in heroes}
        self.assertEqual(by_id["h1"]["secondDeckId"], "warrior.default")
        self.assertEqual(by_id["h1"]["playerAge"], 34)
        self.assertEqual(by_id["p2"]["secondDeckId"], "rogue.default")
        self.assertEqual(by_id["p2"]["playerAge"], 51)

    @patch("game.views.EngineRunnerClient.create_room")
    def test_create_room_rejects_invalid_player_age(self, mock_create):
        mock_create.return_value = {"ok": True}
        for bad_age in ("treinta", -1, 999, True):
            response = self.client.post(
                "/api/rooms/",
                data=json.dumps(
                    {
                        "mode": "MULTICLASS",
                        "maxPlayers": 2,
                        "hostId": "h1",
                        "heroes": [
                            {
                                "playerId": "h1",
                                "heroId": "hero.aranel",
                                "heroFace": "FEMALE",
                                "deckId": "explorer.default",
                                "playerAge": bad_age,
                            }
                        ],
                    }
                ),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 400, f"playerAge={bad_age!r} debería dar 400")

    def test_start_room_host_wrong_token(self):
        """D431: el host sin token válido no puede arrancar la partida."""
        session = GameSession.objects.create(room_id="TEST08B", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)

        response = self.client.post(
            "/api/rooms/TEST08B/start/",
            data=json.dumps({"playerId": "h1", "playerToken": "wrong"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_leave_room(self):
        session = GameSession.objects.create(room_id="TEST09", mode="STANDARD", max_players=2, host_id="h1")
        player = Player.objects.create(session=session, player_id="p2", name="Ben")

        response = self.client.post(
            "/api/rooms/TEST09/leave/",
            data=json.dumps({"playerId": "p2", "playerToken": player.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["left"])

    def test_leave_room_wrong_token(self):
        """D431: no se puede expulsar a otro jugador sin su token (ni sin ser host)."""
        session = GameSession.objects.create(room_id="TEST09B", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="p2", name="Ben")

        response = self.client.post(
            "/api/rooms/TEST09B/leave/",
            data=json.dumps({"playerId": "p2", "playerToken": "wrong"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_join_room_returns_token_and_rejoin_requires_it(self):
        """D431: join devuelve authToken; re-join exige el mismo token."""
        session = GameSession.objects.create(room_id="TEST01B", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)

        response = self.client.post(
            "/api/rooms/TEST01B/join/",
            data=json.dumps({"playerId": "p2", "name": "Ben"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        token = response.json().get("authToken")
        self.assertTrue(token)

        # Re-join con token correcto funciona
        response = self.client.post(
            "/api/rooms/TEST01B/join/",
            data=json.dumps({"playerId": "p2", "name": "Ben", "playerToken": token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

        # Re-join con token incorrecto es rechazado (no suplantación)
        response = self.client.post(
            "/api/rooms/TEST01B/join/",
            data=json.dumps({"playerId": "p2", "name": "Mallory", "playerToken": "wrong"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    @patch("game.views.EngineRunnerClient.get_state")
    def test_room_engine_state_requires_token_for_player_view(self, mock_get_state):
        """D431: la vista proyectada de un jugador exige su token (anti-IDOR)."""
        session = GameSession.objects.create(room_id="TEST10B", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)

        response = self.client.get("/api/rooms/TEST10B/engine/?playerId=h1")
        self.assertEqual(response.status_code, 403)
        mock_get_state.assert_not_called()

    @patch("game.views.EngineRunnerClient.get_state")
    def test_room_engine_state(self, mock_get_state):
        mock_get_state.return_value = {"state": {"phase": "PLAYER_ATTACK", "turnNumber": 1}}
        GameSession.objects.create(room_id="TEST10", mode="STANDARD", max_players=2, host_id="h1")
        response = self.client.get("/api/rooms/TEST10/engine/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["state"]["phase"], "PLAYER_ATTACK")

    @patch("game.views.EngineRunnerClient.get_state")
    def test_room_engine_state_unavailable(self, mock_get_state):
        mock_get_state.side_effect = httpx.ConnectError("Connection refused")
        GameSession.objects.create(room_id="TEST11", mode="STANDARD", max_players=2, host_id="h1")
        response = self.client.get("/api/rooms/TEST11/engine/")
        self.assertEqual(response.status_code, 503)

    # --- Preparado (is_ready) ---

    def test_set_ready_and_unready(self):
        """El jugador autenticado alterna su estado de preparado."""
        session = GameSession.objects.create(room_id="TESTR1", mode="STANDARD", max_players=2, host_id="h1")
        player = Player.objects.create(session=session, player_id="p2", name="Ben")

        response = self.client.post(
            "/api/rooms/TESTR1/ready/",
            data=json.dumps({"playerId": "p2", "playerToken": player.auth_token, "ready": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ready"])
        player.refresh_from_db()
        self.assertTrue(player.is_ready)

        response = self.client.post(
            "/api/rooms/TESTR1/ready/",
            data=json.dumps({"playerId": "p2", "playerToken": player.auth_token, "ready": False}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        player.refresh_from_db()
        self.assertFalse(player.is_ready)

    def test_set_ready_wrong_token(self):
        session = GameSession.objects.create(room_id="TESTR2", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="p2", name="Ben")
        response = self.client.post(
            "/api/rooms/TESTR2/ready/",
            data=json.dumps({"playerId": "p2", "playerToken": "wrong", "ready": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    @patch("game.views.EngineRunnerClient.delete_room")
    @patch("game.views.EngineRunnerClient.create_room")
    def test_start_blocked_until_guests_ready(self, mock_create, mock_delete):
        """El host no puede iniciar con invitados sin preparar (409)."""
        session = GameSession.objects.create(room_id="TESTR3", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(
            session=session,
            player_id="h1",
            name="Ana",
            is_host=True,
            hero_id="hero.aranel",
            deck_id="explorer.default",
            hero_face="FEMALE",
        )
        guest = Player.objects.create(
            session=session,
            player_id="p2",
            name="Ben",
            hero_id="hero.feldon",
            deck_id="warrior.default",
            hero_face="MALE",
        )

        response = self.client.post(
            "/api/rooms/TESTR3/start/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)

        # Una vez preparado el invitado, el host puede iniciar — y el
        # motor se recrea con ambos héroes.
        guest.is_ready = True
        guest.save()
        response = self.client.post(
            "/api/rooms/TESTR3/start/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["started"])
        cfg = mock_create.call_args[0][1]
        hero_pids = {h["playerId"] for h in cfg["heroes"]}
        self.assertEqual(hero_pids, {"h1", "p2"})

    # --- Expulsar jugador (kick) ---

    def test_kick_player_by_host(self):
        """El host autenticado expulsa a un invitado y desaparece del roster."""
        session = GameSession.objects.create(room_id="TESTK1", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben")

        response = self.client.post(
            "/api/rooms/TESTK1/kick/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["kicked"])
        self.assertFalse(Player.objects.filter(session=session, player_id="p2").exists())

    def test_kick_requires_host_token(self):
        """Ni un invitado ni un host sin token pueden expulsar."""
        session = GameSession.objects.create(room_id="TESTK2", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        guest = Player.objects.create(session=session, player_id="p2", name="Ben")

        # Invitado intenta expulsar a otro
        response = self.client.post(
            "/api/rooms/TESTK2/kick/",
            data=json.dumps({"playerId": "p2", "playerToken": guest.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

        # Host con token incorrecto
        response = self.client.post(
            "/api/rooms/TESTK2/kick/",
            data=json.dumps({"playerId": "h1", "playerToken": "wrong", "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Player.objects.filter(session=session, player_id="p2").exists())

    def test_kick_cannot_target_host(self):
        session = GameSession.objects.create(room_id="TESTK3", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        response = self.client.post(
            "/api/rooms/TESTK3/kick/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "h1"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_kick_not_allowed_once_started(self):
        """Una sala PLAYING no admite expulsiones (política explícita)."""
        session = GameSession.objects.create(
            room_id="TESTK4", mode="STANDARD", max_players=2, host_id="h1", status="PLAYING"
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben")
        response = self.client.post(
            "/api/rooms/TESTK4/kick/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Player.objects.filter(session=session, player_id="p2").exists())

    def test_kicked_player_cannot_rejoin_or_ready(self):
        """El expulsado queda vetado: re-join 403, ready 403, token inservible."""
        session = GameSession.objects.create(room_id="TESTK5", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        guest = Player.objects.create(session=session, player_id="p2", name="Ben")
        old_token = guest.auth_token

        response = self.client.post(
            "/api/rooms/TESTK5/kick/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        self.assertIn("p2", session.kicked_ids)

        # Re-join con el mismo playerId: vetado aunque el token fuera válido
        response = self.client.post(
            "/api/rooms/TESTK5/join/",
            data=json.dumps({"playerId": "p2", "playerToken": old_token, "name": "Ben"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(response.json().get("kicked"))

        # Ready con el token revocado: la fila ya no existe
        response = self.client.post(
            "/api/rooms/TESTK5/ready/",
            data=json.dumps({"playerId": "p2", "playerToken": old_token, "ready": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

        # Leave con el token revocado
        response = self.client.post(
            "/api/rooms/TESTK5/leave/",
            data=json.dumps({"playerId": "p2", "playerToken": old_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

        # El host sigue intacto y el jugador no resucita
        self.assertFalse(Player.objects.filter(session=session, player_id="p2").exists())
        self.assertTrue(Player.objects.filter(session=session, player_id="h1").exists())

    # --- D440: revocación y carreras de expulsión ---

    def test_kicked_player_cannot_rejoin(self):
        """D440: el expulsado no puede re-unirse ni con su antiguo token."""
        session = GameSession.objects.create(room_id="TESTV1", mode="STANDARD", max_players=3, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        guest = Player.objects.create(session=session, player_id="p2", name="Ben")
        old_token = guest.auth_token

        self.client.post(
            "/api/rooms/TESTV1/kick/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        # Re-join con playerId vetado: 403 explícito aunque traiga el token
        response = self.client.post(
            "/api/rooms/TESTV1/join/",
            data=json.dumps({"playerId": "p2", "name": "Ben", "playerToken": old_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(response.json().get("kicked"))
        self.assertFalse(Player.objects.filter(session=session, player_id="p2").exists())

    def test_kicked_player_token_dead_for_ready(self):
        """D440: un ready tardío del expulsado no resucita su fila (kick+ready)."""
        session = GameSession.objects.create(room_id="TESTV2", mode="STANDARD", max_players=3, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        guest = Player.objects.create(session=session, player_id="p2", name="Ben")
        old_token = guest.auth_token

        self.client.post(
            "/api/rooms/TESTV2/kick/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        # Ready tardío: la fila ya no existe -> 403, no reaparece
        response = self.client.post(
            "/api/rooms/TESTV2/ready/",
            data=json.dumps({"playerId": "p2", "playerToken": old_token, "ready": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Player.objects.filter(session=session, player_id="p2").exists())

    def test_kick_twice_is_controlled_error(self):
        """Doble expulsión: la segunda devuelve 404 controlado, sin efectos."""
        session = GameSession.objects.create(room_id="TESTV3", mode="STANDARD", max_players=3, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben")

        for expected in (200, 404):
            response = self.client.post(
                "/api/rooms/TESTV3/kick/",
                data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, expected)

    def test_kick_blocked_once_playing(self):
        """Kick + start: una vez PLAYING el endpoint de lobby no expulsa."""
        session = GameSession.objects.create(
            room_id="TESTV4", mode="STANDARD", max_players=3, host_id="h1", status="PLAYING"
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben")

        response = self.client.post(
            "/api/rooms/TESTV4/kick/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Player.objects.filter(session=session, player_id="p2").exists())

    def test_room_revision_increments_on_mutations(self):
        """Anti-stale: cada mutación de sala incrementa la revisión."""
        session = GameSession.objects.create(room_id="TESTV5", mode="STANDARD", max_players=3, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        guest = Player.objects.create(session=session, player_id="p2", name="Ben")
        self.assertEqual(session.revision, 0)

        r = self.client.post(
            "/api/rooms/TESTV5/ready/",
            data=json.dumps({"playerId": "p2", "playerToken": guest.auth_token, "ready": True}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["room"]["revision"], 1)

        r = self.client.post(
            "/api/rooms/TESTV5/kick/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["room"]["revision"], 2)

    # --- Chat WebSocket: servidor asigna identidad/orden (D431) ---

    def test_ws_chat_server_assigns_sender_seq_and_dedupes(self):
        """El servidor asigna sender, timestamp y seq.

        El cliente solo envía texto+clientMessageId; un cmid duplicado
        no se redifunde.
        """
        try:
            from asgiref.sync import async_to_sync
            from channels.routing import URLRouter
            from channels.testing import WebsocketCommunicator

            from game.routing import websocket_urlpatterns

            application = URLRouter(websocket_urlpatterns)  # sin AllowedHostsOriginValidator
        except ImportError:
            self.skipTest("channels.testing no disponible")

        session = GameSession.objects.create(room_id="WSCHAT1", mode="STANDARD", max_players=2, host_id="p1")
        Player.objects.create(session=session, player_id="p1", name="Ana", is_host=True)

        async def flow():
            comm = WebsocketCommunicator(
                application,
                _ws_ticket_url("WSCHAT1", "p1"),
            )
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()  # 'connected'
            # El cliente intenta falsificar sender y timestamp
            await comm.send_json_to(
                {
                    "type": "chat.message",
                    "text": "hola",
                    "sender": "mallory",
                    "timestamp": 1,
                    "clientMessageId": "c1",
                }
            )
            msg = await _ws_next_non_presence(comm)
            self.assertEqual(msg["sender"], "p1")  # no 'mallory'
            self.assertNotEqual(msg["timestamp"], 1)
            self.assertIsNotNone(msg.get("seq"))
            self.assertEqual(msg["clientMessageId"], "c1")
            # cmid duplicado → no se redifunde
            await comm.send_json_to(
                {
                    "type": "chat.message",
                    "text": "dup",
                    "clientMessageId": "c1",
                }
            )
            nothing = await comm.receive_nothing(timeout=0.4)
            self.assertTrue(nothing)
            await comm.disconnect()

        async_to_sync(flow)()

    def test_ws_chat_ping_meta_whitelisted(self):
        """meta.kind='ping' se reenvía; otros campos meta se descartan."""
        try:
            from asgiref.sync import async_to_sync
            from channels.routing import URLRouter
            from channels.testing import WebsocketCommunicator

            from game.routing import websocket_urlpatterns

            application = URLRouter(websocket_urlpatterns)
        except ImportError:
            self.skipTest("channels.testing no disponible")

        session = GameSession.objects.create(room_id="WSPING", mode="STANDARD", max_players=2, host_id="p1")
        Player.objects.create(session=session, player_id="p1", name="Ana", is_host=True)

        async def flow():
            comm = WebsocketCommunicator(
                application,
                _ws_ticket_url("WSPING", "p1"),
            )
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()  # 'connected'
            # Ping con objetivo: kind+target pasan; 'evil' se descarta
            await comm.send_json_to(
                {
                    "type": "chat.message",
                    "text": "🎯 Atacad al más fuerte",
                    "meta": {"kind": "ping", "target": "Gurdrug", "evil": "<script>"},
                }
            )
            msg = await _ws_next_non_presence(comm)
            self.assertEqual(msg["meta"], {"kind": "ping", "target": "Gurdrug"})
            self.assertNotIn("evil", msg["meta"])
            # meta desconocida no viaja
            await comm.send_json_to({"type": "chat.message", "text": "normal", "meta": {"kind": "xss"}})
            msg2 = await _ws_next_non_presence(comm)
            self.assertNotIn("meta", msg2)
            await comm.disconnect()

        async_to_sync(flow)()

    def test_ws_rejects_invalid_token(self):
        try:
            from asgiref.sync import async_to_sync
            from channels.routing import URLRouter
            from channels.testing import WebsocketCommunicator

            from game.routing import websocket_urlpatterns

            application = URLRouter(websocket_urlpatterns)  # sin AllowedHostsOriginValidator
        except ImportError:
            self.skipTest("channels.testing no disponible")

        session = GameSession.objects.create(room_id="WSAUTH", mode="STANDARD", max_players=2, host_id="p1")
        Player.objects.create(session=session, player_id="p1", name="Ana")

        async def flow():
            # La ruta legada ?playerId&token se retiró: sin ticket válido
            # la conexión se rechaza con 4403.
            comm = WebsocketCommunicator(application, "/ws/game/WSAUTH/?ticket=invalid")
            connected, _ = await comm.connect()
            self.assertFalse(connected)
            await comm.disconnect()

        async_to_sync(flow)()

    # --- Transferir anfitrión (transfer_host) ---

    def test_transfer_host_by_host(self):
        """El host cede el anfitrión a un invitado conectado."""
        session = GameSession.objects.create(room_id="TESTT1", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben", is_connected=True)

        response = self.client.post(
            "/api/rooms/TESTT1/transfer-host/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["transferred"])
        session.refresh_from_db()
        self.assertEqual(session.host_id, "p2")
        self.assertTrue(Player.objects.get(session=session, player_id="p2").is_host)
        self.assertFalse(Player.objects.get(session=session, player_id="h1").is_host)

    def test_transfer_requires_host(self):
        """Ni invitados ni hosts sin token pueden transferir."""
        session = GameSession.objects.create(room_id="TESTT2", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        guest = Player.objects.create(session=session, player_id="p2", name="Ben", is_connected=True)

        response = self.client.post(
            "/api/rooms/TESTT2/transfer-host/",
            data=json.dumps({"playerId": "p2", "playerToken": guest.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

        response = self.client.post(
            "/api/rooms/TESTT2/transfer-host/",
            data=json.dumps({"playerId": "h1", "playerToken": "wrong", "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        session.refresh_from_db()
        self.assertEqual(session.host_id, "h1")

    def test_transfer_to_disconnected_fails(self):
        """No se transfiere el anfitrión a un jugador desconectado."""
        session = GameSession.objects.create(room_id="TESTT3", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben", is_connected=False)

        response = self.client.post(
            "/api/rooms/TESTT3/transfer-host/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)
        session.refresh_from_db()
        self.assertEqual(session.host_id, "h1")

    def test_transfer_not_allowed_once_started(self):
        """Solo en WAITING: una partida en curso no cambia de host."""
        session = GameSession.objects.create(
            room_id="TESTT4", mode="STANDARD", max_players=2, host_id="h1", status="PLAYING"
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben", is_connected=True)

        response = self.client.post(
            "/api/rooms/TESTT4/transfer-host/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    # --- Cerrar sala (close_room) ---

    def test_close_room_by_host(self):
        """El host cierra la sala: se borra la sesión y todos los jugadores."""
        session = GameSession.objects.create(room_id="TESTC1", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben")

        response = self.client.post(
            "/api/rooms/TESTC1/close/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["closed"])
        self.assertFalse(GameSession.objects.filter(room_id="TESTC1").exists())
        self.assertFalse(Player.objects.filter(player_id="p2").exists())

    def test_close_requires_host(self):
        """Un invitado no puede cerrar la sala."""
        session = GameSession.objects.create(room_id="TESTC2", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        guest = Player.objects.create(session=session, player_id="p2", name="Ben")

        response = self.client.post(
            "/api/rooms/TESTC2/close/",
            data=json.dumps({"playerId": "p2", "playerToken": guest.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(GameSession.objects.filter(room_id="TESTC2").exists())

    # --- Clasificación pública opt-in ---

    def test_leaderboard_post_and_get(self):
        """POST suma partida/victoria; GET devuelve ordenado por wins."""
        self.client.post(
            "/api/stats/leaderboard/",
            data=json.dumps({"name": "Ana", "won": True}),
            content_type="application/json",
        )
        self.client.post(
            "/api/stats/leaderboard/",
            data=json.dumps({"name": "Ana", "won": False}),
            content_type="application/json",
        )
        self.client.post(
            "/api/stats/leaderboard/",
            data=json.dumps({"name": "Ben", "won": True}),
            content_type="application/json",
        )
        response = self.client.get("/api/stats/leaderboard/")
        self.assertEqual(response.status_code, 200)
        entries = response.json()["entries"]
        self.assertEqual(len(entries), 2)
        # Orden: wins desc (ambos 1) → games desc → Ana(2) antes que Ben(1)
        self.assertEqual(entries[0]["name"], "Ana")
        self.assertEqual(entries[0]["wins"], 1)
        self.assertEqual(entries[0]["games"], 2)

    def test_leaderboard_requires_name(self):
        response = self.client.post(
            "/api/stats/leaderboard/",
            data=json.dumps({"name": "", "won": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    # --- Skip AFK (turno forzado por el host) ---

    def test_skip_turn_requires_host(self):
        """Un invitado no puede forzar el fin del turno."""
        session = GameSession.objects.create(
            room_id="SKIP01",
            mode="STANDARD",
            max_players=2,
            host_id="h1",
            status="PLAYING",
        )
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        guest = Player.objects.create(session=session, player_id="p2", name="Ben")
        response = self.client.post(
            "/api/rooms/SKIP01/skip-turn/",
            data=json.dumps({"playerId": "p2", "playerToken": guest.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_skip_turn_requires_playing(self):
        """No se puede saltar el turno de una sala en lobby."""
        session = GameSession.objects.create(
            room_id="SKIP02",
            mode="STANDARD",
            max_players=2,
            host_id="h1",
            status="WAITING",
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        response = self.client.post(
            "/api/rooms/SKIP02/skip-turn/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)

    @patch("game.views.EngineRunnerClient.execute_command")
    @patch("game.views.EngineRunnerClient.get_state")
    def test_skip_turn_executes_end_turn_for_active(self, mock_state, mock_cmd):
        """El host fuerza END_TURN del jugador activo (AFK)."""
        mock_state.return_value = {"state": {"activePlayerId": "p2"}}
        mock_cmd.return_value = {"accepted": True}
        session = GameSession.objects.create(
            room_id="SKIP03",
            mode="STANDARD",
            max_players=2,
            host_id="h1",
            status="PLAYING",
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        response = self.client.post(
            "/api/rooms/SKIP03/skip-turn/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["skipped"])
        # El comando se inyecta como el jugador ACTIVO, no como el host
        self.assertEqual(mock_cmd.call_args.kwargs["player_id"], "p2")
        sent = mock_cmd.call_args.kwargs
        # El CommandSchema del runner exige cid dentro del command y que
        # coincida con el del envelope — antes iba sin cid y todo
        # skip_turn contra un runner real era un 400.
        self.assertEqual(sent["command"]["type"], "END_TURN")
        self.assertEqual(sent["command"]["cid"], sent["cid"])
        self.assertTrue(sent["cid"].startswith("skip-"))

    @patch("game.views.EngineRunnerClient.execute_command")
    @patch("game.views.EngineRunnerClient.get_state")
    def test_skip_turn_rejected_by_engine(self, mock_state, mock_cmd):
        """Si el runner rechaza END_TURN, se informa sin tocar nada."""
        mock_state.return_value = {"state": {"activePlayerId": "p2"}}
        mock_cmd.return_value = {"accepted": False, "reason": "not your turn"}
        session = GameSession.objects.create(
            room_id="SKIP04",
            mode="STANDARD",
            max_players=2,
            host_id="h1",
            status="PLAYING",
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        response = self.client.post(
            "/api/rooms/SKIP04/skip-turn/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.json()["skipped"])

    @patch("game.views.EngineRunnerClient.execute_command")
    @patch("game.views.players.restore_room_from_snapshot")
    @patch("game.views.EngineRunnerClient.get_state")
    def test_skip_turn_restores_missing_runner_room(self, mock_state, mock_restore, mock_cmd):
        """Sala zombi: un 404 del runner resucita desde el snapshot y reintenta.

        Auditoría: skip_turn era el único flujo sin restauración — una sala
        PLAYING sin motor respondía 502 para siempre aunque hubiera snapshot.
        """
        req = httpx.Request("GET", "http://runner/rooms/SKIP05/state")
        not_found = httpx.HTTPStatusError("404", request=req, response=httpx.Response(404, request=req))
        # Primer get_state → 404; tras el restore, el reintento funciona
        mock_state.side_effect = [not_found, {"state": {"activePlayerId": "p2"}}]
        mock_restore.return_value = True
        mock_cmd.return_value = {"accepted": True}
        session = GameSession.objects.create(
            room_id="SKIP05",
            mode="STANDARD",
            max_players=2,
            host_id="h1",
            status="PLAYING",
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        response = self.client.post(
            "/api/rooms/SKIP05/skip-turn/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["skipped"])
        mock_restore.assert_called_once_with("SKIP05")
        self.assertEqual(mock_state.call_count, 2)
        mock_cmd.assert_called_once()

    @patch("game.views.EngineRunnerClient.execute_command")
    @patch("game.views.EngineRunnerClient.get_state")
    def test_skip_turn_game_ended_closes_room(self, mock_state, mock_cmd):
        """Auditoría: el path REST cierra la sesión si END_TURN termina la partida.

        Debe cerrar la sesión igual que el consumer WS — antes el
        GAME_ENDED se descartaba y la sala quedaba PLAYING zombi.
        """
        mock_state.return_value = {"state": {"activePlayerId": "p2"}}
        mock_cmd.return_value = {
            "accepted": True,
            "events": [{"type": "GAME_ENDED", "winnerId": "p2"}],
        }
        session = GameSession.objects.create(
            room_id="SKIP06",
            mode="STANDARD",
            max_players=2,
            host_id="h1",
            status="PLAYING",
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Bob")
        response = self.client.post(
            "/api/rooms/SKIP06/skip-turn/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["skipped"])
        self.assertTrue(response.json()["gameEnded"])
        session.refresh_from_db()
        self.assertEqual(session.status, "FINISHED")
        self.assertTrue(GameEvent.objects.filter(session=session, event_type="GAME_ENDED").exists())

    @patch("game.views.EngineRunnerClient.execute_command")
    @patch("game.views.EngineRunnerClient.get_state")
    def test_skip_turn_too_early_rejected(self, mock_state, mock_cmd):
        """El host no puede cortar el turno de un jugador conectado que acaba de empezar.

        El endpoint es anti-AFK, no un botón de veto universal.
        """
        from django.utils import timezone

        mock_state.return_value = {"state": {"activePlayerId": "p2"}}
        session = GameSession.objects.create(
            room_id="SKIP07",
            mode="STANDARD",
            max_players=2,
            host_id="h1",
            status="PLAYING",
            turn_player_id="p2",
            turn_started_at=timezone.now(),
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Bob", is_connected=True)
        response = self.client.post(
            "/api/rooms/SKIP07/skip-turn/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["reason"], "turn_too_early")
        mock_cmd.assert_not_called()

    @patch("game.views.EngineRunnerClient.execute_command")
    @patch("game.views.EngineRunnerClient.get_state")
    def test_skip_turn_allowed_when_afk_disconnected(self, mock_state, mock_cmd):
        """Un jugador desconectado puede ser saltado sin esperar el umbral.

        Es exactamente el caso AFK que el endpoint cubre.
        """
        from django.utils import timezone

        mock_state.return_value = {"state": {"activePlayerId": "p2"}}
        mock_cmd.return_value = {"accepted": True}
        session = GameSession.objects.create(
            room_id="SKIP08",
            mode="STANDARD",
            max_players=2,
            host_id="h1",
            status="PLAYING",
            turn_player_id="p2",
            turn_started_at=timezone.now(),
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Bob", is_connected=False)
        response = self.client.post(
            "/api/rooms/SKIP08/skip-turn/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["skipped"])

    # --- Reloj de turno autoritativo ---

    @patch("game.views.EngineRunnerClient.get_state")
    def test_turn_clock_seals_on_active_change(self, mock_state):
        """El backend sella turn_started_at cuando cambia el jugador activo."""
        mock_state.return_value = {"state": {"activePlayerId": "p1"}}
        session = GameSession.objects.create(
            room_id="CLOCK1",
            mode="STANDARD",
            max_players=2,
            host_id="h1",
            status="PLAYING",
        )
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)

        r1 = self.client.get("/api/rooms/CLOCK1/engine/?playerId=h1", headers={"x-player-token": host.auth_token})
        self.assertEqual(r1.status_code, 200)
        self.assertIn("turnStartedAt", r1.json())
        session.refresh_from_db()
        self.assertEqual(session.turn_player_id, "p1")
        first_stamp = session.turn_started_at
        self.assertIsNotNone(first_stamp)

        # Mismo activo: el sello no se mueve
        self.client.get("/api/rooms/CLOCK1/engine/?playerId=h1", headers={"x-player-token": host.auth_token})
        session.refresh_from_db()
        self.assertEqual(session.turn_started_at, first_stamp)

        # Cambio de jugador: nuevo sello
        mock_state.return_value = {"state": {"activePlayerId": "p2"}}
        self.client.get("/api/rooms/CLOCK1/engine/?playerId=h1", headers={"x-player-token": host.auth_token})
        session.refresh_from_db()
        self.assertEqual(session.turn_player_id, "p2")
        self.assertGreaterEqual(session.turn_started_at, first_stamp)

    def test_closed_room_rejects_join(self):
        """Tras cerrar, join devuelve 404 (la sala ya no existe)."""
        session = GameSession.objects.create(room_id="TESTC3", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        self.client.post(
            "/api/rooms/TESTC3/close/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token}),
            content_type="application/json",
        )
        response = self.client.post(
            "/api/rooms/TESTC3/join/",
            data=json.dumps({"playerId": "p9", "name": "Late"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

    # --- Reconexión y continuidad de sala (P2) ---

    def test_ws_reconnect_same_token(self):
        """Reconexión con el mismo token tras cerrar.

        Reinicio del backend / pérdida de red: el token sigue siendo
        válido mientras exista la sala.
        """
        try:
            from asgiref.sync import async_to_sync
            from channels.routing import URLRouter
            from channels.testing import WebsocketCommunicator

            from game.routing import websocket_urlpatterns

            application = URLRouter(websocket_urlpatterns)
        except ImportError:
            self.skipTest("channels.testing no disponible")

        session = GameSession.objects.create(room_id="WSRECON", mode="STANDARD", max_players=2, host_id="p1")
        player = Player.objects.create(session=session, player_id="p1", name="Ana", is_host=True)

        async def flow():
            # Cada reconexión pide un ticket nuevo (son de un solo uso).
            comm1 = WebsocketCommunicator(application, _ws_ticket_url("WSRECON", "p1"))
            connected, _ = await comm1.connect()
            self.assertTrue(connected)
            await comm1.receive_json_from()  # connected
            await comm1.disconnect()
            # Segunda conexión con un ticket nuevo: debe aceptar
            comm2 = WebsocketCommunicator(application, _ws_ticket_url("WSRECON", "p1"))
            connected2, _ = await comm2.connect()
            self.assertTrue(connected2)
            await comm2.receive_json_from()
            await comm2.disconnect()

        async_to_sync(flow)()
        player.refresh_from_db()
        self.assertFalse(player.is_connected)  # ambas cerradas → desconectado

    def test_ws_host_disconnect_auto_transfers(self):
        """Auto-transferencia de host al desconectar del todo en WAITING.

        El anfitrión pasa al jugador conectado más antiguo y se emite
        room.host_changed.
        """
        try:
            from asgiref.sync import async_to_sync
            from channels.routing import URLRouter
            from channels.testing import WebsocketCommunicator

            from game.routing import websocket_urlpatterns

            application = URLRouter(websocket_urlpatterns)
        except ImportError:
            self.skipTest("channels.testing no disponible")

        session = GameSession.objects.create(room_id="WSHOST", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben")

        async def flow():
            url_h = _ws_ticket_url("WSHOST", "h1")
            url_g = _ws_ticket_url("WSHOST", "p2")
            comm_h = WebsocketCommunicator(application, url_h)
            comm_g = WebsocketCommunicator(application, url_g)
            c1, _ = await comm_h.connect()
            c2, _ = await comm_g.connect()
            self.assertTrue(c1 and c2)
            await comm_h.receive_json_from()  # connected
            await comm_g.receive_json_from()
            # El host se desconecta → auto-transfer al invitado conectado.
            # Llega antes un room.player_disconnected (presencia) — saltarlo.
            await comm_h.disconnect()
            msg = await _ws_next_non_presence(comm_g, timeout=2)
            self.assertEqual(msg["type"], "room.host_changed")
            self.assertEqual(msg["playerId"], "p2")
            self.assertIsNotNone(msg.get("roomRevision"))
            await comm_g.disconnect()

        async_to_sync(flow)()
        session.refresh_from_db()
        self.assertEqual(session.host_id, "p2")
        self.assertTrue(Player.objects.get(session=session, player_id="p2").is_host)

    def test_ws_kicked_token_cannot_reconnect(self):
        """El token del expulsado está muerto.

        Reconectar con él se rechaza (la fila Player ya no existe tras
        el kick).
        """
        try:
            from asgiref.sync import async_to_sync
            from channels.routing import URLRouter
            from channels.testing import WebsocketCommunicator

            from game.routing import websocket_urlpatterns

            application = URLRouter(websocket_urlpatterns)
        except ImportError:
            self.skipTest("channels.testing no disponible")

        session = GameSession.objects.create(room_id="WSKICK", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben")

        async def connect_and_disconnect():
            comm = WebsocketCommunicator(application, _ws_ticket_url("WSKICK", "p2"))
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()
            await comm.disconnect()

        async_to_sync(connect_and_disconnect)()

        # Ticket emitido ANTES del kick: la expulsión debe revocarlo,
        # no puede quedar válido ~60 s para reconectar.
        stale_ticket_url = _ws_ticket_url("WSKICK", "p2")

        # Kick por REST en contexto síncrono (el client no puede vivir
        # dentro del loop async: SynchronousOnlyOperation)
        self.client.post(
            "/api/rooms/WSKICK/kick/",
            data=json.dumps(
                {
                    "playerId": "h1",
                    "playerToken": host.auth_token,
                    "targetId": "p2",
                }
            ),
            content_type="application/json",
        )

        async def reconnect_fails():
            comm2 = WebsocketCommunicator(application, stale_ticket_url)
            connected2, _ = await comm2.connect()
            self.assertFalse(connected2)
            await comm2.disconnect()

        async_to_sync(reconnect_fails)()

    # --- Tickets efímeros WS (P0) ---

    def test_ws_ticket_single_use(self):
        """El ticket se consume una vez: la segunda conexión se rechaza."""
        try:
            from asgiref.sync import async_to_sync
            from channels.routing import URLRouter
            from channels.testing import WebsocketCommunicator

            from game.routing import websocket_urlpatterns

            application = URLRouter(websocket_urlpatterns)
        except ImportError:
            self.skipTest("channels.testing no disponible")

        session = GameSession.objects.create(room_id="WSTICKET", mode="STANDARD", max_players=2, host_id="p1")
        player = Player.objects.create(session=session, player_id="p1", name="Ana", is_host=True)

        r = self.client.post(
            "/api/rooms/WSTICKET/ws-ticket/",
            data=json.dumps({"playerId": "p1", "playerToken": player.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        ticket = r.json()["ticket"]
        self.assertEqual(r.json()["expiresIn"], 60)

        async def flow():
            url = f"/ws/game/WSTICKET/?ticket={ticket}"
            comm1 = WebsocketCommunicator(application, url)
            connected, _ = await comm1.connect()
            self.assertTrue(connected)
            msg = await comm1.receive_json_from()
            self.assertEqual(msg["playerId"], "p1")
            await comm1.disconnect()
            # Segundo uso del mismo ticket → rechazado
            comm2 = WebsocketCommunicator(application, url)
            connected2, _ = await comm2.connect()
            self.assertFalse(connected2)
            await comm2.disconnect()

        async_to_sync(flow)()

    def test_ws_ticket_wrong_room_rejected(self):
        """Un ticket emitido para otra sala no sirve aquí."""
        session = GameSession.objects.create(room_id="STICKA", mode="STANDARD", max_players=2, host_id="p1")
        GameSession.objects.create(room_id="STICKB", mode="STANDARD", max_players=2, host_id="p1")
        player = Player.objects.create(session=session, player_id="p1", name="Ana", is_host=True)
        # pero el jugador solo existe en STICKA — el ticket de STICKA
        # no debe abrir STICKB
        r = self.client.post(
            "/api/rooms/STICKA/ws-ticket/",
            data=json.dumps({"playerId": "p1", "playerToken": player.auth_token}),
            content_type="application/json",
        )
        ticket = r.json()["ticket"]
        try:
            from asgiref.sync import async_to_sync
            from channels.routing import URLRouter
            from channels.testing import WebsocketCommunicator

            from game.routing import websocket_urlpatterns

            application = URLRouter(websocket_urlpatterns)
        except ImportError:
            self.skipTest("channels.testing no disponible")

        async def flow():
            comm = WebsocketCommunicator(application, f"/ws/game/STICKB/?ticket={ticket}")
            connected, _ = await comm.connect()
            self.assertFalse(connected)
            await comm.disconnect()

        async_to_sync(flow)()

    def test_ws_ticket_requires_auth(self):
        GameSession.objects.create(room_id="STAUTH", mode="STANDARD", max_players=2, host_id="p1")
        r = self.client.post(
            "/api/rooms/STAUTH/ws-ticket/",
            data=json.dumps({"playerId": "p1", "playerToken": "wrong"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 403)

    @override_settings(ROOM_RATE_LIMIT_MAX=None)
    def test_rate_limit_scoped_per_endpoint(self):
        """Los límites son por scope: agotar kick no bloquea ready."""
        session = GameSession.objects.create(room_id="RLSCOPED", mode="STANDARD", max_players=4, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben")

        # kick tiene límite 5 → 6ª llamada → 429
        status = None
        for _ in range(6):
            r = self.client.post(
                "/api/rooms/RLSCOPED/kick/",
                data=json.dumps(
                    {
                        "playerId": "h1",
                        "playerToken": host.auth_token,
                        "targetId": "p2",
                    }
                ),
                content_type="application/json",
            )
            status = r.status_code
        self.assertEqual(status, 429)

        # ready sigue funcionando — scope distinto
        r = self.client.post(
            "/api/rooms/RLSCOPED/ready/",
            data=json.dumps(
                {
                    "playerId": "h1",
                    "playerToken": host.auth_token,
                    "ready": True,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)

    # --- Permitir volver (unkick) ---

    def test_unkick_allows_rejoin(self):
        """El host puede levantar el veto: el expulsado vuelve a entrar."""
        session = GameSession.objects.create(room_id="UNK01", mode="STANDARD", max_players=3, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben")

        # Expulsar
        r = self.client.post(
            "/api/rooms/UNK01/kick/",
            data=json.dumps(
                {
                    "playerId": "h1",
                    "playerToken": host.auth_token,
                    "targetId": "p2",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)

        # p2 no puede volver
        r = self.client.post(
            "/api/rooms/UNK01/join/",
            data=json.dumps({"playerId": "p2", "name": "Ben"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 403)

        # El host levanta el veto
        r = self.client.post(
            "/api/rooms/UNK01/unkick/",
            data=json.dumps(
                {
                    "playerId": "h1",
                    "playerToken": host.auth_token,
                    "targetId": "p2",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("p2", r.json()["room"]["kickedIds"])

        # p2 vuelve a entrar
        r = self.client.post(
            "/api/rooms/UNK01/join/",
            data=json.dumps({"playerId": "p2", "name": "Ben"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)

    def test_unkick_requires_host(self):
        session = GameSession.objects.create(room_id="UNK02", mode="STANDARD", max_players=3, host_id="h1")
        Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        r = self.client.post(
            "/api/rooms/UNK02/unkick/",
            data=json.dumps(
                {
                    "playerId": "p9",
                    "playerToken": "x",
                    "targetId": "p2",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 403)

    def test_unkick_not_kicked_is_404(self):
        session = GameSession.objects.create(room_id="UNK03", mode="STANDARD", max_players=3, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        r = self.client.post(
            "/api/rooms/UNK03/unkick/",
            data=json.dumps(
                {
                    "playerId": "h1",
                    "playerToken": host.auth_token,
                    "targetId": "p9",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 404)

    # --- Tickets WS adversarios (P0) ---

    def _ws_app(self):
        from channels.routing import URLRouter
        from channels.testing import WebsocketCommunicator

        from game.routing import websocket_urlpatterns

        return URLRouter(websocket_urlpatterns), WebsocketCommunicator

    def _make_ws_player(self, room_id="TKT1"):
        session = GameSession.objects.create(
            room_id=room_id,
            mode="STANDARD",
            max_players=2,
            host_id="p1",
        )
        player = Player.objects.create(
            session=session,
            player_id="p1",
            name="Ana",
            is_host=True,
        )
        return session, player

    def _issue_ticket(self, room_id, player):
        r = self.client.post(
            f"/api/rooms/{room_id}/ws-ticket/",
            data=json.dumps({"playerId": player.player_id, "playerToken": player.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["ticket"]

    def test_ws_ticket_expires(self):
        """Un ticket caducado es rechazado."""
        try:
            from asgiref.sync import async_to_sync

            application, ws_communicator = self._ws_app()
        except ImportError:
            self.skipTest("channels.testing no disponible")
        _, player = self._make_ws_player("TKTE")
        ticket = self._issue_ticket("TKTE", player)

        # Forzar caducidad
        from django.core.cache import cache

        cache.delete(f"wst:{ticket}")  # fuerza expiración del ticket

        async def flow():
            comm = ws_communicator(application, f"/ws/game/TKTE/?ticket={ticket}")
            connected, _ = await comm.connect()
            self.assertFalse(connected)

        async_to_sync(flow)()

    def test_ws_ticket_kicked_player_rejected(self):
        """Un expulsado no puede obtener ticket."""
        session, player = self._make_ws_player("TKTK")
        session.kicked_ids = ["p1"]
        session.save(update_fields=["kicked_ids"])
        r = self.client.post(
            "/api/rooms/TKTK/ws-ticket/",
            data=json.dumps({"playerId": "p1", "playerToken": player.auth_token}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 403)

    def test_chat_rate_limited(self):
        """El chat tiene su propio límite (5 msg / 5 s por conexión)."""
        try:
            from asgiref.sync import async_to_sync

            application, ws_communicator = self._ws_app()
        except ImportError:
            self.skipTest("channels.testing no disponible")
        self._make_ws_player("CHATL")

        async def flow():
            comm = ws_communicator(
                application,
                _ws_ticket_url("CHATL", "p1"),
            )
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()  # 'connected'
            limited = False
            for i in range(7):
                await comm.send_json_to({"type": "chat.message", "text": f"m{i}", "clientMessageId": f"m{i}"})
            # Drenar mensajes buscando el error de rate limit
            import asyncio
            import contextlib

            with contextlib.suppress(TimeoutError):
                for _ in range(10):
                    msg = await asyncio.wait_for(comm.receive_json_from(), timeout=1.0)
                    if msg.get("reason") == "chat_rate_limited":
                        limited = True
                        break
            self.assertTrue(limited, "Se esperaba chat_rate_limited")
            await comm.disconnect()

        async_to_sync(flow)()


class CommunityStatsTestCase(TestCase):
    """Estadísticas de comunidad: informes anónimos y rareza."""

    def test_report_and_community_aggregates(self):
        """2 informes con distintos desbloqueos → rarezas correctas."""
        c = Client()
        r1 = c.post(
            "/api/stats/report/",
            data=json.dumps({"unlocks": ["first_game", "flawless"]}),
            content_type="application/json",
        )
        self.assertEqual(r1.status_code, 200)
        c.post(
            "/api/stats/report/",
            data=json.dumps({"unlocks": ["first_game"]}),
            content_type="application/json",
        )
        r = c.get("/api/stats/community/")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["reports"], 2)
        self.assertEqual(data["rarity"]["first_game"], 1.0)
        self.assertEqual(data["rarity"]["flawless"], 0.5)
        # La fila reservada no aparece como logro
        self.assertNotIn("_total", data["rarity"])

    def test_report_rejects_invalid_payload(self):
        """Unlocks no-lista o ids invalidos se sanitizan/rechazan."""
        c = Client()
        r = c.post(
            "/api/stats/report/",
            data=json.dumps({"unlocks": "first_game"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 400)
        # ids inválidos se ignoran pero el informe cuenta
        r = c.post(
            "/api/stats/report/",
            data=json.dumps({"unlocks": ["", "_total", 42, "flawless"]}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertFalse(CommunityStat.objects.filter(achievement_id="").exists())
        self.assertTrue(CommunityStat.objects.filter(achievement_id="flawless").exists())

    def test_community_empty(self):
        """Sin informes → reports 0 y rarity vacío (sin división por cero)."""
        r = Client().get("/api/stats/community/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"reports": 0, "rarity": {}})

    def test_report_method_not_allowed(self):
        self.assertEqual(Client().get("/api/stats/report/").status_code, 405)


@override_settings(ROOM_RATE_LIMIT_MAX=10000)
class SecurityRegressionTests(TestCase):
    """Regresiones de los hallazgos de la auditoría de seguridad."""

    def setUp(self):
        self.client = Client()
        from django.core.cache import cache

        cache.clear()  # rl:*, wst:*, spec:*, cmid:* — estado compartido

    def test_kick_revokes_pending_ws_ticket(self):
        """Un ticket emitido antes del kick no sigue sirviendo tras él."""
        session = GameSession.objects.create(room_id="KREVOKE", mode="STANDARD", max_players=2, host_id="h1")
        host = Player.objects.create(session=session, player_id="h1", name="Ana", is_host=True)
        Player.objects.create(session=session, player_id="p2", name="Ben")

        from .views import _issue_ws_ticket, consume_ws_ticket

        ticket = _issue_ws_ticket("KREVOKE", "p2")

        r = self.client.post(
            "/api/rooms/KREVOKE/kick/",
            data=json.dumps({"playerId": "h1", "playerToken": host.auth_token, "targetId": "p2"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        # El ticket emitido hace segundos ya no consume — fue revocado
        self.assertIsNone(consume_ws_ticket(ticket, "KREVOKE"))

    def test_list_rooms_hides_private_config(self):
        """El listado público expone sets/versions pero no los pools del motor."""
        config = {
            "contentManifest": [{"id": "set-1", "name": "Set", "version": "1.0"}],
            "customSets": [{"id": "set-1", "cards": [{"id": "x"}]}],
            "hordeCardIds": ["horde.a"],
            "warlordIds": ["warlord.g"],
            "useScenarios": True,
        }
        GameSession.objects.create(room_id="PRIV01", mode="STANDARD", max_players=2, host_id="h1", config=config)
        r = self.client.get("/api/rooms/list/")
        self.assertEqual(r.status_code, 200)
        room = next(x for x in r.json()["rooms"] if x["roomId"] == "PRIV01")
        room_cfg = room.get("config") or {}
        # Los sets viajan públicos (los invitados los importan para jugar);
        # los pools del motor quedan para miembros — revelan la partida.
        self.assertIn("customSets", room_cfg)
        self.assertNotIn("hordeCardIds", room_cfg)
        self.assertNotIn("warlordIds", room_cfg)
        self.assertEqual(room_cfg.get("contentManifest"), config["contentManifest"])

    @patch("game.views.EngineRunnerClient.delete_room")
    def test_reap_stale_rooms(self, mock_delete):
        """WAITING sin conectados + FINISHED antiguas se limpian."""
        from datetime import timedelta

        from django.utils import timezone

        from .views import reap_stale_rooms

        old = timezone.now() - timedelta(days=2)
        dead = GameSession.objects.create(room_id="REAPW1", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=dead, player_id="h1", name="Ana", is_host=True, is_connected=False)
        GameSession.objects.filter(pk=dead.pk).update(updated_at=old)

        fin = GameSession.objects.create(
            room_id="REAPF1", mode="STANDARD", max_players=2, host_id="h1", status="FINISHED"
        )
        GameSession.objects.filter(pk=fin.pk).update(updated_at=old)

        alive = GameSession.objects.create(room_id="REAPOK", mode="STANDARD", max_players=2, host_id="h1")
        Player.objects.create(session=alive, player_id="h1", name="Ana", is_host=True, is_connected=True)

        reaped = reap_stale_rooms()
        self.assertIn("REAPW1", reaped)
        self.assertIn("REAPF1", reaped)
        self.assertNotIn("REAPOK", reaped)
        self.assertFalse(GameSession.objects.filter(room_id__in=["REAPW1", "REAPF1"]).exists())
        self.assertTrue(GameSession.objects.filter(room_id="REAPOK").exists())

    @patch("game.views.EngineRunnerClient.delete_room")
    def test_reap_playing_uses_event_activity(self, mock_delete):
        """PLAYING se cierra por inactividad de EVENTOS, no por updated_at.

        Los comandos WS actualizan la revisión con QuerySet.update() —
        no disparan auto_now. Un juego activo de >48h con un comando
        reciente NO debe marcarse FINISHED; uno sin eventos recientes sí.
        """
        from datetime import timedelta

        from django.utils import timezone

        from .views import reap_stale_rooms

        old = timezone.now() - timedelta(hours=72)
        # Sala activa: vieja pero con un evento de partida reciente.
        live = GameSession.objects.create(
            room_id="PLAYL1", mode="STANDARD", max_players=2, host_id="h1", status="PLAYING"
        )
        GameSession.objects.filter(pk=live.pk).update(updated_at=old)
        GameEvent.objects.create(session=live, seq=1, event_type="COMMAND", player_id="h1", data={"accepted": True})

        # Sala zombi: vieja y con el último evento de hace 72h.
        dead = GameSession.objects.create(
            room_id="PLAYD1", mode="STANDARD", max_players=2, host_id="h1", status="PLAYING"
        )
        GameSession.objects.filter(pk=dead.pk).update(updated_at=old)
        dead_ev = GameEvent.objects.create(
            session=dead, seq=1, event_type="COMMAND", player_id="h1", data={"accepted": True}
        )
        # auto_now_add no se puede escribir con create(); toca update()
        GameEvent.objects.filter(pk=dead_ev.pk).update(created_at=old)

        # Sala sin eventos y vieja: también zombi.
        empty = GameSession.objects.create(
            room_id="PLAYE1", mode="STANDARD", max_players=2, host_id="h1", status="PLAYING"
        )
        GameSession.objects.filter(pk=empty.pk).update(updated_at=old)

        reap_stale_rooms()
        live.refresh_from_db()
        dead.refresh_from_db()
        empty.refresh_from_db()
        self.assertEqual(live.status, "PLAYING")
        self.assertEqual(dead.status, "FINISHED")
        self.assertEqual(empty.status, "FINISHED")

    def test_command_result_broadcast_has_no_raw_events(self):
        """El broadcast de comandos no filtra eventos en crudo (D425)."""
        try:
            from asgiref.sync import async_to_sync
            from channels.routing import URLRouter
            from channels.testing import WebsocketCommunicator

            from game.routing import websocket_urlpatterns

            application = URLRouter(websocket_urlpatterns)
        except ImportError:
            self.skipTest("channels.testing no disponible")

        session = GameSession.objects.create(
            room_id="WSNOEV", mode="STANDARD", max_players=2, host_id="p1", status="PLAYING"
        )
        Player.objects.create(session=session, player_id="p1", name="Ana", is_host=True)

        async def flow():
            comm = WebsocketCommunicator(application, _ws_ticket_url("WSNOEV", "p1"))
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()  # 'connected'

            with patch("game.consumers.EngineRunnerClient.execute_command") as mock_cmd:
                mock_cmd.return_value = {
                    "accepted": True,
                    "revision": 3,
                    "stateChanged": True,
                    "events": [{"type": "DECK_SHUFFLED", "order": [1, 2, 3]}],
                }
                await comm.send_json_to({"type": "game.command", "cid": "c1", "command": {"type": "END_TURN"}})
                ack = await _ws_next_non_presence(comm)
                self.assertTrue(ack["accepted"])
                broadcast = await _ws_next_non_presence(comm)
                self.assertEqual(broadcast["type"], "game.command_result")
                # Los events del runner NUNCA salen por el grupo
                self.assertNotIn("events", broadcast)
            await comm.disconnect()

        async_to_sync(flow)()


@override_settings(ROOM_RATE_LIMIT_MAX=10000)
class PersistencePhase2Tests(TestCase):
    """Fase 2: dedup persistente por cid, snapshots, sync y cierre automático."""

    def _playing(self, room_id="P2ROOM1"):
        session = GameSession.objects.create(
            room_id=room_id, mode="STANDARD", max_players=2, host_id="p1", status="PLAYING"
        )
        Player.objects.create(session=session, player_id="p1", name="Ana", is_host=True)
        return session

    def _ws_app(self):
        """Router WS de test; lanza SkipTest si channels.testing falta."""
        import importlib.util

        if importlib.util.find_spec("channels.testing") is None:
            raise SkipTest("channels.testing no disponible")
        from channels.routing import URLRouter

        from game.routing import websocket_urlpatterns

        return URLRouter(websocket_urlpatterns)

    def test_ws_command_cid_deduplicated(self):
        """Dedup persistente por cid ya procesado.

        Un cid ya procesado responde con el veredicto registrado sin
        re-ejecutar el comando en el runner.
        """
        try:
            from asgiref.sync import async_to_sync
            from channels.testing import WebsocketCommunicator
        except ImportError:
            self.skipTest("channels.testing no disponible")
        self._playing("DEDUP1")
        application = self._ws_app()

        async def flow():
            comm = WebsocketCommunicator(application, _ws_ticket_url("DEDUP1", "p1"))
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()  # 'connected'
            with patch("game.consumers.EngineRunnerClient.execute_command") as mock_cmd:
                mock_cmd.return_value = {"accepted": True, "revision": 2, "stateChanged": True, "events": []}
                await comm.send_json_to({"type": "game.command", "cid": "dup-1", "command": {"type": "END_TURN"}})
                ack1 = await _ws_next_non_presence(comm)
                self.assertTrue(ack1["accepted"])
                self.assertNotIn("deduplicated", ack1)
                await _ws_next_non_presence(comm)  # broadcast command_result
                # Reenvío del mismo cid → dedup, sin tocar el runner
                await comm.send_json_to({"type": "game.command", "cid": "dup-1", "command": {"type": "END_TURN"}})
                ack2 = await _ws_next_non_presence(comm)
                self.assertTrue(ack2["accepted"])
                self.assertTrue(ack2["deduplicated"])
                self.assertEqual(mock_cmd.call_count, 1)
            await comm.disconnect()

        async_to_sync(flow)()

    def test_ws_command_cid_control_chars_rejected(self):
        r"""Un cid con caracteres de control (\\n, \\t) se rechaza en backend.

        R-1 simétrico: el runner valida SAFE_ID; el consumer debe rechazar
        antes de persistir — un cid con \\n en GameEvent.cid sería
        log-forging latente al exportar eventos.
        """
        try:
            from asgiref.sync import async_to_sync
            from channels.testing import WebsocketCommunicator
        except ImportError:
            self.skipTest("channels.testing no disponible")
        self._playing("CCID1")
        application = self._ws_app()

        async def flow():
            comm = WebsocketCommunicator(application, _ws_ticket_url("CCID1", "p1"))
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()
            with patch("game.consumers.EngineRunnerClient.execute_command") as mock_cmd:
                await comm.send_json_to(
                    {"type": "game.command", "cid": "evil\nforged-log-line", "command": {"type": "END_TURN"}}
                )
                ack = await _ws_next_non_presence(comm)
                self.assertFalse(ack["accepted"])
                self.assertEqual(ack["reason"], "Missing or invalid command")
                mock_cmd.assert_not_called()
            await comm.disconnect()

        async_to_sync(flow)()
        # Nada persistido con ese cid (fuera del loop async — ORM sync)
        self.assertFalse(GameEvent.objects.filter(cid="evil\nforged-log-line").exists())

    def test_ws_game_ended_marks_finished(self):
        """Un GAME_ENDED del runner cierra la sala y deja el evento + snapshot."""
        try:
            from asgiref.sync import async_to_sync
            from channels.testing import WebsocketCommunicator
        except ImportError:
            self.skipTest("channels.testing no disponible")
        self._playing("ENDG1")
        application = self._ws_app()

        async def flow():
            comm = WebsocketCommunicator(application, _ws_ticket_url("ENDG1", "p1"))
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()
            with (
                patch("game.consumers.EngineRunnerClient.execute_command") as mock_cmd,
                patch("game.views.engine.EngineRunnerClient.get_full_state") as mock_full,
            ):
                mock_cmd.return_value = {
                    "accepted": True,
                    "revision": 9,
                    "stateChanged": True,
                    "events": [{"type": "GAME_ENDED", "winnerId": "p1"}],
                }
                mock_full.return_value = {"state": {"phase": "FINISHED"}, "revision": 9, "rngState": {}}
                await comm.send_json_to({"type": "game.command", "cid": "end-1", "command": {"type": "END_TURN"}})
                await _ws_next_non_presence(comm)  # ack
                # Broadcasts de grupo: room.finished y command_result
                types = {(await _ws_next_non_presence(comm))["type"]}
                types.add((await _ws_next_non_presence(comm))["type"])
                self.assertEqual(types, {"room.finished", "game.command_result"})
            await comm.disconnect()

        async_to_sync(flow)()
        session = GameSession.objects.get(room_id="ENDG1")
        self.assertEqual(session.status, "FINISHED")
        from .models import GameEvent, GameSnapshot

        self.assertTrue(GameEvent.objects.filter(session=session, event_type="GAME_ENDED").exists())
        self.assertTrue(GameSnapshot.objects.filter(session=session).exists())

    def test_snapshot_taken_every_n_events(self):
        """El checkpoint se toma cada SNAPSHOT_EVERY_EVENTS eventos."""
        try:
            from asgiref.sync import async_to_sync
            from channels.testing import WebsocketCommunicator
        except ImportError:
            self.skipTest("channels.testing no disponible")
        self._playing("SNAP1")
        application = self._ws_app()

        async def flow():
            comm = WebsocketCommunicator(application, _ws_ticket_url("SNAP1", "p1"))
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()
            with (
                patch("game.consumers.EngineRunnerClient.execute_command") as mock_cmd,
                patch("game.views.engine.SNAPSHOT_EVERY_EVENTS", 2),
                patch("game.views.engine.take_snapshot") as mock_snap,
            ):
                mock_cmd.return_value = {"accepted": True, "revision": 1, "stateChanged": True, "events": []}
                await comm.send_json_to({"type": "game.command", "cid": "s1", "command": {"type": "END_TURN"}})
                await _ws_next_non_presence(comm)
                await _ws_next_non_presence(comm)
                self.assertEqual(mock_snap.call_count, 0)  # seq=1, no toca
                await comm.send_json_to({"type": "game.command", "cid": "s2", "command": {"type": "END_TURN"}})
                await _ws_next_non_presence(comm)
                await _ws_next_non_presence(comm)
                self.assertEqual(mock_snap.call_count, 1)  # seq=2 → snapshot
            await comm.disconnect()

        async_to_sync(flow)()

    def test_take_snapshot_prunes_old(self):
        """Solo se conservan los últimos MAX_SNAPSHOTS_PER_SESSION."""
        from .models import GameEvent, GameSnapshot
        from .views.engine import MAX_SNAPSHOTS_PER_SESSION, take_snapshot

        session = self._playing("PRUNE1")
        GameEvent.objects.create(session=session, seq=1, event_type="COMMAND", player_id="p1", data={})
        with patch("game.views.engine.EngineRunnerClient.get_full_state") as mock_full:
            mock_full.return_value = {"state": {}, "revision": 1, "rngState": {}}
            for _ in range(MAX_SNAPSHOTS_PER_SESSION + 3):
                take_snapshot(session)
        snaps = GameSnapshot.objects.filter(session=session)
        self.assertEqual(snaps.count(), MAX_SNAPSHOTS_PER_SESSION)
        self.assertEqual(snaps.first().seq, 1)

    def test_take_snapshot_survives_runner_down(self):
        """Runner caído → snapshot no se toma pero no explota."""
        from .models import GameSnapshot
        from .views.engine import take_snapshot

        session = self._playing("SNDOWN")
        with patch("game.views.engine.EngineRunnerClient.get_full_state") as mock_full:
            mock_full.side_effect = httpx.HTTPError("down")
            self.assertFalse(take_snapshot(session))
        self.assertFalse(GameSnapshot.objects.filter(session=session).exists())


@override_settings(ROOM_RATE_LIMIT_MAX=10000)
class MetricsTests(TestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.client = Client()

    def test_metrics_localhost_prometheus_format(self):
        """Sin METRICS_TOKEN solo localhost; formato texto Prometheus."""
        GameSession.objects.create(
            room_id="METR01",
            mode="STANDARD",
            max_players=4,
            host_id="h1",
            status="PLAYING",
        )
        r = self.client.get("/api/metrics/")  # testclient → 127.0.0.1
        self.assertEqual(r.status_code, 200)
        body = r.content.decode()
        self.assertIn('nt4h_rooms_total{status="playing"} 1', body)
        self.assertIn("nt4h_players_connected 0", body)

    def test_metrics_token_required_when_configured(self):
        from unittest.mock import patch

        with patch.dict("os.environ", {"METRICS_TOKEN": "sekret"}):
            self.assertEqual(self.client.get("/api/metrics/").status_code, 401)
            r = self.client.get("/api/metrics/", HTTP_AUTHORIZATION="Bearer sekret")
            self.assertEqual(r.status_code, 200)


@override_settings(ROOM_RATE_LIMIT_MAX=10000)
class RestoreDrillTests(TestCase):
    """Simulacro de recuperación: restaurar una sala PLAYING.

    Restaura desde su último GameSnapshot (cubre B-10 — 409 del runner = éxito).
    """

    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.client = Client()

    def _room_with_snapshot(self, room_id: str) -> None:
        from .models import GameSnapshot

        session = GameSession.objects.create(
            room_id=room_id,
            mode="STANDARD",
            max_players=4,
            host_id="h1",
            status="PLAYING",
        )
        GameSnapshot.objects.create(
            session=session,
            seq=10,
            state={"state": {"phase": "PLAYER_ATTACK"}, "revision": 7},
        )

    @patch("game.views.engine.EngineRunnerClient.restore_room")
    def test_restore_sends_snapshot_body(self, mock_restore):
        from .views.engine import restore_room_from_snapshot

        self._room_with_snapshot("RDRILL1")
        mock_restore.return_value = {"ok": True}
        self.assertTrue(restore_room_from_snapshot("RDRILL1"))
        args = mock_restore.call_args
        self.assertEqual(args[0][0], "RDRILL1")
        self.assertEqual(args[0][1]["revision"], 7)

    @patch("game.views.engine.EngineRunnerClient.restore_room")
    def test_restore_409_counts_as_success(self, mock_restore):
        """Carrera de restauración: el 409 (sala ya viva) es el objetivo."""
        from .views.engine import restore_room_from_snapshot

        self._room_with_snapshot("RDRILL2")
        req = httpx.Request("POST", "http://runner/rooms/RDRILL2/restore")
        mock_restore.side_effect = httpx.HTTPStatusError("409", request=req, response=httpx.Response(409, request=req))
        self.assertTrue(restore_room_from_snapshot("RDRILL2"))

    @patch("game.views.engine.EngineRunnerClient.restore_room")
    def test_restore_500_is_failure(self, mock_restore):
        from .views.engine import restore_room_from_snapshot

        self._room_with_snapshot("RDRILL3")
        req = httpx.Request("POST", "http://runner/rooms/RDRILL3/restore")
        mock_restore.side_effect = httpx.HTTPStatusError("500", request=req, response=httpx.Response(500, request=req))
        self.assertFalse(restore_room_from_snapshot("RDRILL3"))

    def test_restore_no_snapshot_fails(self):
        from .views.engine import restore_room_from_snapshot

        GameSession.objects.create(
            room_id="RDRILL4",
            mode="STANDARD",
            max_players=4,
            host_id="h1",
            status="PLAYING",
        )
        self.assertFalse(restore_room_from_snapshot("RDRILL4"))
