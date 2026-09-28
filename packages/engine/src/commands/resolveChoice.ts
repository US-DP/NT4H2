/**
 * executeResolveChoice — resolucion del comando RESOLVE_CHOICE.
 *
 * Extraido de execute.ts: despacha las elecciones pendientes (targets,
 * robos opt-in, reordenaciones, pericias reactivas, ramas CHOOSE_EFFECT).
 *
 * Devuelve un CommandResult cuando el comando termina aqui, o
 * { state, events } cuando el flujo continua tras el switch.
 */

import type {
  GameState,
  GameEvent,
  Command,
  PendingChoice,
  EnemyState,
} from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import type { DeterministicRng } from '../rng/index.js';
import { applyEvent, checkFortitudeDefeats } from '../events/applyEvent.js';
import { useHeroAbility } from '../heroes/abilities.js';
import {
  EffectRegistry,
  registerCoreEffects,
  drawCardsWithReshuffle,
} from '../effects/registry.js';
import {
  resolveCard,
  processHordeAttackTriggers,
  executeEffectChain,
} from '../effects/resolver.js';
import { applyEntryAuras } from '../modifiers/index.js';
import type { CommandResult } from './execute.js';

type ResolveChoiceOutcome =
  | CommandResult
  | { state: GameState; events: GameEvent[] };

export function executeResolveChoice(
  state: GameState,
  command: Extract<Command, { type: 'RESOLVE_CHOICE' }>,
  playerId: string,
  rng: DeterministicRng,
  reg: EffectRegistry,
  catalog: CatalogLoadResult | undefined,
): ResolveChoiceOutcome {
  const events: GameEvent[] = [];
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
        playerId,
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
          playerId,
          seq: reg.nextSeq(),
        });
      }
      newEvents.push({
        type: 'CARD_MOVED',
        cardInstanceId: foundCard.instanceId,
        from: 'ABILITY_DECK',
        to: 'HAND',
        playerId,
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
      // D440: triggerResult.state YA tiene los eventos aplicados inline —
      // re-aplicarlos duplicaría recompensas. Se usa directamente.
      const resolvedState = triggerResult.state;
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
      playerId,
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
    return { state, events };
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
        { type: 'CARD_MOVED', cardInstanceId: handCard.instanceId, from: 'HAND', to: 'ABILITY_DECK', playerId, seq: reg.nextSeq() },
        { type: 'CARD_MOVED', cardInstanceId: deckCard.instanceId, from: 'ABILITY_DECK', to: 'HAND', playerId, seq: reg.nextSeq() },
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
      from: 'HAND', to: 'WEAR_PILE', playerId, seq: reg.nextSeq(),
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
      // D398: Colocar el trofeo como enemigo en el campo. El evento
      // transporta el EnemyState completo — el reducer lo reproduce en el
      // fold (idempotente: aquí ya está insertado).
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
        enemy: newEnemy,
        seq: reg.nextSeq(),
      });
      // D434 (spec §6.9 nota Brunmar): el trofeo colocado puede quedar
      // derrotado si el aura reduce su Fortaleza efectiva a 0.
      // Solo acumular — el bucle de newEvents los aplica una vez.
      for (const ev of checkFortitudeDefeats(resolvedState, playerId, reg.nextSeq)) {
        newEvents.push(ev);
      }
    }
    events.push(...newEvents);
    for (const ev of newEvents) {
      resolvedState = applyEvent(resolvedState, ev);
    }
    // Remover trofeo del jugador (event-sourced: el fold del eventLog
    // debe reproducir la retirada — sin el evento el trofeo sobrevive
    // en replay y puntúa en el desempate final)
    events.push({
      type: 'TROPHY_REMOVED',
      playerId,
      trophyInstanceId,
      seq: reg.nextSeq(),
    });
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
          fromReactionWindow: true,
        }],
      };
      return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
    }
    return { accepted: true, events, newState: { ...state, rngState: rng.serialize() }, rng };
  }

  // D371: SELECT_HERO originado de ventana de reacción → invocar useHeroAbility
  // (marca explícita; el prefijo se conserva solo como fallback de
  // estados serializados antiguos)
  if (choice.type === 'SELECT_HERO' && !choice.resolutionContext
    && (choice.fromReactionWindow ?? choice.choiceId.startsWith('reaction-hero-'))) {
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

  // Taller DISCARD_FROM_HAND: el jugador eligió qué cartas descartar;
  // se mueven al Desgaste y se continúan los efectos restantes.
  if (choice.type === 'SELECT_CARD_FROM_HAND'
    && choice.choiceId.startsWith('fx-discard-')
    && choice.resolutionContext && catalog) {
    const rctx = choice.resolutionContext;
    const hand = state.players[playerId]?.hand ?? [];
    const discardIds = command.selectedIds.filter(id => hand.some(c => c.instanceId === id));
    const discardEvents: GameEvent[] = discardIds.map(id => ({
      type: 'CARD_MOVED' as const,
      cardInstanceId: id,
      from: 'HAND' as const,
      to: 'WEAR_PILE' as const,
      playerId,
      seq: reg.nextSeq(),
    }));
    let resolvedState = state;
    for (const ev of discardEvents) resolvedState = applyEvent(resolvedState, ev);
    const { events: chainEvents } = executeEffectChain(
      rctx.pendingEffects ?? [], rctx, resolvedState, rng, reg, catalog, 0,
    );
    // Finalización: destino de la carta (igual que CHOOSE_EFFECT). El
    // contexto ya lleva destinationAfterUse — no exige la carta en catálogo.
    const dest = rctx.destinationAfterUse
      ?? catalog.byId.get(rctx.currentCardId)?.destinationAfterUse;
    const recovered = chainEvents.some(
      e => e.type === 'CARDS_RECOVERED' && e.cardInstanceIds.includes(rctx.currentCardInstanceId)
    );
    const tailEvents: GameEvent[] = [];
    if (dest && !recovered) {
      if (dest === 'WEAR_PILE') {
        tailEvents.push({
          type: 'CARD_MOVED', cardInstanceId: rctx.currentCardInstanceId,
          from: 'HAND', to: 'WEAR_PILE', playerId: rctx.activePlayerId, seq: reg.nextSeq(),
        });
      } else if (dest === 'REMOVED_FROM_GAME') {
        tailEvents.push({
          type: 'CARD_REMOVED_FROM_GAME', cardInstanceId: rctx.currentCardInstanceId,
          seq: reg.nextSeq(),
        });
      }
    }
    for (const ev of [...chainEvents, ...tailEvents]) {
      resolvedState = applyEvent(resolvedState, ev);
    }
    resolvedState = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
    events.push(...discardEvents, ...chainEvents, ...tailEvents);
    return { accepted: true, events, newState: { ...resolvedState, rngState: rng.serialize() }, rng };
  }

  // Taller CHOOSE_ONE: ejecutar la rama elegida y despues los efectos
  // restantes de la carta (guardados en resolutionContext).
  const choiceEffects = choice.resolutionContext?.choiceEffects;
  if (choice.type === 'CHOOSE_EFFECT' && choiceEffects && choice.resolutionContext && catalog) {
    const rctx = choice.resolutionContext;
    const idx = Math.max(0, choice.options.indexOf(command.selectedIds[0]));
    const branch = choiceEffects[idx] ?? [];
    const chain = [...branch, ...(rctx.pendingEffects ?? [])];
    const { events: chainEvents } = executeEffectChain(chain, rctx, state, rng, reg, catalog, 0);
    // Finalizacion: mover la carta a su destino (igual que resolveCard),
    // salvo que la propia rama la haya recuperado (CARDS_RECOVERED).
    const cardDef = catalog.byId.get(rctx.currentCardId);
    const recovered = chainEvents.some(
      e => e.type === 'CARDS_RECOVERED' && e.cardInstanceIds.includes(rctx.currentCardInstanceId)
    );
    const tailEvents: GameEvent[] = [];
    if (cardDef && !recovered) {
      if (cardDef.destinationAfterUse === 'WEAR_PILE') {
        tailEvents.push({
          type: 'CARD_MOVED', cardInstanceId: rctx.currentCardInstanceId,
          from: 'HAND', to: 'WEAR_PILE', playerId: rctx.activePlayerId, seq: reg.nextSeq(),
        });
      } else if (cardDef.destinationAfterUse === 'REMOVED_FROM_GAME') {
        tailEvents.push({
          type: 'CARD_REMOVED_FROM_GAME', cardInstanceId: rctx.currentCardInstanceId,
          seq: reg.nextSeq(),
        });
      }
    }
    let resolvedState = state;
    for (const ev of [...chainEvents, ...tailEvents]) {
      resolvedState = applyEvent(resolvedState, ev);
    }
    resolvedState = { ...resolvedState, pendingChoices: resolvedState.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
    events.push(...chainEvents, ...tailEvents);
    return { accepted: true, events, newState: { ...resolvedState, rngState: rng.serialize() }, rng };
  }

  // Recuperar la carta original del contexto
  const card = state.players[playerId].hand.find(c => c.instanceId === choice.resolutionContext?.currentCardInstanceId)
    ?? state.players[playerId].wearPile.find(c => c.instanceId === choice.resolutionContext?.currentCardInstanceId);
  if (!card || !choice.resolutionContext) {
    // Limpiar la eleccion pendiente
    state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
    return { state, events };
  }
  const cardDef = catalog?.byId.get(card.definitionId);
  if (!cardDef || !catalog) {
    state = { ...state, pendingChoices: state.pendingChoices.filter(c => c.choiceId !== command.choiceId) };
    return { state, events };
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
