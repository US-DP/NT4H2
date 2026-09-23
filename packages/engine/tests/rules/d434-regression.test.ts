/**
 * Tests de regresión D434 — correcciones de debilidades de la auditoría
 * exhaustiva contra ESPECIFICACION_MAESTRA.md (secciones §3-§6).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../../src/rng/index.js';
import { EffectRegistry, registerCoreEffects, drawCardsWithReshuffle } from '../../src/effects/registry.js';
import { resetResolveSeq } from '../../src/effects/resolver.js';
import { executeTurnStartEffect, resetScenarioSeq } from '../../src/scenarios/index.js';
import { processPhases, resetPhaseSeq } from '../../src/phases/engine.js';
import { setupGame, resetInstanceCounter } from '../../src/phases/setup.js';
import { execute, isLegal } from '../../src/commands/execute.js';
import { useHeroAbility, resetAbilitySeq } from '../../src/heroes/abilities.js';
import { openSupportDeck, resetSoloSeq } from '../../src/modes/solo.js';
import { loadCatalog } from '@nt4h/catalog';
import { makeCard, makeCards, makeEnemy, makePlayer, makeGameState, resetTestCounters } from '../fixtures/builders.js';
import type { GameConfig, Zone } from '@nt4h/schema';

const catalog = loadCatalog();

function freshRng(): DeterministicRng {
  return new DeterministicRng('test-d434');
}

function makeRegistry(): EffectRegistry {
  const reg = new EffectRegistry();
  registerCoreEffects(reg);
  return reg;
}

beforeEach(() => {
  resetTestCounters();
  resetInstanceCounter();
  resetPhaseSeq();
  resetScenarioSeq();
  resetAbilitySeq();
  resetResolveSeq();
  resetSoloSeq();
});

describe('D434 Kalern — eleccion obligatoria del jugador a la izquierda', () => {
  it('onTurnStart asigna SELECT_ENEMY al jugador a la izquierda del activo', () => {
    const state = makeGameState({
      activePlayerId: 'p1',
      playerOrder: ['p1', 'p2', 'p3'],
      players: {
        p1: makePlayer({ playerId: 'p1' }),
        p2: makePlayer({ playerId: 'p2' }),
        p3: makePlayer({ playerId: 'p3' }),
      },
      battlefield: [makeEnemy()],
      scenario: { instanceId: 'sc-1', definitionId: 'scenario.kalern-mud', ownerId: 'scenario', zone: 'SCENARIO_ACTIVE' as Zone },
    });
    const result = executeTurnStartEffect(state, 'scenario.kalern-mud', 'p1', true, catalog);
    const choice = result.pendingChoice;
    expect(choice).toBeDefined();
    // El jugador a la izquierda de p1 (orden circular) es p2
    expect(choice?.playerId).toBe('p2');
    expect(choice?.type).toBe('SELECT_ENEMY');
  });

  it('ACCEPT_TURN_START_EFFECT rechazado sin eleccion pendiente', () => {
    const state = makeGameState({
      phase: 'PLAYER_ATTACK',
      activePlayerId: 'p1',
      scenario: { instanceId: 'sc-1', definitionId: 'scenario.kalern-mud', ownerId: 'scenario', zone: 'SCENARIO_ACTIVE' as Zone },
      battlefield: [makeEnemy()],
    });
    const legality = isLegal(state, 'p1', { type: 'ACCEPT_TURN_START_EFFECT', cid: 'c1', accepted: true }, catalog);
    expect(legality.ok).toBe(false);
  });
});

describe('D434 robo con mazo vacio — Herida + reciclaje', () => {
  it('DRAW_CARDS con mazo vacio y Desgaste → HERO_WOUNDED + DECK_RESHUFFLED + CARDS_DRAWN', () => {
    const worn = makeCards(3, { ownerId: 'p1', zone: 'WEAR_PILE' as Zone });
    const state = makeGameState({
      activePlayerId: 'p1',
      players: { p1: makePlayer({ playerId: 'p1', abilityDeck: [], wearPile: worn }) },
    });
    const result = drawCardsWithReshuffle('p1', 1, state, freshRng(), () => 1);
    expect(result.events.some(e => e.type === 'HERO_WOUNDED')).toBe(true);
    expect(result.events.some(e => e.type === 'DECK_RESHUFFLED')).toBe(true);
    expect(result.events.some(e => e.type === 'CARDS_DRAWN')).toBe(true);
  });

  it('DRAW_CARDS sin mazo ni Desgaste → sin robo y sin cartas inventadas', () => {
    const state = makeGameState({
      activePlayerId: 'p1',
      players: { p1: makePlayer({ playerId: 'p1', abilityDeck: [], wearPile: [] }) },
    });
    const result = drawCardsWithReshuffle('p1', 1, state, freshRng(), () => 1);
    expect(result.events.some(e => e.type === 'CARDS_DRAWN')).toBe(false);
  });

  it('Ur no roba si no quedan cartas de Horda para poner en juego', () => {
    const state = makeGameState({
      activePlayerId: 'p1',
      hordeDeck: [],
      players: { p1: makePlayer({ playerId: 'p1', abilityDeck: makeCards(3, { zone: 'ABILITY_DECK' as Zone }) }) },
    });
    const result = executeTurnStartEffect(state, 'scenario.ur-mountains', 'p1', true, catalog, freshRng());
    expect(result.events.some(e => e.type === 'CARDS_DRAWN')).toBe(false);
    expect(result.events.some(e => e.type === 'ENEMY_REVEALED')).toBe(false);
  });
});

describe('D434 solo — mazos de Apoyo', () => {
  function soloStateWithDecks() {
    const decks = [0, 1, 2, 3].map(() => makeCards(3, { zone: 'ABILITY_DECK' as Zone }));
    return makeGameState({
      mode: 'SOLO',
      phase: 'PLAYER_ATTACK',
      players: {
        p1: makePlayer({ playerId: 'p1', coins: 20, supportDecks: decks }),
      },
    });
  }

  it('rechaza abrir un 4º mazo de Apoyo (máx. 3)', () => {
    const state = soloStateWithDecks();
    state.players.p1 = { ...state.players.p1, supportDecksOpened: 3 };
    const result = openSupportDeck(state, 'p1', 3);
    expect(result.error).toBeTruthy();
  });

  it('rechaza jugar una 2ª carta de Apoyo prestada en el mismo turno', () => {
    const supportDeck = makeCards(3, { zone: 'ABILITY_DECK' as Zone, definitionId: 'warrior.sword-strike' });
    const borrowed = makeCard({ definitionId: 'warrior.sword-strike', ownerId: 'p1' });
    const borrowed2 = makeCard({ definitionId: 'warrior.sword-strike', ownerId: 'p1' });
    const state = makeGameState({
      mode: 'SOLO',
      phase: 'PLAYER_ATTACK',
      players: {
        p1: makePlayer({
          playerId: 'p1',
          supportDecks: [supportDeck],
          hand: [borrowed, borrowed2],
        }),
      },
      battlefield: [makeEnemy()],
    });
    state.players.p1 = {
      ...state.players.p1,
      supportDecksOpened: 1,
      supportDeckIndexUsedThisTurn: 0,
      borrowedSupportCardIds: [borrowed.instanceId, borrowed2.instanceId],
      supportCardUsedThisTurn: true,
    };
    const legality = isLegal(
      state,
      'p1',
      { type: 'PLAY_CARD', cid: 'c1', cardInstanceId: borrowed2.instanceId },
      catalog,
    );
    expect(legality.ok).toBe(false);
  });
});

describe('D434 Valèrys y Lisavette — objetivo correcto', () => {
  function twoPlayerState(valerysHero: string) {
    return makeGameState({
      phase: 'HORDE_ATTACK',
      activePlayerId: 'p2',
      playerOrder: ['p1', 'p2'],
      players: {
        p1: makePlayer({ playerId: 'p1', heroId: valerysHero, heroUsesRemaining: 2 }),
        p2: makePlayer({ playerId: 'p2', heroId: 'hero.feldon' }),
      },
      battlefield: [makeEnemy()],
    });
  }

  it('Valèrys rechaza interceptar a un héroe que no es el enfrentado', () => {
    const state = twoPlayerState('hero.valerys');
    state.playerOrder = ['p1', 'p2', 'p3'];
    state.players = { ...state.players, p3: makePlayer({ playerId: 'p3' }) };
    const result = useHeroAbility(state, 'p1', freshRng(), catalog, 'p3');
    expect(result.events.some(e => e.type === 'DAMAGE_INTERCEPTED')).toBe(false);
  });

  it('Valèrys no puede interceptar su propio daño', () => {
    const state = twoPlayerState('hero.valerys');
    state.activePlayerId = 'p1';
    const result = useHeroAbility(state, 'p1', freshRng(), catalog, 'p1');
    expect(result.events.some(e => e.type === 'DAMAGE_INTERCEPTED')).toBe(false);
  });

  it('Lisavette solo ofrece como objetivo al héroe enfrentado', () => {
    const state = twoPlayerState('hero.lisavette');
    state.players.p1 = {
      ...state.players.p1,
      hand: [makeCard({ definitionId: 'warrior.shield', ownerId: 'p1' })],
    };
    state.playerOrder = ['p1', 'p2', 'p3'];
    state.players = { ...state.players, p3: makePlayer({ playerId: 'p3' }) };
    const result = useHeroAbility(state, 'p1', freshRng(), catalog);
    const choice = result.state.pendingChoices.find(c => c.type === 'SELECT_HERO');
    expect(choice).toBeDefined();
    expect(choice?.options).toEqual(['p2']);
  });
});

describe('D434 pericias opt-in — Cemenmar, Taheral, Feldon', () => {
  it('EVASION en Cemenmar crea eleccion SELECT_COINS_TO_STEAL (no robo automatico)', () => {
    const state = makeGameState({
      phase: 'ATTACK_CHOICE',
      activePlayerId: 'p1',
      playerOrder: ['p1', 'p2'],
      players: {
        p1: makePlayer({ playerId: 'p1', hand: makeCards(2), coins: 0 }),
        p2: makePlayer({ playerId: 'p2', coins: 5 }),
      },
      scenario: { instanceId: 'sc-1', definitionId: 'scenario.cemenmar-wastes', ownerId: 'scenario', zone: 'SCENARIO_ACTIVE' as Zone },
    });
    const result = execute(
      state,
      { type: 'EVASION', cid: 'c1', discardedCardInstanceIds: state.players.p1.hand.map(c => c.instanceId) },
      freshRng(), makeRegistry(), catalog,
    );
    expect(result.accepted).toBe(true);
    expect(result.events.some(e => e.type === 'COINS_STOLEN')).toBe(false);
    const steal = result.newState.pendingChoices.find(c => c.type === 'SELECT_COINS_TO_STEAL');
    expect(steal).toBeDefined();
    expect(steal?.options).toEqual(['p2#coin1', 'p2#coin2']);
  });

  it('EVASION con Taheral crea CONFIRM (opt-in), no monedas automaticas', () => {
    const state = makeGameState({
      phase: 'ATTACK_CHOICE',
      activePlayerId: 'p1',
      players: { p1: makePlayer({ playerId: 'p1', heroId: 'hero.taheral', hand: makeCards(2), coins: 0 }) },
    });
    const result = execute(
      state,
      { type: 'EVASION', cid: 'c1', discardedCardInstanceIds: state.players.p1.hand.map(c => c.instanceId) },
      freshRng(), makeRegistry(), catalog,
    );
    expect(result.accepted).toBe(true);
    expect(result.events.some(e => e.type === 'COINS_GAINED' && e.amount > 0)).toBe(false);
    const confirm = result.newState.pendingChoices.find(c => c.choiceId.startsWith('taheral-evasion-'));
    expect(confirm).toBeDefined();
  });

  it('Feldon pausa HORDE_ATTACK con CONFIRM antes de aplicar daño', () => {
    const state = makeGameState({
      phase: 'HORDE_ATTACK',
      activePlayerId: 'p1',
      players: {
        p1: makePlayer({ playerId: 'p1', heroId: 'hero.feldon', heroUsesRemaining: 2, abilityDeck: makeCards(5, { zone: 'ABILITY_DECK' as Zone }) }),
      },
      battlefield: [makeEnemy({ baseFortitude: 4 })],
    });
    const result = processPhases(state, freshRng(), catalog);
    expect(result.pendingPhase).toBeNull();
    const confirm = result.state.pendingChoices.find(c => c.choiceId.startsWith('feldon-reduce-'));
    expect(confirm).toBeDefined();
    // El daño aún no se ha resuelto
    expect(result.events.some(e => e.type === 'HORDE_ATTACKED')).toBe(false);
  });
});

describe('D434 Portal de Ulthar — no cobrar sin objetivo válido', () => {
  it('sin Huestes en el campo no hay pago ni eleccion', () => {
    const state = makeGameState({
      activePlayerId: 'p1',
      players: { p1: makePlayer({ playerId: 'p1', glory: 5, coins: 5, trophies: ['t-1'] }) },
      battlefield: [],
    });
    const result = executeTurnStartEffect(state, 'scenario.ulthar-portal', 'p1', true, catalog, freshRng());
    expect(result.events.some(e => e.type === 'GLORY_LOST')).toBe(false);
    expect(result.events.some(e => e.type === 'COINS_GAINED' && e.amount < 0)).toBe(false);
    expect(result.pendingChoice).toBeUndefined();
  });
});

describe('D434 mercado solitario configurable', () => {
  it('respeta config.soloMarketCardIds', () => {
    const marketDefs = (catalog.byType.get('MARKET') ?? []).map(c => c.id).slice(0, 5);
    const config: GameConfig = {
      mode: 'SOLO',
      playerCount: 1,
      seed: 'test-solo-market',
      heroes: [{ playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' }],
      useScenarios: false,
      soloMarketCardIds: marketDefs,
    };
    const result = setupGame(config, catalog);
    const marketIds = result.state.market.map(c => c.definitionId).sort();
    expect(marketIds).toEqual([...marketDefs].sort());
    expect(result.state.marketDeck.length).toBe(0);
  });
});
