/**
 * projection — proyección del estado por jugador (ocultación de información).
 *
 * En online, cada jugador recibe una vista del estado que oculta:
 * - Manos ajenas
 * - Orden de los mazos
 * - Recompensas no reveladas de enemigos
 * - Elecciones secretas
 *
 * Implementación de projectForPlayer (sección 51.11 de la especificación).
 */

import type {
  GameState,
  GameEvent,
  EnemyState,
  PlayerState,
} from '@nt4h/schema';

/** Eventos que contienen información privada */
const PRIVATE_EVENT_TYPES = new Set([
  'CARDS_DRAWN',
  'CARDS_LOST',
  'CARDS_RECOVERED',
  'DECK_SHUFFLED',
  'DECK_RESHUFFLED',
  'CARDS_REVEALED_TO_PLAYER',
]);

export interface PlayerGameState {
  phase: string;
  activePlayerId: string;
  turnNumber: number;
  mode: string;
  playerOrder: string[];

  battlefield: Array<{
    instanceId: string;
    definitionId: string;
    baseFortitude: number;
    wounds: number;
    isWarlord: boolean;
    isOrc: boolean;
    damageDisabled: boolean;
    /** La recompensa solo es visible si el enemigo ya fue derrotado */
    reward: { coins: number; glory: number } | null;
  }>;

  players: Record<string, {
    heroId: string;
    heroFace: string;
    glory: number;
    coins: number;
    wounds: number;
    maxWounds: number;
    heroUsesRemaining: number;
    heroMaxUses: number;
    deckSize: number;
    handSize: number;
    wearPileSize: number;
    trophyCount: number;
    shields: number;
    prevention: number;
    damageCancellation: boolean;
    /** Solo el propio jugador ve su mano */
    hand?: Array<{
      instanceId: string;
      definitionId: string;
    }>;
    capabilities: string[];
    persistentCards: Array<{
      instanceId: string;
      definitionId: string;
      persistentTrigger: string;
    }>;
  }>;

  market: Array<{
    instanceId: string;
    definitionId: string;
  }>;
  marketDeckSize: number;

  hordeDeckSize: number;

  scenario: { instanceId: string; definitionId: string } | null;
  scenarioDeckSize: number;

  warlordRevealed: boolean;
  warlordDefeated: boolean;
  warlordsDefeatedCount: number;

  pendingChoices: Array<{
    choiceId: string;
    playerId: string;
    type: string;
    prompt: string;
    options: string[];
    relatedCardIds?: string[];
  }>;

  eventLog: GameEvent[];
  marketCostModifier: number;
  ignoreCoinRewards: boolean;
  ignoreGloryRewards: boolean;
}

/**
 * Proyectar el estado completo para un jugador específico.
 * viewerId = null significa espectador (no ve ninguna mano).
 */
export function projectForPlayer(
  state: GameState,
  viewerId: string | null,
): PlayerGameState {
  const battlefield = state.battlefield.map((e: EnemyState) => ({
    instanceId: e.instanceId,
    definitionId: e.definitionId,
    baseFortitude: e.baseFortitude,
    wounds: e.wounds,
    isWarlord: e.isWarlord,
    isOrc: e.isOrc,
    damageDisabled: e.damageDisabled,
    // La recompensa solo es visible si el enemigo fue derrotado
    // (en ese caso ya no está en el battlefield, pero por consistencia)
    reward: null,
  }));

  const players: PlayerGameState['players'] = {};
  for (const [id, p] of Object.entries(state.players)) {
    const playerState = p as PlayerState;
    players[id] = {
      heroId: playerState.heroId,
      heroFace: playerState.heroFace,
      glory: playerState.glory,
      coins: playerState.coins,
      wounds: playerState.wounds,
      maxWounds: playerState.maxWounds,
      heroUsesRemaining: playerState.heroUsesRemaining,
      heroMaxUses: playerState.heroMaxUses,
      deckSize: playerState.abilityDeck.length,
      handSize: playerState.hand.length,
      wearPileSize: playerState.wearPile.length,
      trophyCount: playerState.trophies.length,
      shields: playerState.shields,
      prevention: playerState.prevention,
      damageCancellation: playerState.damageCancellation,
      capabilities: playerState.capabilities,
      persistentCards: playerState.persistentCards.map(c => ({
        instanceId: c.instanceId,
        definitionId: c.definitionId,
        persistentTrigger: c.persistentTrigger ?? '',
      })),
    };

    // Solo el propio jugador ve su mano
    if (id === viewerId) {
      players[id].hand = playerState.hand.map(c => ({
        instanceId: c.instanceId,
        definitionId: c.definitionId,
      }));
    }
  }

  const market = state.market.map(c => ({
    instanceId: c.instanceId,
    definitionId: c.definitionId,
  }));

  const scenario = state.scenario
    ? { instanceId: state.scenario.instanceId, definitionId: state.scenario.definitionId }
    : null;

  // Filtrar elecciones pendientes: solo las del viewer (espectador no ve ninguna)
  const pendingChoices = (state.pendingChoices ?? [])
    .filter(c => viewerId !== null && c.playerId === viewerId)
    .map(c => ({
      choiceId: c.choiceId,
      playerId: c.playerId,
      type: c.type,
      prompt: c.prompt,
      options: c.options,
      relatedCardIds: c.relatedCardIds,
    }));

  // Filtrar eventos privados del log
  const eventLog = (state.eventLog ?? []).filter(
    (e: GameEvent) => !isPrivateEvent(e, viewerId),
  );

  return {
    phase: state.phase,
    activePlayerId: state.activePlayerId,
    turnNumber: state.turnNumber,
    mode: state.mode,
    playerOrder: state.playerOrder,
    battlefield,
    players,
    market,
    marketDeckSize: state.marketDeck.length,
    hordeDeckSize: state.hordeDeck.length,
    scenario,
    scenarioDeckSize: state.scenarioDeck.length,
    warlordRevealed: state.warlordRevealed,
    warlordDefeated: state.warlordDefeated,
    warlordsDefeatedCount: state.warlordsDefeatedCount,
    pendingChoices,
    eventLog,
    marketCostModifier: state.marketCostModifier,
    ignoreCoinRewards: state.ignoreCoinRewards,
    ignoreGloryRewards: state.ignoreGloryRewards,
  };
}

/**
 * Determinar si un evento contiene información privada que no debe
 * revelarse a un viewer específico.
 */
function isPrivateEvent(event: GameEvent, viewerId: string | null): boolean {
  if (!PRIVATE_EVENT_TYPES.has(event.type)) return false;

  // CARDS_DRAWN, CARDS_LOST, CARDS_RECOVERED: solo visibles para el jugador afectado
  if (event.type === 'CARDS_DRAWN' || event.type === 'CARDS_LOST' || event.type === 'CARDS_RECOVERED') {
    const ev = event as { playerId?: string };
    return ev.playerId !== viewerId;
  }

  // DECK_SHUFFLED, DECK_RESHUFFLED: el orden del mazo es secreto para todos
  // (ni siquiera el dueño debería ver newOrder)
  if (event.type === 'DECK_SHUFFLED' || event.type === 'DECK_RESHUFFLED') {
    return true;
  }

  // CARDS_REVEALED_TO_PLAYER: solo visible para el jugador receptor
  if (event.type === 'CARDS_REVEALED_TO_PLAYER') {
    const ev = event as { playerId?: string };
    return ev.playerId !== viewerId;
  }

  return false;
}

/**
 * Proyectar una lista de eventos para un viewer, filtrando los privados.
 */
export function projectEventsForPlayer(
  events: GameEvent[],
  viewerId: string | null,
): GameEvent[] {
  return events.filter(e => !isPrivateEvent(e, viewerId));
}
