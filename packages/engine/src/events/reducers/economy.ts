import type {
  GameEvent,
  GameState,
  Zone,
} from '@nt4h/schema';

import { mapPlayerState } from '../applyEvent.js';



export function applyGloryGained(
  state: GameState,
  event: Extract<GameEvent, { type: 'GLORY_GAINED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    glory: p.glory + event.amount,
  }));
}

export function applyGloryLost(
  state: GameState,
  event: Extract<GameEvent, { type: 'GLORY_LOST' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    glory: Math.max(0, p.glory - event.amount),
  }));
}

export function applyCoinsGained(
  state: GameState,
  event: Extract<GameEvent, { type: 'COINS_GAINED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    coins: p.coins + event.amount,
  }));
}

export function applyCoinsStolen(
  state: GameState,
  event: Extract<GameEvent, { type: 'COINS_STOLEN' }>,
): GameState {
  const fromPlayer = state.players[event.fromPlayerId];
  const toPlayer = state.players[event.toPlayerId];
  if (!fromPlayer || !toPlayer) return state;
  // D417: las monedas robadas no pueden superar las que tiene el origen
  const stolen = Math.min(event.amount, Math.max(0, fromPlayer.coins));
  return {
    ...state,
    players: {
      ...state.players,
      [event.fromPlayerId]: { ...fromPlayer, coins: fromPlayer.coins - stolen },
      [event.toPlayerId]: { ...toPlayer, coins: toPlayer.coins + stolen },
    },
  };
}

export function applyMarketPurchased(
  state: GameState,
  event: Extract<GameEvent, { type: 'MARKET_PURCHASED' }>,
): GameState {
  const player = state.players[event.playerId];
  const card = state.market.find(c => c.instanceId === event.cardInstanceId);
  if (!card) return state;

  return {
    ...state,
    market: state.market.filter(c => c.instanceId !== event.cardInstanceId),
    players: {
      ...state.players,
      [event.playerId]: {
        ...player,
        coins: player.coins - event.cost,
        hand: [...player.hand, { ...card, zone: 'HAND' as Zone }],
      },
    },
  };
}

export function applyMarketReplenished(
  state: GameState,
  event: Extract<GameEvent, { type: 'MARKET_REPLENISHED' }>,
): GameState {
  // Mover la carta del marketDeck al mercado (especificacion 3.5)
  const newCard = state.marketDeck.find(c => c.instanceId === event.cardInstanceId);
  if (!newCard) return state;
  return {
    ...state,
    market: [...state.market, { ...newCard, zone: 'MARKET' as Zone }],
    marketDeck: state.marketDeck.filter(c => c.instanceId !== event.cardInstanceId),
  };
}
