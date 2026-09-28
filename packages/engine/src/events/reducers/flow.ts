import type {
  GameEvent,
  GameState,
  Modifier,
  ModifierLayer,
  Zone,
} from '@nt4h/schema';

import { cleanupHordeAttackEnd, cleanupRestoration, cleanupTurnEnd } from '../../modifiers/index.js';

import { mapPlayer, mapPlayerState } from '../applyEvent.js';



export function applyPhaseChanged(
  state: GameState,
  event: Extract<GameEvent, { type: 'PHASE_CHANGED' }>,
): GameState {

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
      armor: 0,
      blockNext: 0,
      interceptedBy: null,
      // Reset contadores de Apoyo (modo solitario)
      supportCardsDrawnThisTurn: 0,
      supportDeckIndexUsedThisTurn: null,
      supportCardUsedThisTurn: false,
      // D434: limpiar flags de prestadas ÔÇö las cartas ya fueron devueltas
      // o eliminadas al final del turno anterior
      borrowedSupportCardIds: [],
    })),
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

export function applyScenarioDiscarded(
  state: GameState,
  _event: Extract<GameEvent, { type: 'SCENARIO_DISCARDED' }>,
): GameState {

  // D434 (spec ┬º4.2): la moneda del ├║ltimo escenario se recoge "al
  // finalizar la partida". Si el descarte se produce al revelarse el
  // Se├▒or (warlordRevealed ya true por el WARLORD_REVEALED previo),
  // conservar scenarioCoins para el recuento final.
  return {
    ...state,
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

  return { ...state, phase: 'FINISHED' };
}

export function applyLeaderDetermined(
  state: GameState,
  event: Extract<GameEvent, { type: 'LEADER_DETERMINED' }>,
): GameState {

  return { ...state, activePlayerId: event.playerId };
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
        s.id === event.status ? { ...s, stacks: s.stacks + event.stacks } : s)
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
