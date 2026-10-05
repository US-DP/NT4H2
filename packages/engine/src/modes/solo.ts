/**
 * SoloMode — reglas especiales del modo solitario.
 *
 * Diferencias respecto al modo estandar:
 * 1. Huestes sin F2 (no hay segunda cara de recompensa).
 * 2. 6 monedas iniciales (en lugar de 2).
 * 3. 5 cartas de Mercado (en lugar de 4).
 * 4. Sistema de Apoyos: pagar para abrir mazos de Apoyo (3 / +2 / +1 monedas)
 *    y robar cartas de ellos (2 Gloria o 5 monedas la 1ª, +1G/+2M las extra).
 * 5. Excepciones (spec §4.4):
 *    - Robar Bolsillos: sin otros heroes, la moneda viene de la reserva.
 *    - Disparo Rapido desde Apoyo: roba del propio mazo de Apoyo.
 *    - Cartas que danan/recuperan a "otros heroes" solo hacen efecto desde un
 *      mazo de Apoyo, y se aplican al propio jugador.
 *    - Si el mazo del jugador se agota robando (p.ej. Disparo Rapido propio),
 *      Herida + reciclaje de Desgaste como siempre.
 * 6. Puntuacion solitaria: basada en Gloria + bonificaciones por condiciones.
 */

import type {
  GameState,
  GameEvent,
  GameConfig,
  Zone,
} from '@nt4h/schema';
import { DeterministicRng } from '../rng/index.js';
import type { CatalogLoadResult } from '@nt4h/catalog';
import { setupGame } from '../phases/setup.js';
import { nextSeq, resetSeq } from '../seq.js';

// D426: alias por compatibilidad — resetSeq ahora es global (§51.12)
export function resetSoloSeq(): void {
  resetSeq();
}

/**
 * Configurar el modo solitario:
 * - 6 monedas iniciales
 * - 5 cartas de Mercado
 * - Mazos de Apoyo (uno por heroe seleccionado)
 * - Huestes sin F2 (recompensas simplificadas)
 */
export function setupSoloMode(
  config: GameConfig,
  catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[]; rng: DeterministicRng; errors: string[] } {
  const errors: string[] = [];

  // Validar que es modo solitario
  if (config.mode !== 'SOLO') {
    errors.push('Config mode is not SOLO');
    return { state: createEmptyState(), events: [], rng: new DeterministicRng(config.seed), errors };
  }

  // Validar que hay exactamente 1 jugador
  if (config.heroes.length !== 1) {
    errors.push('Solo mode requires exactly 1 player');
    return { state: createEmptyState(), events: [], rng: new DeterministicRng(config.seed), errors };
  }

  // D408: Delegar en setupGame (implementacion canonica). setupGame ya maneja
  // todas las reglas de solitario: Horda sin F2, 6 monedas, 5 cartas de Mercado
  // sin reposicion, mazos de Apoyo, escenarios filtrados, efectos de escenario,
  // WARLORD_REVEALED, eventos de setup y RNG determinista.
  return setupGame(config, catalog);
}

/**
 * Sistema de Apoyos en modo solitario (especificacion §4.2).
 *
 * Costes de apertura de mazos de Apoyo:
 * - 1er mazo: 3 monedas
 * - 2º mazo: +2 monedas (5 total)
 * - 3er mazo: +1 moneda (6 total)
 *
 * Robar 1 carta de un mazo de Apoyo:
 * - Pagar 2 Gloria O 5 monedas por la primera carta
 * - +1 Gloria O +2 monedas por cada carta adicional
 *
 * Solo se puede usar 1 mazo de Apoyo por turno.
 * La carta robada se devuelve al fondo de su mazo al final del turno.
 */
export function openSupportDeck(
  state: GameState,
  playerId: string,
  supportDeckIndex: number,
): { state: GameState; events: GameEvent[]; error?: string } {
  const events: GameEvent[] = [];
  const player = state.players[playerId];
  if (!player) return { state, events, error: 'Player not found' };

  if (supportDeckIndex < 0 || supportDeckIndex >= player.supportDecks.length) {
    return { state, events, error: 'Invalid support deck index' };
  }

  // D362: Los mazos deben abrirse secuencialmente (spec §4.1)
  // El coste es 3 para el 1er mazo, 5 para el 2º, 6 para el 3º
  const openedCount = player.supportDecksOpened ?? 0;
  // D434: la spec solo contempla 3 mazos de Apoyo (3 / +2 / +1 monedas)
  if (openedCount >= 3) {
    return { state, events, error: 'Maximum 3 support decks allowed' };
  }
  if (supportDeckIndex !== openedCount) {
    return { state, events, error: 'Must open the next sequential support deck' };
  }

  let cost: number;
  if (openedCount === 0) cost = 3;
  else if (openedCount === 1) cost = 5;
  else cost = 6;

  if (player.coins < cost) {
    return { state, events, error: `Not enough coins (need ${cost})` };
  }

  events.push({
    type: 'COINS_LOST',
    playerId,
    amount: cost,
    seq: nextSeq(),
  });
  // D434: evento explicito para que el replay restaure supportDecksOpened
  events.push({
    type: 'SUPPORT_DECK_OPENED',
    playerId,
    supportDeckIndex,
    seq: nextSeq(),
  });

  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          // D350: No pre-descontar coins; el evento COINS_LOST ya aplica el descuento
          supportDecksOpened: openedCount + 1,
        },
      },
    },
    events,
  };
}

/**
 * Robar 1 carta de un mazo de Apoyo.
 * Pagar 2 Gloria O 5 monedas por la primera; +1 Gloria O +2 monedas por cada extra.
 */
export function buySupportCard(
  state: GameState,
  playerId: string,
  supportDeckIndex: number,
  payment: { type: 'GLORY'; amount: number } | { type: 'COINS'; amount: number },
): { state: GameState; events: GameEvent[]; error?: string } {
  const events: GameEvent[] = [];
  const player = state.players[playerId];
  if (!player) return { state, events, error: 'Player not found' };

  if (supportDeckIndex < 0 || supportDeckIndex >= player.supportDecks.length) {
    return { state, events, error: 'Invalid support deck index' };
  }

  // D358: Verificar que el mazo de Apoyo haya sido abierto previamente
  const openedCount = player.supportDecksOpened ?? 0;
  if (supportDeckIndex >= openedCount) {
    return { state, events, error: 'Support deck not opened yet' };
  }

  // Especificacion §4.2: solo se puede usar un mazo de Apoyo por turno
  const usedIndex = player.supportDeckIndexUsedThisTurn ?? null;
  if (usedIndex !== null && usedIndex !== supportDeckIndex) {
    return { state, events, error: 'Already used a different support deck this turn' };
  }

  const supportDeck = player.supportDecks[supportDeckIndex];
  if (supportDeck.length === 0) {
    return { state, events, error: 'Support deck is empty' };
  }

  // Coste: primera carta = 2 Gloria o 5 monedas; cada extra = +1 Gloria o +2 monedas
  const cardsDrawnThisTurn = player.supportCardsDrawnThisTurn ?? 0;
  const gloryCost = 2 + cardsDrawnThisTurn;
  const coinsCost = 5 + cardsDrawnThisTurn * 2;

  if (payment.type === 'GLORY') {
    // Pago exacto: el declarado debe igualar el coste (sin sobrepagos)
    if (!Number.isFinite(payment.amount) || payment.amount !== gloryCost) {
      return { state, events, error: `Declared payment ${payment.amount} does not match required ${gloryCost} glory` };
    }
    if (player.glory < gloryCost) {
      return { state, events, error: `Not enough glory (need ${gloryCost})` };
    }
    events.push({
      type: 'GLORY_LOST',
      playerId,
      amount: gloryCost,
      seq: nextSeq(),
    });
  } else {
    if (!Number.isFinite(payment.amount) || payment.amount !== coinsCost) {
      return { state, events, error: `Declared payment ${payment.amount} does not match required ${coinsCost} coins` };
    }
    if (player.coins < coinsCost) {
      return { state, events, error: `Not enough coins (need ${coinsCost})` };
    }
    events.push({
      type: 'COINS_LOST',
      playerId,
      amount: coinsCost,
      seq: nextSeq(),
    });
  }

  const drawnCard = supportDeck[0];
  const remainingDeck = supportDeck.slice(1);

  events.push({
    type: 'CARDS_DRAWN',
    playerId,
    count: 1,
    cardInstanceIds: [drawnCard.instanceId],
    seq: nextSeq(),
  });

  // D350: No pre-descontar glory/coins aquí; los eventos GLORY_LOST/COINS_LOST
  // ya aplican el descuento via applyEvent.
  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: [...player.hand, { ...drawnCard, zone: 'HAND' as Zone }],
          supportDecks: player.supportDecks.map((d, i) => i === supportDeckIndex ? remainingDeck : d),
          supportCardsDrawnThisTurn: cardsDrawnThisTurn + 1,
          supportDeckIndexUsedThisTurn: supportDeckIndex,
          // D349: Marcar la carta como prestada para devolverla al mazo al final del turno
          borrowedSupportCardIds: [...(player.borrowedSupportCardIds ?? []), drawnCard.instanceId],
        },
      },
    },
    events,
  };
}

/**
 * Calcular puntuacion final en modo solitario (especificacion §4.3).
 *
 * Puntuacion:
 * - +1 por carta sobrante (mano + mazo)
 * - +1 por cada 2 Gloria (fichas)
 * - +1 por cada 5 monedas
 * - Por cada herida no recibida, tantos puntos como cartas tenga el mazo
 */
export function calculateSoloScore(state: GameState, playerId: string): {
  glory: number;
  bonus: number;
  total: number;
  breakdown: { label: string; value: number }[];
} {
  const player = state.players[playerId];
  if (!player) return { glory: 0, bonus: 0, total: 0, breakdown: [] };

  const breakdown: { label: string; value: number }[] = [];
  let bonus = 0;

  // +1 por carta sobrante (mano + mazo)
  const remainingCards = player.hand.length + player.abilityDeck.length;
  breakdown.push({ label: 'Cartas sobrantes', value: remainingCards });
  bonus += remainingCards;

  // +1 por cada 2 Gloria (fichas)
  const gloryBonus = Math.floor(player.glory / 2);
  breakdown.push({ label: 'Gloria (1pt/2)', value: gloryBonus });
  bonus += gloryBonus;

  // +1 por cada 5 monedas
  const coinsBonus = Math.floor(player.coins / 5);
  breakdown.push({ label: 'Monedas (1pt/5)', value: coinsBonus });
  bonus += coinsBonus;

  // Por cada herida no recibida, tantos puntos como cartas tenga el mazo
  const woundsNotReceived = (player.maxWounds ?? 3) - player.wounds;
  if (woundsNotReceived > 0) {
    const woundBonus = woundsNotReceived * player.abilityDeck.length;
    breakdown.push({ label: 'Heridas no recibidas', value: woundBonus });
    bonus += woundBonus;
  }

  return {
    glory: player.glory,
    bonus,
    // Especificacion §4.3: el total es solo la suma de los 4 conceptos
    // (las fichas de Gloria ya se cuentan como +1 por cada 2)
    total: bonus,
    breakdown,
  };
}

/**
 * Obtener el titulo de solitario segun la puntuacion (especificacion §4.4).
 *
 * - Cazador audaz: 1-10 puntos
 * - Guardián de los justos: 11-20 puntos
 * - Terror de la Horda: 21-40 puntos
 * - Caudillo de Isilendor: 41+ puntos
 */
export function getSoloTitle(score: number): string {
  if (score >= 41) return 'Caudillo de Isilendor';
  if (score >= 21) return 'Terror de la Horda';
  if (score >= 11) return 'Guardián de los justos';
  if (score >= 1) return 'Cazador audaz';
  return 'Derrotado';
}

/**
 * Cambiar hasta 2 cartas iniciales en modo solitario (especificacion §4.1).
 * Las cartas cambiadas van al fondo del mazo y se roban nuevas.
 */
export function swapStartingCards(
  state: GameState,
  playerId: string,
  cardInstanceIds: string[],
  _rng: DeterministicRng,
): { state: GameState; events: GameEvent[]; error?: string } {
  const events: GameEvent[] = [];
  const player = state.players[playerId];
  if (!player) return { state, events, error: 'Player not found' };
  if (cardInstanceIds.length > 2) {
    return { state, events, error: 'Can only swap up to 2 cards' };
  }

  const newHand = [...player.hand];
  let newDeck = [...player.abilityDeck];

  for (const cardId of cardInstanceIds) {
    const cardIdx = newHand.findIndex(c => c.instanceId === cardId);
    if (cardIdx === -1) continue;
    // Mover carta al fondo del mazo — con evento para que el fold del
    // eventLog reproduzca la misma mano/mazo (event sourcing fiel).
    const card = newHand[cardIdx];
    newHand.splice(cardIdx, 1);
    newDeck.push({ ...card, zone: 'ABILITY_DECK' as Zone });
    events.push({
      type: 'CARD_MOVED',
      cardInstanceId: card.instanceId,
      from: 'HAND',
      to: 'ABILITY_DECK',
      playerId,
      seq: nextSeq(),
    } as GameEvent);
    // Robar nueva carta del top del mazo
    if (newDeck.length > 0) {
      const newCard = newDeck[0];
      newDeck = newDeck.slice(1);
      newHand.push({ ...newCard, zone: 'HAND' as Zone });
      events.push({
        type: 'CARDS_DRAWN',
        playerId,
        count: 1,
        cardInstanceIds: [newCard.instanceId],
        seq: nextSeq(),
      });
    }
  }

  // Spec §4.1: el cambio inicial es una sola vez — el flag viaja en un
  // evento para que el fold del eventLog reproduzca la misma legalidad.
  if (cardInstanceIds.length > 0) {
    events.push({ type: 'STARTING_CARDS_SWAPPED', playerId, seq: nextSeq() });
  }

  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: newHand,
          abilityDeck: newDeck,
          // El evento STARTING_CARDS_SWAPPED lo fija también en el fold
          startingSwapUsed: cardInstanceIds.length > 0 ? true : player.startingSwapUsed,
        },
      },
    },
    events,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function createEmptyState(): GameState {
  return {
    phase: 'SETUP',
    mode: 'SOLO',
    activePlayerId: '',
    turnNumber: 0,
    players: {},
    playerOrder: [],
    battlefield: [],
    hordeDeck: [],
    market: [],
    marketDeck: [],
    scenario: null,
    scenarioDeck: [],
    scenarioCoins: 0,
    warlordRevealed: false,
    warlordDefeated: false,
    warlordsDefeatedCount: 0,
    pendingChoices: [],
    eventLog: [],
    monotonicCounter: 0,
    rngState: { seed: '', state: 0 },
    marketCostModifier: 0,
    ignoreCoinRewards: false,
    ignoreGloryRewards: false,
  };
}


