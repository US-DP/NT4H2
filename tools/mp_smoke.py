#!/usr/bin/env python
"""Smoke E2E real del multijugador NT4H.

Levanta una partida COMPLETA contra los servicios vivos:
  Django (:8000) + engine-runner (:3001) + dos clientes WebSocket reales.

Verifica: create → join → ready → start → tickets WS → presencia →
proyección por jugador (la mano ajena NO se filtra) → puja de líder →
comandos reales por WS (PLAY_CARD/END_ATTACK/…) → broadcasts al rival →
ack + dedup de cid → chat → espectador solo lectura → rechazo de
tokens inválidos → cierre.

Requisitos (una sola vez):
  pip install websockets            # en apps/backend/.venv (httpx ya está)

Levantar servicios:
  apps/engine-runner:  ENGINE_RUNNER_DEV_OPEN=1 npx tsx server.ts
  apps/backend:        DJANGO_DEBUG=true .venv/Scripts/python manage.py runserver 8000

Ejecutar:
  apps/backend/.venv/Scripts/python tools/mp_smoke.py [backend_url]

Exit 0 = todo verde; exit 1 = algún chequeo falló.
"""
from __future__ import annotations

import asyncio
import json
import sys

import httpx
import websockets

BACKEND = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
WS_BASE = BACKEND.replace("http://", "ws://").replace("https://", "wss://")
# El validador de origen exige un Origin cuyo host esté en ALLOWED_HOSTS.
ORIGIN = BACKEND.replace("127.0.0.1", "localhost")

RESULTS: list[tuple[str, bool, str]] = []

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(ok), detail))
    print(f" [{'OK' if ok else 'FAIL'}] {name}{' - ' + detail if detail else ''}")


class Api:
    def __init__(self) -> None:
        self.c = httpx.Client(base_url=BACKEND, timeout=15.0)

    def post(self, path: str, body: dict, token: str | None = None):
        h = {"X-Player-Token": token} if token else {}
        r = self.c.post(path, json=body, headers=h)
        try:
            return r.status_code, r.json()
        except ValueError:
            return r.status_code, {}

    def get(self, path: str, token: str | None = None):
        h = {"X-Player-Token": token} if token else {}
        r = self.c.get(path, headers=h)
        try:
            return r.status_code, r.json()
        except ValueError:
            return r.status_code, {}


class WsClient:
    """Cliente WS real: cola de mensajes + espera por predicado."""

    def __init__(self, url: str, label: str) -> None:
        self.url, self.label = url, label
        self.messages: list[dict] = []
        self.ws = None
        self.close_code: int | None = None

    async def connect(self) -> None:
        self.ws = await websockets.connect(
            self.url, additional_headers={"Origin": ORIGIN}
        )
        self.task = asyncio.create_task(self._reader())

    async def _reader(self) -> None:
        try:
            async for raw in self.ws:
                try:
                    self.messages.append(json.loads(raw))
                except json.JSONDecodeError:
                    pass
        except websockets.ConnectionClosed as e:
            self.close_code = e.code

    async def send(self, obj: dict) -> None:
        await self.ws.send(json.dumps(obj))

    async def send_command(self, command: dict, cid: str) -> dict | None:
        """Envía game.command con cid coherente (sobre == comando) y espera el ack."""
        command = {**command, "cid": cid}
        start = len(self.messages)  # solo acks posteriores a ESTE envío
        await self.send({"type": "game.command", "cid": cid, "command": command})
        try:
            return await self.wait_for(
                lambda m: m.get("type") == "game.command_ack" and m.get("ref") == cid,
                f"ack {cid}", 8, start=start,
            )
        except TimeoutError:
            return None

    async def wait_for(self, pred, desc="mensaje", timeout=10.0, start=0) -> dict:
        end = asyncio.get_event_loop().time() + timeout
        while True:
            hit = next((m for m in self.messages[start:] if pred(m)), None)
            if hit is not None:
                return hit
            if asyncio.get_event_loop().time() > end:
                raise TimeoutError(f"{self.label}: timeout {desc}")
            await asyncio.sleep(0.05)

    async def close(self) -> None:
        try:
            await self.ws.close()
        except (OSError, websockets.ConnectionClosed):
            pass
        self.task.cancel()


cid_seq = 0


def next_cid() -> str:
    global cid_seq
    cid_seq += 1
    return f"mp-{cid_seq}"


async def projected(api: Api, room_id: str, pid: str, token: str):
    st, j = api.get(f"/api/rooms/{room_id}/engine/?playerId={pid}", token=token)
    return st, (j.get("state") if isinstance(j, dict) else None) or j


async def main() -> int:
    api = Api()
    print(f"Backend: {BACKEND}")

    # --- 1) Ciclo de vida ------------------------------------------------
    st, j = api.post("/api/rooms/", {
        "hostId": "p1", "hostName": "Host", "mode": "STANDARD",
        "seed": "mp-smoke-1", "maxPlayers": 2, "config": {},
        "heroes": [{"playerId": "p1", "heroId": "hero.lisavette",
                    "heroFace": "FEMALE", "deckId": "warrior.default"}],
    })
    check("create room", st == 200 and bool(j.get("roomId")), str(j)[:110])
    room_id, host_token = j["roomId"], j["hostToken"]

    st, j = api.post(f"/api/rooms/{room_id}/join/", {
        "playerId": "p2", "name": "Invitado", "heroId": "hero.beleth-il",
        "deckId": "explorer.default", "heroFace": "MALE",
    })
    check("join room", st == 200 and bool(j.get("authToken")), str(j)[:110])
    p2_token = j["authToken"]

    st, j = api.post(f"/api/rooms/{room_id}/ready/",
                     {"playerId": "p2", "playerToken": p2_token})
    check("guest ready", st == 200)

    # Negativo: start antes de que TODOS estén listos no procede.
    # (Ya va tras el ready — el camino feliz; el caso 409 está en tests.py)

    st, j = api.post(f"/api/rooms/{room_id}/start/",
                     {"playerId": "p1", "playerToken": host_token})
    check("host start → PLAYING", st == 200 and j.get("started") is True, str(j)[:110])

    # --- 2) Proyección + info oculta --------------------------------------
    st1, v1 = await projected(api, room_id, "p1", host_token)
    st2, v2 = await projected(api, room_id, "p2", p2_token)
    _, vspec = api.get(f"/api/rooms/{room_id}/engine/")
    ste, _ = api.get(f"/api/rooms/{room_id}/engine/?playerId=p1",
                     token="wrong-token")
    check("proyección p1 (200)", st1 == 200 and "p1" in (v1.get("players") or {}))
    check("proyección p2 (200)", st2 == 200 and "p2" in (v2.get("players") or {}))
    check("proyección con token ajeno → 401/403", ste in (401, 403), f"status={ste}")
    p1_hand_p2view = json.dumps((v2.get("players", {}).get("p1") or {}).get("hand", []))
    check("mano de p1 NO filtrada en la vista de p2",
          "warrior." not in p1_hand_p2view and '"hidden.card"' in p1_hand_p2view,
          p1_hand_p2view[:90])
    check("vista de espectador sin cartas privadas",
          '"definitionId":"warrior' not in json.dumps(vspec))

    # --- 3) Tickets + WS real ----------------------------------------------
    st, j1 = api.post(f"/api/rooms/{room_id}/ws-ticket/",
                      {"playerId": "p1", "playerToken": host_token})
    t1 = j1.get("ticket", "")
    st2_, j2 = api.post(f"/api/rooms/{room_id}/ws-ticket/",
                       {"playerId": "p2", "playerToken": p2_token})
    t2 = j2.get("ticket", "")
    check("ws-ticket p1+p2", st == 200 and st2_ == 200 and bool(t1) and bool(t2))

    ws1 = WsClient(f"{WS_BASE}/ws/game/{room_id}/?ticket={t1}", "p1")
    ws2 = WsClient(f"{WS_BASE}/ws/game/{room_id}/?ticket={t2}", "p2")
    await asyncio.gather(ws1.connect(), ws2.connect())
    c1 = await ws1.wait_for(lambda m: m.get("type") == "connected", "connected p1")
    c2 = await ws2.wait_for(lambda m: m.get("type") == "connected", "connected p2")
    check("WS p1 connected", c1.get("playerId") == "p1")
    check("WS p2 connected", c2.get("playerId") == "p2")
    await asyncio.sleep(0.4)
    check("presencia difundida al rival",
          any(m.get("type") == "room.player_connected" and m.get("playerId") == "p2"
              for m in ws1.messages))

    # Espectador: conecta, ping/pong OK, comandos ignorados.
    spec = WsClient(f"{WS_BASE}/ws/game/{room_id}/?spectator=1", "spec")
    await spec.connect()
    cs = await spec.wait_for(lambda m: m.get("type") == "connected", "spec connected")
    check("espectador conecta", cs.get("spectator") is True)
    await spec.send({"type": "ping"})
    pong = None
    try:
        pong = await spec.wait_for(lambda m: m.get("type") == "pong", "pong", 5)
    except TimeoutError:
        pass
    check("espectador ping/pong", pong is not None)
    await spec.send({"type": "game.command", "cid": next_cid(),
                     "command": {"type": "PASS", "cid": "x"}})
    await asyncio.sleep(0.7)
    check("espectador no puede comandar",
          not any(m.get("type") == "game.command_ack" for m in spec.messages))

    # --- 4) Conducir la partida por WS -------------------------------------
    sockets = {"p1": ws1, "p2": ws2}
    tokens = {"p1": host_token, "p2": p2_token}
    played, ended = 0, False

    # El bucket es 20 msg/10 s por conexión: ritmo prudente por comando.
    async def paced(ws: WsClient, command: dict) -> dict | None:
        await asyncio.sleep(0.6)
        return await ws.send_command(command, next_cid())

    for _step in range(70):
        if ended or played >= 4:
            break
        acted = False
        for pid in ("p1", "p2"):
            st, s = await projected(api, room_id, pid, tokens[pid])
            if st != 200 or not isinstance(s, dict):
                continue
            if s.get("phase") == "FINISHED":
                ended = True
                break
            ws = sockets[pid]
            mine = next((c for c in (s.get("pendingChoices") or [])
                         if c.get("playerId") == pid), None)
            if mine:
                acted = True
                if mine.get("type") == "SELECT_CARDS_FOR_LEADER":
                    card_id = (s.get("players", {}).get(pid, {})
                               .get("hand") or [{}])[0].get("instanceId")
                    await paced(ws, {"type": "CHOOSE_LEADER_CARDS",
                                     "cardInstanceIds": [card_id]})
                else:
                    opts = mine.get("options") or []
                    n = max(1, mine.get("minSelections") or 1)
                    sel = ["yes"] if "yes" in opts else opts[:n]
                    await paced(ws, {"type": "RESOLVE_CHOICE",
                                     "choiceId": mine["choiceId"],
                                     "selectedIds": sel})
                continue
            if s.get("activePlayerId") != pid:
                continue
            if s.get("phase") in ("PLAYER_ATTACK", "ATTACK_CHOICE"):
                hand = s.get("players", {}).get(pid, {}).get("hand") or []
                foes = s.get("battlefield") or []
                card = next((c for c in hand if (c.get("printedAttack") or 0) > 0 and foes), None) \
                    or (hand[0] if hand else None)
                if card:
                    acted = True
                    cmd = {"type": "PLAY_CARD",
                           "cardInstanceId": card["instanceId"]}
                    if (card.get("printedAttack") or 0) > 0 and foes:
                        cmd["targetEnemyId"] = foes[0]["instanceId"]
                    ack = await paced(ws, cmd)
                    if ack and ack.get("accepted"):
                        played += 1
                        check(f"PLAY_CARD aceptado ({pid} → "
                              f"{card.get('name') or card['instanceId']})", True)
                    else:
                        # Carta no jugable ahora: cerrar enfrentamiento
                        await paced(ws, {"type": "END_ATTACK"})
            elif s.get("phase") == "MARKET":
                acted = True
                await paced(ws, {"type": "END_TURN"})
        if not acted:
            await asyncio.sleep(0.4)

    check("≥1 carta jugada por WS real", played > 0, f"played={played}")
    b1 = sum(1 for m in ws1.messages if m.get("type", "").startswith("game."))
    b2 = sum(1 for m in ws2.messages if m.get("type", "").startswith("game."))
    check("ambos sockets reciben tráfico de juego", b1 > 0 and b2 > 0,
          f"p1={b1} p2={b2}")

    # --- 5) Dedup cid + chat ------------------------------------------------
    # Drenar el bucket WS (20 msg/10 s) tras el bucle de juego.
    await asyncio.sleep(11)
    cid = next_cid()
    ack1 = await ws1.send_command({"type": "PASS"}, cid)
    await asyncio.sleep(0.6)
    ack2 = await ws1.send_command({"type": "PASS"}, cid)
    check("dedup de cid (2º envío → ack deduplicated)",
          ack1 is not None and ack2 is not None
          and ack2.get("deduplicated") is True,
          f"ack1={ack1 is not None} dedup2={ack2 and ack2.get('deduplicated')}")

    await asyncio.sleep(0.6)
    await ws1.send({"type": "chat.message", "clientMessageId": "c1",
                    "text": "hola multijugador"})
    try:
        chat = await ws2.wait_for(
            lambda m: m.get("type") == "chat.message"
            and m.get("text") == "hola multijugador", "chat", 5)
        check("chat llega al otro jugador", True, f"seq={chat.get('seq')}")
    except TimeoutError:
        check("chat llega al otro jugador", False)

    # --- 5b) Tickets: inválido, un solo uso, reconexión -----------------------
    rejected = False
    try:
        bad = WsClient(f"{WS_BASE}/ws/game/{room_id}/?ticket=tkt-invalido", "bad")
        await bad.connect()
    except (OSError, websockets.InvalidStatus):
        rejected = True  # 4403 en el handshake → HTTP 403
    check("ticket inválido → rechazado", rejected)

    # Un solo uso: el ticket de p1 ya se consumió al conectar.
    st, jx = api.post(f"/api/rooms/{room_id}/ws-ticket/",
                      {"playerId": "p1", "playerToken": host_token})
    tx = jx.get("ticket", "")
    first = WsClient(f"{WS_BASE}/ws/game/{room_id}/?ticket={tx}", "reuse1")
    await first.connect()
    await first.wait_for(lambda m: m.get("type") == "connected", "reuse connect", 8)
    await first.close()
    reused = False
    try:
        second = WsClient(f"{WS_BASE}/ws/game/{room_id}/?ticket={tx}", "reuse2")
        await second.connect()
    except (OSError, websockets.InvalidStatus):
        reused = True
    check("ticket de un solo uso (2ª conexión rechazada)", reused)

    # Reconexión: p2 se cae y vuelve con un ticket NUEVO → connected de nuevo.
    await ws2.close()
    st, jr = api.post(f"/api/rooms/{room_id}/ws-ticket/",
                      {"playerId": "p2", "playerToken": p2_token})
    ws2b = WsClient(f"{WS_BASE}/ws/game/{room_id}/?ticket={jr.get('ticket', '')}", "p2b")
    await ws2b.connect()
    cr = await ws2b.wait_for(lambda m: m.get("type") == "connected", "reconnect", 8)
    check("reconexión con ticket nuevo", cr.get("playerId") == "p2")
    await asyncio.sleep(0.4)
    check("desconexión difundida al rival",
          any(m.get("type") == "room.player_disconnected" and m.get("playerId") == "p2"
              for m in ws1.messages))
    ws2 = ws2b

    # --- 6) Cierre -----------------------------------------------------------
    st, _ = api.post(f"/api/rooms/{room_id}/close/",
                     {"playerId": "p1", "playerToken": host_token})
    check("close room", st in (200, 204), f"status={st}")
    for w in (ws1, ws2, spec):
        await w.close()

    failed = [n for n, ok, _ in RESULTS if not ok]
    if failed or "-v" in sys.argv:
        for label, w in (("p1", ws1), ("p2", ws2), ("spec", spec)):
            counts: dict[str, int] = {}
            for m in w.messages:
                t = str(m.get("type"))
                counts[t] = counts.get(t, 0) + 1
            print(f"   msgs {label}: {counts}")
            errs = [m for m in w.messages if m.get("type") == "error"]
            if errs:
                print(f"   errores {label}: {errs[:6]}")
            acks = [m for m in w.messages if m.get("type") == "game.command_ack"]
            if acks:
                print(f"   acks {label}: {acks[:8]}")
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} verdes"
          + (f" - FALLOS: {' | '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:  # noqa: BLE001 - abort duro con contexto
        print(f"ABORT: {type(e).__name__}: {e}")
        sys.exit(1)
