/**
 * Fidelidad literal — una aserción por cláusula del texto impreso.
 *
 * server-cards.test.ts cubre «la carta se puede jugar» y
 * server-effects.test.ts cubre «el tipo de efecto funciona»; esta suite
 * audita que cada cláusula del texto de la carta (altText, verificado
 * contra los PNG de apps/mobile/assets/cards) se cumple al pie de la
 * letra: segundas cláusulas, exclusión del lanzador, límites de uso
 * («una vez / dos veces por partida») y casos negativos.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { applyScenarioEffects, onTurnStart } from '@nt4h/engine';
import {
  bootServer, makeHttp, catalog, roomIdFor, inst, enemyFromDef,
  moveFromDeck, buildStateFor, resetInstSeq, type Http,
} from './test-harness.js';
import type { CardDefinition, CardInstance, GameState } from '@nt4h/schema';

let server: Server;
let http: Http;

before(async () => {
  ({ server } = await bootServer());
  http = makeHttp(`http://127.0.0.1:${(server.address() as any).port}`);
});
after(() => server.close());

const send = (...a: Parameters<Http['send']>) => http.send(...a);
const drainChoices = (...a: Parameters<Http['drainChoices']>) => http.drainChoices(...a);
const del = (...a: Parameters<Http['del']>) => http.del(...a);

/** Estado base para una carta, con la carta en mano de p1. */
async function seededPlay(cardId: string, tweak?: (s: GameState) => void) {
  resetInstSeq();
  const def = catalog.byId.get(cardId)!;
  const { state, rng } = buildStateFor(def);
  const card = moveFromDeck(state, 'p1', cardId);
  tweak?.(state);
  const roomId = roomIdFor(cardId, '-clause');
  await http.restore(roomId, state, rng);
  return { roomId, card, state };
}

/** Estado base con `heroId` como héroe de p1 y `uses` usos restantes. */
async function seededHero(heroId: string, uses: number, suffix: string, tweak?: (s: GameState) => void) {
  resetInstSeq();
  const def = catalog.byId.get(heroId)!;
  const { state, rng } = buildStateFor(def);
  state.players.p1 = {
    ...state.players.p1, heroId,
    heroUsesRemaining: uses, heroMaxUses: uses,
  };
  tweak?.(state);
  const roomId = roomIdFor(heroId, suffix);
  await http.restore(roomId, state, rng);
  return { roomId, state, rng };
}

const deckCount = (st: GameState, pid: string) =>
  (st.players as any)[pid].abilityDeck.length;
const handCount = (st: GameState, pid: string) =>
  (st.players as any)[pid].hand.length;
const findCard = (cards: CardInstance[], defId: string) =>
  cards.find(c => c.definitionId === defId);

// ---------------------------------------------------------------------------
// Segundas/terceras cláusulas del texto impreso
// ---------------------------------------------------------------------------

test('«Voz de Aliento»: todos recuperan 2 — Y roba 1 — Y gana 1 Gloria', async () => {
  const { roomId, card } = await seededPlay('warrior.voice-of-encouragement', (s) => {
    // p2 necesita ≥2 cartas en desgaste para que «recupera 2» sea observable
    s.players.p2.wearPile = [
      inst('warrior.sword-strike', 'p2', 'WEAR_PILE', 'Espadazo'),
      inst('warrior.step-back', 'p2', 'WEAR_PILE', 'Paso Atrás'),
    ];
  });
  const before = await http.fullState(roomId);
  const r = await send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId });
  assert.equal(r.status, 200);
  const events = [...(r.json.events ?? [])];
  await drainChoices(roomId, events);
  const st = await http.fullState(roomId);
  for (const pid of ['p1', 'p2']) {
    const recovered = events.filter(e =>
      e.type === 'CARDS_RECOVERED' && e.playerId === pid);
    const total = recovered.reduce((n, e) => n + (e.count ?? e.cardIds?.length ?? 0), 0);
    assert.equal(total, 2, `${pid} debe recuperar 2 cartas`);
  }
  // Desgaste p1: 3 iniciales −2 recuperadas +1 la carta jugada = 2
  assert.equal(
    st.players.p1.wearPile.length,
    (before.players.p1 as any).wearPile.length - 1,
    'desgaste p1: −2 recuperadas +1 carta jugada');
  const drawn = events.filter(e => e.type === 'CARDS_DRAWN' && e.playerId === 'p1');
  assert.equal(drawn.reduce((n, e) => n + (e.count ?? e.cardIds?.length ?? 0), 0), 1,
    'cláusula «Roba 1 carta»');
  const glory = events.find(e => e.type === 'GLORY_GAINED' && e.playerId === 'p1');
  assert.equal(glory?.amount, 1, 'cláusula «ganas 1 ficha de Gloria»');
  await del(roomId);
});

test('«Recoger Flechas»: solo recupera «Disparo Rápido», baraja el mazo y da 1 Moneda', async () => {
  const { roomId, card } = await seededPlay('explorer.collect-arrows', (s) => {
    // Desgaste controlado: un Disparo Rápido + una carta ajena que NO debe moverse
    s.players.p1.wearPile = [
      inst('explorer.rapid-shot', 'p1', 'WEAR_PILE', 'Disparo Rápido'),
      inst('explorer.precise-shot', 'p1', 'WEAR_PILE', 'Disparo Certero'),
    ];
  });
  const coinsBefore = (await http.fullState(roomId)).players.p1.coins;
  const r = await send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId });
  assert.equal(r.status, 200);
  const events = [...(r.json.events ?? [])];
  await drainChoices(roomId, events);
  const st = await http.fullState(roomId);
  // El Disparo Rápido sale del desgaste al fondo del mazo
  assert.ok(findCard(st.players.p1.abilityDeck, 'explorer.rapid-shot'),
    '«Disparo Rápido» debe volver al mazo de Habilidad');
  assert.ok(!findCard(st.players.p1.wearPile, 'explorer.rapid-shot'),
    '«Disparo Rápido» sale del desgaste');
  // La carta ajena permanece en el desgaste (filtro por nombre literal)
  assert.ok(findCard(st.players.p1.wearPile, 'explorer.precise-shot'),
    'carta que no es «Disparo Rápido» NO se recupera');
  assert.ok(events.some(e => e.type === 'DECK_SHUFFLED'),
    'cláusula «Baraja el Mazo de Habilidades»');
  assert.equal(st.players.p1.coins, coinsBefore + 1, 'cláusula «Ganas 1 Moneda»');
  await del(roomId);
});

test('«Disparo Gélido»: el enemigo queda inerte — Y «Roba 1 carta»', async () => {
  const { roomId, card } = await seededPlay('mage.ice-shot');
  const before = await http.fullState(roomId);
  const target = before.battlefield[0].instanceId;
  const r = await send(roomId, 'p1', {
    type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: target,
  });
  assert.equal(r.status, 200);
  const events = [...(r.json.events ?? [])];
  await drainChoices(roomId, events);
  assert.ok(events.some(e => e.type === 'CARDS_DRAWN' && e.playerId === 'p1'),
    'cláusula «Roba 1 carta»');
  const st = await http.fullState(roomId);
  assert.equal(handCount(st, 'p1'), handCount(before, 'p1'), // -1 jugada +1 robada
    'la mano queda igual: -1 carta jugada +1 robada');
  await del(roomId);
});

test('«Torrente de Luz»: el resto recupera 2, el lanzador NO — y gana 1 Gloria', async () => {
  const { roomId, card } = await seededPlay('mage.light-torrent', (s) => {
    s.players.p2.wearPile = [
      inst('warrior.sword-strike', 'p2', 'WEAR_PILE', 'Espadazo'),
      inst('warrior.step-back', 'p2', 'WEAR_PILE', 'Paso Atrás'),
    ];
  });
  const before = await http.fullState(roomId);
  // printedAttack 2 → objetivo obligatorio; apuntamos al enemigo medio
  const target = before.battlefield[1]?.instanceId ?? before.battlefield[0].instanceId;
  const r = await send(roomId, 'p1', {
    type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: target,
  });
  assert.equal(r.status, 200);
  assert.ok(r.json.accepted !== false, `rechazada: ${r.json.reason}`);
  const events = [...(r.json.events ?? [])];
  await drainChoices(roomId, events);
  const st = await http.fullState(roomId);
  // «El resto de héroes»: p2 recupera, p1 NO
  const p2Recovered = events
    .filter(e => e.type === 'CARDS_RECOVERED' && e.playerId === 'p2')
    .reduce((n, e) => n + (e.count ?? e.cardIds?.length ?? 0), 0);
  assert.equal(p2Recovered, 2, 'p2 (otro héroe) recupera 2');
  const p1Recovered = events
    .filter(e => e.type === 'CARDS_RECOVERED' && e.playerId === 'p1')
    .reduce((n, e) => n + (e.count ?? e.cardIds?.length ?? 0), 0);
  assert.equal(p1Recovered, 0, '«el resto» excluye al lanzador');
  assert.equal(st.players.p1.glory, before.players.p1.glory + 1,
    'cláusula «Ganas 1 ficha de Gloria»');
  await del(roomId);
});

test('«Saqueo B»: 1 Moneda por enemigo vivo — Y 1 Punto de Gloria', async () => {
  const { roomId, card } = await seededPlay('rogue.plunder-b');
  const before = await http.fullState(roomId);
  const living = before.battlefield.length;
  const r = await send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId });
  assert.equal(r.status, 200);
  const events = [...(r.json.events ?? [])];
  await drainChoices(roomId, events);
  const st = await http.fullState(roomId);
  assert.equal(st.players.p1.coins, before.players.p1.coins + living,
    '«1 Moneda por cada enemigo vivo»');
  assert.equal(st.players.p1.glory, before.players.p1.glory + 1,
    '«Gana 1 Punto de Gloria»');
  await del(roomId);
});

test('«Robar Bolsillos»: roba 1 Moneda a CADA OTRO héroe, nunca a sí mismo', async () => {
  const { roomId, card } = await seededPlay('rogue.pickpocket');
  const before = await http.fullState(roomId);
  const r = await send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId });
  assert.equal(r.status, 200);
  const events = [...(r.json.events ?? [])];
  await drainChoices(roomId, events);
  const st = await http.fullState(roomId);
  assert.equal(st.players.p2.coins, before.players.p2.coins - 1,
    'p2 pierde exactamente 1');
  assert.equal(st.players.p1.coins, before.players.p1.coins + 1,
    'p1 gana lo robado (1 con 2 jugadores)');
  // Conservación: monedas totales inalteradas
  const tot = (s: GameState) =>
    Object.values(s.players).reduce((n: number, p: any) => n + p.coins, 0);
  assert.equal(tot(st), tot(before), 'las monedas se transfieren, no se crean');
  await del(roomId);
});

test('«Paso Atrás»: roba exactamente 2 cartas', async () => {
  const { roomId, card } = await seededPlay('warrior.step-back');
  const before = await http.fullState(roomId);
  const r = await send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId });
  assert.equal(r.status, 200);
  const events = [...(r.json.events ?? [])];
  await drainChoices(roomId, events);
  const st = await http.fullState(roomId);
  assert.equal(handCount(st, 'p1'), handCount(before, 'p1') + 1, // -1 +2
    'mano neta +1 (jugó 1, robó 2)');
  assert.equal(deckCount(st, 'p1'), deckCount(before, 'p1') - 2,
    'el mazo pierde exactamente 2');
  await del(roomId);
});

// «Pierdes 1 carta» — la cláusula de coste en desgaste, por carta
const LOSE_ONE = [
  'warrior.brutal-attack', 'warrior.double-slash',
  'explorer.precise-shot', 'explorer.bullseye',
  'mage.corrosive-arrow', 'rogue.to-the-heart',
];
for (const cardId of LOSE_ONE) {
  test(`«Pierdes 1 carta» — ${cardId}: el tope del mazo va al Desgaste`, async () => {
    const { roomId, card } = await seededPlay(cardId, (s) => {
      // Vulnerabilidad/disparos dirigidos necesitan objetivo legal
      s.phase = 'PLAYER_ATTACK';
    });
    const before = await http.fullState(roomId);
    const topCard = (before.players.p1 as any).abilityDeck[0];
    const cmd: Record<string, unknown> = { type: 'PLAY_CARD', cardInstanceId: card.instanceId };
    const def = catalog.byId.get(cardId)!;
    if ((def.printedAttack ?? 0) > 0 ||
        (def.effects as any[])?.some(e =>
          e.type === 'APPLY_VULNERABILITY' || e.target?.kind === 'SELECTED_ENEMY')) {
      cmd.targetEnemyId = before.battlefield[1].instanceId; // no el débil, no matar
    }
    const r = await send(roomId, 'p1', cmd);
    assert.equal(r.status, 200, `${cardId} rechazado: ${JSON.stringify(r.json)}`);
    const events = [...(r.json.events ?? [])];
    await drainChoices(roomId, events);
    const st = await http.fullState(roomId);
    // Oráculo literal: la carta que estaba en el tope pasa al Desgaste.
    // (No se cuenta el desgaste total: cartas con END_ATTACK pueden sumar
    //  más pérdidas por el ataque de la Horda en el mismo comando.)
    const lostTop = st.players.p1.wearPile.some(
      c => c.instanceId === topCard.instanceId);
    assert.ok(lostTop,
      `la carta perdida debe ser el tope (${topCard.definitionId}/${topCard.instanceId})`);
    assert.equal(deckCount(st, 'p1'), deckCount(before, 'p1') - 1,
      '«Pierdes 1 carta»: el mazo pierde exactamente 1');
    await del(roomId);
  });
}

// «Previenes 2 puntos de Daño» — dos cartas con la misma cláusula.
// Se juegan en PLAYER_ATTACK y luego END_ATTACK dispara la Horda: el
// HORDE_ATTACKED total debe ser el daño bruto del campo menos 2.
const hordeTotal = (bf: any[]) =>
  bf.reduce((n, e) => n + Math.max(0, (e.baseFortitude ?? 0) - (e.wounds ?? 0)) *
    (e.damageDisabled ? 0 : 1), 0);

for (const cardId of ['explorer.companion-wolf', 'rogue.in-the-shadows']) {
  test(`«Previenes 2» — ${cardId}: el daño de la Horda baja en 2`, async () => {
    const { roomId, card } = await seededPlay(cardId, (s) => {
      // p1 como pícaro sería Feldon (mitiga a la mitad las cartas perdidas)
      // y p2 (Valèrys) interceptaría el daño: ambas pericias se neutralizan
      // para observar solo la prevención impresa.
      s.players.p1 = { ...s.players.p1, heroId: 'hero.neddia' as any, heroUsesRemaining: 0 };
      s.players.p2 = { ...s.players.p2, heroId: 'hero.aranel' as any, heroUsesRemaining: 0 };
    });
    const before = await http.fullState(roomId);
    // Tienen printedAttack: requieren objetivo (D441). Apuntamos al
    // enemigo medio para no derrotarlo y distorsionar el daño de la Horda.
    const target = before.battlefield[1]?.instanceId ?? before.battlefield[0].instanceId;
    const r = await send(roomId, 'p1', {
      type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: target,
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.accepted !== false, `${cardId} rechazada: ${r.json.reason}`);
    const events = [...(r.json.events ?? [])];
    await drainChoices(roomId, events);
    // Oráculo post-jugada: el daño bruto lo fija el campo actual
    const mid = await http.fullState(roomId);
    const raw = hordeTotal(mid.battlefield as any[]);
    const atk = await send(roomId, 'p1', { type: 'END_ATTACK' });
    events.push(...(atk.json.events ?? []));
    await drainChoices(roomId, events);
    const hordeEv = events.find(e => e.type === 'HORDE_ATTACKED' && e.playerId === 'p1');
    assert.ok(hordeEv, 'sin HORDE_ATTACKED tras END_ATTACK');
    assert.equal(hordeEv.totalDamage, Math.max(0, raw - 2),
      `daño de Horda ${hordeEv.totalDamage} ≠ ${raw}-2`);
    await del(roomId);
  });
}

// ---------------------------------------------------------------------------
// Límites de uso impresos — «Una vez por partida» / «Dos veces por partida»
// ---------------------------------------------------------------------------

// Pericias ACTIVAS: se ejercita USE_HERO_ABILITY tantas veces como dice la
// carta; la siguiente activación debe ser rechazada por el runner.
const ACTIVE_USES: { hero: string; uses: number }[] = [
  { hero: 'hero.aranel', uses: 1 },   // «1 vez por partida»
  { hero: 'hero.neddia', uses: 1 },   // «Una vez por partida»
  { hero: 'hero.idril', uses: 2 },    // «Dos veces por partida»
];

for (const { hero, uses } of ACTIVE_USES) {
  test(`límite impreso — ${hero}: ${uses} uso(s) aceptados, el siguiente rechazado`, async () => {
    const { roomId } = await seededHero(hero, uses, '-active-uses');
    for (let i = 0; i < uses; i++) {
      const r = await send(roomId, 'p1', { type: 'USE_HERO_ABILITY' });
      assert.equal(r.status, 200);
      assert.ok(r.json.accepted, `${hero}: uso ${i + 1}/${uses} rechazado: ${r.json.reason}`);
      const events = [...(r.json.events ?? [])];
      await drainChoices(roomId, events);
      const st = await http.fullState(roomId);
      assert.equal((st.players.p1 as any).heroUsesRemaining, uses - i - 1,
        `uso ${i + 1} no decrementó heroUsesRemaining`);
    }
    const r = await send(roomId, 'p1', { type: 'USE_HERO_ABILITY' });
    assert.ok(r.json.accepted === false || r.status !== 200,
      `${hero}: el uso ${uses + 1} debe ser rechazado («${uses === 1 ? 'una' : 'dos'} veces por partida»)`);
    await del(roomId);
  });
}

// Pericias PASIVAS/REACTIVAS: el texto las dispara en un evento concreto
// (Horda, Evasión, Disparo Rápido). Aquí se verifica que una elección
// residual con 0 usos restantes NO consume ni emite HERO_ABILITY_USED —
// el guarda `heroUsesRemaining > 0` debe interceptarla.
const REACTIVE: { hero: string; uses: number; choiceId: string }[] = [
  { hero: 'hero.feldon', uses: 1, choiceId: 'feldon-reduce-1-p1' },
  { hero: 'hero.valerys', uses: 2, choiceId: 'reaction-p1-stale' },
  { hero: 'hero.lisavette', uses: 2, choiceId: 'reaction-p1-stale' },
  { hero: 'hero.beleth-il', uses: 2, choiceId: 'beleth-recover-p1-stale' },
  { hero: 'hero.taheral', uses: 1, choiceId: 'reaction-p1-stale' },
];

for (const { hero, uses, choiceId } of REACTIVE) {
  test(`límite impreso — ${hero}: con 0 usos una elección residual no dispara nada`, async () => {
    const { roomId } = await seededHero(hero, uses, '-reactive-uses', (s) => {
      s.players.p1 = { ...s.players.p1, heroUsesRemaining: 0 };
      s.phase = 'HORDE_ATTACK';
      s.pendingChoices = [{
        choiceId, playerId: 'p1', type: 'CONFIRM',
        prompt: 'opt-in residual', options: ['yes', 'no'],
        minSelections: 1, maxSelections: 1,
      } as any];
    });
    const r = await send(roomId, 'p1', {
      type: 'RESOLVE_CHOICE', choiceId, selectedIds: ['yes'],
    });
    const events = [...(r.json.events ?? [])];
    await drainChoices(roomId, events);
    assert.ok(!events.some(e => e.type === 'HERO_ABILITY_USED' && e.playerId === 'p1'),
      `${hero}: HERO_ABILITY_USED emitido con 0 usos restantes`);
    const st = await http.fullState(roomId);
    assert.equal((st.players.p1 as any).heroUsesRemaining, 0,
      'heroUsesRemaining no debe bajar de 0');
    await del(roomId);
  });
}

// ---------------------------------------------------------------------------
// Casos negativos / condiciones de disparo literales
// ---------------------------------------------------------------------------

test('Feldon — «Al resolver el Ataque de la Horda»: sin daño entrante no hay oferta', async () => {
  // Campo sin enemigos: daño entrante = 0 → no hay decisión que ofrecer.
  const { roomId } = await seededHero('hero.feldon', 1, '-nodmg', (s) => {
    s.battlefield = [];
    s.phase = 'HORDE_ATTACK';
  });
  const events: any[] = [];
  await drainChoices(roomId, events);
  const st = await http.fullState(roomId);
  const offered = (st.pendingChoices ?? []).some((c: any) =>
    String(c.choiceId).includes('feldon'));
  assert.ok(!offered, 'con 0 daño entrante no debe ofrecerse el opt-in de Feldon');
  assert.equal((st.players.p1 as any).heroUsesRemaining, 1,
    'el uso no se consume sin oferta');
  await del(roomId);
});

test('Feldon — cuando el daño de la Horda cae sobre OTRO héroe, Feldon no interviene', async () => {
  // Texto impreso: «tan solo pierde la mitad de cartas…» — el sujeto es el
  // propio Feldon; el opt-in solo debe ofrecerse al héroe que recibe daño.
  const { roomId } = await seededHero('hero.feldon', 1, '-other', (s) => {
    // p2 (Valèrys) es el jugador activo y recibe el daño de la Horda
    s.activePlayerId = 'p2';
    s.phase = 'HORDE_ATTACK';
    s.players.p2 = { ...s.players.p2, heroUsesRemaining: 0 }; // sin reactivas
  });
  const events: any[] = [];
  await drainChoices(roomId, events);
  const st = await http.fullState(roomId);
  const feldonOffered = (st.pendingChoices ?? []).some((c: any) =>
    c.playerId === 'p1' && String(c.choiceId).includes('feldon'));
  assert.ok(!feldonOffered,
    'Feldon no debe recibir opt-in cuando el daño cae sobre otro héroe');
  assert.equal((st.players.p1 as any).heroUsesRemaining, 1,
    'la pericia de Feldon no se consume por daño ajeno');
  await del(roomId);
});

test('«Lluvia de Flechas» — empate a menos Heridas → el jugador elige (SELECT_HERO)', async () => {
  const { roomId, card } = await seededPlay('explorer.arrow-volley', (s) => {
    // p1 y p2 con las mismas heridas → empate literal «tú eliges»
    s.players.p1 = { ...s.players.p1, wounds: 2 };
    s.players.p2 = { ...s.players.p2, wounds: 2 };
  });
  const r = await send(roomId, 'p1', { type: 'PLAY_CARD', cardInstanceId: card.instanceId });
  assert.equal(r.status, 200);
  const events = [...(r.json.events ?? [])];
  await drainChoices(roomId, events);
  const offeredHeroChoice = events.some(e =>
    e.type === 'PENDING_CHOICE_CREATED' && e.choice?.type === 'SELECT_HERO');
  assert.ok(offeredHeroChoice,
    '«en caso de empate, tú eliges» exige SELECT_HERO');
  await del(roomId);
});

test('«Golpe de Bastón» — mismo enemigo dos veces: 1º daño 1, 2º daño 2 (literal)', async () => {
  // Objetivo robusto sembrado: debe sobrevivir al primer golpe (1) para
  // que el segundo (2) también pueda resolverse contra él.
  const { roomId, state } = await seededPlay('mage.staff-strike', (s) => {
    const extra = inst('mage.staff-strike', 'p1', 'HAND', 'Golpe de Bastón');
    s.players.p1.hand = [...s.players.p1.hand, extra];
    // Hueste normal con fortaleza alta (Gurdrug costaría 1 carta por golpe)
    const tank = enemyFromDef('horde.001', 'lit-tank');
    (tank as any).baseFortitude = 10;
    s.battlefield = [tank];
  });
  const strikes = state.players.p1.hand.filter(
    c => c.definitionId === 'mage.staff-strike').slice(0, 2);
  assert.equal(strikes.length, 2, 'se necesitan 2 copias en mano');
  const amounts: number[] = [];
  for (const c of strikes) {
    const r = await send(roomId, 'p1', {
      type: 'PLAY_CARD', cardInstanceId: c.instanceId, targetEnemyId: 'lit-tank',
    });
    assert.ok(r.json.accepted !== false, `jugada rechazada: ${r.json.reason}`);
    const events = [...(r.json.events ?? [])];
    await drainChoices(roomId, events);
    const dmg = events
      .filter(e => e.type === 'DAMAGE_DEALT' && e.targetId === 'lit-tank')
      .reduce((n, e) => n + (e.amount ?? 0), 0);
    amounts.push(dmg);
  }
  assert.deepEqual(amounts, [1, 2],
    'primera=1, segunda contra el MISMO enemigo=2 (texto literal)');
  await del(roomId);
});

// ---------------------------------------------------------------------------
// Escenarios — cláusulas del texto impreso
// ---------------------------------------------------------------------------

/** Estado con escenario activo (auras aplicadas) y oferta de inicio de turno. */
async function seededScenario(scenarioId: string, tweak?: (s: GameState) => void) {
  resetInstSeq();
  const def = catalog.byId.get(scenarioId)! as CardDefinition;
  const { state: base, rng } = buildStateFor(def);
  const applied = applyScenarioEffects(base, scenarioId, catalog).state;
  applied.scenario = inst(scenarioId, 'scenario', 'SCENARIO_ACTIVE', def.name) as any;
  tweak?.(applied);
  const offer = onTurnStart(applied, scenarioId);
  if (offer) {
    applied.pendingChoices = [{
      choiceId: `turn-start-${applied.turnNumber}`, playerId: 'p1', type: 'CONFIRM',
      prompt: offer.prompt, options: [], minSelections: 0, maxSelections: 1,
    } as any];
  }
  const roomId = roomIdFor(scenarioId, '-clause');
  await http.restore(roomId, applied, rng);
  return { roomId };
}

test('«Pantano Umbrío»: +1 Moneda solo si el enemigo vencido tiene Fortaleza ≥3', async () => {
  // Rama positiva: horde.008 (fortaleza ≥3)
  const { roomId: r1 } = await seededScenario('scenario.umbrous-swamp', (s) => {
    const e = enemyFromDef('horde.008', 'swamp-strong');
    e.wounds = Math.max(0, (catalog.byId.get('horde.008')!.printedFortitude ?? 3) - 1);
    s.battlefield = [e];
    moveFromDeck(s, 'p1', 'warrior.sword-strike');
  });
  const b1 = await http.fullState(r1);
  const strike1 = b1.players.p1.hand.find(c => c.definitionId === 'warrior.sword-strike')!;
  const rStrong = await send(r1, 'p1', { type: 'PLAY_CARD', cardInstanceId: strike1.instanceId, targetEnemyId: 'swamp-strong' });
  const evs1 = [...(rStrong.json.events ?? [])];
  await drainChoices(r1, evs1);
  assert.ok(evs1.some(e => e.type === 'ENEMY_DEFEATED'), 'el enemigo fuerte debe caer');
  // El escenario emite su propio COINS_GAINED; el botín viaja en
  // ENEMY_DEFEATED.reward (lo paga el reducer).
  const scenarioCoin = evs1
    .filter(e => e.type === 'COINS_GAINED' && e.playerId === 'p1')
    .reduce((n, e) => n + (e.amount ?? 0), 0);
  assert.equal(scenarioCoin, 1,
    `fort≥3 → exactamente +1 del escenario (got ${scenarioCoin})`);
  await del(r1);

  // Rama negativa: horde.001 (fortaleza 2 <3) → sin la moneda del escenario
  const { roomId: r2 } = await seededScenario('scenario.umbrous-swamp', (s) => {
    const e = enemyFromDef('horde.001', 'swamp-weak');
    e.wounds = Math.max(0, (catalog.byId.get('horde.001')!.printedFortitude ?? 2) - 1);
    s.battlefield = [e];
    moveFromDeck(s, 'p1', 'warrior.sword-strike');
  });
  const b2 = await http.fullState(r2);
  const strike2 = b2.players.p1.hand.find(c => c.definitionId === 'warrior.sword-strike')!;
  const rWeak = await send(r2, 'p1', { type: 'PLAY_CARD', cardInstanceId: strike2.instanceId, targetEnemyId: 'swamp-weak' });
  const evs2 = [...(rWeak.json.events ?? [])];
  await drainChoices(r2, evs2);
  const defeated2 = evs2.find(e => e.type === 'ENEMY_DEFEATED');
  assert.ok(defeated2, 'el enemigo débil debe caer');
  // Botín intacto en el evento de derrota, pero SIN la moneda del escenario
  const lootWeak = catalog.byId.get('horde.001')!.reward?.coins ?? 0;
  assert.equal(defeated2.reward?.coins, lootWeak,
    'el botín del enemigo se cobra igual');
  const gained = evs2
    .filter(e => e.type === 'COINS_GAINED' && e.playerId === 'p1')
    .reduce((n, e) => n + (e.amount ?? 0), 0);
  assert.equal(gained, 0,
    `fort<3 → sin +1 del escenario (got ${gained})`);
  await del(r2);
});

test('«Puerto de Eque»: descarta 1, roba 1 — y CADA enemigo +1 de Daño', async () => {
  const { roomId } = await seededScenario('scenario.eque-port');
  const events: any[] = [];
  await drainChoices(roomId, events); // acepta la oferta + elige carta a descartar
  // «A cambio, cada enemigo causa 1 más de Daño»: un modificador por enemigo
  const dmgMods = events.filter(e =>
    e.type === 'MODIFIER_ADDED' && e.layer === 'ENEMY_OUTGOING_DAMAGE' && e.amount === 1);
  assert.equal(dmgMods.length, 3, 'un +1 de daño por cada enemigo del campo');
  const discards = events.filter(e => e.type === 'CARD_MOVED' && e.from === 'HAND' && e.to === 'WEAR_PILE');
  assert.equal(discards.length, 1, 'exactamente 1 carta descartada');
  const draws = events.filter(e => e.type === 'CARDS_DRAWN' && e.playerId === 'p1');
  assert.equal(draws.reduce((n, e) => n + (e.count ?? 0), 0), 1, 'roba exactamente 1');
  await del(roomId);
});

test('«Yacimientos de Jade»: descarta TODA la mano, roba 4, gana 3 Monedas', async () => {
  const { roomId } = await seededScenario('scenario.jade-deposits');
  const before = await http.fullState(roomId);
  const handBefore = (before.players.p1 as any).hand.length;
  const coinsBefore = before.players.p1.coins;
  const events: any[] = [];
  await drainChoices(roomId, events);
  const st = await http.fullState(roomId);
  const handIds = new Set(before.players.p1.hand.map(c => c.instanceId));
  const discarded = events.filter(e =>
    e.type === 'CARD_MOVED' && e.from === 'HAND' && handIds.has(e.cardInstanceId));
  assert.equal(discarded.length, handBefore, '«descarta toda su mano» literal');
  const drawn = events.filter(e => e.type === 'CARDS_DRAWN' && e.playerId === 'p1');
  assert.equal(drawn.reduce((n, e) => n + (e.count ?? 0), 0), 4, 'roba 4 nuevas');
  assert.equal(st.players.p1.coins, coinsBefore + 3, 'consigue 3 Monedas');
  await del(roomId);
});

test('«Lodazal de Kalern»: el enemigo devuelto al fondo pierde sus Heridas', async () => {
  const { roomId } = await seededScenario('scenario.kalern-mud', (s) => {
    const wounded = enemyFromDef('horde.001', 'kalern-wounded');
    wounded.wounds = 1; // «si tuviera Heridas, se descartan»
    s.battlefield = [wounded, enemyFromDef('horde.002', 'kalern-extra')];
  });
  const deckBefore = (await http.fullState(roomId)).hordeDeck.length;
  const events: any[] = [];
  await drainChoices(roomId, events); // SELECT_ENEMY del jugador a la izquierda
  const st = await http.fullState(roomId);
  const returned = st.hordeDeck[st.hordeDeck.length - 1];
  assert.equal(returned?.instanceId, 'kalern-wounded',
    'el elegido va al FONDO del mazo de la Horda');
  assert.equal(st.hordeDeck.length, deckBefore + 1);
  // La carta devuelta es una CardInstance fresca: sin heridas residuales
  assert.ok(!(returned as any)?.wounds, 'las Heridas se descartan al volver al mazo');
  await del(roomId);
});

test('«Yermo de Cemenmar»: a lo sumo 3 Monedas en total y máx. 2 al mismo héroe', async () => {
  const { roomId } = await seededScenario('scenario.cemenmar-wastes', (s) => {
    s.phase = 'ATTACK_CHOICE';
    s.players.p2 = { ...s.players.p2, coins: 5 };
  });
  const discards = (await http.fullState(roomId)).players.p1.hand
    .slice(0, 2).map(c => c.instanceId);
  const r = await send(roomId, 'p1', { type: 'EVASION', discardedCardInstanceIds: discards });
  assert.equal(r.status, 200);
  const events = [...(r.json.events ?? [])];
  const st = await http.fullState(roomId);
  const stealChoice = (st.pendingChoices ?? []).find(
    (c: any) => c.type === 'SELECT_COINS_TO_STEAL');
  assert.ok(stealChoice, 'sin elección de robo tras evadir en Cemenmar');
  assert.ok(stealChoice.maxSelections <= 3,
    `«hasta 3 Monedas en total»: maxSelections=${stealChoice.maxSelections}`);
  // «máximo 2 al mismo jugador»: ningún héroe puede aportar más de 2 opciones
  const perHero: Record<string, number> = {};
  for (const opt of stealChoice.options) {
    const pid = String(opt).split('#')[0];
    perHero[pid] = (perHero[pid] ?? 0) + 1;
  }
  for (const [pid, n] of Object.entries(perHero)) {
    assert.ok(n <= 2, `${pid} ofrece ${n} monedas — «máximo 2 al mismo jugador»`);
  }
  await drainChoices(roomId, events);
  await del(roomId);
});

test('«Lágrimas de Aradiel»: paga 1 Gloria al dueño, su carta se juega y él roba 1', async () => {
  const { roomId } = await seededScenario('scenario.tears-of-aradiel', (s) => {
    s.players.p1 = { ...s.players.p1, glory: 3 };
  });
  const before = await http.fullState(roomId);
  const p2HandIds = new Set(before.players.p2.hand.map(c => c.instanceId));
  const events: any[] = [];
  await drainChoices(roomId, events); // CONFIRM oferta → SELECT_HERO (elige p2)
  assert.ok(events.some(e => e.type === 'GLORY_LOST' && e.playerId === 'p1' && e.amount === 1),
    '«deberá entregarle 1 ficha de Gloria» — p1 la paga');
  assert.ok(events.some(e => e.type === 'GLORY_GAINED' && e.playerId === 'p2' && e.amount === 1),
    'el propietario recibe esa Gloria');
  // «se descarta de la mano del propietario»: una carta de p2 sale de su mano
  const st = await http.fullState(roomId);
  const p2HandAfter = st.players.p2.hand.map(c => c.instanceId);
  const leftP2Hand = [...p2HandIds].filter(id => !p2HandAfter.includes(id));
  assert.ok(leftP2Hand.length >= 1, 'la carta prestada salió de la mano de p2');
  // «este roba una nueva»: p2 roba 1
  assert.ok(events.some(e => e.type === 'CARDS_DRAWN' && e.playerId === 'p2'),
    'el propietario roba una carta nueva');
  await del(roomId);
});

test('«Portal de Ulthar»: la vía Monedas cobra exactamente 2', async () => {
  const { roomId } = await seededScenario('scenario.ulthar-portal', (s) => {
    s.players.p1 = { ...s.players.p1, glory: 5, coins: 10, trophies: ['lit-trophy'] };
    s.eventLog = [{
      type: 'ENEMY_DEFEATED', enemyInstanceId: 'lit-trophy',
      enemyDefinitionId: 'horde.001', playerId: 'p1', seq: 1,
    } as any];
  });
  const events: any[] = [];
  // Drenar la oferta → elección de pago: elegir 'coins' explícitamente
  for (let i = 0; i < 30; i++) {
    const st = await http.fullState(roomId);
    const pc = (st.pendingChoices ?? [])[0] as any;
    if (!pc) break;
    if (String(pc.choiceId).startsWith('turn-start-')) {
      const r = await send(roomId, pc.playerId, { type: 'ACCEPT_TURN_START_EFFECT', accepted: true });
      events.push(...(r.json.events ?? []));
      continue;
    }
    const selectedIds = (pc.type === 'CONFIRM' && (pc.options ?? []).includes('coins'))
      ? ['coins']
      : (pc.options ?? []).slice(0, Math.max(1, pc.minSelections ?? 1));
    const r = await send(roomId, pc.playerId, { type: 'RESOLVE_CHOICE', choiceId: pc.choiceId, selectedIds });
    events.push(...(r.json.events ?? []));
  }
  assert.ok(events.some(e => e.type === 'COINS_LOST' && e.playerId === 'p1' && e.amount === 2),
    '«2 Monedas» — la vía monedas cobra exactamente 2');
  assert.ok(!events.some(e => e.type === 'GLORY_LOST' && e.playerId === 'p1'),
    'pagando con monedas no se cobra Gloria');
  assert.ok(events.some(e => e.type === 'ENEMY_RETURNED_TO_HORDE'),
    'la Hueste vuelve al fondo del mazo');
  assert.ok(events.some(e => e.type === 'ENEMY_REVEALED'),
    'el trofeo entra en juego');
  await del(roomId);
});

// ---------------------------------------------------------------------------
// Pericias — cláusulas de cantidad del texto impreso
// ---------------------------------------------------------------------------

test('«Taheral»: 2 Monedas por CADA carta descartada en la Evasión', async () => {
  const { roomId } = await seededHero('hero.taheral', 1, '-coins', (s) => {
    s.phase = 'ATTACK_CHOICE';
  });
  const before = await http.fullState(roomId);
  const discards = before.players.p1.hand.slice(0, 2).map(c => c.instanceId);
  const coinsBefore = before.players.p1.coins;
  const r = await send(roomId, 'p1', { type: 'EVASION', discardedCardInstanceIds: discards });
  const events = [...(r.json.events ?? [])];
  await drainChoices(roomId, events); // acepta el CONFIRM opt-in
  const st = await http.fullState(roomId);
  const gained = events
    .filter(e => e.type === 'COINS_GAINED' && e.playerId === 'p1')
    .reduce((n, e) => n + (e.amount ?? 0), 0);
  assert.equal(gained, 4, '«dos Monedas por cada carta» — 2 descartes → 4');
  assert.equal(st.players.p1.coins, coinsBefore + 4);
  await del(roomId);
});

test('«Lisavette»: tras usar el Escudo roba hasta 2 Monedas del héroe protegido', async () => {
  const { roomId } = await seededHero('hero.lisavette', 2, '-steal', (s) => {
    // Lisavette es p2 (la pericia actúa sobre «otro héroe» = p1 enfrentado)
    s.players.p1 = { ...s.players.p1, heroId: 'hero.aranel' as any, heroUsesRemaining: 0, coins: 5 };
    s.players.p2 = { ...s.players.p2, heroId: 'hero.lisavette' as any, heroUsesRemaining: 2 };
    moveFromDeck(s, 'p2', 'warrior.shield');
    s.phase = 'HORDE_ATTACK';
    s.pendingChoices = [{
      choiceId: 'reaction-p2-lis', playerId: 'p2', type: 'REACTION_WINDOW',
      prompt: 'Reacción', options: ['USE_ABILITY', 'PASS'],
      minSelections: 1, maxSelections: 1,
    } as any];
  });
  const p1CoinsBefore = (await http.fullState(roomId)).players.p1.coins;
  const events: any[] = [];
  await drainChoices(roomId, events);
  const stolen = events.find(e =>
    e.type === 'COINS_STOLEN' && e.toPlayerId === 'p2');
  assert.ok(stolen, '«Roba hasta 2 Monedas de ese Héroe» — sin COINS_STOLEN');
  assert.equal(stolen.amount, 2, 'p1 tiene 5 ≥ 2 → roba el máximo 2');
  const st = await http.fullState(roomId);
  assert.equal(st.players.p1.coins, p1CoinsBefore - 2);
  await del(roomId);
});
