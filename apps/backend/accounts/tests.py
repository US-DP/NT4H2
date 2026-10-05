"""Tests de la API de cuentas (Fase 1: identidad persistente)."""

import json
from unittest.mock import patch

from django.test import Client, TestCase, override_settings

from game.models import Player

from .models import PlayerProfile, PlayerStatistics


def _post(client, url, data, **kwargs):
    return client.post(url, json.dumps(data), content_type="application/json", **kwargs)


_TEST_PASSWORD = "Str0ng!Pass"  # noqa: S105  # nosec B105 - credencial de test
_WEAK_PASSWORD = "12345678"  # noqa: S105  # nosec B105


def _register(client, email="a@example.com", display="Alex", password=_TEST_PASSWORD):
    return _post(
        client,
        "/api/v1/auth/register/",
        {"email": email, "password": password, "display_name": display},
    )


@override_settings(ROOM_RATE_LIMIT_MAX=0)  # sin rate limit en tests
class AuthFlowTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_register_returns_tokens_and_profile(self):
        res = _register(self.client)
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertIn("access", body["tokens"])
        self.assertIn("refresh", body["tokens"])
        self.assertEqual(body["user"]["display_name"], "Alex")
        self.assertTrue(PlayerProfile.objects.filter(user__email="a@example.com").exists())
        self.assertTrue(PlayerStatistics.objects.filter(user__email="a@example.com").exists())

    def test_register_rejects_duplicate_email_and_name(self):
        _register(self.client)
        res = _register(self.client, email="A@EXAMPLE.COM", display="Other")
        self.assertEqual(res.status_code, 400)
        res2 = _register(self.client, email="x@example.com", display="alex")
        self.assertEqual(res2.status_code, 400)

    def test_register_rejects_weak_password(self):
        res = _register(self.client, password=_WEAK_PASSWORD)
        self.assertEqual(res.status_code, 400)

    def test_login_refresh_and_me(self):
        _register(self.client)
        login = _post(self.client, "/api/v1/auth/login/", {"email": "a@example.com", "password": _TEST_PASSWORD})
        self.assertEqual(login.status_code, 200)
        tokens = login.json()
        me = self.client.get("/api/v1/me/", HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["email"], "a@example.com")
        refresh = _post(self.client, "/api/v1/auth/refresh/", {"refresh": tokens["refresh"]})
        self.assertEqual(refresh.status_code, 200)
        # Rotación: el refresh viejo queda en la blacklist
        again = _post(self.client, "/api/v1/auth/refresh/", {"refresh": tokens["refresh"]})
        self.assertEqual(again.status_code, 401)

    def test_logout_blacklists_refresh(self):
        _register(self.client)
        tokens = _post(
            self.client, "/api/v1/auth/login/", {"email": "a@example.com", "password": _TEST_PASSWORD}
        ).json()
        out = _post(
            self.client,
            "/api/v1/auth/logout/",
            {"refresh": tokens["refresh"]},
            HTTP_AUTHORIZATION=f"Bearer {tokens['access']}",
        )
        self.assertEqual(out.status_code, 200)
        again = _post(self.client, "/api/v1/auth/refresh/", {"refresh": tokens["refresh"]})
        self.assertEqual(again.status_code, 401)

    def test_me_requires_auth(self):
        self.assertEqual(self.client.get("/api/v1/me/").status_code, 401)

    def test_me_patch_updates_profile(self):
        tokens = _register(self.client).json()["tokens"]
        res = self.client.patch(
            "/api/v1/me/",
            json.dumps({"profile": {"biography": "hola", "country_code": "ES"}}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {tokens['access']}",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["profile"]["biography"], "hola")

    def test_statistics_endpoint(self):
        user_res = _register(self.client).json()
        uid = user_res["user"]["id"]
        tokens = user_res["tokens"]
        auth = {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"}
        stats = self.client.get(f"/api/v1/players/{uid}/statistics/", **auth)
        self.assertEqual(stats.status_code, 200)
        self.assertEqual(stats.json()["games_played"], 0)
        self.assertEqual(
            self.client.get("/api/v1/players/00000000-0000-0000-0000-000000000000/statistics/", **auth).status_code,
            404,
        )


@override_settings(ROOM_RATE_LIMIT_MAX=0)
class PlayerLinkTests(TestCase):
    """Vinculación Player↔User: en create/join con JWT y vía claim-guest."""

    def setUp(self):
        self.client = Client()
        body = _register(self.client).json()
        self.user_id = body["user"]["id"]
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {body['tokens']['access']}"}

    def _create_room(self, **kwargs):
        with patch("game.views.EngineRunnerClient.create_room"):
            return _post(
                self.client,
                "/api/rooms/",
                {
                    "hostId": "h1",
                    "hostName": "Host",
                    "maxPlayers": 4,
                    "seed": "s",
                    "heroes": [{"playerId": "h1", "heroId": "H1", "deckId": "D1", "heroFace": "MALE"}],
                },
                **kwargs,
            )

    def test_create_room_links_player_to_user(self):
        res = self._create_room(**self.auth)
        self.assertEqual(res.status_code, 200)
        player = Player.objects.get(player_id="h1")
        self.assertEqual(str(player.user_id), self.user_id)

    def test_create_room_guest_has_no_user(self):
        res = self._create_room()
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(Player.objects.get(player_id="h1").user_id)

    def test_join_links_player_to_user(self):
        room_id = self._create_room(**self.auth).json()["roomId"]
        res = _post(
            self.client,
            f"/api/rooms/{room_id}/join/",
            {"playerId": "p2", "name": "Invitado", "heroId": "H2", "deckId": "D2"},
            **self.auth,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(str(Player.objects.get(player_id="p2").user_id), self.user_id)

    def test_rejoin_links_guest_player(self):
        res = self._create_room()
        room_id = res.json()["roomId"]
        token = res.json()["hostToken"]
        # Rejoin autenticado con el token de jugador → vincula la fila
        rejoin = _post(
            self.client,
            f"/api/rooms/{room_id}/join/",
            {"playerId": "h1", "name": "Host", "playerToken": token},
            **self.auth,
        )
        self.assertEqual(rejoin.status_code, 200)
        self.assertEqual(str(Player.objects.get(player_id="h1").user_id), self.user_id)

    def test_stats_endpoints_roundtrip(self):
        # stats_report/leaderboard siguen funcionando sin cuenta (opt-in anónimo)
        res = _post(self.client, "/api/stats/report/", {"unlocks": ["logro-1"]})
        self.assertEqual(res.status_code, 200)
        community = self.client.get("/api/stats/community/")
        self.assertEqual(community.status_code, 200)
        self.assertEqual(community.json()["reports"], 1)
