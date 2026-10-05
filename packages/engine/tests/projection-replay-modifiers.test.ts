import { describe, it, expect, beforeEach } from 'vitest';
import type { DeterministicRng } from '../src/rng/index.js';
import { EffectRegistry, registerCoreEffects } from '../src/effects/registry.js';
import { setupGame, resetInstanceCounter } from '../src/phases/setup.js';
import { resetPhaseSeq } from '../src/phases/engine.js';
import { loadCatalog } from '@nt4h/catalog';
import { projectForPlayer, projectEventsForPlayer } from '../src/projection/index.js';
import { createSnapshot, replay, replayFromSnapshot, stateHash, createReplay, ENGINE_VERSION } from '../src/replay/index.js';
import { getEffectiveFortitude, effectiveDamage, effectiveHordeDamage, effectiveEnemyDamage, expireModifiers, MODIFIER_LAYERS } from '../src/modifiers/index.js';
import { execute } from '../src/commands/execute.js';
import type { GameState, GameEvent, Command } from '@nt4h/schema';

describe('Projection — ocultación de información', () => {
  let catalog: ReturnType<typeof loadCatalog>;
  let state: GameState;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    catalog = loadCatalog();
    const result = setupGame({
      mode: 'STANDARD',
      playerCount: 2,
      seed: 'test-projection-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: false,
    }, catalog);
    state = result.state;
  });

  it('proyecta el estado para un jugador', () => {
    const projected = projectForPlayer(state, 'p1');
    expect(projected.phase).toBe(state.phase);
    expect(projected.activePlayerId).toBe(state.activePlayerId);
    expect(projected.playerOrder).toEqual(state.playerOrder);
  });

  it('el viewer ve su propia mano', () => {
    const projected = projectForPlayer(state, 'p1');
    expect(projected.players.p1.hand).toBeDefined();
    expect(projected.players.p1.hand?.length).toBe(state.players.p1.hand.length);
  });

  it('el viewer NO ve la mano del otro jugador', () => {
    const projected = projectForPlayer(state, 'p1');
    expect(projected.players.p2.hand).toBeUndefined();
  });

  it('el espectador (null) no ve ninguna mano', () => {
    const projected = projectForPlayer(state, null);
    expect(projected.players.p1.hand).toBeUndefined();
    expect(projected.players.p2.hand).toBeUndefined();
  });

  it('muestra información pública de todos los jugadores', () => {
    const projected = projectForPlayer(state, 'p1');
    expect(projected.players.p1.glory).toBe(state.players.p1.glory);
    expect(projected.players.p2.glory).toBe(state.players.p2.glory);
    expect(projected.players.p1.coins).toBe(state.players.p1.coins);
    expect(projected.players.p2.coins).toBe(state.players.p2.coins);
  });

  it('muestra el tamaño del mazo pero no las cartas', () => {
    const projected = projectForPlayer(state, 'p1');
    expect(projected.players.p1.deckSize).toBe(state.players.p1.abilityDeck.length);
    expect(projected.players.p2.deckSize).toBe(state.players.p2.abilityDeck.length);
  });

  it('muestra el campo de batalla público', () => {
    const projected = projectForPlayer(state, 'p1');
    expect(projected.battlefield.length).toBe(state.battlefield.length);
    expect(projected.battlefield[0].baseFortitude).toBe(state.battlefield[0].baseFortitude);
  });

  it('filtra eventos privados de otros jugadores', () => {
    const events: GameEvent[] = [
      { type: 'CARDS_DRAWN', playerId: 'p1', count: 1, cardInstanceIds: ['c1'], seq: 1 } as GameEvent,
      { type: 'CARDS_DRAWN', playerId: 'p2', count: 1, cardInstanceIds: ['c2'], seq: 2 } as GameEvent,
      { type: 'GLORY_GAINED', playerId: 'p1', amount: 1, seq: 3 } as GameEvent,
    ];
    const filtered = projectEventsForPlayer(events, 'p1');
    // El evento de p2 debe estar filtrado
    expect(filtered.length).toBe(2);
    expect(filtered.some(e => e.type === 'CARDS_DRAWN' && (e as { playerId: string }).playerId === 'p2')).toBe(false);
  });

  it('HORDE_DECK_REORDERED (orden futuro) es secreto para todos', () => {
    const events: GameEvent[] = [
      { type: 'HORDE_DECK_REORDERED', newOrder: ['h9', 'h7', 'h3'], seq: 1 } as GameEvent,
    ];
    expect(projectEventsForPlayer(events, 'p1')).toHaveLength(0);
    expect(projectEventsForPlayer(events, null)).toHaveLength(0);
  });

  it('CARD_MOVED de mano ajena redacta el instanceId', () => {
    const events: GameEvent[] = [
      // Puja de líder de p1: secreta para p2
      { type: 'CARD_MOVED', cardInstanceId: 'ability-42', from: 'HAND', to: 'ABILITY_DECK', playerId: 'p1', seq: 1 } as GameEvent,
      // Movimiento público (mercado): intacto
      { type: 'CARD_MOVED', cardInstanceId: 'market-3', from: 'MARKET', to: 'MARKET_DECK', seq: 2 } as GameEvent,
    ];
    const forP2 = projectEventsForPlayer(events, 'p2');
    expect((forP2[0] as { cardInstanceId: string }).cardInstanceId).toBe('hidden');
    expect((forP2[1] as { cardInstanceId: string }).cardInstanceId).toBe('market-3');
    // El dueño ve el id real
    const forP1 = projectEventsForPlayer(events, 'p1');
    expect((forP1[0] as { cardInstanceId: string }).cardInstanceId).toBe('ability-42');
  });

  it('EVASION_PERFORMED conserva el conteo pero oculta las cartas ajenas', () => {
    const events: GameEvent[] = [
      { type: 'EVASION_PERFORMED', playerId: 'p2', discardedCardInstanceIds: ['a1', 'a2'], seq: 1 } as GameEvent,
    ];
    const forP1 = projectEventsForPlayer(events, 'p1');
    expect(forP1).toHaveLength(1);
    const ev = forP1[0] as { discardedCardInstanceIds: string[] };
    expect(ev.discardedCardInstanceIds).toHaveLength(2);
    expect(ev.discardedCardInstanceIds).not.toContain('a1');
    // El dueño ve los ids reales
    const forP2 = projectEventsForPlayer(events, 'p2');
    expect((forP2[0] as { discardedCardInstanceIds: string[] }).discardedCardInstanceIds).toEqual(['a1', 'a2']);
  });

  it('ENEMY_SWAPPED nunca revela el botín del enemigo nuevo', () => {
    const events: GameEvent[] = [
      { type: 'ENEMY_SWAPPED', oldEnemyInstanceId: 'e1', newEnemyInstanceId: 'e2', newEnemyDefinitionId: 'horde.x', newEnemyFortitude: 3, newEnemyReward: { coins: 5, glory: 2 }, newEnemyIsOrc: false, newEnemyIsWarlord: false, newEnemySpecialIcons: [], seq: 1 } as GameEvent,
    ];
    const forP1 = projectEventsForPlayer(events, 'p1');
    expect((forP1[0] as { newEnemyReward: unknown }).newEnemyReward).toBeNull();
  });

  it('la puja de líder no filtra cartas ajenas en el eventLog proyectado', () => {
    // El estado tras setup incluye CARD_MOVED de la puja con playerId
    const projected = projectForPlayer(state, 'p1');
    const bidMoves = projected.eventLog.filter(
      e => e.type === 'CARD_MOVED' && e.from === 'HAND' && e.to === 'ABILITY_DECK',
    );
    // Solo quedan los movimientos del propio p1 con id real; los de p2
    // aparecen redactados o no aparecen
    for (const ev of bidMoves) {
      const e = ev as { playerId?: string; cardInstanceId: string };
      if (e.cardInstanceId !== 'hidden') {
        expect(e.playerId === 'p1' || e.playerId === undefined).toBe(true);
      }
    }
  });
});

describe('Replay — serialización y reproducción', () => {
  let catalog: ReturnType<typeof loadCatalog>;
  let rng: DeterministicRng;
  let registry: EffectRegistry;
  let state: GameState;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    catalog = loadCatalog();
    const result = setupGame({
      mode: 'STANDARD',
      playerCount: 2,
      seed: 'test-replay-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: false,
    }, catalog);
    state = result.state;
    rng = result.rng;
    registry = new EffectRegistry();
    registerCoreEffects(registry);
  });

  it('crea un snapshot con la versión correcta', () => {
    const snapshot = createSnapshot(state, rng, 0);
    expect(snapshot.version).toBe(1);
    expect(snapshot.engineVersion).toBe(ENGINE_VERSION);
    expect(snapshot.state).toBe(state);
  });

  it('stateHash es determinista para el mismo estado', () => {
    const hash1 = stateHash(state);
    const hash2 = stateHash(state);
    expect(hash1).toBe(hash2);
  });

  it('stateHash cambia cuando el estado cambia', () => {
    const hash1 = stateHash(state);
    const modifiedState: GameState = {
      ...state,
      turnNumber: state.turnNumber + 1,
    };
    const hash2 = stateHash(modifiedState);
    expect(hash1).not.toBe(hash2);
  });

  it('replay reproduce el mismo estado final', () => {
    // Ejecutar un comando
    const cmd: Command = {
      type: 'END_TURN',
      cid: 'test-end-turn-1',
    };
    const result = execute(state, cmd, rng, registry);

    // Crear replay
    const envelope = createReplay('STANDARD', 'test-replay-001', state, [cmd], {}, rng);
    const replayedState = replay(envelope);

    // El estado replay debe coincidir con el estado después del comando
    expect(stateHash(replayedState)).toBe(stateHash(result.newState));
  });

  it('replayFromSnapshot reconstruye desde snapshot + eventos', () => {
    const snapshot = createSnapshot(state, rng, 0);
    const events: GameEvent[] = [];
    const replayed = replayFromSnapshot(snapshot, events);
    expect(stateHash(replayed)).toBe(stateHash(state));
  });

  it('createReplay genera un envelope válido', () => {
    const envelope = createReplay('STANDARD', 'test-seed', state, []);
    expect(envelope.version).toBe('1.0');
    expect(envelope.gameType).toBe('STANDARD');
    expect(envelope.seed).toBe('test-seed');
    expect(envelope.commands).toEqual([]);
    expect(envelope.initialState.state).toBe(state);
  });
});

describe('Modifiers — capas de modificadores', () => {
  let catalog: ReturnType<typeof loadCatalog>;
  let state: GameState;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    catalog = loadCatalog();
    const result = setupGame({
      mode: 'STANDARD',
      playerCount: 2,
      seed: 'test-modifiers-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: false,
    }, catalog);
    state = result.state;
  });

  it('MODIFIER_LAYERS tiene 7 capas en orden correcto', () => {
    expect(MODIFIER_LAYERS).toEqual([
      'BASE_CHARACTERISTICS',
      'FORTITUDE_MODIFIERS',
      'DAMAGE_BONUS',
      'ENEMY_OUTGOING_DAMAGE',
      'PREVENTION',
      'CANCELLATION',
      'MARKET_COST',
    ]);
  });

  it('getEffectiveFortitude calcula la fortaleza efectiva', () => {
    const enemy = state.battlefield[0];
    const fortitude = getEffectiveFortitude(enemy, state);
    expect(fortitude).toBe(enemy.baseFortitude);
  });

  it('effectiveDamage aplica modificadores de DAMAGE_BONUS', () => {
    const player = state.players.p1;
    const damage = effectiveDamage(2, 'Espadazo', player);
    expect(damage).toBe(2); // Sin modificadores, el daño es el base
  });

  it('effectiveHordeDamage devuelve 0 con cancelación', () => {
    const player = {
      ...state.players.p1,
      damageCancellation: true,
    };
    expect(effectiveHordeDamage(5, player)).toBe(0);
  });

  it('effectiveHordeDamage resta prevención', () => {
    const player = {
      ...state.players.p1,
      prevention: 3,
      shields: 0,
      damageCancellation: false,
    };
    expect(effectiveHordeDamage(5, player)).toBe(2);
  });

  it('effectiveHordeDamage resta escudos', () => {
    const player = {
      ...state.players.p1,
      prevention: 0,
      shields: 2,
      damageCancellation: false,
    };
    expect(effectiveHordeDamage(5, player)).toBe(3);
  });

  it('effectiveEnemyDamage devuelve 0 si el enemigo tiene daño deshabilitado', () => {
    const enemy = {
      ...state.battlefield[0],
      damageDisabled: true,
    };
    expect(effectiveEnemyDamage(enemy, 3, state.players.p1)).toBe(0);
  });

  it('expireModifiers elimina modificadores UNTIL_END_OF_TURN al final del turno', () => {
    const modifiedState: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          modifiers: [
            {
              id: 'mod-1',
              sourceId: 'card-1',
              layer: 'DAMAGE_BONUS',
              timestamp: 1,
              duration: 'UNTIL_END_OF_TURN',
              amount: 1,
            },
          ],
        },
      },
    };
    const expired = expireModifiers(modifiedState, 'END_OF_TURN');
    expect(expired.players.p1.modifiers.length).toBe(0);
  });

  it('expireModifiers resetea prevención y escudos al final del ataque de la Horda', () => {
    const modifiedState: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          prevention: 3,
          shields: 2,
          damageCancellation: true,
        },
      },
    };
    const expired = expireModifiers(modifiedState, 'HORDE_ATTACK_END');
    expect(expired.players.p1.prevention).toBe(0);
    expect(expired.players.p1.shields).toBe(0);
    expect(expired.players.p1.damageCancellation).toBe(false);
  });
});
