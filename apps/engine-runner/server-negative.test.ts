/**
 * Casos negativos sobre la frontera HTTP real del engine-runner.
 *
 * Levanta el servidor Express de verdad (puerto efímero), crea una sala
 * real y dispara la batería de payloads ilegales por la MISMA ruta que
 * usa el backend en producción: POST /rooms/:id/command + /create.
 *
 * Cubre: sala inexistente, JSON malformado, payload sin validar por Zod,
 * proto-pollution en ids, revisión obsoleta, re-creación de sala,
 * suplantación de actorId (sellado por el runner), rechazo a nivel motor
 * propagado intacto, y rate-limiting.
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

const VALID_CONFIG = {
  mode: 'STANDARD',
  playerCount: 2,
  seed: 'neg-http',
  heroes: [
    { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
    { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
  ],
  useScenarios: false,
};

test('comando a sala inexistente → 404', async () => {
  const r = await postJson('/rooms/ghost-room/command', {
    cid: 'x', playerId: 'p1', command: { type: 'PASS', cid: 'x' },
  });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'Room not found');
});

test('payloads malformados → 400 sin tocar el estado', async () => {
  const created = await postJson('/rooms/neg-400/create', { config: VALID_CONFIG });
  assert.equal(created.status, 200);

  const cases: [string, unknown][] = [
    ['sin command', { cid: 'c1', playerId: 'p1' }],
    ['sin cid', { playerId: 'p1', command: { type: 'PASS', cid: 'c2' } }],
    ['sin playerId', { cid: 'c3', command: { type: 'PASS', cid: 'c3' } }],
    ['command no objeto', { cid: 'c4', playerId: 'p1', command: 'PLAY_CARD' }],
    ['tipo inexistente', { cid: 'c5', playerId: 'p1', command: { type: 'CHEAT_WIN', cid: 'c5' } }],
    ['tipo en minúsculas', { cid: 'c6', playerId: 'p1', command: { type: 'pass', cid: 'c6' } }],
    ['cid vacío', { cid: 'c7', playerId: 'p1', command: { type: 'PASS', cid: '' } }],
    ['cid >128', { cid: 'c8', playerId: 'p1', command: { type: 'PASS', cid: 'x'.repeat(200) } }],
    ['command null', { cid: 'c9', playerId: 'p1', command: null }],
    ['body array', { cid: 'c10', playerId: 'p1', command: ['PASS'] }],
    ['body primitivo', 42],
    ['body null', null],
  ];
  for (const [name, body] of cases) {
    const r = await postJson('/rooms/neg-400/command', body);
    // 400: o el middleware de JSON (bodies no-objeto) o la validación Zod
    assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.json)}`);
    assert.ok(typeof r.json.error === 'string' && r.json.error.length > 0);
    assert.notEqual(r.json.accepted, true);
  }
});

test('proto-pollution y límites de arrays → 400', async () => {
  const created = await postJson('/rooms/neg-proto/create', { config: VALID_CONFIG });
  assert.equal(created.status, 200);

  for (const evil of ['__proto__', 'constructor', 'prototype']) {
    const r = await postJson('/rooms/neg-proto/command', {
      cid: `proto-${evil}`, playerId: 'p1',
      command: { type: 'PLAY_CARD', cid: 'x', cardInstanceId: evil },
    });
    assert.equal(r.status, 400, `${evil}: ${JSON.stringify(r.json)}`);
  }
  // EVASION con >60 ids
  const r61 = await postJson('/rooms/neg-proto/command', {
    cid: 'evasion-61', playerId: 'p1',
    command: { type: 'EVASION', cid: 'x', discardedCardInstanceIds: Array(61).fill('a') },
  });
  assert.equal(r61.status, 400);
  // RESOLVE_CHOICE con >60 selecciones
  const r62 = await postJson('/rooms/neg-proto/command', {
    cid: 'choice-61', playerId: 'p1',
    command: { type: 'RESOLVE_CHOICE', cid: 'x', choiceId: 'y', selectedIds: Array(61).fill('a') },
  });
  assert.equal(r62.status, 400);
  // BUY_SUPPORT_CARD con pago malformado
  const rPay = await postJson('/rooms/neg-proto/command', {
    cid: 'pay-bad', playerId: 'p1',
    command: { type: 'BUY_SUPPORT_CARD', cid: 'x', supportDeckIndex: 0, payment: { type: 'SOULS', amount: 1 } },
  });
  assert.equal(rPay.status, 400);
});

test('JSON malformado en el body → 400 JSON (no crash, no HTML)', async () => {
  const res = await fetch(`${base}/rooms/neg-json/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{cid: not-json,,,',
  });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('content-type')?.includes('json'), true);
});

test('re-crear una sala existente → 409 (no reinicio silencioso)', async () => {
  const a = await postJson('/rooms/neg-dup/create', { config: VALID_CONFIG });
  assert.equal(a.status, 200);
  const b = await postJson('/rooms/neg-dup/create', { config: VALID_CONFIG });
  assert.equal(b.status, 409);
  assert.equal(b.json.error, 'Room already exists');
});

test('config inválida → 400 en create', async () => {
  const cases: [string, unknown][] = [
    ['sin config', {}],
    ['modo inexistente', { config: { ...VALID_CONFIG, mode: 'GODMODE' } }],
    ['playerCount 0', { config: { ...VALID_CONFIG, playerCount: 0 } }],
    ['playerCount 5', { config: { ...VALID_CONFIG, playerCount: 5 } }],
    ['heroes vacío', { config: { ...VALID_CONFIG, heroes: [] } }],
    ['heroId proto', { config: { ...VALID_CONFIG, heroes: [{ ...VALID_CONFIG.heroes[0], heroId: '__proto__' }] } }],
    ['heroFace inválida', { config: { ...VALID_CONFIG, heroes: [{ ...VALID_CONFIG.heroes[0], heroFace: 'X' }] } }],
  ];
  for (const [name, body] of cases) {
    const r = await postJson(`/rooms/neg-cfg-${name.length}/create`, body);
    assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error, 'Invalid game config');
  }
});

test('revisión obsoleta → 409 stale_revision (cliente debe re-sincronizar)', async () => {
  await postJson('/rooms/neg-rev/create', { config: VALID_CONFIG });
  const r = await postJson('/rooms/neg-rev/command', {
    cid: 'stale-1', playerId: 'p1',
    command: { type: 'PASS', cid: 'stale-1' },
    expectedRevision: 999,
  });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'stale_revision');
  assert.equal(r.json.revision, 0);
});

test('rechazo del motor se propaga intacto: accepted:false + reason', async () => {
  await postJson('/rooms/neg-eng/create', { config: VALID_CONFIG });
  const r = await postJson('/rooms/neg-eng/command', {
    cid: 'eng-1', playerId: 'p1',
    command: { type: 'PLAY_CARD', cid: 'eng-1', cardInstanceId: 'no-such-card' },
  });
  assert.equal(r.status, 200); // 200: rechazo semántico, no error de transporte
  assert.equal(r.json.accepted, false);
  assert.ok(typeof r.json.reason === 'string' && r.json.reason.length > 0);
});

test('actorId del payload NO puede suplantar: el runner lo sella con playerId autenticado', async () => {
  await postJson('/rooms/neg-spoof/create', { config: VALID_CONFIG });
  // p1 envía actorId=p2: el runner sobrescribe con playerId autenticado.
  // El comando se ejecuta como p1 — si el suplantado funcionara, en esta
  // fase (puja o turno de p1) p2 sería rechazado; en su lugar el comando
  // se evalúa como p1.
  const r = await postJson('/rooms/neg-spoof/command', {
    cid: 'spoof-1', playerId: 'p1',
    command: { type: 'PASS', cid: 'spoof-1', actorId: 'p2' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.accepted, true, 'PASS sellado como p1 debe pasar');
});

test('rate limiting: el comando 31 en 10 s → 429', async () => {
  await postJson('/rooms/neg-rl/create', { config: VALID_CONFIG });
  let lastStatus = 0;
  for (let i = 0; i < 31; i++) {
    const r = await postJson('/rooms/neg-rl/command', {
      cid: `rl-${i}`, playerId: 'p1',
      command: { type: 'PLAY_CARD', cid: `rl-${i}`, cardInstanceId: 'ghost' },
    });
    lastStatus = r.status;
  }
  assert.equal(lastStatus, 429);
});
