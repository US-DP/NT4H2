/**
 * Regresión: deduplicación por cid ANTES del check de clientSequence.
 *
 * Un reintento legítimo (mismo cid, misma clientSequence ya procesada) debe
 * recibir el ack cacheado — no "out_of_order_command". La comprobación de
 * orden solo aplica a cids NUEVOS.
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

test('un reintento con cid ya procesado recibe ack cacheado (no out_of_order)', async () => {
  // Crear sala: partida de 1 jugador contra la Horda
  const created = await postJson('/rooms/test-room-cid/create', {
    config: {
      mode: 'STANDARD',
      playerCount: 1,
      seed: 'cid-test',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
      ],
      useScenarios: false,
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));

  // Resolver la puja de Líder si queda pendiente (D427): la partida no sale
  // de la fase de puja hasta que todos los jugadores elijan cartas.
  const stateRes = await fetch(`${base}/rooms/test-room-cid/state?playerId=p1`);
  const { state } = await stateRes.json() as { state: any };
  for (const choice of state.pendingChoices ?? []) {
    if (choice.playerId !== 'p1') continue;
    const isBid = choice.choiceId.startsWith('leader-bid-');
    const command = isBid
      ? {
          type: 'CHOOSE_LEADER_CARDS',
          cid: `resolve-${choice.choiceId}`,
          cardInstanceIds: (choice.options ?? []).slice(0, Math.min(2, choice.options?.length ?? 1)),
        }
      : {
          type: 'RESOLVE_CHOICE',
          cid: `resolve-${choice.choiceId}`,
          choiceId: choice.choiceId,
          selectedIds: (choice.options ?? []).slice(0, choice.minSelections || 1),
        };
    const resolved = await postJson('/rooms/test-room-cid/command', {
      cid: `resolve-${choice.choiceId}`,
      playerId: 'p1',
      command,
    });
    assert.equal(resolved.json.accepted, true, `resolve ${choice.choiceId}: ${JSON.stringify(resolved.json)}`);
  }

  const command = { type: 'END_ATTACK', cid: 'cmd-1' };

  // 1) Primer envío: aceptado
  const first = await postJson('/rooms/test-room-cid/command', {
    cid: 'cmd-1',
    playerId: 'p1',
    command,
    clientSequence: 1,
  });
  assert.equal(first.json.accepted, true, JSON.stringify(first.json));
  assert.equal(first.json.revision, 1);

  // 2) Reintento con el MISMO cid y la clientSequence ya procesada:
  //    dedup primero → ack cacheado. Con el orden antiguo devolvía
  //    out_of_order_command (1 <= lastSeq).
  const retry = await postJson('/rooms/test-room-cid/command', {
    cid: 'cmd-1',
    playerId: 'p1',
    command,
    clientSequence: 1,
  });
  assert.equal(retry.json.accepted, true, JSON.stringify(retry.json));
  assert.equal(retry.json.cached, true);
  assert.equal(retry.json.revision, 1);

  // 3) Un cid NUEVO con clientSequence ya consumida → out_of_order (la
  //    protección anti-reordenado sigue activa para comandos nuevos).
  const reordered = await postJson('/rooms/test-room-cid/command', {
    cid: 'cmd-2',
    playerId: 'p1',
    command: { type: 'END_ATTACK', cid: 'cmd-2' },
    clientSequence: 1,
  });
  assert.equal(reordered.json.accepted, false);
  assert.equal(reordered.json.reason, 'out_of_order_command');

  // 4) Secuencia siguiente válida → aceptado. Tras END_ATTACK la sala está
  //    en MARKET: END_TURN es el comando legal (RESTORATION → …).
  const next = await postJson('/rooms/test-room-cid/command', {
    cid: 'cmd-3',
    playerId: 'p1',
    command: { type: 'END_TURN', cid: 'cmd-3' },
    clientSequence: 2,
  });
  assert.equal(next.json.accepted, true, JSON.stringify(next.json));
  assert.equal(next.json.revision, 2);
});

test('GET /full-state devuelve el estado completo (state+rng+revision+dedup)', async () => {
  // Fase 2: endpoint interno para snapshots de replay/recuperación del
  // backend. Contiene estado sin proyectar — nunca expuesto a clientes.
  const created = await postJson('/rooms/test-room-full/create', {
    config: {
      mode: 'STANDARD',
      playerCount: 1,
      seed: 'full-state',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
      ],
      useScenarios: false,
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));

  const res = await fetch(`${base}/rooms/test-room-full/full-state`);
  assert.equal(res.status, 200);
  const full = await res.json() as {
    state: { phase?: string };
    rngState: { seed?: string; state?: number };
    revision: number;
    lastClientSeq: Record<string, number>;
  };
  assert.ok(full.state && typeof full.state === 'object');
  assert.equal(typeof full.revision, 'number');
  assert.ok(full.rngState && typeof full.rngState.state === 'number');
  assert.ok(full.lastClientSeq && typeof full.lastClientSeq === 'object');

  // Sala inexistente → 404
  const missing = await fetch(`${base}/rooms/nope-full/full-state`);
  assert.equal(missing.status, 404);
});
