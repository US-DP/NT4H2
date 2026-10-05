import type {
  GameEvent,
  GameState,
  Modifier,
  ModifierLayer,
  Zone,
  EffectDuration,
} from '@nt4h/schema';

import { cleanupHordeAttackEnd, cleanupRestoration, cleanupTurnEnd, revertScenarioEffects } from '../../modifiers/index.js';
import { canTransition } from '../../phases/transitions.js';

import { mapPlayer, mapPlayerState } from '../applyEvent.js';



export function applyPhaseChanged(
  state: GameState,
  event: Extract<GameEvent, { type: 'PHASE_CHANGED' }>,
): GameState {
  // Transiciones ilegales nunca deberían existir en el eventLog; el
  // grafo de fases (phases/transitions.ts) se cumple aquí, en vivo y
  // en replay — antes canTransition era código de test sin aplicación.
  if (!canTransition(state.phase, event.phase)) {
    throw new Error(
      `Invalid phase transition: ${state.phase} → ${event.phase}`,
    );
  }

  // D434: al entrar en HORDE_ATTACK se limpia la decision de Feldon de
  // todos los jugadores para que cada nuevo ataque vuelva a preguntar
  if (event.phase === 'HORDE_ATTACK') {
    const cleared = Object.fromEntries(
      Object.entries(state.players).map(([id, p]) => [id, { ...p, feldonDecision: undefined }]),
    );
    return { ...state, phase: event.phase, players: cleared };
  }
  return { ...state, phase: event.phase };
}

export function applyTurnStarted(
  state: GameState,
  event: Extract<GameEvent, { type: 'TURN_STARTED' }>,
): GameState {

  return {
    ...state,
    // TURN_STARTED ES la entrada a TURN_START: sin esto el log saltaba
    // GAME_END_CHECK → ATTACK_CHOICE sin fase intermedia, y la tabla
    // de transiciones no describía el flujo real.
    phase: 'TURN_START',
    activePlayerId: event.playerId,
    turnNumber: event.turnNumber,
    // Reset contadores por turno del jugador activo
    players: mapPlayer(state.players, event.playerId, p => {
      // Defensas declaradas PERMANENT/WHILE_SOURCE_ACTIVE (contenido
      // custom) sobreviven al cambio de turno; el resto caduca.
      const persists = (d?: EffectDuration) =>
        d === 'PERMANENT' || d === 'WHILE_SOURCE_ACTIVE';
      return {
      ...p,
      cardsPlayedThisTurn: {},
      cardsPlayedAgainstEnemy: {},
      prevention: persists(p.preventionExpiry) ? p.prevention : 0,
      preventionExpiry: persists(p.preventionExpiry) ? p.preventionExpiry : undefined,
      damageCancellation: persists(p.cancelExpiry) ? p.damageCancellation : false,
      cancelExpiry: persists(p.cancelExpiry) ? p.cancelExpiry : undefined,
      shields: 0,
      armor: persists(p.armorExpiry) ? p.armor : 0,
      armorExpiry: persists(p.armorExpiry) ? p.armorExpiry : undefined,
      blockNext: 0,
      interceptedBy: null,
      // Reset contadores de Apoyo (modo solitario)
      supportCardsDrawnThisTurn: 0,
      supportDeckIndexUsedThisTurn: null,
      supportCardUsedThisTurn: false,
      // D434: limpiar flags de prestadas — las cartas ya fueron devueltas
      // o eliminadas al final del turno anterior
      borrowedSupportCardIds: [],
      };
    }),
    // Taller: los oyentes de un turno expiran al empezar el siguiente
    listeners: (state.listeners ?? []).filter(l => l.duration !== 'THIS_TURN'),
    // La cuenta de descartes por evasi├│n solo vale dentro de la
    // resoluci├│n de la ficha ÔÇö fuera de ella leer├¡a basura.
    evasionDiscardedCount: 0,
  };
}

export function applyTurnEnded(
  state: GameState,
  _event: Extract<GameEvent, { type: 'TURN_ENDED' }>,
): GameState {

  return state;
}

export function applySupportDeckOpened(
  state: GameState,
  event: Extract<GameEvent, { type: 'SUPPORT_DECK_OPENED' }>,
): GameState {

  // D434: event-sourcing del contador de mazos de Apoyo abiertos (spec ┬º4.1)
  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    supportDecksOpened: Math.max(p.supportDecksOpened ?? 0, event.supportDeckIndex + 1),
  }));
}

export function applyScenarioRevealed(
  state: GameState,
  event: Extract<GameEvent, { type: 'SCENARIO_REVEALED' }>,
): GameState {

  // Setear el escenario revelado (puede haber sido borrado por SCENARIO_DISCARDED previo)
  // y sacar la carta del mazo de escenarios (idempotente: el camino
  // directo ya la extrajo antes de emitir el evento).
  return {
    ...state,
    scenario: {
      instanceId: event.scenarioInstanceId,
      definitionId: event.definitionId,
      ownerId: 'scenario',
      zone: 'SCENARIO_ACTIVE' as Zone,
    },
    scenarioDeck: state.scenarioDeck.filter(c => c.instanceId !== event.scenarioInstanceId),
    // Solitario: 1 moneda sobre el escenario revelado (spec ┬º4.1)
    scenarioCoins: state.mode === 'SOLO' ? 1 : 0,
  };
}

export function applyScenarioEffectsApplied(
  state: GameState,
  event: Extract<GameEvent, { type: 'SCENARIO_EFFECTS_APPLIED' }>,
): GameState {
  // Los deltas ya vienen resueltos en el evento (evalValue necesitaba el
  // contexto del camino directo): el fold solo aplica — live y replay
  // convergen sin catálogo.
  let next: GameState = {
    ...state,
    ignoreCoinRewards: event.ignoreCoinRewards,
    ignoreGloryRewards: event.ignoreGloryRewards,
  };
  if (event.marketCostDelta !== 0) {
    const sources = { ...(next.marketCostSources ?? {}) };
    sources[event.scenarioInstanceId] =
      (sources[event.scenarioInstanceId] ?? 0) + event.marketCostDelta;
    next = {
      ...next,
      marketCostModifier: next.marketCostModifier + event.marketCostDelta,
      marketCostSources: sources,
    };
  }
  const aura = event.auraModifiers ?? [];
  if (aura.length > 0) {
    next = {
      ...next,
      battlefield: next.battlefield.map(e => ({
        ...e,
        modifiers: [...e.modifiers, ...aura],
      })),
      scenario: next.scenario
        ? {
            ...next.scenario,
            auraModifiers: [...(next.scenario.auraModifiers ?? []), ...aura],
          }
        : next.scenario,
    };
  }
  return next;
}

export function applyScenarioDiscarded(
  state: GameState,
  event: Extract<GameEvent, { type: 'SCENARIO_DISCARDED' }>,
): GameState {

  // D434 (spec ┬º4.2): la moneda del ├║ltimo escenario se recoge "al
  // finalizar la partida". Si el descarte se produce al revelarse el
  // Se├▒or (warlordRevealed ya true por el WARLORD_REVEALED previo),
  // conservar scenarioCoins para el recuento final.
  const reverted = revertScenarioEffects(state, event.scenarioInstanceId);
  return {
    ...reverted,
    scenario: null,
    scenarioCoins: state.warlordRevealed ? state.scenarioCoins : 0,
  };
}

export function applyHeroAbilityUsed(
  state: GameState,
  event: Extract<GameEvent, { type: 'HERO_ABILITY_USED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    heroUsesRemaining: event.usesRemaining,
  }));
}

export function applyModifierAdded(
  state: GameState,
  event: Extract<GameEvent, { type: 'MODIFIER_ADDED' }>,
): GameState {
  // Aplicar modificador al objetivo (jugador, enemigo o mercado)
  const modifier: Modifier = {
    id: event.modifierId,
    sourceId: event.sourceId ?? '',
    layer: event.layer as ModifierLayer,
    timestamp: state.monotonicCounter,
    // 'INSTANT' no tiene sentido en un Modifier persistente (nada lo
    // expira — quedaba en la lista para siempre): normalizar como hace
    // applyVulnerabilityApplied → 'UNTIL_END_OF_TURN'.
    duration: event.duration === 'INSTANT'
      ? 'UNTIL_END_OF_TURN'
      : ((event.duration as Modifier['duration']) ?? 'UNTIL_END_OF_TURN'),
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
    // Registrar el delta por fuente para poder revertirlo cuando el
    // origen abandone el campo (WHILE_SOURCE_ACTIVE sobre el escalar).
    const sources = { ...(state.marketCostSources ?? {}) };
    if (event.sourceId) {
      sources[event.sourceId] = (sources[event.sourceId] ?? 0) + event.amount;
    }
    return {
      ...state,
      marketCostModifier: state.marketCostModifier + event.amount,
      marketCostSources: sources,
    };
  }
  return state;
}

export function applyModifierExpired(
  state: GameState,
  event: Extract<GameEvent, { type: 'MODIFIER_EXPIRED' }>,
): GameState {
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

export function applyEvasionPerformed(
  state: GameState,
  event: Extract<GameEvent, { type: 'EVASION_PERFORMED' }>,
): GameState {
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
        evasionTokenUsed: true,
      },
    },
  };
}

export function applyGameEnded(
  state: GameState,
  _event: Extract<GameEvent, { type: 'GAME_ENDED' }>,
): GameState {

  // Las elecciones pendientes mueren con la partida: sin la limpieza un
  // RESOLVE_CHOICE post-FINISHED podía mutar el estado terminal.
  return {
    ...state,
    phase: 'FINISHED',
    pendingChoices: state.pendingChoices.length ? [] : state.pendingChoices,
  };
}

export function applyLeaderDetermined(
  state: GameState,
  event: Extract<GameEvent, { type: 'LEADER_DETERMINED' }>,
): GameState {
  // Residuo de la puja: leaderBidCards solo existe entre el commit de la
  // puja y su resolución — el evento terminal la limpia para que el fold
  // reproduzca el mismo estado que la ejecución inline.
  const players = Object.fromEntries(
    Object.entries(state.players).map(([pid, p]) => [
      pid,
      p.leaderBidCards?.length ? { ...p, leaderBidCards: undefined } : p,
    ]),
  );
  return { ...state, players, activePlayerId: event.playerId };
}

export function applyLeaderTieBreak(
  state: GameState,
  _event: Extract<GameEvent, { type: 'LEADER_TIE_BREAK' }>,
): GameState {

  // Informativo: el ganador ya se aplic├│ en LEADER_DETERMINED.
  return state;
}

export function applyResolutionHalted(
  state: GameState,
  _event: Extract<GameEvent, { type: 'RESOLUTION_HALTED' }>,
): GameState {

  // Informativo: el estado queda como lo dejo la resolucion parcial
  return state;
}

export function applyStatusApplied(
  state: GameState,
  event: Extract<GameEvent, { type: 'STATUS_APPLIED' }>,
): GameState {
  const enemy = state.battlefield.find(e => e.instanceId === event.enemyInstanceId);
  if (!enemy) return state;
  const hasStatus = (enemy.statuses ?? []).some(s => s.id === event.status);
  const statuses = hasStatus
    ? (enemy.statuses ?? []).map(s =>
        s.id === event.status
          // Al acumular stacks la duración se refresca a la de la última
          // aplicación (política "última gana": re-aplicar renueva) —
          // conservar la del primero dejaba permanentes recortados o
          // temporales eternizados según el orden de los eventos.
          ? { ...s, stacks: s.stacks + event.stacks, duration: event.duration ?? s.duration }
          : s)
    : [...(enemy.statuses ?? []), { id: event.status, stacks: event.stacks, duration: event.duration }];
  return {
    ...state,
    battlefield: state.battlefield.map(e =>
      e.instanceId === event.enemyInstanceId ? { ...e, statuses } : e),
  };
}

export function applyStatusRemoved(
  state: GameState,
  event: Extract<GameEvent, { type: 'STATUS_REMOVED' }>,
): GameState {

  return {
    ...state,
    battlefield: state.battlefield.map(e =>
      e.instanceId === event.enemyInstanceId
        ? { ...e, statuses: (e.statuses ?? []).filter(s => s.id !== event.status) }
        : e),
  };
}

export function applyVariableSet(
  state: GameState,
  event: Extract<GameEvent, { type: 'VARIABLE_SET' }>,
): GameState {

  return {
    ...state,
    customVars: { ...(state.customVars ?? {}), [event.name]: event.value },
  };
}

export function applyListenerRegistered(
  state: GameState,
  event: Extract<GameEvent, { type: 'LISTENER_REGISTERED' }>,
): GameState {

  return {
    ...state,
    listeners: [...(state.listeners ?? []), event.listener],
  };
}

export function applyListenerRemoved(
  state: GameState,
  event: Extract<GameEvent, { type: 'LISTENER_REMOVED' }>,
): GameState {

  return {
    ...state,
    listeners: (state.listeners ?? []).filter(l => l.id !== event.listenerId),
  };
}

export function applyEffectsExpired(
  state: GameState,
  event: Extract<GameEvent, { type: 'EFFECTS_EXPIRED' }>,
): GameState {

  switch (event.scope) {
    case 'HORDE_ATTACK_END': return cleanupHordeAttackEnd(state);
    case 'RESTORATION': return cleanupRestoration(state);
    case 'TURN_END': return cleanupTurnEnd(state);
    default: return state;
  }
}

export function applyPendingChoicesRemoved(
  state: GameState,
  event: Extract<GameEvent, { type: 'PENDING_CHOICES_REMOVED' }>,
): GameState {

  return {
    ...state,
    pendingChoices: state.pendingChoices.filter(c => !event.choiceIds.includes(c.choiceId)),
  };
}

export function applyPendingChoiceCreated(
  state: GameState,
  event: Extract<GameEvent, { type: 'PENDING_CHOICE_CREATED' }>,
): GameState {
  // Idempotente: en el camino vivo la elección ya fue insertada por
  // mutación antes de que el diff emitiera el evento; en el fold del
  // eventLog es este reducer quien la materializa (E-2).
  if (state.pendingChoices.some(c => c.choiceId === event.choice.choiceId)) {
    return state;
  }
  return { ...state, pendingChoices: [...state.pendingChoices, event.choice] };
}

export function applyLeaderBidCards(
  state: GameState,
  event: Extract<GameEvent, { type: 'LEADER_BID_CARDS' }>,
): GameState {
  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    leaderBidCards: event.cardInstanceIds,
  }));
}

export function applyFeldonDecision(
  state: GameState,
  event: Extract<GameEvent, { type: 'FELDON_DECISION' }>,
): GameState {
  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    feldonDecision: event.decision,
  }));
}

export function applyStartingCardsSwapped(
  state: GameState,
  event: Extract<GameEvent, { type: 'STARTING_CARDS_SWAPPED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    startingSwapUsed: true,
  }));
}
