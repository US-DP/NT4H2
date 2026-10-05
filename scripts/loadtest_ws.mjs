#!/usr/bin/env node
/**
 * Load test del WebSocket de salas — NT4H Digital.
 *
 * Uso:
 *   node scripts/loadtest_ws.mjs [--base http://localhost:8000] \
 *     [--players 4] [--spectators 20] [--msgs 50] [--secs 30]
 *
 * Flujo: registra un usuario, crea sala, une jugadores, arranca la
 * partida, abre sockets (jugadores con ticket + espectadores) y mide:
 *   - latencia de connect + primer mensaje (connected)
 *   - throughput/latencia de chat.message
 *   - comportamiento de comandos PASS bajo ráfaga
 *
 * Requisitos: Node ≥ 21 (WebSocket nativo). Backend y runner levantados.
 * Es un script de laboratorio — NO apunta a producción.
 */

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v === undefined ? true : v];
  }),
);
const BASE = args.base ?? 'http://localhost:8000';
const PLAYERS = Number(args.players ?? 4);
const SPECTATORS = Number(args.spectators ?? 20);
const MSGS = Number(args.msgs ?? 50);
const SECS = Number(args.secs ?? 30);

const wsBase = BASE.replace(/^http/, 'ws');
const stats = { connectOk: 0, connectFail: 0, chatSent: 0, chatAck: 0, cmdSent: 0, cmdAck: 0, errors: [] };
const t0 = Date.now();

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function register(name) {
  const r = await api('/api/v1/auth/register/', {
    method: 'POST',
    body: { username: `lt_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, password: 'LoadTest!123' },
  });
  return r.token;
}

function wsConnect(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const to = setTimeout(() => { ws.close(); resolve(null); }, 5000);
    ws.onopen = () => { /* connected msg arrives after accept */ };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'connected') { clearTimeout(to); resolve(ws); }
    };
    ws.onerror = () => { clearTimeout(to); resolve(null); };
    ws.onclose = () => { clearTimeout(to); resolve(null); };
  });
}

async function main() {
  console.log(`loadtest: ${BASE} | players=${PLAYERS} spectators=${SPECTATORS} msgs=${MSGS} dur=${SECS}s`);

  const hostToken = await register('host');
  const room = await api('/api/rooms/', { method: 'POST', token: hostToken, body: { mode: 'STANDARD' } });
  const roomId = room.roomId;
  console.log(`sala ${roomId} creada`);

  const players = [{ token: hostToken, playerId: room.hostId ?? 'host', playerToken: room.hostToken }];
  for (let i = 1; i < PLAYERS; i++) {
    const tok = await register(`p${i}`);
    const j = await api(`/api/rooms/${roomId}/join/`, { method: 'POST', token: tok, body: {} });
    players.push({ token: tok, playerId: j.playerId, playerToken: j.authToken });
    await api(`/api/rooms/${roomId}/ready/`, { method: 'POST', token: tok, body: { playerId: j.playerId, playerToken: j.authToken, ready: true } });
  }
  await api(`/api/rooms/${roomId}/ready/`, { method: 'POST', token: hostToken, body: { playerId: players[0].playerId, playerToken: players[0].playerToken, ready: true } });
  await api(`/api/rooms/${roomId}/start/`, { method: 'POST', token: hostToken, body: { playerId: players[0].playerId, playerToken: players[0].playerToken } });
  console.log('partida iniciada');

  // Tickets + sockets de jugadores
  const sockets = [];
  for (const p of players) {
    const t = await api(`/api/rooms/${roomId}/ws-ticket/`, {
      method: 'POST', token: p.token,
      body: { playerId: p.playerId, playerToken: p.playerToken },
    });
    const ws = await wsConnect(`${wsBase}/ws/game/${roomId}/?ticket=${t.ticket}`);
    if (ws) { stats.connectOk++; sockets.push({ ws, playerId: p.playerId }); }
    else stats.connectFail++;
  }

  // Espectadores (cap 32 — los extra deben cerrar con 4429)
  let specOk = 0, specRefused = 0;
  for (let i = 0; i < SPECTATORS; i++) {
    const ws = await wsConnect(`${wsBase}/ws/game/${roomId}/?spectator=1`);
    if (ws) { specOk++; sockets.push({ ws }); } else specRefused++;
  }
  console.log(`sockets: ${stats.connectOk} jugadores, ${specOk} espectadores (${specRefused} rechazados/cap)`);

  // Ráfaga de chat desde jugadores
  const chatLat = [];
  for (const s of sockets.filter(x => x.playerId)) {
    s.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'chat.message') { stats.chatAck++; chatLat.push(Date.now() - s.lastChatT); }
      if (m.type === 'game.command_ack') stats.cmdAck++;
    };
  }
  for (let i = 0; i < MSGS; i++) {
    const s = sockets[i % players.length];
    s.lastChatT = Date.now();
    s.ws.send(JSON.stringify({ type: 'chat.message', text: `msg ${i}`, clientMessageId: `lt-${i}` }));
    stats.chatSent++;
    await new Promise(r => setTimeout(r, 20));
  }

  // Ráfaga de comandos PASS (el motor los rechaza/acepta — medimos roundtrip)
  for (let i = 0; i < MSGS; i++) {
    const s = sockets[i % players.length];
    const cid = `lt-cmd-${i}`;
    s.ws.send(JSON.stringify({ type: 'game.command', cid, command: { type: 'PASS', cid } }));
    stats.cmdSent++;
    await new Promise(r => setTimeout(r, 10));
  }

  const wait = SECS * 1000 - (Date.now() - t0);
  if (wait > 0) await new Promise(r => setTimeout(r, Math.min(wait, 5000)));

  const p95 = chatLat.length ? chatLat.sort((a, b) => a - b)[Math.floor(chatLat.length * 0.95)] : 0;
  console.log(`--- resultados (${((Date.now() - t0) / 1000).toFixed(1)}s) ---`);
  console.log(`chat: ${stats.chatAck}/${stats.chatSent} recibidos · p95 ${p95} ms`);
  console.log(`comandos: ${stats.cmdAck}/${stats.cmdSent} ack`);
  console.log(`connects: ${stats.connectOk} ok / ${stats.connectFail} fallo`);

  for (const s of sockets) s.ws.close();
  process.exit(stats.connectFail > 0 ? 1 : 0);
}

main().catch(e => { console.error('loadtest abortado:', e.message); process.exit(1); });
