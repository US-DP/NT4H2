/**
 * Extensiones del Taller (fase 1+) — tests de motor.
 *
 * Cubre los nuevos primitivos:
 * - ValueExpr: SUBTRACT/MIN/MAX/ABS, HERO_STAT, ENEMY_*_OF, STATUS_STACKS_OF, DEFEATED_ENEMIES
 * - Condiciones: HERO_STAT_*, HAS_CARD_IN_HAND, ENEMY_COUNT_*, ENEMY_IS_*, ENEMY_HAS_STATUS
 * - Efectos: DEAL_DAMAGE_HITS, EXECUTE_ENEMY, OVERKILL_DAMAGE, SPAWN_ENEMY,
 *   DISCARD_HORDE_CARD, MOVE_HORDE_CARDS, DRAW_FROM_BOTTOM, DRAW_UP_TO,
 *   TAKE_WOUNDS, GRANT_ARMOR, MOVE_CARD, FOR_EACH, APPLY/REMOVE/INCREASE_STATUS
 * - Estados con semántica: 'mark' (+N al primer daño), 'stun' (salta la Horda),
 *   'poison' (tick en la Horda), 'armor' (reduce cada instancia)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import {
  EffectRegistry, registerCoreEffects,
  evalValue, evalCondition, resolveTarget, resolveHeroTargets,
} from '../src/effects/registry.js';
import { EventBus } from '../src/triggers/index.js';
import { applyEvent } from '../src/events/applyEvent.js';
import { setupGame, resetInstanceCounter } from '../src/phases/setup.js';
import { resetPhaseSeq, processPhases } from '../src/phases/engine.js';
import { resolveCard, resetResolveSeq } from '../src/effects/resolver.js';
import { computeHordeAttackBreakdown } from '../src/analysis/hordeBreakdown.js';
import { loadCatalog, type CatalogLoadResult } from '@nt4h/catalog';
import type {
  GameState, ResolutionContext, CardEffect, ValueExpr,
  TargetSelector, CardInstance, CardDefinition,
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
    seed: 'ws-fx-001',
    heroes: [
      { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
      { playerId: 'p2', heroId: 'hero.neddia', heroFace: 'FEMALE', deckId: 'explorer.default' },
    ],
    useScenarios: false,
  }, catalog);
  expect(res.errors).toEqual([]);
  state = res.state;
  rng = new DeterministicRng('ws-fx-001');
  reg = new EffectRegistry();
  registerCoreEffects(reg);
  ctx = makeCtx();
});

// ============================================================================
// ValueExpr
// ============================================================================

describe('ValueExpr — operadores y estadísticas', () => {
  it('SUBTRACT / MIN / MAX / ABS', () => {
    expect(evalValue({ kind: 'SUBTRACT', of: [C(10), C(3), C(2)] }, ctx, state)).toBe(5);
    expect(evalValue({ kind: 'MIN', of: [C(4), C(2), C(9)] }, ctx, state)).toBe(2);
    expect(evalValue({ kind: 'MAX', of: [C(4), C(9), C(2)] }, ctx, state)).toBe(9);
    expect(evalValue({ kind: 'ABS', of: [{ kind: 'SUBTRACT', of: [C(3), C(8)] }] }, ctx, state)).toBe(5);
  });

  it('HERO_STAT lee heridas/monedas/gloria/mano/desgaste/trofeos', () => {
    const v = (stat: 'WOUNDS' | 'COINS' | 'GLORY' | 'CARDS_IN_HAND' | 'CARDS_IN_WEAR' | 'TROPHIES') =>
      evalValue({ kind: 'HERO_STAT', stat, hero: { kind: 'SELF' } }, ctx, state);
    expect(v('WOUNDS')).toBe(0);
    expect(v('CARDS_IN_HAND')).toBe(state.players.p1.hand.length);
    expect(v('CARDS_IN_WEAR')).toBe(0);
    expect(v('TROPHIES')).toBe(0);
    state = applyEvent(state, { type: 'WOUND_PLACED' as const, enemyInstanceId: 'x', amount: 0, seq: 1 });
    // HERO_WOUNDED fija heridas del jugador
    state = applyEvent(state, { type: 'HERO_WOUNDED' as const, playerId: 'p1', woundCount: 3, seq: 2 });
    expect(v('WOUNDS')).toBe(3);
  });

  it('ENEMY_DAMAGE_OF = Fortaleza − Heridas; ENEMY_WOUNDS_OF = Heridas', () => {
    const enemy = state.battlefield[0];
    state = applyEvent(state, {
      type: 'WOUND_PLACED' as const, enemyInstanceId: enemy.instanceId, amount: 1, seq: 1,
    });
    const sel: TargetSelector = { kind: 'SELECTED_ENEMY' };
    expect(evalValue({ kind: 'ENEMY_WOUNDS_OF', target: sel }, ctx, state)).toBe(1);
    const fresh = state.battlefield.find(e => e.instanceId === enemy.instanceId)!;
    const eff = Math.max(0, fresh.baseFortitude - 1);
    expect(evalValue({ kind: 'ENEMY_DAMAGE_OF', target: sel }, ctx, state)).toBe(eff);
  });

  it('STATUS_STACKS_OF y DEFEATED_ENEMIES', () => {
    const enemy = state.battlefield[0];
    state = applyEvent(state, {
      type: 'STATUS_APPLIED' as const, enemyInstanceId: enemy.instanceId,
      status: 'poison', stacks: 3, seq: 1,
    });
    expect(evalValue(
      { kind: 'STATUS_STACKS_OF', status: 'poison', target: { kind: 'SELECTED_ENEMY' } },
      ctx, state,
    )).toBe(3);
    expect(evalValue({ kind: 'DEFEATED_ENEMIES' }, ctx, state)).toBe(0);
  });
});

// ============================================================================
// Condiciones y selectores
// ============================================================================

describe('Condiciones nuevas', () => {
  it('HERO_STAT_GTE / LTE sobre heridas y mano', () => {
    const hand = state.players.p1.hand.length;
    expect(evalCondition(
      { kind: 'HERO_STAT_GTE', stat: 'CARDS_IN_HAND', value: hand }, ctx, state,
    )).toBe(true);
    expect(evalCondition(
      { kind: 'HERO_STAT_LTE', stat: 'WOUNDS', value: 0 }, ctx, state,
    )).toBe(true);
    expect(evalCondition(
      { kind: 'HERO_STAT_GTE', stat: 'WOUNDS', value: 1 }, ctx, state,
    )).toBe(false);
  });

  it('HAS_CARD_IN_HAND por nombre o id', () => {
    const card = state.players.p1.hand[0];
    const name = card.name ?? card.definitionId;
    expect(evalCondition({ kind: 'HAS_CARD_IN_HAND', name }, ctx, state)).toBe(true);
    expect(evalCondition({ kind: 'HAS_CARD_IN_HAND', name: 'Inexistente XYZ' }, ctx, state)).toBe(false);
  });

  it('ENEMY_COUNT e identidad del enemigo', () => {
    expect(evalCondition({ kind: 'ENEMY_COUNT_GTE', value: 1 }, ctx, state)).toBe(true);
    expect(evalCondition({ kind: 'ENEMY_COUNT_LTE', value: 99 }, ctx, state)).toBe(true);
    const orc = state.battlefield.find(e => e.isOrc);
    if (orc) {
      expect(evalCondition({ kind: 'ENEMY_IS_ORC' }, makeCtx({ selectedEnemyId: orc.instanceId }), state)).toBe(true);
    }
    expect(evalCondition(
      { kind: 'ENEMY_IS_UNHARMED' }, ctx, state,
    )).toBe(true);
    state = applyEvent(state, {
      type: 'STATUS_APPLIED' as const, enemyInstanceId: state.battlefield[0].instanceId,
      status: 'poison', stacks: 1, seq: 1,
    });
    expect(evalCondition({ kind: 'ENEMY_HAS_STATUS', status: 'poison' }, ctx, state)).toBe(true);
    expect(evalCondition({ kind: 'ENEMY_HAS_STATUS', status: 'mark' }, ctx, state)).toBe(false);
  });
});

describe('Selectores nuevos', () => {
  it('ENEMY_WITH_MIN_FORTITUDE / MAX_DAMAGE / OTHER_ENEMY', () => {
    if (state.battlefield.length >= 2) {
      const min = resolveTarget({ kind: 'ENEMY_WITH_MIN_FORTITUDE' }, ctx, state);
      const maxD = resolveTarget({ kind: 'ENEMY_WITH_MAX_DAMAGE' }, ctx, state);
      const other = resolveTarget({ kind: 'OTHER_ENEMY' }, ctx, state);
      expect(min).not.toBeNull();
      expect(maxD).not.toBeNull();
      expect(other).not.toBe(ctx.selectedEnemyId);
    }
  });

  it('HERO_WITH_MOST_WOUNDS / GLORY / COINS', () => {
    state = applyEvent(state, { type: 'HERO_WOUNDED' as const, playerId: 'p2', woundCount: 2, seq: 1 });
    expect(resolveHeroTargets({ kind: 'HERO_WITH_MOST_WOUNDS' }, ctx, state)).toEqual(['p2']);
    expect(resolveHeroTargets({ kind: 'HERO_WITH_MOST_GLORY' }, ctx, state)).toHaveLength(1);
    expect(resolveHeroTargets({ kind: 'HERO_WITH_MOST_COINS' }, ctx, state)).toHaveLength(1);
  });
});

// ============================================================================
// Efectos nuevos
// ============================================================================

describe('Efectos — daño', () => {
  it('DEAL_DAMAGE_HITS emite N DAMAGE_DEALT separados', () => {
    const evs = run({ type: 'DEAL_DAMAGE_HITS', amount: C(2), times: C(3), target: { kind: 'SELECTED_ENEMY' } });
    const hits = evs.filter(e => e.type === 'DAMAGE_DEALT');
    expect(hits).toHaveLength(3);
    expect(hits.every(e => e.amount === 2)).toBe(true);
  });

  it('EXECUTE_ENEMY solo derrota si Fortaleza ≤ umbral', () => {
    const enemy = state.battlefield[0];
    const low = run({ type: 'EXECUTE_ENEMY', target: { kind: 'SELECTED_ENEMY' }, threshold: C(0), loot: true });
    expect(low.some(e => e.type === 'ENEMY_DEFEATED')).toBe(false);
    const high = run({ type: 'EXECUTE_ENEMY', target: { kind: 'SELECTED_ENEMY' }, threshold: C(99), loot: true });
    const def = high.find(e => e.type === 'ENEMY_DEFEATED');
    expect(def).toBeDefined();
    expect((def as { enemyInstanceId: string }).enemyInstanceId).toBe(enemy.instanceId);
  });

  it('OVERKILL_DAMAGE envía el exceso a otro enemigo', () => {
    if (state.battlefield.length < 2) return;
    const enemy = state.battlefield[0];
    const other = state.battlefield[1];
    const remaining = Math.max(0, enemy.baseFortitude - enemy.wounds);
    const evs = run({
      type: 'OVERKILL_DAMAGE', amount: C(remaining + 3),
      target: { kind: 'SELECTED_ENEMY' }, spill: { kind: 'OTHER_ENEMY' },
    });
    const dmg = evs.filter(e => e.type === 'DAMAGE_DEALT') as { targetId: string; amount: number }[];
    expect(dmg).toHaveLength(2);
    expect(dmg[1].targetId).toBe(other.instanceId);
    expect(dmg[1].amount).toBe(3);
  });
});

describe('Efectos — mazo de la Horda', () => {
  it('DISCARD_HORDE_CARD elimina cartas del fondo', () => {
    const before = state.hordeDeck.length;
    const evs = run({ type: 'DISCARD_HORDE_CARD', count: 2, from: 'BOTTOM' });
    expect(evs).toHaveLength(2);
    for (const ev of evs) state = applyEvent(state, ev);
    expect(state.hordeDeck.length).toBe(before - 2);
  });

  it('MOVE_HORDE_CARDS mueve N del fondo al principio', () => {
    const bottomId = state.hordeDeck[state.hordeDeck.length - 1].instanceId;
    const [ev] = run({ type: 'MOVE_HORDE_CARDS', count: 1, to: 'TOP' });
    state = applyEvent(state, ev);
    expect(state.hordeDeck[0].instanceId).toBe(bottomId);
  });

  it('SPAWN_ENEMY revela enemigos al campo (vía resolver)', () => {
    const cardDef: CardDefinition = {
      id: 'custom.summoner', name: 'Invocador', type: 'ABILITY',
      heroClass: 'EXPLORER', copies: 1, printedAttack: 0,
      officialStatus: 'CUSTOM',
      effects: [{ type: 'SPAWN_ENEMY', count: 1 }],
    } as CardDefinition;
    const card: CardInstance = {
      instanceId: 'inst-summon-1', definitionId: 'custom.summoner',
      ownerId: 'p1', zone: 'HAND',
    };
    const before = state.battlefield.length;
    const deckBefore = state.hordeDeck.length;
    const result = resolveCard(
      state, card, cardDef, null, state.players.p1, rng, reg, catalog,
    );
    const spawned = result.events.find(e => e.type === 'ENEMY_SPAWNED');
    expect(spawned).toBeDefined();
    expect(result.newState.battlefield.length).toBe(before + 1);
    expect(result.newState.hordeDeck.length).toBe(deckBefore - 1);
  });
});

describe('Efectos — cartas y recursos', () => {
  it('DRAW_FROM_BOTTOM roba las cartas del fondo', () => {
    const p = state.players.p1;
    const bottomId = p.abilityDeck[p.abilityDeck.length - 1].instanceId;
    const evs = run({ type: 'DRAW_FROM_BOTTOM', amount: C(1) });
    const drawn = evs.find(e => e.type === 'CARDS_DRAWN') as { cardInstanceIds: string[] };
    expect(drawn.cardInstanceIds).toEqual([bottomId]);
  });

  it('DRAW_UP_TO completa la mano hasta el límite', () => {
    const p = state.players.p1;
    const limit = p.hand.length + 2;
    const evs = run({ type: 'DRAW_UP_TO', limit });
    const drawn = evs.find(e => e.type === 'CARDS_DRAWN') as { count: number };
    expect(drawn.count).toBe(2);
  });

  it('MOVE_CARD mueve cartas de Desgaste a mano', () => {
    // Preparar: mandar una carta al Desgaste
    const p = state.players.p1;
    const moved = p.abilityDeck[0];
    state = applyEvent(state, {
      type: 'CARD_MOVED' as const, cardInstanceId: moved.instanceId,
      from: 'ABILITY_DECK', to: 'WEAR_PILE', playerId: 'p1', seq: 1,
    });
    const evs = run({
      type: 'MOVE_CARD', count: C(1), from: 'WEAR_PILE', to: 'HAND',
    });
    expect(evs).toHaveLength(1);
    expect((evs[0] as { cardInstanceId: string }).cardInstanceId).toBe(moved.instanceId);
  });

  it('TAKE_WOUNDS emite HERO_WOUNDED directo', () => {
    const evs = run({ type: 'TAKE_WOUNDS', amount: C(2), hero: { kind: 'SELF' } });
    expect(evs).toEqual([expect.objectContaining({ type: 'HERO_WOUNDED', playerId: 'p1', woundCount: 2 })]);
  });

  it('GRANT_ARMOR suma armadura y la reduce en el desglose de la Horda', () => {
    const [ev] = run({ type: 'GRANT_ARMOR', amount: C(1), duration: 'UNTIL_END_OF_TURN' });
    state = applyEvent(state, ev);
    expect(state.players.p1.armor).toBe(1);
    const before = computeHordeAttackBreakdown(state, catalog, 'p1');
    // La armadura resta 1 por línea de enemigo
    state = applyEvent(state, { type: 'ARMOR_GRANTED' as const, playerId: 'p1', amount: 2, seq: 99 });
    const after = computeHordeAttackBreakdown(state, catalog, 'p1');
    expect(after.finalExhaustion).toBeLessThan(before.finalExhaustion);
  });
});

describe('FOR_EACH', () => {
  it('ENEMIES itera el campo fijando selectedEnemyId', () => {
    const evs = run({
      type: 'FOR_EACH', collection: 'ENEMIES',
      effects: [{ type: 'DEAL_DAMAGE', amount: C(1), target: { kind: 'SELECTED_ENEMY' } }],
    });
    const hits = evs.filter(e => e.type === 'DAMAGE_DEALT') as { targetId: string }[];
    expect(hits).toHaveLength(state.battlefield.length);
    expect(new Set(hits.map(h => h.targetId)).size).toBe(state.battlefield.length);
    // El contexto se restaura
    expect(ctx.selectedEnemyId).toBe(state.battlefield[0].instanceId);
  });

  it('OTHER_HEROES itera héroes fijando forEachHeroId (SELF)', () => {
    const evs = run({
      type: 'FOR_EACH', collection: 'OTHER_HEROES',
      effects: [{ type: 'GAIN_COINS', amount: C(1), target: 'SELF' }],
    });
    const gains = evs.filter(e => e.type === 'COINS_GAINED') as { playerId: string }[];
    expect(gains).toHaveLength(1);
    expect(gains[0].playerId).toBe('p2');
    expect(ctx.forEachHeroId ?? null).toBeNull();
  });
});

// ============================================================================
// Estados con semántica
// ============================================================================

describe('Estados — mark / stun / poison / armor', () => {
  it('APPLY_STATUS apila acumulaciones y REMOVE_STATUS las retira', () => {
    const enemy = state.battlefield[0];
    const [a1] = run({ type: 'APPLY_STATUS', status: 'mark', stacks: C(2), duration: 'PERMANENT', target: { kind: 'SELECTED_ENEMY' } });
    state = applyEvent(state, a1);
    const [a2] = run({ type: 'INCREASE_STATUS', status: 'mark', amount: C(3), target: { kind: 'SELECTED_ENEMY' } });
    state = applyEvent(state, a2);
    const e = state.battlefield.find(x => x.instanceId === enemy.instanceId)!;
    expect(e.statuses!.find(s => s.id === 'mark')!.stacks).toBe(5);
    const [rm] = run({ type: 'REMOVE_STATUS', status: 'mark', target: { kind: 'SELECTED_ENEMY' } });
    state = applyEvent(state, rm);
    expect(state.battlefield.find(x => x.instanceId === enemy.instanceId)!.statuses).toHaveLength(0);
  });

  it("'mark' suma stacks al primer daño y se consume", () => {
    const enemy = state.battlefield[0];
    state = applyEvent(state, {
      type: 'STATUS_APPLIED' as const, enemyInstanceId: enemy.instanceId,
      status: 'mark', stacks: 2, seq: 1,
    });
    const evs = run({ type: 'DEAL_DAMAGE', amount: C(1), target: { kind: 'SELECTED_ENEMY' } });
    const dmg = evs.find(e => e.type === 'DAMAGE_DEALT') as { amount: number };
    expect(dmg.amount).toBe(3); // 1 base + 2 Marca
    expect(evs.some(e => e.type === 'STATUS_REMOVED')).toBe(true);
    // Segunda vez en la misma resolución: la Marca ya está consumida
    const evs2 = run({ type: 'DEAL_DAMAGE', amount: C(1), target: { kind: 'SELECTED_ENEMY' } });
    expect((evs2.find(e => e.type === 'DAMAGE_DEALT') as { amount: number }).amount).toBe(1);
  });

  it("'stun' anula la contribución del enemigo a la Horda", () => {
    const enemy = state.battlefield[0];
    const before = computeHordeAttackBreakdown(state, catalog, 'p1');
    state = applyEvent(state, {
      type: 'STATUS_APPLIED' as const, enemyInstanceId: enemy.instanceId,
      status: 'stun', stacks: 1, seq: 1,
    });
    const after = computeHordeAttackBreakdown(state, catalog, 'p1');
    const line = after.enemyLines.find(l => l.enemyInstanceId === enemy.instanceId)!;
    expect(line.finalDamage).toBe(0);
    expect(after.finalExhaustion).toBeLessThan(before.finalExhaustion);
  });

  it("'poison' hiere al portador al atacar la Horda", () => {
    const enemy = state.battlefield[0];
    state = applyEvent(state, {
      type: 'STATUS_APPLIED' as const, enemyInstanceId: enemy.instanceId,
      status: 'poison', stacks: 2, seq: 1,
    });
    const forced: GameState = { ...state, phase: 'HORDE_ATTACK', activePlayerId: 'p1' };
    const res = processPhases(forced, rng, catalog);
    const wounds = res.events.filter(
      e => e.type === 'WOUND_PLACED' && e.enemyInstanceId === enemy.instanceId,
    );
    expect(wounds.length).toBeGreaterThan(0);
    // Si el veneno lo mata, se emite ENEMY_DEFEATED antes de su ataque
    const refreshed = res.state.battlefield.find(e => e.instanceId === enemy.instanceId);
    if (!refreshed) {
      expect(res.events.some(e => e.type === 'ENEMY_DEFEATED' && e.enemyInstanceId === enemy.instanceId)).toBe(true);
    }
  });
});
