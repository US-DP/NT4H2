/** Transicion de escenario. */

import type {
  GameEvent,
  GameState,
  Zone,
} from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import type { DeterministicRng } from '../../rng/index.js';
import { applyScenarioEffects, clearScenarioEffects } from '../../scenarios/index.js';
import { nextSeq } from '../../seq.js';

export function processScenarioTransition(
  state: GameState,
  _rng: DeterministicRng,
  catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  // D354: Si el campo sigue vacío Y el mazo de la Horda también está vacío,
  // la transición ya se hizo en processBattlefieldReplenishment. No repetir.
  // Solo hacer transición si el campo está vacío pero el mazo NO está vacío
  // (caso teórico: reposición falló por otra razón).
  if (state.battlefield.length === 0 && state.scenarioDeck.length > 0 && state.hordeDeck.length > 0 && !state.warlordRevealed) {
    // Descartar escenario actual
    if (state.scenario) {
      // Solitario: transferir scenarioCoins al jugador antes de descartar (spec §4.1)
      if (state.mode === 'SOLO' && state.scenarioCoins > 0) {
        events.push({
          type: 'COINS_GAINED',
          playerId: state.activePlayerId,
          amount: state.scenarioCoins,
          seq: nextSeq(),
        });
      }
      events.push({
        type: 'SCENARIO_DISCARDED',
        scenarioInstanceId: state.scenario.instanceId,
        seq: nextSeq(),
      });
      // Limpiar efectos continuos del escenario descartado
      const clearResult = clearScenarioEffects(state, state.scenario.definitionId);
      state = clearResult.state;
      events.push(...clearResult.events);
    }

    // Revelar nuevo escenario
    const newScenario = state.scenarioDeck[0];
    events.push({
      type: 'SCENARIO_REVEALED',
      scenarioInstanceId: newScenario.instanceId,
      definitionId: newScenario.definitionId,
      seq: nextSeq(),
    });

    state = {
      ...state,
      scenario: { ...newScenario, zone: 'SCENARIO_ACTIVE' as Zone },
      scenarioDeck: state.scenarioDeck.slice(1),
      // Solitario: colocar 1 moneda sobre el nuevo escenario (spec §4.1)
      scenarioCoins: state.mode === 'SOLO' ? 1 : 0,
      phase: 'TURN_END',
    };

    // Aplicar efectos continuos del nuevo escenario
    const applyResult = applyScenarioEffects(state, newScenario.definitionId, catalog);
    state = applyResult.state;
    events.push(...applyResult.events);

    // Emitir PHASE_CHANGED a TURN_END
    events.push({
      type: 'PHASE_CHANGED',
      phase: 'TURN_END',
      seq: nextSeq(),
    });

    return { state, events };
  }

  events.push({
    type: 'PHASE_CHANGED',
    phase: 'TURN_END',
    seq: nextSeq(),
  });

  return { state: { ...state, phase: 'TURN_END' }, events };
}

// ============================================================================
