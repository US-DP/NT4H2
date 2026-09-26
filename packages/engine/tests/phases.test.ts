import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { setupGame, startFirstTurn, resetInstanceCounter } from '../src/phases/setup.js';
import { execute } from '../src/commands/execute.js';
import { EffectRegistry, registerCoreEffects } from '../src/effects/registry.js';
import { processPhases, resetPhaseSeq } from '../src/phases/engine.js';
import { canTransition, validateTransition, nextPhases } from '../src/phases/transitions.js';
import { loadCatalog } from '@nt4h/catalog';
import type { GameConfig, GameState } from '@nt4h/schema';

describe('Phase transitions', () => {
  it('canTransition valida transiciones correctas', () => {
    expect(canTransition('SETUP', 'INITIAL_PLAYER_SELECTION')).toBe(true);
    expect(canTransition('TURN_START', 'ATTACK_CHOICE')).toBe(true);
    expect(canTransition('ATTACK_CHOICE', 'PLAYER_ATTACK')).toBe(true);
    expect(canTransition('ATTACK_CHOICE', 'MARKET')).toBe(true); // Evasion
    expect(canTransition('PLAYER_ATTACK', 'HORDE_ATTACK')).toBe(true);
    expect(canTransition('HORDE_ATTACK', 'MARKET')).toBe(true);
    expect(canTransition('MARKET', 'RESTORATION')).toBe(true);
  });

  it('canTransition rechaza transiciones invalidas', () => {
    expect(canTransition('SETUP', 'MARKET')).toBe(false);
    expect(canTransition('MARKET', 'PLAYER_ATTACK')).toBe(false);
    expect(canTransition('FINISHED', 'TURN_START')).toBe(false);
  });

  it('validateTransition devuelve razon en error', () => {
    const result = validateTransition('SETUP', 'MARKET');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Invalid phase transition');
    }
  });

  it('nextPhases devuelve fases validas', () => {
    expect(nextPhases('ATTACK_CHOICE')).toContain('PLAYER_ATTACK');
    expect(nextPhases('ATTACK_CHOICE')).toContain('HORDE_ATTACK');
    expect(nextPhases('ATTACK_CHOICE')).toContain('MARKET');
    expect(nextPhases('FINISHED')).toEqual([]);
  });
});

describe('Setup', () => {
  let catalog: ReturnType<typeof loadCatalog>;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    catalog = loadCatalog();
  });

  function makeConfig(playerCount: number = 2): GameConfig {
    const heroes = [
      { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
      { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
      { playerId: 'p3', heroId: 'hero.neddia', heroFace: 'FEMALE' as const, deckId: 'warrior.default' },
      { playerId: 'p4', heroId: 'hero.taheral', heroFace: 'MALE' as const, deckId: 'explorer.default' },
    ];
    return {
      mode: 'STANDARD',
      playerCount,
      seed: 'test-setup-001',
      heroes: heroes.slice(0, playerCount),
      useScenarios: true,
    };
  }

  it('crea estado con 2 jugadores', () => {
    const result = setupGame(makeConfig(2), catalog);
    expect(result.errors).toEqual([]);
    expect(result.state.playerOrder).toEqual(['p1', 'p2']);
    expect(Object.keys(result.state.players)).toHaveLength(2);
  });

  it('cada jugador tiene 4 cartas en mano', () => {
    const result = setupGame(makeConfig(2), catalog);
    for (const playerId of result.state.playerOrder) {
      expect(result.state.players[playerId].hand).toHaveLength(4);
    }
  });

  it('cada jugador tiene cartas restantes en el mazo tras puja de Líder', () => {
    const result = setupGame(makeConfig(2), catalog);
    for (const playerId of result.state.playerOrder) {
      // 15 total - 4 en mano = 11, pero la puja de Líder mueve 2 al fondo
      // y luego se roban 2 para volver a 4. Neto: 11 en mazo.
      // (Algunas cartas pueden tener 0 de daño y no ser pujadas)
      const deckLen = result.state.players[playerId].abilityDeck.length;
      expect(deckLen).toBeGreaterThanOrEqual(9);
      expect(deckLen).toBeLessThanOrEqual(11);
    }
  });

  it('cada jugador tiene 2 monedas iniciales', () => {
    const result = setupGame(makeConfig(2), catalog);
    for (const playerId of result.state.playerOrder) {
      expect(result.state.players[playerId].coins).toBe(2);
    }
  });

  it('hay 3 enemigos en el campo de batalla', () => {
    const result = setupGame(makeConfig(2), catalog);
    expect(result.state.battlefield).toHaveLength(3);
  });

  it('hay 5 cartas en el mercado', () => {
    const result = setupGame(makeConfig(2), catalog);
    expect(result.state.market).toHaveLength(5);
  });

  it('hay un escenario activo', () => {
    const result = setupGame(makeConfig(2), catalog);
    expect(result.state.scenario).not.toBeNull();
  });

  it('la Horda tiene 17 cartas restantes (19 - 3 en campo + 1 Señor)', () => {
    const result = setupGame(makeConfig(2), catalog);
    // 2 jugadores: 19 Huestes - 3 en campo = 16 + 1 Señor = 17
    expect(result.state.hordeDeck).toHaveLength(17);
  });

  it('crea pujas de Líder pendientes en multijugador', () => {
    const result = setupGame(makeConfig(2), catalog);
    // D427: la puja es interactiva — cada jugador tiene una pendingChoice
    const bids = result.state.pendingChoices.filter(c => c.choiceId.startsWith('leader-bid-'));
    expect(bids).toHaveLength(2);
    expect(bids.every(c => c.type === 'SELECT_CARDS_FOR_LEADER')).toBe(true);
  });

  it('determina un Líder tras la puja (auto-resolución)', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-setup-001');
    const turnResult = startFirstTurn(setup.state, rng, catalog);
    expect(turnResult.state.activePlayerId).not.toBe('');
    expect(turnResult.state.playerOrder).toContain(turnResult.state.activePlayerId);
    // Las pujas se resolvieron
    expect(turnResult.state.pendingChoices.filter(c => c.choiceId.startsWith('leader-bid-'))).toHaveLength(0);
  });

  it('la fase es INITIAL_PLAYER_SELECTION', () => {
    const result = setupGame(makeConfig(2), catalog);
    expect(result.state.phase).toBe('INITIAL_PLAYER_SELECTION');
  });

  it('setup es determinista con misma semilla', () => {
    resetInstanceCounter();
    const r1 = setupGame(makeConfig(2), catalog);
    resetInstanceCounter();
    const r2 = setupGame(makeConfig(2), catalog);

    // Mismas manos
    expect(r1.state.players.p1.hand.map(c => c.definitionId).sort())
      .toEqual(r2.state.players.p1.hand.map(c => c.definitionId).sort());
    // Mismos enemigos
    expect(r1.state.battlefield.map(e => e.definitionId).sort())
      .toEqual(r2.state.battlefield.map(e => e.definitionId).sort());
  });

  it('startFirstTurn pasa a ATTACK_CHOICE', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-setup-001');
    const turnResult = startFirstTurn(setup.state, rng, catalog);
    expect(turnResult.state.phase).toBe('ATTACK_CHOICE');
    expect(turnResult.state.turnNumber).toBe(1);
  });

  it('puja de Líder interactiva: CHOOSE_LEADER_CARDS resuelve al completar todas las pujas', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-leader-bid');
    const registry = new EffectRegistry();
    registerCoreEffects(registry);

    let state = setup.state;
    expect(state.phase).toBe('INITIAL_PLAYER_SELECTION');
    expect(state.pendingChoices.filter(c => c.choiceId.startsWith('leader-bid-'))).toHaveLength(2);

    // Cada jugador puja su primera carta de mano
    for (const pid of state.playerOrder) {
      const card = state.players[pid].hand[0];
      const result = execute(state, {
        type: 'CHOOSE_LEADER_CARDS',
        cid: `bid-${pid}`,
        cardInstanceIds: [card.instanceId],
      }, rng, registry, catalog, pid);
      expect(result.accepted).toBe(true);
      state = result.newState;
    }

    // Tras la última puja: líder determinado y turno 1 arrancado
    expect(state.activePlayerId).not.toBe('');
    expect(state.turnNumber).toBe(1);
    expect(state.phase).toBe('ATTACK_CHOICE');
    expect(state.pendingChoices.some(c => c.choiceId.startsWith('leader-bid-'))).toBe(false);
    // Todos los jugadores siguen con 4 cartas en mano
    for (const pid of state.playerOrder) {
      expect(state.players[pid].hand.length).toBe(4);
    }
  });

  it('CHOOSE_LEADER_CARDS rechaza cartas fuera de la mano', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-leader-bid-2');
    const registry = new EffectRegistry();
    registerCoreEffects(registry);

    const result = execute(setup.state, {
      type: 'CHOOSE_LEADER_CARDS',
      cid: 'bid-bad',
      cardInstanceIds: ['nonexistent-card'],
    }, rng, registry, catalog, 'p1');
    expect(result.accepted).toBe(false);
  });
});

describe('processPhases — fases automaticas', () => {
  let catalog: ReturnType<typeof loadCatalog>;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    catalog = loadCatalog();
  });

  function makeConfig(playerCount: number = 2): GameConfig {
    const heroes = [
      { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
      { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
    ];
    return {
      mode: 'STANDARD',
      playerCount,
      seed: 'test-phases-001',
      heroes: heroes.slice(0, playerCount),
      useScenarios: true,
    };
  }

  it('procesa HORDE_ATTACK y pasa a MARKET', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-phases-001');
    // D427: resolver la puja de Líder para tener jugador activo
    let state = startFirstTurn(setup.state, rng, catalog).state;

    // Simular que el jugador termina su ataque; declinar la Pericia de
    // Feldon para que el test no dependa de quién es Líder
    state = {
      ...state,
      phase: 'HORDE_ATTACK' as const,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, p]) => [id, { ...p, feldonDecision: 'DECLINE' as const }])
      ),
    };

    const result = processPhases(state, rng, catalog);
    expect(result.state.phase).toBe('MARKET');
    // Debe haber un evento de HORDE_ATTACKED
    expect(result.events.some(e => e.type === 'HORDE_ATTACKED')).toBe(true);
  });

  it('procesa todo el ciclo hasta llegar a MARKET (fase de accion)', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-phases-001');
    // D427: resolver la puja de Líder para tener jugador activo
    let state = startFirstTurn(setup.state, rng, catalog).state;

    // Simular que estamos en HORDE_ATTACK; declinar la Pericia de Feldon
    // para que el test no dependa de quién es Líder
    state = {
      ...state,
      phase: 'HORDE_ATTACK' as const,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, p]) => [id, { ...p, feldonDecision: 'DECLINE' as const }])
      ),
    };

    const result = processPhases(state, rng, catalog);
    // Se detiene en MARKET porque requiere accion del jugador
    expect(result.state.phase).toBe('MARKET');
    expect(result.pendingPhase).toBe('MARKET');
  });

  it('procesa desde RESTORATION hasta ATTACK_CHOICE del siguiente turno', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-phases-001');
    // D427: resolver la puja de Líder para tener jugador activo
    const resolved = startFirstTurn(setup.state, rng, catalog).state;
    const firstActiveId = resolved.activePlayerId;

    // Simular que estamos en RESTORATION (despues del mercado)
    const state: GameState = { ...resolved, phase: 'RESTORATION' as const };

    const result = processPhases(state, rng, catalog);
    // Debe llegar a ATTACK_CHOICE del siguiente jugador
    expect(result.state.phase).toBe('ATTACK_CHOICE');
    // El jugador activo debe haber cambiado
    expect(result.state.activePlayerId).not.toBe(firstActiveId);
  });

  it('el ataque de la Horda causa perdida de cartas', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-phases-001');
    // D427: resolver la puja de Líder para tener jugador activo
    const resolved = startFirstTurn(setup.state, rng, catalog).state;
    const player = resolved.players[resolved.activePlayerId];
    void player.abilityDeck.length;

    // Declinar la Pericia de Feldon para no depender de quién es Líder
    const state: GameState = {
      ...resolved,
      phase: 'HORDE_ATTACK' as const,
      players: Object.fromEntries(
        Object.entries(resolved.players).map(([id, p]) => [id, { ...p, feldonDecision: 'DECLINE' as const }])
      ),
    };
    const result = processPhases(state, rng, catalog);

    // Debe haber un evento CARDS_LOST
    const lostEvent = result.events.find(e => e.type === 'CARDS_LOST');
    expect(lostEvent).toBeDefined();
    if (lostEvent && lostEvent.type === 'CARDS_LOST') {
      expect(lostEvent.count).toBeGreaterThan(0);
    }
  });

  it('la restauracion roba cartas hasta tener 4 en mano', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-phases-001');
    // D427: resolver la puja de Líder para tener jugador activo
    const resolved = startFirstTurn(setup.state, rng, catalog).state;

    // Vaciar la mano del jugador activo y empezar en RESTORATION
    const activeId = resolved.activePlayerId;
    const state: GameState = {
      ...resolved,
      phase: 'RESTORATION' as const,
      players: {
        ...resolved.players,
        [activeId]: {
          ...resolved.players[activeId],
          hand: [], // Mano vacia
        },
      },
    };

    const result = processPhases(state, rng, catalog);
    // Despues de la restauracion, el jugador debe tener 4 cartas
    expect(result.state.players[activeId].hand).toHaveLength(4);
  });

  it('reposicion enemigos derrotados', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-phases-001');

    // Simular que se derrotaron 2 enemigos y empezar en BATTLEFIELD_REPLENISHMENT
    const state: GameState = {
      ...setup.state,
      phase: 'BATTLEFIELD_REPLENISHMENT' as const,
      battlefield: setup.state.battlefield.slice(0, 2), // Solo 2 enemigos
    };

    const result = processPhases(state, rng, catalog);
    // Con 2 enemigos, se roba 1 (especificacion 3.6.2: 1-2 enemigos → robar 1)
    expect(result.state.battlefield).toHaveLength(3);
  });

  it('termina la partida cuando el mazo de la Horda esta vacio', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const rng = new DeterministicRng('test-phases-001');

    // Simular que la Horda esta vacia y el campo vacio
    const state: GameState = {
      ...setup.state,
      phase: 'GAME_END_CHECK' as const,
      hordeDeck: [],
      battlefield: [],
      warlordRevealed: true,
      warlordDefeated: true,
      warlordsDefeatedCount: 1,
    };

    const result = processPhases(state, rng, catalog);
    expect(result.state.phase).toBe('FINISHED');
    expect(result.events.some(e => e.type === 'GAME_ENDED')).toBe(true);
  });
});
