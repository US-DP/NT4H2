/**
 * MulticlassMode — reglas del modo multiclase (4 jugadores).
 *
 * Diferencias respecto al modo estandar:
 * 1. 2 Señores de la Guerra en la Horda (en lugar de 1).
 * 2. Construccion de mazo multiclase: minimo 5 cartas por clase, 15 total.
 * 3. Mercado de 5 cartas (igual que modo normal).
 * 4. La partida termina cuando todos los Señores en juego son derrotados
 *    (1 Señor para 2-3 jugadores, 2 Señores para 4 jugadores — spec §5.2).
 * 5. Mano inicial de 4 cartas, campo inicial de 3 Huestes (igual que modo normal).
 */

import type {
  GameState,
  GameEvent,
  GameConfig,
} from '@nt4h/schema';
import type { DeterministicRng } from '../rng/index.js';
import type { CatalogLoadResult } from '@nt4h/catalog';
import { setupGame } from '../phases/setup.js';

/**
 * Validar que un mazo multiclase cumple las reglas:
 * - Minimo 5 cartas por clase
 * - 15 cartas total
 */
export function validateMulticlassDeck(
  deckCardIds: string[],
  catalog: CatalogLoadResult,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (deckCardIds.length !== 15) {
    errors.push(`Deck must have exactly 15 cards, got ${deckCardIds.length}`);
  }

  // Contar cartas por clase y por definicion (spec §5.1)
  const classCounts: Record<string, number> = {};
  const copyCounts: Record<string, number> = {};
  for (const cardId of deckCardIds) {
    const card = catalog.byId.get(cardId);
    if (!card) {
      errors.push(`Card not found: ${cardId}`);
      continue;
    }
    // Las cartas sin clase (Mercado, etc.) no pertenecen a un mazo de Habilidad
    if (!card.heroClass) {
      errors.push(`Card without hero class: ${cardId}`);
      continue;
    }
    classCounts[card.heroClass] = (classCounts[card.heroClass] ?? 0) + 1;
    copyCounts[cardId] = (copyCounts[cardId] ?? 0) + 1;
    if (copyCounts[cardId] > card.copies) {
      errors.push(`Too many copies of ${cardId}: ${copyCounts[cardId]} > ${card.copies}`);
    }
  }

  // D434: exactamente 2 clases (spec §5.1), no más ni menos
  const classes = Object.keys(classCounts);
  if (classes.length !== 2) {
    errors.push(`Deck must contain exactly 2 classes, got ${classes.length}`);
  }
  for (const [cls, count] of Object.entries(classCounts)) {
    if (count < 5) {
      errors.push(`Class ${cls} has only ${count} cards, minimum is 5`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Configurar el modo multiclase.
 * Delega a setupGame que ya maneja MULTICLASS con secondDeckId:
 * - mínimo 5 cartas de cada clase, 15 total
 * - 2 Señores en 4 jugadores
 * - Mercado filtrado por capabilities
 */
export function setupMulticlassMode(
  config: GameConfig,
  catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[]; rng: DeterministicRng; errors: string[] } {
  // Delegar a setupGame que ya implementa todas las reglas multiclase correctamente
  const result = setupGame(config, catalog);
  return {
    state: result.state,
    events: result.events,
    rng: result.rng,
    errors: result.errors,
  };
}

/**
 * Comprobar si la partida multiclase ha terminado.
 * Spec §5.2: 2-3 jugadores → 1 Señor; 4 jugadores → 2 Señores.
 * Se deriva del numero de jugadores, igual que setupGame.
 */
export function isMulticlassGameEnded(state: GameState): boolean {
  const required = state.playerOrder.length >= 4 ? 2 : 1;
  // D434 (spec §3.8/§5.3): termina al no quedar enemigos tras derrotar a
  // todos los Señores; el mazo de Horda restante no es condición de fin.
  return state.warlordsDefeatedCount >= required
    && state.battlefield.length === 0;
}
