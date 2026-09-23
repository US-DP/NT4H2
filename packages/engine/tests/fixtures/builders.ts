/**
 * Fixtures y builders para pruebas del motor NT4H.
 *
 * Proporciona funciones para construir estados de juego, jugadores, enemigos
 * y cartas de prueba de forma declarativa y minimalista.
 */

import type {
  GameState,
  PlayerState,
  EnemyState,
  CardInstance,
  Zone,
  PendingChoice,
} from '@nt4h/schema';

// === CardInstance builder ===

let cardSeq = 0;

export function makeCard(overrides: Partial<CardInstance> = {}): CardInstance {
  const id = overrides.instanceId ?? `test-card-${++cardSeq}`;
  return {
    instanceId: id,
    definitionId: overrides.definitionId ?? 'test-def',
    ownerId: overrides.ownerId ?? 'test-owner',
    zone: overrides.zone ?? ('HAND' as Zone),
  };
}

export function makeCards(n: number, overrides: Partial<CardInstance> = {}): CardInstance[] {
  return Array.from({ length: n }, () => makeCard(overrides));
}

// === EnemyState builder ===

let enemySeq = 0;

export function makeEnemy(overrides: Partial<EnemyState> = {}): EnemyState {
  const id = overrides.instanceId ?? `test-enemy-${++enemySeq}`;
  return {
    instanceId: id,
    definitionId: overrides.definitionId ?? 'test-enemy-def',
    baseFortitude: overrides.baseFortitude ?? 3,
    wounds: overrides.wounds ?? 0,
    reward: overrides.reward ?? null,
    modifiers: overrides.modifiers ?? [],
    isWarlord: overrides.isWarlord ?? false,
    isOrc: overrides.isOrc ?? false,
    specialIcons: overrides.specialIcons ?? [],
    damageDisabled: overrides.damageDisabled ?? false,
  };
}

export function makeEnemies(n: number, overrides: Partial<EnemyState> = {}): EnemyState[] {
  return Array.from({ length: n }, () => makeEnemy(overrides));
}

// === PlayerState builder ===

export function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    playerId: overrides.playerId ?? 'p1',
    heroId: overrides.heroId ?? 'hero.explorer-1',
    heroFace: overrides.heroFace ?? 'FEMALE',
    heroMaxUses: overrides.heroMaxUses ?? 2,
    capabilities: overrides.capabilities ?? ['RANGED', 'EXPERTISE'],
    maxWounds: overrides.maxWounds ?? 4,
    wounds: overrides.wounds ?? 0,
    coins: overrides.coins ?? 5,
    glory: overrides.glory ?? 0,
    hand: overrides.hand ?? [],
    abilityDeck: overrides.abilityDeck ?? [],
    wearPile: overrides.wearPile ?? [],
    trophies: overrides.trophies ?? [],
    shields: overrides.shields ?? 0,
    prevention: overrides.prevention ?? 0,
    damageCancellation: overrides.damageCancellation ?? false,
    interceptedBy: overrides.interceptedBy ?? null,
    heroUsesRemaining: overrides.heroUsesRemaining ?? 2,
    persistentCards: overrides.persistentCards ?? [],
    modifiers: overrides.modifiers ?? [],
    cardsPlayedThisTurn: overrides.cardsPlayedThisTurn ?? {},
    cardsPlayedAgainstEnemy: overrides.cardsPlayedAgainstEnemy ?? {},
    supportDecks: overrides.supportDecks ?? [],
    ...(overrides.supportDecksOpened != null ? { supportDecksOpened: overrides.supportDecksOpened } : {}),
    ...(overrides.supportCardsDrawnThisTurn != null ? { supportCardsDrawnThisTurn: overrides.supportCardsDrawnThisTurn } : {}),
    ...(overrides.supportDeckIndexUsedThisTurn != null ? { supportDeckIndexUsedThisTurn: overrides.supportDeckIndexUsedThisTurn } : {}),
    ...(overrides.borrowedSupportCardIds ? { borrowedSupportCardIds: overrides.borrowedSupportCardIds } : {}),
  };
}

// === GameState builder ===

export function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const player1 = makePlayer({ playerId: 'p1' });
  return {
    phase: overrides.phase ?? 'PLAYER_ATTACK',
    mode: overrides.mode ?? 'STANDARD',
    activePlayerId: overrides.activePlayerId ?? 'p1',
    turnNumber: overrides.turnNumber ?? 1,
    players: overrides.players ?? { p1: player1 },
    playerOrder: overrides.playerOrder ?? ['p1'],
    battlefield: overrides.battlefield ?? [],
    hordeDeck: overrides.hordeDeck ?? [],
    market: overrides.market ?? [],
    marketDeck: overrides.marketDeck ?? [],
    scenarioDeck: overrides.scenarioDeck ?? [],
    scenario: overrides.scenario ?? null,
    scenarioCoins: overrides.scenarioCoins ?? 0,
    warlordRevealed: overrides.warlordRevealed ?? false,
    warlordDefeated: overrides.warlordDefeated ?? false,
    warlordsDefeatedCount: overrides.warlordsDefeatedCount ?? 0,
    pendingChoices: overrides.pendingChoices ?? [],
    eventLog: overrides.eventLog ?? [],
    rngState: overrides.rngState ?? { seed: 'test-seed', state: 0 },
    monotonicCounter: overrides.monotonicCounter ?? 0,
    orcFortitudeBonus: overrides.orcFortitudeBonus ?? 0,
    marketCostModifier: overrides.marketCostModifier ?? 0,
    ignoreCoinRewards: overrides.ignoreCoinRewards ?? false,
    ignoreGloryRewards: overrides.ignoreGloryRewards ?? false,
  };
}

// === Partidas preparadas (seccion 27 del documento) ===

export function gameEmptyBattlefield(): GameState {
  return makeGameState({ battlefield: [] });
}

export function gameOneEnemy(fortitude = 3, wounds = 0): GameState {
  return makeGameState({
    battlefield: [makeEnemy({ baseFortitude: fortitude, wounds })],
  });
}

export function gameWarlordActive(): GameState {
  return makeGameState({
    battlefield: [makeEnemy({ isWarlord: true, baseFortitude: 8, definitionId: 'warlord.gurdrug' })],
    warlordRevealed: true,
  });
}

export function gamePlayerNearExhaustion(): GameState {
  return makeGameState({
    players: {
      p1: makePlayer({
        wounds: 3,
        maxWounds: 4,
        abilityDeck: [],
        wearPile: [],
        hand: makeCards(1),
      }),
    },
  });
}

export function gamePendingChoice(): GameState {
  const choice: PendingChoice = {
    choiceId: 'test-choice-1',
    playerId: 'p1',
    type: 'SELECT_ENEMY',
    prompt: 'Select an enemy',
    options: ['test-enemy-1', 'test-enemy-2'],
    minSelections: 1,
    maxSelections: 1,
  };
  return makeGameState({
    battlefield: [
      makeEnemy({ instanceId: 'test-enemy-1', baseFortitude: 3 }),
      makeEnemy({ instanceId: 'test-enemy-2', baseFortitude: 5 }),
    ],
    pendingChoices: [choice],
  });
}

export function gameMarketEmpty(): GameState {
  return makeGameState({
    phase: 'MARKET',
    market: [],
    marketDeck: [],
  });
}

export function gameAllPlayersLowHealth(): GameState {
  return makeGameState({
    players: {
      p1: makePlayer({ playerId: 'p1', wounds: 3, maxWounds: 4 }),
      p2: makePlayer({ playerId: 'p2', wounds: 3, maxWounds: 4 }),
    },
    playerOrder: ['p1', 'p2'],
  });
}

// === Reset de contadores ===

export function resetTestCounters(): void {
  cardSeq = 0;
  enemySeq = 0;
}
