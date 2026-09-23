/**
 * Nivel 2: Pruebas unitarias por efecto.
 *
 * Verifica los handlers de efectos individuales del EffectRegistry:
 * - evalValue (CONSTANT, COUNT_LIVING_ENEMIES, SUM, MULTIPLY, FLOOR_DIV)
 * - evalCondition (HAS_CAPABILITY, ENEMY_FORTITUDE_GTE, NOT, AND, OR)
 * - resolveTarget (SELECTED_ENEMY, ENEMY_WITH_MAX_FORTITUDE, ENEMY_WITH_FEWEST_WOUNDS)
 * - resolveHeroTargets (SELF, ALL_OTHERS, HERO_WITH_FEWEST_WOUNDS)
 * - applyHeroDamage (perdida de cartas, reciclaje, herida)
 * - Handlers clave: DEAL_DAMAGE, DRAW_CARDS, GAIN_COINS, GAIN_GLORY, HEAL_WOUNDS
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EffectRegistry,
  registerCoreEffects,
  evalValue,
  evalCondition,
  resolveTarget,
  resolveHeroTargets,
  applyHeroDamage,
} from '../../src/effects/registry.js';
import { EventBus } from '../../src/triggers/index.js';
import { DeterministicRng } from '../../src/rng/index.js';
import {
  makeEnemy, makePlayer, makeGameState, makeCards, resetTestCounters,
} from '../fixtures/builders.js';
import type { ResolutionContext } from '@nt4h/schema';

function makeCtx(overrides: Partial<ResolutionContext> = {}): ResolutionContext {
  return {
    activePlayerId: overrides.activePlayerId ?? 'p1',
    currentCardId: overrides.currentCardId ?? 'test-card',
    currentCardName: overrides.currentCardName ?? 'Test Card',
    currentCardInstanceId: overrides.currentCardInstanceId ?? 'test-instance',
    selectedEnemyId: overrides.selectedEnemyId ?? null,
    cardsPlayedThisTurn: overrides.cardsPlayedThisTurn ?? {},
    cardsPlayedAgainstEnemy: overrides.cardsPlayedAgainstEnemy ?? {},
    drawnCardInstanceId: overrides.drawnCardInstanceId ?? null,
    sourceZone: overrides.sourceZone ?? 'HAND',
    enemiesDefeatedThisResolution: overrides.enemiesDefeatedThisResolution ?? [],
    depth: overrides.depth ?? 0,
    chosenHeroTarget: overrides.chosenHeroTarget ?? null,
    chosenEnemyTarget: overrides.chosenEnemyTarget ?? null,
  };
}

describe('Nivel 2 - evalValue (evaluador de expresiones)', () => {
  it('CONSTANT devuelve el valor literal', () => {
    const ctx = makeCtx();
    const state = makeGameState();
    expect(evalValue({ kind: 'CONSTANT', value: 5 }, ctx, state)).toBe(5);
    expect(evalValue({ kind: 'CONSTANT', value: 0 }, ctx, state)).toBe(0);
    expect(evalValue({ kind: 'CONSTANT', value: -3 }, ctx, state)).toBe(-3);
  });

  it('COUNT_LIVING_ENEMIES cuenta enemigos en battlefield', () => {
    const ctx = makeCtx();
    const state = makeGameState({ battlefield: makeEnemies(3) });
    expect(evalValue({ kind: 'COUNT_LIVING_ENEMIES' }, ctx, state)).toBe(3);
  });

  it('COUNT_LIVING_ENEMIES con battlefield vacio = 0', () => {
    const ctx = makeCtx();
    const state = makeGameState({ battlefield: [] });
    expect(evalValue({ kind: 'COUNT_LIVING_ENEMIES' }, ctx, state)).toBe(0);
  });

  it('COUNT_ENEMIES_IN_FIELD = COUNT_LIVING_ENEMIES', () => {
    const ctx = makeCtx();
    const state = makeGameState({ battlefield: makeEnemies(5) });
    expect(evalValue({ kind: 'COUNT_ENEMIES_IN_FIELD' }, ctx, state)).toBe(5);
  });

  it('SUM suma sub-expresiones', () => {
    const ctx = makeCtx();
    const state = makeGameState({ battlefield: makeEnemies(2) });
    const expr = {
      kind: 'SUM' as const,
      of: [
        { kind: 'CONSTANT' as const, value: 3 },
        { kind: 'COUNT_LIVING_ENEMIES' as const },
        { kind: 'CONSTANT' as const, value: 1 },
      ],
    };
    expect(evalValue(expr, ctx, state)).toBe(6); // 3 + 2 + 1
  });

  it('MULTIPLY multiplica sub-expresiones', () => {
    const ctx = makeCtx();
    const state = makeGameState({ battlefield: makeEnemies(3) });
    const expr = {
      kind: 'MULTIPLY' as const,
      factors: [
        { kind: 'CONSTANT' as const, value: 2 },
        { kind: 'COUNT_LIVING_ENEMIES' as const },
      ],
    };
    expect(evalValue(expr, ctx, state)).toBe(6); // 2 * 3
  });

  it('FLOOR_DIV divide y redondea hacia abajo', () => {
    const ctx = makeCtx();
    const state = makeGameState({ battlefield: makeEnemies(7) });
    const expr = {
      kind: 'FLOOR_DIV' as const,
      numerator: { kind: 'COUNT_LIVING_ENEMIES' as const },
      denominator: 3,
    };
    expect(evalValue(expr, ctx, state)).toBe(2); // floor(7/3) = 2
  });

  it('FORTITUDE_OF devuelve la fortaleza del enemigo seleccionado', () => {
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 5 });
    const state = makeGameState({ battlefield: [enemy] });
    const ctx = makeCtx({ selectedEnemyId: 'e1' });
    expect(evalValue({ kind: 'FORTITUDE_OF', target: { kind: 'SELECTED_ENEMY' } }, ctx, state)).toBe(5);
  });

  it('FORTITUDE_OF devuelve 0 si no hay enemigo seleccionado', () => {
    const state = makeGameState();
    const ctx = makeCtx({ selectedEnemyId: null });
    expect(evalValue({ kind: 'FORTITUDE_OF', target: { kind: 'SELECTED_ENEMY' } }, ctx, state)).toBe(0);
  });
});

describe('Nivel 2 - evalCondition (evaluador de condiciones)', () => {
  it('HAS_CAPABILITY true si el jugador tiene el icono', () => {
    const player = makePlayer({ playerId: 'p1', capabilities: ['RANGED', 'EXPERTISE'] });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    expect(evalCondition({ kind: 'HAS_CAPABILITY', icon: 'RANGED' }, ctx, state)).toBe(true);
  });

  it('HAS_CAPABILITY false si el jugador no tiene el icono', () => {
    const player = makePlayer({ playerId: 'p1', capabilities: ['RANGED'] });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    expect(evalCondition({ kind: 'HAS_CAPABILITY', icon: 'MELEE' }, ctx, state)).toBe(false);
  });

  it('ENEMY_FORTITUDE_GTE true si fortaleza >= valor', () => {
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 5 });
    const state = makeGameState({ battlefield: [enemy] });
    const ctx = makeCtx({ selectedEnemyId: 'e1' });
    expect(evalCondition({ kind: 'ENEMY_FORTITUDE_GTE', value: 5 }, ctx, state)).toBe(true);
    expect(evalCondition({ kind: 'ENEMY_FORTITUDE_GTE', value: 4 }, ctx, state)).toBe(true);
  });

  it('ENEMY_FORTITUDE_GTE false si fortaleza < valor', () => {
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 3 });
    const state = makeGameState({ battlefield: [enemy] });
    const ctx = makeCtx({ selectedEnemyId: 'e1' });
    expect(evalCondition({ kind: 'ENEMY_FORTITUDE_GTE', value: 4 }, ctx, state)).toBe(false);
  });

  it('ENEMY_FORTITUDE_GTE false si no hay enemigo seleccionado', () => {
    const state = makeGameState();
    const ctx = makeCtx({ selectedEnemyId: null });
    expect(evalCondition({ kind: 'ENEMY_FORTITUDE_GTE', value: 1 }, ctx, state)).toBe(false);
  });

  it('FIRST_CARD_OF_NAME_THIS_TURN true si no se ha jugado esa carta', () => {
    const ctx = makeCtx({ cardsPlayedThisTurn: {} });
    const state = makeGameState();
    expect(evalCondition({ kind: 'FIRST_CARD_OF_NAME_THIS_TURN', name: 'Espadazo' }, ctx, state)).toBe(true);
  });

  it('FIRST_CARD_OF_NAME_THIS_TURN false si ya se jugo esa carta', () => {
    const ctx = makeCtx({ cardsPlayedThisTurn: { 'Espadazo': 1 } });
    const state = makeGameState();
    expect(evalCondition({ kind: 'FIRST_CARD_OF_NAME_THIS_TURN', name: 'Espadazo' }, ctx, state)).toBe(false);
  });

  it('ALREADY_USED_AGAINST_THIS_ENEMY true si ya se uso contra ese enemigo', () => {
    const ctx = makeCtx({
      selectedEnemyId: 'e1',
      cardsPlayedAgainstEnemy: { 'e1': { 'Espadazo': 1 } },
    });
    const state = makeGameState();
    expect(evalCondition({ kind: 'ALREADY_USED_AGAINST_THIS_ENEMY', name: 'Espadazo' }, ctx, state)).toBe(true);
  });

  it('ALREADY_USED_AGAINST_THIS_ENEMY false si no se ha usado', () => {
    const ctx = makeCtx({
      selectedEnemyId: 'e1',
      cardsPlayedAgainstEnemy: { 'e1': {} },
    });
    const state = makeGameState();
    expect(evalCondition({ kind: 'ALREADY_USED_AGAINST_THIS_ENEMY', name: 'Espadazo' }, ctx, state)).toBe(false);
  });

  it('ENEMY_DEFEATED_BY_THIS_CARD true si el enemigo esta en la lista de derrotados', () => {
    const ctx = makeCtx({ selectedEnemyId: 'e1', enemiesDefeatedThisResolution: ['e1'] });
    const state = makeGameState();
    expect(evalCondition({ kind: 'ENEMY_DEFEATED_BY_THIS_CARD' }, ctx, state)).toBe(true);
  });

  it('ENEMY_DEFEATED_BY_THIS_CARD false si no esta derrotado', () => {
    const ctx = makeCtx({ selectedEnemyId: 'e1', enemiesDefeatedThisResolution: [] });
    const state = makeGameState();
    expect(evalCondition({ kind: 'ENEMY_DEFEATED_BY_THIS_CARD' }, ctx, state)).toBe(false);
  });

  it('NOT niega la condicion interna', () => {
    const player = makePlayer({ playerId: 'p1', capabilities: ['RANGED'] });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    expect(evalCondition({ kind: 'NOT', condition: { kind: 'HAS_CAPABILITY', icon: 'MELEE' } }, ctx, state)).toBe(true);
    expect(evalCondition({ kind: 'NOT', condition: { kind: 'HAS_CAPABILITY', icon: 'RANGED' } }, ctx, state)).toBe(false);
  });

  it('AND es true solo si todas las condiciones son true', () => {
    const player = makePlayer({ playerId: 'p1', capabilities: ['RANGED', 'EXPERTISE'] });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    const all = {
      kind: 'AND' as const,
      conditions: [
        { kind: 'HAS_CAPABILITY' as const, icon: 'RANGED' as const },
        { kind: 'HAS_CAPABILITY' as const, icon: 'EXPERTISE' as const },
      ],
    };
    expect(evalCondition(all, ctx, state)).toBe(true);

    const partial = {
      kind: 'AND' as const,
      conditions: [
        { kind: 'HAS_CAPABILITY' as const, icon: 'RANGED' as const },
        { kind: 'HAS_CAPABILITY' as const, icon: 'MELEE' as const },
      ],
    };
    expect(evalCondition(partial, ctx, state)).toBe(false);
  });

  it('OR es true si al menos una condicion es true', () => {
    const player = makePlayer({ playerId: 'p1', capabilities: ['RANGED'] });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    const any = {
      kind: 'OR' as const,
      conditions: [
        { kind: 'HAS_CAPABILITY' as const, icon: 'MELEE' as const },
        { kind: 'HAS_CAPABILITY' as const, icon: 'RANGED' as const },
      ],
    };
    expect(evalCondition(any, ctx, state)).toBe(true);

    const none = {
      kind: 'OR' as const,
      conditions: [
        { kind: 'HAS_CAPABILITY' as const, icon: 'MELEE' as const },
        { kind: 'HAS_CAPABILITY' as const, icon: 'MAGIC' as const },
      ],
    };
    expect(evalCondition(none, ctx, state)).toBe(false);
  });
});

describe('Nivel 2 - resolveTarget (selectores de enemigo)', () => {
  it('SELECTED_ENEMY devuelve el enemigo seleccionado', () => {
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 3 });
    const state = makeGameState({ battlefield: [enemy] });
    const ctx = makeCtx({ selectedEnemyId: 'e1' });
    expect(resolveTarget({ kind: 'SELECTED_ENEMY' }, ctx, state)).toBe('e1');
  });

  it('SELECTED_ENEMY devuelve null si no hay seleccion', () => {
    const state = makeGameState();
    const ctx = makeCtx({ selectedEnemyId: null });
    expect(resolveTarget({ kind: 'SELECTED_ENEMY' }, ctx, state)).toBe(null);
  });

  it('ONE_ENEMY con filter.minFortitude filtra enemigos debiles', () => {
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 2 });
    const state = makeGameState({ battlefield: [enemy] });
    const ctx = makeCtx({ selectedEnemyId: 'e1' });
    expect(resolveTarget({ kind: 'ONE_ENEMY', filter: { minFortitude: 3 } }, ctx, state)).toBe(null);
  });

  it('ONE_ENEMY con filter.minFortitude permite enemigos fuertes', () => {
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 5 });
    const state = makeGameState({ battlefield: [enemy] });
    const ctx = makeCtx({ selectedEnemyId: 'e1' });
    expect(resolveTarget({ kind: 'ONE_ENEMY', filter: { minFortitude: 3 } }, ctx, state)).toBe('e1');
  });

  it('ONE_ENEMY con filter.isOrc filtra por tipo orco', () => {
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 3, isOrc: false });
    const state = makeGameState({ battlefield: [enemy] });
    const ctx = makeCtx({ selectedEnemyId: 'e1' });
    expect(resolveTarget({ kind: 'ONE_ENEMY', filter: { isOrc: true } }, ctx, state)).toBe(null);
  });

  it('ONE_ENEMY con filter.isWarlord filtra por warlord', () => {
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 8, isWarlord: true });
    const state = makeGameState({ battlefield: [enemy] });
    const ctx = makeCtx({ selectedEnemyId: 'e1' });
    expect(resolveTarget({ kind: 'ONE_ENEMY', filter: { isWarlord: true } }, ctx, state)).toBe('e1');
  });

  it('ENEMY_WITH_MAX_FORTITUDE selecciona el de mayor fortaleza', () => {
    const e1 = makeEnemy({ instanceId: 'e1', baseFortitude: 3 });
    const e2 = makeEnemy({ instanceId: 'e2', baseFortitude: 5 });
    const e3 = makeEnemy({ instanceId: 'e3', baseFortitude: 2 });
    const state = makeGameState({ battlefield: [e1, e2, e3] });
    const ctx = makeCtx();
    expect(resolveTarget({ kind: 'ENEMY_WITH_MAX_FORTITUDE' }, ctx, state)).toBe('e2');
  });

  it('ENEMY_WITH_MAX_FORTITUDE devuelve null con battlefield vacio', () => {
    const state = makeGameState({ battlefield: [] });
    const ctx = makeCtx();
    expect(resolveTarget({ kind: 'ENEMY_WITH_MAX_FORTITUDE' }, ctx, state)).toBe(null);
  });

  it('ENEMY_WITH_MAX_FORTITUDE respeta chosenEnemyTarget', () => {
    const e1 = makeEnemy({ instanceId: 'e1', baseFortitude: 3 });
    const e2 = makeEnemy({ instanceId: 'e2', baseFortitude: 5 });
    const state = makeGameState({ battlefield: [e1, e2] });
    const ctx = makeCtx({ chosenEnemyTarget: 'e1' });
    expect(resolveTarget({ kind: 'ENEMY_WITH_MAX_FORTITUDE' }, ctx, state)).toBe('e1');
  });

  it('ENEMY_WITH_FEWEST_WOUNDS selecciona el de menos heridas', () => {
    const e1 = makeEnemy({ instanceId: 'e1', baseFortitude: 3, wounds: 2 });
    const e2 = makeEnemy({ instanceId: 'e2', baseFortitude: 3, wounds: 0 });
    const e3 = makeEnemy({ instanceId: 'e3', baseFortitude: 3, wounds: 1 });
    const state = makeGameState({ battlefield: [e1, e2, e3] });
    const ctx = makeCtx();
    expect(resolveTarget({ kind: 'ENEMY_WITH_FEWEST_WOUNDS' }, ctx, state)).toBe('e2');
  });
});

describe('Nivel 2 - resolveHeroTargets (selectores de heroe)', () => {
  it('SELF devuelve solo el jugador activo', () => {
    const p1 = makePlayer({ playerId: 'p1' });
    const p2 = makePlayer({ playerId: 'p2' });
    const state = makeGameState({ players: { p1, p2 }, playerOrder: ['p1', 'p2'] });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    expect(resolveHeroTargets({ kind: 'SELF' }, ctx, state)).toEqual(['p1']);
  });

  it('ALL_OTHERS excluye al jugador activo', () => {
    const p1 = makePlayer({ playerId: 'p1' });
    const p2 = makePlayer({ playerId: 'p2' });
    const p3 = makePlayer({ playerId: 'p3' });
    const state = makeGameState({ players: { p1, p2, p3 }, playerOrder: ['p1', 'p2', 'p3'] });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    expect(resolveHeroTargets({ kind: 'ALL_OTHERS' }, ctx, state)).toEqual(['p2', 'p3']);
  });

  it('EACH_OTHER = ALL_OTHERS', () => {
    const p1 = makePlayer({ playerId: 'p1' });
    const p2 = makePlayer({ playerId: 'p2' });
    const state = makeGameState({ players: { p1, p2 }, playerOrder: ['p1', 'p2'] });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    expect(resolveHeroTargets({ kind: 'EACH_OTHER' }, ctx, state)).toEqual(['p2']);
  });

  it('HERO_WITH_FEWEST_WOUNDS selecciona al de menos heridas', () => {
    const p1 = makePlayer({ playerId: 'p1', wounds: 2 });
    const p2 = makePlayer({ playerId: 'p2', wounds: 0 });
    const p3 = makePlayer({ playerId: 'p3', wounds: 3 });
    const state = makeGameState({ players: { p1, p2, p3 }, playerOrder: ['p1', 'p2', 'p3'] });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    expect(resolveHeroTargets({ kind: 'HERO_WITH_FEWEST_WOUNDS' }, ctx, state)).toEqual(['p2']);
  });

  it('HERO_WITH_FEWEST_WOUNDS en empate prefiere al jugador activo', () => {
    const p1 = makePlayer({ playerId: 'p1', wounds: 1 });
    const p2 = makePlayer({ playerId: 'p2', wounds: 1 });
    const state = makeGameState({ players: { p1, p2 }, playerOrder: ['p1', 'p2'] });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    expect(resolveHeroTargets({ kind: 'HERO_WITH_FEWEST_WOUNDS' }, ctx, state)).toEqual(['p1']);
  });

  it('HERO_WITH_FEWEST_WOUNDS respeta chosenHeroTarget', () => {
    const p1 = makePlayer({ playerId: 'p1', wounds: 1 });
    const p2 = makePlayer({ playerId: 'p2', wounds: 1 });
    const state = makeGameState({ players: { p1, p2 }, playerOrder: ['p1', 'p2'] });
    const ctx = makeCtx({ activePlayerId: 'p1', chosenHeroTarget: 'p2' });
    expect(resolveHeroTargets({ kind: 'HERO_WITH_FEWEST_WOUNDS' }, ctx, state)).toEqual(['p2']);
  });

  it('OTHER_HERO excluye al jugador activo', () => {
    const p1 = makePlayer({ playerId: 'p1' });
    const p2 = makePlayer({ playerId: 'p2' });
    const state = makeGameState({ players: { p1, p2 }, playerOrder: ['p1', 'p2'] });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    expect(resolveHeroTargets({ kind: 'OTHER_HERO' }, ctx, state)).toEqual(['p2']);
  });
});

describe('Nivel 2 - applyHeroDamage (dano a heroes)', () => {
  let rng: DeterministicRng;
  let seqCounter: number;

  beforeEach(() => {
    resetTestCounters();
    rng = new DeterministicRng('hero-damage-test');
    seqCounter = 0;
  });

  function nextSeq() { return ++seqCounter; }

  it('dano causa perdida de cartas del abilityDeck', () => {
    const player = makePlayer({
      playerId: 'p1',
      abilityDeck: makeCards(5),
      hand: [],
      wearPile: [],
    });
    const state = makeGameState({ players: { p1: player } });
    const events = applyHeroDamage('p1', 3, state, rng, nextSeq);
    // Debe haber evento CARDS_LOST
    expect(events.some(e => e.type === 'CARDS_LOST')).toBe(true);
  });

  it('dano mayor que abilityDeck causa herida y recicla wearPile', () => {
    const player = makePlayer({
      playerId: 'p1',
      abilityDeck: makeCards(2),
      wearPile: makeCards(5),
      hand: [],
    });
    const state = makeGameState({ players: { p1: player } });
    const events = applyHeroDamage('p1', 4, state, rng, nextSeq);
    // Al agotar el deck: herida + reshuffle del wearPile
    expect(events.some(e => e.type === 'HERO_WOUNDED')).toBe(true);
    expect(events.some(e => e.type === 'DECK_RESHUFFLED')).toBe(true);
  });

  it('dano que agota deck y wearPile causa herida', () => {
    const player = makePlayer({
      playerId: 'p1',
      abilityDeck: makeCards(2),
      wearPile: [],
      hand: [],
      wounds: 1,
    });
    const state = makeGameState({ players: { p1: player } });
    const events = applyHeroDamage('p1', 5, state, rng, nextSeq);
    expect(events.some(e => e.type === 'HERO_WOUNDED')).toBe(true);
  });

  it('dano 0 no causa perdida ni herida', () => {
    const player = makePlayer({
      playerId: 'p1',
      abilityDeck: makeCards(3),
      wounds: 0,
    });
    const state = makeGameState({ players: { p1: player } });
    const events = applyHeroDamage('p1', 0, state, rng, nextSeq);
    expect(events.some(e => e.type === 'CARDS_LOST')).toBe(false);
    expect(events.some(e => e.type === 'HERO_WOUNDED')).toBe(false);
  });
});

describe('Nivel 2 - Handlers de efectos clave', () => {
  let registry: EffectRegistry;
  let rng: DeterministicRng;
  let bus: EventBus;

  beforeEach(() => {
    resetTestCounters();
    registry = new EffectRegistry();
    registerCoreEffects(registry);
    rng = new DeterministicRng('effect-test');
    bus = new EventBus(registry, rng);
  });

  it('GAIN_COINS emite evento COINS_GAINED', () => {
    const player = makePlayer({ playerId: 'p1', coins: 5 });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    bus.setState(state);
    const events = registry.execute(
      { type: 'GAIN_COINS', amount: { kind: 'CONSTANT', value: 3 } } as any,
      ctx, state, rng, bus,
    );
    expect(events.some(e => e.type === 'COINS_GAINED')).toBe(true);
  });

  it('GAIN_GLORY emite evento GLORY_GAINED', () => {
    const player = makePlayer({ playerId: 'p1', glory: 0 });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    bus.setState(state);
    const events = registry.execute(
      { type: 'GAIN_GLORY', amount: { kind: 'CONSTANT', value: 2 } } as any,
      ctx, state, rng, bus,
    );
    expect(events.some(e => e.type === 'GLORY_GAINED')).toBe(true);
  });

  it('HEAL_WOUNDS emite evento WOUND_HEALED', () => {
    const player = makePlayer({ playerId: 'p1', wounds: 3 });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    bus.setState(state);
    const events = registry.execute(
      { type: 'HEAL_WOUNDS', amount: { kind: 'CONSTANT', value: 2 } } as any,
      ctx, state, rng, bus,
    );
    expect(events.some(e => e.type === 'WOUND_HEALED')).toBe(true);
  });

  it('SHIELD emite evento SHIELD_PLACED', () => {
    const player = makePlayer({ playerId: 'p1', shields: 0 });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    bus.setState(state);
    const events = registry.execute(
      { type: 'SHIELD', amount: { kind: 'CONSTANT', value: 2 } } as any,
      ctx, state, rng, bus,
    );
    expect(events.some(e => e.type === 'SHIELD_PLACED')).toBe(true);
  });

  it('END_ATTACK no emite eventos (sennal para el motor de fases)', () => {
    const state = makeGameState();
    const ctx = makeCtx();
    bus.setState(state);
    const events = registry.execute(
      { type: 'END_ATTACK' } as any,
      ctx, state, rng, bus,
    );
    expect(events).toEqual([]);
  });

  it('DEAL_DAMAGE emite evento DAMAGE_DEALT', () => {
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 5 });
    const state = makeGameState({ battlefield: [enemy] });
    const ctx = makeCtx({ selectedEnemyId: 'e1' });
    bus.setState(state);
    const events = registry.execute(
      {
        type: 'DEAL_DAMAGE',
        amount: { kind: 'CONSTANT', value: 3 },
        target: { kind: 'SELECTED_ENEMY' },
      } as any,
      ctx, state, rng, bus,
    );
    expect(events.some(e => e.type === 'DAMAGE_DEALT')).toBe(true);
  });

  it('DRAW_CARDS emite evento CARDS_DRAWN', () => {
    const player = makePlayer({
      playerId: 'p1',
      abilityDeck: makeCards(5),
      hand: [],
    });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    bus.setState(state);
    const events = registry.execute(
      { type: 'DRAW_CARDS', amount: { kind: 'CONSTANT', value: 2 } } as any,
      ctx, state, rng, bus,
    );
    expect(events.some(e => e.type === 'CARDS_DRAWN')).toBe(true);
  });

  it('PREVENT_DAMAGE emite evento PREVENTION_GAINED', () => {
    const player = makePlayer({ playerId: 'p1', prevention: 0 });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    bus.setState(state);
    const events = registry.execute(
      { type: 'PREVENT_DAMAGE', amount: { kind: 'CONSTANT', value: 3 } } as any,
      ctx, state, rng, bus,
    );
    expect(events.some(e => e.type === 'PREVENTION_APPLIED')).toBe(true);
  });

  it('DEAL_DAMAGE_ALL_ENEMIES daña a todos los enemigos', () => {
    const enemies = [
      makeEnemy({ instanceId: 'e1', baseFortitude: 5 }),
      makeEnemy({ instanceId: 'e2', baseFortitude: 3 }),
      makeEnemy({ instanceId: 'e3', baseFortitude: 4 }),
    ];
    const state = makeGameState({ battlefield: enemies });
    const ctx = makeCtx();
    bus.setState(state);
    const events = registry.execute(
      {
        type: 'DEAL_DAMAGE_ALL_ENEMIES',
        amount: { kind: 'CONSTANT', value: 2 },
      } as any,
      ctx, state, rng, bus,
    );
    const dmgEvents = events.filter(e => e.type === 'DAMAGE_DEALT');
    expect(dmgEvents.length).toBe(3); // un evento por cada enemigo
  });

  it('CONDITIONAL ejecuta then si la condicion es true', () => {
    const player = makePlayer({ playerId: 'p1', capabilities: ['RANGED'] });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    bus.setState(state);
    const events = registry.execute(
      {
        type: 'CONDITIONAL',
        condition: { kind: 'HAS_CAPABILITY', icon: 'RANGED' },
        then: [{ type: 'GAIN_COINS', amount: { kind: 'CONSTANT', value: 1 } }],
        else: [{ type: 'LOSE_CARDS', amount: { kind: 'CONSTANT', value: 1 } }],
      } as any,
      ctx, state, rng, bus,
    );
    expect(events.some(e => e.type === 'COINS_GAINED')).toBe(true);
    expect(events.some(e => e.type === 'CARDS_LOST')).toBe(false);
  });

  it('CONDITIONAL ejecuta else si la condicion es false', () => {
    const player = makePlayer({ playerId: 'p1', capabilities: ['RANGED'] });
    const state = makeGameState({ players: { p1: player } });
    const ctx = makeCtx({ activePlayerId: 'p1' });
    bus.setState(state);
    const events = registry.execute(
      {
        type: 'CONDITIONAL',
        condition: { kind: 'HAS_CAPABILITY', icon: 'MAGIC' },
        then: [{ type: 'GAIN_COINS', amount: { kind: 'CONSTANT', value: 1 } }],
        else: [{ type: 'GAIN_GLORY', amount: { kind: 'CONSTANT', value: 1 } }],
      } as any,
      ctx, state, rng, bus,
    );
    expect(events.some(e => e.type === 'GLORY_GAINED')).toBe(true);
    expect(events.some(e => e.type === 'COINS_GAINED')).toBe(false);
  });
});

// Helper para crear enemiigos en bulk
function makeEnemies(n: number) {
  return Array.from({ length: n }, (_, i) => makeEnemy({ instanceId: `e${i + 1}`, baseFortitude: 3 }));
}
