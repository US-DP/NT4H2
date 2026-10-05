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
  /** True si el presupuesto de iteraciones se agotó sin llegar a una
   *  fase estable — antes se truncaba en silencio y el estado "a
   *  medias" era indistinguible de uno terminado. */
  halted?: boolean;
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

  // E-2: diff de frontera sobre pendingChoices. Las elecciones se crean
  // por mutación directa en este orquestador y dentro de los pasos
  // (restoration, turnEnd, gameEnd, ventana de reacción, Feldon…); sin
  // evento, el eventLog no las contenía y un fold/replayFromSnapshot las
  // perdía. Los diffs se aplican con applyEvent: el reducer es
  // idempotente y además escribe el evento en state.eventLog.
  const emittedChoiceIds = new Set(current.pendingChoices.map(c => c.choiceId));
  const flushChoiceDiff = () => {
    for (const c of current.pendingChoices) {
      if (!emittedChoiceIds.has(c.choiceId)) {
        emittedChoiceIds.add(c.choiceId);
        const ev: GameEvent = { type: 'PENDING_CHOICE_CREATED', choice: c, seq: nextSeq() };
        allEvents.push(ev);
        current = applyEvent(current, ev);
      }
    }
    const gone = [...emittedChoiceIds]
      .filter(id => !current.pendingChoices.some(c => c.choiceId === id));
    if (gone.length > 0) {
      for (const id of gone) emittedChoiceIds.delete(id);
      const ev: GameEvent = { type: 'PENDING_CHOICES_REMOVED', choiceIds: gone, seq: nextSeq() };
      allEvents.push(ev);
      current = applyEvent(current, ev);
    }
  };

  // Maximo 20 iteraciones para evitar bucles infinitos entre fases
  // automaticas. Una fase que espera entrada externa (SETUP,
  // INITIAL_PLAYER_SELECTION, WAITING_FOR_CHOICE, TURN_START si no
  // avanza sola…) sale del bucle en el default — iterarla era presu-
  // puesto quemado que acababa en halted=true siendo un estado sano.
  const MAX_PHASE_ITERS = 20;
  let iterationsUsed = 0;
  let waitingExternal = false;
  for (let i = 0; i < MAX_PHASE_ITERS; i++) {
    iterationsUsed = i + 1;
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
      // Event-sourced: la poda también debe ocurrir en el fold del
      // eventLog — se emite Y se aplica (el reducer filtra de nuevo:
      // idempotente) para que el eventLog del estado la contenga.
      const ev: GameEvent = {
        type: 'PENDING_CHOICES_REMOVED',
        choiceIds: current.pendingChoices
          .filter(c => !aliveChoices.includes(c))
          .map(c => c.choiceId),
        seq: nextSeq(),
      };
      allEvents.push(ev);
      current = applyEvent(current, ev);
      for (const id of ev.choiceIds) emittedChoiceIds.delete(id);
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
            const ev: GameEvent = {
              type: 'PHASE_CHANGED',
              phase: 'HORDE_ATTACK',
              seq: nextSeq(),
            };
            allEvents.push(ev);
            // Aplicado (no solo emitido): sin esto el eventLog no lo
            // contenía y el fold divergía del estado vivo.
            current = applyEvent(current, ev);
            flushChoiceDiff();
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
          flushChoiceDiff();
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
          flushChoiceDiff();
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
          flushChoiceDiff();
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
          flushChoiceDiff();
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
        // Si el jugador debe elegir qué descartar (mano > 4), pausar.
        // Solo elecciones OBLIGATORIAS (minSelections > 0): una CONFIRM
        // opcional sin responder (turn-start-* de un jugador AFK o
        // eliminado) dejaba la fase parada para siempre — misma
        // convención que execute.ts (minSelections > 0 = bloqueante).
        if (current.pendingChoices.some(c => c.minSelections > 0)) {
          flushChoiceDiff();
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
        waitingExternal = true;
        break;
    }

    flushChoiceDiff();
    if (pending !== null || waitingExternal) break;
  }

  // Si el presupuesto se agotó sin llegar a una fase estable, el estado
  // queda "a medias" — señalarlo para que el llamador pueda decidir
  // (antes era indistinguible de un proceso terminado).
  const halted = pending === null && iterationsUsed >= MAX_PHASE_ITERS;
  if (halted) {
    console.warn(`processPhases agotó ${MAX_PHASE_ITERS} iteraciones en fase ${current.phase}`);
  }
  return { state: current, events: allEvents, rng, pendingPhase: pending, halted };
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
    // Jugador eliminado: no ofrecer reacción — la poda de pendingChoices
    // la retiraría en la siguiente iteración y buildReactionWindow la
    // recrearía en un bucle infinito (deadlock del Ataque de la Horda).
    if (player.wounds >= (player.maxWounds ?? 3)) continue;

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
