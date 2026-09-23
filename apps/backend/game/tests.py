"""Tests básicos para el backend de juego."""
import json
from unittest.mock import patch

from django.test import Client, TestCase

from .models import GameSession, Player


class RoomApiTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_health_check(self):
        response = self.client.get('/api/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'ok')

    @patch('game.views.EngineRunnerClient.create_room')
    def test_create_room(self, mock_create):
        mock_create.return_value = {'ok': True}
        response = self.client.post(
            '/api/rooms/',
            data=json.dumps({
                'mode': 'STANDARD',
                'maxPlayers': 2,
                'hostId': 'h1',
                'hostName': 'Ana',
                'heroes': [{
                    'playerId': 'p1',
                    'heroId': 'hero.aranel',
                    'heroFace': 'FEMALE',
                    'deckId': 'explorer.default',
                }],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('roomId', data)
        self.assertEqual(data['status'], 'created')

    @patch('game.views.EngineRunnerClient.create_room')
    def test_create_room_engine_down_returns_503(self, mock_create):
        """Fail-closed: sin motor no se crea la sala (evita desync)."""
        mock_create.side_effect = Exception('Connection refused')
        response = self.client.post(
            '/api/rooms/',
            data=json.dumps({
                'mode': 'STANDARD',
                'maxPlayers': 2,
                'hostId': 'h1',
                'heroes': [{'playerId': 'p1', 'heroId': 'hero.aranel',
                            'heroFace': 'FEMALE', 'deckId': 'explorer.default'}],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 503)
        self.assertFalse(GameSession.objects.exists())

    @patch('game.views.EngineRunnerClient.create_room')
    def test_create_room_no_heroes(self, mock_create):
        """Sin héroes el runner rechazaría (Zod min 1) — validar antes."""
        response = self.client.post(
            '/api/rooms/',
            data=json.dumps({'mode': 'STANDARD', 'maxPlayers': 2,
                             'hostId': 'h1', 'heroes': []}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        mock_create.assert_not_called()

    def test_seed_not_exposed(self):
        """La seed del RNG nunca sale del servidor."""
        session = GameSession.objects.create(
            room_id='SEED01', mode='STANDARD', seed='top-secret', host_id='h1'
        )
        Player.objects.create(session=session, player_id='h1', name='Ana', is_host=True)
        response = self.client.get('/api/rooms/SEED01/')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('seed', response.json())
        self.assertNotIn('top-secret', response.content.decode())

    @patch('game.views.EngineRunnerClient.delete_room')
    def test_leave_last_player_closes_room(self, mock_delete):
        """Sala WAITING vacía se limpia también en el runner."""
        session = GameSession.objects.create(
            room_id='CLOSE01', mode='STANDARD', max_players=2, host_id='h1'
        )
        player = Player.objects.create(
            session=session, player_id='p1', name='Ana', is_connected=True
        )
        response = self.client.post(
            '/api/rooms/CLOSE01/leave/',
            data=json.dumps({'playerId': 'p1', 'playerToken': player.auth_token}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get('roomClosed'))
        mock_delete.assert_called_once_with('CLOSE01')
        self.assertFalse(GameSession.objects.filter(room_id='CLOSE01').exists())

    def test_leave_requires_player_id(self):
        GameSession.objects.create(
            room_id='LEAVE01', mode='STANDARD', max_players=2, host_id='h1'
        )
        response = self.client.post(
            '/api/rooms/LEAVE01/leave/',
            data=json.dumps({}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_create_room_method_not_allowed(self):
        response = self.client.get('/api/rooms/')
        self.assertEqual(response.status_code, 405)

    def test_join_room(self):
        session = GameSession.objects.create(
            room_id='TEST01', mode='STANDARD', max_players=2, host_id='h1'
        )
        Player.objects.create(session=session, player_id='h1', name='Ana', is_host=True)

        response = self.client.post(
            '/api/rooms/TEST01/join/',
            data=json.dumps({'playerId': 'p2', 'name': 'Ben'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['joined'])

    def test_join_room_full(self):
        session = GameSession.objects.create(
            room_id='TEST02', mode='STANDARD', max_players=1, host_id='h1'
        )
        Player.objects.create(session=session, player_id='h1', name='Ana', is_host=True)

        response = self.client.post(
            '/api/rooms/TEST02/join/',
            data=json.dumps({'playerId': 'p2', 'name': 'Ben'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_join_room_not_waiting(self):
        session = GameSession.objects.create(
            room_id='TEST03', mode='STANDARD', max_players=2, host_id='h1', status='PLAYING'
        )
        Player.objects.create(session=session, player_id='h1', name='Ana', is_host=True)

        response = self.client.post(
            '/api/rooms/TEST03/join/',
            data=json.dumps({'playerId': 'p2', 'name': 'Ben'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_room_state(self):
        session = GameSession.objects.create(
            room_id='TEST04', mode='STANDARD', max_players=2, host_id='h1'
        )
        Player.objects.create(session=session, player_id='h1', name='Ana', is_host=True)

        response = self.client.get('/api/rooms/TEST04/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['roomId'], 'TEST04')
        self.assertEqual(len(data['players']), 1)

    def test_list_rooms(self):
        GameSession.objects.create(
            room_id='TEST05', mode='STANDARD', max_players=2, host_id='h1', status='WAITING'
        )
        GameSession.objects.create(
            room_id='TEST06', mode='STANDARD', max_players=2, host_id='h2', status='PLAYING'
        )
        response = self.client.get('/api/rooms/list/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        # Solo WAITING
        room_ids = [r['roomId'] for r in data['rooms']]
        self.assertIn('TEST05', room_ids)
        self.assertNotIn('TEST06', room_ids)

    def test_start_room_not_host(self):
        session = GameSession.objects.create(
            room_id='TEST07', mode='STANDARD', max_players=2, host_id='h1'
        )
        Player.objects.create(session=session, player_id='h1', name='Ana', is_host=True)

        response = self.client.post(
            '/api/rooms/TEST07/start/',
            data=json.dumps({'playerId': 'p2'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_start_room_host(self):
        session = GameSession.objects.create(
            room_id='TEST08', mode='STANDARD', max_players=2, host_id='h1'
        )
        host = Player.objects.create(session=session, player_id='h1', name='Ana', is_host=True)

        response = self.client.post(
            '/api/rooms/TEST08/start/',
            data=json.dumps({'playerId': 'h1', 'playerToken': host.auth_token}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['started'])
        self.assertEqual(data['room']['status'], 'PLAYING')

    def test_start_room_host_wrong_token(self):
        """D431: el host sin token válido no puede arrancar la partida."""
        session = GameSession.objects.create(
            room_id='TEST08B', mode='STANDARD', max_players=2, host_id='h1'
        )
        Player.objects.create(session=session, player_id='h1', name='Ana', is_host=True)

        response = self.client.post(
            '/api/rooms/TEST08B/start/',
            data=json.dumps({'playerId': 'h1', 'playerToken': 'wrong'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_leave_room(self):
        session = GameSession.objects.create(
            room_id='TEST09', mode='STANDARD', max_players=2, host_id='h1'
        )
        player = Player.objects.create(session=session, player_id='p2', name='Ben')

        response = self.client.post(
            '/api/rooms/TEST09/leave/',
            data=json.dumps({'playerId': 'p2', 'playerToken': player.auth_token}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['left'])

    def test_leave_room_wrong_token(self):
        """D431: no se puede expulsar a otro jugador sin su token (ni sin ser host)."""
        session = GameSession.objects.create(
            room_id='TEST09B', mode='STANDARD', max_players=2, host_id='h1'
        )
        Player.objects.create(session=session, player_id='p2', name='Ben')

        response = self.client.post(
            '/api/rooms/TEST09B/leave/',
            data=json.dumps({'playerId': 'p2', 'playerToken': 'wrong'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_join_room_returns_token_and_rejoin_requires_it(self):
        """D431: join devuelve authToken; re-join exige el mismo token."""
        session = GameSession.objects.create(
            room_id='TEST01B', mode='STANDARD', max_players=2, host_id='h1'
        )
        Player.objects.create(session=session, player_id='h1', name='Ana', is_host=True)

        response = self.client.post(
            '/api/rooms/TEST01B/join/',
            data=json.dumps({'playerId': 'p2', 'name': 'Ben'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        token = response.json().get('authToken')
        self.assertTrue(token)

        # Re-join con token correcto funciona
        response = self.client.post(
            '/api/rooms/TEST01B/join/',
            data=json.dumps({'playerId': 'p2', 'name': 'Ben', 'playerToken': token}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)

        # Re-join con token incorrecto es rechazado (no suplantación)
        response = self.client.post(
            '/api/rooms/TEST01B/join/',
            data=json.dumps({'playerId': 'p2', 'name': 'Mallory', 'playerToken': 'wrong'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    @patch('game.views.EngineRunnerClient.get_state')
    def test_room_engine_state_requires_token_for_player_view(self, mock_get_state):
        """D431: la vista proyectada de un jugador exige su token (anti-IDOR)."""
        session = GameSession.objects.create(
            room_id='TEST10B', mode='STANDARD', max_players=2, host_id='h1'
        )
        Player.objects.create(session=session, player_id='h1', name='Ana', is_host=True)

        response = self.client.get('/api/rooms/TEST10B/engine/?playerId=h1')
        self.assertEqual(response.status_code, 403)
        mock_get_state.assert_not_called()

    @patch('game.views.EngineRunnerClient.get_state')
    def test_room_engine_state(self, mock_get_state):
        mock_get_state.return_value = {'state': {'phase': 'PLAYER_ATTACK', 'turnNumber': 1}}
        GameSession.objects.create(
            room_id='TEST10', mode='STANDARD', max_players=2, host_id='h1'
        )
        response = self.client.get('/api/rooms/TEST10/engine/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['state']['phase'], 'PLAYER_ATTACK')

    @patch('game.views.EngineRunnerClient.get_state')
    def test_room_engine_state_unavailable(self, mock_get_state):
        mock_get_state.side_effect = Exception('Connection refused')
        GameSession.objects.create(
            room_id='TEST11', mode='STANDARD', max_players=2, host_id='h1'
        )
        response = self.client.get('/api/rooms/TEST11/engine/')
        self.assertEqual(response.status_code, 503)

