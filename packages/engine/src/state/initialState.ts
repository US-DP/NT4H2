/**
 * createInitialState — estado inicial vacio de una partida.
 * Se rellena durante la fase SETUP con los datos de configuracion.
 */

import type { GameState, GameConfig, PlayerState } from '@nt4h/schema';
import { DeterministicRng } from '../rng/index.js';

export function createInitialState(config: GameConfig): GameState {
  const rng = new DeterministicRng(config.seed);

  const players: Record<string, PlayerState> = {};
  for (const hero of config.heroes) {
    players[hero.playerId] = createPlayerState(hero.playerId, hero.heroId, hero.heroFace);
  }

  return {
    phase: 'SETUP',
    mode: config.mode,
    activePlayerId: config.heroes[0]?.playerId ?? '',
    turnNumber: 0,
    players,
    playerOrder: config.heroes.map(h => h.playerId),
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
    rngState: rng.serialize(),
    marketCostModifier: 0,
    ignoreCoinRewards: false,
    ignoreGloryRewards: false,
    orcFortitudeBonus: 0,
  };
}

function createPlayerState(
  playerId: string,
  heroId: string,
  heroFace: 'FEMALE' | 'MALE',
): PlayerState {
  return {
    playerId,
    heroId,
    heroFace,
    heroUsesRemaining: 0,
    heroMaxUses: 0,
    glory: 0,
    coins: 0,
    wounds: 0,
    maxWounds: 0,
    capabilities: [],
    abilityDeck: [],
    hand: [],
    wearPile: [],
    trophies: [],
    shields: 0,
    prevention: 0,
    armor: 0,
    damageCancellation: false,
    interceptedBy: null,
    modifiers: [],
    cardsPlayedThisTurn: {},
    cardsPlayedAgainstEnemy: {},
    persistentCards: [],
    supportDecks: [],
  };
}
