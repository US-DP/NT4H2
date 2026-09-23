"""WebSocket consumers for real-time game communication."""
import hmac
import logging
import time
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import transaction
from django.db.models import F, Max

from .engine_client import EngineRunnerClient
from .models import GameEvent, GameSession, Player

logger = logging.getLogger(__name__)

# Límite de mensajes WS por conexión (token bucket simple)
_MSG_WINDOW = 10.0
_MSG_MAX = 20
_CHAT_MAX_LEN = 500


class GameConsumer(AsyncJsonWebsocketConsumer):
    """WebSocket consumer for game rooms.

    D431: la conexión requiere ?playerId=X&token=Y — el token es el
    auth_token emitido por /join/ o /rooms/create/. Sin credenciales
    válidas la conexión se cierra (4403).
    """

    async def connect(self):
        room_id = self.scope["url_route"]["kwargs"].get("room_id", "default")
        self.room_id = room_id
        self.room_group = f"game_{room_id}"

        # D431: autenticar la conexión (query string)
        query = parse_qs(self.scope.get("query_string", b"").decode())
        self.player_id = (query.get("playerId") or [""])[0]
        token = (query.get("token") or [""])[0]
        authenticated = await self.check_player_token(self.player_id, token)
        if not authenticated:
            await self.close(code=4403)
            return

        self._msg_timestamps: list[float] = []
        await self.mark_player_connected(self.player_id)
        await self.channel_layer.group_add(self.room_group, self.channel_name)
        await self.accept()
        await self.send_json({"type": "connected", "roomId": room_id, "playerId": self.player_id})

    async def disconnect(self, close_code):
        if hasattr(self, "room_group"):
            await self.channel_layer.group_discard(self.room_group, self.channel_name)
            if getattr(self, "player_id", None):
                await self.mark_player_disconnected(self.player_id)

    def _throttled(self) -> bool:
        """Token bucket por conexión: True si hay que descartar el mensaje."""
        now = time.monotonic()
        self._msg_timestamps = [
            t for t in self._msg_timestamps if now - t < _MSG_WINDOW
        ]
        if len(self._msg_timestamps) >= _MSG_MAX:
            return True
        self._msg_timestamps.append(now)
        return False

    async def receive_json(self, content):
        if self._throttled():
            await self.send_json({"type": "error", "reason": "rate_limited"})
            return
        msg_type = content.get("type")
        if msg_type == "ping":
            await self.send_json({"type": "pong"})
        elif msg_type == "game.command":
            await self.handle_command(content)
        elif msg_type == "chat.message":
            text = str(content.get("text", ""))[:_CHAT_MAX_LEN]
            await self.broadcast({
                "type": "chat.message",
                # D431: el remitente es el jugador autenticado, no un campo libre
                "sender": self.player_id,
                "text": text,
                "timestamp": content.get("timestamp"),
            })

    async def handle_command(self, content):
        """Persist and broadcast a game command."""
        cid = content.get("cid")
        command = content.get("command")
        payload = content.get("payload", {})

        # D431: el playerId del comando es SIEMPRE el de la conexión
        # autenticada — un cliente no puede enviar comandos a nombre de otro.
        player_id = self.player_id
        if not player_id:
            await self.send_json({
                "type": "game.command_ack",
                "ref": cid,
                "accepted": False,
                "reason": "Unauthenticated connection",
            })
            return

        # Execute command in engine-runner.
        # D409: envolver en database_sync_to_async — httpx.Client es síncrono
        # y bloquearía el event loop hasta 5s por comando.
        try:
            result = await database_sync_to_async(EngineRunnerClient.execute_command)(
                self.room_id, cid, player_id, command
            )
            events = result.get("events", [])
            accepted = result.get("accepted", False)
            reason = result.get("reason")
        except Exception:
            # Runner caído: NO reenviar el comando crudo (los clientes lo
            # aplicarían localmente y cada peer divergiría sin fuente de verdad)
            logger.warning("Engine-runner unavailable for room %s", self.room_id)
            await self.send_json({
                "type": "game.command_ack",
                "ref": cid,
                "accepted": False,
                "reason": "Engine runner unavailable",
            })
            await self.persist_event("COMMAND", player_id, {
                "cid": cid,
                "command": command,
                "accepted": False,
                "reason": "engine_unavailable",
            })
            return

        # Acknowledge con el veredicto real del motor
        await self.send_json({
            "type": "game.command_ack",
            "ref": cid,
            "accepted": accepted,
            "reason": reason,
        })

        # Persist event
        await self.persist_event("COMMAND", player_id, {
            "cid": cid,
            "command": command,
            "payload": payload,
            "accepted": accepted,
            "reason": reason,
        })

        # Broadcast to the room
        # D425 (RF-J095): NO difundir el estado completo — filtraría manos
        # ajenas a todos los receptores. Solo difundir los eventos; cada
        # cliente pide su vista proyectada por GET /engine/?playerId=X.
        await self.broadcast({
            "type": "game.command_result",
            "cid": cid,
            "playerId": player_id,
            "command": command,
            "accepted": accepted,
            "reason": reason,
            "events": events,
            "stateChanged": result.get("stateChanged", False),
        })

    async def broadcast(self, payload):
        """Send a message to the whole room group."""
        await self.channel_layer.group_send(
            self.room_group,
            {"type": "room.message", "message": payload},
        )

    async def room_message(self, event):
        """Handler for group messages."""
        await self.send_json(event["message"])

    @database_sync_to_async
    def persist_event(self, event_type, player_id, data):
        """Asigna seq atómicamente: lock de sesión + MAX(seq)+1 con
        UniqueConstraint(session, seq) como red de seguridad."""
        from django.db import IntegrityError

        try:
            with transaction.atomic():
                session = GameSession.objects.select_for_update().get(
                    room_id=self.room_id
                )
                seq = (
                    GameEvent.objects.filter(session=session).aggregate(
                        m=Max("seq")
                    )["m"]
                    or 0
                ) + 1
                for _ in range(3):
                    try:
                        with transaction.atomic():
                            GameEvent.objects.create(
                                session=session,
                                seq=seq,
                                event_type=event_type,
                                player_id=player_id,
                                data=data,
                            )
                        return
                    except IntegrityError:
                        seq += 1
        except GameSession.DoesNotExist:
            pass

    @database_sync_to_async
    def check_player_token(self, player_id, token):
        """D431: verify (player_id, token) against the room's members."""
        if not player_id or not token:
            return False
        try:
            session = GameSession.objects.get(room_id=self.room_id)
        except GameSession.DoesNotExist:
            return False
        player = Player.objects.filter(session=session, player_id=player_id).first()
        if player is None:
            return False
        return hmac.compare_digest(player.auth_token, token)

    @database_sync_to_async
    def mark_player_connected(self, player_id):
        """Refcount de conexiones: is_connected solo se apaga cuando
        TODAS las conexiones del jugador se cierran."""
        try:
            session = GameSession.objects.get(room_id=self.room_id)
        except GameSession.DoesNotExist:
            return
        Player.objects.filter(session=session, player_id=player_id).update(
            connection_count=F("connection_count") + 1,
            is_connected=True,
        )

    @database_sync_to_async
    def mark_player_disconnected(self, player_id):
        try:
            session = GameSession.objects.get(room_id=self.room_id)
        except GameSession.DoesNotExist:
            return
        Player.objects.filter(
            session=session, player_id=player_id, connection_count__gt=0
        ).update(connection_count=F("connection_count") - 1)
        Player.objects.filter(
            session=session, player_id=player_id, connection_count__lte=0
        ).update(is_connected=False, connection_count=0)
