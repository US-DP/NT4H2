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

import type { GameState, GameEvent, Command, ResolutionContext } from '@nt4h/schema';
import { DeterministicRng } from '../rng/index.js';
import { applyEvent } from '../events/applyEvent.js';
import { useHeroAbility } from '../heroes/abilities.js';
import { EffectRegistry, registerCoreEffects, evalValue } from '../effects/registry.js';
import { resolveCard } from '../effects/resolver.js';
import { dispatchListeners } from '../effects/listeners.js';
import { nextSeq } from '../seq.js';
import { swapStartingCards, openSupportDeck, buySupportCard } from '../modes/solo.js';
import { executeTurnStartEffect } from '../scenarios/index.js';
import { executeResolveChoice } from './resolveChoice.js';
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
  // playerId puede venir de un actorId arbitrario (payload/replay) —
  // rechazar antes de indexar state.players[pid].hand etc.
  if (!state.players[playerId]) {
    return { ok: false, reason: 'Player not found' };
  }
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
      // No permitir cerrar la fase con una elección obligatoria sin
      // resolver (p.ej. descartes, objetivos pendientes de una carta).
      if (state.pendingChoices.some(c => c.playerId === playerId && c.minSelections > 0)) {
        return { ok: false, reason: 'Resolve pending choices first' };
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
      // Regla oficial: la Ficha de Evasión se descarta al usarla — una vez por partida
      if (player.evasionTokenUsed) {
        return { ok: false, reason: 'Evasion token already used this game' };
      }
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
        // Regla oficial: la carta muestra los iconos de las capacidades que
        // pueden usarla; el heroe necesita AL MENOS UNO (ej: Piedra de Amolar
        // muestra 3 iconos). Un penaltyCapability sustituye al requerido con -1
        // de daño (ej: Picaro con EXPERTISE usa armas RANGED con -1).
        if (cardDef.requiredCapabilities && cardDef.requiredCapabilities.length > 0) {
          const hasAny = cardDef.requiredCapabilities.some(icon =>
            player.capabilities.includes(icon)
          );
          if (!hasAny) {
            // Verificar si puede usarla con penalizacion
            const canUseWithPenalty = cardDef.penaltyCapabilities?.some(
              p => player.capabilities.includes(p.icon)
            ) ?? false;
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
      // Elecciones obligatorias sin resolver (minSelections > 0) bloquean
      // el fin de turno — sin esto se podían saltar descartes/selecciones.
      if (state.pendingChoices.some(c => c.playerId === playerId && c.minSelections > 0)) {
        return { ok: false, reason: 'Resolve pending choices first' };
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
      // Pericias no reactivas: únicamente en el propio turno — sin este
      // chequeo un jugador podía gastar su uso en el turno de otro.
      if (!isReactiveHero && playerId !== state.activePlayerId) {
        return { ok: false, reason: 'Not your turn' };
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
  const result = executeCommand(state, command, rng, registry, catalog, actingPlayerId);
  if (!result.accepted || !registry || !catalog) return result;
  // Oyentes del Taller (REGISTER_LISTENER): los eventos emitidos por el
  // resolver y por las fases ya pasaron por dispatchListeners (deduplicado
  // por seq); este pase cubre los emitidos directamente por comandos
  // (EVASION, RESOLVE_CHOICE, pujas, mercado…). Los eventos de oyente se
  // insertan tras su disparador para que el orden del log sea el de
  // ejecución (replay bit-idéntico).
  const emitted: GameEvent[] = [];
  let foldState = state;
  let s = result.newState;
  for (const ev of result.events) {
    emitted.push(ev);
    foldState = applyEvent(foldState, ev);
    const dl = dispatchListeners(foldState, ev, { registry, rng, nextSeq });
    if (dl.events.length > 0) {
      for (const dev of dl.events) {
        emitted.push(dev);
        s = applyEvent(s, dev);
      }
    }
  }
  if (emitted.length === result.events.length) return result;
  return { ...result, events: emitted, newState: s };
}

function executeCommand(
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
    && actingPlayer.wounds >= (actingPlayer.maxWounds ?? 3)
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
              // El RNG puede haberse consumido en la resolución parcial;
              // persistirlo evita divergencia si hay snapshot entre medias.
              rngState: rng.serialize(),
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
          playerId,
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
        const damageByPlayer = new Map<string, number>();
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
          damageByPlayer.set(pid, bidDamage);
          // Retirar cartas pujadas de mano y ponerlas al fondo del mazo
          // (con eventos CARD_MOVED para que el replay reconstruya el estado)
          const bidIds = new Set(bidCards.map(c => c.instanceId));
          for (const card of bidCards) {
            events.push({
              type: 'CARD_MOVED',
              cardInstanceId: card.instanceId,
              from: 'HAND',
              to: 'ABILITY_DECK',
              playerId: pid,
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
        // Desempate de Líder (misma lógica que setup.resolveLeaderBid):
        // edad si todos los empatados la declararon; si no, sorteo con RNG sembrado.
        const maxDamage = Math.max(0, ...damageByPlayer.values());
        const tied = state.playerOrder.filter(pid => damageByPlayer.get(pid) === maxDamage);
        let leaderId = tied[0] ?? state.playerOrder[0];
        if (tied.length > 1) {
          const ages = tied.map(pid => state.players[pid]?.playerAge);
          if (ages.every(a => typeof a === 'number')) {
            const maxAge = Math.max(...(ages as number[]));
            leaderId = tied.find(pid => state.players[pid].playerAge === maxAge) ?? tied[0];
            events.push({
              type: 'LEADER_TIE_BREAK',
              tiedPlayerIds: tied,
              winnerId: leaderId,
              method: 'AGE',
              seq: reg.nextSeq(),
            });
          } else {
            // Consumir el RNG en curso: el serialize final (al aplicar
            // eventos) ya refleja el pick — un RNG local se perdería.
            leaderId = rng.pick(tied);
            events.push({
              type: 'LEADER_TIE_BREAK',
              tiedPlayerIds: tied,
              winnerId: leaderId,
              method: 'RANDOM_SEEDED',
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
      const outcome = executeResolveChoice(state, command, playerId, rng, reg, catalog);
      if ('accepted' in outcome) return outcome;
      state = outcome.state;
      events.push(...outcome.events);
      break;
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
    // actorId (replay): usar el bid pendiente del actor declarado
    if (command.actorId && state.pendingChoices.some(c => c.choiceId === `leader-bid-${command.actorId}`)) {
      return command.actorId;
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

  // Replay/event-sourcing: el actor declarado restaura comandos de
  // jugadores no activos (pericia reactiva en la ventana de la Horda).
  // Sin actorId, una USE_HERO_ABILITY de Lisavette se atribuiría al
  // jugador activo y el replay divergiría del estado online.
  if (command.actorId) return command.actorId;

  return state.activePlayerId;
}
