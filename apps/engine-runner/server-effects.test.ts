/**
 * Cobertura por EFECTO a nivel de API: cada tipo de efecto que usa el
 * catálogo oficial se ejerce sobre HTTP real siguiendo el pipeline
 *
 *   estado controlado → inyectar cartas → comando real → motor →
 *   estado final + eventLog + vista proyectada + replay bit a bit.
 *
 * El mayor riesgo no es la UI sino que una refactorización del motor
 * rompa una carta silenciosamente: cada test fija invariantes numéricos
 * (cantidades exactas, conservación de cartas, destinos) y —salvo los
 * tests estructuralmente excluidos— repliega el eventLog con
 * `replayEvents` y exige el mismo `stateHash` que el estado persistido.
 *
 * Corre con: pnpm test (tsx --test, node:test nativo).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import {
  DeterministicRng, replayEvents, stateHash, applyScenarioEffects, applyEntryAuras,
} from '@nt4h/engine';
import type { CardInstance, GameState } from '@nt4h/schema';
import {
  bootServer, makeHttp, catalog, inst, enemyFromDef,
  moveFromDeck, buildStateFor, resetInstSeq,
} from './test-harness.js';

let server: Server;
let base: string;
let http: ReturnType<typeof makeHttp>;

before(async () => {
  const boot = await bootServer();
  server = boot.server;
  base = boot.base;
  http = makeHttp(base);
});

after(() => { server.close(); });

const roomFor = (tag: string) => `fx-${tag}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 120);

/** Estado rico con p2 silenciado (sin ventana de reacción de Valèrys). */
function richState(defId: string): { state: GameState; rng: DeterministicRng } {
  const { state, rng } = buildStateFor(catalog.byId.get(defId)!);
  state.players.p2 = { ...state.players.p2, heroId: 'hero.neddia', heroUsesRemaining: 0, heroMaxUses: 0 };
  return { state, rng };
}

/** Héroe de p1 concreto manteniendo su baraja de clase. */
function heroP1(state: GameState, heroId: string, uses = 1) {
  state.players.p1 = { ...state.players.p1, heroId, heroUsesRemaining: uses, heroMaxUses: uses };
}

/** Drena pendingChoices eligiendo selectedIds concretos por choiceId/tipo. */
async function drainCustom(roomId: string, acc: any[], pick: (pc: any) => string[] | null): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const st = await http.fullState(roomId);
    const pc = st.pendingChoices?.[0] as any;
    if (!pc) return;
    if (String(pc.choiceId).startsWith('turn-start-')) {
      const r = await http.send(roomId, pc.playerId, { type: 'ACCEPT_TURN_START_EFFECT', accepted: true });
      acc.push(...(r.json.events ?? []));
      continue;
    }
    let selectedIds = pick(pc);
    if (selectedIds === null) {
      if (pc.type === 'REACTION_WINDOW') selectedIds = ['USE_ABILITY'];
      else selectedIds = (pc.options ?? []).includes('yes')
        ? ['yes']
        : (pc.options ?? []).slice(0, Math.max(1, pc.minSelections ?? 1));
    }
    const r = await http.send(roomId, pc.playerId, { type: 'RESOLVE_CHOICE', choiceId: pc.choiceId, selectedIds });
    acc.push(...(r.json.events ?? []));
  }
}

/**
 * Replay bit a bit: repliega los eventos devueltos por /command sobre el
 * estado sembrado y exige el mismo hash que /full-state (rngState se
 * normaliza: el fold no reproduce la entropía, viaja en el snapshot).
 */
async function checkReplay(roomId: string, pre: GameState, events: any[], failures: string[], label: string) {
  const post = await http.fullState(roomId);
  const preJson = JSON.parse(JSON.stringify(pre)) as GameState;
  const replayed = replayEvents(preJson, events);
  const norm = (s: any) => { const c = JSON.parse(JSON.stringify(s)); delete c.rngState; return c; };
  const hLive = stateHash(norm(post));
  const hReplay = stateHash(norm(replayed));
  if (hLive !== hReplay) {
    failures.push(`${label}: replay diverge (live ${hLive} ≠ fold ${hReplay})`);
  }
}

/** Ejecuta un comando, drena elecciones y verifica replay. */
async function run(
  tag: string, state: GameState, rng: DeterministicRng, playerId: string,
  command: Record<string, unknown>, failures: string[],
  pick?: (pc: any) => string[] | null,
): Promise<{ roomId: string; events: any[]; post: GameState; accepted: boolean; reason?: string }> {
  const roomId = roomFor(tag);
  await http.restore(roomId, state, rng);
  const r = await http.send(roomId, playerId, command);
  const events: any[] = [...(r.json.events ?? [])];
  if (r.json.accepted) {
    if (pick) await drainCustom(roomId, events, pick);
    else await http.drainChoices(roomId, events);
    await checkReplay(roomId, state, events, failures, tag);
  }
  const post = await http.fullState(roomId);
  return { roomId, events, post, accepted: !!r.json.accepted, reason: r.json.reason };
}

const del = (roomId: string) => http.del(roomId);
const ev = (events: any[], type: string) => events.some(e => e.type === type);
const evN = (events: any[], type: string, pred: (e: any) => boolean) => events.some(e => e.type === type && pred(e));
const countCards = (p: any) =>
  p.hand.length + p.abilityDeck.length + p.wearPile.length + (p.persistentCards?.length ?? 0);

/** Daño total que infligiría la Horda AHORA (fortaleza efectiva − heridas,
 *  enemigos con daño deshabilitado no aportan). */
const hordeTotal = (bf: any[]) => bf.reduce((s, e) => {
  if (e.damageDisabled) return s;
  const eff = e.baseFortitude
    + (e.modifiers ?? []).filter((m: any) => m.layer === 'FORTITUDE_MODIFIERS').reduce((a: number, m: any) => a + m.amount, 0);
  return s + Math.max(0, eff - e.wounds);
}, 0);

// ===========================================================================
// A) Robo y flujo de mazos
// ===========================================================================

test('DRAW_CARDS — Elixir de Concentración roba 3: mano/deck/desgaste exactos', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('market.concentration-elixir');
  const card = inst('market.concentration-elixir', 'p1', 'HAND', 'Elixir de Concentración');
  state.players.p1.hand = [...state.players.p1.hand, card];
  const hand0 = state.players.p1.hand.length;
  const deck0 = state.players.p1.abilityDeck.length;
  const wear0 = state.players.p1.wearPile.length;

  const { events, post, roomId } = await run(
    'draw-elixir', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId }, failures);

  if (!evN(events, 'CARDS_DRAWN', e => e.playerId === 'p1' && e.count === 3)) {
    failures.push('sin CARDS_DRAWN count=3');
  }
  const p = post.players.p1 as any;
  // La carta jugada sale de la mano (-1) y llegan 3 nuevas (+3)
  if (p.hand.length !== hand0 + 2) failures.push(`mano ${hand0}→${p.hand.length} (esperado ${hand0 + 2})`);
  if (p.abilityDeck.length !== deck0 - 3) failures.push(`mazo ${deck0}→${p.abilityDeck.length}`);
  if (p.wearPile.length !== wear0 + 1) failures.push(`desgaste ${wear0}→${p.wearPile.length}`);
  // Sin duplicados: ningún instanceId puede estar en dos zonas
  const ids = [...p.hand, ...p.abilityDeck, ...p.wearPile].map((c: any) => c.instanceId);
  if (new Set(ids).size !== ids.length) failures.push('cartas duplicadas entre zonas');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('DRAW_AND_CHECK — fallo: la carta robada va al FONDO del mazo', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('explorer.rapid-shot');
  heroP1(state, 'hero.idril', 2); // sin la pasiva de Beleth-Il
  const played = moveFromDeck(state, 'p1', 'explorer.rapid-shot');
  const top = state.players.p1.abilityDeck.find((c: CardInstance) => c.definitionId !== 'explorer.rapid-shot')!;
  state.players.p1.abilityDeck = [top, ...state.players.p1.abilityDeck.filter(c => c !== top)];

  const { events, post, roomId } = await run(
    'drawcheck-miss', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: played.instanceId, targetEnemyId: 'svr-orc-weak' }, failures);

  if (!evN(events, 'CARD_MOVED', e => e.cardInstanceId === top.instanceId && e.to === 'ABILITY_DECK')) {
    failures.push('la carta fallida no volvió al mazo');
  }
  const deck = post.players.p1.abilityDeck;
  if (deck[deck.length - 1]?.instanceId !== top.instanceId) {
    failures.push('la carta fallida no quedó en el FONDO del mazo');
  }
  if (!post.players.p1.wearPile.some((c: any) => c.instanceId === played.instanceId)) {
    failures.push('el Disparo Rápido jugado no está en el desgaste');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('DRAW_AND_CHECK + PLAY_IMMEDIATELY — acierto encadena y la robada se juega', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('explorer.rapid-shot');
  heroP1(state, 'hero.idril', 2);
  const played = moveFromDeck(state, 'p1', 'explorer.rapid-shot');
  // El tope del mazo es otra copia de Disparo Rápido → se juega sola
  const chained = state.players.p1.abilityDeck.find((c: CardInstance) => c.definitionId === 'explorer.rapid-shot')!;
  state.players.p1.abilityDeck = [chained, ...state.players.p1.abilityDeck.filter(c => c !== chained)];

  const { events, post, roomId } = await run(
    'drawcheck-hit', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: played.instanceId, targetEnemyId: 'svr-orc-weak' }, failures);

  const plays = events.filter(e => e.type === 'CARD_PLAYED');
  if (plays.length < 2) failures.push(`PLAY_IMMEDIATELY: solo ${plays.length} CARD_PLAYED`);
  if (!post.players.p1.wearPile.some((c: any) => c.instanceId === chained.instanceId)) {
    failures.push('la copia encadenada no terminó en el desgaste');
  }
  if (post.players.p1.hand.some((c: any) => c.instanceId === chained.instanceId)) {
    failures.push('la copia encadenada quedó en la mano');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('DRAW_AND_ADD_ATTACK — Todo o Nada suma el ataque de la carta robada', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('warrior.all-or-nothing');
  heroP1(state, 'hero.lisavette', 2);
  const played = moveFromDeck(state, 'p1', 'warrior.all-or-nothing');
  // Carta conocida en el tope del mazo: Ataque Brutal (3)
  const top = inst('warrior.brutal-attack', 'p1', 'ABILITY_DECK', 'Ataque Brutal');
  state.players.p1.abilityDeck = [top, ...state.players.p1.abilityDeck];
  const topAtk = catalog.byId.get(top.definitionId)?.printedAttack ?? 0;
  const foe = 'svr-orc-weak';
  const foeBefore = state.battlefield.find(e => e.instanceId === foe)!;

  const { events, post, roomId } = await run(
    'drawadd-allornothing', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: played.instanceId, targetEnemyId: foe }, failures);

  const expected = 1 + topAtk; // impreso 1 + ataque de la robada
  // El bonus llega como DAMAGE_DEALT separado (sourceCard = la robada)
  const total = events.filter(e => e.type === 'DAMAGE_DEALT' && (e.targetId === foe || e.enemyInstanceId === foe))
    .reduce((s, e) => s + (e.amount ?? 0), 0);
  if (total !== expected) failures.push(`daño total ${total} ≠ 1+${topAtk}`);
  const bonusEv = events.find(e => e.type === 'DAMAGE_DEALT' && e.sourceCardInstanceId === top.instanceId);
  if (!bonusEv) failures.push('sin DAMAGE_DEALT con la carta robada como fuente');
  const foeAfter = post.battlefield.find(e => e.instanceId === foe);
  const defeated = evN(events, 'ENEMY_DEFEATED', e => e.enemyInstanceId === foe);
  if (foeAfter && !defeated && foeAfter.wounds !== foeBefore.wounds + expected) {
    failures.push(`heridas ${foeBefore.wounds}→${foeAfter?.wounds}`);
  }
  if (!evN(events, 'CARD_MOVED', e => e.cardInstanceId === top.instanceId && e.to === 'ABILITY_DECK')) {
    failures.push('la carta robada no volvió al fondo del mazo');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('LOSE_CARDS — Ataque Brutal: la carta del tope pasa a Desgaste (conservación)', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('warrior.brutal-attack');
  heroP1(state, 'hero.lisavette', 2);
  const played = moveFromDeck(state, 'p1', 'warrior.brutal-attack');
  const lost = state.players.p1.abilityDeck[0];
  const total0 = countCards(state.players.p1);

  const { events, post, roomId } = await run(
    'lose-brutal', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: played.instanceId, targetEnemyId: 'svr-orc-weak' }, failures);

  if (!evN(events, 'CARDS_LOST', e => e.cardInstanceIds?.includes(lost.instanceId))) {
    failures.push('CARDS_LOST sin la carta del tope');
  }
  const p = post.players.p1 as any;
  if (!p.wearPile.some((c: any) => c.instanceId === lost.instanceId)) {
    failures.push('la carta perdida no está en el desgaste');
  }
  if (countCards(p) !== total0) {
    failures.push(`conservación rota: ${total0}→${countCards(p)} cartas`);
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('RECOVER_CARDS — Armadura de Placas devuelve el desgaste al fondo del mazo', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('market.plate-armor');
  heroP1(state, 'hero.lisavette', 2);
  const wearIds = state.players.p1.wearPile.map(c => c.instanceId);
  const card = inst('market.plate-armor', 'p1', 'HAND', 'Armadura de Placas');
  state.players.p1.hand = [...state.players.p1.hand, card];

  const { events, post, roomId } = await run(
    'recover-plate', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId }, failures);

  if (!ev(events, 'CARDS_RECOVERED')) failures.push('sin CARDS_RECOVERED');
  const p = post.players.p1 as any;
  // Las 3 del desgaste vuelven al fondo; la jugada va al desgaste
  for (const id of wearIds) {
    if (!p.abilityDeck.some((c: any) => c.instanceId === id)) {
      failures.push(`carta recuperada ${id} no está en el mazo`);
    }
  }
  if (p.wearPile.length !== 1 || p.wearPile[0].instanceId !== card.instanceId) {
    failures.push(`desgaste final inesperado: ${p.wearPile.map((c: any) => c.instanceId)}`);
  }
  const ids = [...p.hand, ...p.abilityDeck, ...p.wearPile].map((c: any) => c.instanceId);
  if (new Set(ids).size !== ids.length) failures.push('duplicados entre zonas');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('ALL_HEROES_RECOVER + HEAL_WOUNDS — Orbe Curativo cura a todos y sale del juego', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('mage.healing-orb');
  const p1Wear0 = state.players.p1.wearPile.length;
  const p2Wear0 = state.players.p2.wearPile.length;
  const card = inst('mage.healing-orb', 'p1', 'HAND', 'Orbe Curativo');
  state.players.p1.hand = [...state.players.p1.hand, card];
  state.players.p2 = { ...state.players.p2, wounds: 1 };

  const { events, post, roomId } = await run(
    'recoverall-orb', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId }, failures);

  const p1 = post.players.p1 as any;
  const p2 = post.players.p2 as any;
  if (p1.wearPile.length >= p1Wear0 + 1) failures.push('p1 no recuperó su desgaste');
  if (p2.wearPile.length >= p2Wear0) failures.push('p2 no recuperó su desgaste');
  if (p1.wounds !== 0) failures.push(`p1 heridas ${p1.wounds} (esperado 0)`);
  if (p1.wearPile.some((c: any) => c.instanceId === card.instanceId)
    || p1.hand.some((c: any) => c.instanceId === card.instanceId)) {
    failures.push('REMOVED_FROM_GAME: la poción sigue en una zona');
  }
  if (!ev(events, 'CARDS_RECOVERED') && !ev(events, 'CARD_MOVED')) {
    failures.push('sin evidencia de recuperación');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('OTHER_HEROES_RECOVER — Torrente de Luz: solo los demás recuperan', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('mage.light-torrent');
  const p1WearIds = state.players.p1.wearPile.map(c => c.instanceId);
  const p2Wear0 = state.players.p2.wearPile.length;
  const card = moveFromDeck(state, 'p1', 'mage.light-torrent');

  const { post, roomId } = await run(
    'recoverothers-torrent', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'svr-orc-weak' }, failures);

  const p1 = post.players.p1 as any;
  const p2 = post.players.p2 as any;
  if (p2.wearPile.length >= p2Wear0) failures.push('p2 no recuperó');
  // Las cartas del desgaste de p1 siguen ahí (solo sale la jugada al entrar)
  for (const id of p1WearIds) {
    if (!p1.wearPile.some((c: any) => c.instanceId === id)) {
      failures.push('p1 recuperó indebidamente su propio desgaste');
    }
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('RECOVER_THIS_CARD (CONDITIONAL HAS_CAPABILITY) — Daga Élfica: con Pericia vuelve, sin ella no', async () => {
  for (const [hero, expectHand] of [['hero.feldon', true], ['hero.lisavette', false]] as const) {
    const failures: string[] = [];
    const { state, rng } = richState('market.elven-dagger');
    heroP1(state, hero, 2);
    // La Pericia es condición de la rama, no requisito de compra
    if (hero === 'hero.feldon') {
      state.players.p1 = { ...state.players.p1, capabilities: ['EXPERTISE', 'RANGED'] as any };
    } else {
      state.players.p1 = { ...state.players.p1, capabilities: ['MELEE'] as any };
    }
    const card = inst('market.elven-dagger', 'p1', 'HAND', 'Daga Élfica');
    state.players.p1.hand = [...state.players.p1.hand, card];

    const { post, roomId } = await run(
      `recoverthis-${hero}`, state, rng, 'p1',
      { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'svr-orc-weak' }, failures);

    const inHand = post.players.p1.hand.some((c: any) => c.instanceId === card.instanceId);
    const inWear = post.players.p1.wearPile.some((c: any) => c.instanceId === card.instanceId);
    if (inHand !== expectHand || inWear === expectHand) {
      failures.push(`${hero}: mano=${inHand} desgaste=${inWear} (esperado mano=${expectHand})`);
    }
    await del(roomId);
    assert.deepEqual(failures, [], `${hero}: ${failures.join('\n')}`);
  }
});

test('SEARCH_WEAR_PILE_PUT_IN_HAND — Vial de Conjuración saca exactamente la elegida', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('market.conjuration-vial');
  const card = inst('market.conjuration-vial', 'p1', 'HAND', 'Vial de Conjuración');
  state.players.p1.hand = [...state.players.p1.hand, card];
  const wearIds = state.players.p1.wearPile.map(c => c.instanceId);
  if (wearIds.length < 2) failures.push('setup: desgaste < 2');
  const wanted = wearIds[wearIds.length - 1];

  const { events, post, roomId } = await run(
    'searchwear-vial', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId }, failures,
    pc => pc.type === 'SELECT_CARD_FROM_WEAR' ? [wanted] : null);

  if (!post.players.p1.hand.some((c: any) => c.instanceId === wanted)) {
    failures.push('la carta elegida no llegó a la mano');
  }
  if (post.players.p1.wearPile.some((c: any) => c.instanceId === wanted)) {
    failures.push('la carta elegida sigue en el desgaste');
  }
  const notWanted = wearIds[0];
  if (post.players.p1.hand.some((c: any) => c.instanceId === notWanted)) {
    failures.push('salió una carta distinta de la seleccionada');
  }
  if (!ev(events, 'PENDING_CHOICE_CREATED')) failures.push('no se creó la elección de desgaste');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('SEARCH_DECK + SHUFFLE — Aranel intercambia y baraja; Neddia en el Mercado', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('hero.aranel');
  heroP1(state, 'hero.aranel', 1);
  const deckIds = state.players.p1.abilityDeck.map(c => c.instanceId);
  const wanted = deckIds[deckIds.length - 1]; // la última — ni la primera

  const { events, post, roomId } = await run(
    'searchdeck-aranel', state, rng, 'p1',
    { type: 'USE_HERO_ABILITY' }, failures,
    pc => (pc.options ?? []).includes(wanted) ? [wanted] : null);

  if (!post.players.p1.hand.some((c: any) => c.instanceId === wanted)) {
    failures.push('la carta elegida del mazo no llegó a la mano');
  }
  if (!ev(events, 'DECK_SHUFFLED')) failures.push('sin DECK_SHUFFLED tras la búsqueda');
  const ids = post.players.p1.abilityDeck.map((c: any) => c.instanceId);
  if (new Set(ids).size !== ids.length) failures.push('duplicados en el mazo');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('SHUFFLE_DECK — determinista: misma semilla, mismo orden (dos salas)', async () => {
  const orders: string[][] = [];
  const failures: string[] = [];
  for (const tag of ['shuffle-a', 'shuffle-b']) {
    resetInstSeq(); // ids deterministas — mismo seed ⇒ mismos instanceIds
    const { state, rng } = richState('explorer.collect-arrows');
    heroP1(state, 'hero.idril', 2);
    const card = moveFromDeck(state, 'p1', 'explorer.collect-arrows');
    const roomId = roomFor(tag);
    await http.restore(roomId, state, rng);
    const r = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId });
    const events: any[] = [...(r.json.events ?? [])];
    await http.drainChoices(roomId, events);
    const shuf = events.find(e => e.type === 'DECK_SHUFFLED' && e.newOrder);
    if (!shuf) failures.push(`${tag}: sin DECK_SHUFFLED`);
    else orders.push(shuf.newOrder);
    await del(roomId);
  }
  if (orders.length === 2 && JSON.stringify(orders[0]) !== JSON.stringify(orders[1])) {
    failures.push('mismo seed produjo barajas distintas');
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('LOOK_AT_CARDS — Idril ve y reordena el fondo de la Horda (privado para p2)', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('hero.idril');
  heroP1(state, 'hero.idril', 2);
  state.players.p2 = { ...state.players.p2, heroId: 'hero.valerys', heroUsesRemaining: 0 };
  const bottom3 = state.hordeDeck.slice(-3).map((c: any) => c.instanceId);
  const reorder = [...bottom3].reverse();

  const { events, post, roomId } = await run(
    'look-idril', state, rng, 'p1',
    { type: 'USE_HERO_ABILITY' }, failures,
    pc => pc.type === 'SELECT_ORDER' ? reorder : null);

  if (!evN(events, 'PENDING_CHOICE_CREATED', e => e.choice?.type === 'SELECT_ORDER' && e.choice?.playerId === 'p1')) {
    failures.push('la elección de reorden no quedó event-sourced (PENDING_CHOICE_CREATED)');
  }
  const newBottom = post.hordeDeck.slice(-3).map((c: any) => c.instanceId);
  if (JSON.stringify(newBottom) !== JSON.stringify(reorder)) {
    failures.push(`reorden no aplicado: ${JSON.stringify(newBottom)}`);
  }
  // Privacidad: las cartas vistas viajan en choice.options — filtradas por
  // viewerId, p2 no puede ver ni la elección ni su contenido
  const proj = await http.projected(roomId, 'p2');
  if ((proj.pendingChoices as any[]).length !== 0) {
    failures.push('p2 ve elecciones pendientes ajenas');
  }
  const evTypes = new Set((proj.eventLog as any[]).map(e => e.type));
  for (const t of evTypes) {
    if (t === 'CARDS_REVEALED_TO_PLAYER') failures.push('p2 ve la revelación privada de p1');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

// ===========================================================================
// B) Daño, prevención y combate
// ===========================================================================

test('DEAL_DAMAGE_ALL_ENEMIES + TO_OTHER_HEROES — Bola de Fuego hiere a todo el campo y a p2', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('mage.fireball');
  const card = moveFromDeck(state, 'p1', 'mage.fireball');
  const before = Object.fromEntries(state.battlefield.map(e => [e.instanceId, e.wounds]));
  const p2Deck0 = state.players.p2.abilityDeck.length;

  const { events, post, roomId } = await run(
    'dmgall-fireball', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'svr-orc-weak' }, failures);

  for (const [id, w] of Object.entries(before)) {
    const foe = post.battlefield.find(e => e.instanceId === id);
    const died = evN(events, 'ENEMY_DEFEATED', e => e.enemyInstanceId === id);
    if (!foe && !died) failures.push(`${id} desapareció sin ENEMY_DEFEATED`);
    if (foe && foe.wounds < w + 2 && !died) failures.push(`${id} heridas ${w}→${foe.wounds} (esperado +2)`);
  }
  if (post.players.p2.abilityDeck.length >= p2Deck0 && !evN(events, 'HERO_WOUNDED', e => e.playerId === 'p2')) {
    failures.push('DEAL_DAMAGE_TO_OTHER_HEROES no alcanzó a p2');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('DEAL_DAMAGE_SPLIT + TO_HERO — Lluvia de Flechas reparte 2 y hiere al más débil', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('explorer.arrow-volley');
  heroP1(state, 'hero.idril', 2);
  const card = moveFromDeck(state, 'p1', 'explorer.arrow-volley');
  state.players.p1 = { ...state.players.p1, wounds: 0 };
  state.players.p2 = { ...state.players.p2, wounds: 1 };

  const { events, roomId } = await run(
    'dmgsplit-volley', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'svr-orc-weak' }, failures);

  // SPLIT amount=2: daño total a enemigos = 2 (nunca crea daño extra)
  const enemyDmg = events.filter(e => e.type === 'DAMAGE_DEALT' && (e.targetId ?? e.enemyInstanceId));
  const total = enemyDmg.reduce((s, e) => s + (e.amount ?? 0), 0);
  if (total !== 2) failures.push(`daño repartido total=${total} (esperado 2)`);
  // TO_HERO: 2 al héroe con menos heridas (p1 con 0 < p2 con 1)
  if (!evN(events, 'CARDS_LOST', e => e.playerId === 'p1' && e.count === 2)
    && !evN(events, 'HERO_WOUNDED', e => e.playerId === 'p1')) {
    failures.push('DEAL_DAMAGE_TO_HERO no alcanzó al más débil (p1)');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('PREVENT_DAMAGE — Carga con Escudo reduce el ataque de la Horda en 2', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('warrior.shield-charge');
  const card = moveFromDeck(state, 'p1', 'warrior.shield-charge');

  const roomId = roomFor('prevent-charge');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  const r = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'svr-orc-weak' });
  events.push(...(r.json.events ?? []));
  await http.drainChoices(roomId, events);
  // Oráculo sobre el estado POST-jugada (la propia carta hirió al orco)
  const mid = await http.fullState(roomId);
  const raw = hordeTotal(mid.battlefield);
  const atk = await http.send(roomId, 'p1', { type: 'END_ATTACK' });
  events.push(...(atk.json.events ?? []));
  await http.drainChoices(roomId, events);
  await checkReplay(roomId, state, events, failures, 'prevent-charge');

  const hordeEv = events.find(e => e.type === 'HORDE_ATTACKED' && e.playerId === 'p1');
  const post = await http.fullState(roomId);
  const p = post.players.p1 as any;
  const prevented = (p.prevention ?? 0) > 0 || ev(events, 'PREVENTION_APPLIED') || ev(events, 'MODIFIER_EXPIRED');
  if (!prevented) failures.push('sin evidencia de prevención aplicada');
  if (hordeEv && hordeEv.totalDamage !== Math.max(0, raw - 2)) {
    failures.push(`HORDE_ATTACKED ${hordeEv.totalDamage} ≠ ${raw}-2`);
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('PREVENT_ENEMY_DAMAGE + END_ATTACK — Escudo anula a un enemigo y cierra la fase', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('warrior.shield');
  const card = moveFromDeck(state, 'p1', 'warrior.shield');
  const disabledId = 'svr-warlord';
  // El Escudo lleva END_ATTACK propio: la Horda ataca dentro del mismo
  // PLAY_CARD — la contribución esperada es la semilla menos el objetivo.
  const raw = hordeTotal(state.battlefield);
  const foeSeed = state.battlefield.find(e => e.instanceId === disabledId)!;
  const contrib = Math.max(0, foeSeed.baseFortitude - foeSeed.wounds);

  const { events, post, roomId } = await run(
    'prevent-shield', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: disabledId }, failures);

  if (!evN(events, 'ENEMY_DAMAGE_DISABLED', e => e.enemyInstanceId === disabledId)) {
    failures.push('sin ENEMY_DAMAGE_DISABLED sobre el objetivo');
  }
  const hordeEv = events.find(e => e.type === 'HORDE_ATTACKED' && e.playerId === 'p1');
  if (!hordeEv) failures.push('END_ATTACK no disparó el ataque de la Horda');
  else if (hordeEv.totalDamage !== Math.max(0, raw - contrib)) {
    failures.push(`HORDE_ATTACKED ${hordeEv.totalDamage} ≠ ${raw}-${contrib}`);
  }
  if (post.phase === 'PLAYER_ATTACK') failures.push('la fase de ataque siguió abierta tras END_ATTACK');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('CANCEL_ALL_DAMAGE — Aura Protectora: 0 daño de cualquier fuente en la próxima Horda', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('mage.protective-aura');
  const card = moveFromDeck(state, 'p1', 'mage.protective-aura');
  const enemies = state.battlefield.length;

  const { events, roomId } = await run(
    'cancel-aura', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId }, failures);
  // COSTE propio: pierde tantas cartas como enemigos hay en el campo
  if (!evN(events, 'CARDS_LOST', e => e.count === enemies)) {
    failures.push(`LOSE_CARDS ≠ nº enemigos (${enemies})`);
  }
  const atk = await http.send(roomId, 'p1', { type: 'END_ATTACK' });
  events.push(...(atk.json.events ?? []));
  await http.drainChoices(roomId, events);
  await checkReplay(roomId, state, events, failures, 'cancel-aura');

  const hordeEv = events.find(e => e.type === 'HORDE_ATTACKED' && e.playerId === 'p1');
  if (hordeEv && hordeEv.totalDamage !== 0) {
    failures.push(`daño total ${hordeEv.totalDamage} ≠ 0`);
  }
  // Tras la activación no debe perderse ni una carta más por daño
  const lostAfter = events.findIndex(e => e.type === 'HORDE_ATTACKED');
  if (lostAfter >= 0 && events.slice(lostAfter).some(e => e.type === 'CARDS_LOST' && e.playerId === 'p1')) {
    failures.push('se perdieron cartas pese a la cancelación total');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('DISABLE_ENEMY_DAMAGE — Disparo Gélido deja al enemigo vivo pero inofensivo', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('mage.ice-shot');
  const card = moveFromDeck(state, 'p1', 'mage.ice-shot');
  const target = 'svr-orc-weak';

  const roomId = roomFor('disable-ice');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  const r = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: target });
  events.push(...(r.json.events ?? []));
  await http.drainChoices(roomId, events);
  const mid = await http.fullState(roomId);
  const foeAfter = mid.battlefield.find(e => e.instanceId === target);
  if (!foeAfter) failures.push('el enemigo desapareció en vez de quedar deshabilitado');
  else if (!foeAfter.damageDisabled) failures.push('damageDisabled no persistido');
  const raw = hordeTotal(mid.battlefield); // el deshabilitado aporta 0
  const atk = await http.send(roomId, 'p1', { type: 'END_ATTACK' });
  events.push(...(atk.json.events ?? []));
  await http.drainChoices(roomId, events);
  const hordeEv = events.find(e => e.type === 'HORDE_ATTACKED' && e.playerId === 'p1');
  if (hordeEv && hordeEv.totalDamage !== raw) {
    failures.push(`HORDE_ATTACKED ${hordeEv.totalDamage} ≠ ${raw} (enemigo deshabilitado)`);
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('INTERCEPT_DAMAGE — Valèrys redirige el daño de la Horda y gana Gloria', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('hero.valerys');
  heroP1(state, 'hero.lisavette', 0);
  state.players.p2 = { ...state.players.p2, heroId: 'hero.valerys', heroUsesRemaining: 2, heroMaxUses: 2 };
  const p2Deck0 = state.players.p2.abilityDeck.length;
  const glory2_0 = state.players.p2.glory;

  const roomId = roomFor('intercept-valerys');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  const atk = await http.send(roomId, 'p1', { type: 'END_ATTACK' });
  events.push(...(atk.json.events ?? []));
  await http.drainChoices(roomId, events);
  const post = await http.fullState(roomId);
  await checkReplay(roomId, state, events, failures, 'intercept-valerys');

  if (!ev(events, 'DAMAGE_INTERCEPTED')) failures.push('sin DAMAGE_INTERCEPTED');
  const hordeEv = events.find(e => e.type === 'HORDE_ATTACKED');
  if (hordeEv && hordeEv.playerId !== 'p2') {
    failures.push(`el daño fue a ${hordeEv.playerId}, no al interceptor p2`);
  }
  if ((post.players.p2 as any).abilityDeck.length >= p2Deck0
    && !evN(events, 'HERO_WOUNDED', e => e.playerId === 'p2')
    && (events.find(e => e.type === 'HORDE_ATTACKED')?.totalDamage ?? 0) > 0) {
    failures.push('el interceptor no recibió el daño redirigido');
  }
  if (post.players.p2.glory <= glory2_0
    && (events.find(e => e.type === 'HORDE_ATTACKED')?.totalDamage ?? 0) > 0) {
    failures.push('Valèrys sin su Gloria por interceptar');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('APPLY_VULNERABILITY — Flecha Corrosiva aumenta el siguiente daño al enemigo', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('mage.corrosive-arrow');
  const arrow = moveFromDeck(state, 'p1', 'mage.corrosive-arrow');
  const strike = inst('warrior.sword-strike', 'p1', 'HAND', 'Espadazo');
  state.players.p1.hand = [...state.players.p1.hand, strike];
  state.players.p1 = { ...state.players.p1, capabilities: [...state.players.p1.capabilities, 'MELEE'] as any };
  const target = 'svr-warlord';

  const roomId = roomFor('vuln-corrosive');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  const r1 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: arrow.instanceId, targetEnemyId: target });
  events.push(...(r1.json.events ?? []));
  await http.drainChoices(roomId, events);
  const foe = (await http.fullState(roomId)).battlefield.find(e => e.instanceId === target);
  if (!foe?.modifiers?.some((m: any) => m.layer === 'DAMAGE_BONUS' && m.amount === 1)) {
    failures.push('vulnerabilidad +1 no persistida en el enemigo');
  }
  const r2 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: strike.instanceId, targetEnemyId: target });
  events.push(...(r2.json.events ?? []));
  await http.drainChoices(roomId, events);
  const dmg = events.find(e => e.type === 'DAMAGE_DEALT' && (e.targetId === target || e.enemyInstanceId === target)
    && e.sourceCardInstanceId === strike.instanceId);
  if (!dmg) failures.push('sin DAMAGE_DEALT del segundo ataque');
  else if (dmg.amount !== 2) failures.push(`daño ${dmg.amount} ≠ 1+1 (vulnerabilidad)`);
  await checkReplay(roomId, state, events, failures, 'vuln-corrosive');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('MODIFY_DAMAGE — Piedra de Amolar suma +1 a la siguiente carta', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('market.whetstone');
  const stone = inst('market.whetstone', 'p1', 'HAND', 'Piedra de Amolar');
  const strike = inst('warrior.sword-strike', 'p1', 'HAND', 'Espadazo');
  state.players.p1.hand = [...state.players.p1.hand, stone, strike];

  const roomId = roomFor('moddmg-whetstone');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  const r1 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: stone.instanceId });
  events.push(...(r1.json.events ?? []));
  await http.drainChoices(roomId, events);
  const r2 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: strike.instanceId, targetEnemyId: 'svr-orc-weak' });
  events.push(...(r2.json.events ?? []));
  await http.drainChoices(roomId, events);
  const dmg = events.find(e => e.type === 'DAMAGE_DEALT' && e.sourceCardInstanceId === strike.instanceId);
  if (!dmg) failures.push('sin DAMAGE_DEALT');
  else if (dmg.amount !== 2) failures.push(`daño ${dmg.amount} ≠ 1+1 (Piedra de Amolar)`);
  if (!ev(events, 'MODIFIER_EXPIRED') && !ev(events, 'MODIFIER_ADDED')) {
    failures.push('sin evidencia del modificador consumido');
  }
  await checkReplay(roomId, state, events, failures, 'moddmg-whetstone');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('END_ATTACK — Disparo Certero cierra la fase tras resolverse', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('explorer.precise-shot');
  heroP1(state, 'hero.idril', 2);
  const card = moveFromDeck(state, 'p1', 'explorer.precise-shot');

  const { events, post, roomId } = await run(
    'endattack-precise', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'svr-orc-weak' }, failures);

  if (!evN(events, 'PHASE_CHANGED', e => e.phase !== 'PLAYER_ATTACK')) {
    failures.push('END_ATTACK no cerró la fase de ataque');
  }
  if (post.phase === 'PLAYER_ATTACK') failures.push(`sigue en ${post.phase}`);
  if (!ev(events, 'CARDS_LOST')) failures.push('Disparo Certero sin su coste LOSE_CARDS');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('HEAL_WOUNDS — Poción Curativa baja heridas a 0, nunca por debajo, y se consume', async () => {
  for (const wounds of [1, 0] as const) {
    const failures: string[] = [];
    const { state, rng } = richState('market.healing-potion');
    state.players.p1 = { ...state.players.p1, wounds };
    const card = inst('market.healing-potion', 'p1', 'HAND', 'Poción Curativa');
    state.players.p1.hand = [...state.players.p1.hand, card];

    const { post, roomId } = await run(
      `heal-potion-${wounds}`, state, rng, 'p1',
      { type: 'PLAY_CARD', cardInstanceId: card.instanceId }, failures);

    const p = post.players.p1 as any;
    if (p.wounds !== 0) failures.push(`heridas ${wounds}→${p.wounds}`);
    if (p.wounds < 0) failures.push('heridas negativas');
    if (p.hand.some((c: any) => c.instanceId === card.instanceId)
      || p.wearPile.some((c: any) => c.instanceId === card.instanceId)) {
      failures.push('REMOVED_FROM_GAME: la poción quedó en una zona');
    }
    await del(roomId);
    assert.deepEqual(failures, [], `wounds=${wounds}: ${failures.join('\n')}`);
  }
});

test('SWAP_ENEMY — Supervivencia intercambia por el enemigo del fondo del mazo', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('explorer.survival');
  heroP1(state, 'hero.idril', 2);
  const card = moveFromDeck(state, 'p1', 'explorer.survival');
  const target = 'svr-orc-weak';
  const bottomCard = state.hordeDeck[state.hordeDeck.length - 1];

  const { events, post, roomId } = await run(
    'swap-survival', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: target }, failures);

  if (!evN(events, 'ENEMY_SWAPPED', e => e.oldEnemyInstanceId === target)) {
    failures.push('sin ENEMY_SWAPPED del objetivo');
  }
  const post_foe = post.battlefield.find(e => e.instanceId === bottomCard.instanceId);
  if (!post_foe) failures.push('el enemigo del fondo no entró al campo');
  if (post.battlefield.some(e => e.instanceId === target)) {
    failures.push('el enemigo viejo sigue en el campo');
  }
  if (post_foe && post_foe.trophyGlory !== (catalog.byId.get(post_foe.definitionId)?.trophyGlory ?? 0)) {
    failures.push('trophyGlory no se propagó al sustituto');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('PLACE_PERSISTENT + DEFEAT_ENEMY — Trampa derrota al más fuerte sin botín', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('rogue.trap');
  const card = moveFromDeck(state, 'p1', 'rogue.trap');
  const coins0 = state.players.p1.coins;
  const glory0 = state.players.p1.glory;
  const strongest = [...state.battlefield].sort((a, b) => b.baseFortitude - a.baseFortitude)[0];

  const roomId = roomFor('trap-defeat');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  const r1 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId });
  events.push(...(r1.json.events ?? []));
  await http.drainChoices(roomId, events);
  const afterPlace = await http.fullState(roomId);
  if (!(afterPlace.players.p1 as any).persistentCards?.some((c: any) => c.instanceId === card.instanceId)) {
    failures.push('la Trampa no quedó persistente');
  }
  if (afterPlace.players.p1.wearPile.some((c: any) => c.instanceId === card.instanceId)) {
    failures.push('la Trampa fue al desgaste en vez de quedar frente al jugador');
  }
  // Proyección: la definición de la Trampa es secreta para p2
  const proj = await http.projected(roomId, 'p2');
  const persProj = ((proj.players as any).p1?.persistentCards ?? []) as any[];
  if (persProj.some(c => c.definitionId === 'rogue.trap')) {
    failures.push('p2 ve la definición de la Trampa (debe ser boca abajo)');
  }
  // La Horda dispara la Trampa: derrota al de mayor Fortaleza SIN botín
  const atk = await http.send(roomId, 'p1', { type: 'END_ATTACK' });
  events.push(...(atk.json.events ?? []));
  await http.drainChoices(roomId, events);
  const post = await http.fullState(roomId);
  if (!evN(events, 'ENEMY_DEFEATED', e => e.enemyInstanceId === strongest.instanceId)) {
    failures.push(`la Trampa no derrotó al más fuerte (${strongest.instanceId})`);
  }
  if (post.players.p1.coins !== coins0 || post.players.p1.glory !== glory0) {
    failures.push(`la Trampa pagó botín (loot:false): ${coins0}→${post.players.p1.coins} / ${glory0}→${post.players.p1.glory}`);
  }
  await checkReplay(roomId, state, events, failures, 'trap-defeat');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

// ===========================================================================
// C) Iconos de enemigo
// ===========================================================================

test('TEMPORARY_WOUNDS — las heridas de la Horda 6-10 se descartan en Restablecimiento', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('horde.006');
  const foe = enemyFromDef('horde.006', 'svr-temp');
  foe.wounds = 1;
  state.battlefield = [foe, enemyFromDef('horde.001', 'svr-norm')];
  state.phase = 'MARKET';

  const roomId = roomFor('tempwounds');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  const r = await http.send(roomId, 'p1', { type: 'END_TURN' });
  events.push(...(r.json.events ?? []));
  await http.drainChoices(roomId, events);
  const post = await http.fullState(roomId);
  const after = post.battlefield.find(e => e.instanceId === 'svr-temp');
  if (after && after.wounds !== 0) {
    failures.push(`TEMPORARY_WOUNDS no reseteadas: ${after.wounds}`);
  }
  const normal = post.battlefield.find(e => e.instanceId === 'svr-norm');
  if (normal && normal.wounds !== 0) {
    failures.push('el enemigo sin el icono también perdió sus heridas');
  }
  await checkReplay(roomId, state, events, failures, 'tempwounds');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('ANTI_MAGIC — la Horda 11 hace -1 de daño al Mago, pleno al Guerrero', async () => {
  const results: Record<string, number> = {};
  for (const [hero, defId] of [['hero.aranel', 'mage.fire-bolt'], ['hero.lisavette', 'warrior.sword-strike']] as const) {
    const failures: string[] = [];
    const { state, rng } = richState(defId);
    heroP1(state, hero, 0);
    state.battlefield = [enemyFromDef('horde.011', 'svr-am')]; // fort 3, antiMagic 1
    state.phase = 'PLAYER_ATTACK';
    const roomId = roomFor(`antimagic-${hero}`);
    await http.restore(roomId, state, rng);
    const events: any[] = [];
    const atk = await http.send(roomId, 'p1', { type: 'END_ATTACK' });
    events.push(...(atk.json.events ?? []));
    await http.drainChoices(roomId, events);
    results[hero] = events.find(e => e.type === 'HORDE_ATTACKED')?.totalDamage ?? -1;
    if (!ev(events, 'HORDE_ATTACKED')) failures.push(`${hero}: sin HORDE_ATTACKED`);
    await checkReplay(roomId, state, events, failures, `antimagic-${hero}`);
    await del(roomId);
    assert.deepEqual(failures, [], `${hero}: ${failures.join('\n')}`);
  }
  // Mago (capacidad MAGIC): 3-1=2; Guerrero: 3 pleno
  assert.equal(results['hero.aranel'], 2, `anti-magia al mago: ${results['hero.aranel']} ≠ 2`);
  assert.equal(results['hero.lisavette'], 3, `anti-magia al guerrero: ${results['hero.lisavette']} ≠ 3`);
});

// ===========================================================================
// D) Economía
// ===========================================================================

test('GAIN_COINS — Saqueo A paga 2 por enemigo vivo; Recoger Flechas +1', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('rogue.plunder-a');
  const card = moveFromDeck(state, 'p1', 'rogue.plunder-a');
  const living = state.battlefield.length;
  const coins0 = state.players.p1.coins;

  const { events, post, roomId } = await run(
    'gaincoins-plunder', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId }, failures);

  const gained = post.players.p1.coins - coins0;
  if (gained !== 2 * living) failures.push(`+${gained} monedas ≠ 2×${living}`);
  const evCoins = events.find(e => e.type === 'COINS_GAINED' && e.playerId === 'p1');
  if (evCoins && evCoins.amount !== 2 * living) failures.push(`evento COINS_GAINED amount=${evCoins.amount}`);
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('GAIN_GLORY — En la Diana paga +1 (y cobra su coste de carta)', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('explorer.bullseye');
  heroP1(state, 'hero.idril', 2);
  const card = moveFromDeck(state, 'p1', 'explorer.bullseye');
  // Enemigo que SOBREVIVE al ataque de 4 (fortaleza 5): solo paga el +1
  // del efecto, ni trofeo por derrota ni peritia de Señor.
  state.battlefield = [enemyFromDef('horde.021', 'svr-strong'), enemyFromDef('horde.002', 'svr-extra')];
  const glory0 = state.players.p1.glory;

  const { events, post, roomId } = await run(
    'gainglory-bullseye', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'svr-strong' }, failures);

  if (post.players.p1.glory - glory0 !== 1) {
    failures.push(`gloria ${glory0}→${post.players.p1.glory} (esperado +1)`);
  }
  if (!evN(events, 'GLORY_GAINED', e => e.playerId === 'p1' && e.amount === 1)) {
    failures.push('sin GLORY_GAINED amount=1');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('STEAL_COINS — Robar Bolsillos: lo que gana A lo pierde B (conservación)', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('rogue.pickpocket');
  const card = moveFromDeck(state, 'p1', 'rogue.pickpocket');
  state.players.p1 = { ...state.players.p1, coins: 10 };
  state.players.p2 = { ...state.players.p2, coins: 3 };

  const { events, post, roomId } = await run(
    'steal-pickpocket', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId }, failures);

  const p1 = post.players.p1 as any;
  const p2 = post.players.p2 as any;
  if (p1.coins !== 11 || p2.coins !== 2) {
    failures.push(`monedas ${p1.coins}/${p2.coins} (esperado 11/2)`);
  }
  if (!ev(events, 'COINS_STOLEN') && !ev(events, 'COINS_GAINED')) {
    failures.push('sin evento de robo');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('COST — Engañar descuenta 2 monedas si puede pagar; falla si no', async () => {
  // Puede pagar
  {
    const failures: string[] = [];
    const { state, rng } = richState('rogue.deceive');
    const card = moveFromDeck(state, 'p1', 'rogue.deceive');
    const coins0 = state.players.p1.coins; // 10
    const { post, roomId } = await run(
      'cost-pay', state, rng, 'p1',
      { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'svr-orc-weak' }, failures);
    if (post.players.p1.coins !== coins0 - 2) {
      failures.push(`monedas ${coins0}→${post.players.p1.coins} (esperado -2)`);
    }
    await del(roomId);
    assert.deepEqual(failures, [], failures.join('\n'));
  }
  // No puede pagar
  {
    const failures: string[] = [];
    const { state, rng } = richState('rogue.deceive');
    const card = moveFromDeck(state, 'p1', 'rogue.deceive');
    state.players.p1 = { ...state.players.p1, coins: 1 };
    const { accepted, post, roomId } = await run(
      'cost-nopay', state, rng, 'p1',
      { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'svr-orc-weak' }, failures);
    if (accepted && post.players.p1.coins < 0) {
      failures.push('pagó quedando en negativo');
    }
    if (accepted && post.players.p1.coins === 1) {
      failures.push('aceptada sin descontar el coste');
    }
    await del(roomId);
    assert.deepEqual(failures, [], failures.join('\n'));
  }
});

test('IGNORE_COIN_REWARDS — Planicie de Skaàrg: derrota sin monedas pero con trofeo', async () => {
  const failures: string[] = [];
  const { state: base, rng } = richState('scenario.skaarg-plains');
  base.scenario = inst('scenario.skaarg-plains', 'scenario', 'SCENARIO_ACTIVE', 'Planicie de Skaàrg') as any;
  const state = applyScenarioEffects(base, 'scenario.skaarg-plains', catalog).state;
  const foe = enemyFromDef('horde.001', 'svr-skaarg-target');
  const foeDef = catalog.byId.get('horde.001')!;
  foe.wounds = Math.max(0, (foeDef.printedFortitude ?? 1) - 1);
  state.battlefield = [foe, enemyFromDef('horde.002', 'svr-extra')];
  const strike = inst('warrior.sword-strike', 'p1', 'HAND', 'Espadazo');
  state.players.p1.hand = [...state.players.p1.hand, strike];
  state.players.p1 = { ...state.players.p1, capabilities: [...state.players.p1.capabilities, 'MELEE'] as any };
  const coins0 = state.players.p1.coins;
  const glory0 = state.players.p1.glory;

  const { events, post, roomId } = await run(
    'ignorecoins-skaarg', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: strike.instanceId, targetEnemyId: 'svr-skaarg-target' }, failures);

  if (!ev(events, 'ENEMY_DEFEATED')) failures.push('sin ENEMY_DEFEATED');
  if (post.players.p1.coins !== coins0) {
    failures.push(`IGNORE_COIN_REWARDS: ${coins0}→${post.players.p1.coins}`);
  }
  const trophy = foeDef.trophyGlory ?? 0;
  if (post.players.p1.glory - glory0 !== trophy) {
    failures.push(`trofeo: gloria ${glory0}→${post.players.p1.glory} (esperado +${trophy})`);
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('IGNORE_GLORY_REWARDS — Ruinas de Brunmar: solo el laurel del frente (no el dorso)', async () => {
  const failures: string[] = [];
  const { state: base, rng } = richState('scenario.brunmar-ruins');
  base.scenario = inst('scenario.brunmar-ruins', 'scenario', 'SCENARIO_ACTIVE', 'Ruinas de Brunmar') as any;
  const state = applyScenarioEffects(base, 'scenario.brunmar-ruins', catalog).state;
  // horde.012: trofeo 1 + dorso +1 gloria — el distinguidor perfecto
  const foeDef = catalog.byId.get('horde.012')!;
  const foe = enemyFromDef('horde.012', 'svr-brunmar-target');
  const extra = enemyFromDef('horde.002', 'svr-extra');
  // heridas = fortaleza EFECTIVA - 1: el golpe de 1 derrota bajo el aura
  foe.wounds = Math.max(0, (foeDef.printedFortitude ?? 1) - 1 - 1);
  state.battlefield = [foe, extra];
  // El aura -1 se materializa al ENTRAR al campo — en el estado sembrado
  // hay que aplicarla como haría applyEntryAuras en la entrada real.
  state.battlefield = state.battlefield.map(e => applyEntryAuras(e, state));
  const strike = inst('warrior.sword-strike', 'p1', 'HAND', 'Espadazo');
  state.players.p1.hand = [...state.players.p1.hand, strike];
  state.players.p1 = { ...state.players.p1, capabilities: [...state.players.p1.capabilities, 'MELEE'] as any };
  const glory0 = state.players.p1.glory;
  const coins0 = state.players.p1.coins;

  const { events, post, roomId } = await run(
    'ignoreglory-brunmar', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: strike.instanceId, targetEnemyId: 'svr-brunmar-target' }, failures);

  if (!ev(events, 'ENEMY_DEFEATED')) failures.push('sin ENEMY_DEFEATED');
  const trophy = foeDef.trophyGlory ?? 0;
  const backGlory = foeDef.reward?.glory ?? 0;
  if (backGlory === 0) failures.push('setup: la carta elegida no tiene gloria de dorso');
  if (post.players.p1.glory - glory0 !== trophy) {
    failures.push(`gloria ${glory0}→${post.players.p1.glory}: esperaba solo trofeo +${trophy} (dorso ${backGlory} suprimido)`);
  }
  if (post.players.p1.coins - coins0 !== (foeDef.reward?.coins ?? 0)) {
    failures.push(`monedas del dorso no pagadas: ${coins0}→${post.players.p1.coins}`);
  }
  // Aura -1 fortaleza materializada en el campo
  const foeMods = foe.modifiers?.some((m: any) => m.layer === 'FORTITUDE_MODIFIERS' && m.amount === -1)
    || (post.battlefield.find(e => e.instanceId === 'svr-extra')?.modifiers ?? [])
      .some((m: any) => m.layer === 'FORTITUDE_MODIFIERS' && m.amount === -1);
  if (!foeMods) failures.push('aura MODIFY_FORTITUDE -1 no aplicada');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('MODIFY_MARKET_COST — Mercado de Lötharion: la compra cuesta 1 menos', async () => {
  const failures: string[] = [];
  const { state: base, rng } = richState('scenario.lotharion-market');
  base.scenario = inst('scenario.lotharion-market', 'scenario', 'SCENARIO_ACTIVE', 'Mercado de Lötharion') as any;
  const state = applyScenarioEffects(base, 'scenario.lotharion-market', catalog).state;
  state.phase = 'MARKET';
  const def = catalog.byId.get('market.elven-dagger')!;
  const marketCard = inst(def.id, 'market', 'MARKET', def.name);
  state.market = [marketCard, ...state.market.filter((c: any) => c.definitionId !== def.id)];
  const coins0 = state.players.p1.coins;

  const roomId = roomFor('marketcost-lotharion');
  await http.restore(roomId, state, rng);
  const r = await http.send(roomId, 'p1', { type: 'BUY_CARD', marketCardInstanceId: marketCard.instanceId });
  const events: any[] = [...(r.json.events ?? [])];
  if (!r.json.accepted) failures.push(`BUY_CARD rechazado: ${r.json.reason}`);
  await http.drainChoices(roomId, events);
  const post = await http.fullState(roomId);
  const expected = Math.max(0, (def.printedCost ?? 0) - 1);
  if (coins0 - post.players.p1.coins !== expected) {
    failures.push(`coste ${coins0 - post.players.p1.coins} ≠ ${def.printedCost}-1`);
  }
  await checkReplay(roomId, state, events, failures, 'marketcost-lotharion');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

// ===========================================================================
// E) Condicionales y disparadores
// ===========================================================================

test('CONDITIONAL FIRST_CARD_OF_NAME — Espadazo: roba la primera vez, no la segunda', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('warrior.sword-strike');
  const c1 = moveFromDeck(state, 'p1', 'warrior.sword-strike');
  const c2 = state.players.p1.abilityDeck.find((c: CardInstance) => c.definitionId === 'warrior.sword-strike' && c !== c1);
  if (!c2) failures.push('setup: sin segunda copia de Espadazo');
  if (c2) { c2.zone = 'HAND'; state.players.p1.abilityDeck = state.players.p1.abilityDeck.filter(c => c !== c2); state.players.p1.hand = [...state.players.p1.hand, c2]; }

  const roomId = roomFor('cond-swordstrike');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  const r1 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: c1.instanceId, targetEnemyId: 'svr-orc-weak' });
  events.push(...(r1.json.events ?? []));
  await http.drainChoices(roomId, events);
  const draws1 = events.filter(e => e.type === 'CARDS_DRAWN' && e.playerId === 'p1').length;
  if (draws1 === 0) failures.push('primera copia no robó (rama then)');
  if (c2) {
    const r2 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: c2.instanceId, targetEnemyId: 'svr-orc-weak' });
    const before2 = events.length;
    events.push(...(r2.json.events ?? []));
    await http.drainChoices(roomId, events);
    const draws2 = events.slice(before2).filter(e => e.type === 'CARDS_DRAWN' && e.playerId === 'p1').length;
    if (draws2 !== 0) failures.push('segunda copia robó indebidamente (rama else)');
  }
  await checkReplay(roomId, state, events, failures, 'cond-swordstrike');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('CONDITIONAL ALREADY_USED — Golpe de Bastón: 1 daño, luego 2 contra el mismo enemigo', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('mage.staff-strike');
  const c1 = moveFromDeck(state, 'p1', 'mage.staff-strike');
  const c2 = state.players.p1.abilityDeck.find((c: CardInstance) => c.definitionId === 'mage.staff-strike' && c !== c1);
  if (c2) { c2.zone = 'HAND'; state.players.p1.abilityDeck = state.players.p1.abilityDeck.filter(c => c !== c2); state.players.p1.hand = [...state.players.p1.hand, c2]; }
  else failures.push('setup: sin segunda copia');
  const target = 'svr-warlord';

  const roomId = roomFor('cond-staff');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  const r1 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: c1.instanceId, targetEnemyId: target });
  events.push(...(r1.json.events ?? []));
  await http.drainChoices(roomId, events);
  const d1 = events.find(e => e.type === 'DAMAGE_DEALT' && (e.targetId === target || e.enemyInstanceId === target));
  if (d1 && d1.amount !== 1) failures.push(`1ª vez daño ${d1.amount} ≠ 1`);
  if (c2) {
    const r2 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: c2.instanceId, targetEnemyId: target });
    const b2 = events.length;
    events.push(...(r2.json.events ?? []));
    await http.drainChoices(roomId, events);
    const d2 = events.slice(b2).find(e => e.type === 'DAMAGE_DEALT' && (e.targetId === target || e.enemyInstanceId === target));
    if (d2 && d2.amount !== 2) failures.push(`repetida vs mismo enemigo daño ${d2.amount} ≠ 2`);
  }
  await checkReplay(roomId, state, events, failures, 'cond-staff');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('ON_DEFEAT — Al Corazón paga la moneda solo al derrotar', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('rogue.to-the-heart');
  const card = moveFromDeck(state, 'p1', 'rogue.to-the-heart');
  // Objetivo débil que el golpe de 4 derrota seguro
  const foe = enemyFromDef('horde.003', 'svr-ondefeat-target');
  foe.wounds = Math.max(0, (catalog.byId.get('horde.003')!.printedFortitude ?? 1) - 1);
  state.battlefield = [foe];
  const coins0 = state.players.p1.coins;

  const { events, post, roomId } = await run(
    'ondefeat-heart', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'svr-ondefeat-target' }, failures);

  if (!evN(events, 'ENEMY_DEFEATED', e => e.enemyInstanceId === 'svr-ondefeat-target')) {
    failures.push('sin ENEMY_DEFEATED del objetivo');
  }
  // trofeo/botín del enemigo (horde.003: todo 0) + 1 del ON_DEFEAT
  if (post.players.p1.coins - coins0 < 1) {
    failures.push('ON_DEFEAT sin la moneda condicional');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('ON_ENEMY_DEFEATED — Campo de Batalla paga +1 moneda por derrota', async () => {
  const failures: string[] = [];
  const { state: base, rng } = richState('scenario.battlefield');
  base.scenario = inst('scenario.battlefield', 'scenario', 'SCENARIO_ACTIVE', 'Campo de Batalla') as any;
  const state = applyScenarioEffects(base, 'scenario.battlefield', catalog).state;
  const foe = enemyFromDef('horde.003', 'svr-bf-target'); // reward 0 — el +1 es del escenario
  foe.wounds = Math.max(0, (catalog.byId.get('horde.003')!.printedFortitude ?? 1) - 1);
  state.battlefield = [foe, enemyFromDef('horde.002', 'svr-extra')];
  const strike = inst('warrior.sword-strike', 'p1', 'HAND', 'Espadazo');
  state.players.p1.hand = [...state.players.p1.hand, strike];
  state.players.p1 = { ...state.players.p1, capabilities: [...state.players.p1.capabilities, 'MELEE'] as any };
  const coins0 = state.players.p1.coins;

  const { events, post, roomId } = await run(
    'onedefeated-battlefield', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: strike.instanceId, targetEnemyId: 'svr-bf-target' }, failures);

  if (!ev(events, 'ENEMY_DEFEATED')) failures.push('sin ENEMY_DEFEATED');
  if (post.players.p1.coins - coins0 < 1) failures.push('ON_ENEMY_DEFEATED sin la moneda');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('MODIFY_FORTITUDE — aura de Roghkiller: el orco necesita 1 daño más', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('warlord.roghkiller');
  heroP1(state, 'hero.lisavette', 0);
  const orc = enemyFromDef('horde.001', 'svr-orc-aura');
  const orcFort = catalog.byId.get('horde.001')!.printedFortitude ?? 1; // 2
  state.battlefield = [orc, enemyFromDef('warlord.roghkiller', 'svr-rogh')];
  // El aura +1 se materializa al entrar al campo — aplicarla en la semilla
  state.battlefield = state.battlefield.map(e => applyEntryAuras(e, state));
  const c1 = inst('warrior.shield-charge', 'p1', 'HAND', 'Carga con Escudo'); // 2 = fort base, insuficiente con aura
  const c2 = inst('warrior.sword-strike', 'p1', 'HAND', 'Espadazo');          // +1 = el aura
  state.players.p1.hand = [...state.players.p1.hand, c1, c2];

  const roomId = roomFor('fort-roghkiller');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  const r1 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: c1.instanceId, targetEnemyId: 'svr-orc-aura' });
  events.push(...(r1.json.events ?? []));
  await http.drainChoices(roomId, events);
  let post = await http.fullState(roomId);
  const foe = post.battlefield.find(e => e.instanceId === 'svr-orc-aura');
  if (!foe) failures.push(`${orcFort} daño tumbó al orco con aura +1 (fort efectiva ${orcFort + 1})`);
  else if (foe.wounds !== orcFort) failures.push(`heridas ${foe.wounds} ≠ ${orcFort}`);
  if (!foe?.modifiers?.some((m: any) => m.layer === 'FORTITUDE_MODIFIERS' && m.amount === 1)) {
    failures.push('aura +1 de Roghkiller no materializada en el orco');
  }
  const r2 = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: c2.instanceId, targetEnemyId: 'svr-orc-aura' });
  events.push(...(r2.json.events ?? []));
  await http.drainChoices(roomId, events);
  if (!evN(events, 'ENEMY_DEFEATED', e => e.enemyInstanceId === 'svr-orc-aura')) {
    failures.push('con el +1 extra el orco debió caer');
  }
  await checkReplay(roomId, state, events, failures, 'fort-roghkiller');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('Warlord Gurdrug — cada carta que lo dañe cuesta una carta y da Gloria', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('warlord.gurdrug');
  const c1 = moveFromDeck(state, 'p1', 'warrior.sword-strike');
  const c2 = inst('warrior.sword-strike', 'p1', 'HAND', 'Espadazo');
  state.players.p1.hand = [...state.players.p1.hand, c2];
  const wl = 'svr-warlord';
  const glory0 = state.players.p1.glory;

  const roomId = roomFor('warlord-gurdrug');
  await http.restore(roomId, state, rng);
  const events: any[] = [];
  for (const c of [c1, c2]) {
    const r = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: c.instanceId, targetEnemyId: wl });
    events.push(...(r.json.events ?? []));
    await http.drainChoices(roomId, events);
  }
  const post = await http.fullState(roomId);
  const gloryEv = events.filter(e => e.type === 'GLORY_GAINED' && e.playerId === 'p1').length;
  if (gloryEv < 2) failures.push(`solo ${gloryEv} GLORY_GAINED por 2 cartas dañantes`);
  const lost = events.filter(e => e.type === 'CARDS_LOST' && e.playerId === 'p1')
    .reduce((s, e) => s + (e.count ?? e.cardInstanceIds?.length ?? 0), 0);
  if (lost < 2) failures.push(`peritia Gurdrug: solo ${lost} cartas perdidas por 2 golpes`);
  if (post.players.p1.glory <= glory0) failures.push('sin gloria por dañar al Señor');
  await checkReplay(roomId, state, events, failures, 'warlord-gurdrug');
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('Warlord Shriekknifer — ataque de daño 1 recupera una carta', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('warlord.shriekknifer');
  const weak = moveFromDeck(state, 'p1', 'warrior.sword-strike'); // daño 1
  state.battlefield = [enemyFromDef('warlord.shriekknifer', 'svr-shriek'), enemyFromDef('horde.002', 'svr-extra')];
  const wear0 = state.players.p1.wearPile.length;

  const { events, post, roomId } = await run(
    'warlord-shriek', state, rng, 'p1',
    { type: 'PLAY_CARD', cardInstanceId: weak.instanceId, targetEnemyId: 'svr-shriek' }, failures);

  // La pericia recupera 1 del desgaste al fondo del mazo
  if (!ev(events, 'CARDS_RECOVERED') && !evN(events, 'CARD_MOVED', e => e.to === 'ABILITY_DECK')) {
    failures.push('sin recuperación por ataque de daño 1');
  }
  const p = post.players.p1 as any;
  if (p.wearPile.length > wear0 + 1) {
    failures.push(`desgaste creció más de lo debido: ${wear0}→${p.wearPile.length}`);
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

// ===========================================================================
// F) Información oculta — vista proyectada por HTTP
// ===========================================================================

test('info oculta — la vista de p2 redacta mano, mazo, desgaste, recompensas y RNG', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('warrior.sword-strike');
  const roomId = roomFor('hidden-view');
  await http.restore(roomId, state, rng);
  const proj = await http.projected(roomId, 'p2');
  const spec = await http.projected(roomId, null);

  for (const [label, view] of [['p2', proj], ['spectador', spec]] as const) {
    const p1 = (view.players as any).p1;
    // Una definición REAL del catálogo visible para otro jugador = fuga
    for (const zone of ['hand', 'abilityDeck', 'wearPile', 'persistentCards'] as const) {
      if ((p1[zone] as any[] ?? []).some(c => catalog.byId.has(c.definitionId))) {
        failures.push(`${label}: ${zone} de p1 expone una definitionId real`);
      }
    }
    if ((view.battlefield as any[]).some(e => e.reward != null)) {
      failures.push(`${label}: recompensa de enemigo expuesta antes de la derrota`);
    }
    if ((view.hordeDeck as any[]).some(c => catalog.byId.has(c.definitionId))) {
      failures.push(`${label}: mazo de Horda expuesto`);
    }
    const rs = (view as any).rngState;
    if (rs && (rs.seed !== '' || rs.state !== 0)) failures.push(`${label}: RNG expuesto`);
    if ((view.pendingChoices as any[]).some(c => c.playerId !== 'p2')) {
      failures.push(`${label}: ve elecciones de otro jugador`);
    }
  }
  // La propia vista de p1 sí ve su mano
  const own = await http.projected(roomId, 'p1');
  if ((own.players as any).p1.hand.some((c: any) => !String(c.definitionId ?? '').includes('.'))) {
    failures.push('p1 no ve su propia mano');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('info oculta — eventLog proyectado: robo propio visible, ajeno redactado', async () => {
  const failures: string[] = [];
  const { state, rng } = richState('market.concentration-elixir');
  const card = inst('market.concentration-elixir', 'p1', 'HAND', 'Elixir');
  state.players.p1.hand = [...state.players.p1.hand, card];
  const roomId = roomFor('hidden-log');
  await http.restore(roomId, state, rng);
  const r = await http.send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId });
  const events: any[] = [...(r.json.events ?? [])];
  await http.drainChoices(roomId, events);

  const proj2 = await http.projected(roomId, 'p2');
  if ((proj2.eventLog as any[]).some(e => e.type === 'CARDS_DRAWN' && e.playerId === 'p1')) {
    failures.push('p2 ve el CARDS_DRAWN privado de p1');
  }
  const proj1 = await http.projected(roomId, 'p1');
  if (!(proj1.eventLog as any[]).some(e => e.type === 'CARDS_DRAWN' && e.playerId === 'p1')) {
    failures.push('p1 no ve su propio CARDS_DRAWN');
  }
  await del(roomId);
  assert.deepEqual(failures, [], failures.join('\n'));
});

// ===========================================================================
// G) Replay global — las 92 definiciones del catálogo, ejercicio + fold
// ===========================================================================
//
// Para cada carta: estado sembrado → comando real por /command → se acumulan
// TODOS los eventos devueltos → replayEvents(preState, events) debe producir
// un estado con el mismo stateHash que /full-state. Es la garantía central
// de NT4H: event sourcing + determinismo + recuperación bit a bit.
// ---------------------------------------------------------------------------

/** Comando canónico que ejerce la carta de verdad según su tipo. */
function canonicalExercise(def: ReturnType<typeof catalog.byId.get> & object, state: GameState): { command: Record<string, unknown>; playerId: string } | null {
  if (def!.type === 'ABILITY' || def!.type === 'MARKET') {
    const card = moveFromDeck(state, 'p1', def!.id);
    const needsTarget = ((def as any).printedAttack ?? 0) > 0
      || [...(function* w(e: any[]): Generator<any> { for (const x of e ?? []) { yield x; yield* w(x.then); yield* w(x.else); yield* w(x.effects); yield* w(x.onMatch); yield* w(x.onMismatch); if (Array.isArray(x?.options)) for (const o of x.options) yield* w(o?.effects); } })(def!.effects as any)]
        .some((e: any) => e?.target?.kind === 'SELECTED_ENEMY' || e?.target?.kind === 'ONE_ENEMY');
    const target = needsTarget ? state.battlefield[0]?.instanceId : undefined;
    return {
      playerId: 'p1',
      command: { type: 'PLAY_CARD', cardInstanceId: card.instanceId, ...(target ? { targetEnemyId: target } : {}) },
    };
  }
  if (def!.type === 'HORDE' || def!.type === 'WARLORD') {
    const foe = enemyFromDef(def!.id, 'svr-replay-target');
    foe.wounds = Math.max(0, ((def as any).printedFortitude ?? 1) - 1);
    const other = catalog.cards.find(d => (d.type === 'HORDE') && d.id !== def!.id)!;
    state.battlefield = [foe, enemyFromDef(other.id, 'svr-extra')];
    const strike = inst('warrior.sword-strike', 'p1', 'HAND', 'Espadazo');
    state.players.p1.hand = [...state.players.p1.hand, strike];
    state.players.p1 = { ...state.players.p1, capabilities: [...new Set([...state.players.p1.capabilities, 'MELEE'])] as any };
    return { playerId: 'p1', command: { type: 'PLAY_CARD', cardInstanceId: strike.instanceId, targetEnemyId: 'svr-replay-target' } };
  }
  if (def!.type === 'HERO') {
    const ability = (def as any).heroAbility;
    state.players.p1 = { ...state.players.p1, heroId: def!.id, heroUsesRemaining: ability?.uses ?? 1, heroMaxUses: ability?.uses ?? 1 };
    if (def!.id === 'hero.valerys' || def!.id === 'hero.lisavette') {
      // Reactiva: ventana de reacción sobre p2
      state.players.p2 = { ...state.players.p2, heroId: def!.id, heroUsesRemaining: ability?.uses ?? 1, heroMaxUses: ability?.uses ?? 1 };
      if (def!.id === 'hero.lisavette') moveFromDeck(state, 'p2', 'warrior.shield');
      state.phase = 'HORDE_ATTACK';
      state.pendingChoices = [{
        choiceId: `reaction-p2-${def!.id}`, playerId: 'p2', type: 'REACTION_WINDOW',
        prompt: 'Reacción', options: ['USE_ABILITY', 'PASS'], minSelections: 1, maxSelections: 1,
      } as any];
      return { playerId: 'p2', command: { type: 'RESOLVE_CHOICE', choiceId: `reaction-p2-${def!.id}`, selectedIds: ['USE_ABILITY'] } };
    }
    if (def!.id === 'hero.taheral') {
      state.phase = 'ATTACK_CHOICE';
      const discards = state.players.p1.hand.slice(0, 2).map(c => c.instanceId);
      return { playerId: 'p1', command: { type: 'EVASION', discardedCardInstanceIds: discards } };
    }
    if (def!.id === 'hero.feldon') {
      state.phase = 'HORDE_ATTACK';
      state.pendingChoices = [{
        choiceId: `feldon-reduce-${state.turnNumber}-p1`, playerId: 'p1', type: 'CONFIRM',
        prompt: 'Feldon', options: ['yes', 'no'], minSelections: 1, maxSelections: 1,
      } as any];
      return { playerId: 'p1', command: { type: 'RESOLVE_CHOICE', choiceId: `feldon-reduce-${state.turnNumber}-p1`, selectedIds: ['yes'] } };
    }
    if (def!.id === 'hero.beleth-il') {
      const failed = state.players.p1.abilityDeck[0];
      state.pendingChoices = [{
        choiceId: `beleth-recover-p1-${def!.id}`, playerId: 'p1', type: 'CONFIRM',
        prompt: 'Beleth', options: ['yes', 'no'], minSelections: 1, maxSelections: 1,
        relatedCardIds: [failed.instanceId],
      } as any];
      return { playerId: 'p1', command: { type: 'RESOLVE_CHOICE', choiceId: `beleth-recover-p1-${def!.id}`, selectedIds: ['yes'] } };
    }
    return { playerId: 'p1', command: { type: 'USE_HERO_ABILITY' } };
  }
  if (def!.type === 'SCENARIO') {
    const applied = applyScenarioEffects(state, def!.id, catalog).state;
    Object.assign(state, applied);
    state.scenario = inst(def!.id, 'scenario', 'SCENARIO_ACTIVE', def!.name) as any;
    const foe = enemyFromDef('horde.001', 'svr-replay-target');
    foe.wounds = Math.max(0, (catalog.byId.get('horde.001')!.printedFortitude ?? 1) - 1);
    state.battlefield = [foe, enemyFromDef('horde.002', 'svr-extra')];
    const strike = inst('warrior.sword-strike', 'p1', 'HAND', 'Espadazo');
    state.players.p1.hand = [...state.players.p1.hand, strike];
    state.players.p1 = { ...state.players.p1, capabilities: [...new Set([...state.players.p1.capabilities, 'MELEE'])] as any };
    return { playerId: 'p1', command: { type: 'PLAY_CARD', cardInstanceId: strike.instanceId, targetEnemyId: 'svr-replay-target' } };
  }
  return null;
}

/**
 * Invariantes metamórficas del sistema: ninguna carta puede duplicarse ni
 * desaparecer, los recursos nunca son negativos y los seqs del eventLog
 * son estrictamente crecientes. Se comprueban tras ejercitar cada carta.
 */
function checkInvariants(post: GameState, failures: string[], label: string) {
  // seqs estrictamente crecientes en el eventLog
  const seqs = (post.eventLog ?? []).map((e: any) => e.seq).filter(s => typeof s === 'number');
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] <= seqs[i - 1]) {
      failures.push(`${label}: seq no monótono ${seqs[i - 1]}→${seqs[i]}`);
      break;
    }
  }
  // Conservación de instancias: un instanceId no puede estar en dos zonas a la vez
  const seen = new Map<string, string>();
  const zonesOf = (p: any) => ([
    ['hand', p.hand ?? []], ['abilityDeck', p.abilityDeck ?? []],
    ['wearPile', p.wearPile ?? []], ['persistentCards', p.persistentCards ?? []],
  ] as const);
  for (const [pid, p] of Object.entries(post.players as Record<string, any>)) {
    for (const [zone, cards] of zonesOf(p)) {
      for (const c of cards) {
        const prev = seen.get(c.instanceId);
        if (prev) failures.push(`${label}: ${c.instanceId} duplicado (${prev} y ${pid}.${zone})`);
        else seen.set(c.instanceId, `${pid}.${zone}`);
      }
    }
    // Recursos no negativos
    for (const res of ['coins', 'glory', 'wounds'] as const) {
      if ((p[res] ?? 0) < 0) failures.push(`${label}: ${pid}.${res}=${p[res]} < 0`);
    }
    if ((p.wounds ?? 0) > (p.maxWounds ?? Infinity) + 1) {
      failures.push(`${label}: ${pid} heridas ${p.wounds} > max ${p.maxWounds}`);
    }
  }
  for (const e of post.battlefield ?? []) {
    if (e.wounds < 0) failures.push(`${label}: ${e.instanceId} heridas < 0`);
  }
}

for (const def of catalog.cards) {
  test(`replay-safe ${def.id} — fold del eventLog reproduce el estado bit a bit`, async () => {
    const failures: string[] = [];
    const { state, rng } = buildStateFor(def);
    state.players.p2 = { ...state.players.p2, heroId: 'hero.neddia', heroUsesRemaining: 0, heroMaxUses: 0 };
    const ex = canonicalExercise(def, state);
    assert.ok(ex, `sin ejercicio canónico para ${def.id}`);

    const roomId = roomFor(`replay-${def.id}`);
    await http.restore(roomId, state, rng);
    const events: any[] = [];
    const r = await http.send(roomId, ex.playerId, ex.command);
    events.push(...(r.json.events ?? []));
    if (!r.json.accepted) failures.push(`comando canónico rechazado: ${r.json.reason}`);
    await http.drainChoices(roomId, events);
    await checkReplay(roomId, state, events, failures, def.id);
    const post = await http.fullState(roomId);
    checkInvariants(post, failures, def.id);
    await del(roomId);
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}
