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
