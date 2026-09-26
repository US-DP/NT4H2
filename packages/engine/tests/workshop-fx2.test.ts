/**
 * Extensiones del Taller (fase 2) — tests de motor.
 *
 * Cubre los primitivos orientados a eventos:
 * - SET_VARIABLE (RESOLUTION/GAME) + VARIABLE ValueExpr + VARIABLE_* condiciones
 * - BLOCK_NEXT_DAMAGE: BLOCK_GRANTED, consumo en daño a héroe y en la Horda
 *   (BLOCK_CONSUMED), reset en TURN_STARTED
 * - TRY_EFFECT: éxito, fallo con onFailure, presupuesto agotado
 * - REGISTER_LISTENER / dispatchListeners / REMOVE_LISTENER / expiración
 * - DISCARD_FROM_HAND: pendingChoice SELECT_CARD_FROM_HAND + RESOLVE_CHOICE
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import {
  EffectRegistry, registerCoreEffects,
  evalValue, evalCondition, MAX_RESOLUTION_OPS,
} from '../src/effects/registry.js';
import { EventBus } from '../src/triggers/index.js';
import { dispatchListeners } from '../src/effects/listeners.js';
import { applyEvent } from '../src/events/applyEvent.js';
import { setupGame, resetInstanceCounter } from '../src/phases/setup.js';
import { resetPhaseSeq, processPhases } from '../src/phases/engine.js';
import { resolveCard, resetResolveSeq } from '../src/effects/resolver.js';
import { execute } from '../src/commands/execute.js';
import { nextSeq } from '../src/seq.js';
import { computeHordeAttackBreakdown } from '../src/analysis/hordeBreakdown.js';
import { loadCatalog, type CatalogLoadResult } from '@nt4h/catalog';
import type {
  GameState, ResolutionContext, CardEffect, ValueExpr,
  CardInstance, CardDefinition, CardListener,
} from '@nt4h/schema';

const C = (v: number): ValueExpr => ({ kind: 'CONSTANT', value: v });

let catalog: CatalogLoadResult;
let state: GameState;
let rng: DeterministicRng;
let reg: EffectRegistry;
let ctx: ResolutionContext;

function makeCtx(over: Partial<ResolutionContext> = {}): ResolutionContext {
  return {
    activePlayerId: 'p1',
    currentCardId: 'custom.test',
    currentCardName: 'Carta de Prueba',
    currentCardInstanceId: 'inst-test-1',
    selectedEnemyId: state.battlefield[0]?.instanceId ?? null,
    cardsPlayedThisTurn: {},
    cardsPlayedAgainstEnemy: {},
    drawnCardInstanceId: null,
    sourceZone: 'HAND',
    enemiesDefeatedThisResolution: [],
    depth: 0,
    opsUsed: 0,
    ...over,
  };
}

function run(eff: CardEffect, c: ResolutionContext = ctx) {
  return reg.execute(eff, c, state, rng, new EventBus(reg, rng));
}

beforeEach(() => {
  resetInstanceCounter();
  resetPhaseSeq();
  resetResolveSeq();
  catalog = loadCatalog();
  const res = setupGame({
    mode: 'STANDARD',
    playerCount: 2,
    seed: 'ws-fx2-001',
    heroes: [
      { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
      { playerId: 'p2', heroId: 'hero.neddia', heroFace: 'FEMALE', deckId: 'explorer.default' },
    ],
    useScenarios: false,
  }, catalog);
  expect(res.errors).toEqual([]);
  state = res.state;
  rng = new DeterministicRng('ws-fx2-001');
  reg = new EffectRegistry();
  registerCoreEffects(reg);
  ctx = makeCtx();
});

// ============================================================================
// Variables
// ============================================================================

describe('SET_VARIABLE + VARIABLE', () => {
  it('scope RESOLUTION guarda en ctx.variables sin emitir eventos', () => {
    const evs = run({ type: 'SET_VARIABLE', name: 'carga', value: C(5), scope: 'RESOLUTION' });
    expect(evs).toHaveLength(0);
    expect(ctx.variables?.carga).toBe(5);
    expect(evalValue({ kind: 'VARIABLE', name: 'carga' }, ctx, state)).toBe(5);
  });

  it('scope GAME emite VARIABLE_SET y persiste en state.customVars', () => {
    const evs = run({ type: 'SET_VARIABLE', name: 'altares', value: C(3), scope: 'GAME' });
    expect(evs).toEqual([expect.objectContaining({ type: 'VARIABLE_SET', name: 'altares', value: 3 })]);
    for (const ev of evs) state = applyEvent(state, ev);
    expect(state.customVars?.altares).toBe(3);
    expect(evalValue({ kind: 'VARIABLE', name: 'altares', scope: 'GAME' }, ctx, state)).toBe(3);
    // Sin scope explícito: primero resolución, luego partida
    expect(evalValue({ kind: 'VARIABLE', name: 'altares' }, ctx, state)).toBe(3);
  });

  it('la variable alimenta efectos posteriores (encadenamiento)', () => {
    run({ type: 'SET_VARIABLE', name: 'golpes', value: C(4), scope: 'RESOLUTION' });
    const evs = run({ type: 'GAIN_COINS', amount: { kind: 'VARIABLE', name: 'golpes' }, target: 'SELF' });
    expect(evs).toEqual([expect.objectContaining({ type: 'COINS_GAINED', amount: 4 })]);
  });

  it('condiciones VARIABLE_GTE / LTE / EQ', () => {
    state = { ...state, customVars: { poder: 7 } };
    expect(evalCondition({ kind: 'VARIABLE_GTE', name: 'poder', value: 7 }, ctx, state)).toBe(true);
    expect(evalCondition({ kind: 'VARIABLE_LTE', name: 'poder', value: 6 }, ctx, state)).toBe(false);
    expect(evalCondition({ kind: 'VARIABLE_EQ', name: 'poder', value: 7 }, ctx, state)).toBe(true);
    expect(evalCondition({ kind: 'VARIABLE_GTE', name: 'inexistente', value: 1 }, ctx, state)).toBe(false);
  });
});

// ============================================================================
// BLOCK_NEXT_DAMAGE
// ============================================================================

describe('BLOCK_NEXT_DAMAGE', () => {
  it('emite BLOCK_GRANTED y applyEvent acumula blockNext', () => {
    const evs = run({ type: 'BLOCK_NEXT_DAMAGE', amount: C(2) });
    expect(evs).toEqual([expect.objectContaining({ type: 'BLOCK_GRANTED', playerId: 'p1', amount: 2 })]);
    for (const ev of evs) state = applyEvent(state, ev);
    expect(state.players.p1.blockNext).toBe(2);
  });

  it('reduce el daño de la Horda en el desglose (blockApplied)', () => {
    state = applyEvent(state, { type: 'BLOCK_GRANTED' as const, playerId: 'p1', amount: 2, seq: 1 });
    const before = computeHordeAttackBreakdown(state, catalog, 'p1');
    state = applyEvent(state, { type: 'BLOCK_GRANTED' as const, playerId: 'p1', amount: 1, seq: 2 });
    const after = computeHordeAttackBreakdown(state, catalog, 'p1');
    expect(after.blockApplied).toBe(3);
    expect(after.finalExhaustion).toBe(Math.max(0, before.finalExhaustion - 1));
  });

  it('la Horda consume el bloqueo: BLOCK_CONSUMED + blockNext a 0', () => {
    state = applyEvent(state, { type: 'BLOCK_GRANTED' as const, playerId: 'p1', amount: 99, seq: 1 });
    const forced: GameState = { ...state, phase: 'HORDE_ATTACK', activePlayerId: 'p1' };
    const res = processPhases(forced, rng, catalog);
    const consumed = res.events.filter(e => e.type === 'BLOCK_CONSUMED');
    expect(consumed.length).toBeGreaterThan(0);
    expect(res.state.players.p1.blockNext).toBe(0);
    // Daño bloqueado en su totalidad: 0 cartas perdidas
    const lost = res.events.filter(e => e.type === 'CARDS_LOST' && e.playerId === 'p1');
    expect(lost).toHaveLength(0);
  });

  it('DEAL_DAMAGE_TO_HERO consume blockNext antes de perder cartas', () => {
    state = applyEvent(state, { type: 'BLOCK_GRANTED' as const, playerId: 'p1', amount: 2, seq: 1 });
    const evs = run({ type: 'DEAL_DAMAGE_TO_HERO', amount: C(5), target: { kind: 'SELF' } });
    expect(evs.some(e => e.type === 'BLOCK_CONSUMED')).toBe(true);
    // 5 - 2 = 3 cartas perdidas
    const lost = evs.find(e => e.type === 'CARDS_LOST') as { count: number } | undefined;
    expect(lost?.count).toBe(3);
  });

  it('TURN_STARTED resetea blockNext del jugador activo', () => {
    state = applyEvent(state, { type: 'BLOCK_GRANTED' as const, playerId: 'p1', amount: 3, seq: 1 });
    state = applyEvent(state, { type: 'TURN_STARTED' as const, playerId: 'p1', turnNumber: 2, seq: 2 });
    expect(state.players.p1.blockNext).toBe(0);
  });
});

// ============================================================================
// TRY_EFFECT
// ============================================================================

describe('TRY_EFFECT', () => {
  it('éxito: ejecuta los efectos y omite onFailure', () => {
    const evs = run({
      type: 'TRY_EFFECT',
      effects: [{ type: 'GAIN_COINS', amount: C(2), target: 'SELF' }],
      onFailure: [{ type: 'GAIN_COINS', amount: C(99), target: 'SELF' }],
    });
    const gains = evs.filter(e => e.type === 'COINS_GAINED') as { amount: number }[];
    expect(gains).toHaveLength(1);
    expect(gains[0].amount).toBe(2);
  });

  it('fallo (efecto desconocido): ejecuta onFailure', () => {
    const evs = run({
      type: 'TRY_EFFECT',
      effects: [{ type: 'EFECTO_QUE_NO_EXISTE' } as unknown as CardEffect],
      onFailure: [{ type: 'GAIN_COINS', amount: C(3), target: 'SELF' }],
    });
    expect(evs.some(e => e.type === 'COINS_GAINED' && (e as { amount: number }).amount === 3)).toBe(true);
  });

  it('presupuesto agotado: emite RESOLUTION_HALTED sin propagar', () => {
    // MAX-1: el propio TRY consume 1 op; su primer efecto interno agota el
    // presupuesto y el handler lo captura.
    ctx.opsUsed = MAX_RESOLUTION_OPS - 1;
    const evs = run({
      type: 'TRY_EFFECT',
      effects: [{ type: 'GAIN_COINS', amount: C(1), target: 'SELF' }],
      onFailure: [{ type: 'GAIN_COINS', amount: C(1), target: 'SELF' }],
    });
    expect(evs.some(e => e.type === 'RESOLUTION_HALTED')).toBe(true);
    expect(evs.some(e => e.type === 'COINS_GAINED')).toBe(false);
  });
});

// ============================================================================
// Oyentes (REGISTER_LISTENER / dispatchListeners / REMOVE_LISTENER)
// ============================================================================

type ListenerOver = {
  event?: string; once?: boolean;
  duration?: 'THIS_TURN' | 'GAME'; tag?: string; effects?: CardEffect[];
};
function registerListener(over: ListenerOver = {}) {
  const eff: CardEffect = {
    type: 'REGISTER_LISTENER', event: 'COINS_GAINED',
    effects: [{ type: 'GAIN_COINS', amount: C(1), target: 'SELF' }],
    ...over,
  };
  const evs = run(eff);
  for (const ev of evs) state = applyEvent(state, ev);
  return state.listeners!.map(l => l.id);
}

function dispatch(ev: Parameters<typeof dispatchListeners>[1]) {
  const r = dispatchListeners(state, ev, { registry: reg, rng, nextSeq });
  state = r.state;
  return r.events;
}

describe('REGISTER_LISTENER + dispatch', () => {
  it('registra el oyente en state.listeners', () => {
    registerListener();
    expect(state.listeners).toHaveLength(1);
    expect(state.listeners![0].trigger).toBe('COINS_GAINED');
    expect(state.listeners![0].playerId).toBe('p1');
  });

  it('dispara sus efectos al llegar el evento (y no en otro tipo)', () => {
    registerListener();
    const none = dispatch({ type: 'PHASE_CHANGED' as const, phase: 'MARKET' as const, seq: 1 });
    expect(none).toHaveLength(0);
    const evs = dispatch({ type: 'COINS_GAINED' as const, playerId: 'p2', amount: 1, seq: 2 });
    // El oyente gana 1 moneda para su dueño (p1)
    expect(evs.some(e => e.type === 'COINS_GAINED' && e.playerId === 'p1')).toBe(true);
    // El oyente sigue registrado (once: false)
    expect(state.listeners).toHaveLength(1);
  });

  it('once:true se retira tras disparar (LISTENER_REMOVED)', () => {
    registerListener({ once: true });
    const evs = dispatch({ type: 'COINS_GAINED' as const, playerId: 'p2', amount: 1, seq: 2 });
    expect(evs.some(e => e.type === 'LISTENER_REMOVED')).toBe(true);
    expect(state.listeners).toHaveLength(0);
    // No vuelve a disparar
    const again = dispatch({ type: 'COINS_GAINED' as const, playerId: 'p2', amount: 1, seq: 3 });
    expect(again).toHaveLength(0);
  });

  it('event_amount queda disponible como variable de resolución', () => {
    const eff: CardEffect = {
      type: 'REGISTER_LISTENER', event: 'DAMAGE_DEALT', once: true,
      effects: [{
        type: 'GAIN_COINS', amount: { kind: 'VARIABLE', name: 'event_amount' }, target: 'SELF',
      }],
    };
    for (const ev of run(eff)) state = applyEvent(state, ev);
    const evs = dispatch({ type: 'DAMAGE_DEALT' as const, targetId: 'x', amount: 4, sourceCardInstanceId: 'c', seq: 1 });
    const gain = evs.find(e => e.type === 'COINS_GAINED') as { amount: number } | undefined;
    expect(gain?.amount).toBe(4);
  });

  it('REMOVE_LISTENER retira solo los oyentes del dueño con esa etiqueta', () => {
    registerListener({ event: 'DAMAGE_DEALT', tag: 'venganza' });
    registerListener({ event: 'HERO_WOUNDED', tag: 'venganza' });
    // Oyente de otro jugador con la misma etiqueta (inyectado a mano)
    const ajeno: CardListener = {
      id: 'lis-ajeno', playerId: 'p2', trigger: 'DAMAGE_DEALT', tag: 'venganza',
      effects: [],
    };
    state = { ...state, listeners: [...(state.listeners ?? []), ajeno] };
    expect(state.listeners).toHaveLength(3);
    const evs = run({ type: 'REMOVE_LISTENER', tag: 'venganza' });
    expect(evs.filter(e => e.type === 'LISTENER_REMOVED')).toHaveLength(2);
    for (const ev of evs) state = applyEvent(state, ev);
    expect(state.listeners).toHaveLength(1);
    expect(state.listeners![0].playerId).toBe('p2');
  });

  it('los oyentes THIS_TURN expiran en TURN_STARTED; GAME persiste', () => {
    registerListener({ event: 'DAMAGE_DEALT', duration: 'THIS_TURN' });
    registerListener({ event: 'HERO_WOUNDED', duration: 'GAME' });
    state = applyEvent(state, { type: 'TURN_STARTED' as const, playerId: 'p1', turnNumber: 2, seq: 99 });
    expect(state.listeners).toHaveLength(1);
    expect(state.listeners![0].trigger).toBe('HERO_WOUNDED');
  });

  it('integración resolver: daño de la carta dispara el oyente', () => {
    registerListener({
      event: 'DAMAGE_DEALT', once: true,
      effects: [{ type: 'GAIN_COINS', amount: C(1), target: 'SELF' }],
    });
    const cardDef: CardDefinition = {
      id: 'custom.strike', name: 'Golpe', type: 'ABILITY',
      heroClass: 'EXPLORER', copies: 1, printedAttack: 0,
      officialStatus: 'CUSTOM',
      effects: [{ type: 'DEAL_DAMAGE', amount: C(1), target: { kind: 'SELECTED_ENEMY' } }],
    } as CardDefinition;
    const card: CardInstance = {
      instanceId: 'inst-strike-1', definitionId: 'custom.strike', ownerId: 'p1', zone: 'HAND',
    };
    const target = state.battlefield[0].instanceId;
    const result = resolveCard(state, card, cardDef, target, state.players.p1, rng, reg, catalog);
    expect(result.events.some(e => e.type === 'DAMAGE_DEALT')).toBe(true);
    expect(result.events.some(e => e.type === 'COINS_GAINED' && e.playerId === 'p1')).toBe(true);
    expect(result.events.some(e => e.type === 'LISTENER_REMOVED')).toBe(true);
  });
});

// ============================================================================
// DISCARD_FROM_HAND
// ============================================================================

describe('DISCARD_FROM_HAND', () => {
  const discardDef = (): CardDefinition => ({
    id: 'custom.descartar', name: 'Descarte Voluntario', type: 'ABILITY',
    heroClass: 'EXPLORER', copies: 1, printedAttack: 0,
    officialStatus: 'CUSTOM',
    destinationAfterUse: 'WEAR_PILE',
    effects: [{ type: 'DISCARD_FROM_HAND', count: C(1) }],
  } as CardDefinition);

  // Carta real de la mano (resolver toma el cardDef por parámetro)
  const discardCard = (): CardInstance => state.players.p1.hand[0];

  it('el resolver pausa con SELECT_CARD_FROM_HAND', () => {
    const card = discardCard();
    const result = resolveCard(state, card, discardDef(), null, state.players.p1, rng, reg, catalog);
    expect(result.pendingChoice).toBeDefined();
    expect(result.pendingChoice!.type).toBe('SELECT_CARD_FROM_HAND');
    expect(result.pendingChoice!.options).not.toContain(card.instanceId);
    expect(result.pendingChoice!.minSelections).toBe(1);
  });

  it('RESOLVE_CHOICE descarta la carta elegida y limpia la elección', () => {
    const card = discardCard();
    const result = resolveCard(state, card, discardDef(), null, state.players.p1, rng, reg, catalog);
    const choice = result.pendingChoice!;
    // Simular el guardado de la elección (lo hace PLAY_CARD)
    state = {
      ...result.newState,
      pendingChoices: [...result.newState.pendingChoices, choice],
    };
    const handBefore = state.players.p1.hand.length;
    const wearBefore = state.players.p1.wearPile.length;
    const victim = choice.options[0];
    const cmd = {
      type: 'RESOLVE_CHOICE' as const,
      cid: 'fx2-discard-1',
      choiceId: choice.choiceId,
      selectedIds: [victim],
    };
    const res = execute(state, cmd, rng, reg, catalog);
    expect(res.accepted).toBe(true);
    const moved = res.events.filter(
      e => e.type === 'CARD_MOVED' && e.cardInstanceId === victim && e.to === 'WEAR_PILE',
    );
    expect(moved).toHaveLength(1);
    // -1 descartada, -1 la carta jugada a su destino (WEAR_PILE)
    expect(res.newState.players.p1.hand.length).toBe(handBefore - 2);
    expect(res.newState.players.p1.wearPile.length).toBe(wearBefore + 2);
    expect(res.newState.pendingChoices.some(c => c.choiceId === choice.choiceId)).toBe(false);
  });

  it('el handler de registro (sin resolver) descarta las últimas cartas', () => {
    const hand = state.players.p1.hand;
    const evs = run({ type: 'DISCARD_FROM_HAND', count: C(2) });
    const moved = evs.filter(e => e.type === 'CARD_MOVED' && e.to === 'WEAR_PILE');
    expect(moved).toHaveLength(2);
    // Son las 2 últimas de la mano, excluyendo la carta en juego
    const expected = hand
      .filter(c => c.instanceId !== ctx.currentCardInstanceId)
      .slice(-2)
      .map(c => c.instanceId);
    expect(moved.map(e => (e as { cardInstanceId: string }).cardInstanceId)).toEqual(expected);
  });
});
