import type {
  GameEvent,
  GameState,
  Zone,
} from '@nt4h/schema';

import { mapPlayerState, moveCard, removeCardFromAllZones } from '../applyEvent.js';



export function applyCardPlayed(
  state: GameState,
  event: Extract<GameEvent, { type: 'CARD_PLAYED' }>,
): GameState {
  const player = state.players[event.playerId];
  const card = player.hand.find(c => c.instanceId === event.cardInstanceId);
  if (!card) return state; // defensive: carta no encontrada

  // NOTA: NO quitamos la carta de la mano aqu├¡. CARD_MOVED la mueve a WEAR_PILE.
  // Si la quitamos aqu├¡, CARD_MOVED no la encontrar├í.
  // D434: si es una carta de Apoyo prestada, marcarla como usada
  // (spec ┬º4.2: "Entre las robadas, elegir 1 para usar este turno")
  const isBorrowed = player.borrowedSupportCardIds?.includes(event.cardInstanceId) ?? false;
  return {
    ...state,
    players: {
      ...state.players,
      [event.playerId]: {
        ...player,
        supportCardUsedThisTurn: isBorrowed ? true : player.supportCardUsedThisTurn,
        cardsPlayedThisTurn: {
          ...player.cardsPlayedThisTurn,
          // Indexar por definitionId Y por nombre (las condiciones buscan por nombre)
          [card.definitionId]: (player.cardsPlayedThisTurn[card.definitionId] ?? 0) + 1,
          ...(event.cardName ? {
            [event.cardName]: (player.cardsPlayedThisTurn[event.cardName] ?? 0) + 1,
          } : {}),
        },
        cardsPlayedAgainstEnemy: {
          ...player.cardsPlayedAgainstEnemy,
          ...(state.activePlayerId === event.playerId && state.battlefield.some(e => e.instanceId === event.targetEnemyInstanceId) ? {
            [event.targetEnemyInstanceId!]: {
              ...player.cardsPlayedAgainstEnemy[event.targetEnemyInstanceId!],
              [card.definitionId]: (player.cardsPlayedAgainstEnemy[event.targetEnemyInstanceId!]?.[card.definitionId] ?? 0) + 1,
              ...(event.cardName ? {
                [event.cardName]: (player.cardsPlayedAgainstEnemy[event.targetEnemyInstanceId!]?.[event.cardName] ?? 0) + 1,
              } : {}),
            },
          } : {}),
        },
      },
    },
  };
}

export function applyCardsDrawn(
  state: GameState,
  event: Extract<GameEvent, { type: 'CARDS_DRAWN' }>,
): GameState {
  const player = state.players[event.playerId];
  const drawnCards: typeof player.hand = [];
  const remainingDeck = [...player.abilityDeck];
  // D434: la carta puede venir de un mazo de Apoyo (modo solitario).
  // Buscarla alli para que el replay produzca el mismo estado y marque
  // la carta como prestada + el mazo usado este turno.
  let newSupportDecks = player.supportDecks;
  const borrowedIds = [...(player.borrowedSupportCardIds ?? [])];
  let usedSupportIdx = player.supportDeckIndexUsedThisTurn;
  let supportDraws = player.supportCardsDrawnThisTurn ?? 0;

  for (const cardInstanceId of event.cardInstanceIds) {
    const idx = remainingDeck.findIndex(c => c.instanceId === cardInstanceId);
    if (idx >= 0) {
      drawnCards.push({ ...remainingDeck[idx], zone: 'HAND' as Zone });
      remainingDeck.splice(idx, 1);
      continue;
    }
    // Buscar en mazos de Apoyo
    const deckIdx = (newSupportDecks ?? []).findIndex(d =>
      d.some(c => c.instanceId === cardInstanceId)
    );
    if (deckIdx >= 0) {
      const deck = newSupportDecks![deckIdx];
      const card = deck.find(c => c.instanceId === cardInstanceId)!;
      drawnCards.push({ ...card, zone: 'HAND' as Zone });
      newSupportDecks = newSupportDecks!.map((d, i) =>
        i === deckIdx ? d.filter(c => c.instanceId !== cardInstanceId) : d
      );
      if (!borrowedIds.includes(cardInstanceId)) borrowedIds.push(cardInstanceId);
      if (usedSupportIdx === null || usedSupportIdx === undefined) usedSupportIdx = deckIdx;
      supportDraws += 1;
    }
  }

  return {
    ...state,
    players: {
      ...state.players,
      [event.playerId]: {
        ...player,
        abilityDeck: remainingDeck,
        supportDecks: newSupportDecks,
        borrowedSupportCardIds: borrowedIds,
        supportDeckIndexUsedThisTurn: usedSupportIdx,
        supportCardsDrawnThisTurn: supportDraws,
        hand: [...player.hand, ...drawnCards],
      },
    },
  };
}

export function applyCardsLost(
  state: GameState,
  event: Extract<GameEvent, { type: 'CARDS_LOST' }>,
): GameState {
  const player = state.players[event.playerId];
  const lostCards: typeof player.wearPile = [];
  const remainingDeck = [...player.abilityDeck];

  for (const cardInstanceId of event.cardInstanceIds) {
    const idx = remainingDeck.findIndex(c => c.instanceId === cardInstanceId);
    if (idx >= 0) {
      lostCards.push({ ...remainingDeck[idx], zone: 'WEAR_PILE' as Zone });
      remainingDeck.splice(idx, 1);
    }
  }

  return {
    ...state,
    players: {
      ...state.players,
      [event.playerId]: {
        ...player,
        abilityDeck: remainingDeck,
        wearPile: [...player.wearPile, ...lostCards],
      },
    },
  };
}

export function applyCardsRecovered(
  state: GameState,
  event: Extract<GameEvent, { type: 'CARDS_RECOVERED' }>,
): GameState {
  const player = state.players[event.playerId];
  const recoveredCards: typeof player.abilityDeck = [];
  const remainingWear = [...player.wearPile];
  const remainingHand = [...player.hand];

  for (const cardInstanceId of event.cardInstanceIds) {
    // Buscar en wearPile primero
    const wearIdx = remainingWear.findIndex(c => c.instanceId === cardInstanceId);
    if (wearIdx >= 0) {
      const card = remainingWear[wearIdx];
      if (event.toZone === 'HAND') {
        recoveredCards.push({ ...card, zone: 'HAND' as Zone });
      } else {
        recoveredCards.push({ ...card, zone: 'ABILITY_DECK' as Zone });
      }
      remainingWear.splice(wearIdx, 1);
      continue;
    }
    // Buscar en hand (Daga ├ëlfica: la carta no lleg├│ a wearPile)
    const handIdx = remainingHand.findIndex(c => c.instanceId === cardInstanceId);
    if (handIdx >= 0) {
      const card = remainingHand[handIdx];
      if (event.toZone === 'HAND') {
        // Ya est├í en mano, mantenerla
        recoveredCards.push({ ...card, zone: 'HAND' as Zone });
      } else {
        recoveredCards.push({ ...card, zone: 'ABILITY_DECK' as Zone });
        remainingHand.splice(handIdx, 1);
      }
    }
  }

  if (event.toZone === 'HAND') {
    // Si recoveredCards incluye cartas ya en hand, mantener hand sin duplicar
    const handFromWear = recoveredCards.filter(c =>
      !remainingHand.some(h => h.instanceId === c.instanceId)
    );
    return {
      ...state,
      players: {
        ...state.players,
        [event.playerId]: {
          ...player,
          wearPile: remainingWear,
          hand: [...remainingHand, ...handFromWear],
        },
      },
    };
  }

  // BOTTOM_OF_DECK: anadir al final del mazo
  return {
    ...state,
    players: {
      ...state.players,
      [event.playerId]: {
        ...player,
        wearPile: remainingWear,
        hand: remainingHand,
        abilityDeck: [...player.abilityDeck, ...recoveredCards],
      },
    },
  };
}

export function applyCardMoved(
  state: GameState,
  event: Extract<GameEvent, { type: 'CARD_MOVED' }>,
): GameState {

  return moveCard(state, event.cardInstanceId, event.to, event.toPlayerId, event.playerId);
}

export function applyCardRemovedFromGame(
  state: GameState,
  event: Extract<GameEvent, { type: 'CARD_REMOVED_FROM_GAME' }>,
): GameState {

  return removeCardFromAllZones(state, event.cardInstanceId);
}

export function applyDeckExhausted(
  state: GameState,
  _event: Extract<GameEvent, { type: 'DECK_EXHAUSTED' }>,
): GameState {

  return state;
}

export function applyDeckReshuffled(
  state: GameState,
  event: Extract<GameEvent, { type: 'DECK_RESHUFFLED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => {
    // Si el evento incluye newOrder NO vacio, usarlo; si no, mantener orden lineal
    const newDeck = (Array.isArray(event.newOrder) && event.newOrder.length > 0)
      ? event.newOrder.map(id => {
          const card = p.wearPile.find(c => c.instanceId === id);
          return card ? { ...card, zone: 'ABILITY_DECK' as Zone } : null;
        }).filter((c): c is NonNullable<typeof c> => c !== null)
      : [...p.wearPile].map(c => ({ ...c, zone: 'ABILITY_DECK' as Zone }));
    return {
      ...p,
      abilityDeck: newDeck,
      wearPile: [],
    };
  });
}

export function applyDeckShuffled(
  state: GameState,
  event: Extract<GameEvent, { type: 'DECK_SHUFFLED' }>,
): GameState {
  if (event.deck === 'MARKET') {
    // Barajar mazo de Mercado
    const deckMap = new Map(state.marketDeck.map(c => [c.instanceId, c]));
    const newDeck = event.newOrder.map(id => deckMap.get(id)!).filter(Boolean);
    return { ...state, marketDeck: newDeck };
  }
  if (event.deck === 'HORDE') {
    // Barajar mazo de la Horda
    const deckMap = new Map(state.hordeDeck.map(c => [c.instanceId, c]));
    const newDeck = event.newOrder.map(id => deckMap.get(id)!).filter(Boolean);
    return { ...state, hordeDeck: newDeck };
  }
  // ABILITY: reordenar mazo del jugador
  const player = state.players[event.playerId];
  const deckMap = new Map(player.abilityDeck.map(c => [c.instanceId, c]));
  const newDeck = event.newOrder.map(id => deckMap.get(id)!).filter(Boolean);
  return {
    ...state,
    players: {
      ...state.players,
      [event.playerId]: { ...player, abilityDeck: newDeck },
    },
  };
}

export function applyHordeDeckReordered(
  state: GameState,
  event: Extract<GameEvent, { type: 'HORDE_DECK_REORDERED' }>,
): GameState {
  // Reordenar el mazo de la Horda seg├║n newOrder (ej. pericia de Idril)
  const byInstance = new Map(state.hordeDeck.map(c => [c.instanceId, c]));
  const reordered = event.newOrder
    .map(id => byInstance.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  // Cartas no mencionadas (defensivo): conservarlas al final
  const remaining = state.hordeDeck.filter(c => !event.newOrder.includes(c.instanceId));
  return { ...state, hordeDeck: [...reordered, ...remaining] };
}

export function applyHordeCardDiscarded(
  state: GameState,
  event: Extract<GameEvent, { type: 'HORDE_CARD_DISCARDED' }>,
): GameState {

  return {
    ...state,
    hordeDeck: state.hordeDeck.filter(c => c.instanceId !== event.cardInstanceId),
  };
}

export function applyCardsRevealedToPlayer(
  state: GameState,
  _event: Extract<GameEvent, { type: 'CARDS_REVEALED_TO_PLAYER' }>,
): GameState {

  // No cambia el estado del juego; es informativo para el cliente
  return state;
}

export function applyPersistentCardPlaced(
  state: GameState,
  event: Extract<GameEvent, { type: 'PERSISTENT_CARD_PLACED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    // Retirar la carta de la mano (se mueve a IN_FRONT_OF_PLAYER)
    hand: p.hand.filter(c => c.instanceId !== event.cardInstanceId),
    persistentCards: [
      ...p.persistentCards,
      {
        instanceId: event.cardInstanceId,
        definitionId: event.cardDefinitionId,
        ownerId: event.playerId,
        zone: 'IN_FRONT_OF_PLAYER',
        persistentTrigger: event.trigger,
      },
    ],
  }));
}

export function applyPersistentCardRemoved(
  state: GameState,
  event: Extract<GameEvent, { type: 'PERSISTENT_CARD_REMOVED' }>,
): GameState {

  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, p]) => [
        id,
        {
          ...p,
          persistentCards: p.persistentCards.filter(c => c.instanceId !== event.cardInstanceId),
        },
      ])
    ),
  };
}
