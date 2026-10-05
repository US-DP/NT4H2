/** Comprobacion de fin de partida y efectos de inicio de turno. */

import type {
  GameEvent,
  GameState,
} from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import type { DeterministicRng } from '../../rng/index.js';
import { calculateSoloScore } from '../../modes/solo.js';
import { executeTurnStartEffect, onTurnStart } from '../../scenarios/index.js';
import { computeFinalScore } from '../../scoring.js';
import { nextSeq } from '../../seq.js';

export function processGameEndCheck(
  state: GameState,
  _rng: DeterministicRng,
  catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  // Especificacion 3.8: la partida termina cuando no quedan enemigos
  // en el campo tras derrotar al Señor de la Guerra.
  const battlefieldEmpty = state.battlefield.length === 0;
  const warlordDefeated = state.warlordDefeated;

  // Especificacion 3.1: Derrota colectiva si todos los héroes quedan eliminados
  const allHeroesEliminated = state.playerOrder.every(pid => {
    const p = state.players[pid];
    return p.wounds >= (p.maxWounds ?? 999);
  });
  if (allHeroesEliminated && state.playerOrder.length > 0) {
    events.push({
      type: 'GAME_ENDED',
      winnerId: null, // Derrota colectiva
      scores: {},
      seq: nextSeq(),
    });
    return { state: { ...state, phase: 'FINISHED' }, events };
  }

  // D348: Si el mazo de la Horda se agota sin revelar al Warlord y el campo está vacío,
  // la partida termina en derrota (estado imposible: no hay más enemigos)
  if (!warlordDefeated && battlefieldEmpty && state.hordeDeck.length === 0) {
    events.push({
      type: 'GAME_ENDED',
      winnerId: null, // Derrota: Warlord no derrotado
      scores: {},
      seq: nextSeq(),
    });
    return { state: { ...state, phase: 'FINISHED' }, events };
  }

  // Especificacion 3.1: la partida termina cuando:
  // 1. Ha aparecido el Señor de la Guerra
  // 2. El Señor de la Guerra ha sido derrotado
  // 3. No queda ningún enemigo en el campo de batalla
  // D355: En multiclase (4 jugadores → 2 Señores), ambos deben ser derrotados
  // y el mazo de la Horda debe estar vacío.
  // D405: derivar el numero requerido de los Señores realmente en juego
  // (multiclase 2-3 jugadores solo tiene 1 Señor en el mazo)
  // D434: deduplicar — un Señor revelado y devuelto al mazo (Lodazal de
  // Kalern) aparecería en eventLog Y en hordeDeck; contarlo una sola vez.
  const revealedWarlordIds = new Set(
    state.eventLog.filter(e => e.type === 'WARLORD_REVEALED').map(e => e.warlordInstanceId),
  );
  const totalWarlords = revealedWarlordIds.size
    + state.hordeDeck.filter(c =>
        !revealedWarlordIds.has(c.instanceId)
        && catalog.byId.get(c.definitionId)?.type === 'WARLORD'
      ).length
    + state.warlordsDefeatedCount;
  const requiredWarlordKills = state.mode === 'MULTICLASS' ? Math.max(1, totalWarlords) : 1;
  const allWarlordsDefeated = state.warlordsDefeatedCount >= requiredWarlordKills;
  // D434 (spec §3.8/§5.3): no se exige hordeDeck vacío — la partida termina
  // cuando no quedan enemigos en el campo tras derrotar a los Señores
  if (allWarlordsDefeated && battlefieldEmpty) {
    // Modo solitario: puntuación diferente (spec §4.3)
    if (state.mode === 'SOLO' && state.playerOrder.length === 1) {
      const playerId = state.playerOrder[0];
      // D434 (spec §4.2): recoger la moneda del último escenario al
      // finalizar la partida (se conservó en scenarioCoins al revelar al
      // Señor). Solo emitir el evento — el fold externo lo aplica una vez.
      let scoreState = state;
      if (state.scenarioCoins > 0) {
        events.push({
          type: 'COINS_GAINED',
          playerId,
          amount: state.scenarioCoins,
          seq: nextSeq(),
        });
        // Score calculado con la moneda incluida sin duplicar en el fold
        scoreState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: { ...state.players[playerId], coins: state.players[playerId].coins + state.scenarioCoins },
          },
        };
      }
      const solo = calculateSoloScore(scoreState, playerId);
      events.push({
        type: 'GAME_ENDED',
        winnerId: playerId,
        scores: { [playerId]: solo.total },
        seq: nextSeq(),
      });
      return { state: { ...state, phase: 'FINISHED', scenarioCoins: 0 }, events };
    }
    // Recuento de Gloria (especificacion 3.8) — computeFinalScore es la
    // única fuente de verdad de la fórmula: Gloria + 1/3 Monedas +
    // Tenaz, con desempate por trofeos. El record se construye en
    // playerOrder para que el desempate estable sea determinista.
    const finalScore = computeFinalScore(
      Object.fromEntries(state.playerOrder.map(pid => [pid, state.players[pid]])),
    );
    const scores: Record<string, number> = {};
    for (const ps of finalScore.players) {
      scores[ps.playerId] = ps.total;
    }
    const winnerId: string | null = finalScore.ranking[0]?.playerId ?? null;

    events.push({
      type: 'GAME_ENDED',
      winnerId,
      scores,
      seq: nextSeq(),
    });

    return { state: { ...state, phase: 'FINISHED' }, events };
  }

  // Continuar al siguiente turno
  events.push({
    type: 'TURN_STARTED',
    playerId: state.activePlayerId,
    turnNumber: state.turnNumber,
    seq: nextSeq(),
  });

  // Efectos de inicio de turno (Montañas de Ur, Puerto de Eque, Yacimientos de
  // Jade, Lodazal de Kalern, etc.). Los efectos OPCIONALES generan una eleccion
  // CONFIRM; los OBLIGATORIOS (Lodazal de Kalern) se ejecutan directamente.
  if (state.scenario) {
    const turnStartChoice = onTurnStart(state, state.scenario.definitionId);
    if (turnStartChoice) {
      if (turnStartChoice.optional) {
        state = {
          ...state,
          pendingChoices: [
            // Purga de turn-start-* obsoletos: una confirmación opcional
            // no respondida en un turno anterior no debe acumularse ni
            // (sobre todo) bloquear el avance de fases posteriores.
            ...state.pendingChoices.filter(c => !c.choiceId.startsWith('turn-start-')),
            {
              choiceId: `turn-start-${state.turnNumber}`,
              playerId: state.activePlayerId,
              type: 'CONFIRM' as const,
              prompt: turnStartChoice.prompt,
              options: [],
              minSelections: 0,
              maxSelections: 1,
            },
          ],
        };
      } else {
        // Efecto obligatorio: ejecutar sin esperar aceptacion del jugador
        const mandatory = executeTurnStartEffect(
          state, state.scenario.definitionId, state.activePlayerId, true, catalog, _rng,
        );
        state = mandatory.state;
        events.push(...mandatory.events);
        if (mandatory.pendingChoice) {
          state = {
            ...state,
            pendingChoices: [...state.pendingChoices, mandatory.pendingChoice],
          };
        }
      }
    }
  }

  events.push({
    type: 'PHASE_CHANGED',
    phase: 'ATTACK_CHOICE',
    seq: nextSeq(),
  });

  return { state: { ...state, phase: 'ATTACK_CHOICE' }, events };
}


