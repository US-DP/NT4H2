import { describe, it, expect } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { applyEvent, replayEvents } from '../src/events/applyEvent.js';
import { EffectRegistry, registerCoreEffects, evalValue, evalCondition } from '../src/effects/registry.js';
import { createInitialState } from '../src/state/initialState.js';
import { isLegal } from '../src/commands/execute.js';
import { EventBus } from '../src/triggers/index.js';
import type { GameState, GameEvent, GameConfig } from '@nt4h/schema';

describe('DeterministicRng', () => {
  it('misma semilla produce misma secuencia', () => {
    const rng1 = new DeterministicRng('test-seed-1');
    const rng2 = new DeterministicRng('test-seed-1');
    const seq1 = Array.from({ length: 10 }, () => rng1.nextInt(0, 100));
    const seq2 = Array.from({ length: 10 }, () => rng2.nextInt(0, 100));
    expect(seq1).toEqual(seq2);
  });

  it('semillas diferentes producen secuencias diferentes', () => {
    const rng1 = new DeterministicRng('seed-a');
    const rng2 = new DeterministicRng('seed-b');
    const seq1 = Array.from({ length: 10 }, () => rng1.nextInt(0, 100));
    const seq2 = Array.from({ length: 10 }, () => rng2.nextInt(0, 100));
    expect(seq1).not.toEqual(seq2);
  });

  it('nextInt respeta min y max', () => {
    const rng = new DeterministicRng('bounds-test');
    for (let i = 0; i < 100; i++) {
      const n = rng.nextInt(5, 10);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(10);
    }
  });

  it('shuffle no pierde elementos', () => {
    const rng = new DeterministicRng('shuffle-test');
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = rng.shuffle(arr);
    expect(shuffled.sort((a, b) => a - b)).toEqual(arr);
  });

  it('shuffle es determinista', () => {
    const rng1 = new DeterministicRng('shuffle-det');
    const rng2 = new DeterministicRng('shuffle-det');
    const arr = [1, 2, 3, 4, 5];
    expect(rng1.shuffle(arr)).toEqual(rng2.shuffle(arr));
  });

  it('serialize y deserialize preserva estado', () => {
    const rng = new DeterministicRng('serialize-test');
    rng.nextInt(0, 100);
    rng.nextInt(0, 100);
    const serialized = rng.serialize();
    const restored = DeterministicRng.deserialize(serialized);
    expect(restored.nextInt(0, 100)).toBe(rng.nextInt(0, 100));
  });
});

describe('applyEvent', () => {
  function makeState(): GameState {
    const config: GameConfig = {
      mode: 'STANDARD',
      playerCount: 2,
      seed: 'test',
      heroes: [
        { playerId: 'p1', heroId: 'aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: false,
    };
    return createInitialState(config);
  }

  it('GLORY_GAINED incrementa gloria', () => {
    const state = makeState();
    const event: GameEvent = {
      type: 'GLORY_GAINED',
      playerId: 'p1',
      amount: 3,
      seq: 1,
    };
    const newState = applyEvent(state, event);
    expect(newState.players.p1.glory).toBe(3);
  });

  it('COINS_GAINED incrementa monedas', () => {
    const state = makeState();
    const event: GameEvent = {
      type: 'COINS_GAINED',
      playerId: 'p1',
      amount: 5,
      seq: 1,
    };
    const newState = applyEvent(state, event);
    expect(newState.players.p1.coins).toBe(5);
  });

  it('WOUND_HEALED reduce heridas', () => {
    const state = makeState();
    // Primero herir
    let s = applyEvent(state, { type: 'HERO_WOUNDED', playerId: 'p1', woundCount: 2, seq: 1 });
    expect(s.players.p1.wounds).toBe(2);
    // Luego curar
    s = applyEvent(s, { type: 'WOUND_HEALED', playerId: 'p1', amount: 1, seq: 2 });
    expect(s.players.p1.wounds).toBe(1);
  });

  it('PHASE_CHANGED cambia la fase', () => {
    const state = makeState();
    const newState = applyEvent(state, { type: 'PHASE_CHANGED', phase: 'MARKET', seq: 1 });
    expect(newState.phase).toBe('MARKET');
  });

  it('TURN_STARTED resetea contadores del turno', () => {
    const state = makeState();
    // Anadir una carta a la mano del jugador p1 manualmente
    let s: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          hand: [{ instanceId: 'c1', definitionId: 'warrior.espadazo', ownerId: 'p1', zone: 'HAND' }],
        },
      },
    };
    // Simular que se jugo una carta
    s = applyEvent(s, {
      type: 'CARD_PLAYED',
      playerId: 'p1',
      cardInstanceId: 'c1',
      cardDefinitionId: 'warrior.espadazo',
      seq: 1,
    });
    expect(s.players.p1.cardsPlayedThisTurn['warrior.espadazo']).toBe(1);

    // Nuevo turno
    s = applyEvent(s, { type: 'TURN_STARTED', playerId: 'p2', turnNumber: 2, seq: 2 });
    expect(s.players.p2.cardsPlayedThisTurn).toEqual({});
    expect(s.activePlayerId).toBe('p2');
    expect(s.turnNumber).toBe(2);
  });

  it('replayEvents reproduce el mismo estado', () => {
    const state = makeState();
    const events: GameEvent[] = [
      { type: 'GLORY_GAINED', playerId: 'p1', amount: 2, seq: 1 },
      { type: 'COINS_GAINED', playerId: 'p1', amount: 5, seq: 2 },
      { type: 'GLORY_GAINED', playerId: 'p2', amount: 1, seq: 3 },
      { type: 'PHASE_CHANGED', phase: 'MARKET', seq: 4 },
    ];
    const finalState = replayEvents(state, events);
    expect(finalState.players.p1.glory).toBe(2);
    expect(finalState.players.p1.coins).toBe(5);
    expect(finalState.players.p2.glory).toBe(1);
    expect(finalState.phase).toBe('MARKET');
  });
});

describe('EffectRegistry', () => {
  it('registra y ejecuta efectos', () => {
    const registry = new EffectRegistry();
    registerCoreEffects(registry);

    const state = createInitialState({
      mode: 'STANDARD',
      playerCount: 2,
      seed: 'test',
      heroes: [
        { playerId: 'p1', heroId: 'aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: false,
    });

    const ctx = {
      activePlayerId: 'p1',
      currentCardId: 'test',
      currentCardName: 'test',
      currentCardInstanceId: 'c1',
      selectedEnemyId: null,
      cardsPlayedThisTurn: {},
      cardsPlayedAgainstEnemy: {},
      drawnCardInstanceId: null,
      sourceZone: 'HAND' as const,
      enemiesDefeatedThisResolution: [],
      depth: 0,
    };

    const rng = new DeterministicRng('test');
    const bus = new EventBus(registry, rng);

    const events = registry.execute(
      { type: 'GAIN_GLORY', amount: { kind: 'CONSTANT', value: 3 } },
      ctx,
      state,
      rng,
      bus,
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('GLORY_GAINED');
  });

  it('evalValue evalua CONSTANT', () => {
    void new EffectRegistry();
    const ctx = {
      activePlayerId: 'p1',
      currentCardId: 'test',
      currentCardName: 'test',
      currentCardInstanceId: 'c1',
      selectedEnemyId: null,
      cardsPlayedThisTurn: {},
      cardsPlayedAgainstEnemy: {},
      drawnCardInstanceId: null,
      sourceZone: 'HAND' as const,
      enemiesDefeatedThisResolution: [],
      depth: 0,
    };
    const state = createInitialState({
      mode: 'STANDARD',
      playerCount: 1,
      seed: 'test',
      heroes: [{ playerId: 'p1', heroId: 'aranel', heroFace: 'FEMALE', deckId: 'explorer.default' }],
      useScenarios: false,
    });

    expect(evalValue({ kind: 'CONSTANT', value: 5 }, ctx, state)).toBe(5);
    expect(evalValue({ kind: 'SUM', of: [{ kind: 'CONSTANT', value: 2 }, { kind: 'CONSTANT', value: 3 }] }, ctx, state)).toBe(5);
    expect(evalValue({ kind: 'FLOOR_DIV', numerator: { kind: 'CONSTANT', value: 7 }, denominator: 2 }, ctx, state)).toBe(3);
  });

  it('evalCondition evalua FIRST_CARD_OF_NAME_THIS_TURN', () => {
    void new EffectRegistry();
    const ctx = {
      activePlayerId: 'p1',
      currentCardId: 'test',
      currentCardName: 'test',
      currentCardInstanceId: 'c1',
      selectedEnemyId: null,
      cardsPlayedThisTurn: { 'Espadazo': 1 },
      cardsPlayedAgainstEnemy: {},
      drawnCardInstanceId: null,
      sourceZone: 'HAND' as const,
      enemiesDefeatedThisResolution: [],
      depth: 0,
    };
    const state = createInitialState({
      mode: 'STANDARD',
      playerCount: 1,
      seed: 'test',
      heroes: [{ playerId: 'p1', heroId: 'aranel', heroFace: 'FEMALE', deckId: 'explorer.default' }],
      useScenarios: false,
    });

    expect(evalCondition({ kind: 'FIRST_CARD_OF_NAME_THIS_TURN', name: 'Espadazo' }, ctx, state)).toBe(false);
    expect(evalCondition({ kind: 'FIRST_CARD_OF_NAME_THIS_TURN', name: 'Disparo' }, ctx, state)).toBe(true);
  });
});

describe('isLegal', () => {
  function makeState(): GameState {
    return createInitialState({
      mode: 'STANDARD',
      playerCount: 2,
      seed: 'test',
      heroes: [
        { playerId: 'p1', heroId: 'aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: false,
    });
  }

  it('rechaza PLAY_CARD fuera de fase de ataque', () => {
    const state = makeState();
    const result = isLegal(state, 'p1', { type: 'PLAY_CARD', cid: 'c1', cardInstanceId: 'x' });
    expect(result.ok).toBe(false);
  });

  it('rechaza PLAY_CARD de otro jugador', () => {
    const state = { ...makeState(), phase: 'PLAYER_ATTACK' as const, activePlayerId: 'p1' };
    const result = isLegal(state, 'p2', { type: 'PLAY_CARD', cid: 'c1', cardInstanceId: 'x' });
    expect(result.ok).toBe(false);
  });
});
