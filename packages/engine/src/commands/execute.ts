/**
 * execute — ejecutar un comando contra el estado del juego.
 *
 * Pipeline:
 * 1. isLegal: validar que el comando es legal.
 * 2. plan: consumir RNG si es necesario.
 * 3. execute: resolver efectos y generar eventos.
 * 4. apply: aplicar eventos al estado (reducer puro).
 *
 * El estado devuelto es un nuevo objeto (inmutable).
 */

import type { GameState, GameEvent, Command, PendingChoice, EnemyState, ResolutionContext } from '@nt4h/schema';
import type { DeterministicRng } from '../rng/index.js';
import { applyEvent, checkFortitudeDefeats } from '../events/applyEvent.js';
import { useHeroAbility } from '../heroes/abilities.js';
import { EffectRegistry, registerCoreEffects, drawCardsWithReshuffle, evalValue } from '../effects/registry.js';
import { resolveCard, processHordeAttackTriggers } from '../effects/resolver.js';
import { swapStartingCards, openSupportDeck, buySupportCard } from '../modes/solo.js';
import { executeTurnStartEffect } from '../scenarios/index.js';
import { applyEntryAuras } from '../modifiers/index.js';
import type { CatalogLoadResult } from '@nt4h/catalog';

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export interface CommandResult {
  accepted: boolean;
  reason?: string;
  events: GameEvent[];
  newState: GameState;
  rng: DeterministicRng;
}

export function isLegal(
  state: GameState,
  playerId: string,
  command: Command,
  catalog?: CatalogLoadResult,
): ValidationResult {
  // Validaciones basicas
  switch (command.type) {
    case 'PLAY_CARD': {
      if (state.phase !== 'PLAYER_ATTACK' && state.phase !== 'RESOLVING_CARD' && state.phase !== 'ATTACK_CHOICE') {
        return { ok: false, reason: 'Not in attack phase' };
      }
      if (state.activePlayerId !== playerId) {
        return { ok: false, reason: 'Not your turn' };
      }
      const player = state.players[playerId];
      const card = player.hand.find(c => c.instanceId === command.cardInstanceId);
      if (!card) {
        return { ok: false, reason: 'Card not in hand' };
      }
      // D419: validar que el objetivo existe — si no, la carta se quemaria sin efecto
      if (command.targetEnemyId !== undefined) {
        const targetExists = state.battlefield.some(e => e.instanceId === command.targetEnemyId);
        if (!targetExists) {
          return { ok: false, reason: 'Target enemy not found' };
        }
      }
      // D434: en solitario solo se puede usar 1 carta de Apoyo por turno
      // (spec §4.2: "Entre las robadas, elegir 1 para usar este turno")
      if (player.supportCardUsedThisTurn && player.borrowedSupportCardIds?.includes(command.cardInstanceId)) {
        return { ok: false, reason: 'Only 1 support card can be used per turn' };
      }
      // Verificar costes de la carta (efecto COST)
      if (catalog) {
        const cardDef = catalog.byId.get(card.definitionId);
        if (cardDef?.effects) {
          for (const eff of cardDef.effects) {
            if (eff.type === 'COST' && eff.resource === 'COINS') {
              // Coste dinámico: evaluar la expresión completa, no tratarla como 0
              const costCtx: ResolutionContext = {
                activePlayerId: playerId,
                currentCardId: card.definitionId,
                currentCardName: card.name ?? '',
                currentCardInstanceId: card.instanceId,
                selectedEnemyId: null,
                cardsPlayedThisTurn: player.cardsPlayedThisTurn,
                cardsPlayedAgainstEnemy: player.cardsPlayedAgainstEnemy,
                drawnCardInstanceId: null,
                sourceZone: 'HAND',
                enemiesDefeatedThisResolution: [],
                depth: 0,
              };
              const amount = eff.amount.kind === 'CONSTANT'
                ? eff.amount.value
                : evalValue(eff.amount, costCtx, state);
              if (player.coins < amount) {
                return { ok: false, reason: `Not enough coins (need ${amount}, have ${player.coins})` };
              }
            }
          }
        }
      }
      return { ok: true };
    }

    case 'END_ATTACK': {
      if (state.phase !== 'PLAYER_ATTACK' && state.phase !== 'ATTACK_CHOICE') {
        return { ok: false, reason: 'Not in attack phase' };
      }
      if (state.activePlayerId !== playerId) {
        return { ok: false, reason: 'Not your turn' };
      }
      return { ok: true };
    }

    case 'EVASION': {
      if (state.phase !== 'ATTACK_CHOICE') {
        return { ok: false, reason: 'Not in attack choice phase' };
      }
      if (state.activePlayerId !== playerId) {
        return { ok: false, reason: 'Not your turn' };
      }
      // Especificacion 3.4 Opcion B: descartar minimo 2 cartas de la mano
      if (command.discardedCardInstanceIds.length < 2) {
        return { ok: false, reason: 'Must discard at least 2 cards to evade' };
      }
      // Validar que no haya IDs duplicados (evita inflar bonus de Taheral)
      const uniqueIds = new Set(command.discardedCardInstanceIds);
      if (uniqueIds.size !== command.discardedCardInstanceIds.length) {
        return { ok: false, reason: 'Duplicate card IDs in evasion' };
      }
      const player = state.players[playerId];
      // Verificar que las cartas pertenezcan a la mano del jugador
      for (const cardId of command.discardedCardInstanceIds) {
        const inHand = player.hand.some(c => c.instanceId === cardId);
        if (!inHand) {
          return { ok: false, reason: 'Discarded cards must be from hand' };
        }
      }
      return { ok: true };
    }

    case 'BUY_CARD': {
      if (state.phase !== 'MARKET') {
        return { ok: false, reason: 'Not in market phase' };
      }
      if (state.activePlayerId !== playerId) {
        return { ok: false, reason: 'Not your turn' };
      }
      const card = state.market.find(c => c.instanceId === command.marketCardInstanceId);
      if (!card) {
        return { ok: false, reason: 'Card not in market' };
      }
      // Validar coste y capacidades desde el catalogo
      // D376: Sin catalogo no se puede validar el coste; rechazar
      if (!catalog) {
        return { ok: false, reason: 'Catalog required to validate purchase' };
      }
      const cardDef = catalog.byId.get(card.definitionId);
      if (!cardDef) {
        return { ok: false, reason: 'Card definition not found' };
      }
      {
        const player = state.players[playerId];
        const cost = Math.max(0, (cardDef.printedCost ?? 0) + state.marketCostModifier);
        if (player.coins < cost) {
          return { ok: false, reason: `Not enough coins (need ${cost}, have ${player.coins})` };
        }
        // Validar iconos de capacidad requeridos
        // D: Un heroe puede comprar una carta si tiene todos los requiredCapabilities,
        // o si tiene un penaltyCapability que sustituye al requerido (ej: Picaro con EXPERTISE usa RANGED con -1)
        if (cardDef.requiredCapabilities && cardDef.requiredCapabilities.length > 0) {
          const hasAll = cardDef.requiredCapabilities.every(icon =>
            player.capabilities.includes(icon)
          );
          if (!hasAll) {
            // Verificar si puede usarla con penalizacion
            const canUseWithPenalty = cardDef.requiredCapabilities.every(reqIcon =>
              player.capabilities.includes(reqIcon) ||
              (cardDef.penaltyCapabilities?.some(p => player.capabilities.includes(p.icon)) ?? false)
            );
            if (!canUseWithPenalty) {
              return { ok: false, reason: 'Hero lacks required capabilities' };
            }
          }
        }
      }
      return { ok: true };
    }

    case 'END_TURN': {
      if (state.phase !== 'RESTORATION' && state.phase !== 'MARKET') {
        return { ok: false, reason: 'Not in restoration or market phase' };
      }
      // D392: Validar jugador activo
      if (state.activePlayerId !== playerId) {
        return { ok: false, reason: 'Not your turn' };
      }
      return { ok: true };
    }

    case 'USE_HERO_ABILITY': {
      const player = state.players[playerId];
      if (player.heroUsesRemaining <= 0) {
        return { ok: false, reason: 'No hero ability uses remaining' };
      }
      // D356: Validar fase según el héroe
      // Valèrys y Lisavette son reactivos: solo durante HORDE_ATTACK
      const heroDef = catalog?.byId.get(player.heroId);
      const heroId = heroDef?.id ?? player.heroId ?? '';
      // D428: héroes reactivos identificados por heroId estable
      const isReactiveHero = heroId === 'hero.valerys' || heroId === 'hero.lisavette';
      if (isReactiveHero && state.phase !== 'HORDE_ATTACK') {
        return { ok: false, reason: 'This hero ability can only be used during Horde Attack' };
      }
      // D434: pericias reactivas solo pueden usarse "sobre otro Héroe" (spec
      // §6.8) — el jugador activo no puede activarlas en su propio turno
      if (isReactiveHero && playerId === state.activePlayerId) {
        return { ok: false, reason: 'Reactive ability cannot be used on your own turn' };
      }
      // Héroes activos: solo durante el turno del jugador (no SETUP, FINISHED, etc.)
      if (!isReactiveHero && (state.phase === 'SETUP' || state.phase === 'FINISHED' || state.phase === 'GAME_END_CHECK')) {
        return { ok: false, reason: 'Cannot use hero ability in this phase' };
      }
      return { ok: true };
    }

    case 'SWAP_STARTING_CARDS': {
      if (state.mode !== 'SOLO') {
        return { ok: false, reason: 'Only available in solo mode' };
      }
      if (state.phase !== 'SETUP' && state.phase !== 'INITIAL_PLAYER_SELECTION') {
        return { ok: false, reason: 'Only during setup or initial selection' };
      }
      if (command.cardInstanceIds.length > 2) {
        return { ok: false, reason: 'Can only swap up to 2 cards' };
      }
      // D399: Validar ids unicos (no duplicados)
      const uniqueIds = new Set(command.cardInstanceIds);
      if (uniqueIds.size !== command.cardInstanceIds.length) {
        return { ok: false, reason: 'Duplicate card ids' };
      }
      // D395: Validar que las cartas están en la mano
      const swapPlayer = state.players[playerId];
      if (swapPlayer) {
        for (const cardId of command.cardInstanceIds) {
          if (!swapPlayer.hand.some(c => c.instanceId === cardId)) {
            return { ok: false, reason: 'Card not in hand' };
          }
        }
      }
      return { ok: true };
    }

    case 'CHOOSE_LEADER_CARDS': {
      if (state.phase !== 'INITIAL_PLAYER_SELECTION') {
        return { ok: false, reason: 'Only during initial player selection' };
      }
      if (command.cardInstanceIds.length < 1 || command.cardInstanceIds.length > 2) {
        return { ok: false, reason: 'Must choose 1 or 2 cards' };
      }
      // Validar que las cartas están en la mano del jugador
      const player = state.players[playerId];
      if (!player) return { ok: false, reason: 'Player not found' };
      const handIds = new Set(player.hand.map(c => c.instanceId));
      for (const cardId of command.cardInstanceIds) {
        if (!handIds.has(cardId)) {
          return { ok: false, reason: 'Card not in hand' };
        }
      }
      // Validar que el jugador tiene una pendingChoice de líder
      const hasLeaderChoice = state.pendingChoices.some(
        c => c.choiceId === `leader-bid-${playerId}` && c.type === 'SELECT_CARDS_FOR_LEADER'
      );
      if (!hasLeaderChoice) {
        return { ok: false, reason: 'Player has no pending leader bid' };
      }
      return { ok: true };
    }

    case 'ACCEPT_TURN_START_EFFECT': {
      if (!state.scenario) {
        return { ok: false, reason: 'No active scenario' };
      }
      // D433: solo es legal si existe la eleccion de inicio de turno de este
      // jugador; evita disparar efectos de escenario fuera de su ventana
      const hasTurnStartChoice = state.pendingChoices.some(
        c => c.choiceId === `turn-start-${state.turnNumber}` && c.playerId === playerId
      );
      if (!hasTurnStartChoice) {
        return { ok: false, reason: 'No pending turn-start effect for you' };
      }
      return { ok: true };
    }

    case 'OPEN_SUPPORT_DECK': {
      if (state.mode !== 'SOLO') {
        return { ok: false, reason: 'Only available in solo mode' };
      }
      // D361: Apoyos solo durante la Fase de Ataque (spec §4.2)
      if (state.phase !== 'PLAYER_ATTACK' && state.phase !== 'ATTACK_CHOICE') {
        return { ok: false, reason: 'Support decks can only be opened during the Attack phase' };
      }
      // D393: Validar jugador activo
      if (state.activePlayerId !== playerId) {
        return { ok: false, reason: 'Not your turn' };
      }
      return { ok: true };
    }

    case 'BUY_SUPPORT_CARD': {
      if (state.mode !== 'SOLO') {
        return { ok: false, reason: 'Only available in solo mode' };
      }
      // D361: Apoyos solo durante la Fase de Ataque (spec §4.2)
      if (state.phase !== 'PLAYER_ATTACK' && state.phase !== 'ATTACK_CHOICE') {
        return { ok: false, reason: 'Support cards can only be bought during the Attack phase' };
      }
      // D393: Validar jugador activo
      if (state.activePlayerId !== playerId) {
        return { ok: false, reason: 'Not your turn' };
      }
      return { ok: true };
    }

    case 'PASS':
      return { ok: true };

    case 'RESOLVE_CHOICE': {
      const choice = state.pendingChoices.find(c => c.choiceId === command.choiceId);
      if (!choice) return { ok: false, reason: 'Choice not found' };
      if (choice.playerId !== playerId) return { ok: false, reason: 'Not your choice' };
      if (command.selectedIds.length < choice.minSelections || command.selectedIds.length > choice.maxSelections) {
        return { ok: false, reason: 'Invalid number of selections' };
      }
      // D394/D434: Validar que todas las selecciones estén en las opciones
      // válidas — también para CONFIRM, cuyas opciones textuales ('yes'/'no',
      // 'glory'/'coins') ya están en `options`
      for (const id of command.selectedIds) {
        if (!choice.options.includes(id)) {
          return { ok: false, reason: 'Invalid selection: not among available options' };
        }
      }
      // D400: Validar que no haya selecciones duplicadas (especialmente SELECT_ORDER)
      const uniqueSelected = new Set(command.selectedIds);
      if (uniqueSelected.size !== command.selectedIds.length) {
        return { ok: false, reason: 'Duplicate selections' };
      }
      return { ok: true };
    }

    default:
      return { ok: false, reason: 'Command not supported' };
  }
}

export function execute(
  state: GameState,
  command: Command,
  rng: DeterministicRng,
  registry?: EffectRegistry,
  catalog?: CatalogLoadResult,
  actingPlayerId?: string,
): CommandResult {
  // Identificar al jugador que envia el comando
  const playerId = getPlayerIdFromCommand(command, state, actingPlayerId);

  // D423: si el transporte (backend/engine-runner) proporciona un playerId
  // autenticado, verificar que coincide con el jugador que el motor atribuye
  // al comando. Sin esta verificación un cliente podría suplantar a otro
  // jugador en modo online (el comando no lleva playerId en el schema).
  if (actingPlayerId !== undefined && actingPlayerId !== playerId) {
    return {
      accepted: false,
      reason: `Command attributed to ${playerId}, but sender is ${actingPlayerId}`,
      events: [],
      newState: state,
      rng,
    };
  }

  // Un héroe eliminado (wounds >= maxWounds) no puede ejecutar comandos —
  // la spec le saca de la partida en cuanto recibe la herida letal, no al
  // final de su turno.
  const actingPlayer = state.players[playerId];
  if (
    actingPlayer
    && actingPlayer.wounds >= (actingPlayer.maxWounds ?? 4)
    && command.type !== 'PASS'
  ) {
    return {
      accepted: false,
      reason: 'Hero is eliminated',
      events: [],
      newState: state,
      rng,
    };
  }

  // 1. Validar
  const validation = isLegal(state, playerId, command, catalog);
  if (!validation.ok) {
    return {
      accepted: false,
      reason: validation.reason,
      events: [],
      newState: state,
      rng,
    };
  }

  // 2. Preparar motor de efectos
  const reg = registry ?? new EffectRegistry();
  if (!registry) {
    registerCoreEffects(reg);
  }

  // 3. Generar eventos segun el comando
  const events: GameEvent[] = [];

  switch (command.type) {
    case 'PLAY_CARD': {
      const player = state.players[playerId];
      const card = player.hand.find(c => c.instanceId === command.cardInstanceId);
      if (!card) {
        return { accepted: false, reason: 'Card not found', events, newState: state, rng };
      }
      // Si estamos en ATTACK_CHOICE, transicionar a PLAYER_ATTACK primero
      if (state.phase === 'ATTACK_CHOICE') {
        events.push({
          type: 'PHASE_CHANGED',
          phase: 'PLAYER_ATTACK',
          seq: reg.nextSeq(),
        });
        state = { ...state, phase: 'PLAYER_ATTACK' };
      }

      // Si tenemos catalogo, resolver la carta completamente con efectos
      if (catalog) {
        const cardDef = catalog.byId.get(card.definitionId);
        if (cardDef) {
          const result = resolveCard(
            state,
            card,
            cardDef,
            command.targetEnemyId ?? null,
            player,
            rng,
            reg,
            catalog,
          );
          // Si hay eleccion pendiente (empate), aplicar eventos acumulados y guardar la eleccion
          // D390: Aplicar los eventos al estado antes de devolverlo
          if (result.pendingChoice) {
            let choiceState = state;
            for (const ev of result.events) {
              choiceState = applyEvent(choiceState, ev);
            }
            choiceState = {
              ...choiceState,
              pendingChoices: [...choiceState.pendingChoices, result.pendingChoice],
            };
            return {
              accepted: true,
              events: [...events, ...result.events],
              newState: choiceState,
              rng,
            };
          }
          // Aplicar todos los eventos generados por la resolucion
          let resolvedState = state;
          for (const ev of result.events) {
            resolvedState = applyEvent(resolvedState, ev);
          }
          return {
            accepted: true,
            events: [...events, ...result.events],
            newState: { ...resolvedState, rngState: rng.serialize() },
            rng,
          };
        }
      }

      // Fallback sin catalogo: esqueleto basico
      events.push({
        type: 'CARD_PLAYED',
        playerId,
        cardInstanceId: card.instanceId,
        cardDefinitionId: card.definitionId,
        cardName: catalog?.byId.get(card.definitionId)?.name,
        targetEnemyInstanceId: command.targetEnemyId,
        seq: reg.nextSeq(),
      });

      // Mover carta a Desgaste
      if (card.zone !== 'IN_FRONT_OF_PLAYER') {
        events.push({
          type: 'CARD_MOVED',
          cardInstanceId: card.instanceId,
          from: 'HAND',
          to: 'WEAR_PILE',
          seq: reg.nextSeq(),
        });
      }

      break;
    }

    case 'END_ATTACK': {
      // Pasar a fase de ataque de la Horda
      events.push({
        type: 'PHASE_CHANGED',
        phase: 'HORDE_ATTACK',
        seq: reg.nextSeq(),
      });
      break;
    }

    case 'EVASION': {
      events.push({
        type: 'EVASION_PERFORMED',
        playerId,
        discardedCardInstanceIds: command.discardedCardInstanceIds,
        seq: reg.nextSeq(),
      });
      // EVASION_PERFORMED ya mueve las cartas de HAND a WEAR_PILE en applyEvent.
      // No emitir CARD_MOVED redundantes (D334).
      // Poblar evasionDiscardedCount en el estado para EVASION_DISCARDED_COUNT
      state = { ...state, evasionDiscardedCount: command.discardedCardInstanceIds.length };
      // D434: Taheral — pericia de uso discrecional (spec §3.11): el jugador
      // decide si gasta su uso. CONFIRM opt-in; el bonus se aplica al resolver.
      const taheralPlayer = state.players[playerId];
      if (taheralPlayer?.heroId === 'hero.taheral' && (taheralPlayer.heroUsesRemaining ?? 0) > 0) {
        state = {
          ...state,
          pendingChoices: [...state.pendingChoices, {
            choiceId: `taheral-evasion-${state.turnNumber}`,
            playerId,
            type: 'CONFIRM' as const,
            prompt: `Taheral: ¿usar tu Pericia para ganar ${command.discardedCardInstanceIds.length * 2} Monedas?`,
            options: ['yes', 'no'],
            minSelections: 1,
            maxSelections: 1,
          }],
        };
      }
      // Yermo de Cemenmar: en evasión, el jugador PODRÁ robar hasta 3 monedas
      // (max 2 por héroe) — opt-in con distribución elegida (spec §6.9 "podrá")
      if (state.scenario?.definitionId === 'scenario.cemenmar-wastes' && state.mode !== 'SOLO') {
        const stealOptions: string[] = [];
        for (const otherId of state.playerOrder.filter(id => id !== playerId)) {
          const coins = state.players[otherId]?.coins ?? 0;
          // Un slot por moneda robable (max 2 por heroe) — ids unicos para
          // respetar la validacion anti-duplicados de RESOLVE_CHOICE
          for (let i = 1; i <= Math.min(2, coins); i++) {
            stealOptions.push(`${otherId}#coin${i}`);
          }
        }
        if (stealOptions.length > 0) {
          state = {
            ...state,
            pendingChoices: [...state.pendingChoices, {
              choiceId: `cemenmar-steal-${state.turnNumber}`,
              playerId,
              type: 'SELECT_COINS_TO_STEAL' as const,
              prompt: 'Yermo de Cemenmar: elige hasta 3 Monedas a robar (máx. 2 por héroe)',
              options: stealOptions,
              minSelections: 0,
              maxSelections: 3,
            }],
          };
        }
      }
      // Pasar directamente a Mercado (no recibe daño de la Horda)
      events.push({
        type: 'PHASE_CHANGED',
        phase: 'MARKET',
        seq: reg.nextSeq(),
      });
      break;
    }

    case 'BUY_CARD': {
      const card = state.market.find(c => c.instanceId === command.marketCardInstanceId);
      if (!card) {
        return { accepted: false, reason: 'Card not in market', events, newState: state, rng };
      }
      // Determinar coste desde el catalogo
      // D376: Sin catalogo no se puede determinar el coste; rechazar
      if (!catalog) {
        return { accepted: false, reason: 'Catalog required to determine cost', events, newState: state, rng };
      }
      const cardDef = catalog.byId.get(card.definitionId);
      if (!cardDef) {
        return { accepted: false, reason: 'Card definition not found', events, newState: state, rng };
      }
      let cost = cardDef.printedCost ?? 0;
      // Aplicar modificador de escenario (Mercado de Lotharion: -1)
      cost = Math.max(0, cost + state.marketCostModifier);
      events.push({
        type: 'MARKET_PURCHASED',
        playerId,
        cardInstanceId: card.instanceId,
        cost,
        seq: reg.nextSeq(),
      });
      // Reposicion automatica: siempre 5 cartas disponibles (especificacion 3.5)
      // EXCEPCION: en modo solitario no se repone el mercado (especificacion 4.1)
      if (state.marketDeck.length > 0 && state.mode !== 'SOLO') {
        const newCard = state.marketDeck[0];
        events.push({
          type: 'MARKET_REPLENISHED',
          cardInstanceId: newCard.instanceId,
          seq: reg.nextSeq(),
        });
      }
      break;
    }

    case 'END_TURN': {
      // Si estamos en MARKET, transicionar a RESTORATION primero
      if (state.phase === 'MARKET') {
        events.push({
          type: 'PHASE_CHANGED',
          phase: 'RESTORATION',
          seq: reg.nextSeq(),
        });
        state = { ...state, phase: 'RESTORATION' };
      }
      // TURN_ENDED lo emite processTurnEnd (no duplicar aquí)
      break;
    }

    case 'USE_HERO_ABILITY': {
      // Invocar la pericia del heroe (useHeroAbility ya emite HERO_ABILITY_USED)
      const targetId = command.targetId;
      // El targetId, si viene, debe referenciar un jugador o enemigo existente
      if (
        targetId !== undefined
        && !state.players[targetId]
        && !state.battlefield.some(e => e.instanceId === targetId)
      ) {
        return { accepted: false, reason: 'Invalid targetId', events: [], newState: state, rng };
      }
      const abilityResult = catalog
        ? useHeroAbility(state, playerId, rng, catalog, targetId)
        : { events: [] as GameEvent[], state, pendingChoice: null };
      events.push(...abilityResult.events);
      // Usar el estado devuelto (puede incluir pendingChoices para Idril/Aranel/Neddia)
      state = abilityResult.state;
      break;
    }

    case 'PASS':
      // No genera eventos
      break;

    case 'SWAP_STARTING_CARDS': {
      const swapResult = swapStartingCards(state, playerId, command.cardInstanceIds, rng);
      if (swapResult.error) {
        return { accepted: false, reason: swapResult.error, events: [], newState: state, rng };
      }
      events.push(...swapResult.events);
      state = swapResult.state;
      break;
    }

    case 'CHOOSE_LEADER_CARDS': {
      // Guardar las cartas pujadas por el jugador en leaderBidCards
      state = {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...state.players[playerId],
            leaderBidCards: command.cardInstanceIds,
          },
        },
        // Remover la pendingChoice de este jugador
        pendingChoices: state.pendingChoices.filter(
          c => c.choiceId !== `leader-bid-${playerId}`
        ),
      };
      // Verificar si todos los jugadores han pujado
      const allBid = state.playerOrder.every(pid =>
        state.players[pid]?.leaderBidCards && state.players[pid].leaderBidCards.length > 0
      );
      if (allBid && catalog) {
        // Resolver la puja inline (evita import circular con setup.ts)
        let leaderId = state.playerOrder[0];
        let maxDamage = -1;
        for (const pid of state.playerOrder) {
          const p = state.players[pid];
          if (!p) continue;
          const bidCardIds = p.leaderBidCards;
          if (!bidCardIds || bidCardIds.length === 0) continue;
          const bidCards = p.hand.filter(c => bidCardIds.includes(c.instanceId));
          let bidDamage = 0;
          for (const card of bidCards) {
            const cardDef = catalog.byId.get(card.definitionId);
            bidDamage += cardDef?.printedAttack ?? 0;
          }
          if (bidDamage > maxDamage) {
            maxDamage = bidDamage;
            leaderId = pid;
          } else if (bidDamage === maxDamage) {
            // Empate: gana el jugador con mayor edad (spec §3.2.6)
            const currentLeader = state.players[leaderId];
            const challenger = state.players[pid];
            const currentAge = currentLeader?.playerAge ?? 0;
            const challengerAge = challenger?.playerAge ?? 0;
            if (challengerAge > currentAge) {
              leaderId = pid;
            }
          }
          // Retirar cartas pujadas de mano y ponerlas al fondo del mazo
          // (con eventos CARD_MOVED para que el replay reconstruya el estado)
          const bidIds = new Set(bidCards.map(c => c.instanceId));
          for (const card of bidCards) {
            events.push({
              type: 'CARD_MOVED',
              cardInstanceId: card.instanceId,
              from: 'HAND',
              to: 'ABILITY_DECK',
              seq: reg.nextSeq(),
            });
          }
          state = {
            ...state,
            players: {
              ...state.players,
              [pid]: {
                ...state.players[pid],
                hand: state.players[pid].hand.filter(c => !bidIds.has(c.instanceId)),
                abilityDeck: [...state.players[pid].abilityDeck, ...bidCards.map(c => ({ ...c, zone: 'ABILITY_DECK' as any }))],
              },
            },
          };
        }
        // Robar hasta 4 cartas (con CARDS_DRAWN para el replay)
        // D429: leer state.players[pid] dentro del bucle (referencia fresca)
        for (const pid of state.playerOrder) {
          const drawnIds: string[] = [];
          while (state.players[pid]
                 && state.players[pid].hand.length < 4
                 && state.players[pid].abilityDeck.length > 0) {
            const drawn = state.players[pid].abilityDeck[0];
            drawnIds.push(drawn.instanceId);
            state = {
              ...state,
              players: {
                ...state.players,
                [pid]: {
                  ...state.players[pid],
                  abilityDeck: state.players[pid].abilityDeck.slice(1),
                  hand: [...state.players[pid].hand, { ...drawn, zone: 'HAND' as any }],
                },
              },
            };
          }
          if (drawnIds.length > 0) {
            events.push({
              type: 'CARDS_DRAWN',
              playerId: pid,
              count: drawnIds.length,
              cardInstanceIds: drawnIds,
              seq: reg.nextSeq(),
            });
          }
        }
        state = { ...state, activePlayerId: leaderId };
        state = {
          ...state,
          pendingChoices: state.pendingChoices.filter(c => !c.choiceId.startsWith('leader-bid-')),
        };
        events.push({
          type: 'LEADER_DETERMINED',
          playerId: leaderId,
          seq: reg.nextSeq(),
        });
        // D427: la puja completa arranca el turno 1 directamente —
        // equivalente a startFirstTurn() (TURN_STARTED + PHASE_CHANGED).
        state = { ...state, turnNumber: 1 };
        events.push({
          type: 'TURN_STARTED',
          playerId: leaderId,
          turnNumber: 1,
          seq: reg.nextSeq(),
        });
        events.push({
          type: 'PHASE_CHANGED',
          phase: 'ATTACK_CHOICE',
          seq: reg.nextSeq(),
        });
      }
      break;
    }

    case 'ACCEPT_TURN_START_EFFECT': {
      if (state.scenario) {
        const tsResult = executeTurnStartEffect(state, state.scenario.definitionId, playerId, command.accepted, catalog, rng);
        events.push(...tsResult.events);
        state = tsResult.state;
        // D381: Si el efecto genera una eleccion pendiente (ej: Portal de Ulthar), guardarla
        if (tsResult.pendingChoice) {
          state = {
            ...state,
            pendingChoices: [...state.pendingChoices, tsResult.pendingChoice],
          };
        }
        // Consumir la pendingChoice de inicio de turno
        const choiceId = `turn-start-${state.turnNumber}`;
        state = {
          ...state,
          pendingChoices: state.pendingChoices.filter(pc => pc.choiceId !== choiceId),
        };
      }
      break;
    }

    case 'OPEN_SUPPORT_DECK': {
      const result = openSupportDeck(state, playerId, command.supportDeckIndex);
      if (result.error) {
        return { accepted: false, reason: result.error, events: [], newState: state, rng };
      }
      events.push(...result.events);
      state = result.state;
      break;
    }

    case 'BUY_SUPPORT_CARD': {
      const result = buySupportCard(state, playerId, command.supportDeckIndex, command.payment);
      if (result.error) {
        return { accepted: false, reason: result.error, events: [], newState: state, rng };
      }
      events.push(...result.events);
      state = result.state;
      break;
    }

    case 'RESOLVE_CHOICE': {
      // Resolver una eleccion pendiente (empate en HERO_WITH_FEWEST_WOUNDS, etc.)
      const choice = state.pendingChoices.find(c => c.choiceId === command.choiceId);
      if (!choice) {
        return { accepted: false, reason: 'Choice not found', events, newState: state, rng };
      }
      if (choice.playerId !== playerId) {
        return { accepted: false, reason: 'Not your choice', events, newState: state, rng };
      }
      // D434: Yermo de Cemenmar — robo opt-in con distribución elegida por el
      // jugador (opciones "playerId#coinN", máx. 2 por héroe, máx. 3 total)
      if (choice.type === 'SELECT_COINS_TO_STEAL' && choice.choiceId.startsWith('cemenmar-steal-')) {
        const counts = new Map<string, number>();
        for (const sel of command.selectedIds) {
          const fromId = sel.split('#coin')[0];
          counts.set(fromId, (counts.get(fromId) ?? 0) + 1);
        }
        const stealEvents: GameEvent[] = [];
        for (const [fromId, amount] of counts) {
          const clamped = Math.min(amount, 2, state.players[fromId]?.coins ?? 0);
          if (clamped > 0) {
            stealEvents.push({
              type: 'COINS_STOLEN', fromPlayerId: fromId, toPlayerId: playerId,
              amount: clamped, seq: reg.nextSeq(),
            });
          }
        }
        events.push(...stealEvents);
        let resolvedState = state;
        for (const ev of stealEvents) {
          resolvedState = applyEvent(resolvedState, ev);
        }
        state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // D434: Feldon — Pericia opt-in ante el ataque de la Horda (spec §6.8,
      // 1 uso). Registrar la decision; processHordeAttack la aplica.
      if (choice.type === 'CONFIRM' && choice.choiceId.startsWith('feldon-reduce-')) {
        const wants = command.selectedIds[0] === 'yes';
        const feldonEvents: GameEvent[] = [];
        let resolvedState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...state.players[playerId],
              feldonDecision: (wants ? 'HALVE' : 'DECLINE') as 'HALVE' | 'DECLINE',
            },
          },
        };
        if (wants) {
          feldonEvents.push({
            type: 'HERO_ABILITY_USED',
            playerId,
            usesRemaining: Math.max(0, (state.players[playerId]?.heroUsesRemaining ?? 1) - 1),
            seq: reg.nextSeq(),
          });
        }
        events.push(...feldonEvents);
        for (const ev of feldonEvents) {
          resolvedState = applyEvent(resolvedState, ev);
        }
        state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // D434: Beleth-Il — Pericia opt-in en fallo de Disparo Rápido (spec §6.8)
      if (choice.type === 'CONFIRM' && choice.choiceId.startsWith('beleth-recover-')) {
        const wants = command.selectedIds[0] === 'yes';
        const failedCardId = choice.relatedCardIds?.[0];
        const belethEvents: GameEvent[] = [];
        if (wants && failedCardId) {
          belethEvents.push({
            type: 'HERO_ABILITY_USED',
            playerId,
            usesRemaining: Math.max(0, (state.players[playerId]?.heroUsesRemaining ?? 1) - 1),
            seq: reg.nextSeq(),
          });
          // Recuperar la carta fallida a la mano
          belethEvents.push({
            type: 'CARD_MOVED',
            cardInstanceId: failedCardId,
            from: 'ABILITY_DECK',
            to: 'HAND',
            seq: reg.nextSeq(),
          });
          // Robar otra carta (D434: Herida + reciclaje si el mazo se agota)
          belethEvents.push(...drawCardsWithReshuffle(playerId, 1, state, rng, () => reg.nextSeq()).events);
        }
        events.push(...belethEvents);
        let resolvedState = state;
        for (const ev of belethEvents) {
          resolvedState = applyEvent(resolvedState, ev);
        }
        state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // D434: Taheral — Pericia opt-in en Evasión (spec §6.8, 1 uso)
      if (choice.type === 'CONFIRM' && choice.choiceId.startsWith('taheral-evasion-')) {
        const wants = command.selectedIds[0] === 'yes';
        state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        if (wants) {
          const discarded = state.evasionDiscardedCount ?? 0;
          const p = state.players[playerId];
          const taheralEvents: GameEvent[] = [
            { type: 'COINS_GAINED', playerId, amount: discarded * 2, seq: reg.nextSeq() },
            { type: 'HERO_ABILITY_USED', playerId, usesRemaining: Math.max(0, (p?.heroUsesRemaining ?? 1) - 1), seq: reg.nextSeq() },
          ];
          events.push(...taheralEvents);
          let resolvedState = state;
          for (const ev of taheralEvents) {
            resolvedState = applyEvent(resolvedState, ev);
          }
          state = resolvedState;
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // SEARCH_DECK: buscar en mazo de habilidad y poner en mano (Aranel)
      if (choice.type === 'SEARCH_DECK') {
        const selectedCardId = command.selectedIds[0];
        const player = state.players[playerId];
        const foundCard = player.abilityDeck.find(c => c.instanceId === selectedCardId);
        if (foundCard) {
          // D368: Si hay multiples cartas en mano, pedir al jugador que elija cual devolver
          if (player.hand.length > 1) {
            const handChoiceId = `aranel-hand-${reg.nextSeq()}`;
            state = {
              ...state,
              pendingChoices: [
                ...state.pendingChoices.filter(c => c.choiceId !== command.choiceId),
                {
                  choiceId: handChoiceId,
                  playerId,
                  type: 'SELECT_CARD_FROM_HAND' as const,
                  prompt: 'Elige una carta de tu mano para devolver al mazo',
                  options: player.hand.map(c => c.instanceId),
                  minSelections: 1,
                  maxSelections: 1,
                  relatedCardIds: [foundCard.instanceId],
                },
              ],
            };
            return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
          }
          // Si solo hay 0 o 1 cartas en mano, usar la primera (sin eleccion)
          const handCard = player.hand[0];
          const newEvents: GameEvent[] = [];
          if (handCard) {
            newEvents.push({
              type: 'CARD_MOVED',
              cardInstanceId: handCard.instanceId,
              from: 'HAND',
              to: 'ABILITY_DECK',
              seq: reg.nextSeq(),
            });
          }
          newEvents.push({
            type: 'CARD_MOVED',
            cardInstanceId: foundCard.instanceId,
            from: 'ABILITY_DECK',
            to: 'HAND',
            seq: reg.nextSeq(),
          });
          events.push(...newEvents);
          let resolvedState = state;
          for (const ev of newEvents) {
            resolvedState = applyEvent(resolvedState, ev);
          }
          // Barajar realmente el mazo y emitir DECK_SHUFFLED con el orden resultante
          const shuffledDeck = rng.shuffle(resolvedState.players[playerId].abilityDeck);
          const shuffleEvent: GameEvent = {
            type: 'DECK_SHUFFLED',
            playerId,
            deck: 'ABILITY',
            newOrder: shuffledDeck.map(c => c.instanceId),
            seq: reg.nextSeq(),
          };
          events.push(shuffleEvent);
          resolvedState = applyEvent(resolvedState, shuffleEvent);
          resolvedState = {
            ...resolvedState,
            pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId),
          };
          state = resolvedState;
        } else {
          state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // SEARCH_MARKET_DECK: buscar en mazo de Mercado e intercambiar con mercado visible (Neddia)
      if (choice.type === 'SEARCH_MARKET_DECK') {
        const selectedIds = command.selectedIds;
        // D369: Pedir al jugador que elija qué cartas visibles del mercado reemplazar
        if (selectedIds.length > 0 && state.market.length > 0) {
          const marketChoiceId = `neddia-market-${reg.nextSeq()}`;
          state = {
            ...state,
            pendingChoices: [
              ...state.pendingChoices.filter(c => c.choiceId !== command.choiceId),
              {
                choiceId: marketChoiceId,
                playerId,
                type: 'SELECT_FROM_MARKET' as const,
                prompt: `Elige ${selectedIds.length} carta(s) visible(s) del mercado para reemplazar`,
                options: state.market.map(c => c.instanceId),
                minSelections: selectedIds.length,
                maxSelections: selectedIds.length,
                relatedCardIds: selectedIds,
              },
            ],
          };
          return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
        }
        state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // D434: Lágrimas de Aradiel — el jugador elige el héroe; la carta es
      // aleatoria (spec §6.9). Pago de 1 Gloria al dueño + resolver la carta.
      if (choice.type === 'SELECT_HERO' && choice.choiceId.startsWith('tears-hero-')) {
        const targetId = command.selectedIds[0];
        const targetPlayer = state.players[targetId];
        const active = state.players[playerId];
        if (targetId && targetPlayer && active && active.glory >= 1 && targetPlayer.hand.length > 0 && catalog) {
          const tearsEvents: GameEvent[] = [
            { type: 'GLORY_LOST', playerId, amount: 1, seq: reg.nextSeq() },
            { type: 'GLORY_GAINED', playerId: targetId, amount: 1, seq: reg.nextSeq() },
          ];
          // Carta aleatoria de la mano del héroe elegido
          const randomIdx = rng.nextInt(0, targetPlayer.hand.length - 1);
          const borrowedCard = targetPlayer.hand[randomIdx];
          const borrowedDef = catalog.byId.get(borrowedCard.definitionId);
          let resolvedState = state;
          for (const ev of tearsEvents) {
            resolvedState = applyEvent(resolvedState, ev);
          }
          events.push(...tearsEvents);
          if (borrowedDef) {
            const resolveResult = resolveCard(
              resolvedState, borrowedCard, borrowedDef, null,
              resolvedState.players[playerId], rng, reg, catalog,
            );
            events.push(...resolveResult.events);
            for (const ev of resolveResult.events) {
              resolvedState = applyEvent(resolvedState, ev);
            }
          }
          // El dueño roba 1 carta (D434: con Herida + reciclaje si el mazo
          // se agota, igual que el resto de robos del motor)
          const tearsDraw = drawCardsWithReshuffle(targetId, 1, resolvedState, rng, reg.nextSeq);
          events.push(...tearsDraw.events);
          for (const ev of tearsDraw.events) {
            resolvedState = applyEvent(resolvedState, ev);
          }
          state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        } else {
          state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // SELECT_HERO sin resolutionContext: re-invocar la pericia con el target (Valèrys)
      if (choice.type === 'SELECT_HERO' && !choice.resolutionContext) {
        const targetHeroId = command.selectedIds[0];
        if (targetHeroId && catalog) {
          const abilityResult = useHeroAbility(state, playerId, rng, catalog, targetHeroId);
          events.push(...abilityResult.events);
          // Aplicar los eventos al estado para que glory/prevention/shields/coins se reflejen
          let resolvedState = abilityResult.state;
          for (const ev of abilityResult.events) {
            resolvedState = applyEvent(resolvedState, ev);
          }
          state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        } else {
          state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // SELECT_ENEMY sin resolutionContext con choiceId "trap-": Trampa (empate de Fortaleza)
      if (choice.type === 'SELECT_ENEMY' && !choice.resolutionContext && choice.choiceId.startsWith('trap-')) {
        const chosenEnemyId = command.selectedIds[0];
        // Validar que el enemigo elegido esté entre las opciones del empate
        if (!choice.options.includes(chosenEnemyId)) {
          return { accepted: false, reason: 'Selected enemy is not among the tied options', events, newState: state, rng };
        }
        if (catalog) {
          // Re-invocar processHordeAttackTriggers con el enemigo elegido
          const reg = new EffectRegistry();
          registerCoreEffects(reg);
          const triggerResult = processHordeAttackTriggers(state, rng, reg, catalog, chosenEnemyId);
          events.push(...triggerResult.events);
          let resolvedState = triggerResult.state;
          for (const ev of triggerResult.events) {
            resolvedState = applyEvent(resolvedState, ev);
          }
          state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        } else {
          state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // Restablecimiento: el jugador elige qué cartas descarta (mano > 4)
      if (choice.choiceId.startsWith('restoration-discard-')) {
        const newEvents: GameEvent[] = command.selectedIds.map(id => ({
          type: 'CARD_MOVED' as const,
          cardInstanceId: id,
          from: 'HAND' as const,
          to: 'WEAR_PILE' as const,
          seq: reg.nextSeq(),
        }));
        events.push(...newEvents);
        let resolvedState = state;
        for (const ev of newEvents) {
          resolvedState = applyEvent(resolvedState, ev);
        }
        state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // SELECT_ORDER: reordenar cartas (Idril: 3 inferiores de la Horda)
      if (choice.type === 'SELECT_ORDER') {
        const newOrder = command.selectedIds;
        // Reordenar las 3 cartas inferiores del mazo de la Horda
        const bottomCount = choice.options.length;
        const top = state.hordeDeck.slice(0, state.hordeDeck.length - bottomCount);
        const reorderedCards = newOrder
          .map(id => state.hordeDeck.find(c => c.instanceId === id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
        if (reorderedCards.length !== bottomCount) {
          return { accepted: false, reason: 'Invalid card order selection', events, newState: state, rng };
        }
        state = {
          ...state,
          hordeDeck: [...top, ...reorderedCards],
          pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId),
        };
        // Evento explícito para que el replay reconstruya el orden del mazo
        events.push({
          type: 'HORDE_DECK_REORDERED',
          newOrder: [...top, ...reorderedCards].map(c => c.instanceId),
          seq: reg.nextSeq(),
        });
        break;
      }

      // D368: SELECT_CARD_FROM_HAND con relatedCardIds (Aranel: elegir carta de mano para devolver al mazo)
      if (choice.type === 'SELECT_CARD_FROM_HAND' && choice.relatedCardIds && choice.relatedCardIds.length > 0
          && choice.choiceId.startsWith('aranel-')) {
        const handCardId = command.selectedIds[0];
        const deckCardId = choice.relatedCardIds[0];
        const player = state.players[playerId];
        const handCard = player.hand.find(c => c.instanceId === handCardId);
        const deckCard = player.abilityDeck.find(c => c.instanceId === deckCardId);
        if (handCard && deckCard) {
          const newEvents: GameEvent[] = [
            { type: 'CARD_MOVED', cardInstanceId: handCard.instanceId, from: 'HAND', to: 'ABILITY_DECK', seq: reg.nextSeq() },
            { type: 'CARD_MOVED', cardInstanceId: deckCard.instanceId, from: 'ABILITY_DECK', to: 'HAND', seq: reg.nextSeq() },
          ];
          events.push(...newEvents);
          let resolvedState = state;
          for (const ev of newEvents) {
            resolvedState = applyEvent(resolvedState, ev);
          }
          // Barajar el mazo
          const shuffledDeck = rng.shuffle(resolvedState.players[playerId].abilityDeck);
          const shuffleEvent: GameEvent = {
            type: 'DECK_SHUFFLED', playerId, deck: 'ABILITY',
            newOrder: shuffledDeck.map(c => c.instanceId), seq: reg.nextSeq(),
          };
          events.push(shuffleEvent);
          resolvedState = applyEvent(resolvedState, shuffleEvent);
          state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        } else {
          state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // D369: SELECT_FROM_MARKET con relatedCardIds (Neddia: elegir cartas visibles del mercado a reemplazar)
      if (choice.type === 'SELECT_FROM_MARKET' && choice.relatedCardIds && choice.relatedCardIds.length > 0
          && choice.choiceId.startsWith('neddia-')) {
        const visibleCardIds = command.selectedIds;
        const deckCardIds = choice.relatedCardIds;
        const newEvents: GameEvent[] = [];
        const effectiveCount = Math.min(visibleCardIds.length, deckCardIds.length);
        for (let i = 0; i < effectiveCount; i++) {
          const visibleCard = state.market.find(c => c.instanceId === visibleCardIds[i]);
          const deckCard = state.marketDeck.find(c => c.instanceId === deckCardIds[i]);
          if (visibleCard && deckCard) {
            newEvents.push({ type: 'CARD_MOVED', cardInstanceId: visibleCard.instanceId, from: 'MARKET', to: 'MARKET_DECK', seq: reg.nextSeq() });
            newEvents.push({ type: 'CARD_MOVED', cardInstanceId: deckCard.instanceId, from: 'MARKET_DECK', to: 'MARKET', seq: reg.nextSeq() });
          }
        }
        events.push(...newEvents);
        let resolvedState = state;
        for (const ev of newEvents) {
          resolvedState = applyEvent(resolvedState, ev);
        }
        // Barajar el mazo de Mercado
        const shuffledMarket = rng.shuffle(resolvedState.marketDeck);
        const shuffleEvent: GameEvent = {
          type: 'DECK_SHUFFLED', playerId, deck: 'MARKET',
          newOrder: shuffledMarket.map(c => c.instanceId), seq: reg.nextSeq(),
        };
        events.push(shuffleEvent);
        resolvedState = applyEvent(resolvedState, shuffleEvent);
        state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // D381: CONFIRM con choiceId "ulthar-pay-": Portal de Ulthar (elegir Gloria o Monedas)
      if (choice.type === 'CONFIRM' && choice.choiceId.startsWith('ulthar-pay-')) {
        const payment = command.selectedIds[0];
        const player = state.players[playerId];
        // D434: revalidar que siga habiendo objetivo válido antes de cobrar
        // (si el campo/trofeos cambiaron entre la oferta y la resolución,
        // no debe cobrarse por una acción sin efecto)
        const hasValidTarget = player.trophies.length > 0
          && state.battlefield.some(e => !e.isWarlord);
        if (!hasValidTarget) {
          state = {
            ...state,
            pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId),
          };
          return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
        }
        const newEvents: GameEvent[] = [];
        if (payment === 'glory' && player.glory >= 1) {
          newEvents.push({ type: 'GLORY_LOST', playerId, amount: 1, seq: reg.nextSeq() });
        } else if (payment === 'coins' && player.coins >= 2) {
          newEvents.push({ type: 'COINS_GAINED', playerId, amount: -2, seq: reg.nextSeq() });
        } else {
          return { accepted: false, reason: 'Cannot afford selected payment', events, newState: state, rng };
        }
        events.push(...newEvents);
        let resolvedState = state;
        for (const ev of newEvents) {
          resolvedState = applyEvent(resolvedState, ev);
        }
        // Tras el pago, crear eleccion para elegir Hueste a devolver
        const nonWarlordEnemies = resolvedState.battlefield.filter(e => !e.isWarlord);
        if (nonWarlordEnemies.length > 0 && player.trophies.length > 0) {
          const enemyChoice: PendingChoice = {
            choiceId: `ulthar-enemy-${reg.nextSeq()}`,
            playerId,
            type: 'SELECT_ENEMY',
            prompt: 'Portal de Ulthar: Elige una Hueste para devolverla al mazo',
            options: nonWarlordEnemies.map(e => e.instanceId),
            minSelections: 1,
            maxSelections: 1,
          };
          state = {
            ...resolvedState,
            pendingChoices: [
              ...resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId),
              enemyChoice,
            ],
          };
        } else {
          state = {
            ...resolvedState,
            pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId),
          };
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // Lodazal de Kalern: SELECT_ENEMY con choiceId "kalern-mud-enemy-"
      if (choice.type === 'SELECT_ENEMY' && choice.choiceId.startsWith('kalern-mud-enemy-')) {
        const enemyId = command.selectedIds[0];
        const newEvent: GameEvent = {
          type: 'ENEMY_RETURNED_TO_HORDE',
          enemyInstanceId: enemyId,
          position: 'BOTTOM',
          seq: reg.nextSeq(),
        };
        events.push(newEvent);
        let resolvedState = applyEvent(state, newEvent);
        resolvedState = {
          ...resolvedState,
          pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId),
        };
        state = resolvedState;
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // Puerto de Eque: SELECT_CARD_FROM_HAND con choiceId "eque-port-card-"
      if (choice.type === 'SELECT_CARD_FROM_HAND' && choice.choiceId.startsWith('eque-port-card-')) {
        const cardId = command.selectedIds[0];
        const player = state.players[playerId];
        const newEvents: GameEvent[] = [];
        // Descartar la carta elegida
        newEvents.push({
          type: 'CARD_MOVED', cardInstanceId: cardId,
          from: 'HAND', to: 'WEAR_PILE', seq: reg.nextSeq(),
        });
        // Robar 1 carta
        if (player.abilityDeck.length > 0) {
          newEvents.push({
            type: 'CARDS_DRAWN', playerId, count: 1,
            cardInstanceIds: [player.abilityDeck[0].instanceId], seq: reg.nextSeq(),
          });
        }
        // +1 daño a cada enemigo del campo
        for (const enemy of state.battlefield) {
          newEvents.push({
            type: 'MODIFIER_ADDED',
            modifierId: `eque-dmg-${reg.nextSeq()}`,
            targetId: enemy.instanceId,
            layer: 'ENEMY_OUTGOING_DAMAGE',
            amount: 1,
            duration: 'UNTIL_END_OF_TURN',
            seq: reg.nextSeq(),
          });
        }
        events.push(...newEvents);
        let resolvedState = state;
        for (const ev of newEvents) {
          resolvedState = applyEvent(resolvedState, ev);
        }
        state = {
          ...resolvedState,
          pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId),
        };
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // Portal de Ulthar: SELECT_ENEMY con choiceId "ulthar-enemy-" (tras pago)
      if (choice.type === 'SELECT_ENEMY' && choice.choiceId.startsWith('ulthar-enemy-')) {
        const enemyId = command.selectedIds[0];
        const player = state.players[playerId];
        const newEvents: GameEvent[] = [];
        // Devolver Hueste al fondo del mazo (ENEMY_RETURNED_TO_HORDE mueve
        // battlefield → hordeDeck; CARD_MOVED no soporta esas zonas)
        newEvents.push({
          type: 'ENEMY_RETURNED_TO_HORDE',
          enemyInstanceId: enemyId,
          position: 'BOTTOM',
          seq: reg.nextSeq(),
        });
        events.push(...newEvents);
        let resolvedState = state;
        for (const ev of newEvents) {
          resolvedState = applyEvent(resolvedState, ev);
        }
        // Crear eleccion para trofeo a colocar
        if (player.trophies.length > 0) {
          const trophyChoice: PendingChoice = {
            choiceId: `ulthar-trophy-${reg.nextSeq()}`,
            playerId,
            type: 'CONFIRM',
            prompt: 'Portal de Ulthar: Elige un trofeo para colocarlo en el campo',
            options: player.trophies,
            minSelections: 1,
            maxSelections: 1,
          };
          state = {
            ...resolvedState,
            pendingChoices: [
              ...resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId),
              trophyChoice,
            ],
          };
        } else {
          state = {
            ...resolvedState,
            pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId),
          };
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // Portal de Ulthar: CONFIRM con choiceId "ulthar-trophy-" (elegir trofeo)
      if (choice.type === 'CONFIRM' && choice.choiceId.startsWith('ulthar-trophy-')) {
        const trophyInstanceId = command.selectedIds[0];
        // D397: trophies guarda instanceId. El definitionId se recupera del
        // eventLog (ENEMY_DEFEATED lleva enemyDefinitionId) porque la carta
        // derrotada ya no esta en hordeDeck.
        const defeatEvent = state.eventLog.find(
          e => e.type === 'ENEMY_DEFEATED' && e.enemyInstanceId === trophyInstanceId
        );
        const trophyDefId = defeatEvent && defeatEvent.type === 'ENEMY_DEFEATED'
          ? defeatEvent.enemyDefinitionId
          : undefined;
        const trophyDef = trophyDefId ? catalog?.byId.get(trophyDefId) : undefined;
        const newEvents: GameEvent[] = [];
        let resolvedState = state;
        if (trophyDef && trophyDefId) {
          // D398: Colocar el trofeo como enemigo en el campo. ENEMY_REVEALED es
          // un no-op en applyEvent, asi que insertamos el EnemyState directamente.
          const newEnemy: EnemyState = applyEntryAuras({
            instanceId: `trophy-${trophyInstanceId}-${reg.nextSeq()}`,
            definitionId: trophyDefId,
            baseFortitude: trophyDef.printedFortitude ?? 1,
            wounds: 0,
            reward: trophyDef.reward ?? null,
            modifiers: [],
            isWarlord: false,
            isOrc: trophyDef.isOrc ?? false,
            specialIcons: trophyDef.specialIcons ?? [],
            damageDisabled: false,
          }, resolvedState);
          resolvedState = {
            ...resolvedState,
            battlefield: [...resolvedState.battlefield, newEnemy],
          };
          newEvents.push({
            type: 'ENEMY_REVEALED',
            enemyInstanceId: newEnemy.instanceId,
            definitionId: trophyDefId,
            fortitude: newEnemy.baseFortitude,
            seq: reg.nextSeq(),
          });
          // D434 (spec §6.9 nota Brunmar): el trofeo colocado puede quedar
          // derrotado si el aura reduce su Fortaleza efectiva a 0
          for (const ev of checkFortitudeDefeats(resolvedState, playerId, reg.nextSeq)) {
            newEvents.push(ev);
            resolvedState = applyEvent(resolvedState, ev);
          }
        }
        events.push(...newEvents);
        for (const ev of newEvents) {
          resolvedState = applyEvent(resolvedState, ev);
        }
        // Remover trofeo del jugador
        resolvedState = {
          ...resolvedState,
          players: {
            ...resolvedState.players,
            [playerId]: {
              ...resolvedState.players[playerId],
              trophies: resolvedState.players[playerId].trophies.filter(t => t !== trophyInstanceId),
            },
          },
          pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId),
        };
        state = resolvedState;
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // D371: REACTION_WINDOW — el jugador elige usar pericia o pasar
      if (choice.type === 'REACTION_WINDOW') {
        const selection = command.selectedIds[0];
        // Remover la elección pendiente
        state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        if (selection === 'PASS') {
          // No hacer nada, solo resolver la elección
          return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
        }
        if (selection === 'USE_ABILITY') {
          // El jugador quiere usar su pericia; crear una elección SELECT_HERO
          // para que elija el objetivo (Valèrys/Lisavette).
          // D434: el único objetivo legal es el héroe enfrentado a la Horda
          // (el jugador activo), no cualquier otro héroe.
          state = {
            ...state,
            pendingChoices: [...state.pendingChoices, {
              choiceId: `reaction-hero-${playerId}-${reg.nextSeq()}`,
              playerId,
              type: 'SELECT_HERO' as const,
              prompt: 'Selecciona el heroe objetivo de tu pericia',
              options: [state.activePlayerId],
              minSelections: 1,
              maxSelections: 1,
            }],
          };
          return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // D371: SELECT_HERO originado de ventana de reacción → invocar useHeroAbility
      if (choice.type === 'SELECT_HERO' && !choice.resolutionContext && choice.choiceId.startsWith('reaction-hero-')) {
        const targetHeroId = command.selectedIds[0];
        if (targetHeroId && catalog) {
          const abilityResult = useHeroAbility(state, playerId, rng, catalog, targetHeroId);
          events.push(...abilityResult.events);
          let resolvedState = abilityResult.state;
          for (const ev of abilityResult.events) {
            resolvedState = applyEvent(resolvedState, ev);
          }
          state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        } else {
          state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // D370: SELECT_ENEMY originado de Lisavette → invocar useHeroAbility con ambos targets
      if (choice.type === 'SELECT_ENEMY' && choice.choiceId.startsWith('lisavette-enemy-') && choice.resolutionContext?.chosenHeroTarget) {
        const targetHeroId = choice.resolutionContext.chosenHeroTarget;
        const targetEnemyId = command.selectedIds[0];
        if (targetEnemyId && catalog) {
          const abilityResult = useHeroAbility(state, playerId, rng, catalog, targetHeroId, targetEnemyId);
          events.push(...abilityResult.events);
          let resolvedState = abilityResult.state;
          for (const ev of abilityResult.events) {
            resolvedState = applyEvent(resolvedState, ev);
          }
          state = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        } else {
          state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        }
        return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
      }

      // Recuperar la carta original del contexto
      const card = state.players[playerId].hand.find(c => c.instanceId === choice.resolutionContext?.currentCardInstanceId)
        ?? state.players[playerId].wearPile.find(c => c.instanceId === choice.resolutionContext?.currentCardInstanceId);
      if (!card || !choice.resolutionContext) {
        // Limpiar la eleccion pendiente
        state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        break;
      }
      const cardDef = catalog?.byId.get(card.definitionId);
      if (!cardDef || !catalog) {
        state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
        break;
      }
      // Determinar los targets elegidos
      const chosenHero = choice.type === 'SELECT_HERO' ? command.selectedIds[0] : null;
      const chosenEnemy = choice.type === 'SELECT_ENEMY' ? command.selectedIds[0] : null;
      const chosenWear = choice.type === 'SELECT_CARD_FROM_WEAR' ? command.selectedIds[0] : null;
      // Re-resolver la carta con la eleccion
      const result = resolveCard(
        state, card, cardDef, choice.resolutionContext.selectedEnemyId,
        state.players[playerId], rng, reg, catalog,
        chosenHero, chosenEnemy, chosenWear,
      );
      // Aplicar eventos
      let resolvedState = state;
      for (const ev of result.events) {
        resolvedState = applyEvent(resolvedState, ev);
      }
      // Limpiar la eleccion pendiente
      resolvedState = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
      return { accepted: true, events: result.events, newState: { ...resolvedState, rngState: rng.serialize() }, rng };
    }

    default:
      // Comandos no manejados aquí
      return { accepted: false, reason: 'Command not supported', events, newState: state, rng };
  }

  // 4. Aplicar eventos al estado (reducer puro)
  let newState = state;
  for (const event of events) {
    newState = applyEvent(newState, event);
  }

  // Actualizar rngState en el estado (especificacion §51.5)
  newState = { ...newState, rngState: rng.serialize() };

  return {
    accepted: true,
    events,
    newState,
    rng,
  };
}

function getPlayerIdFromCommand(command: Command, state: GameState, actingPlayerId?: string): string {
  // El playerId viene implicito en el comando o es el activo.
  // En online, el transporte (engine-runner/backend) pasa actingPlayerId
  // autenticado — el comando se atribuye a ese jugador cuando existe una
  // pendingChoice suya que lo corresponde (puja, reaccion, eleccion).

  // RESOLVE_CHOICE: la eleccion pertenece a un jugador especifico (p.ej. REACTION_WINDOW
  // de Valerys/Lisavette, que NO son el jugador activo). Derivar el playerId del choice.
  if (command.type === 'RESOLVE_CHOICE') {
    const choice = state.pendingChoices.find(c => c.choiceId === command.choiceId);
    if (choice) return choice.playerId;
  }

  // CHOOSE_LEADER_CARDS: cada jugador tiene su propia pendingChoice 'leader-bid-<pid>'.
  // Atribuir el comando al jugador que aun no ha pujado.
  if (command.type === 'CHOOSE_LEADER_CARDS') {
    // D427: si el transporte autentica al jugador, usar su bid pendiente
    if (actingPlayerId && state.pendingChoices.some(c => c.choiceId === `leader-bid-${actingPlayerId}`)) {
      return actingPlayerId;
    }
    const pendingBid = state.pendingChoices.find(
      c => c.choiceId.startsWith('leader-bid-') &&
        !state.players[c.playerId]?.leaderBidCards?.length
    );
    if (pendingBid) return pendingBid.playerId;
  }

  // D427: con actingPlayerId autenticado, los comandos de turno se atribuyen
  // a ese jugador (isLegal ya valida "Not your turn" si no es el activo).
  if (actingPlayerId) return actingPlayerId;

  return state.activePlayerId;
}
