"""WebSocket consumers for real-time game communication."""

import logging
import re
import time
from collections import deque
from urllib.parse import parse_qs

import httpx  # noqa: ASYNC127 - httpx sigue mantenido; la sugerencia httpx2 es errónea
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
# Rate limit específico de chat (además del bucket genérico)
_CHAT_WINDOW = 5.0
_CHAT_MAX = 5
# Idempotencia: cuántos clientMessageId recordar por conexión
_CMID_CACHE = 64


class GameConsumer(AsyncJsonWebsocketConsumer):
    """WebSocket consumer for game rooms.

    La conexión requiere ?ticket=<ticket efímero> emitido por
    POST /ws-ticket/ (un solo uso, ~60s, vinculado a sala+jugador).
    Sin credencial válida se cierra con 4403.
    """

    async def connect(self):
        room_id = self.scope["url_route"]["kwargs"].get("room_id", "default")
        self.room_id = room_id
        self.room_group = f"game_{room_id}"

        # D431: autenticar la conexión con ?ticket=<ticket efímero> emitido
        # por /ws-ticket/ (un solo uso, 60s, vinculado a sala+jugador).
        # La ruta legada ?playerId&token se retiró: el token de larga vida
        # quedaba en URLs y logs de proxy.
        query = parse_qs(self.scope.get("query_string", b"").decode())
        # Espectador: solo lectura. Sin ticket/token, sin player_id — el
        # engine-runner ya devuelve vista proyectada pública sin playerId
        # (D435). No puede enviar comandos ni chat: solo ping/pong.
        self.spectator = (query.get("spectator") or [""])[0] == "1"
        ticket = (query.get("ticket") or [""])[0]
        if self.spectator:
            self.player_id = ""
        elif ticket:
            from .views import consume_ws_ticket

            player_id = consume_ws_ticket(ticket, room_id)
            if player_id is None:
                await self.close(code=4403)
                return
            self.player_id = player_id
        else:
            await self.close(code=4403)
            return

        self._msg_timestamps: list[float] = []
        self._chat_timestamps: list[float] = []
        self._seen_cmids: deque = deque(maxlen=_CMID_CACHE)
        await self.channel_layer.group_add(self.room_group, self.channel_name)
        await self.accept()
        # Marcar conectado DESPUÉS del accept: si group_add/accept lanza,
        # disconnect() nunca corre y el refcount quedaría en positivo para
        # siempre (sala inborrable, host intransferible).
        if self.player_id:
            await self.mark_player_connected(self.player_id)
        await self.send_json(
            {
                "type": "connected",
                "roomId": room_id,
                "playerId": self.player_id,
                "spectator": self.spectator,
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, "room_group"):
            await self.channel_layer.group_discard(self.room_group, self.channel_name)
            if getattr(self, "player_id", None):
                await self.mark_player_disconnected(self.player_id)
                # Si quien se fue era el host y la sala sigue en espera, el
                # anfitrión pasa al jugador conectado más antiguo.
                result = await self.transfer_host_if_disconnected(self.player_id)
                if result:
                    new_host_id, revision = result
                    await self.broadcast(
                        {
                            "type": "room.host_changed",
                            "playerId": new_host_id,
                            "roomRevision": revision,
                        }
                    )

    def _throttled(self) -> bool:
        """Token bucket por conexión: True si hay que descartar el mensaje."""
        now = time.monotonic()
        self._msg_timestamps = [t for t in self._msg_timestamps if now - t < _MSG_WINDOW]
        if len(self._msg_timestamps) >= _MSG_MAX:
            return True
        self._msg_timestamps.append(now)
        return False

    async def receive_json(self, content):
        if self._throttled():
            await self.send_json({"type": "error", "reason": "rate_limited"})
            return
        if getattr(self, "spectator", False):
            # Espectadores: solo ping/pong; ni comandos ni chat
            if content.get("type") == "ping":
                await self.send_json({"type": "pong"})
            return
        msg_type = content.get("type")
        if msg_type == "ping":
            await self.send_json({"type": "pong"})
        elif msg_type == "game.command":
            await self.handle_command(content)
        elif msg_type == "chat.message" and (await self.get_session_status()) != "FINISHED":
            # Sala FINISHED: no aceptar más chat — el log de GameEvent
            # crecería indefinidamente tras el cierre de la partida.
            await self.handle_chat(content)

    async def handle_chat(self, content):
        """Chat de sala: servidor asigna sender/tipo/seq/timestamp.

        - Rate limit propio (5 msg / 5 s por conexión).
        - Idempotencia por clientMessageId (reintentos tras reconexión).
        - Sanitización: el chat es texto plano — se eliminan caracteres de
          control y se normalizan saltos de línea.
        """
        now = time.monotonic()
        self._chat_timestamps = [t for t in self._chat_timestamps if now - t < _CHAT_WINDOW]
        if len(self._chat_timestamps) >= _CHAT_MAX:
            await self.send_json({"type": "error", "reason": "chat_rate_limited"})
            return
        self._chat_timestamps.append(now)

        cmid = str(content.get("clientMessageId") or "")[:64]
        if cmid:
            if cmid in self._seen_cmids:
                return  # duplicado: ya fue emitido
            self._seen_cmids.append(cmid)

        raw = str(content.get("text", ""))[:_CHAT_MAX_LEN]
        text = "".join(c for c in raw if c in "\n\t" or ord(c) >= 32)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if not text:
            return

        # Ping estructurado opcional (emote con objetivo): solo se admite
        # un subconjunto blanqueado — el cliente no puede inyectar campos.
        meta_raw = content.get("meta")
        meta = None
        if isinstance(meta_raw, dict) and meta_raw.get("kind") == "ping":
            target = meta_raw.get("target")
            meta = {"kind": "ping"}
            if isinstance(target, str) and target:
                meta["target"] = target[:100]

        seq = await self.persist_event("CHAT", self.player_id, {"text": text, **({"meta": meta} if meta else {})})
        await self.broadcast(
            {
                "type": "chat.message",
                # Identidad y orden asignados por el servidor (D431)
                "messageId": f"chat-{seq}" if seq is not None else f"chat-{int(now * 1000)}",
                "seq": seq,
                "clientMessageId": cmid or None,
                "sender": self.player_id,
                "text": text,
                "timestamp": int(time.time() * 1000),
                **({"meta": meta} if meta else {}),
            }
        )

    async def handle_command(self, content):
        """Persist and broadcast a game command."""
        cid = content.get("cid")
        command = content.get("command")
        payload = content.get("payload", {})

        # D431: el playerId del comando es SIEMPRE el de la conexión
        # autenticada — un cliente no puede enviar comandos a nombre de otro.
        player_id = self.player_id
        if not player_id:
            await self.send_json(
                {
                    "type": "game.command_ack",
                    "ref": cid,
                    "accepted": False,
                    "reason": "Unauthenticated connection",
                }
            )
            return

        # Solo PLAYING acepta comandos: en WAITING aún no hay motor
        # arrancado y en FINISHED cualquier comando es ruido muerto (y
        # un posible vector para hinchar el log de eventos).
        status = await self.get_session_status()
        if status != "PLAYING":
            await self.send_json(
                {
                    "type": "game.command_ack",
                    "ref": cid,
                    "accepted": False,
                    "reason": f"Room is not in play (status={status or 'unknown'})",
                }
            )
            return

        # Execute command in engine-runner.
        # D409: envolver en database_sync_to_async — httpx.Client es síncrono
        # y bloquearía el event loop hasta 5s por comando.
        try:
            result = await database_sync_to_async(EngineRunnerClient.execute_command)(
                self.room_id,
                cid,
                player_id,
                command,
                expected_revision=content.get("expectedRevision"),
                client_sequence=content.get("clientSequence"),
            )
            accepted = result.get("accepted", False)
            # El runner usa `reason` para rechazos del motor y `error` para
            # rechazos de transporte (stale_revision, rate limit). Sin el
            # fallback, un 409 llegaba al cliente con reason=null: ni resync
            # ni feedback — el comando se perdía en silencio.
            reason = result.get("reason") or result.get("error")
            revision = result.get("revision")
        except (httpx.HTTPError, ValueError):
            # Runner caído: NO reenviar el comando crudo (los clientes lo
            # aplicarían localmente y cada peer divergiría sin fuente de verdad)
            logger.warning("Engine-runner unavailable for room %s", self.room_id)
            await self.send_json(
                {
                    "type": "game.command_ack",
                    "ref": cid,
                    "accepted": False,
                    "reason": "Engine runner unavailable",
                }
            )
            await self.persist_event(
                "COMMAND",
                player_id,
                {
                    "cid": cid,
                    "command": command,
                    "accepted": False,
                    "reason": "engine_unavailable",
                },
            )
            return

        # Acknowledge con el veredicto real del motor + revisión de estado
        ack = {
            "type": "game.command_ack",
            "ref": cid,
            "accepted": accepted,
            "reason": reason,
        }
        if revision is not None:
            ack["revision"] = revision
        await self.send_json(ack)

        # Persist event
        await self.persist_event(
            "COMMAND",
            player_id,
            {
                "cid": cid,
                "command": command,
                "payload": payload,
                "accepted": accepted,
                "reason": reason,
            },
        )

        # Broadcast to the room
        # D425 (RF-J095): NO difundir el estado completo — filtraría manos
        # ajenas a todos los receptores. Tampoco se difunden los `events`
        # en crudo: contienen info privada (cartas robadas, orden futuro
        # del mazo, descartes de evasión) legible por cualquier conexión
        # del grupo — incluidos espectadores sin credencial. Cada cliente
        # re-pide su vista proyectada por GET /engine/?playerId=X cuando
        # `stateChanged` es true.
        broadcast_msg = {
            "type": "game.command_result",
            "cid": cid,
            "playerId": player_id,
            "command": command,
            "accepted": accepted,
            "reason": reason,
            "stateChanged": result.get("stateChanged", False),
        }
        # La revisión permite a TODOS los clientes (no solo al emisor, que ya
        # recibe el ack) mantener lastRevision sincronizada sin re-pedir.
        if revision is not None:
            broadcast_msg["revision"] = revision
        await self.broadcast(broadcast_msg)

    async def broadcast(self, payload):
        """Send a message to the whole room group."""
        await self.channel_layer.group_send(
            self.room_group,
            {"type": "room.message", "message": payload},
        )

    async def room_message(self, event):
        """Handler for group messages."""
        msg = event["message"]
        # D440: si esta conexión pertenece al jugador expulsado, cerrarla —
        # su token ya no sirve y no debe seguir recibiendo mensajes de sala.
        if msg.get("type") == "room.player_kicked" and msg.get("playerId") == self.player_id:
            await self.send_json(msg)
            await self.close(code=4401)
            return
        # Abandono por REST: cerrar las conexiones de quien se fue para
        # que no sigan recibiendo broadcasts ni enviando comandos.
        if msg.get("type") == "room.player_left" and msg.get("playerId") == self.player_id:
            await self.send_json(msg)
            await self.close(code=4400)
            return
        # Sala cerrada/borrada: cerrar TODAS las conexiones del grupo —
        # sin esto los sockets quedan abiertos contra una sala que ya no
        # existe en Django (cada heartbeat/chat rebotaba contra 404/None).
        if msg.get("type") == "room.closed":
            await self.send_json(msg)
            await self.close(code=4400)
            return
        await self.send_json(msg)

    @database_sync_to_async
    def persist_event(self, event_type, player_id, data):
        """Asigna seq atómicamente.

        Lock de sesión + MAX(seq)+1 con UniqueConstraint(session, seq)
        como red de seguridad. Devuelve el seq asignado (None si la
        sala no existe).
        """
        from django.db import IntegrityError

        try:
            with transaction.atomic():
                session = GameSession.objects.select_for_update().get(room_id=self.room_id)
                seq = (GameEvent.objects.filter(session=session).aggregate(m=Max("seq"))["m"] or 0) + 1
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
                        return seq
                    except IntegrityError:
                        seq += 1
        except GameSession.DoesNotExist:
            return None
        return None

    @database_sync_to_async
    def get_session_status(self):
        """Estado de la sala ('WAITING'|'PLAYING'|'FINISHED') o None."""
        return GameSession.objects.filter(room_id=self.room_id).values_list("status", flat=True).first()

    @database_sync_to_async
    def mark_player_connected(self, player_id):
        """Refcount de conexiones del jugador.

        is_connected solo se apaga cuando TODAS las conexiones del
        jugador se cierran.
        """
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
        Player.objects.filter(session=session, player_id=player_id, connection_count__gt=0).update(
            connection_count=F("connection_count") - 1
        )
        Player.objects.filter(session=session, player_id=player_id, connection_count__lte=0).update(
            is_connected=False, connection_count=0
        )

    @database_sync_to_async
    def transfer_host_if_disconnected(self, player_id):
        """Auto-transferencia de host tras desconexión completa.

        Si el host se desconectó del todo en una sala WAITING, promociona
        al jugador conectado más antiguo.

        Devuelve (new_host_id, revision) o None si no aplica (no era host,
        sigue conectado por otra conexión, sala en juego, o sala vacía —
        en ese caso la sala se limpia por el flujo normal de leave).
        """
        try:
            with transaction.atomic():
                session = GameSession.objects.select_for_update().get(room_id=self.room_id)
                if session.status != "WAITING" or session.host_id != player_id:
                    return None
                host = Player.objects.filter(session=session, player_id=player_id).first()
                if host is None:
                    return None
                if host.is_connected:
                    return None  # sigue conectado por otra pestaña/dispositivo
                nxt = (
                    Player.objects.filter(session=session, is_connected=True)
                    .exclude(player_id=player_id)
                    .order_by("id")
                    .first()
                )
                if nxt is None:
                    return None
                host.is_host = False
                host.save(update_fields=["is_host"])
                nxt.is_host = True
                nxt.save(update_fields=["is_host"])
                session.host_id = nxt.player_id
                session.save(update_fields=["host_id"])
                GameSession.objects.filter(pk=session.pk).update(revision=F("revision") + 1)
                session.refresh_from_db(fields=["revision"])
                return nxt.player_id, session.revision
        except GameSession.DoesNotExist:
            return None
