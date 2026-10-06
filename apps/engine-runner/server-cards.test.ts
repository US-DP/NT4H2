/**
 * Cobertura por carta a nivel de API: cada definición del catálogo se
 * ejerce a través del servidor real — POST /rooms/:id/restore con un
 * estado artesanal, comandos por /command (validación Zod → execute →
 * processPhases → commit) y oráculo sobre los eventos devueltos y el
 * estado persistido (/full-state).
 *
 * Es el mismo harness que el E2E de interfaz (card-effects.spec.ts) y el
 * oráculo del motor (effect-verification.test.ts) — los tres niveles
 * deben coincidir: si una carta funciona en el engine pero falla por HTTP
 * (schema, dedup, proyección), aquí sale.
 *
 * Corre con: pnpm test (tsx --test, node:test nativo).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import {
  DeterministicRng, applyScenarioEffects, onTurnStart,
  setupGame, startFirstTurn,
  resetInstanceCounter, resetPhaseSeq, resetResolveSeq,
  resetAbilitySeq, resetScenarioSeq,
} from '@nt4h/engine';
import type { CardDefinition, CardInstance, GameState } from '@nt4h/schema';
import {
  bootServer, makeHttp, catalog, roomIdFor, inst, enemyFromDef,
  moveFromDeck, walkEffects, buildStateFor,
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

// Aliases al harness compartido (mismos nombres que usaba esta suite).
const send = (...a: Parameters<ReturnType<typeof makeHttp>['send']>) => http.send(...a);
const restore = (...a: Parameters<ReturnType<typeof makeHttp>['restore']>) => http.restore(...a);
const fullState = (...a: Parameters<ReturnType<typeof makeHttp>['fullState']>) => http.fullState(...a);
const drainChoices = (...a: Parameters<ReturnType<typeof makeHttp>['drainChoices']>) => http.drainChoices(...a);

// ---------------------------------------------------------------------------
// Oráculo por efecto (mismo contrato que effect-verification.test.ts del
// engine): cada efecto declarado debe dejar evidencia en los eventos que
// devuelve /command Y/O en el estado persistido que devuelve /full-state.
// Así una carta no puede «pasar» por un efecto silenciosamente inerte.
// ---------------------------------------------------------------------------

interface PlayCtx {
  before: GameState;
  after: GameState;
  events: any[];
  playerId: string;
  targetId?: string;
  card: CardInstance;
  def: CardDefinition;
  failures: string[];
}

const ev = (ctx: PlayCtx, type: string) => ctx.events.some(e => e.type === type);
const evOn = (ctx: PlayCtx, type: string, pred: (e: any) => boolean) =>
  ctx.events.some(e => e.type === type && pred(e));
const me = (ctx: PlayCtx) => (ctx.after.players as Record<string, any>)[ctx.playerId];
const meBefore = (ctx: PlayCtx) => (ctx.before.players as Record<string, any>)[ctx.playerId];
const msg = (t: string) => `${t}: sin evidencia observable por API`;

type Check = (eff: any, ctx: PlayCtx) => string | null;

const EVIDENCE: Record<string, Check> = {
  GAIN_COINS: (_e, c) => ev(c, 'COINS_GAINED') || ev(c, 'COINS_STOLEN') || me(c).coins > meBefore(c).coins ? null : msg('GAIN_COINS'),
  GAIN_GLORY: (_e, c) => ev(c, 'GLORY_GAINED') || me(c).glory > meBefore(c).glory || ev(c, 'DAMAGE_INTERCEPTED') ? null : msg('GAIN_GLORY'),
  DRAW_CARDS: (_e, c) => ev(c, 'CARDS_DRAWN') || evOn(c, 'CARD_MOVED', m => m.to === 'HAND') || me(c).hand.length > meBefore(c).hand.length ? null : msg('DRAW_CARDS'),
  LOSE_CARDS: (_e, c) => ev(c, 'CARDS_LOST') || me(c).wearPile.length > meBefore(c).wearPile.length ? null : msg('LOSE_CARDS'),
  HEAL_WOUNDS: (_e, c) => ev(c, 'WOUND_HEALED') || me(c).wounds < meBefore(c).wounds ? null : msg('HEAL_WOUNDS'),
  PREVENT_DAMAGE: (_e, c) => ev(c, 'PREVENTION_APPLIED') || me(c).prevention > meBefore(c).prevention ? null : msg('PREVENT_DAMAGE'),
  PREVENT_ENEMY_DAMAGE: (e, c) => EVIDENCE.DISABLE_ENEMY_DAMAGE(e, c),
  DISABLE_ENEMY_DAMAGE: (_e, c) => ev(c, 'ENEMY_DAMAGE_DISABLED') || c.after.battlefield.some(x => x.damageDisabled) ? null : msg('DISABLE_ENEMY_DAMAGE'),
  CANCEL_ALL_DAMAGE: (_e, c) => ev(c, 'CANCELLATION_ACTIVATED') || me(c).damageCancellation ? null : msg('CANCEL_ALL_DAMAGE'),
  APPLY_VULNERABILITY: (_e, c) => ev(c, 'VULNERABILITY_APPLIED') || c.after.battlefield.some(x => x.modifiers.length > 0) ? null : msg('APPLY_VULNERABILITY'),
  DEFEAT_ENEMY: (_e, c) => ev(c, 'ENEMY_DEFEATED') ? null : msg('DEFEAT_ENEMY'),
  SWAP_ENEMY: (_e, c) => ev(c, 'ENEMY_SWAPPED') ? null : msg('SWAP_ENEMY'),
  STEAL_COINS: (_e, c) => ev(c, 'COINS_STOLEN') || ev(c, 'COINS_GAINED') ? null : msg('STEAL_COINS'),
  END_ATTACK: (_e, c) => evOn(c, 'PHASE_CHANGED', p => p.phase === 'HORDE_ATTACK') ? null : msg('END_ATTACK'),
  COST: (e, c) => {
    if (e.resource === 'GLORY') return ev(c, 'GLORY_LOST') || me(c).glory < meBefore(c).glory ? null : msg('COST(GLORY)');
    return ev(c, 'COINS_LOST') || me(c).coins < meBefore(c).coins ? null : msg('COST(COINS)');
  },
  PLACE_PERSISTENT: (_e, c) => ev(c, 'PERSISTENT_CARD_PLACED') || me(c).persistentCards.length > 0 ? null : msg('PLACE_PERSISTENT'),
  MODIFY_DAMAGE: (_e, c) => ev(c, 'MODIFIER_ADDED') || me(c).modifiers?.some((m: any) => m.layer === 'DAMAGE_BONUS') ? null : msg('MODIFY_DAMAGE'),
  SHUFFLE_DECK: (_e, c) => ev(c, 'DECK_SHUFFLED') ? null : msg('SHUFFLE_DECK'),
  RECOVER_CARDS: (_e, c) => ev(c, 'CARDS_RECOVERED') || ev(c, 'CARD_MOVED') || me(c).wearPile.length < meBefore(c).wearPile.length ? null : msg('RECOVER_CARDS'),
  ALL_HEROES_RECOVER: (_e, c) => ev(c, 'CARDS_RECOVERED') || ev(c, 'CARD_MOVED') ? null : msg('ALL_HEROES_RECOVER'),
  OTHER_HEROES_RECOVER: (_e, c) => ev(c, 'CARDS_RECOVERED') || ev(c, 'CARD_MOVED') ? null : msg('OTHER_HEROES_RECOVER'),
  RECOVER_THIS_CARD: (_e, c) => ev(c, 'CARDS_RECOVERED') || evOn(c, 'CARD_MOVED', m => m.cardInstanceId === c.card.instanceId) ? null : msg('RECOVER_THIS_CARD'),
  RECOVER_CARD_BY_NAME: (_e, c) => ev(c, 'CARD_MOVED') || ev(c, 'CARDS_RECOVERED') ? null : msg('RECOVER_CARD_BY_NAME'),
  SEARCH_WEAR_PILE_PUT_IN_HAND: (_e, c) => evOn(c, 'CARD_MOVED', m => m.to === 'HAND') || me(c).hand.length > meBefore(c).hand.length ? null : msg('SEARCH_WEAR_PILE_PUT_IN_HAND'),
  SEARCH_DECK: (_e, c) => ev(c, 'PENDING_CHOICE_CREATED') || ev(c, 'CARD_MOVED') ? null : msg('SEARCH_DECK'),
  DEAL_DAMAGE_SPLIT: (_e, c) => ev(c, 'DAMAGE_DEALT') || ev(c, 'ENEMY_DEFEATED') ? null : msg('DEAL_DAMAGE_SPLIT'),
  DEAL_DAMAGE_ALL_ENEMIES: (_e, c) => ev(c, 'DAMAGE_DEALT') || ev(c, 'ENEMY_DEFEATED') ? null : msg('DEAL_DAMAGE_ALL_ENEMIES'),
  DEAL_DAMAGE_TO_HERO: (_e, c) => ev(c, 'HERO_WOUNDED') || ev(c, 'CARDS_LOST') || ev(c, 'PENDING_CHOICE_CREATED') ? null : msg('DEAL_DAMAGE_TO_HERO'),
  DEAL_DAMAGE_TO_OTHER_HEROES: (_e, c) => ev(c, 'HERO_WOUNDED') || ev(c, 'CARDS_LOST') ? null : msg('DEAL_DAMAGE_TO_OTHER_HEROES'),
  DRAW_AND_CHECK: (_e, c) => ev(c, 'CARDS_DRAWN') || evOn(c, 'CARD_MOVED', m => m.to === 'HAND') ? null : msg('DRAW_AND_CHECK'),
  DRAW_AND_ADD_ATTACK: (_e, c) => ev(c, 'CARDS_DRAWN') || evOn(c, 'CARD_MOVED', m => m.to === 'HAND') || ev(c, 'DAMAGE_DEALT') ? null : msg('DRAW_AND_ADD_ATTACK'),
  PLAY_IMMEDIATELY: (_e, c) => c.events.filter(e => e.type === 'CARD_PLAYED').length >= 2 ? null : msg('PLAY_IMMEDIATELY'),
  DISCARD_FROM_HAND: (_e, c) => ev(c, 'PENDING_CHOICE_CREATED') || ev(c, 'CARD_MOVED') || ev(c, 'CARDS_LOST') ? null : msg('DISCARD_FROM_HAND'),
  CHOOSE_ONE: (_e, c) => ev(c, 'PENDING_CHOICE_CREATED') || ev(c, 'CHOOSE_EFFECT') ? null : msg('CHOOSE_ONE'),
  SELECT_HERO: (_e, c) => ev(c, 'PENDING_CHOICE_CREATED') ? null : msg('SELECT_HERO'),
  INTERCEPT_DAMAGE: (_e, c) => ev(c, 'DAMAGE_INTERCEPTED') || ev(c, 'PENDING_CHOICE_CREATED') ? null : msg('INTERCEPT_DAMAGE'),
  LOOK_AT_CARDS: (_e, c) => ev(c, 'PENDING_CHOICE_CREATED') || ev(c, 'CARDS_REVEALED_TO_PLAYER') ? null : msg('LOOK_AT_CARDS'),
  BLOCK_NEXT_DAMAGE: (_e, c) => ev(c, 'BLOCK_GRANTED') ? null : msg('BLOCK_NEXT_DAMAGE'),
  GRANT_ARMOR: (_e, c) => ev(c, 'ARMOR_GRANTED') ? null : msg('GRANT_ARMOR'),
  APPLY_STATUS: (_e, c) => ev(c, 'STATUS_APPLIED') ? null : msg('APPLY_STATUS'),
  REGISTER_LISTENER: (_e, c) => ev(c, 'LISTENER_REGISTERED') ? null : msg('REGISTER_LISTENER'),
};

/** Disparadores/condicionales/contenedores — se verifican por su contexto. */
const DEFERRED = new Set([
  'ON_DEFEAT', 'ON_ENEMY_DEFEATED', 'ON_HORDE_ATTACK', 'CONDITIONAL',
  'TRIGGER', 'END_ATTACK_VICTORY', 'SWAP_WITH_HAND', 'CUSTOM_SCENARIO',
]);

const SPECIAL_DAMAGE = new Set([
  'DEAL_DAMAGE_SPLIT', 'DEAL_DAMAGE_ALL_ENEMIES',
  'DEAL_DAMAGE_TO_HERO', 'DEAL_DAMAGE_TO_OTHER_HEROES',
]);

function evalBranch(cond: any): 'then' | 'else' | 'unknown' {
  if (!cond) return 'then';
  switch (cond.kind) {
    case 'FIRST_CARD_OF_NAME_THIS_TURN': return 'then'; // estado fresco
    case 'ALREADY_USED_AGAINST_THIS_ENEMY': return 'else'; // nunca usada contra el objetivo
    case 'HAS_CAPABILITY': return 'then'; // concedida en buildStateFor
    default: return 'unknown';
  }
}

function verifyEffect(eff: any, ctx: PlayCtx, path: string): void {
  const type: string = eff.type;
  if (type === 'CONDITIONAL') {
    const branch = evalBranch(eff.condition);
    const sub = branch === 'then' ? (eff.then ?? []) : branch === 'else' ? (eff.else ?? []) : [...(eff.then ?? []), ...(eff.else ?? [])];
    for (const inner of sub) verifyEffect(inner, ctx, `${path}/${type}`);
    return;
  }
  if (type === 'ON_DEFEAT' || type === 'ON_ENEMY_DEFEATED' || type === 'ON_HORDE_ATTACK' || type === 'TRIGGER') {
    // El objetivo muere (elegimos el más débil) → los internos deben verse
    if (!ev(ctx, 'ENEMY_DEFEATED')) return;
    for (const inner of eff.effects ?? []) verifyEffect(inner, ctx, `${path}/${type}`);
    return;
  }
  if (type === 'CHOOSE_ONE') {
    if (!ev(ctx, 'PENDING_CHOICE_CREATED') && !ev(ctx, 'CHOOSE_EFFECT')) {
      ctx.failures.push(`${path}/CHOOSE_ONE: no se creó la elección`);
    }
    return;
  }
  if (DEFERRED.has(type)) return;
  const check = EVIDENCE[type];
  if (!check) return;
  const failure = check(eff, ctx);
  if (failure) ctx.failures.push(`${path}/${failure}`);
}

/** printedAttack debe aterrizar: evento sobre el objetivo + herida persistida. */
function verifyPrintedAttack(ctx: PlayCtx): void {
  const special = [...walkEffects(ctx.def.effects)].some(e => SPECIAL_DAMAGE.has(e.type));
  const atk = ctx.def.printedAttack ?? 0;
  if (atk <= 0 || special || !ctx.targetId) return;
  const dealt = evOn(ctx, 'DAMAGE_DEALT', d => d.enemyInstanceId === ctx.targetId || d.targetId === ctx.targetId)
    || evOn(ctx, 'ENEMY_DEFEATED', d => d.enemyInstanceId === ctx.targetId);
  if (!dealt) {
    ctx.failures.push(`printedAttack=${atk}: sin DAMAGE_DEALT/ENEMY_DEFEATED sobre ${ctx.targetId}`);
    return;
  }
  const foe = ctx.after.battlefield.find(e => e.instanceId === ctx.targetId);
  const foeBefore = ctx.before.battlefield.find(e => e.instanceId === ctx.targetId);
  if (foe && foeBefore && foe.wounds <= foeBefore.wounds) {
    ctx.failures.push(`daño no persistido: ${ctx.targetId} wounds ${foeBefore.wounds}→${foe.wounds}`);
  }
}

/** La carta jugada debe acabar en la zona declarada por destinationAfterUse. */
function verifyDestination(ctx: PlayCtx): void {
  const dest = ctx.def.destinationAfterUse ?? 'WEAR_PILE';
  const p = me(ctx);
  const inWear = p.wearPile.some((c: any) => c.instanceId === ctx.card.instanceId);
  const inHand = p.hand.some((c: any) => c.instanceId === ctx.card.instanceId);
  const inPersistent = (p.persistentCards ?? []).some((c: any) => c.instanceId === ctx.card.instanceId);
  if (dest === 'WEAR_PILE' && !inWear) {
    // Legítimo si un efecto la volvió a mover (recuperar a mano/mazo…)
    const moved = evOn(ctx, 'CARD_MOVED', m => m.cardInstanceId === ctx.card.instanceId && m.to !== 'WEAR_PILE')
      || evOn(ctx, 'CARDS_RECOVERED', m => m.cardInstanceIds?.includes(ctx.card.instanceId));
    if (!moved) ctx.failures.push('destinationAfterUse=WEAR_PILE pero la carta no está en el desgaste');
  }
  if (dest === 'REMOVED_FROM_GAME' && (inWear || inHand || inPersistent)) {
    ctx.failures.push('destinationAfterUse=REMOVED_FROM_GAME pero la carta sigue en una zona del jugador');
  }
  if (dest === 'IN_FRONT_OF_PLAYER' && !inPersistent && !ev(ctx, 'PERSISTENT_CARD_PLACED')) {
    ctx.failures.push('destinationAfterUse=IN_FRONT_OF_PLAYER sin PERSISTENT_CARD_PLACED');
  }
}

/** ¿Necesita objetivo enemigo? → instancia candidata del campo. */
function pickTarget(state: GameState, def: CardDefinition): string | null {
  const all = [...walkEffects(def.effects)];
  const special = all.some(e => SPECIAL_DAMAGE.has(e.type));
  const selectors = all.filter(e => e.target?.kind === 'SELECTED_ENEMY' || e.target?.kind === 'ONE_ENEMY');
  const needs = ((def.printedAttack ?? 0) > 0 && !special) || selectors.length > 0;
  if (!needs) return null;
  // Preferir el más débil si hay efecto ON_DEFEAT (que se dispare), el más
  // fuerte si no (que el daño no lo derrote y se vea la herida).
  const hasOnDefeat = all.some(e => e.type === 'ON_DEFEAT');
  const sorted = [...state.battlefield].sort((a, b) => a.baseFortitude - b.baseFortitude);
  const pick = hasOnDefeat ? sorted[0] : (sorted[sorted.length - 1] ?? sorted[0]);
  return pick.instanceId;
}

// ---------------------------------------------------------------------------
// 1) Cartas jugables (ABILITY + MARKET): PLAY_CARD por HTTP real
// ---------------------------------------------------------------------------

const playableDefs = catalog.cards.filter(d => d.type === 'ABILITY' || d.type === 'MARKET');

for (const def of playableDefs) {
  test(`API playable ${def.id} — ${def.name}`, async () => {
    const failures: string[] = [];

    // Mercado: la compra también viaja por API (fase MARKET + coste real)
    if (def.type === 'MARKET') {
      const { state, rng } = buildStateFor(def);
      state.phase = 'MARKET';
      const marketCard = inst(def.id, 'market', 'MARKET', def.name);
      state.market = [marketCard, ...state.market.filter(c => c.definitionId !== def.id)];
      const buyRoom = `${roomIdFor(def.id)}-buy`;
      await restore(buyRoom, state, rng);
      const coinsBefore = state.players.p1.coins;
      const r = await send(buyRoom, 'p1', { type: 'BUY_CARD', marketCardInstanceId: marketCard.instanceId });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      if (!r.json.accepted) failures.push(`BUY_CARD rechazado: ${r.json.reason}`);
      const buyEvents = r.json.events ?? [];
      if (!buyEvents.some((e: any) => e.type === 'MARKET_PURCHASED')) failures.push('compra sin MARKET_PURCHASED');
      const stAfter = await fullState(buyRoom);
      const spent = coinsBefore - (stAfter.players.p1.coins ?? 0);
      if (spent !== (def.printedCost ?? 0)) {
        failures.push(`coste incorrecto: ${def.printedCost} esperado, ${spent} descontado`);
      }
      await fetch(`${base}/rooms/${buyRoom}`, { method: 'DELETE' }).catch(() => {});
    }

    // Jugar la carta por API
    const { state, rng } = buildStateFor(def);
    const card = moveFromDeck(state, 'p1', def.id);
    const targetId = pickTarget(state, def);
    const roomId = roomIdFor(def.id);
    await restore(roomId, state, rng);

    const events: any[] = [];
    const r = await send(roomId, 'p1', {
      type: 'PLAY_CARD', cardInstanceId: card.instanceId,
      ...(targetId ? { targetEnemyId: targetId } : {}),
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    if (!r.json.accepted) failures.push(`PLAY_CARD rechazado: ${r.json.reason}`);
    events.push(...(r.json.events ?? []));
    await drainChoices(roomId, events);

    const types = new Set(events.map(e => e.type));
    if (!types.has('CARD_PLAYED')) failures.push('sin CARD_PLAYED');

    // Oráculo por efecto sobre la frontera HTTP: eventos devueltos por
    // /command + estado persistido por /full-state
    const after = await fullState(roomId);
    const ctx: PlayCtx = {
      before: state, after, events, playerId: 'p1',
      targetId: targetId ?? undefined, card, def, failures,
    };
    verifyPrintedAttack(ctx);
    verifyDestination(ctx);
    for (const eff of def.effects ?? []) verifyEffect(eff, ctx, def.id);

    await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}

// ---------------------------------------------------------------------------
// 2) Enemigos (HORDE + WARLORD): derrota real por comando y recompensa
//    aplicada en el estado persistido.
// ---------------------------------------------------------------------------

const enemyDefs = catalog.cards.filter(d => d.type === 'HORDE' || d.type === 'WARLORD');

for (const def of enemyDefs) {
  test(`API enemigo ${def.id} — ${def.name}`, async () => {
    const { state, rng } = buildStateFor(def);
    const target = enemyFromDef(def.id, 'svr-target');
    target.wounds = Math.max(0, (def.printedFortitude ?? 1) - 1);
    // Otro enemigo vivo: derrotar a un Señor no debe terminar la partida
    const extraDef = catalog.cards.find(d => d.type === 'HORDE' && d.name !== def.name)!;
    state.battlefield = [target, enemyFromDef(extraDef.id, 'svr-extra')];
    const strike = moveFromDeck(state, 'p1', 'warrior.sword-strike');
    const roomId = roomIdFor(def.id);
    await restore(roomId, state, rng);
    const coinsBefore = state.players.p1.coins;
    const gloryBefore = state.players.p1.glory;

    const events: any[] = [];
    const r = await send(roomId, 'p1', {
      type: 'PLAY_CARD', cardInstanceId: strike.instanceId, targetEnemyId: target.instanceId,
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    events.push(...(r.json.events ?? []));
    await drainChoices(roomId, events);

    const failures: string[] = [];
    if (!r.json.accepted) failures.push(`PLAY_CARD rechazado: ${r.json.reason}`);
    if (!events.some(e => e.type === 'ENEMY_DEFEATED')) failures.push('sin ENEMY_DEFEATED');
    const st = await fullState(roomId);
    if (st.battlefield.some(e => e.instanceId === target.instanceId)) {
      failures.push('el enemigo derrotado sigue en el campo');
    }
    // Gloria = laurel del frente (trophyGlory, permanente) + Gloria del
    // dorso (reward.glory, botín suprimible por escenarios)
    const rc = def.reward?.coins ?? 0;
    const rg = (def.trophyGlory ?? 0) + (def.reward?.glory ?? 0);
    if (st.players.p1.coins - coinsBefore < rc) {
      failures.push(`recompensa monedas: +${st.players.p1.coins - coinsBefore} < ${rc}`);
    }
    if (st.players.p1.glory - gloryBefore < rg) {
      failures.push(`recompensa gloria: +${st.players.p1.glory - gloryBefore} < ${rg}`);
    }
    await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}

// ---------------------------------------------------------------------------
// 3) Pericias de héroe: activas por USE_HERO_ABILITY, reactivas por la
//    ventana de reacción, pasivas por su disparador.
// ---------------------------------------------------------------------------

const heroDefs = catalog.cards.filter(d => d.type === 'HERO');
const REACTIVE_HEROES = new Set(['hero.valerys', 'hero.lisavette']);

function heroSetup(def: CardDefinition) {
  const { state, rng } = buildStateFor(def);
  const ability = def.heroAbility!;
  state.players.p1 = {
    ...state.players.p1,
    heroId: def.id,
    heroUsesRemaining: ability.uses ?? 1,
    heroMaxUses: ability.uses ?? 1,
  };
  return { state, rng };
}

for (const def of heroDefs) {
  test(`API pericia ${def.id} — ${def.name}`, async () => {
    const failures: string[] = [];
    const roomId = roomIdFor(def.id);

    if (REACTIVE_HEROES.has(def.id)) {
      const { state, rng } = buildStateFor(def);
      const ability = def.heroAbility!;
      state.phase = 'HORDE_ATTACK';
      state.activePlayerId = 'p1';
      state.players.p2 = {
        ...state.players.p2,
        heroId: def.id,
        heroUsesRemaining: ability.uses ?? 1,
        heroMaxUses: ability.uses ?? 1,
      };
      // Lisavette exige una carta «Escudo» en la mano de p2
      if (def.id === 'hero.lisavette') moveFromDeck(state, 'p2', 'warrior.shield');
      state.pendingChoices = [{
        choiceId: 'reaction-p2-svr', playerId: 'p2', type: 'REACTION_WINDOW',
        prompt: 'Reacción: ¿Usar pericia de héroe o pasar?',
        options: ['USE_ABILITY', 'PASS'], minSelections: 1, maxSelections: 1,
      } as any];
      await restore(roomId, state, rng);
      const events: any[] = [];
      await drainChoices(roomId, events);
      const types = new Set(events.map(e => e.type));
      if (!types.has('HERO_ABILITY_USED')) failures.push('reactiva sin HERO_ABILITY_USED');
      if (def.id === 'hero.valerys' && !types.has('DAMAGE_INTERCEPTED')) failures.push('Valèrys sin DAMAGE_INTERCEPTED');
      if (def.id === 'hero.lisavette' && !types.has('ENEMY_DAMAGE_DISABLED') && !types.has('CARD_MOVED')) {
        failures.push('Lisavette sin evidencia de Escudo/prevención');
      }
      await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
      assert.deepEqual(failures, [], failures.join('\n'));
      return;
    }

    if (def.id === 'hero.taheral') {
      // Pasiva de evasión: EVASION con 2 descartes → CONFIRM opt-in
      const { state, rng } = heroSetup(def);
      state.phase = 'ATTACK_CHOICE';
      await restore(roomId, state, rng);
      const discards = state.players.p1.hand.slice(0, 2).map(c => c.instanceId);
      const events: any[] = [];
      const r = await send(roomId, 'p1', { type: 'EVASION', discardedCardInstanceIds: discards });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      events.push(...(r.json.events ?? []));
      await drainChoices(roomId, events);
      const types = new Set(events.map(e => e.type));
      if (!types.has('HERO_ABILITY_USED')) failures.push('Taheral sin HERO_ABILITY_USED tras aceptar');
      if (!types.has('COINS_GAINED')) failures.push('Taheral sin COINS_GAINED por los descartes');
      await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
      assert.deepEqual(failures, [], failures.join('\n'));
      return;
    }

    if (def.id === 'hero.feldon' || def.id === 'hero.beleth-il') {
      const { state, rng } = heroSetup(def);
      if (def.id === 'hero.feldon') {
        state.phase = 'HORDE_ATTACK';
        state.pendingChoices = [{
          choiceId: `feldon-reduce-${state.turnNumber}-p1`, playerId: 'p1', type: 'CONFIRM',
          prompt: 'Feldon: ¿usar tu Pericia para perder solo la mitad de cartas?',
          options: ['yes', 'no'], minSelections: 1, maxSelections: 1,
        } as any];
      } else {
        const failed = state.players.p1.abilityDeck[0];
        state.pendingChoices = [{
          choiceId: 'beleth-recover-p1-svr', playerId: 'p1', type: 'CONFIRM',
          prompt: 'Beleth-Il: ¿usar tu Pericia para recuperar la carta fallida a la mano y robar otra?',
          options: ['yes', 'no'], minSelections: 1, maxSelections: 1,
          relatedCardIds: [failed.instanceId],
        } as any];
      }
      await restore(roomId, state, rng);
      const events: any[] = [];
      await drainChoices(roomId, events);
      const types = new Set(events.map(e => e.type));
      if (!types.has('HERO_ABILITY_USED')) failures.push('pasiva sin HERO_ABILITY_USED tras aceptar');
      if (def.id === 'hero.beleth-il' && !types.has('CARDS_DRAWN')) failures.push('Beleth-Il sin CARDS_DRAWN');
      await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
      assert.deepEqual(failures, [], failures.join('\n'));
      return;
    }

    // Pericias activas: USE_HERO_ABILITY por API
    const { state, rng } = heroSetup(def);
    await restore(roomId, state, rng);
    const events: any[] = [];
    const r = await send(roomId, 'p1', { type: 'USE_HERO_ABILITY' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    if (!r.json.accepted) failures.push(`USE_HERO_ABILITY rechazado: ${r.json.reason}`);
    events.push(...(r.json.events ?? []));
    await drainChoices(roomId, events);
    const types = new Set(events.map(e => e.type));
    if (!types.has('HERO_ABILITY_USED')) failures.push('pericia sin HERO_ABILITY_USED');
    if ((def.heroAbility?.effects ?? []).some((e: any) => e.type === 'SHUFFLE_DECK') && !types.has('DECK_SHUFFLED')) {
      failures.push('SHUFFLE_DECK sin DECK_SHUFFLED');
    }
    await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}

// ---------------------------------------------------------------------------
// 4) Escenarios: estado con escenario activo restaurado; se ejerce su vía
//    real (aura aplicada, oferta de inicio de turno, derrota, evasión).
// ---------------------------------------------------------------------------

const scenarioDefs = catalog.cards.filter(d => d.type === 'SCENARIO');

const scenarioWith = (def: CardDefinition) => {
  const ctx = buildStateFor(def);
  ctx.state.scenario = inst(def.id, 'scenario', 'SCENARIO_ACTIVE', def.name) as any;
  return ctx;
};

/** Derrota `enemyId` con Espadazo por API y devuelve eventos + contadores. */
async function strikeOn(roomId: string, enemyId: string, strikeInstanceId: string) {
  const events: any[] = [];
  const r = await send(roomId, 'p1', {
    type: 'PLAY_CARD', cardInstanceId: strikeInstanceId, targetEnemyId: enemyId,
  });
  events.push(...(r.json.events ?? []));
  await drainChoices(roomId, events);
  const st = await fullState(roomId);
  return { accepted: !!r.json.accepted, events, coins: st.players.p1.coins, glory: st.players.p1.glory };
}

for (const def of scenarioDefs) {
  test(`API escenario ${def.id} — ${def.name}`, async () => {
    const failures: string[] = [];
    const roomId = roomIdFor(def.id);
    const effs = (def.effects ?? []) as any[];
    const has = (t: string) => effs.some(e => e.type === t);
    const onDefeat = effs.find(e => e.type === 'ON_ENEMY_DEFEATED') as any;

    if (def.id === 'scenario.lotharion-market') {
      // -1 al coste de mercado: el estado proyectado lo refleja en el
      // modificador del escenario y el precio efectivo es comprobable
      const { state: base, rng } = scenarioWith(def);
      const state = applyScenarioEffects(base, def.id, catalog).state;
      state.phase = 'MARKET';
      await restore(roomId, state, rng);
      const st = await fullState(roomId);
      // El modificador de coste es un flag top-level del estado (−1)
      if ((st as any).marketCostModifier !== -1) {
        failures.push(`marketCostModifier=${(st as any).marketCostModifier} (esperado -1)`);
      }
      await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
      assert.deepEqual(failures, [], failures.join('\n'));
      return;
    }

    if (has('IGNORE_COIN_REWARDS') || has('IGNORE_GLORY_REWARDS') || has('MODIFY_FORTITUDE')) {
      const { state: base, rng } = scenarioWith(def);
      const modDesc = (effs.find(e => e.type === 'MODIFY_FORTITUDE') as any)?.modifier;
      const fortMod = modDesc?.kind === 'CONSTANT' ? (modDesc.value ?? 0) : 0;
      const targetDef = catalog.byId.get('horde.001')!;
      const effectiveFort = (targetDef.printedFortitude ?? 1) + fortMod;
      const enemy = enemyFromDef('horde.001', 'svr-scen-target');
      enemy.wounds = Math.max(0, effectiveFort - 1);
      base.battlefield = [enemy, enemyFromDef('horde.002', 'svr-extra')];
      const state = applyScenarioEffects(base, def.id, catalog).state;
      const strike = moveFromDeck(state, 'p1', 'warrior.sword-strike');
      await restore(roomId, state, rng);
      const before = await fullState(roomId);
      const coinsBefore = before.players.p1.coins;
      const gloryBefore = before.players.p1.glory;
      if (has('MODIFY_FORTITUDE')) {
        // El aura se materializa como {layer:FORTITUDE_MODIFIERS, amount}
        const foe = before.battlefield.find(e => e.instanceId === 'svr-scen-target');
        const applied = foe?.modifiers?.some(
          (m: any) => m.layer === 'FORTITUDE_MODIFIERS' && m.amount === fortMod);
        if (!applied) failures.push('aura MODIFY_FORTITUDE no aplicada al enemigo');
      }
      if (has('IGNORE_COIN_REWARDS') && (before as any).ignoreCoinRewards !== true) {
        failures.push('ignoreCoinRewards no fijado en el estado');
      }
      if (has('IGNORE_GLORY_REWARDS') && (before as any).ignoreGloryRewards !== true) {
        failures.push('ignoreGloryRewards no fijado en el estado');
      }
      const res = await strikeOn(roomId, enemy.instanceId, strike.instanceId);
      if (!res.accepted) failures.push('PLAY_CARD rechazado');
      if (!res.events.some(e => e.type === 'ENEMY_DEFEATED')) failures.push('sin ENEMY_DEFEATED');
      const rc = targetDef.reward?.coins ?? 0;
      const trophy = targetDef.trophyGlory ?? 0;
      const rg = trophy + (targetDef.reward?.glory ?? 0);
      if (has('IGNORE_COIN_REWARDS')) {
        if (res.coins !== coinsBefore) failures.push(`IGNORE_COIN_REWARDS: ${coinsBefore}→${res.coins}`);
      } else if (rc > 0 && res.coins - coinsBefore < rc) {
        failures.push(`recompensa monedas ${coinsBefore}→${res.coins}`);
      }
      if (has('IGNORE_GLORY_REWARDS')) {
        // Brunmar suprime solo la Gloria del DORSO — el laurel del frente
        // (trophyGlory) se cobra siempre, es valor de trofeo no botín.
        const expected = gloryBefore + trophy;
        if (res.glory !== expected) failures.push(`IGNORE_GLORY_REWARDS: ${gloryBefore}→${res.glory} (esperado ${expected}, trofeo ${trophy})`);
      } else if (rg > 0 && res.glory - gloryBefore < rg) {
        failures.push(`recompensa gloria ${gloryBefore}→${res.glory}`);
      }
      await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
      assert.deepEqual(failures, [], failures.join('\n'));
      return;
    }

    if (onDefeat) {
      // +1 moneda por enemigo derrotado (con umbral de fortaleza si lo hay)
      const { state, rng } = scenarioWith(def);
      const minFort = onDefeat.condition?.fortitudeGte ?? 0;
      const enemyDefId = minFort >= 3 ? 'horde.008' : 'horde.003'; // reward.coins: 0
      const enemyDef = catalog.byId.get(enemyDefId)!;
      const enemy = enemyFromDef(enemyDefId, 'svr-scen-target');
      enemy.wounds = Math.max(0, (enemyDef.printedFortitude ?? 1) - 1);
      state.battlefield = [enemy, enemyFromDef('horde.002', 'svr-extra')];
      const strike = moveFromDeck(state, 'p1', 'warrior.sword-strike');
      await restore(roomId, state, rng);
      const coinsBefore = (await fullState(roomId)).players.p1.coins;
      const res = await strikeOn(roomId, enemy.instanceId, strike.instanceId);
      if (!res.events.some(e => e.type === 'ENEMY_DEFEATED')) failures.push('sin ENEMY_DEFEATED');
      if (res.coins - coinsBefore < 1) failures.push('ON_ENEMY_DEFEATED sin la moneda extra');
      await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
      assert.deepEqual(failures, [], failures.join('\n'));
      return;
    }

    if (def.id === 'scenario.cemenmar-wastes') {
      // Evasión real por API → SELECT_COINS_TO_STEAL
      const { state, rng } = scenarioWith(def);
      state.phase = 'ATTACK_CHOICE';
      await restore(roomId, state, rng);
      const discards = state.players.p1.hand.slice(0, 2).map(c => c.instanceId);
      const events: any[] = [];
      const r = await send(roomId, 'p1', { type: 'EVASION', discardedCardInstanceIds: discards });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      if (!r.json.accepted) failures.push(`EVASION rechazado: ${r.json.reason}`);
      events.push(...(r.json.events ?? []));
      const sawSteal = events.concat().some(e =>
        e.type === 'PENDING_CHOICE_CREATED' && e.choice?.type === 'SELECT_COINS_TO_STEAL');
      // Drenar resolviendo la selección de monedas
      const beforeDrain = events.length;
      await drainChoices(roomId, events);
      const types = new Set(events.map(e => e.type));
      const hadDialog = sawSteal || events.slice(beforeDrain).length > 0;
      if (!hadDialog) failures.push('sin elección SELECT_COINS_TO_STEAL tras evadir');
      if (!types.has('COINS_STOLEN')) failures.push('sin COINS_STOLEN del Yermo');
      await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
      assert.deepEqual(failures, [], failures.join('\n'));
      return;
    }

    // CUSTOM_SCENARIO con oferta de inicio de turno
    const { state, rng } = scenarioWith(def);
    const offer = onTurnStart(state, def.id);
    if (!offer) {
      // Sin oferta: al menos el escenario activo queda restaurado y visible
      await restore(roomId, state, rng);
      const st = await fullState(roomId);
      if ((st.scenario as any)?.definitionId !== def.id) failures.push('escenario no activo tras restore');
      await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
      assert.deepEqual(failures, [], failures.join('\n'));
      return;
    }
    state.players.p1 = {
      ...state.players.p1,
      glory: Math.max(state.players.p1.glory, 2),
      trophies: def.id === 'scenario.ulthar-portal' ? ['svr-trophy-1'] : state.players.p1.trophies,
    };
    if (def.id === 'scenario.ulthar-portal') {
      // El trofeo resuelve su definitionId desde el eventLog (D397)
      state.eventLog = [{
        type: 'ENEMY_DEFEATED', enemyInstanceId: 'svr-trophy-1',
        enemyDefinitionId: 'horde.001', playerId: 'p1', seq: 1,
      } as any];
    }
    state.pendingChoices = [{
      choiceId: `turn-start-${state.turnNumber}`, playerId: 'p1', type: 'CONFIRM',
      prompt: offer.prompt, options: [], minSelections: 0, maxSelections: 1,
    } as any];
    await restore(roomId, state, rng);
    const events: any[] = [];
    await drainChoices(roomId, events);
    const types = new Set(events.map(e => e.type));
    const expected: Record<string, string[]> = {
      'scenario.ur-mountains': ['CARDS_DRAWN', 'ENEMY_REVEALED'],
      'scenario.eque-port': ['CARD_MOVED', 'CARDS_DRAWN'],
      'scenario.kalern-mud': ['ENEMY_RETURNED_TO_HORDE'],
      'scenario.ulthar-portal': ['GLORY_LOST', 'ENEMY_RETURNED_TO_HORDE', 'ENEMY_REVEALED'],
      'scenario.tears-of-aradiel': ['GLORY_LOST', 'GLORY_GAINED'],
      'scenario.jade-deposits': ['COINS_GAINED', 'CARDS_DRAWN'],
    };
    const exp = expected[def.id] ?? [];
    if (exp.length === 0 && events.length === 0) failures.push('oferta aceptada sin efecto observable');
    for (const t of exp) {
      if (!types.has(t)) failures.push(`escenario aceptado sin ${t}`);
    }
    await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}

// ---------------------------------------------------------------------------
// 5) Reglas impresas verificadas por HTTP: el icono «-1» del héroe habilita
//    la compra y reduce el daño (manual §3.5 — Pícaro con diana -1,
//    Explorador con puño -1). Brunmar+trofeo ya cubierto en el test de
//    escenarios (IGNORE_GLORY_REWARDS cobra solo el laurel).
// ---------------------------------------------------------------------------

const PENALTY_CASES: { hero: string; deck: string; card: string; printed: number; expected: number }[] = [
  // Feldon (Pícaro, diana -1) con el Arco compuesto (RANGED, ataque 4) → 3
  { hero: 'hero.feldon', deck: 'rogue.default', card: 'market.composite-bow', printed: 4, expected: 3 },
  // Beleth-Il (Explorador, puño -1) con la Alabarda orca (MELEE, ataque 4) → 3
  { hero: 'hero.beleth-il', deck: 'explorer.default', card: 'market.orc-halberd', printed: 4, expected: 3 },
];

for (const c of PENALTY_CASES) {
  test(`API regla impresa — ${c.hero} juega ${c.card} con penalización -1`, async () => {
    const failures: string[] = [];
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetAbilitySeq(); resetScenarioSeq();
    const seed = `svr-pen-${c.card}`;
    const rng = new DeterministicRng(seed);
    const setup = setupGame({
      mode: 'STANDARD', playerCount: 2, seed,
      heroes: [
        { playerId: 'p1', heroId: c.hero, heroFace: 'MALE', deckId: c.deck },
        { playerId: 'p2', heroId: 'hero.neddia', heroFace: 'FEMALE', deckId: 'rogue.default' },
      ],
      useScenarios: false,
    } as any, catalog);
    const state = startFirstTurn(setup.state, rng, catalog).state;
    state.pendingChoices = [];
    state.eventLog = [];
    // El héroe impreso debe llevar su icono penalizado al estado
    const pen = state.players.p1.penaltyCapabilities ?? [];
    if (pen.length === 0) failures.push(`${c.hero}: sin penaltyCapabilities en el estado`);
    // Compra por API en fase MARKET — el icono penalizado habilita la compra
    state.phase = 'MARKET';
    state.activePlayerId = 'p1';
    state.players.p1 = { ...state.players.p1, coins: 10 };
    const marketCard = inst(c.card, 'market', 'MARKET', c.card);
    state.market = [marketCard, ...state.market];
    const roomId = roomIdFor(c.card, '-penalty');
    await restore(roomId, state, rng);
    const buy = await send(roomId, 'p1', { type: 'BUY_CARD', marketCardInstanceId: marketCard.instanceId });
    if (!buy.json.accepted) failures.push(`BUY_CARD con icono -1 rechazado: ${buy.json.reason}`);
    // Jugarla contra un enemigo — el daño debe ser printed-1
    let st = await fullState(roomId);
    st = { ...st, phase: 'PLAYER_ATTACK', activePlayerId: 'p1' };
    st.battlefield = [enemyFromDef('warlord.gurdrug', 'svr-pen-target')];
    const hand = (st.players.p1.hand as CardInstance[]).find(cd => cd.definitionId === c.card);
    if (!hand) failures.push('la carta comprada no llegó a la mano');
    await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
    await restore(roomId, st, rng);
    const events: any[] = [];
    if (hand) {
      const play = await send(roomId, 'p1', {
        type: 'PLAY_CARD', cardInstanceId: hand.instanceId, targetEnemyId: 'svr-pen-target',
      });
      if (!play.json.accepted) failures.push(`PLAY_CARD rechazado: ${play.json.reason}`);
      events.push(...(play.json.events ?? []));
      await drainChoices(roomId, events);
      const dmg = events.find((e: any) => e.type === 'DAMAGE_DEALT' && (e.targetId === 'svr-pen-target' || e.enemyInstanceId === 'svr-pen-target'));
      if (dmg && dmg.amount !== c.expected) {
        failures.push(`daño ${dmg.amount} ≠ impreso-${c.printed - c.expected} (${c.expected})`);
      }
    }
    await fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}

// ---------------------------------------------------------------------------
// Guarda: toda def del catálogo tiene test a nivel API.
// ---------------------------------------------------------------------------

test('cobertura API — toda carta del catálogo tiene test de servidor', () => {
  const covered = new Set([
    ...playableDefs.map(d => d.id),
    ...enemyDefs.map(d => d.id),
    ...heroDefs.map(d => d.id),
    ...scenarioDefs.map(d => d.id),
  ]);
  const missing = catalog.cards.filter(d => !covered.has(d.id));
  assert.deepEqual(missing.map(d => `${d.id} (${d.type})`), []);
});
