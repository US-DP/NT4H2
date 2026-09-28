/**
 * PhaseEngine — motor de fases que procesa transiciones automaticas.
 *
 * Algunas fases requieren accion del jugador (PLAYER_ATTACK, MARKET, ATTACK_CHOICE).
 * Otras son automaticas (HORDE_ATTACK, RESTORATION, BATTLEFIELD_REPLENISHMENT,
 * SCENARIO_TRANSITION, TURN_END, GAME_END_CHECK).
 *
 * Este modulo ejecuta las fases automaticas y devuelve los eventos generados.
 */

import type {
  GameState,
  GameEvent,
  PendingChoice,
} from '@nt4h/schema';
import type { DeterministicRng } from '../rng/index.js';
import { applyEvent } from '../events/applyEvent.js';
import { getEffectiveFortitude, getEnemyOutgoingDamageBonus } from '../modifiers/index.js';
import { EffectRegistry, registerCoreEffects } from '../effects/registry.js';
import { processHordeAttackTriggers } from '../effects/resolver.js';
import { dispatchListeners } from '../effects/listeners.js';
import { nextSeq, resetSeq } from '../seq.js';
import type { CatalogLoadResult } from '@nt4h/catalog';
import { processHordeAttack } from './steps/hordeAttack.js';
import { processRestoration } from './steps/restoration.js';
import { processBattlefieldReplenishment } from './steps/replenishment.js';
import { processScenarioTransition } from './steps/scenario.js';
import { processTurnEnd } from './steps/turnEnd.js';
import { processGameEndCheck } from './steps/gameEnd.js';

// D426: alias por compatibilidad — resetSeq ahora es global (§51.12)
export function resetPhaseSeq(): void {
  resetSeq();
}

export interface PhaseResult {
  state: GameState;
  events: GameEvent[];
  rng: DeterministicRng;
  /** Si la fase requiere accion del jugador, indica cual */
  pendingPhase: 'PLAYER_ATTACK' | 'MARKET' | 'ATTACK_CHOICE' | 'FINISHED' | null;
}

/**
 * Procesar la fase actual del estado y avanzar automaticamente
 * hasta llegar a una fase que requiera accion del jugador.
 */
export function processPhases(
  state: GameState,
  rng: DeterministicRng,
  catalog: CatalogLoadResult,
): PhaseResult {
  let current = state;
  const allEvents: GameEvent[] = [];
  let pending: PhaseResult['pendingPhase'] = null;

  // Registry compartido para oyentes del Taller (REGISTER_LISTENER): se
  // disparan tras cada evento de fase. Sus eventos NO re-disparan oyentes.
  const phaseReg = new EffectRegistry();
  registerCoreEffects(phaseReg);
  const applyBatch = (base: GameState, evs: GameEvent[]): { state: GameState; extra: GameEvent[] } => {
    let s = base;
    const extra: GameEvent[] = [];
    for (const ev of evs) {
      s = applyEvent(s, ev);
      const dl = dispatchListeners(s, ev, { registry: phaseReg, rng, nextSeq });
      if (dl.events.length > 0) {
        extra.push(...dl.events);
        s = dl.state;
      }
    }
    return { state: s, extra };
  };

  // Maximo 20 iteraciones para evitar bucles infinitos
  for (let i = 0; i < 20; i++) {
    // Podar pendingChoices de héroes eliminados: un héroe con
    // wounds >= maxWounds no puede ejecutar comandos (salvo PASS),
    // así que sus elecciones pendientes bloquearían la máquina de
    // fases para siempre (deadlock). Se retiran como parte del
    // avance — la spec le saca de la partida al recibir la herida.
    const aliveChoices = current.pendingChoices.filter(c => {
      const p = current.players[c.playerId];
      // Jugador inexistente o eliminado → la elección es irresoluble.
      return !!p && p.wounds < (p.maxWounds ?? 3);
    });
    if (aliveChoices.length !== current.pendingChoices.length) {
      // Event-sourced: la poda también debe ocurrir en el fold del eventLog
      allEvents.push({
        type: 'PENDING_CHOICES_REMOVED',
        choiceIds: current.pendingChoices
          .filter(c => !aliveChoices.includes(c))
          .map(c => c.choiceId),
        seq: nextSeq(),
      });
      current = { ...current, pendingChoices: aliveChoices };
    }

    switch (current.phase) {
      case 'HORDE_ATTACK': {
        // D371: Ventana de reacción — antes del ataque, otros héroes pueden
        // usar pericias reactivas (Valèrys, Lisavette) o pasar
        const hasReactionChoice = current.pendingChoices.some(
          c => c.type === 'REACTION_WINDOW'
        );
        if (!hasReactionChoice) {
          const reactionChoices = buildReactionWindow(current);
          if (reactionChoices.length > 0) {
            current = {
              ...current,
              pendingChoices: [...current.pendingChoices, ...reactionChoices],
            };
            allEvents.push({
              type: 'PHASE_CHANGED',
              phase: 'HORDE_ATTACK',
              seq: nextSeq(),
            });
            // Detener: esperar a que los jugadores reaccionen
            return { events: allEvents, state: current, rng, pendingPhase: null };
          }
        }
        // Si todavía hay elecciones de reacción pendientes, esperar — incluye
        // la ventana (REACTION_WINDOW) y las elecciones de objetivo que
        // generan las pericias reactivas (reaction-hero-*, lisavette-enemy-*,
        // valerys-*). Sin esto la Horda atacaba antes de elegir objetivo y la
        // interceptación caía en el siguiente turno.
        const pendingReactions = current.pendingChoices.filter(
          c => c.type === 'REACTION_WINDOW'
            || c.fromReactionWindow === true
            // Fallback para estados serializados antiguos sin la marca
            || c.choiceId.startsWith('reaction-hero-')
            || c.choiceId.startsWith('lisavette-enemy-')
            || c.choiceId.startsWith('lisavette-')
            || c.choiceId.startsWith('valerys-')
        );
        if (pendingReactions.length > 0) {
          return { events: allEvents, state: current, rng, pendingPhase: null };
        }

        // Primero procesar disparadores reactivos (Trampa) antes del ataque
        const reg = new EffectRegistry();
        registerCoreEffects(reg);
        const triggerResult = processHordeAttackTriggers(current, rng, reg, catalog);
        // D440: triggerResult.state YA tiene los eventos aplicados inline
        // (applyEventInline dentro del resolver). Aplicarlos de nuevo con
        // applyBatch sobre ese estado duplicaría recompensas (COINS_GAINED,
        // GLORY_GAINED del escenario). Se aplican sobre `current` (estado
        // pre-trigger), lo que reproduce triggerResult.state y además
        // dispara los oyentes del Taller.
        // Si hay eleccion pendiente (empate de Trampa), detener y esperar al jugador
        const trigApplied = applyBatch(current, triggerResult.events);
        allEvents.push(...triggerResult.events, ...trigApplied.extra);
        if (triggerResult.pendingChoice) {
          current = {
            ...trigApplied.state,
            pendingChoices: [...trigApplied.state.pendingChoices, triggerResult.pendingChoice],
          };
          // Detener el procesamiento de fases: el jugador debe resolver la eleccion
          return { events: allEvents, state: current, rng, pendingPhase: null };
        }
        current = trigApplied.state;

        // D434: Feldon — Pericia de uso discrecional (spec §6.8, 1 uso).
        // Preguntar al jugador que va a recibir el daño (activo o interceptor)
        // antes de resolver el ataque de la Horda.
        const activeP = current.players[current.activePlayerId];
        const damageTargetId = activeP?.interceptedBy ?? current.activePlayerId;
        const damageTarget = current.players[damageTargetId];
        const feldonChoicePending = current.pendingChoices.some(
          c => c.type === 'CONFIRM' && c.choiceId.startsWith('feldon-reduce-')
        );
        // Si la pregunta a Feldon ya está pendiente, el ataque debe ESPERAR
        // su resolución — antes atacaba directamente dejando la elección
        // bloqueando las fases siguientes.
        if (feldonChoicePending) {
          return { events: allEvents, state: current, rng, pendingPhase: null };
        }
        // No ofrecer la Pericia si el daño entrante es 0 (campo vacío o
        // enemigos con daño deshabilitado): aceptarla gastaría el uso en vano
        const incomingDamage = current.battlefield
          .filter(e => !e.damageDisabled)
          .reduce((sum, e) => sum + Math.max(0,
            getEffectiveFortitude(e, current) - e.wounds + getEnemyOutgoingDamageBonus(e)), 0);
        if (
          damageTarget
          && damageTarget.heroId === 'hero.feldon'
          && (damageTarget.heroUsesRemaining ?? 0) > 0
          && damageTarget.feldonDecision === undefined
          && !feldonChoicePending
          && incomingDamage > 0
        ) {
          current = {
            ...current,
            pendingChoices: [...current.pendingChoices, {
              choiceId: `feldon-reduce-${current.turnNumber}-${damageTargetId}`,
              playerId: damageTargetId,
              type: 'CONFIRM' as const,
              prompt: 'Feldon: ¿usar tu Pericia para perder solo la mitad de cartas?',
              options: ['yes', 'no'],
              minSelections: 1,
              maxSelections: 1,
            }],
          };
          return { events: allEvents, state: current, rng, pendingPhase: null };
        }
        // Luego procesar el ataque de la Horda
        const result = processHordeAttack(current, rng, catalog);
        // Aplicar eventos al estado para sincronizar
        const hordeApplied = applyBatch(result.state, result.events);
        current = hordeApplied.state;
        allEvents.push(...result.events, ...hordeApplied.extra);
        break;
      }

      case 'RESTORATION': {
        const result = processRestoration(current, rng, catalog);
        const restApplied = applyBatch(result.state, result.events);
        current = restApplied.state;
        allEvents.push(...result.events, ...restApplied.extra);
        // Si el jugador debe elegir qué descartar (mano > 4), pausar
        if (current.pendingChoices.length > 0) {
          return { events: allEvents, state: current, rng, pendingPhase: null };
        }
        break;
      }

      case 'BATTLEFIELD_REPLENISHMENT': {
        const result = processBattlefieldReplenishment(current, rng, catalog);
        const replApplied = applyBatch(result.state, result.events);
        current = replApplied.state;
        allEvents.push(...result.events, ...replApplied.extra);
        break;
      }

      case 'SCENARIO_TRANSITION': {
        const result = processScenarioTransition(current, rng, catalog);
        const scenApplied = applyBatch(result.state, result.events);
        current = scenApplied.state;
        allEvents.push(...result.events, ...scenApplied.extra);
        break;
      }

      case 'TURN_END': {
        const result = processTurnEnd(current, rng);
        const endApplied = applyBatch(result.state, result.events);
        current = endApplied.state;
        allEvents.push(...result.events, ...endApplied.extra);
        break;
      }

      case 'GAME_END_CHECK': {
        const result = processGameEndCheck(current, rng, catalog);
        const endCheckApplied = applyBatch(result.state, result.events);
        current = endCheckApplied.state;
        allEvents.push(...result.events, ...endCheckApplied.extra);
        if (current.phase === 'FINISHED') {
          pending = 'FINISHED';
        }
        break;
      }

      case 'PLAYER_ATTACK':
      case 'ATTACK_CHOICE':
      case 'MARKET':
        pending = current.phase;
        break;

      case 'FINISHED':
        pending = 'FINISHED';
        break;

      default:
        // Fases que requieren accion o no se procesan aqui
        pending = null;
        break;
    }

    if (pending !== null) break;
  }

  return { state: current, events: allEvents, rng, pendingPhase: pending };
}

// ============================================================================
// D371: Ventana de reacción — construir elecciones para héroes reactivos
// ============================================================================

function buildReactionWindow(state: GameState): PendingChoice[] {
  const choices: PendingChoice[] = [];
  const activePlayerId = state.activePlayerId;

  for (const playerId of state.playerOrder) {
    if (playerId === activePlayerId) continue;
    const player = state.players[playerId];
    if (!player || player.heroUsesRemaining <= 0) continue;

    const heroId = state.players[playerId]?.heroId;
    // D428: identificar héroes reactivos por heroId estable (Valèrys, Lisavette)
    const reactiveHeroes = ['hero.valerys', 'hero.lisavette'];
    if (!reactiveHeroes.includes(heroId ?? '')) continue;

    // Lisavette: solo ofrecer reacción si tiene carta "Escudo" (warrior.shield) en mano
    const isLisavette = heroId === 'hero.lisavette';
    if (isLisavette && !player.hand.some(c => c.definitionId === 'warrior.shield')) continue;

    // Verificar que el jugador no tenga ya una elección pendiente
    const hasExisting = state.pendingChoices.some(
      c => c.playerId === playerId && c.type === 'REACTION_WINDOW'
    );
    if (hasExisting) continue;

    choices.push({
      choiceId: `reaction-${playerId}-${nextSeq()}`,
      playerId,
      type: 'REACTION_WINDOW',
      prompt: `Reacción: ¿Usar pericia de héroe o pasar?`,
      options: ['USE_ABILITY', 'PASS'],
      minSelections: 1,
      maxSelections: 1,
    });
  }

  return choices;
}
