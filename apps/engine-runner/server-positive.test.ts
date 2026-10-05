/**
 * Cobertura positiva de la frontera HTTP del engine-runner.
 *
 * - /health responde sin auth
 * - partida real conducida por "autopilot" (fase → comando legal)
 * - todos los tipos de comando del union Zod llegan al motor (200, no 400)
 * - cid del envelope ≠ cid del comando → 400
 * - /restore rehidrata una sala borrada desde /full-state
 * - DELETE /rooms/:id elimina la sala (y 404 después)
 * - /state sin playerId = vista de espectador (sin manos ni RNG)
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
  seed: 'positive-http',
  heroes: [
    { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
  ],
  useScenarios: false,
};

let seq = 0;
async function command(room: string, playerId: string, cmd: Record<string, unknown>) {
  const cid = `pos-${++seq}`;
  return postJson(`/rooms/${room}/command`, {
    cid,
    playerId,
    command: { ...cmd, cid },
  });
}

/** Resuelve las pendingChoices del jugador indicado (puja de líder y demás). */
async function resolvePending(room: string, playerId: string): Promise<boolean> {
  const { json } = await getJson(`/rooms/${room}/state?playerId=${playerId}`);
  const choices = (json.state?.pendingChoices ?? []).filter(
    (c: any) => c.playerId === playerId,
  );
  for (const choice of choices) {
    const isBid = String(choice.choiceId).startsWith('leader-bid-');
    const cmd = isBid
      ? {
          type: 'CHOOSE_LEADER_CARDS',
          cardInstanceIds: (choice.options ?? []).slice(0, Math.min(2, choice.options?.length ?? 1)),
        }
      : {
          type: 'RESOLVE_CHOICE',
          choiceId: choice.choiceId,
          selectedIds: (choice.options ?? []).slice(0, choice.minSelections || 1),
        };
    const r = await command(room, playerId, cmd);
    assert.equal(r.json.accepted, true, `${cmd.type}: ${JSON.stringify(r.json)}`);
    return true;
  }
  return false;
}

test('GET /health responde ok sin auth', async () => {
  const r = await getJson('/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok ?? r.json.status, r.json.ok !== undefined ? true : 'ok');
});

test('autopilot conduce una partida real por varios turnos', async () => {
  const room = 'pos-autopilot';
  const created = await postJson(`/rooms/${room}/create`, { config: SOLO_CONFIG });
  assert.equal(created.status, 200, JSON.stringify(created.json));

  const usedTypes = new Set<string>();
  for (let i = 0; i < 120; i++) {
    const { json } = await getJson(`/rooms/${room}/state?playerId=p1`);
    const state = json.state;
    if (!state || state.phase === 'FINISHED') break;

    if (await resolvePending(room, 'p1')) {
      usedTypes.add('RESOLVE_CHOICE');
      continue;
    }
    // Elegir el comando legal según la fase (mapa de isLegal):
    // ATTACK_CHOICE/PLAYER_ATTACK → PLAY_CARD|END_ATTACK;
    // MARKET/RESTORATION → BUY_CARD|END_TURN.
    const phase = state.phase;
    let cmd: Record<string, unknown>;
    if (phase === 'PLAYER_ATTACK' || phase === 'ATTACK_CHOICE') {
      const hand = state.players?.p1?.hand ?? [];
      const enemy = state.battlefield?.[0];
      cmd = hand.length && enemy
        ? { type: 'PLAY_CARD', cardInstanceId: hand[0].instanceId, targetEnemyId: enemy.instanceId }
        : { type: 'END_ATTACK' };
    } else if (phase === 'MARKET') {
      cmd = { type: 'END_TURN' };
    } else {
      cmd = { type: 'END_TURN' };
    }
    const r = await command(room, 'p1', cmd);
    if (r.json.accepted) {
      usedTypes.add(String(cmd.type));
    } else if (r.json.reason === 'Hero is eliminated' || state.phase === 'FINISHED') {
      break; // partida terminada para este jugador (solo 1 jugador)
    } else if (cmd.type === 'PLAY_CARD') {
      // Carta no legal (p. ej. sin objetivo válido) → fallback a END_ATTACK
      const fallback = await command(room, 'p1', { type: 'END_ATTACK' });
      if (!fallback.json.accepted) break;
      usedTypes.add('END_ATTACK');
    }
    if (state.phase === 'FINISHED') break;
  }
  // La partida debe haber avanzado: al menos resoluciones y fin de ataque/turno
  assert.ok(usedTypes.has('END_ATTACK') || usedTypes.has('END_TURN'),
    `ningún comando de fase aceptado: ${[...usedTypes]}`);
});

test('los 13 tipos de comando del union pasan la validación Zod (no 400)', async () => {
  const room = 'pos-union';
  const created = await postJson(`/rooms/${room}/create`, { config: SOLO_CONFIG });
  assert.equal(created.status, 200);

  // Cada comando bien formado debe llegar al motor: la respuesta puede ser
  // accepted:false (ilegal en esta fase) pero nunca 400 de esquema.
  const commands: Record<string, unknown>[] = [
    { type: 'PLAY_CARD', cardInstanceId: 'x1', targetEnemyId: 'e1' },
    { type: 'END_ATTACK' },
    { type: 'EVASION', discardedCardInstanceIds: ['x1'] },
    { type: 'BUY_CARD', marketCardInstanceId: 'm1' },
    { type: 'END_TURN' },
    { type: 'USE_HERO_ABILITY', targetId: 'p1' },
    { type: 'CHOOSE_LEADER_CARDS', cardInstanceIds: ['a'] },
    { type: 'RESOLVE_CHOICE', choiceId: 'c1', selectedIds: [] },
    { type: 'PASS' },
    { type: 'SWAP_STARTING_CARDS', cardInstanceIds: ['a'] },
    { type: 'ACCEPT_TURN_START_EFFECT', accepted: true },
    { type: 'OPEN_SUPPORT_DECK', supportDeckIndex: 0 },
    { type: 'BUY_SUPPORT_CARD', supportDeckIndex: 0, payment: { type: 'COINS', amount: 0 } },
  ];
  for (const cmd of commands) {
    const cid = `union-${cmd.type}`;
    const r = await postJson(`/rooms/${room}/command`, {
      cid, playerId: 'p1', command: { ...cmd, cid },
    });
    assert.equal(r.status, 200, `${cmd.type} rechazado por esquema: ${JSON.stringify(r.json)}`);
  }
});

test('cid del envelope distinto del del comando → 400', async () => {
  const room = 'pos-cid-mismatch';
  await postJson(`/rooms/${room}/create`, { config: SOLO_CONFIG });
  const r = await postJson(`/rooms/${room}/command`, {
    cid: 'outer-cid',
    playerId: 'p1',
    command: { type: 'PASS', cid: 'inner-cid' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.accepted, false);
});

test('/restore rehidrata una sala borrada desde /full-state', async () => {
  const room = 'pos-restore';
  const created = await postJson(`/rooms/${room}/create`, { config: SOLO_CONFIG });
  assert.equal(created.status, 200);

  const full = await getJson(`/rooms/${room}/full-state`);
  assert.equal(full.status, 200);
  const snapshot = full.json;

  // Borrar y comprobar que desapareció
  const del = await fetch(`${base}/rooms/${room}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const gone = await getJson(`/rooms/${room}/state`);
  assert.equal(gone.status, 404);

  // Restaurar desde el snapshot completo
  const restored = await postJson(`/rooms/${room}/restore`, { snapshot });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.equal(restored.json.revision, snapshot.revision);

  // La sala vuelve a responder con estado proyectado
  const back = await getJson(`/rooms/${room}/state?playerId=p1`);
  assert.equal(back.status, 200);
  assert.ok(back.json.state);
  // Segundo restore debe chocar con la sala ya existente
  const again = await postJson(`/rooms/${room}/restore`, { snapshot });
  assert.equal(again.status, 409);
});

test('restore no reemite seqs: los eventos nuevos van por encima del eventLog restaurado', async () => {
  // Regresión: /restore recreaba la sala sin restaurar el contador global
  // de seq del motor → nextSeq() reemitía valores ya usados en eventLog.
  const room = 'pos-seq-floor';
  await postJson(`/rooms/${room}/create`, { config: SOLO_CONFIG });
  const full = await getJson(`/rooms/${room}/full-state`);
  const snapshot = full.json;

  // Simular un log con seqs muy por encima del contador del proceso
  const FLOOR = 500_000;
  for (const ev of snapshot.state.eventLog) ev.seq = (ev.seq ?? 0) + FLOOR;
  snapshot.seq = (snapshot.seq ?? 0) + FLOOR;

  const del = await fetch(`${base}/rooms/${room}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const restored = await postJson(`/rooms/${room}/restore`, { snapshot });
  assert.equal(restored.status, 200);

  // Resolver pendientes y enviar el primer comando aceptable de la fase
  await resolvePending(room, 'p1');
  const { json } = await getJson(`/rooms/${room}/state?playerId=p1`);
  const phase = json.state?.phase;
  const cmd = phase === 'PLAYER_ATTACK' || phase === 'ATTACK_CHOICE'
    ? { type: 'END_ATTACK' }
    : { type: 'END_TURN' };
  const r = await command(room, 'p1', cmd);
  assert.equal(r.json.accepted, true, JSON.stringify(r.json));
  const maxRestored = FLOOR;
  for (const ev of r.json.events) {
    assert.ok(ev.seq > maxRestored, `evento ${ev.type} con seq ${ev.seq} <= suelo restaurado ${maxRestored}`);
  }
});

test('vista de espectador: manos redactadas (sin definitionId ni name) y sin RNG', async () => {
  const room = 'pos-spectator';
  await postJson(`/rooms/${room}/create`, { config: SOLO_CONFIG });
  const r = await getJson(`/rooms/${room}/state`);
  assert.equal(r.status, 200);
  const { state } = r.json;
  assert.ok(state);
  // El runner mantiene la forma GameState pero con las cartas secretas
  // redactadas: ni definitionId ni name deben revelar contenido.
  const p1 = state.players?.p1;
  assert.ok(p1, 'p1 debe existir en la vista');
  for (const c of [...(p1.hand ?? []), ...(p1.abilityDeck ?? []), ...(p1.wearPile ?? [])]) {
    assert.equal(c.definitionId, 'hidden.card');
    assert.equal(c.name, undefined, 'el nombre real de la carta no debe filtrarse');
    assert.equal(c.persistentTrigger, undefined);
  }
  for (const c of [...(state.hordeDeck ?? []), ...(state.marketDeck ?? []), ...(state.scenarioDeck ?? [])]) {
    assert.equal(c.definitionId, 'hidden.card');
    assert.equal(c.name, undefined);
  }
  // RNG sellado: el seed/estado nunca sale del runner
  assert.equal(state.rngState.seed, '');
  assert.equal(state.rngState.state, 0);
  // Y el dueño sí ve sus cartas reales
  const own = await getJson(`/rooms/${room}/state?playerId=p1`);
  const ownHand = own.json.state?.players?.p1?.hand ?? [];
  assert.ok(ownHand.length > 0 && ownHand.some((c: any) => c.definitionId !== 'hidden.card'));
});

test('DELETE sala inexistente → 404', async () => {
  const res = await fetch(`${base}/rooms/no-existe`, { method: 'DELETE' });
  assert.equal(res.status, 404);
});

test('customSet sin officialStatus explícito se acepta (no se confunde con oficial)', async () => {
  // Regresión: el runner parseaba el set con Zod y luego llamaba a
  // validateContentSet con el objeto YA parseado — el default
  // officialStatus='OFFICIAL' del schema hacía que toda carta pareciera
  // marcarse como oficial y el set se rechazaba entero con un mensaje
  // engañoso. validateContentSet debe recibir el JSON crudo.
  const room = 'pos-custom-raw';
  const set = {
    id: 'set.raw-status',
    name: 'Set sin status',
    version: '1.0.0',
    author: 'tester',
    status: 'PUBLISHED',
    cards: [
      {
        id: 'custom.raw-card',
        name: 'Carta cruda',
        type: 'ABILITY',
        heroClass: 'EXPLORER',
        copies: 1,
        printedAttack: 0,
        // SIN officialStatus: el default del schema es OFFICIAL — el
        // chequeo debe mirar el JSON crudo, no el objeto parseado.
        effects: [{ type: 'GAIN_COINS', amount: { kind: 'CONSTANT', value: 1 } }],
      },
    ],
    decks: [],
  };
  const created = await postJson(`/rooms/${room}/create`, {
    config: { ...SOLO_CONFIG, customSets: [set] },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  // Y el rechazo sí funciona cuando el campo se declara explícitamente
  const room2 = 'pos-custom-official';
  const evil = structuredClone(set) as typeof set & { cards: Record<string, unknown>[] };
  evil.id = 'set.raw-status-evil';
  evil.cards = [{ ...evil.cards[0], id: 'custom.raw-card-evil', officialStatus: 'OFFICIAL' }];
  const rejected = await postJson(`/rooms/${room2}/create`, {
    config: { ...SOLO_CONFIG, customSets: [evil] },
  });
  assert.equal(rejected.status, 400, JSON.stringify(rejected.json));
});
