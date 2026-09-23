/**
 * Cobertura de reglas — casos positivos y negativos por seccion de la
 * ESPECIFICACION_MAESTRA (Parte I, reglas del juego de mesa).
 *
 * Complementa los niveles 0-8 existentes: cada regla debe tener al menos
 * un caso positivo (se aplica correctamente) y un caso negativo (se
 * rechaza lo que la regla prohibe).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../../src/rng/index.js';
import { EffectRegistry, registerCoreEffects } from '../../src/effects/registry.js';
import { resolveCard, resetResolveSeq } from '../../src/effects/resolver.js';
import {
  setupGame,
  startFirstTurn,
  resolveLeaderBid,
  resetInstanceCounter,
} from '../../src/phases/setup.js';
import { processPhases, resetPhaseSeq } from '../../src/phases/engine.js';
import { execute, isLegal } from '../../src/commands/execute.js';
import {
  openSupportDeck,
  buySupportCard,
  swapStartingCards,
  resetSoloSeq,
} from '../../src/modes/solo.js';
import { loadCatalog } from '@nt4h/catalog';
import { makeCard, makeCards, makeEnemy, makePlayer, makeGameState, resetTestCounters } from '../fixtures/builders.js';
import type { GameConfig, GameState, CardInstance, Zone } from '@nt4h/schema';

type Catalog = ReturnType<typeof loadCatalog>;

const HEROES_4P = [
  { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default', playerAge: 30 },
  { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default', playerAge: 50 },
  { playerId: 'p3', heroId: 'hero.neddia', heroFace: 'FEMALE' as const, deckId: 'warrior.default', playerAge: 20 },
  { playerId: 'p4', heroId: 'hero.taheral', heroFace: 'MALE' as const, deckId: 'explorer.default', playerAge: 40 },
];

function makeConfig(playerCount: number, mode: GameConfig['mode'] = 'STANDARD'): GameConfig {
  return {
    mode,
    playerCount,
    seed: `test-rules-${playerCount}p`,
    heroes: HEROES_4P.slice(0, playerCount),
    useScenarios: true,
  };
}

function freshRng(): DeterministicRng {
  return new DeterministicRng('test-rules-rng');
}

function makeRegistry(): EffectRegistry {
  const reg = new EffectRegistry();
  registerCoreEffects(reg);
  return reg;
}

function startedState(catalog: Catalog, playerCount = 2): GameState {
  const setup = setupGame(makeConfig(playerCount), catalog);
  return startFirstTurn(setup.state, freshRng(), catalog).state;
}

// ============================================================================
// §3.2.1 Construccion de la Horda (tamaño segun jugadores)
// ============================================================================

describe('§3.2.1 Horda segun numero de jugadores', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  it('positivo: 3 jugadores → 23 Huestes + 1 Señor (20 tras sacar 3)', () => {
    const { state } = setupGame(makeConfig(3), catalog);
    // 23 Huestes - 3 en campo = 20 + 1 Señor = 21 en el mazo
    expect(state.hordeDeck).toHaveLength(21);
    expect(state.battlefield).toHaveLength(3);
  });

  it('positivo: 4 jugadores → 27 Huestes + 1 Señor (24 tras sacar 3)', () => {
    const { state } = setupGame(makeConfig(4), catalog);
    // 27 - 3 en campo = 24 + 1 Señor = 25 en el mazo
    expect(state.hordeDeck).toHaveLength(25);
  });

  it('positivo: el Señor de la Guerra es la primera carta del mazo (ultima en salir)', () => {
    const { state } = setupGame(makeConfig(2), catalog);
    const topCard = state.hordeDeck[0];
    const def = catalog.byId.get(topCard.definitionId);
    expect(def?.type).toBe('WARLORD');
  });
});

// ============================================================================
// §3.2.6 Eleccion del Lider
// ============================================================================

describe('§3.2.6 Puja de Lider', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  it('negativo: rechaza 0 cartas en la puja', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const result = execute(setup.state, {
      type: 'CHOOSE_LEADER_CARDS', cid: 'c1', cardInstanceIds: [],
    }, freshRng(), makeRegistry(), catalog, 'p1');
    expect(result.accepted).toBe(false);
  });

  it('negativo: rechaza mas de 2 cartas en la puja', () => {
    const setup = setupGame(makeConfig(2), catalog);
    const hand = setup.state.players.p1.hand;
    const result = execute(setup.state, {
      type: 'CHOOSE_LEADER_CARDS', cid: 'c1',
      cardInstanceIds: [hand[0].instanceId, hand[1].instanceId, hand[2].instanceId],
    }, freshRng(), makeRegistry(), catalog, 'p1');
    expect(result.accepted).toBe(false);
  });

  it('negativo: rechaza puja fuera de INITIAL_PLAYER_SELECTION', () => {
    const state = startedState(catalog, 2);
    const card = state.players[state.activePlayerId].hand[0];
    const result = execute(state, {
      type: 'CHOOSE_LEADER_CARDS', cid: 'c1', cardInstanceIds: [card.instanceId],
    }, freshRng(), makeRegistry(), catalog, state.activePlayerId);
    expect(result.accepted).toBe(false);
  });

  it('positivo: las cartas pujadas van al FONDO del mazo de Habilidad', () => {
    const setup = setupGame(makeConfig(2), catalog);
    let state = setup.state;
    const p1 = state.players.p1;
    const bidCard = p1.hand[0];
    const deckBefore = p1.abilityDeck.map(c => c.instanceId);

    // p1 puja 1 carta; p2 puja 1 carta para completar
    state = { ...state, players: { ...state.players, p1: { ...p1, leaderBidCards: [bidCard.instanceId] } } };
    const p2card = state.players.p2.hand[0];
    state = { ...state, players: { ...state.players, p2: { ...state.players.p2, leaderBidCards: [p2card.instanceId] } } };

    const { state: resolved } = resolveLeaderBid(state, catalog);
    const p1Deck = resolved.players.p1.abilityDeck.map(c => c.instanceId);
    // p1 pujo 1 carta → la mano queda en 3 y roba 1 del frente para llegar a 4.
    // Mazo esperado: deckBefore sin la primera carta (robada) + bidCard al fondo.
    expect(p1Deck).toEqual([...deckBefore.slice(1), bidCard.instanceId]);
  });

  it('positivo: empate de daño → gana el jugador de mas edad', () => {
    const setup = setupGame(makeConfig(2), catalog);
    let state = setup.state;
    // Forzar empate: ambos pujan una carta con el mismo ataque impreso.
    // Usamos cartas del catalogo con printedAttack conocido.
    const atkCard = catalog.byId.get('warrior.sword-strike')!; // atk 1
    const mkCard = (pid: string, i: number): CardInstance => ({
      instanceId: `bid-${pid}-${i}`,
      definitionId: atkCard.id,
      ownerId: pid,
      zone: 'HAND' as Zone,
    });
    const c1 = mkCard('p1', 0);
    const c2 = mkCard('p2', 0);
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, hand: [c1], leaderBidCards: [c1.instanceId], playerAge: 30 },
        p2: { ...state.players.p2, hand: [c2], leaderBidCards: [c2.instanceId], playerAge: 50 },
      },
    };
    const { state: resolved, events } = resolveLeaderBid(state, catalog);
    expect(resolved.activePlayerId).toBe('p2'); // 50 > 30
    expect(events.some(e => e.type === 'LEADER_DETERMINED' && e.playerId === 'p2')).toBe(true);
  });

  it('positivo: tras la puja todos los jugadores roban hasta 4 cartas', () => {
    const setup = setupGame(makeConfig(2), catalog);
    let state = setup.state;
    for (const pid of state.playerOrder) {
      const two = state.players[pid].hand.slice(0, 2).map(c => c.instanceId);
      state = { ...state, players: { ...state.players, [pid]: { ...state.players[pid], leaderBidCards: two } } };
    }
    const { state: resolved } = resolveLeaderBid(state, catalog);
    for (const pid of resolved.playerOrder) {
      expect(resolved.players[pid].hand.length).toBe(4);
    }
  });
});

// ============================================================================
// §3.4 Evasion (Opcion B)
// ============================================================================

describe('§3.4 Evasion', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  it('positivo: evasion valida descarta a Desgaste, salta a MERCADO y no hay daño de Horda', () => {
    const state = startedState(catalog, 2);
    const pid = state.activePlayerId;
    const hand = state.players[pid].hand;
    const discarded = [hand[0].instanceId, hand[1].instanceId];

    const result = execute(state, {
      type: 'EVASION', cid: 'ev1', discardedCardInstanceIds: discarded,
    }, freshRng(), makeRegistry(), catalog, pid);

    expect(result.accepted).toBe(true);
    expect(result.events.some(e => e.type === 'EVASION_PERFORMED')).toBe(true);
    // Nunca debe llegar a HORDE_ATTACK
    expect(result.events.some(e => e.type === 'HORDE_ATTACKED')).toBe(false);
    expect(result.events.some(e => e.type === 'CARDS_LOST')).toBe(false);
    expect(result.events.some(e => e.type === 'PHASE_CHANGED' && e.phase === 'MARKET')).toBe(true);
    // Las cartas descartadas acaban en la pila de Desgaste
    const finalPlayer = result.newState.players[pid];
    expect(finalPlayer.wearPile.map(c => c.instanceId)).toEqual(
      expect.arrayContaining(discarded),
    );
    expect(finalPlayer.hand.map(c => c.instanceId)).not.toEqual(
      expect.arrayContaining(discarded),
    );
  });
});

// ============================================================================
// §3.5 Mercado (compra, restricciones, reposicion)
// ============================================================================

describe('§3.5 Mercado', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  function marketState(pid = 'p1', coins = 10): GameState {
    const state = makeGameState({ phase: 'MARKET', activePlayerId: pid });
    state.players[pid] = makePlayer({
      playerId: pid,
      coins,
      capabilities: ['RANGED', 'EXPERTISE'],
    });
    const marketCard: CardInstance = {
      instanceId: 'mkt-1',
      definitionId: 'market.whetstone', // coste 4, sin restricciones
      ownerId: 'market',
      zone: 'MARKET' as Zone,
    };
    const deckCard: CardInstance = {
      instanceId: 'mkt-deck-1',
      definitionId: 'market.elven-cloak',
      ownerId: 'market',
      zone: 'MARKET_DECK' as Zone,
    };
    state.market = [marketCard];
    state.marketDeck = [deckCard];
    return state;
  }

  it('positivo: compra valida descuenta monedas, carta a la mano y repone el mercado', () => {
    const state = marketState('p1', 10);
    const result = execute(state, {
      type: 'BUY_CARD', cid: 'buy1', marketCardInstanceId: 'mkt-1',
    }, freshRng(), makeRegistry(), catalog, 'p1');

    expect(result.accepted).toBe(true);
    const player = result.newState.players.p1;
    expect(player.coins).toBe(6); // 10 - 4
    expect(player.hand.some(c => c.instanceId === 'mkt-1')).toBe(true);
    // Reposicion automatica (espec. §3.5: siempre 5 disponibles)
    expect(result.events.some(e => e.type === 'MARKET_REPLENISHED')).toBe(true);
    expect(result.newState.market.some(c => c.instanceId === 'mkt-deck-1')).toBe(true);
  });

  it('negativo: rechaza compra sin monedas suficientes', () => {
    const state = marketState('p1', 2); // whetstone cuesta 4
    const legal = isLegal(state, 'p1', {
      type: 'BUY_CARD', cid: 'buy2', marketCardInstanceId: 'mkt-1',
    }, catalog);
    expect(legal.ok).toBe(false);
  });

  it('negativo: rechaza compra sin la capacidad requerida', () => {
    const state = marketState('p1', 10);
    // Alabarda de orco requiere MELEE; el jugador tiene RANGED+EXPERTISE
    // y la carta no tiene penaltyCapabilities → no puede comprarla
    state.market = [{
      instanceId: 'mkt-halb',
      definitionId: 'market.orc-halberd',
      ownerId: 'market',
      zone: 'MARKET' as Zone,
    }];
    const legal = isLegal(state, 'p1', {
      type: 'BUY_CARD', cid: 'buy3', marketCardInstanceId: 'mkt-halb',
    }, catalog);
    expect(legal.ok).toBe(false);
  });

  it('positivo: permite comprar con capacidad penalizada (Pericia → -1 daño)', () => {
    const state = marketState('p1', 10);
    // Arco compuesto requiere RANGED con penalizacion EXPERTISE -1;
    // el jugador tiene EXPERTISE → compra permitida con penalizacion
    state.market = [{
      instanceId: 'mkt-bow',
      definitionId: 'market.composite-bow',
      ownerId: 'market',
      zone: 'MARKET' as Zone,
    }];
    const legal = isLegal(state, 'p1', {
      type: 'BUY_CARD', cid: 'buy4', marketCardInstanceId: 'mkt-bow',
    }, catalog);
    expect(legal.ok).toBe(true);
  });
});

// ============================================================================
// §3.6 Restablecimiento (mano a 4, reciclaje, reposicion, iconos)
// ============================================================================

describe('§3.6 Restablecimiento', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  it('positivo: con mas de 4 cartas en mano, el exceso va a Desgaste', () => {
    const state = makeGameState({ phase: 'RESTORATION', activePlayerId: 'p1' });
    const hand = makeCards(6, { ownerId: 'p1' });
    state.players.p1 = makePlayer({ playerId: 'p1', hand, abilityDeck: makeCards(3, { ownerId: 'p1' }) });
    const rng = freshRng();
    const result = processPhases(state, rng, catalog);
    // El jugador elige qué descartar (elección pendiente)
    const choice = result.state.pendingChoices.find(c => c.choiceId.startsWith('restoration-discard-'));
    expect(choice).toBeDefined();
    expect(choice!.minSelections).toBe(2);
    // Resolver: descarta las 2 últimas cartas
    const res = execute(
      result.state,
      { type: 'RESOLVE_CHOICE', cid: 'rd1', choiceId: choice!.choiceId, selectedIds: [hand[4].instanceId, hand[5].instanceId] },
      rng, new EffectRegistry(), catalog,
    );
    const after = processPhases(res.newState, rng, catalog);
    const p1 = after.state.players.p1;
    expect(p1.hand.length).toBe(4);
    expect(p1.wearPile.length).toBe(2);
    // Las cartas elegidas son las que van a Desgaste
    expect(p1.wearPile.map(c => c.instanceId)).toEqual([hand[4].instanceId, hand[5].instanceId]);
  });

  it('positivo: mazo agotado al robar → 1 Herida + barajar Desgaste', () => {
    const state = makeGameState({ phase: 'RESTORATION', activePlayerId: 'p1' });
    state.players.p1 = makePlayer({
      playerId: 'p1',
      hand: makeCards(2, { ownerId: 'p1' }),
      abilityDeck: [],
      wearPile: makeCards(3, { ownerId: 'p1', zone: 'WEAR_PILE' as Zone }),
      wounds: 0,
    });
    const result = processPhases(state, freshRng(), catalog);
    expect(result.events.some(e => e.type === 'HERO_WOUNDED')).toBe(true);
    expect(result.events.some(e => e.type === 'DECK_RESHUFFLED')).toBe(true);
    expect(result.state.players.p1.hand.length).toBe(4);
    expect(result.state.players.p1.wounds).toBe(1);
  });

  it('positivo: reposicion — 1-2 enemigos → robar 1; 3 enemigos → no robar', () => {
    const hordeCard = (i: number): CardInstance => ({
      instanceId: `h${i}`, definitionId: 'horde.001', ownerId: 'horde', zone: 'HORDE_DECK' as Zone,
    });
    // 2 enemigos → robar 1
    let state = makeGameState({ phase: 'BATTLEFIELD_REPLENISHMENT', activePlayerId: 'p1' });
    state.battlefield = makeEnemiesForTest(2);
    state.hordeDeck = [hordeCard(1), hordeCard(2), hordeCard(3)];
    let result = processPhases(state, freshRng(), catalog);
    expect(result.events.filter(e => e.type === 'ENEMY_REVEALED').length).toBe(1);

    // 3 enemigos → no robar
    state = makeGameState({ phase: 'BATTLEFIELD_REPLENISHMENT', activePlayerId: 'p1' });
    state.battlefield = makeEnemiesForTest(3);
    state.hordeDeck = [hordeCard(1)];
    result = processPhases(state, freshRng(), catalog);
    expect(result.events.filter(e => e.type === 'ENEMY_REVEALED').length).toBe(0);

    // 0 enemigos → robar 3 (sin escenario para simplificar)
    state = makeGameState({ phase: 'BATTLEFIELD_REPLENISHMENT', activePlayerId: 'p1' });
    state.battlefield = [];
    state.hordeDeck = [hordeCard(1), hordeCard(2), hordeCard(3), hordeCard(4)];
    result = processPhases(state, freshRng(), catalog);
    expect(result.events.filter(e => e.type === 'ENEMY_REVEALED').length).toBe(3);
  });

  it('positivo: las Heridas de enemigos con icono Heridas temporales se descartan', () => {
    const state = makeGameState({ phase: 'RESTORATION', activePlayerId: 'p1' });
    state.battlefield = [
      makeEnemy({ instanceId: 'e-temp', wounds: 2, specialIcons: ['TEMPORARY_WOUNDS'] }),
      makeEnemy({ instanceId: 'e-normal', wounds: 2 }),
    ];
    const result = processPhases(state, freshRng(), catalog);
    const temp = result.state.battlefield.find(e => e.instanceId === 'e-temp');
    const normal = result.state.battlefield.find(e => e.instanceId === 'e-normal');
    expect(temp?.wounds).toBe(0);
    expect(normal?.wounds).toBe(2);
  });
});

function makeEnemiesForTest(n: number) {
  return Array.from({ length: n }, (_, i) =>
    makeEnemy({ instanceId: `enemy-${i}`, baseFortitude: 3 }),
  );
}

// ============================================================================
// §3.7 Senor de la Guerra
// ============================================================================

describe('§3.7 Senor de la Guerra', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  it('positivo: cada carta que cause >=1 daño al Señor otorga 1 Gloria', () => {
    const state = makeGameState({ activePlayerId: 'p1' });
    const warlord = makeEnemy({
      instanceId: 'wl-1',
      definitionId: 'warlord.gurdrug',
      isWarlord: true,
      baseFortitude: 8,
    });
    state.battlefield = [warlord];
    const player = state.players.p1;
    const card = makeCard({ definitionId: 'warrior.brutal-attack', ownerId: 'p1' }); // atk 3
    const cardDef = catalog.byId.get('warrior.brutal-attack')!;

    const result = resolveCard(state, card, cardDef, 'wl-1', player, freshRng(), makeRegistry(), catalog);
    const gloryEvents = result.events.filter(e => e.type === 'GLORY_GAINED');
    expect(gloryEvents.length).toBe(1);
    expect(gloryEvents[0].type === 'GLORY_GAINED' && gloryEvents[0].amount).toBe(1);
  });

  it('negativo: una carta sin daño no otorga Gloria del Señor', () => {
    const state = makeGameState({ activePlayerId: 'p1' });
    const warlord = makeEnemy({
      instanceId: 'wl-1',
      definitionId: 'warlord.gurdrug',
      isWarlord: true,
      baseFortitude: 8,
    });
    state.battlefield = [warlord];
    const player = state.players.p1;
    const card = makeCard({ definitionId: 'warrior.shield', ownerId: 'p1' }); // atk 0
    const cardDef = catalog.byId.get('warrior.shield')!;

    const result = resolveCard(state, card, cardDef, 'wl-1', player, freshRng(), makeRegistry(), catalog);
    expect(result.events.filter(e => e.type === 'GLORY_GAINED').length).toBe(0);
  });

  it('positivo (Pericia Gurdrug): cada carta que dañe al Jefe provoca perder 1 carta', () => {
    const state = makeGameState({ activePlayerId: 'p1' });
    state.battlefield = [makeEnemy({
      instanceId: 'wl-g', definitionId: 'warlord.gurdrug', isWarlord: true, baseFortitude: 8,
    })];
    const deck = makeCards(5, { ownerId: 'p1', zone: 'ABILITY_DECK' as Zone });
    state.players.p1 = makePlayer({ playerId: 'p1', abilityDeck: deck });
    const player = state.players.p1;
    const card = makeCard({ definitionId: 'warrior.sword-strike', ownerId: 'p1' }); // atk 1
    const cardDef = catalog.byId.get('warrior.sword-strike')!;

    const result = resolveCard(state, card, cardDef, 'wl-g', player, freshRng(), makeRegistry(), catalog);
    // Gurdrug: 1 carta adicional perdida por dañarlo
    expect(result.events.some(e => e.type === 'CARDS_LOST')).toBe(true);
  });

  it('positivo (Pericia Shriekknifer): carta de Daño 1 que le daña → recuperar 1 carta', () => {
    const state = makeGameState({ activePlayerId: 'p1' });
    state.battlefield = [makeEnemy({
      instanceId: 'wl-s', definitionId: 'warlord.shriekknifer', isWarlord: true, baseFortitude: 10,
    })];
    const worn = makeCards(3, { ownerId: 'p1', zone: 'WEAR_PILE' as Zone });
    // Mazo no vacío para que el robo de Espadazo no recicle el Desgaste
    // (Herida + barajado), lo que vaciaría la pila antes de la Pericia
    const deck = makeCards(5, { ownerId: 'p1', zone: 'ABILITY_DECK' as Zone });
    state.players.p1 = makePlayer({ playerId: 'p1', wearPile: worn, abilityDeck: deck });
    const player = state.players.p1;
    const card = makeCard({ definitionId: 'warrior.sword-strike', ownerId: 'p1' }); // atk 1
    const cardDef = catalog.byId.get('warrior.sword-strike')!;

    const result = resolveCard(state, card, cardDef, 'wl-s', player, freshRng(), makeRegistry(), catalog);
    expect(result.events.some(e => e.type === 'CARDS_RECOVERED')).toBe(true);
  });

  it('negativo (Pericia Shriekknifer): carta de Daño != 1 no recupera', () => {
    const state = makeGameState({ activePlayerId: 'p1' });
    state.battlefield = [makeEnemy({
      instanceId: 'wl-s', definitionId: 'warlord.shriekknifer', isWarlord: true, baseFortitude: 10,
    })];
    state.players.p1 = makePlayer({
      playerId: 'p1',
      wearPile: makeCards(3, { ownerId: 'p1', zone: 'WEAR_PILE' as Zone }),
    });
    const player = state.players.p1;
    const card = makeCard({ definitionId: 'warrior.brutal-attack', ownerId: 'p1' }); // atk 3
    const cardDef = catalog.byId.get('warrior.brutal-attack')!;

    const result = resolveCard(state, card, cardDef, 'wl-s', player, freshRng(), makeRegistry(), catalog);
    expect(result.events.some(e => e.type === 'CARDS_RECOVERED')).toBe(false);
  });

  it('positivo: al entrar el Señor el escenario activo se descarta y no se reemplaza', () => {
    const state = makeGameState({ phase: 'BATTLEFIELD_REPLENISHMENT', activePlayerId: 'p1' });
    state.battlefield = makeEnemiesForTest(2); // robará 1
    state.scenario = {
      instanceId: 'sc-1', definitionId: 'scenario.battlefield', ownerId: 'scenario',
      zone: 'SCENARIO_ACTIVE' as Zone,
    };
    state.scenarioDeck = [{
      instanceId: 'sc-2', definitionId: 'scenario.skaarg-plains', ownerId: 'scenario',
      zone: 'SCENARIO_DECK' as Zone,
    }];
    // El Señor esta al fondo del mazo de la Horda (ultima en salir = ultimo elemento)
    state.hordeDeck = [
      { instanceId: 'h-top', definitionId: 'warlord.gurdrug', ownerId: 'horde', zone: 'HORDE_DECK' as Zone },
    ];
    // Espera: el replenish roba desde el FINAL del array (parte inferior del mazo)
    const result = processPhases(state, freshRng(), catalog);
    expect(result.events.some(e => e.type === 'WARLORD_REVEALED')).toBe(true);
    expect(result.events.some(e => e.type === 'SCENARIO_DISCARDED')).toBe(true);
    // No se revela un nuevo escenario tras el Señor
    const newScenarioReveals = result.events.filter(
      e => e.type === 'SCENARIO_REVEALED' && e.scenarioInstanceId === 'sc-2',
    );
    expect(newScenarioReveals.length).toBe(0);
    expect(result.state.scenario).toBeNull();
  });
});

// ============================================================================
// §3.8 Fin de partida y puntuacion
// ============================================================================

describe('§3.8 Puntuacion final', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  function endState(): GameState {
    const state = makeGameState({
      phase: 'GAME_END_CHECK',
      activePlayerId: 'p1',
      battlefield: [],
      warlordRevealed: true,
      warlordDefeated: true,
      warlordsDefeatedCount: 1,
      players: {
        p1: makePlayer({ playerId: 'p1', glory: 5, coins: 7, wounds: 0, trophies: ['t1', 't2'] }),
        p2: makePlayer({ playerId: 'p2', glory: 4, coins: 3, wounds: 1, trophies: ['t3'] }),
      },
      playerOrder: ['p1', 'p2'],
      // Necesario para requiredWarlordKills: 1 warlord ya contado
      eventLog: [{ type: 'WARLORD_REVEALED', warlordInstanceId: 'w', definitionId: 'warlord.gurdrug', seq: 0 }],
    });
    state.hordeDeck = [];
    return state;
  }

  it('positivo: puntuacion = Gloria + floor(monedas/3) + Tenaz(+1 sin heridas)', () => {
    const result = processPhases(endState(), freshRng(), catalog);
    const endEvent = result.events.find(e => e.type === 'GAME_ENDED');
    expect(endEvent).toBeDefined();
    if (endEvent?.type === 'GAME_ENDED') {
      // p1: 5 gloria + floor(7/3)=2 + 1 tenaz = 8
      // p2: 4 gloria + floor(3/3)=1 + 0 (tiene heridas) = 5
      expect(endEvent.scores.p1).toBe(8);
      expect(endEvent.scores.p2).toBe(5);
      expect(endEvent.winnerId).toBe('p1');
    }
    expect(result.state.phase).toBe('FINISHED');
  });

  it('positivo: empate de Gloria → gana quien tiene mas trofeos', () => {
    const state = endState();
    // p1: 5 + 2 + 0 (1 herida) = 7; p2: 6 + 0 + 1 (sin heridas) = 7 → empate
    state.players.p1 = makePlayer({ playerId: 'p1', glory: 5, coins: 6, wounds: 1, trophies: ['t1'] });
    state.players.p2 = makePlayer({ playerId: 'p2', glory: 6, coins: 0, wounds: 0, trophies: ['t2', 't3'] });
    const result = processPhases(state, freshRng(), catalog);
    const endEvent = result.events.find(e => e.type === 'GAME_ENDED');
    if (endEvent?.type === 'GAME_ENDED') {
      expect(endEvent.scores.p1).toBe(7);
      expect(endEvent.scores.p2).toBe(7);
      expect(endEvent.winnerId).toBe('p2'); // mas trofeos (2 vs 1)
    }
  });

  it('negativo: derrota colectiva si todos los heroes estan eliminados', () => {
    const state = endState();
    state.players.p1 = makePlayer({ playerId: 'p1', wounds: 4, maxWounds: 4 });
    state.players.p2 = makePlayer({ playerId: 'p2', wounds: 4, maxWounds: 4 });
    const result = processPhases(state, freshRng(), catalog);
    const endEvent = result.events.find(e => e.type === 'GAME_ENDED');
    if (endEvent?.type === 'GAME_ENDED') {
      expect(endEvent.winnerId).toBeNull();
    }
    expect(result.state.phase).toBe('FINISHED');
  });
});

// ============================================================================
// §3.9 Iconos especiales
// ============================================================================

describe('§3.9 Iconos especiales', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  it('positivo: Anti-Magia reduce el daño de la Horda a heroes con Magia', () => {
    // Enemigo con ANTI_MAGIC, fortaleza 4. Heroe con MAGIC → daño 4-1=3.
    const state = makeGameState({ phase: 'HORDE_ATTACK', activePlayerId: 'p1' });
    state.players.p1 = makePlayer({
      playerId: 'p1',
      capabilities: ['MAGIC'],
      abilityDeck: makeCards(10, { ownerId: 'p1' }),
    });
    state.battlefield = [
      makeEnemy({ instanceId: 'am-1', baseFortitude: 4, specialIcons: ['ANTI_MAGIC'] }),
    ];
    const result = processPhases(state, freshRng(), catalog);
    const lost = result.events.find(e => e.type === 'CARDS_LOST');
    if (lost?.type === 'CARDS_LOST') {
      expect(lost.count).toBe(3); // 4 - 1 anti-magia
    }
  });

  it('negativo: Anti-Magia NO reduce el daño a heroes sin Magia', () => {
    const state = makeGameState({ phase: 'HORDE_ATTACK', activePlayerId: 'p1' });
    state.players.p1 = makePlayer({
      playerId: 'p1',
      capabilities: ['MELEE'],
      abilityDeck: makeCards(10, { ownerId: 'p1' }),
    });
    state.battlefield = [
      makeEnemy({ instanceId: 'am-1', baseFortitude: 4, specialIcons: ['ANTI_MAGIC'] }),
    ];
    const result = processPhases(state, freshRng(), catalog);
    const lost = result.events.find(e => e.type === 'CARDS_LOST');
    if (lost?.type === 'CARDS_LOST') {
      expect(lost.count).toBe(4); // sin reduccion
    }
  });

  it('positivo: Pocion Curativa se retira del juego tras usarse (no va a Desgaste)', () => {
    const state = makeGameState({ activePlayerId: 'p1' });
    state.battlefield = [makeEnemy({ instanceId: 'e1', baseFortitude: 3 })];
    const player = state.players.p1;
    const card = makeCard({ definitionId: 'market.healing-potion', ownerId: 'p1' });
    const cardDef = catalog.byId.get('market.healing-potion')!;

    const result = resolveCard(state, card, cardDef, 'e1', player, freshRng(), makeRegistry(), catalog);
    expect(result.events.some(e => e.type === 'CARD_REMOVED_FROM_GAME')).toBe(true);
    const toWear = result.events.find(
      e => e.type === 'CARD_MOVED' && e.cardInstanceId === card.instanceId && e.to === 'WEAR_PILE',
    );
    expect(toWear).toBeUndefined();
  });
});

// ============================================================================
// §3.4 Ataque — validaciones adicionales
// ============================================================================

describe('§3.4 Ataque — validaciones', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  it('negativo: rechaza PLAY_CARD con objetivo que no existe en el campo', () => {
    const state = startedState(catalog, 2);
    const pid = state.activePlayerId;
    const card = state.players[pid].hand[0];
    const legal = isLegal(state, pid, {
      type: 'PLAY_CARD', cid: 'pc1', cardInstanceId: card.instanceId,
      targetEnemyId: 'enemigo-inexistente',
    }, catalog);
    expect(legal.ok).toBe(false);
  });

  it('negativo: rechaza jugar Engañar sin las 2 monedas de coste', () => {
    const state = startedState(catalog, 2);
    const pid = state.activePlayerId;
    const deceive = makeCard({ definitionId: 'rogue.deceive', ownerId: pid });
    const s: GameState = {
      ...state,
      players: {
        ...state.players,
        [pid]: { ...state.players[pid], coins: 1, hand: [...state.players[pid].hand, deceive] },
      },
    };
    const legal = isLegal(s, pid, {
      type: 'PLAY_CARD', cid: 'pc2', cardInstanceId: deceive.instanceId,
      targetEnemyId: s.battlefield[0]?.instanceId,
    }, catalog);
    expect(legal.ok).toBe(false);
  });

  it('negativo: pericia reactiva (Valerys) fuera de HORDE_ATTACK', () => {
    const state = startedState(catalog, 2);
    const s: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: { ...state.players.p2, heroId: 'hero.valerys', heroUsesRemaining: 1 },
      },
    };
    const legal = isLegal(s, 'p2', { type: 'USE_HERO_ABILITY', cid: 'ua1' }, catalog);
    expect(legal.ok).toBe(false);
  });
});

// ============================================================================
// Elecciones pendientes (RESOLVE_CHOICE) — §20.5/§22
// ============================================================================

describe('RESOLVE_CHOICE — validacion de elecciones', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  function choiceState(): GameState {
    const state = makeGameState({ activePlayerId: 'p1' });
    state.pendingChoices = [{
      choiceId: 'ch-1',
      playerId: 'p1',
      type: 'SELECT_ENEMY',
      prompt: 'Elige un enemigo',
      options: ['e1', 'e2'],
      minSelections: 1,
      maxSelections: 1,
    }];
    return state;
  }

  it('negativo: rechaza resolver la eleccion de otro jugador', () => {
    const state = choiceState();
    const legal = isLegal(state, 'p2', {
      type: 'RESOLVE_CHOICE', cid: 'rc1', choiceId: 'ch-1', selectedIds: ['e1'],
    }, catalog);
    expect(legal.ok).toBe(false);
  });

  it('negativo: rechaza seleccion fuera de las opciones', () => {
    const state = choiceState();
    const legal = isLegal(state, 'p1', {
      type: 'RESOLVE_CHOICE', cid: 'rc2', choiceId: 'ch-1', selectedIds: ['e99'],
    }, catalog);
    expect(legal.ok).toBe(false);
  });

  it('negativo: rechaza mas selecciones que el maximo', () => {
    const state = choiceState();
    const legal = isLegal(state, 'p1', {
      type: 'RESOLVE_CHOICE', cid: 'rc3', choiceId: 'ch-1', selectedIds: ['e1', 'e2'],
    }, catalog);
    expect(legal.ok).toBe(false);
  });

  it('negativo: rechaza eleccion inexistente', () => {
    const state = choiceState();
    const legal = isLegal(state, 'p1', {
      type: 'RESOLVE_CHOICE', cid: 'rc4', choiceId: 'ch-99', selectedIds: ['e1'],
    }, catalog);
    expect(legal.ok).toBe(false);
  });
});

// ============================================================================
// §4 Modo solitario
// ============================================================================

describe('§4 Solitario', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetSoloSeq(); resetTestCounters();
    catalog = loadCatalog();
  });

  function soloConfig(): GameConfig {
    return {
      mode: 'SOLO',
      playerCount: 1,
      seed: 'test-solo-rules',
      heroes: [{ playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' }],
      useScenarios: true,
      soloSupportHeroIds: ['hero.feldon', 'hero.neddia', 'hero.taheral'],
    };
  }

  it('positivo: la Horda solitaria excluye Huestes de Fortaleza 2', () => {
    const { state } = setupGame(soloConfig(), catalog);
    for (const c of state.hordeDeck) {
      const def = catalog.byId.get(c.definitionId);
      if (def?.type === 'HORDE') {
        expect(def.printedFortitude).not.toBe(2);
      }
    }
  });

  it('positivo: los escenarios excluidos no entran en el mazo solitario', () => {
    const { state } = setupGame(soloConfig(), catalog);
    const ids = [
      ...state.scenarioDeck.map(c => c.definitionId),
      ...(state.scenario ? [state.scenario.definitionId] : []),
    ];
    expect(ids).not.toContain('scenario.tears-of-aradiel');
    expect(ids).not.toContain('scenario.cemenmar-wastes');
  });

  it('positivo: el mercado solitario no se repone tras una compra', () => {
    const { state } = setupGame(soloConfig(), catalog);
    const s: GameState = { ...state, phase: 'MARKET' as const, activePlayerId: 'p1' };
    s.players.p1 = { ...s.players.p1, coins: 10, capabilities: ['RANGED', 'EXPERTISE', 'MELEE', 'MAGIC'] };
    const target = s.market[0];
    const result = execute(s, {
      type: 'BUY_CARD', cid: 'sb', marketCardInstanceId: target.instanceId,
    }, freshRng(), makeRegistry(), catalog, 'p1');
    expect(result.accepted).toBe(true);
    expect(result.events.some(e => e.type === 'MARKET_REPLENISHED')).toBe(false);
  });

  it('positivo: costes secuenciales de apertura de Apoyos (3, +2, +1)', () => {
    const { state } = setupGame(soloConfig(), catalog);
    let s: GameState = state;
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, coins: 20 } } };

    const r1 = openSupportDeck(s, 'p1', 0);
    expect(r1.error).toBeUndefined();
    expect(r1.events.find(e => e.type === 'COINS_GAINED' && e.amount === -3)).toBeDefined();

    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, supportDecksOpened: 1 } } };
    const r2 = openSupportDeck(s, 'p1', 1);
    expect(r2.error).toBeUndefined();
    expect(r2.events.find(e => e.type === 'COINS_GAINED' && e.amount === -5)).toBeDefined();

    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, supportDecksOpened: 2 } } };
    const r3 = openSupportDeck(s, 'p1', 2);
    expect(r3.error).toBeUndefined();
    expect(r3.events.find(e => e.type === 'COINS_GAINED' && e.amount === -6)).toBeDefined();
  });

  it('negativo: no se puede abrir el segundo mazo de Apoyo sin abrir el primero', () => {
    const { state } = setupGame(soloConfig(), catalog);
    const s: GameState = { ...state, players: { ...state.players, p1: { ...state.players.p1, coins: 20 } } };
    const r = openSupportDeck(s, 'p1', 1);
    expect(r.error).toBe('Must open the next sequential support deck');
  });

  it('negativo: solo se puede usar 1 mazo de Apoyo por turno', () => {
    const { state } = setupGame(soloConfig(), catalog);
    let s: GameState = { ...state, players: { ...state.players, p1: { ...state.players.p1, coins: 20, supportDecksOpened: 2 } } };
    const r1 = buySupportCard(s, 'p1', 0, { type: 'COINS', amount: 5 });
    expect(r1.error).toBeUndefined();
    s = r1.state;
    // Intentar usar el otro mazo el mismo turno
    const r2 = buySupportCard(s, 'p1', 1, { type: 'COINS', amount: 5 });
    expect(r2.error).toBe('Already used a different support deck this turn');
  });

  it('positivo: la carta de Apoyo usada vuelve al fondo de su mazo al final del turno', () => {
    const { state } = setupGame(soloConfig(), catalog);
    let s: GameState = { ...state, players: { ...state.players, p1: { ...state.players.p1, coins: 20, supportDecksOpened: 1 } } };
    const r = buySupportCard(s, 'p1', 0, { type: 'COINS', amount: 5 });
    expect(r.error).toBeUndefined();
    s = r.state;
    const borrowedId = s.players.p1.borrowedSupportCardIds?.[0];
    expect(borrowedId).toBeDefined();
    const deckBefore = s.players.p1.supportDecks[0].length;

    // Simular que la carta fue usada: esta en la pila de Desgaste
    const borrowedCard = s.players.p1.hand.find(c => c.instanceId === borrowedId)!;
    s = {
      ...s,
      phase: 'TURN_END' as const,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: s.players.p1.hand.filter(c => c.instanceId !== borrowedId),
          wearPile: [...s.players.p1.wearPile, { ...borrowedCard, zone: 'WEAR_PILE' as Zone }],
        },
      },
    };
    const result = processPhases(s, freshRng(), catalog);
    const supportDeck = result.state.players.p1.supportDecks[0];
    // La carta vuelve al mazo de Apoyo (al fondo)
    expect(supportDeck.length).toBe(deckBefore + 1);
    expect(supportDeck[supportDeck.length - 1].instanceId).toBe(borrowedId);
  });

  it('positivo: intercambio de hasta 2 cartas iniciales (cambian a fondo + roban)', () => {
    const { state } = setupGame(soloConfig(), catalog);
    const s = { ...state, phase: 'INITIAL_PLAYER_SELECTION' as const };
    const hand = s.players.p1.hand;
    const swapIds = [hand[0].instanceId, hand[1].instanceId];
    const result = swapStartingCards(s, 'p1', swapIds, freshRng());
    expect(result.error).toBeUndefined();
    const p1 = result.state.players.p1;
    expect(p1.hand.length).toBe(4); // roba 2 nuevas
    // Las cambiadas estan al fondo del mazo
    const deckIds = p1.abilityDeck.map(c => c.instanceId);
    expect(deckIds.slice(-2)).toEqual(expect.arrayContaining(swapIds));
  });

  it('negativo: no se pueden intercambiar mas de 2 cartas', () => {
    const { state } = setupGame(soloConfig(), catalog);
    const s = { ...state, phase: 'INITIAL_PLAYER_SELECTION' as const };
    const hand = s.players.p1.hand;
    const result = swapStartingCards(s, 'p1', hand.map(c => c.instanceId).slice(0, 3), freshRng());
    expect(result.error).toBe('Can only swap up to 2 cards');
  });
});
