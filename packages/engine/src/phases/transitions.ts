/**
 * Fases del juego — definicion de transiciones validas.
 *
 * Flujo principal:
 *   SETUP → INITIAL_PLAYER_SELECTION → TURN_START → ATTACK_CHOICE
 *     → PLAYER_ATTACK → HORDE_ATTACK → MARKET → RESTORATION
 *     → BATTLEFIELD_REPLENISHMENT → SCENARIO_TRANSITION → TURN_END
 *     → GAME_END_CHECK → (TURN_START | FINISHED)
 *
 * Excepciones:
 *   - ATTACK_CHOICE puede ir a MARKET directamente (Evasion)
 *   - PLAYER_ATTACK puede volver a si mismo (mas cartas) o a HORDE_ATTACK (End Attack)
 *   - Si no hay enemigos en campo, PLAYER_ATTACK → BATTLEFIELD_REPLENISHMENT
 *   - GAME_END_CHECK emite TURN_STARTED (que fija TURN_START via reducer)
 *     antes de PHASE_CHANGED → ATTACK_CHOICE — la cadena
 *     GAME_END_CHECK → TURN_START → ATTACK_CHOICE es la real.
 *   - Un PHASE_CHANGED hacia la MISMA fase es un re-anuncio (p. ej. la
 *     ventana de reacción re-publica HORDE_ATTACK), no una transición.
 *
 * Fases declaradas pero RESERVADAS (nunca se entra por la máquina de
 * fases — existen en el schema para contrato/i18n):
 *   - RESOLVING_CARD: las cartas se resuelven inline dentro de
 *     PLAYER_ATTACK; la elección se modela con pendingChoices.
 *   - WAITING_FOR_CHOICE: igual — pendingChoices sin fase dedicada.
 */

import type { Phase } from '@nt4h/schema';

const TRANSITIONS: Record<Phase, Phase[]> = {
  SETUP: ['INITIAL_PLAYER_SELECTION'],
  INITIAL_PLAYER_SELECTION: ['TURN_START'],
  TURN_START: ['ATTACK_CHOICE'],
  ATTACK_CHOICE: ['PLAYER_ATTACK', 'HORDE_ATTACK', 'MARKET'],
  PLAYER_ATTACK: ['PLAYER_ATTACK', 'HORDE_ATTACK', 'BATTLEFIELD_REPLENISHMENT'],
  RESOLVING_CARD: ['PLAYER_ATTACK', 'WAITING_FOR_CHOICE'],
  WAITING_FOR_CHOICE: ['PLAYER_ATTACK', 'HORDE_ATTACK'],
  HORDE_ATTACK: ['MARKET'],
  MARKET: ['RESTORATION'],
  RESTORATION: ['BATTLEFIELD_REPLENISHMENT'],
  BATTLEFIELD_REPLENISHMENT: ['SCENARIO_TRANSITION'],
  SCENARIO_TRANSITION: ['TURN_END'],
  TURN_END: ['GAME_END_CHECK'],
  GAME_END_CHECK: ['TURN_START', 'FINISHED'],
  FINISHED: [],
};

export function canTransition(from: Phase, to: Phase): boolean {
  // Re-anuncio de la misma fase (p. ej. ventana de reacción de
  // HORDE_ATTACK): no es una transición, siempre permitido.
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextPhases(from: Phase): Phase[] {
  return TRANSITIONS[from] ?? [];
}

/** Valida y devuelve la nueva fase, o null si la transicion es invalida */
export function validateTransition(from: Phase, to: Phase): { ok: true } | { ok: false; reason: string } {
  if (canTransition(from, to)) return { ok: true };
  return {
    ok: false,
    reason: `Invalid phase transition: ${from} → ${to}. Valid: ${(TRANSITIONS[from] ?? []).join(', ')}`,
  };
}
