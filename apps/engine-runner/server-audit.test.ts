/**
 * Regresiones de la auditoría (ronda engine-runner):
 *
 * - playerId '__spectator__' (o cualquier '__*') rechazado en create:
 *   colisionaba con el centinela de espectador y recibía su vista.
 * - roomId fuera de [A-Za-z0-9_-] rechazado (colisión de snapshots en disco).
 * - La dedup de cid NO consume cuota de rate-limit (va antes del contador).
 * - /full-state incluye customSets (snapshot autocontenido para /restore).
 *
 * Corre con: pnpm test (tsx --test, node:test nativo).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// DEV_OPEN antes de importar el server (fail-closed sin token).
process.env.ENGINE_RUNNER_DEV_OPEN = '1';

let server: Server;
let base: string;

before(async () => {
  const { app } = await import('./server.js');
  server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

async function postJson(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function getJson(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, json: await res.json() };
}

const SOLO_CONFIG = {
  mode: 'STANDARD',
  playerCount: 1,
  seed: 'audit-http',
  heroes: [
    { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
  ],
  useScenarios: false,
};

test("playerId '__spectator__' rechazado: colisiona con la vista de espectador", async () => {
  const r = await postJson('/rooms/audit-spectator/create', {
    config: {
      ...SOLO_CONFIG,
      heroes: [{ playerId: '__spectator__', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' }],
    },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test("cualquier playerId con prefijo '__' está reservado", async () => {
  const r = await postJson('/rooms/audit-underscore/create', {
    config: {
      ...SOLO_CONFIG,
      heroes: [{ playerId: '__internal', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' }],
    },
  });
  assert.equal(r.status, 400);
});

test('roomId con caracteres fuera de [A-Za-z0-9_-] → 400 (colisión de snapshot)', async () => {
  // 'audit.dotted' sanitizaría a 'audit_dotted.json' — colisión con una
  // sala legítima 'audit_dotted'.
  const r = await postJson('/rooms/audit.dotted/create', { config: SOLO_CONFIG });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'Invalid roomId');

  // Y los válidos siguen funcionando
  const ok = await postJson('/rooms/audit_dotted/create', { config: SOLO_CONFIG });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('un cid ya procesado no consume cuota de rate-limit', async () => {
  const room = 'audit-rl-dedup';
  const created = await postJson(`/rooms/${room}/create`, { config: SOLO_CONFIG });
  assert.equal(created.status, 200);

  // Encontrar un comando aceptado para que el cid quede procesado
  let cid: string | null = null;
  for (let i = 0; i < 40 && !cid; i++) {
    const { json } = await getJson(`/rooms/${room}/state?playerId=p1`);
    const st = json.state;
    if (!st || st.phase === 'FINISHED') break;
    const choice = (st.pendingChoices ?? []).find((c: any) => c.playerId === 'p1');
    let cmd: Record<string, unknown> | null = null;
    if (choice) {
      cmd = String(choice.choiceId).startsWith('leader-bid-')
        ? { type: 'CHOOSE_LEADER_CARDS', cardInstanceIds: (choice.options ?? []).slice(0, 2) }
        : { type: 'RESOLVE_CHOICE', choiceId: choice.choiceId, selectedIds: (choice.options ?? []).slice(0, 1) };
    } else if (st.phase === 'PLAYER_ATTACK' || st.phase === 'ATTACK_CHOICE') {
      cmd = { type: 'END_ATTACK' };
    } else {
      cmd = { type: 'END_TURN' };
    }
    const tryCid = `rl-${i}`;
    const r = await postJson(`/rooms/${room}/command`, {
      cid: tryCid, playerId: 'p1', command: { ...cmd, cid: tryCid },
    });
    if (r.json.accepted) cid = tryCid;
  }
  assert.ok(cid, 'no se consiguió ningún comando aceptado para el test');

  // Reenviar el MISMO cid 40 veces: si la dedup va antes del rate-limit
  // (30 cmds / 10 s), nunca veremos un 429 — todo son acks cacheados.
  let cached = 0;
  for (let i = 0; i < 40; i++) {
    const r = await postJson(`/rooms/${room}/command`, {
      cid, playerId: 'p1', command: { type: 'PASS', cid },
    });
    assert.notEqual(r.status, 429, `reintento ${i} consumió cuota de rate-limit`);
    if (r.json.cached) cached++;
  }
  assert.equal(cached, 40);
});

test('/full-state incluye customSets (snapshot autocontenido)', async () => {
  const room = 'audit-fullstate';
  const customSet = {
    id: 'set.audit-test', name: 'Audit', version: '1.0.0', author: 'test',
    cards: [], decks: [],
  };
  const created = await postJson(`/rooms/${room}/create`, {
    config: { ...SOLO_CONFIG, customSets: [customSet] },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));

  const full = await getJson(`/rooms/${room}/full-state`);
  assert.equal(full.status, 200);
  assert.ok(Array.isArray(full.json.customSets), 'full-state sin customSets');
  assert.equal(full.json.customSets[0]?.id, 'set.audit-test');

  // El blob del /full-state basta para restaurar — sin inyectar config.
  const del = await fetch(`${base}/rooms/${room}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const restored = await postJson(`/rooms/${room}/restore`, { snapshot: full.json });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
});
