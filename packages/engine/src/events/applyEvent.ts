/**
 * applyEvent — reducer puro que aplica un evento al estado.
 *
 * Reglas:
 * - Sin efectos secundarios (no I/O, no RNG, no mutacion del input).
 * - Devuelve un nuevo estado.
 * - El estado es un fold sobre eventos: state = events.reduce(applyEvent, initialState).
 */

import type {
  GameState,
  GameEvent,
  PlayerState,
  Zone,
} from '@nt4h/schema';
import { getEffectiveFortitude } from '../modifiers/index.js';
import {
  applyDamageDealt, applyWoundPlaced, applyWoundHealed, applyEnemyDefeated,
  applyHordeAttacked, applyEnemySwapped, applyEnemyReturnedToHorde,
  applyDamageIntercepted, applyPreventionApplied, applyShieldPlaced,
  applyCancellationActivated, applyEnemyDamageDisabled,
  applyVulnerabilityApplied, applyArmorGranted, applyBlockGranted,
  applyBlockConsumed, applyHeroWounded, applyEnemySpawned, applyEnemyRevealed,
  applyWarlordRevealed, applyTrophyRemoved,
} from './reducers/combat.js';
import {
  applyCardPlayed, applyCardsDrawn, applyCardsLost, applyCardsRecovered,
  applyCardMoved, applyCardRemovedFromGame, applyDeckExhausted,
  applyDeckReshuffled, applyDeckShuffled, applyHordeDeckReordered,
  applyHordeCardDiscarded, applyCardsRevealedToPlayer,
  applyPersistentCardPlaced, applyPersistentCardRemoved,
} from './reducers/cards.js';
import {
  applyGloryGained, applyGloryLost, applyCoinsGained, applyCoinsLost, applyCoinsStolen,
  applyMarketPurchased, applyMarketReplenished,
} from './reducers/economy.js';
import {
  applyPhaseChanged, applyTurnStarted, applyTurnEnded, applySupportDeckOpened,
  applyScenarioRevealed, applyScenarioDiscarded, applyScenarioEffectsApplied, applyHeroAbilityUsed,
  applyLeaderBidCards, applyFeldonDecision,
  applyModifierAdded, applyModifierExpired, applyEvasionPerformed,
  applyGameEnded, applyLeaderDetermined, applyLeaderTieBreak,
  applyResolutionHalted, applyStatusApplied, applyStatusRemoved,
  applyVariableSet, applyListenerRegistered, applyListenerRemoved,
  applyEffectsExpired, applyPendingChoicesRemoved, applyPendingChoiceCreated,
  applyStartingCardsSwapped,
} from './reducers/flow.js';

export function applyEvent(state: GameState, event: GameEvent): GameState {
  const newState = applyEventInternal(state, event);
  // Especificacion §51.12: event sourcing — todos los eventos van al eventLog
  return {
    ...newState,
    eventLog: [...newState.eventLog, event],
    monotonicCounter: newState.monotonicCounter + 1,
  };
}

function applyEventInternal(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'PHASE_CHANGED': return applyPhaseChanged(state, event);
    case 'TURN_STARTED': return applyTurnStarted(state, event);
    case 'TURN_ENDED': return applyTurnEnded(state, event);
    case 'SUPPORT_DECK_OPENED': return applySupportDeckOpened(state, event);
    case 'CARD_PLAYED': return applyCardPlayed(state, event);
    case 'DAMAGE_DEALT': return applyDamageDealt(state, event);
    case 'WOUND_PLACED': return applyWoundPlaced(state, event);
    case 'ENEMY_DEFEATED': return applyEnemyDefeated(state, event);
    case 'CARDS_DRAWN': return applyCardsDrawn(state, event);
    case 'CARDS_LOST': return applyCardsLost(state, event);
    case 'CARDS_RECOVERED': return applyCardsRecovered(state, event);
    case 'GLORY_GAINED': return applyGloryGained(state, event);
    case 'GLORY_LOST': return applyGloryLost(state, event);
    case 'COINS_GAINED': return applyCoinsGained(state, event);
    case 'COINS_LOST': return applyCoinsLost(state, event);
    case 'COINS_STOLEN': return applyCoinsStolen(state, event);
    case 'WOUND_HEALED': return applyWoundHealed(state, event);
    case 'CARD_MOVED': return applyCardMoved(state, event);
    case 'CARD_REMOVED_FROM_GAME': return applyCardRemovedFromGame(state, event);
    case 'HORDE_DECK_REORDERED': return applyHordeDeckReordered(state, event);
    case 'HORDE_ATTACKED': return applyHordeAttacked(state, event);
    case 'ENEMY_REVEALED': return applyEnemyRevealed(state, event);
    case 'WARLORD_REVEALED': return applyWarlordRevealed(state, event);
    case 'MARKET_PURCHASED': return applyMarketPurchased(state, event);
    case 'MARKET_REPLENISHED': return applyMarketReplenished(state, event);
    case 'SCENARIO_REVEALED': return applyScenarioRevealed(state, event);
    case 'SCENARIO_DISCARDED': return applyScenarioDiscarded(state, event);
    case 'SCENARIO_EFFECTS_APPLIED': return applyScenarioEffectsApplied(state, event);
    case 'HERO_ABILITY_USED': return applyHeroAbilityUsed(state, event);
    case 'PREVENTION_APPLIED': return applyPreventionApplied(state, event);
    case 'SHIELD_PLACED': return applyShieldPlaced(state, event);
    case 'CANCELLATION_ACTIVATED': return applyCancellationActivated(state, event);
    case 'ENEMY_DAMAGE_DISABLED': return applyEnemyDamageDisabled(state, event);
    case 'VULNERABILITY_APPLIED': return applyVulnerabilityApplied(state, event);
    case 'MODIFIER_ADDED': return applyModifierAdded(state, event);
    case 'MODIFIER_EXPIRED': return applyModifierExpired(state, event);
    case 'HERO_WOUNDED': return applyHeroWounded(state, event);
    case 'DECK_EXHAUSTED': return applyDeckExhausted(state, event);
    case 'DECK_RESHUFFLED': return applyDeckReshuffled(state, event);
    case 'EVASION_PERFORMED': return applyEvasionPerformed(state, event);
    case 'GAME_ENDED': return applyGameEnded(state, event);
    case 'PERSISTENT_CARD_PLACED': return applyPersistentCardPlaced(state, event);
    case 'PERSISTENT_CARD_REMOVED': return applyPersistentCardRemoved(state, event);
    case 'LEADER_DETERMINED': return applyLeaderDetermined(state, event);
    case 'LEADER_TIE_BREAK': return applyLeaderTieBreak(state, event);
    case 'DECK_SHUFFLED': return applyDeckShuffled(state, event);
    case 'ENEMY_SWAPPED': return applyEnemySwapped(state, event);
    case 'ENEMY_RETURNED_TO_HORDE': return applyEnemyReturnedToHorde(state, event);
    case 'DAMAGE_INTERCEPTED': return applyDamageIntercepted(state, event);
    case 'CARDS_REVEALED_TO_PLAYER': return applyCardsRevealedToPlayer(state, event);
    case 'RESOLUTION_HALTED': return applyResolutionHalted(state, event);
    case 'ARMOR_GRANTED': return applyArmorGranted(state, event);
    case 'STATUS_APPLIED': return applyStatusApplied(state, event);
    case 'STATUS_REMOVED': return applyStatusRemoved(state, event);
    case 'HORDE_CARD_DISCARDED': return applyHordeCardDiscarded(state, event);
    case 'ENEMY_SPAWNED': return applyEnemySpawned(state, event);
    case 'VARIABLE_SET': return applyVariableSet(state, event);
    case 'BLOCK_GRANTED': return applyBlockGranted(state, event);
    case 'BLOCK_CONSUMED': return applyBlockConsumed(state, event);
    case 'LISTENER_REGISTERED': return applyListenerRegistered(state, event);
    case 'LISTENER_REMOVED': return applyListenerRemoved(state, event);
    case 'EFFECTS_EXPIRED': return applyEffectsExpired(state, event);
    case 'PENDING_CHOICES_REMOVED': return applyPendingChoicesRemoved(state, event);
    case 'PENDING_CHOICE_CREATED': return applyPendingChoiceCreated(state, event);
    case 'TROPHY_REMOVED': return applyTrophyRemoved(state, event);
    case 'STARTING_CARDS_SWAPPED': return applyStartingCardsSwapped(state, event);
    case 'LEADER_BID_CARDS': return applyLeaderBidCards(state, event);
    case 'FELDON_DECISION': return applyFeldonDecision(state, event);
    default: {
      // Exhaustive check
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

export function mapPlayer(
  players: Record<string, PlayerState>,
  playerId: string,
  fn: (p: PlayerState) => PlayerState
): Record<string, PlayerState> {
  const player = players[playerId];
  if (!player) return players;
  return { ...players, [playerId]: fn(player) };
}

export function mapPlayerState(
  state: GameState,
  playerId: string,
  fn: (p: PlayerState) => PlayerState
): GameState {
  return { ...state, players: mapPlayer(state.players, playerId, fn) };
}

/**
 * D434 (spec §6.9 nota Brunmar + caso limite 9): si un modificador de
 * Fortaleza (Ruinas de Brunmar, -1) deja a un enemigo con Heridas >=
 * Fortaleza efectiva, queda derrotado inmediatamente — incluso al entrar
 * en juego con Fortaleza efectiva 0.
 *
 * SOLO EMITE eventos — el llamador los aplica con applyEvent sobre su
 * estado (una sola vez, evitando duplicados en eventLog). Internamente se
 * usa un estado de trabajo descartable para capturar efectos en cascada
 * (p.ej. Roghkiller derrotado retira su +1 a los orcos, que puede derrotar
 * a otros enemigos).
 */
export function checkFortitudeDefeats(
  state: GameState,
  defeatingPlayerId: string,
  seq: () => number,
): GameEvent[] {
  const events: GameEvent[] = [];
  let work = state;
  for (const enemy of [...state.battlefield]) {
    const current = work.battlefield.find(e => e.instanceId === enemy.instanceId);
    if (!current) continue;
    if (current.wounds >= getEffectiveFortitude(current, work)) {
      const ev: GameEvent = {
        type: 'ENEMY_DEFEATED',
        enemyInstanceId: current.instanceId,
        enemyDefinitionId: current.definitionId,
        defeatingPlayerId,
        reward: {
          coins: work.ignoreCoinRewards ? 0 : (current.reward?.coins ?? 0),
          // Laurel del frente (trofeo) permanente + Gloria del dorso suprimible
          glory: (current.trophyGlory ?? 0) + (work.ignoreGloryRewards ? 0 : (current.reward?.glory ?? 0)),
        },
        seq: seq(),
      };
      events.push(ev);
      work = applyEvent(work, ev);
    }
  }
  return events;
}

export function moveCard(state: GameState, cardInstanceId: string, to: Zone, toPlayerId?: string, eventPlayerId?: string, supportDeckIndex?: number): GameState {
  const newPlayers = { ...state.players };

  // Transferencia entre jugadores (toPlayerId ≠ propietario actual):
  // quitar la carta de cualquier zona de su dueño y añadirla a la zona
  // `to` del jugador destino (ej. PLAY_RANDOM_CARD_FROM_OTHER_HERO).
  if (toPlayerId && newPlayers[toPlayerId]) {
    let movedCard: any = null;
    let sourcePlayerId: string | null = null;
    let sourceZoneKey: 'hand' | 'abilityDeck' | 'wearPile' | 'persistentCards' | null = null;
    for (const [playerId, player] of Object.entries(newPlayers)) {
      for (const zoneKey of ['hand', 'abilityDeck', 'wearPile', 'persistentCards'] as const) {
        const zoneCards = player[zoneKey] as any[];
        const idx = zoneCards.findIndex((c: any) => c.instanceId === cardInstanceId);
        if (idx >= 0) {
          movedCard = { ...zoneCards[idx], zone: to };
          newPlayers[playerId] = {
            ...player,
            [zoneKey]: zoneCards.filter((c: any) => c.instanceId !== cardInstanceId),
          };
          sourcePlayerId = playerId;
          sourceZoneKey = zoneKey;
          break;
        }
      }
      if (movedCard) break;
    }
    // Re-añadir a la zona `to` del destino — también cuando origen y
    // destino son el mismo jugador (movimiento entre zonas propias);
    // sin esto la carta desaparecía silenciosamente.
    if (movedCard && sourcePlayerId) {
      const target = newPlayers[toPlayerId];
      if (to === 'HAND') {
        newPlayers[toPlayerId] = { ...target, hand: [...target.hand, movedCard] };
      } else if (to === 'WEAR_PILE') {
        newPlayers[toPlayerId] = { ...target, wearPile: [...target.wearPile, movedCard] };
      } else if (to === 'ABILITY_DECK') {
        newPlayers[toPlayerId] = { ...target, abilityDeck: [...target.abilityDeck, movedCard] };
      } else if (sourceZoneKey) {
        // Zona no-jugador (MARKET, etc.): restaurar a la zona de origen
        // para no destruir la carta. WARN: el restore silencioso ocultaba
        // efectos que emitan CARD_MOVED con `to` inesperado — se deja
        // traza para poder auditarlos.
        console.warn(`moveCard: zona destino no soportada '${to}' para ${cardInstanceId} — restaurada a ${sourceZoneKey} de ${sourcePlayerId}`);
        const src = newPlayers[sourcePlayerId];
        newPlayers[sourcePlayerId] = {
          ...src,
          [sourceZoneKey]: [...(src[sourceZoneKey] as any[]), movedCard],
        };
      }
      return { ...state, players: newPlayers };
    }
    if (!movedCard) return { ...state, players: newPlayers };
  }

  // Buscar la carta en todas las zonas del jugador propietario
  let found = false;
  let foundInPlayer = false;
  let movedCard: any = null;

  for (const [playerId, player] of Object.entries(newPlayers)) {
    const zones: (keyof PlayerState)[] = ['hand', 'abilityDeck', 'wearPile', 'persistentCards'];

    for (const zoneKey of zones) {
      const zoneCards = player[zoneKey] as any[];
      const idx = zoneCards.findIndex((c: any) => c.instanceId === cardInstanceId);
      if (idx >= 0) {
        movedCard = { ...zoneCards[idx], zone: to };
        const newZoneCards = [...zoneCards];
        newZoneCards.splice(idx, 1);

        newPlayers[playerId] = {
          ...player,
          [zoneKey]: newZoneCards,
        };

        // Anadir a la zona destino
        if (to === 'HAND') {
          newPlayers[playerId].hand = [...newPlayers[playerId].hand, movedCard];
        } else if (to === 'WEAR_PILE') {
          // D434 (spec §4.2): una carta prestada de un mazo de Apoyo NO va al
          // Desgaste del jugador — se devuelve al fondo de su mazo de Apoyo
          const isBorrowed = newPlayers[playerId].borrowedSupportCardIds?.includes(cardInstanceId) ?? false;
          const supportIdx = newPlayers[playerId].supportDeckIndexUsedThisTurn;
          if (isBorrowed && supportIdx !== null && supportIdx !== undefined) {
            newPlayers[playerId] = {
              ...newPlayers[playerId],
              supportDecks: (newPlayers[playerId].supportDecks ?? []).map(
                (d, j) => j === supportIdx ? [...d, movedCard] : d,
              ),
              borrowedSupportCardIds: (newPlayers[playerId].borrowedSupportCardIds ?? [])
                .filter(id => id !== cardInstanceId),
            };
          } else {
            newPlayers[playerId].wearPile = [...newPlayers[playerId].wearPile, movedCard];
          }
        } else if (to === 'SUPPORT_DECK' && supportDeckIndex !== undefined) {
          // Destino explícito: mazo de Apoyo concreto (Disparo Rápido con
          // carta prestada emite la zona real en vez de ABILITY_DECK).
          newPlayers[playerId] = {
            ...newPlayers[playerId],
            supportDecks: (newPlayers[playerId].supportDecks ?? []).map(
              (d, j) => j === supportDeckIndex ? [...d, movedCard] : d,
            ),
            borrowedSupportCardIds: (newPlayers[playerId].borrowedSupportCardIds ?? [])
              .filter(id => id !== cardInstanceId),
          };
        } else if (to === 'ABILITY_DECK') {
          // D434: una carta prestada que "vuelve al fondo de su mazo" retorna
          // a su mazo de Apoyo de origen (spec §4.4), no al mazo de Habilidad
          const supportIdx = newPlayers[playerId].supportDeckIndexUsedThisTurn;
          const isBorrowed = newPlayers[playerId].borrowedSupportCardIds?.includes(cardInstanceId) ?? false;
          if (isBorrowed && supportIdx !== null && supportIdx !== undefined) {
            newPlayers[playerId].supportDecks = (newPlayers[playerId].supportDecks ?? []).map(
              (d, j) => j === supportIdx ? [...d, movedCard] : d,
            );
          } else {
            newPlayers[playerId].abilityDeck = [...newPlayers[playerId].abilityDeck, movedCard];
          }
        }

        found = true;
        foundInPlayer = true;
        break;
      }
    }
    if (found) break;
  }

  // D434: buscar tambien en los mazos de Apoyo (solitario)
  if (!found) {
    for (const [playerId, player] of Object.entries(newPlayers)) {
      const decks = player.supportDecks ?? [];
      for (let i = 0; i < decks.length; i++) {
        const idx = decks[i].findIndex(c => c.instanceId === cardInstanceId);
        if (idx >= 0) {
          movedCard = { ...decks[i][idx], zone: to };
          let newDecks = decks.map((d, j) => j === i ? d.filter(c => c.instanceId !== cardInstanceId) : d);
          newPlayers[playerId] = { ...player, supportDecks: newDecks };
          if (to === 'HAND' || to === 'WEAR_PILE') {
            // La carta sale del mazo de Apoyo → queda marcada como prestada
            // para su devolucion/descarte al final del turno (spec §4.2)
            const borrowed = player.borrowedSupportCardIds ?? [];
            newPlayers[playerId] = {
              ...newPlayers[playerId],
              borrowedSupportCardIds: borrowed.includes(cardInstanceId) ? borrowed : [...borrowed, cardInstanceId],
              // Registrar el mazo usado este turno si aun no hay ninguno
              ...(newPlayers[playerId].supportDeckIndexUsedThisTurn == null
                ? { supportDeckIndexUsedThisTurn: i }
                : {}),
            };
            if (to === 'HAND') {
              newPlayers[playerId].hand = [...newPlayers[playerId].hand, movedCard];
            } else {
              newPlayers[playerId].wearPile = [...newPlayers[playerId].wearPile, movedCard];
            }
          } else if (to === 'SUPPORT_DECK' && supportDeckIndex !== undefined) {
            // Destino explícito al mazo de Apoyo indicado en el evento.
            newDecks = newDecks.map((d, j) => j === supportDeckIndex ? [...d, movedCard] : d);
            newPlayers[playerId] = {
              ...newPlayers[playerId],
              supportDecks: newDecks,
              borrowedSupportCardIds: (player.borrowedSupportCardIds ?? []).filter(id => id !== cardInstanceId),
            };
          } else if (to === 'ABILITY_DECK') {
            // "El fondo de su mazo" para una carta prestada = su mazo de
            // Apoyo de origen, no el mazo de Habilidad del jugador (spec §4.4)
            newDecks = newDecks.map((d, j) => j === i ? [...d, movedCard] : d);
            newPlayers[playerId] = {
              ...newPlayers[playerId],
              supportDecks: newDecks,
              // Ya devuelta a su mazo: deja de contar como prestada
              borrowedSupportCardIds: (player.borrowedSupportCardIds ?? []).filter(id => id !== cardInstanceId),
            };
          }
          found = true;
          foundInPlayer = true;
          break;
        }
      }
      if (found) break;
    }
  }

  // Si no se encontro en zonas de jugador, buscar en marketDeck/market
  if (!found) {
    const marketIdx = state.marketDeck.findIndex(c => c.instanceId === cardInstanceId);
    if (marketIdx >= 0) {
      movedCard = { ...state.marketDeck[marketIdx], zone: to };
      const newMarketDeck = [...state.marketDeck];
      newMarketDeck.splice(marketIdx, 1);
      state = { ...state, marketDeck: newMarketDeck };
      found = true;
    }
  }
  if (!found) {
    const marketIdx = state.market.findIndex(c => c.instanceId === cardInstanceId);
    if (marketIdx >= 0) {
      movedCard = { ...state.market[marketIdx], zone: to };
      const newMarket = [...state.market];
      newMarket.splice(marketIdx, 1);
      state = { ...state, market: newMarket };
      found = true;
    }
  }

  // Mazo de la Horda como origen (SEARCH_DECK deck:'HORDE' del Taller).
  if (!found) {
    const hordeIdx = state.hordeDeck.findIndex(c => c.instanceId === cardInstanceId);
    if (hordeIdx >= 0) {
      movedCard = { ...state.hordeDeck[hordeIdx], zone: to };
      const newHordeDeck = [...state.hordeDeck];
      newHordeDeck.splice(hordeIdx, 1);
      state = { ...state, hordeDeck: newHordeDeck };
      found = true;
    }
  }

  // Anadir la carta del mercado a la zona destino del jugador activo (si aplica)
  // Solo si la carta NO se encontro en zonas de jugador (viene del mercado)
  if (found && !foundInPlayer && movedCard && (to === 'HAND' || to === 'WEAR_PILE' || to === 'ABILITY_DECK')) {
    // El destino es el jugador del evento (p.ej. SEARCH_DECK resuelto por
    // un oyente o en el turno de otro), no siempre el activo.
    const activeId = eventPlayerId ?? state.activePlayerId;
    if (activeId && newPlayers[activeId]) {
      const alreadyAdded = newPlayers[activeId].hand.some((c: any) => c.instanceId === cardInstanceId)
        || newPlayers[activeId].abilityDeck.some((c: any) => c.instanceId === cardInstanceId)
        || newPlayers[activeId].wearPile.some((c: any) => c.instanceId === cardInstanceId);
      if (!alreadyAdded) {
        // D377: Clonar el jugador activo para preservar inmutabilidad
        const target = newPlayers[activeId];
        if (to === 'HAND') newPlayers[activeId] = { ...target, hand: [...target.hand, movedCard] };
        else if (to === 'WEAR_PILE') newPlayers[activeId] = { ...target, wearPile: [...target.wearPile, movedCard] };
        else if (to === 'ABILITY_DECK') newPlayers[activeId] = { ...target, abilityDeck: [...target.abilityDeck, movedCard] };
      }
    }
  }

  // Tambien manejar movimiento de una carta del jugador al marketDeck
  if (found && movedCard && to === 'MARKET_DECK') {
    state = { ...state, marketDeck: [...state.marketDeck, movedCard] };
  }
  // …y al mazo de la Horda (SEARCH_DECK SWAP_WITH_HAND sobre deck:'HORDE')
  if (found && movedCard && to === 'HORDE_DECK') {
    state = { ...state, hordeDeck: [...state.hordeDeck, movedCard] };
  }
  // Tambien manejar movimiento de una carta al mercado visible
  if (found && movedCard && to === 'MARKET') {
    state = { ...state, market: [...state.market, movedCard] };
  }

  return { ...state, players: newPlayers };
}

export function removeCardFromAllZones(state: GameState, cardInstanceId: string): GameState {
  const newPlayers = { ...state.players };

  for (const [playerId, player] of Object.entries(newPlayers)) {
    newPlayers[playerId] = {
      ...player,
      hand: player.hand.filter(c => c.instanceId !== cardInstanceId),
      abilityDeck: player.abilityDeck.filter(c => c.instanceId !== cardInstanceId),
      wearPile: player.wearPile.filter(c => c.instanceId !== cardInstanceId),
      persistentCards: player.persistentCards.filter(c => c.instanceId !== cardInstanceId),
      // D434: limpiar tambien mazos de Apoyo y flags de prestada
      supportDecks: (player.supportDecks ?? []).map(d => d.filter(c => c.instanceId !== cardInstanceId)),
      borrowedSupportCardIds: (player.borrowedSupportCardIds ?? []).filter(id => id !== cardInstanceId),
    };
  }

  return {
    ...state,
    players: newPlayers,
    battlefield: state.battlefield.filter(e => e.instanceId !== cardInstanceId),
    market: state.market.filter(c => c.instanceId !== cardInstanceId),
  };
}

// ============================================================================
// Replay: aplicar una lista de eventos al estado inicial
// ============================================================================

export function replayEvents(initialState: GameState, events: GameEvent[]): GameState {
  return events.reduce(applyEvent, initialState);
}
