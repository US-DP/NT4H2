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
  CardInstance,
  Modifier,
  ModifierLayer,
  Zone,
} from '@nt4h/schema';
import { applyEntryAuras, getEffectiveFortitude } from '../modifiers/index.js';

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
    // === Fases y turnos ===
    case 'PHASE_CHANGED':
      // D434: al entrar en HORDE_ATTACK se limpia la decision de Feldon de
      // todos los jugadores para que cada nuevo ataque vuelva a preguntar
      if (event.phase === 'HORDE_ATTACK') {
        const cleared = Object.fromEntries(
          Object.entries(state.players).map(([id, p]) => [id, { ...p, feldonDecision: undefined }]),
        );
        return { ...state, phase: event.phase, players: cleared };
      }
      return { ...state, phase: event.phase };

    case 'TURN_STARTED':
      return {
        ...state,
        activePlayerId: event.playerId,
        turnNumber: event.turnNumber,
        // Reset contadores por turno del jugador activo
        players: mapPlayer(state.players, event.playerId, p => ({
          ...p,
          cardsPlayedThisTurn: {},
          cardsPlayedAgainstEnemy: {},
          prevention: 0,
          damageCancellation: false,
          shields: 0,
          interceptedBy: null,
          // Reset contadores de Apoyo (modo solitario)
          supportCardsDrawnThisTurn: 0,
          supportDeckIndexUsedThisTurn: null,
          supportCardUsedThisTurn: false,
          // D434: limpiar flags de prestadas — las cartas ya fueron devueltas
          // o eliminadas al final del turno anterior
          borrowedSupportCardIds: [],
        })),
      };

    case 'TURN_ENDED':
      return state;

    // === Apoyos (modo solitario) ===
    case 'SUPPORT_DECK_OPENED':
      // D434: event-sourcing del contador de mazos de Apoyo abiertos (spec §4.1)
      return mapPlayerState(state, event.playerId, p => ({
        ...p,
        supportDecksOpened: Math.max(p.supportDecksOpened ?? 0, event.supportDeckIndex + 1),
      }));

    // === Cartas jugadas ===
    case 'CARD_PLAYED': {
      const player = state.players[event.playerId];
      const card = player.hand.find(c => c.instanceId === event.cardInstanceId);
      if (!card) return state; // defensive: carta no encontrada

      // NOTA: NO quitamos la carta de la mano aquí. CARD_MOVED la mueve a WEAR_PILE.
      // Si la quitamos aquí, CARD_MOVED no la encontrará.
      // D434: si es una carta de Apoyo prestada, marcarla como usada
      // (spec §4.2: "Entre las robadas, elegir 1 para usar este turno")
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

    // === Dano y heridas ===
    case 'DAMAGE_DEALT':
      return {
        ...state,
        battlefield: state.battlefield.map(e =>
          e.instanceId === event.targetId
            ? { ...e, wounds: e.wounds + event.amount }
            : e
        ),
      };

    case 'WOUND_PLACED':
      return {
        ...state,
        battlefield: state.battlefield.map(e =>
          e.instanceId === event.enemyInstanceId
            ? { ...e, wounds: e.wounds + event.amount }
            : e
        ),
      };

    case 'ENEMY_DEFEATED': {
      const enemy = state.battlefield.find(e => e.instanceId === event.enemyInstanceId);
      if (!enemy) return state;

      const player = state.players[event.defeatingPlayerId];
      if (!player) return state;
      // Si se derrotó a Roghkiller, eliminar sus modificadores de +1 fortaleza de los orcos
      let newBattlefield = state.battlefield.filter(e => e.instanceId !== event.enemyInstanceId);
      if (enemy.isWarlord && enemy.definitionId.includes('roghkiller')) {
        newBattlefield = newBattlefield.map(e => ({
          ...e,
          modifiers: e.modifiers.filter(m => m.sourceId !== 'roghkiller'),
        }));
      }
      return {
        ...state,
        battlefield: newBattlefield,
        warlordDefeated: state.warlordDefeated || enemy.isWarlord,
        warlordsDefeatedCount: state.warlordsDefeatedCount + (enemy.isWarlord ? 1 : 0),
        players: {
          ...state.players,
          [event.defeatingPlayerId]: {
            ...player,
            // D397: Guardar instanceId (no definitionId) según el schema
            trophies: [...player.trophies, event.enemyInstanceId],
            coins: player.coins + event.reward.coins,
            glory: player.glory + event.reward.glory,
          },
        },
      };
    }

    // === Robo de cartas ===
    case 'CARDS_DRAWN': {
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

    // === Perdida de cartas (del mazo al desgaste) ===
    case 'CARDS_LOST': {
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

    // === Recuperacion de cartas ===
    case 'CARDS_RECOVERED': {
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
        // Buscar en hand (Daga Élfica: la carta no llegó a wearPile)
        const handIdx = remainingHand.findIndex(c => c.instanceId === cardInstanceId);
        if (handIdx >= 0) {
          const card = remainingHand[handIdx];
          if (event.toZone === 'HAND') {
            // Ya está en mano, mantenerla
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

    // === Recursos ===
    case 'GLORY_GAINED':
      return mapPlayerState(state, event.playerId, p => ({
        ...p,
        glory: p.glory + event.amount,
      }));

    case 'GLORY_LOST':
      return mapPlayerState(state, event.playerId, p => ({
        ...p,
        glory: Math.max(0, p.glory - event.amount),
      }));

    case 'COINS_GAINED':
      return mapPlayerState(state, event.playerId, p => ({
        ...p,
        coins: p.coins + event.amount,
      }));

    case 'COINS_STOLEN': {
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

    case 'WOUND_HEALED':
      return mapPlayerState(state, event.playerId, p => ({
        ...p,
        wounds: Math.max(0, p.wounds - event.amount),
      }));

    // === Movimiento de cartas ===
    case 'CARD_MOVED':
      return moveCard(state, event.cardInstanceId, event.to, event.toPlayerId);

    case 'CARD_REMOVED_FROM_GAME':
      return removeCardFromAllZones(state, event.cardInstanceId);

    case 'HORDE_DECK_REORDERED': {
      // Reordenar el mazo de la Horda según newOrder (ej. pericia de Idril)
      const byInstance = new Map(state.hordeDeck.map(c => [c.instanceId, c]));
      const reordered = event.newOrder
        .map(id => byInstance.get(id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
      // Cartas no mencionadas (defensivo): conservarlas al final
      const remaining = state.hordeDeck.filter(c => !event.newOrder.includes(c.instanceId));
      return { ...state, hordeDeck: [...reordered, ...remaining] };
    }

    // === Ataque de la Horda ===
    case 'HORDE_ATTACKED':
      // El dano ya fue procesado como CARDS_LOST por el motor
      return state;

    // === Revelacion de enemigos ===
    case 'ENEMY_REVEALED':
      return state; // El enemigo ya esta en battlefield

    case 'WARLORD_REVEALED':
      return { ...state, warlordRevealed: true };

    // === Mercado ===
    case 'MARKET_PURCHASED': {
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

    case 'MARKET_REPLENISHED': {
      // Mover la carta del marketDeck al mercado (especificacion 3.5)
      const newCard = state.marketDeck.find(c => c.instanceId === event.cardInstanceId);
      if (!newCard) return state;
      return {
        ...state,
        market: [...state.market, { ...newCard, zone: 'MARKET' as Zone }],
        marketDeck: state.marketDeck.filter(c => c.instanceId !== event.cardInstanceId),
      };
    }

    // === Escenarios ===
    case 'SCENARIO_REVEALED':
      // Setear el escenario revelado (puede haber sido borrado por SCENARIO_DISCARDED previo)
      return {
        ...state,
        scenario: {
          instanceId: event.scenarioInstanceId,
          definitionId: event.definitionId,
          ownerId: 'scenario',
          zone: 'SCENARIO_ACTIVE' as Zone,
        },
        // Solitario: 1 moneda sobre el escenario revelado (spec §4.1)
        scenarioCoins: state.mode === 'SOLO' ? 1 : 0,
      };

    case 'SCENARIO_DISCARDED':
      // D434 (spec §4.2): la moneda del último escenario se recoge "al
      // finalizar la partida". Si el descarte se produce al revelarse el
      // Señor (warlordRevealed ya true por el WARLORD_REVEALED previo),
      // conservar scenarioCoins para el recuento final.
      return {
        ...state,
        scenario: null,
        scenarioCoins: state.warlordRevealed ? state.scenarioCoins : 0,
      };

    // === Pericias ===
    case 'HERO_ABILITY_USED':
      return mapPlayerState(state, event.playerId, p => ({
        ...p,
        heroUsesRemaining: event.usesRemaining,
      }));

    // === Prevencion ===
    case 'PREVENTION_APPLIED':
      return mapPlayerState(state, event.playerId, p => ({
        ...p,
        prevention: p.prevention + event.amount,
      }));

    case 'SHIELD_PLACED':
      return mapPlayerState(state, event.playerId, p => ({
        ...p,
        shields: p.shields + event.amount,
      }));

    case 'SHIELD_TRANSFERRED': {
      const fromPlayer = state.players[event.fromPlayerId];
      const toPlayer = state.players[event.toPlayerId];
      if (!fromPlayer || !toPlayer) return state;
      return {
        ...state,
        players: {
          ...state.players,
          [event.fromPlayerId]: { ...fromPlayer, shields: Math.max(0, fromPlayer.shields - event.amount) },
          [event.toPlayerId]: { ...toPlayer, shields: toPlayer.shields + event.amount },
        },
      };
    }

    case 'CANCELLATION_ACTIVATED':
      return mapPlayerState(state, event.playerId, p => ({
        ...p,
        damageCancellation: true,
      }));

    // === Enemigos ===
    case 'ENEMY_DAMAGE_DISABLED':
      return {
        ...state,
        battlefield: state.battlefield.map(e =>
          e.instanceId === event.enemyInstanceId
            ? { ...e, damageDisabled: true }
            : e
        ),
      };

    case 'VULNERABILITY_APPLIED':
      return {
        ...state,
        battlefield: state.battlefield.map(e =>
          e.instanceId === event.enemyInstanceId
            ? {
                ...e,
                modifiers: [
                  ...e.modifiers,
                  {
                    id: `vuln-${event.seq}`,
                    sourceId: event.enemyInstanceId,
                    layer: 'DAMAGE_BONUS',
                    timestamp: event.seq,
                    duration: 'UNTIL_END_OF_TURN',
                    amount: event.bonus,
                    targetId: event.enemyInstanceId,
                  },
                ],
              }
            : e
        ),
      };

    // === Modificadores ===
    case 'MODIFIER_ADDED': {
      // Aplicar modificador al objetivo (jugador, enemigo o mercado)
      const modifier: Modifier = {
        id: event.modifierId,
        sourceId: event.sourceId ?? '',
        layer: event.layer as ModifierLayer,
        timestamp: state.monotonicCounter,
        duration: (event.duration as Modifier['duration']) ?? 'UNTIL_END_OF_TURN',
        amount: event.amount ?? 0,
        filter: event.filter,
        scope: event.scope,
        targetId: event.targetId,
      };
      // Si el target es un enemigo del campo
      const enemy = state.battlefield.find(e => e.instanceId === event.targetId);
      if (enemy) {
        return {
          ...state,
          battlefield: state.battlefield.map(e =>
            e.instanceId === event.targetId
              ? { ...e, modifiers: [...e.modifiers, modifier] }
              : e
          ),
        };
      }
      // Si el target es un jugador
      if (state.players[event.targetId]) {
        return mapPlayerState(state, event.targetId, p => ({
          ...p,
          modifiers: [...p.modifiers, modifier],
        }));
      }
      // Si el target es 'market', aplicar modificador de coste
      if (event.targetId === 'market' && event.layer === 'MARKET_COST') {
        // D418: sin amount explicito, no aplicar nada (default -1 era peligroso)
        if (event.amount === undefined) return state;
        return { ...state, marketCostModifier: state.marketCostModifier + event.amount };
      }
      return state;
    }

    case 'MODIFIER_EXPIRED': {
      const newPlayers = { ...state.players };
      for (const [id, p] of Object.entries(newPlayers)) {
        newPlayers[id] = {
          ...p,
          modifiers: p.modifiers.filter(m => m.id !== event.modifierId),
        };
      }
      return {
        ...state,
        players: newPlayers,
        battlefield: state.battlefield.map(e => ({
          ...e,
          modifiers: e.modifiers.filter(m => m.id !== event.modifierId),
        })),
      };
    }

    // === Heridas de heroe ===
    case 'HERO_WOUNDED':
      return mapPlayerState(state, event.playerId, p => ({
        ...p,
        wounds: event.woundCount,
      }));

    // === Mazo agotado y reciclado ===
    case 'DECK_EXHAUSTED':
      return state;

    case 'DECK_RESHUFFLED':
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

    // === Evasion ===
    case 'EVASION_PERFORMED': {
      const player = state.players[event.playerId];
      const discarded = player.hand.filter(c => event.discardedCardInstanceIds.includes(c.instanceId));
      const remainingHand = player.hand.filter(c => !event.discardedCardInstanceIds.includes(c.instanceId));

      return {
        ...state,
        evasionDiscardedCount: event.discardedCardInstanceIds.length,
        players: {
          ...state.players,
          [event.playerId]: {
            ...player,
            hand: remainingHand,
            wearPile: [...player.wearPile, ...discarded.map(c => ({ ...c, zone: 'WEAR_PILE' as Zone }))],
          },
        },
      };
    }

    // === Fin de partida ===
    case 'GAME_ENDED':
      return { ...state, phase: 'FINISHED' };

    // === Cartas persistentes ===
    case 'PERSISTENT_CARD_PLACED':
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

    case 'PERSISTENT_CARD_REMOVED':
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

    // === Leader ===
    case 'LEADER_DETERMINED':
      return { ...state, activePlayerId: event.playerId };

    // === Deck Shuffle ===
    case 'DECK_SHUFFLED': {
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

    // === Enemy Swapped ===
    case 'ENEMY_SWAPPED': {
      // El enemigo viejo vuelve al FONDO del mazo de la Horda, el nuevo entra al campo
      const oldEnemy = state.battlefield.find(e => e.instanceId === event.oldEnemyInstanceId);
      if (!oldEnemy) return state;
      const oldEnemyCard: CardInstance = {
        instanceId: oldEnemy.instanceId,
        definitionId: oldEnemy.definitionId,
        ownerId: 'horde',
        zone: 'HORDE_DECK',
      };
      const newEnemy = applyEntryAuras({
        instanceId: event.newEnemyInstanceId,
        definitionId: event.newEnemyDefinitionId,
        baseFortitude: event.newEnemyFortitude,
        wounds: 0,
        reward: event.newEnemyReward,
        modifiers: [],
        isWarlord: event.newEnemyIsWarlord,
        isOrc: event.newEnemyIsOrc,
        specialIcons: event.newEnemySpecialIcons,
        damageDisabled: false,
      }, state);
      return {
        ...state,
        battlefield: state.battlefield.map(e =>
          e.instanceId === event.oldEnemyInstanceId ? newEnemy : e
        ),
        hordeDeck: [
          ...state.hordeDeck.filter(c => c.instanceId !== event.newEnemyInstanceId),
          oldEnemyCard,
        ],
      };
    }

    // === Enemy Returned to Horde ===
    case 'ENEMY_RETURNED_TO_HORDE': {
      const enemy = state.battlefield.find(e => e.instanceId === event.enemyInstanceId);
      if (!enemy) return state;
      const enemyCard: CardInstance = {
        instanceId: enemy.instanceId,
        definitionId: enemy.definitionId,
        ownerId: 'horde',
        zone: 'HORDE_DECK',
      };
      return {
        ...state,
        battlefield: state.battlefield.filter(e => e.instanceId !== event.enemyInstanceId),
        hordeDeck: event.position === 'BOTTOM'
          ? [...state.hordeDeck, enemyCard]
          : [enemyCard, ...state.hordeDeck],
      };
    }

    // === Damage Intercepted ===
    case 'DAMAGE_INTERCEPTED': {
      // Valerys: interceptar dano de otro heroe
      // El interceptor recibe el dano como perdida de cartas y gana 1 Gloria
      const interceptor = state.players[event.interceptorPlayerId];
      if (!interceptor) return state;
      if (event.amount <= 0) {
        // Registrar intercepcion: el dano real se aplicara en processHordeAttack
        return mapPlayerState(state, event.originalTargetPlayerId, p => ({
          ...p,
          interceptedBy: event.interceptorPlayerId,
          glory: p.glory,
        }));
      }
      // Aplicar dano como perdida de cartas (la Gloria ya se otorgo en valerysAbility)
      const lost = interceptor.abilityDeck.slice(0, event.amount).map(c => c.instanceId);
      return mapPlayerState(state, event.interceptorPlayerId, p => ({
        ...p,
        abilityDeck: p.abilityDeck.slice(lost.length),
        wearPile: [...p.wearPile, ...p.abilityDeck.slice(0, lost.length).map(c => ({ ...c, zone: 'WEAR_PILE' as Zone }))],
      }));
    }

    // === Cards Revealed to Player ===
    case 'CARDS_REVEALED_TO_PLAYER':
      // No cambia el estado del juego; es informativo para el cliente
      return state;

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

function mapPlayer(
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
          glory: work.ignoreGloryRewards ? 0 : (current.reward?.glory ?? 0),
        },
        seq: seq(),
      };
      events.push(ev);
      work = applyEvent(work, ev);
    }
  }
  return events;
}

function moveCard(state: GameState, cardInstanceId: string, to: Zone, toPlayerId?: string): GameState {
  const newPlayers = { ...state.players };

  // Transferencia entre jugadores (toPlayerId ≠ propietario actual):
  // quitar la carta de cualquier zona de su dueño y añadirla a la zona
  // `to` del jugador destino (ej. PLAY_RANDOM_CARD_FROM_OTHER_HERO).
  if (toPlayerId && newPlayers[toPlayerId]) {
    let movedCard: any = null;
    let sourcePlayerId: string | null = null;
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
          break;
        }
      }
      if (movedCard) break;
    }
    if (movedCard && sourcePlayerId && sourcePlayerId !== toPlayerId) {
      const target = newPlayers[toPlayerId];
      if (to === 'HAND') {
        newPlayers[toPlayerId] = { ...target, hand: [...target.hand, movedCard] };
      } else if (to === 'WEAR_PILE') {
        newPlayers[toPlayerId] = { ...target, wearPile: [...target.wearPile, movedCard] };
      } else if (to === 'ABILITY_DECK') {
        newPlayers[toPlayerId] = { ...target, abilityDeck: [...target.abilityDeck, movedCard] };
      }
      return { ...state, players: newPlayers };
    }
    // Si la carta no existe o ya es del destino, caer al flujo normal
    if (movedCard && sourcePlayerId === toPlayerId) {
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
          newPlayers[playerId].wearPile = [...newPlayers[playerId].wearPile, movedCard];
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

  // Anadir la carta del mercado a la zona destino del jugador activo (si aplica)
  // Solo si la carta NO se encontro en zonas de jugador (viene del mercado)
  if (found && !foundInPlayer && movedCard && (to === 'HAND' || to === 'WEAR_PILE' || to === 'ABILITY_DECK')) {
    const activeId = state.activePlayerId;
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
  // Tambien manejar movimiento de una carta al mercado visible
  if (found && movedCard && to === 'MARKET') {
    state = { ...state, market: [...state.market, movedCard] };
  }

  return { ...state, players: newPlayers };
}

function removeCardFromAllZones(state: GameState, cardInstanceId: string): GameState {
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
