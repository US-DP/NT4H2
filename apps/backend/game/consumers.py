"""WebSocket consumers for real-time game communication."""

import logging
import re
import time
from urllib.parse import parse_qs

import httpx  # noqa: ASYNC127 - httpx sigue mantenido; la sugerencia httpx2 es errónea
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import transaction
from django.db.models import F, Max

from .engine_client import EngineRunnerClient
from .models import GameEvent, GameSession, Player
from .store import chat_cmid_is_duplicate, spectator_remove, spectator_try_add

logger = logging.getLogger(__name__)

# Límite de mensajes WS por conexión (token bucket simple)
_MSG_WINDOW = 10.0
_MSG_MAX = 20
_CHAT_MAX_LEN = 500
# Rate limit específico de chat (además del bucket genérico)
_CHAT_WINDOW = 5.0
_CHAT_MAX = 5
# Retención de mensajes CHAT en GameEvent (B-26): no forman parte del
# replay del motor; conservar el texto entero para siempre era
# crecimiento de log + residuo de privacidad.
_CHAT_RETENTION = 200
# Mismo whitelist que SAFE_ID del runner (R-1): el cid persiste en
# GameEvent.cid — caracteres de control serían log-forging latente.
_SAFE_CID = re.compile(r"^[\w.@:+-]{1,128}$")
# Tope de bytes por frame WS: _MSG_MAX limita frecuencia pero no tamaño —
# un comando enorme se persistía entero en GameEvent.data incluso en
# rechazos. 32 KiB sobra para cualquier comando real del juego.
_MSG_MAX_BYTES = 32 * 1024
# Cap de espectadores por sala: vive en game.store (cache compartida —
# global con Redis, por proceso con LocMem). Antes el cap era por
# proceso: N workers = capa efectiva de N×32.


class GameConsumer(AsyncJsonWebsocketConsumer):
    """WebSocket consumer for game rooms.

    La conexión requiere ?ticket=<ticket efímero> emitido por
    POST /ws-ticket/ (un solo uso, ~60s, vinculado a sala+jugador).
    Sin credencial válida se cierra con 4403.
    """

    async def connect(self):
        room_id = self.scope.get("url_route", {}).get("kwargs", {}).get("room_id", "default")
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
            # Espectador de una sala inexistente: cerrar en vez de dejar
            # el socket unido a un grupo muerto para siempre.
            if not await self.room_exists():
                await self.close(code=4404)
                return
            # Cap de espectadores por sala (global con Redis): el
            # espectador no lleva ticket, así que sin límite bastaba un
            # bucle de ?spectator=1 para agotar el channel layer. El
            # check+increment es atómico en store — se descuenta en
            # disconnect() (o expira por TTL si el proceso muere).
            if not await database_sync_to_async(spectator_try_add)(room_id):
                await self.close(code=4429)
                return
            self._spectator_counted = True
            self.player_id = ""
        elif ticket:
            from .views import consume_ws_ticket

            player_id = consume_ws_ticket(ticket, room_id)
            if player_id is None:
                await self.close(code=4403)
                return
            # Igual que el espectador: un ticket válido para una sala ya
            # cerrada/borrada no debe dejar el socket unido a un grupo
            # muerto (y evita que un ticket reciclado entre a una sala
            # nueva con el mismo room_id dentro del TTL).
            if not await self.room_exists():
                await self.close(code=4404)
                return
            self.player_id = player_id
        else:
            await self.close(code=4403)
            return

        self._msg_timestamps: list[float] = []
        self._chat_timestamps: list[float] = []
        await self.channel_layer.group_add(self.room_group, self.channel_name)
        await self.accept()
        # Marcar conectado DESPUÉS del accept: si group_add/accept lanza,
        # disconnect() nunca corre y el refcount quedaría en positivo para
        # siempre (sala inborrable, host intransferible).
        if self.player_id:
            connected = await self.mark_player_connected(self.player_id)
            if not connected:
                # La fila Player desapareció entre el consume del ticket
                # y el group_add (kick/leave o sala cerrada): el broadcast
                # de baja ya se emitió y este socket lo perdió — cerrarlo
                # aquí o seguiría recibiendo tráfico y enviando comandos.
                await self.close(code=4403)
                return
            self._presence_counted = True
        await self.send_json(
            {
                "type": "connected",
                "roomId": room_id,
                "playerId": self.player_id,
                "spectator": self.spectator,
            }
        )
        if getattr(self, "_presence_counted", False):
            # Difundir la presencia DESPUÉS del handshake: sin esto el roster
            # seguía mostrando "Desconectado" al recién conectado. Va tras
            # `connected` para no romper el orden del primer frame.
            await self.broadcast(
                {"type": "room.player_connected", "playerId": self.player_id}
            )

    async def disconnect(self, code):
        if getattr(self, "_spectator_counted", False):
            await database_sync_to_async(spectator_remove)(self.room_id)
        if hasattr(self, "room_group"):
            await self.channel_layer.group_discard(self.room_group, self.channel_name)
            # Solo si este socket llegó a contarse en mark_player_connected;
            # un close temprano (4403) no debe decrementar ni difundir baja.
            if getattr(self, "_presence_counted", False) and getattr(self, "player_id", None):
                await self.mark_player_disconnected(self.player_id)
                await self.broadcast(
                    {"type": "room.player_disconnected", "playerId": self.player_id}
                )
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

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        # Cap de tamaño ANTES de json.loads: un frame gigante además de
        # inflar el log consumía CPU de parsing en cada conexión.
        size = len(text_data.encode()) if text_data is not None else len(bytes_data or b"")
        if size > _MSG_MAX_BYTES:
            await self.send_json({"type": "error", "reason": "message_too_large"})
            return
        await super().receive(text_data=text_data, bytes_data=bytes_data, **kwargs)

    async def receive_json(self, content, **kwargs):
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
        else:
            # Tipo desconocido o chat en sala FINISHED: antes moría en
            # silencio y el cliente no distinguía typo de descarte.
            await self.send_json({"type": "error", "reason": "unknown_message_type"})

    def _chat_rate_limited(self) -> bool:
        """Token bucket de chat (5 msg / 5 s por conexión). True = descartar."""
        now = time.monotonic()
        self._chat_timestamps = [t for t in self._chat_timestamps if now - t < _CHAT_WINDOW]
        if len(self._chat_timestamps) >= _CHAT_MAX:
            return True
        self._chat_timestamps.append(now)
        return False

    async def _seen_client_message(self, content) -> str | None:
        """Idempotencia por clientMessageId (reintentos tras reconexión).

        Devuelve el cmid normalizado ("" si no viene) o None si es un
        duplicado ya emitido. La dedup vive en store (cache compartida):
        antes era un set por conexión — el resend tras reconectar en un
        socket nuevo (o en otra pestaña) no estaba cubierto.
        """
        cmid = str(content.get("clientMessageId") or "")[:64]
        if not cmid:
            return ""
        if await database_sync_to_async(chat_cmid_is_duplicate)(self.room_id, self.player_id, cmid):
            return None
        return cmid

    @staticmethod
    def _sanitize_chat_text(raw: str) -> str:
        """Texto plano: fuera caracteres de control y saltos de línea colapsados."""
        text = "".join(c for c in raw if c in "\n\t" or ord(c) >= 32)
        return re.sub(r"\n{3,}", "\n\n", text).strip()

    @staticmethod
    def _sanitize_chat_meta(meta_raw):
        """Ping estructurado opcional (emote con objetivo).

        Solo se admite un subconjunto blanqueado — el cliente no puede
        inyectar campos arbitrarios en el meta.
        """
        if not isinstance(meta_raw, dict) or meta_raw.get("kind") != "ping":
            return None
        meta = {"kind": "ping"}
        target = meta_raw.get("target")
        if isinstance(target, str) and target:
            meta["target"] = target[:100]
        return meta

    async def handle_chat(self, content):
        """Chat de sala: servidor asigna sender/tipo/seq/timestamp."""
        if self._chat_rate_limited():
            await self.send_json({"type": "error", "reason": "chat_rate_limited"})
            return

        text = self._sanitize_chat_text(str(content.get("text", ""))[:_CHAT_MAX_LEN])
        if not text:
            return

        # La fila Player pudo borrarse tras el connect (kick/leave cuyo
        # broadcast de cierre se perdió): sin membresía no hay chat ni
        # comandos en nombre de un jugador que ya no existe.
        if self.player_id and not await self.player_is_member():
            await self.close(code=4403)
            return

        # La dedup va DESPUÉS de validar: consumir el cmid en un mensaje
        # rechazado (vacío o jugador expulsado) quemaba el token y el
        # reintento legítimo se descartaba como duplicado.
        cmid = await self._seen_client_message(content)
        if cmid is None:
            return  # duplicado: ya fue emitido

        meta = self._sanitize_chat_meta(content.get("meta"))
        seq, _ = await self.persist_event("CHAT", self.player_id, {"text": text, **({"meta": meta} if meta else {})})
        # B-26: los CHAT no participan en el replay del motor (solo los
        # comandos) — conservar el texto completo para siempre era
        # crecimiento de log + residuo de privacidad. Retención FIFO.
        await self._prune_chat_events()
        await self.broadcast(
            {
                "type": "chat.message",
                # Identidad y orden asignados por el servidor (D431)
                "messageId": f"chat-{seq}" if seq is not None else f"chat-{int(time.monotonic() * 1000)}",
                "seq": seq,
                "clientMessageId": cmid or None,
                "sender": self.player_id,
                "text": text,
                "timestamp": int(time.time() * 1000),
                **({"meta": meta} if meta else {}),
            }
        )

    @database_sync_to_async
    def _prune_chat_events(self):
        """Conservar solo los últimos _CHAT_RETENTION mensajes CHAT por sesión."""
        session = GameSession.objects.filter(room_id=self.room_id).first()
        if session is None:
            return
        chat_ids = list(
            GameEvent.objects.filter(session=session, event_type="CHAT")
            .order_by("-seq")
            .values_list("id", flat=True)[_CHAT_RETENTION:]
        )
        if chat_ids:
            GameEvent.objects.filter(id__in=chat_ids).delete()

    async def handle_command(self, content):
        """Persist and broadcast a game command."""
        cid = content.get("cid")
        command = content.get("command")

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
        # un posible vector para hinchar el log de eventos). Junto al
        # status se re-verifica la membresía (revocación post-connect).
        status, still_member = await self.get_session_status_and_membership()
        if not still_member:
            await self.close(code=4403)
            return
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

        # Sin cid válido ni command dict no hay nada que deduplicar ni
        # ejecutar: el runner los rechazaría con 400 y el cliente vería
        # "engine_unavailable" — motivo engañoso y un GameEvent de
        # transporte registrado por un fallo del cliente, no del motor.
        # C-3: cid también acotado a 128 (columna GameEvent.cid y límite
        # del runner) — un cid más largo generaba un IntegrityError que
        # se confundía con una colisión de dedup. R-1 simétrico: el mismo
        # charset whitelist que el runner (SAFE_ID) — un cid con \n o
        # caracteres de control persistiría tal cual en GameEvent.cid y
        # permitiría forjar líneas de log al exportar/inspeccionar.
        if (
            not cid
            or not isinstance(cid, str)
            or len(cid) > 128
            or not _SAFE_CID.match(cid)
            or not isinstance(command, dict)
            or not command.get("type")
        ):
            await self.send_json(
                {
                    "type": "game.command_ack",
                    "ref": cid,
                    "accepted": False,
                    "reason": "Missing or invalid command",
                }
            )
            return

        # Idempotencia persistente (Fase 2): si este cid ya se procesó en
        # esta sala (GameEvent durable), devolver el veredicto registrado
        # sin re-ejecutar en el runner. El runner también deduplica cids
        # en memoria; este chequeo sobrevive a reinicios del runner sin
        # STATE_DIR y cubre el resend tras reconexión del cliente.
        seen = await self._command_seen(cid)
        if seen is not None:
            await self.send_json(
                {
                    "type": "game.command_ack",
                    "ref": cid,
                    "accepted": seen["accepted"],
                    "reason": seen["reason"],
                    "deduplicated": True,
                }
            )
            return

        # Execute command in engine-runner.
        # D409: envolver en database_sync_to_async — httpx.Client es síncrono
        # y bloquearía el event loop hasta 5s por comando.
        result = await self._execute_command_request(cid, player_id, command, content)
        if result is None:
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
                # Sin cid en la columna: este registro es solo un log de
                # transporte — el reintento legítimo debe poder persistir
                # su veredicto real con el mismo cid (dedup en columna).
            )
            return

        accepted = result.get("accepted", False)
        # El runner usa `reason` para rechazos del motor y `error` para
        # rechazos de transporte (stale_revision, rate limit). Sin el
        # fallback, un 409 llegaba al cliente con reason=null: ni resync
        # ni feedback — el comando se perdía en silencio.
        reason = result.get("reason") or result.get("error")
        revision = result.get("revision")

        # Persistir ANTES del ack: si otro proceso ya registró el veredicto
        # de este cid (carrera de reintentos), el registro persistido es la
        # fuente de verdad — nuestro resultado local podría diverger si el
        # runner reinició entre ambas ejecuciones.
        seq, deduplicated = await self.persist_event(
            "COMMAND",
            player_id,
            {
                "cid": cid,
                "command": command,
                "accepted": accepted,
                "reason": reason,
            },
            cid=cid,
        )
        if deduplicated:
            seen = await self._command_seen(cid)
            await self.send_json(
                {
                    "type": "game.command_ack",
                    "ref": cid,
                    "accepted": seen["accepted"] if seen else accepted,
                    "reason": seen["reason"] if seen else reason,
                    "deduplicated": True,
                }
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
        # Fase 2: snapshot periódico + cierre de sala en GAME_ENDED.
        await self._finalize_command(seq, result.get("events") or [])

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
            # Solo el TIPO de comando: el payload completo contiene
            # cardInstanceIds, targets y selectedIds privados — un
            # espectador del grupo los leería (mismo criterio que
            # /sync/, que solo expone el tipo).
            "commandType": command.get("type") if isinstance(command, dict) else command,
            "accepted": accepted,
            "reason": reason,
            "stateChanged": result.get("stateChanged", False),
        }
        # La revisión permite a todos los clientes (no solo al emisor, que ya
        # recibe el ack) mantener lastRevision sincronizada sin re-pedir.
        if revision is not None:
            broadcast_msg["revision"] = revision
        await self.broadcast(broadcast_msg)

    async def _execute_command_request(self, cid, player_id, command, content):
        """Ejecuta el comando en el runner. None = runner no disponible.

        Ante un 404 (runner reiniciado sin STATE_DIR y la sala perdida)
        intenta restaurarla desde el último GameSnapshot y reintenta una
        vez — los snapshots dejan de ser almacenamiento muerto.
        """
        call = database_sync_to_async(EngineRunnerClient.execute_command)
        kwargs = {
            "expected_revision": content.get("expectedRevision"),
            "client_sequence": content.get("clientSequence"),
        }
        try:
            return await call(self.room_id, cid, player_id, command, **kwargs)
        except httpx.HTTPStatusError as exc:
            if exc.response is None or exc.response.status_code != 404:
                return None
        except (httpx.HTTPError, ValueError):
            return None
        from .views.engine import restore_room_from_snapshot

        if not await database_sync_to_async(restore_room_from_snapshot)(self.room_id):
            return None
        try:
            return await call(self.room_id, cid, player_id, command, **kwargs)
        except (httpx.HTTPError, ValueError):
            return None

    @database_sync_to_async
    def _command_seen(self, cid):
        """Veredicto ya persistido para este cid en esta sala, o None.

        Los registros de fallo de transporte (engine_unavailable) no
        vetan el reintento: si el runner sí lo aplicó (respuesta
        perdida), su dedup en memoria devuelve el ack cacheado; si no,
        se ejecuta por primera vez. Excluirlos de la query evita además
        que un registro de fallo viejo opaque el resultado posterior.
        """
        if not cid or not isinstance(cid, str):
            return None
        event = (
            GameEvent.objects.filter(session__room_id=self.room_id, event_type="COMMAND", cid=cid)
            .exclude(data__reason="engine_unavailable")
            .first()
        )
        if event is None:
            return None
        return {
            "accepted": bool((event.data or {}).get("accepted", False)),
            "reason": (event.data or {}).get("reason"),
        }

    @database_sync_to_async
    def _finalize_command(self, seq, events):
        """Post-comando: snapshot periódico y cierre de sala en GAME_ENDED."""
        from .views.engine import SNAPSHOT_EVERY_EVENTS, mark_finished, take_snapshot

        session = GameSession.objects.filter(room_id=self.room_id).first()
        if session is None:
            return
        ended = next(
            (e for e in events if isinstance(e, dict) and e.get("type") == "GAME_ENDED"),
            None,
        )
        if ended is not None:
            mark_finished(session, ended.get("winnerId"))
        elif seq is not None:
            # El seq global también cuenta mensajes CHAT — el checkpoint
            # debe dispararse por comandos de partida, no por charla.
            command_events = GameEvent.objects.filter(session=session, event_type="COMMAND").count()
            if command_events > 0 and command_events % SNAPSHOT_EVERY_EVENTS == 0:
                take_snapshot(session)

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
        # Espectadores: sin chat de sala — es conversación privada entre
        # jugadores; un spectator sin credencial no debe leerla.
        if self.spectator and msg.get("type") == "chat.message":
            return
        await self.send_json(msg)

    @database_sync_to_async
    def persist_event(self, event_type, player_id, data, cid=None):
        """Asigna seq atómicamente.

        Lock de sesión + MAX(seq)+1 con UniqueConstraint(session, seq)
        como red de seguridad. Con ``cid`` informado, la constraint
        única (session, cid) hace la dedup atómica: dos peticiones
        concurrentes con el mismo cid no pueden dejar veredictos
        divergentes — la segunda devuelve el seq ya registrado.
        Devuelve (seq, deduplicado): seq=None si la sala no existe;
        deduplicado=True cuando el cid ya tenía veredicto registrado.
        """
        from django.db import IntegrityError

        # B-26: el chat NO toma el lock de sesión — cada mensaje
        # serializaba contra los comandos de partida (MAX(seq) bajo
        # select_for_update). El seq solo ordena mensajes: una colisión
        # (session, seq) concurrente se resuelve releyendo el MAX.
        if event_type == "CHAT":
            try:
                session = GameSession.objects.get(room_id=self.room_id)
            except GameSession.DoesNotExist:
                return None, False
            for _ in range(4):
                seq = (GameEvent.objects.filter(session=session).aggregate(m=Max("seq"))["m"] or 0) + 1
                try:
                    with transaction.atomic():
                        GameEvent.objects.create(
                            session=session,
                            seq=seq,
                            event_type=event_type,
                            player_id=player_id,
                            cid=None,
                            data=data,
                        )
                    return seq, False
                except IntegrityError:
                    continue
            return None, False

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
                                cid=cid,
                                data=data,
                            )
                        return seq, False
                    except IntegrityError:
                        # Colisión de cid (no de seq): el comando ya tiene
                        # veredicto registrado — reutilizar su seq e
                        # informar al llamador (dedup), que NO debe
                        # re-broadcast su resultado local: podría divergir
                        # si el runner reinició entre ambas ejecuciones.
                        if cid:
                            existing = (
                                GameEvent.objects.filter(session=session, cid=cid).values_list("seq", flat=True).first()
                            )
                            if existing is not None:
                                return existing, True
                        seq += 1
        except GameSession.DoesNotExist:
            return None, False
        return None, False

    @database_sync_to_async
    def room_exists(self):
        """True si la sala existe (para validar espectadores)."""
        return GameSession.objects.filter(room_id=self.room_id).exists()

    @database_sync_to_async
    def get_session_status(self):
        """Estado de la sala ('WAITING'|'PLAYING'|'FINISHED') o None."""
        return GameSession.objects.filter(room_id=self.room_id).values_list("status", flat=True).first()

    @database_sync_to_async
    def get_session_status_and_membership(self):
        """(status, member) en una sola consulta por comando.

        `member` es True para espectadores (no envían comandos, pero el
        flag evita cerrar su socket en el guard de handle_command).
        """
        session = GameSession.objects.filter(room_id=self.room_id).first()
        if session is None:
            return None, False
        if self.spectator or not self.player_id:
            return session.status, self.spectator
        return session.status, session.players.filter(player_id=self.player_id).exists()

    @database_sync_to_async
    def player_is_member(self) -> bool:
        """La fila Player sigue existiendo (revocación kick/leave)."""
        if not self.player_id:
            return False
        return Player.objects.filter(session__room_id=self.room_id, player_id=self.player_id).exists()

    @database_sync_to_async
    def mark_player_connected(self, player_id) -> bool:
        """Refcount de conexiones del jugador; False si ya no es miembro.

        is_connected solo se apaga cuando TODAS las conexiones del
        jugador se cierran. La fila se bloquea (select_for_update) para
        que un connect concurrente con un disconnect no deje el flag
        inconsistente.
        """
        try:
            with transaction.atomic():
                session = GameSession.objects.select_for_update().get(room_id=self.room_id)
                player = Player.objects.select_for_update().filter(session=session, player_id=player_id).first()
                if player is None:
                    return False
                player.connection_count = (player.connection_count or 0) + 1
                player.is_connected = True
                player.save(update_fields=["connection_count", "is_connected"])
                return True
        except GameSession.DoesNotExist:
            return False

    @database_sync_to_async
    def mark_player_disconnected(self, player_id):
        try:
            with transaction.atomic():
                session = GameSession.objects.select_for_update().get(room_id=self.room_id)
                player = Player.objects.select_for_update().filter(session=session, player_id=player_id).first()
                if player is None:
                    return
                player.connection_count = max(0, (player.connection_count or 0) - 1)
                player.is_connected = player.connection_count > 0
                player.save(update_fields=["connection_count", "is_connected"])
        except GameSession.DoesNotExist:
            return

    @database_sync_to_async
    def transfer_host_if_disconnected(self, player_id):
        """Auto-transferencia de host tras desconexión completa.

        Si el host se desconectó del todo (todas sus conexiones caídas)
        en una sala WAITING o PLAYING, promociona al jugador conectado más
        antiguo — sin esto, una sala en partida con el host ausente quedaba
        ingobernable (skip_turn/close exigen el token del host).

        Devuelve (new_host_id, revision) o None si no aplica (no era host,
        sigue conectado por otra conexión, sala FINISHED, o sala vacía —
        en ese caso la sala se limpia por el flujo normal de leave).
        """
        try:
            with transaction.atomic():
                session = GameSession.objects.select_for_update().get(room_id=self.room_id)
                if session.status == "FINISHED" or session.host_id != player_id:
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
