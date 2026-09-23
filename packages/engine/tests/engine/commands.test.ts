/**
 * Nivel 3: Pruebas del motor (comandos validos/invalidos, atomicidad).
 *
 * Verifica:
 * - isLegal: validacion de comandos segun fase, jugador activo, recursos
 * - Comandos invalidos son rechazados con razon descriptiva
 * - Comandos validos son aceptados
 * - Atomicidad: un comando invalido no modifica el estado
 * - Transiciones de fase correctas
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isLegal, execute } from '../../src/commands/execute.js';
import { setupGame, startFirstTurn, resetInstanceCounter } from '../../src/phases/setup.js';
import { resetPhaseSeq } from '../../src/phases/engine.js';
import { resetResolveSeq } from '../../src/effects/resolver.js';
import { DeterministicRng } from '../../src/rng/index.js';
import { EffectRegistry, registerCoreEffects } from '../../src/effects/registry.js';
import { loadCatalog } from '@nt4h/catalog';
import { makeCard, resetTestCounters } from '../fixtures/builders.js';
import type { GameState, Command } from '@nt4h/schema';

function makeGame(catalog: ReturnType<typeof loadCatalog>, seed: string): GameState {
  const config = {
    mode: 'STANDARD' as const,
    playerCount: 2,
    seed,
    heroes: [
      { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
      { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
    ],
    useScenarios: false,
  };
  const setup = setupGame(config, catalog);
  const turnResult = startFirstTurn(setup.state, new DeterministicRng(seed), catalog);
  return turnResult.state;
}

describe('Nivel 3 - Validacion de comandos (isLegal)', () => {
  let catalog: ReturnType<typeof loadCatalog>;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();
    resetTestCounters();
    catalog = loadCatalog();
  });

  function makeSetupState(): GameState {
    return makeGame(catalog, 'test-cmd-001');
  }

  describe('PLAY_CARD', () => {
    it('valido en PLAYER_ATTACK con carta en mano', () => {
      const state = makeSetupState();
      const player = state.players.p1;
      const card = player.hand[0];
      const cmd: Command = { type: 'PLAY_CARD', cid: 'test', cardInstanceId: card.instanceId, targetEnemyId: state.battlefield[0].instanceId };
      expect(isLegal(state, 'p1', cmd, catalog).ok).toBe(true);
    });

    it('invalido si no es tu turno', () => {
      const state = makeSetupState();
      const player = state.players.p1;
      const card = player.hand[0];
      const cmd: Command = { type: 'PLAY_CARD', cid: 'test', cardInstanceId: card.instanceId, targetEnemyId: state.battlefield[0].instanceId };
      const nonActivePlayer = state.playerOrder.find(id => id !== state.activePlayerId) ?? 'p2';
      const result = isLegal(state, nonActivePlayer, cmd, catalog);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('Not your turn');
    });

    it('invalido si la carta no esta en la mano', () => {
      const state = makeSetupState();
      const cmd: Command = { type: 'PLAY_CARD', cid: 'test', cardInstanceId: 'nonexistent', targetEnemyId: state.battlefield[0].instanceId };
      const result = isLegal(state, 'p1', cmd, catalog);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('not in hand');
    });

    it('invalido en fase incorrecta (MARKET)', () => {
      const state = makeSetupState();
      const player = state.players.p1;
      const card = player.hand[0];
      const marketState = { ...state, phase: 'MARKET' as const };
      const cmd: Command = { type: 'PLAY_CARD', cid: 'test', cardInstanceId: card.instanceId, targetEnemyId: state.battlefield[0].instanceId };
      const result = isLegal(marketState, 'p1', cmd, catalog);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('Not in attack phase');
    });
  });

  describe('END_ATTACK', () => {
    it('valido en PLAYER_ATTACK', () => {
      const state = makeSetupState();
      const cmd: Command = { type: 'END_ATTACK', cid: 'test' };
      expect(isLegal(state, 'p1', cmd).ok).toBe(true);
    });

    it('invalido si no es tu turno', () => {
      const state = makeSetupState();
      const cmd: Command = { type: 'END_ATTACK', cid: 'test' };
      const nonActivePlayer = state.playerOrder.find(id => id !== state.activePlayerId) ?? 'p2';
      expect(isLegal(state, nonActivePlayer, cmd).ok).toBe(false);
    });

    it('invalido en fase MARKET', () => {
      const state = { ...makeSetupState(), phase: 'MARKET' as const };
      const cmd: Command = { type: 'END_ATTACK', cid: 'test' };
      expect(isLegal(state, 'p1', cmd).ok).toBe(false);
    });
  });

  describe('EVASION', () => {
    it('invalido si descarta menos de 2 cartas', () => {
      const state = { ...makeSetupState(), phase: 'ATTACK_CHOICE' as const };
      const player = state.players.p1;
      const card = player.hand[0];
      const cmd: Command = { type: 'EVASION', cid: 'test', discardedCardInstanceIds: [card.instanceId] };
      const result = isLegal(state, 'p1', cmd);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('at least 2');
    });

    it('invalido con IDs duplicados', () => {
      const state = { ...makeSetupState(), phase: 'ATTACK_CHOICE' as const };
      const player = state.players.p1;
      const card = player.hand[0];
      const cmd: Command = { type: 'EVASION', cid: 'test', discardedCardInstanceIds: [card.instanceId, card.instanceId] };
      const result = isLegal(state, 'p1', cmd);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('Duplicate');
    });

    it('invalido si las cartas no estan en la mano', () => {
      const state = { ...makeSetupState(), phase: 'ATTACK_CHOICE' as const };
      const cmd: Command = { type: 'EVASION', cid: 'test', discardedCardInstanceIds: ['fake1', 'fake2'] };
      const result = isLegal(state, 'p1', cmd);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('from hand');
    });

    it('invalido en fase incorrecta (PLAYER_ATTACK)', () => {
      const state = { ...makeSetupState(), phase: 'PLAYER_ATTACK' as const };
      const player = state.players.p1;
      const cards = player.hand.slice(0, 2);
      const cmd: Command = { type: 'EVASION', cid: 'test', discardedCardInstanceIds: cards.map(c => c.instanceId) };
      const result = isLegal(state, 'p1', cmd);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('Not in attack choice');
    });
  });

  describe('BUY_CARD', () => {
    it('invalido si no esta en fase MARKET', () => {
      const state = makeSetupState(); // PLAYER_ATTACK
      const cmd: Command = { type: 'BUY_CARD', cid: 'test', marketCardInstanceId: 'fake' };
      const result = isLegal(state, 'p1', cmd, catalog);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('Not in market');
    });

    it('invalido si la carta no esta en el mercado', () => {
      const state = { ...makeSetupState(), phase: 'MARKET' as const };
      const cmd: Command = { type: 'BUY_CARD', cid: 'test', marketCardInstanceId: 'nonexistent' };
      const result = isLegal(state, 'p1', cmd, catalog);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('not in market');
    });

    it('invalido sin catalogo', () => {
      const state = { ...makeSetupState(), phase: 'MARKET' as const };
      // Asegurar que hay una carta en el mercado
      const marketState = { ...state, market: [makeCard({ instanceId: 'market-1', definitionId: 'market.elven-dagger' })] };
      const cmd: Command = { type: 'BUY_CARD', cid: 'test', marketCardInstanceId: 'market-1' };
      const result = isLegal(marketState, 'p1', cmd, undefined);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('Catalog required');
    });
  });

  describe('END_TURN', () => {
    it('valido en RESTORATION', () => {
      const state = { ...makeSetupState(), phase: 'RESTORATION' as const };
      const cmd: Command = { type: 'END_TURN', cid: 'test' };
      expect(isLegal(state, 'p1', cmd).ok).toBe(true);
    });

    it('valido en MARKET', () => {
      const state = { ...makeSetupState(), phase: 'MARKET' as const };
      const cmd: Command = { type: 'END_TURN', cid: 'test' };
      expect(isLegal(state, 'p1', cmd).ok).toBe(true);
    });

    it('invalido en PLAYER_ATTACK', () => {
      const state = makeSetupState();
      const cmd: Command = { type: 'END_TURN', cid: 'test' };
      expect(isLegal(state, 'p1', cmd).ok).toBe(false);
    });

    it('invalido si no es tu turno', () => {
      const state = { ...makeSetupState(), phase: 'MARKET' as const };
      const cmd: Command = { type: 'END_TURN', cid: 'test' };
      const nonActivePlayer = state.playerOrder.find(id => id !== state.activePlayerId) ?? 'p2';
      expect(isLegal(state, nonActivePlayer, cmd).ok).toBe(false);
    });
  });

  describe('USE_HERO_ABILITY', () => {
    it('invalido si no quedan usos', () => {
      const state = makeSetupState();
      const player = state.players.p1;
      const noUsesState = {
        ...state,
        players: { ...state.players, p1: { ...player, heroUsesRemaining: 0 } },
      };
      const cmd: Command = { type: 'USE_HERO_ABILITY', cid: 'test' };
      const result = isLegal(noUsesState, 'p1', cmd, catalog);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('No hero ability');
    });

    it('valido con usos restantes', () => {
      const state = makeSetupState();
      const cmd: Command = { type: 'USE_HERO_ABILITY', cid: 'test' };
      const result = isLegal(state, 'p1', cmd, catalog);
      expect(result.ok).toBe(true);
    });
  });
});

describe('Nivel 3 - Atomicidad: comando invalido no modifica estado', () => {
  let catalog: ReturnType<typeof loadCatalog>;
  let registry: EffectRegistry;
  let rng: DeterministicRng;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();
    resetTestCounters();
    catalog = loadCatalog();
    registry = new EffectRegistry();
    registerCoreEffects(registry);
    rng = new DeterministicRng('atomicity-test');
  });

  it('PLAY_CARD con carta inexistente no modifica el estado', () => {
    const state = makeGame(catalog, 'atomicity-test');
    const cmd: Command = { type: 'PLAY_CARD', cid: 'test', cardInstanceId: 'nonexistent', targetEnemyId: state.battlefield[0].instanceId };

    const result = execute(state, cmd, rng, registry, catalog);
    expect(result.accepted).toBe(false);
    // El estado devuelto debe ser identico al original
    expect(result.newState).toBe(state);
  });

  it('PLAY_CARD en fase incorrecta no modifica el estado', () => {
    const state = makeGame(catalog, 'atomicity-test');
    const player = state.players.p1;
    const card = player.hand[0];
    const marketState = { ...state, phase: 'MARKET' as const };
    const cmd: Command = { type: 'PLAY_CARD', cid: 'test', cardInstanceId: card.instanceId, targetEnemyId: state.battlefield[0].instanceId };

    const result = execute(marketState, cmd, rng, registry, catalog);
    expect(result.accepted).toBe(false);
    expect(result.newState).toBe(marketState);
  });

  it('END_ATTACK de jugador no activo no modifica el estado (via isLegal)', () => {
    const state = makeGame(catalog, 'atomicity-test');
    const cmd: Command = { type: 'END_ATTACK', cid: 'test' };

    // isLegal rechaza para el jugador no activo
    const nonActivePlayer = state.playerOrder.find(id => id !== state.activePlayerId) ?? 'p2';
    const validation = isLegal(state, nonActivePlayer, cmd);
    expect(validation.ok).toBe(false);
    expect(validation.reason).toContain('Not your turn');
  });
});

describe('Nivel 3 - Comandos validos producen eventos', () => {
  let catalog: ReturnType<typeof loadCatalog>;
  let registry: EffectRegistry;
  let rng: DeterministicRng;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();
    resetTestCounters();
    catalog = loadCatalog();
    registry = new EffectRegistry();
    registerCoreEffects(registry);
    rng = new DeterministicRng('valid-cmd-test');
  });

  it('PLAY_CARD valido produce eventos', () => {
    const state = makeGame(catalog, 'valid-cmd-test');
    const player = state.players.p1;
    const card = player.hand[0];
    const cmd: Command = { type: 'PLAY_CARD', cid: 'test', cardInstanceId: card.instanceId, targetEnemyId: state.battlefield[0].instanceId };

    const result = execute(state, cmd, rng, registry, catalog);
    expect(result.accepted).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    // El estado debe ser diferente (nuevo objeto)
    expect(result.newState).not.toBe(state);
  });

  it('END_ATTACK valido produce eventos y cambia de fase', () => {
    const state = makeGame(catalog, 'end-attack-test');
    const cmd: Command = { type: 'END_ATTACK', cid: 'test' };

    const result = execute(state, cmd, rng, registry, catalog);
    expect(result.accepted).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
  });
});
