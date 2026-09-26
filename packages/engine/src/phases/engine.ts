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
  EnemyState,
  Zone,
  PendingChoice,
} from '@nt4h/schema';
import type { DeterministicRng } from '../rng/index.js';
import { applyEvent, checkFortitudeDefeats, mapPlayerState } from '../events/applyEvent.js';
import { getEffectiveFortitude, getEnemyOutgoingDamageBonus, cleanupHordeAttackEnd, cleanupRestoration, cleanupTurnEnd } from '../modifiers/index.js';
import { applyScenarioEffects, clearScenarioEffects, onTurnStart, executeTurnStartEffect } from '../scenarios/index.js';
import { EffectRegistry, registerCoreEffects } from '../effects/registry.js';
import { processHordeAttackTriggers } from '../effects/resolver.js';
import { dispatchListeners } from '../effects/listeners.js';
import { computeHordeAttackBreakdown } from '../analysis/hordeBreakdown.js';
import { calculateSoloScore } from '../modes/solo.js';
import { nextSeq, resetSeq } from '../seq.js';
import type { CatalogLoadResult } from '@nt4h/catalog';

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

// ============================================================================
// HORDE_ATTACK — la Horda ataca al jugador activo
// ============================================================================

function processHordeAttack(
  state: GameState,
  rng: DeterministicRng,
  catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const player = state.players[state.activePlayerId];

  // === Estados de enemigo del Taller (§3) ===
  // 'poison': al activarse la Horda, cada enemigo envenenado recibe sus stacks
  // de Heridas ANTES de resolver el ataque (puede morir y no aportar daño).
  // 'stun': salta este ataque y luego se consume (emitido aquí; el desglose
  // de daño ya lo trató como deshabilitado via computeHordeAttackBreakdown).
  // `damageBase`: vista local con el veneno ya aplicado — SOLO para el
  // cálculo de daño. El `state` devuelto no la incluye: los eventos los
  // aplica processPhases (aplicarlos aquí duplicaría las Heridas).
  let damageBase = state;
  {
    const defeatedByPoison = new Set<string>();
    for (const enemy of state.battlefield) {
      const poison = (enemy.statuses ?? []).find(s => s.id === 'poison' && s.stacks > 0);
      if (!poison) continue;
      const woundEv: GameEvent = {
        type: 'WOUND_PLACED',
        enemyInstanceId: enemy.instanceId,
        amount: poison.stacks,
        seq: nextSeq(),
      };
      events.push(woundEv);
      damageBase = applyEvent(damageBase, woundEv);
      const refreshed = damageBase.battlefield.find(e => e.instanceId === enemy.instanceId);
      if (refreshed && refreshed.wounds >= getEffectiveFortitude(refreshed, damageBase)) {
        defeatedByPoison.add(enemy.instanceId);
        const defEv: GameEvent = {
          type: 'ENEMY_DEFEATED',
          enemyInstanceId: enemy.instanceId,
          enemyDefinitionId: enemy.definitionId,
          defeatingPlayerId: state.activePlayerId,
          reward: {
            coins: state.ignoreCoinRewards ? 0 : (enemy.reward?.coins ?? 0),
            glory: state.ignoreGloryRewards ? 0 : (enemy.reward?.glory ?? 0),
          },
          seq: nextSeq(),
        };
        events.push(defEv);
        damageBase = applyEvent(damageBase, defEv);
      }
    }
    // 'stun' salta este ataque (el desglose lo ve aún presente → aporta 0)
    // y se consume tras la Horda: STATUS_REMOVED solo va al log.
    for (const enemy of state.battlefield) {
      if (defeatedByPoison.has(enemy.instanceId)) continue;
      if ((enemy.statuses ?? []).some(s => s.id === 'stun' && s.stacks > 0)) {
        events.push({
          type: 'STATUS_REMOVED',
          enemyInstanceId: enemy.instanceId,
          status: 'stun',
          seq: nextSeq(),
        });
      }
    }
  }

  // Calcular dano total de la Horda
  // Especificacion 3.4: Dano = Suma(Fortaleza - Heridas) de cada enemigo vivo
  // Especificacion 3.6: Anti-Magia: enemigos con este icono hacen menos dano
  // a heroes con capacidad MAGIC (restar valor indicado de la Fortaleza)
  // Fuente única del cálculo: computeHordeAttackBreakdown (la UI usa la
  // misma función para el banner/resumen — no se duplica la regla).
  // Valerys: si el dano fue interceptado, skip defensas del objetivo
  // original — el subtotal es el daño crudo antes de defensas.
  const interceptorId = player.interceptedBy;
  const breakdown = computeHordeAttackBreakdown(damageBase, catalog, state.activePlayerId);
  const effectiveDamage = interceptorId ? breakdown.subtotal : breakdown.finalExhaustion;

  // D403: Limpiar interceptedBy si el daño quedó en 0 — si no, el flag persiste
  // y redirige incorrectamente el siguiente ataque de la Horda
  if (interceptorId && effectiveDamage === 0) {
    state = mapPlayerState(state, state.activePlayerId, p => ({
      ...p,
      interceptedBy: null,
    }));
  }

  // Valerys: si el dano fue interceptado, redirigir al interceptor
  if (interceptorId && effectiveDamage > 0) {
    const interceptor = state.players[interceptorId];
    if (interceptor) {
      // Limpiar la intercepcion del objetivo (el evento DAMAGE_INTERCEPTED ya se emitio en valerysAbility)
      state = mapPlayerState(state, state.activePlayerId, p => ({
        ...p,
        interceptedBy: null,
      }));
      // D372: Recalcular dano de la Horda usando las capacidades del interceptor
      // (Anti-Magia depende del heroe que recibe el dano, no del objetivo original).
      // Misma fuente única: desglose calculado contra el interceptor.
      const interceptorBreakdown = computeHordeAttackBreakdown(damageBase, catalog, interceptorId);
      const interceptorDamage = interceptorBreakdown.finalExhaustion;
      // BLOCK_NEXT_DAMAGE del interceptor consumido por el cálculo
      if (interceptorBreakdown.blockApplied > 0) {
        events.push({ type: 'BLOCK_CONSUMED', playerId: interceptorId, seq: nextSeq() });
      }
      if (interceptorDamage === 0) {
        // El interceptor bloquea todo el dano; pasar a Mercado
        // D434: sin daño recibido no hay Gloria de Valèrys (spec §6.8 liga la
        // Gloria a "tú recibes el daño")
        events.push({
          type: 'HORDE_ATTACKED',
          playerId: interceptorId,
          totalDamage: 0,
          seq: nextSeq(),
        });
        // D404: limpiar REACTION_WINDOW obsoletas al salir de HORDE_ATTACK —
        // incluido en cleanupHordeAttackEnd (mismo helper que el reducer).
        state = cleanupHordeAttackEnd(state);
        events.push({ type: 'EFFECTS_EXPIRED', scope: 'HORDE_ATTACK_END', seq: nextSeq() });
        events.push({
          type: 'PHASE_CHANGED',
          phase: 'MARKET',
          seq: nextSeq(),
        });
        return { state, events };
      }
      // El ataque se registra contra el interceptor con el daño real que
      // recibió (tras sus propias defensas), no contra el objetivo original.
      events.push({
        type: 'HORDE_ATTACKED',
        playerId: interceptorId,
        totalDamage: interceptorDamage,
        seq: nextSeq(),
      });
      // D434: Valèrys gana 1 Gloria al recibir el daño (spec §6.8) — se otorga
      // aqui, cuando el daño real se redirige, no al elegir objetivo
      events.push({
        type: 'GLORY_GAINED',
        playerId: interceptorId,
        amount: 1,
        seq: nextSeq(),
      });
      let remainingDamage = interceptorDamage;
      let currentDeck = [...interceptor.abilityDeck];
      let currentWear = [...interceptor.wearPile];
      let wounds = interceptor.wounds;
      const allLost: string[] = [];
      let pendingLost: string[] = [];

      while (remainingDamage > 0) {
        if (currentDeck.length === 0) {
          if (pendingLost.length > 0) {
            allLost.push(...pendingLost);
            events.push({
              type: 'CARDS_LOST',
              playerId: interceptorId,
              count: pendingLost.length,
              cardInstanceIds: pendingLost,
              seq: nextSeq(),
            });
            pendingLost = [];
          }
          // D351: Si no hay Desgaste que reciclar, el daño restante se ignora (sin herida)
          if (currentWear.length === 0) break;
          wounds++;
          events.push({
            type: 'DECK_EXHAUSTED',
            playerId: interceptorId,
            seq: nextSeq(),
          });
          events.push({
            type: 'HERO_WOUNDED',
            playerId: interceptorId,
            woundCount: wounds,
            seq: nextSeq(),
          });
          currentDeck = rng.shuffle([...currentWear]);
          currentWear = [];
          events.push({
            type: 'DECK_RESHUFFLED',
            playerId: interceptorId,
            newDeckSize: currentDeck.length,
            newOrder: currentDeck.map(c => c.instanceId),
            seq: nextSeq(),
          });
        }
        const lost = currentDeck.slice(0, remainingDamage).map(c => c.instanceId);
        pendingLost.push(...lost);
        const lostCards = currentDeck.slice(0, remainingDamage);
        currentWear = [...currentWear, ...lostCards.map(c => ({ ...c, zone: 'WEAR_PILE' as Zone }))];
        currentDeck = currentDeck.slice(lost.length);
        remainingDamage -= lost.length;
      }
      if (pendingLost.length > 0) {
        allLost.push(...pendingLost);
        events.push({
          type: 'CARDS_LOST',
          playerId: interceptorId,
          count: pendingLost.length,
          cardInstanceIds: pendingLost,
          seq: nextSeq(),
        });
      }
      // No pre-aplicar el estado del interceptor: los eventos (CARDS_LOST, HERO_WOUNDED,
      // DECK_RESHUFFLED) se aplicarán posteriormente via applyEvent en processPhases.
      // El objetivo no sufre perdida de cartas, pero hay que pasar a Mercado
      // D404: limpiar REACTION_WINDOW obsoletas al salir de HORDE_ATTACK —
      // incluido en cleanupHordeAttackEnd (mismo helper que el reducer).
      state = cleanupHordeAttackEnd(state);
      events.push({ type: 'EFFECTS_EXPIRED', scope: 'HORDE_ATTACK_END', seq: nextSeq() });
      events.push({
        type: 'PHASE_CHANGED',
        phase: 'MARKET',
        seq: nextSeq(),
      });
      return { state, events };
    }
  }

  // El dano se convierte en perdida de cartas del mazo
  // Si el mazo se agota, el heroe sufre una herida, recicla Desgaste y sigue
  events.push({
    type: 'HORDE_ATTACKED',
    playerId: state.activePlayerId,
    totalDamage: effectiveDamage,
    seq: nextSeq(),
  });
  // BLOCK_NEXT_DAMAGE: ya descontado en breakdown.finalExhaustion
  if (breakdown.blockApplied > 0) {
    events.push({ type: 'BLOCK_CONSUMED', playerId: state.activePlayerId, seq: nextSeq() });
  }
  if (effectiveDamage > 0) {
    let remainingDamage = effectiveDamage;
    let currentDeck = [...player.abilityDeck];
    let currentWear = [...player.wearPile];
    let wounds = player.wounds;
    const allLost: string[] = [];
    let pendingLost: string[] = []; // Cartas perdidas sin emitir aún

    while (remainingDamage > 0) {
      if (currentDeck.length === 0) {
        // Emitir CARDS_LOST pendientes antes del reciclaje (mover a wearPile del estado)
        if (pendingLost.length > 0) {
          events.push({
            type: 'CARDS_LOST',
            playerId: state.activePlayerId,
            count: pendingLost.length,
            cardInstanceIds: pendingLost,
            seq: nextSeq(),
          });
          allLost.push(...pendingLost);
          pendingLost = [];
        }
        // D351: Si no hay Desgaste que reciclar, el daño restante se ignora (sin herida)
        if (currentWear.length === 0) {
          break;
        }
        // Mazo agotado: herida + reciclar Desgaste
        wounds++;
        events.push({
          type: 'DECK_EXHAUSTED',
          playerId: state.activePlayerId,
          seq: nextSeq(),
        });
        events.push({
          type: 'HERO_WOUNDED',
          playerId: state.activePlayerId,
          woundCount: wounds,
          seq: nextSeq(),
        });
        // Reciclar Desgaste como nuevo mazo (barajado)
        currentDeck = rng.shuffle([...currentWear]);
        currentWear = [];
        events.push({
          type: 'DECK_RESHUFFLED',
          playerId: state.activePlayerId,
          newDeckSize: currentDeck.length,
          newOrder: currentDeck.map(c => c.instanceId),
          seq: nextSeq(),
        });
      }
      const lost = currentDeck.slice(0, remainingDamage).map(c => c.instanceId);
      pendingLost.push(...lost);
      // Las cartas perdidas van a Desgaste (actualizar currentWear para reciclajes futuros)
      const lostCards = currentDeck.slice(0, remainingDamage);
      currentWear = [...currentWear, ...lostCards.map(c => ({ ...c, zone: 'WEAR_PILE' as Zone }))];
      currentDeck = currentDeck.slice(lost.length);
      remainingDamage -= lost.length;
    }

    // Emitir CARDS_LOST pendientes finales
    if (pendingLost.length > 0) {
      allLost.push(...pendingLost);
      events.push({
        type: 'CARDS_LOST',
        playerId: state.activePlayerId,
        count: pendingLost.length,
        cardInstanceIds: pendingLost,
        seq: nextSeq(),
      });
    }

    if (allLost.length > 0) {
      // Ya se emitieron los CARDS_LOST arriba; no duplicar
    }
  }

  // Expirar modificadores de HORDE_ATTACK y resetear defensa tras el ataque.
  // D404: limpiar REACTION_WINDOW obsoletas al salir de HORDE_ATTACK —
  // incluido en cleanupHordeAttackEnd (mismo helper que el reducer).
  state = cleanupHordeAttackEnd(state);
  events.push({ type: 'EFFECTS_EXPIRED', scope: 'HORDE_ATTACK_END', seq: nextSeq() });

  // Pasar a Mercado
  events.push({
    type: 'PHASE_CHANGED',
    phase: 'MARKET',
    seq: nextSeq(),
  });

  return {
    state: { ...state, phase: 'MARKET' },
    events,
  };
}

// ============================================================================
// RESTORATION — ajustar mano y limpiar modificadores de turno
// ============================================================================

function processRestoration(
  state: GameState,
  rng: DeterministicRng,
  _catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const player = state.players[state.activePlayerId];

  // Descarte por encima de 4: el JUGADOR elige qué cartas descartar
  // (spec §3.6.1 — no es decisión del motor). Se pausa la fase hasta que
  // resuelva la elección 'restoration-discard-*' vía RESOLVE_CHOICE.
  if (player.hand.length > 4) {
    const choiceId = `restoration-discard-${state.activePlayerId}`;
    const already = state.pendingChoices.some(c => c.choiceId === choiceId);
    if (!already) {
      const excess = player.hand.length - 4;
      return {
        state: {
          ...state,
          pendingChoices: [...state.pendingChoices, {
            choiceId,
            playerId: state.activePlayerId,
            type: 'SELECT_CARD_FROM_HAND' as const,
            prompt: `Restablecimiento: descarta ${excess} carta(s) para quedarte con 4`,
            options: player.hand.map(c => c.instanceId),
            minSelections: excess,
            maxSelections: excess,
          }],
        },
        events,
      };
    }
  }

  // Guardar valores iniciales para el estado retornado
  // (los eventos transformaran estos valores al estado final)
  const initialHand = [...player.hand];
  const initialDeck = [...player.abilityDeck];
  const initialWearPile = [...player.wearPile];

  // Ajustar mano a 4 cartas (especificacion 3.6.1)
  // Si tiene menos de 4, robar hasta 4
  // Si tiene mas de 4, descartar las extras
  const newHand = [...player.hand];
  let newDeck = [...player.abilityDeck];
  let newWearPile = [...player.wearPile];

  // Descartar extras a Desgaste
  while (newHand.length > 4) {
    const card = newHand.pop()!;
    newWearPile.push({ ...card, zone: 'WEAR_PILE' as Zone });
    events.push({
      type: 'CARD_MOVED',
      cardInstanceId: card.instanceId,
      from: 'HAND' as Zone,
      to: 'WEAR_PILE' as Zone,
      playerId: player.playerId,
      seq: nextSeq(),
    });
  }

  while (newHand.length < 4 && newDeck.length > 0) {
    const card = newDeck[0];
    newDeck = newDeck.slice(1);
    newHand.push({ ...card, zone: 'HAND' as Zone });
    events.push({
      type: 'CARDS_DRAWN',
      playerId: state.activePlayerId,
      count: 1,
      cardInstanceIds: [card.instanceId],
      seq: nextSeq(),
    });
  }

  // Si el mazo se agota al robar, reciclar desgaste barajando y herir
  if (newHand.length < 4 && newDeck.length === 0 && newWearPile.length > 0) {
    events.push({
      type: 'DECK_EXHAUSTED',
      playerId: state.activePlayerId,
      seq: nextSeq(),
    });
    events.push({
      type: 'HERO_WOUNDED',
      playerId: state.activePlayerId,
      woundCount: player.wounds + 1,
      seq: nextSeq(),
    });
    // Barajar el desgaste antes de reciclar (especificacion: mazo como vida)
    const shuffledWear = rng.shuffle(newWearPile);
    const newOrder = shuffledWear.map(c => c.instanceId);
    events.push({
      type: 'DECK_RESHUFFLED',
      playerId: state.activePlayerId,
      newDeckSize: shuffledWear.length,
      newOrder,
      seq: nextSeq(),
    });
    newDeck = shuffledWear.map(c => ({ ...c, zone: 'ABILITY_DECK' as Zone }));
    newWearPile = [];
    while (newHand.length < 4 && newDeck.length > 0) {
      const card = newDeck[0];
      newDeck = newDeck.slice(1);
      newHand.push({ ...card, zone: 'HAND' as Zone });
      events.push({
        type: 'CARDS_DRAWN',
        playerId: state.activePlayerId,
        count: 1,
        cardInstanceIds: [card.instanceId],
        seq: nextSeq(),
      });
    }
  }

  // Limpiar modificadores de fin de turno
  // Nota: hand/abilityDeck/wearPile se retornan con valores iniciales
  // para que applyEvent(CARDS_MOVED/CARDS_DRAWN/DECK_RESHUFFLED) los transforme correctamente
  const newPlayers = {
    ...state.players,
    [state.activePlayerId]: {
      ...player,
      hand: initialHand,
      abilityDeck: initialDeck,
      wearPile: initialWearPile,
    },
  };

  // Limpiezas del Restablecimiento — defensas del héroe activo, daño de
  // enemigos rehabilitado, estados UNTIL_END_OF_TURN caducados y heridas de
  // TEMPORARY_WOUNDS descartadas (spec §3.6). Mismo helper que el reducer de
  // EFFECTS_EXPIRED: el fold del eventLog reproduce exactamente este estado.
  const cleaned = cleanupRestoration({
    ...state,
    players: newPlayers,
    phase: 'BATTLEFIELD_REPLENISHMENT',
  });

  events.push({ type: 'EFFECTS_EXPIRED', scope: 'RESTORATION', seq: nextSeq() });
  events.push({
    type: 'PHASE_CHANGED',
    phase: 'BATTLEFIELD_REPLENISHMENT',
    seq: nextSeq(),
  });

  return {
    state: cleaned,
    events,
  };
}

// ============================================================================
// BATTLEFIELD_REPLENISHMENT — reponer enemigos derrotados
// ============================================================================

function processBattlefieldReplenishment(
  state: GameState,
  _rng: DeterministicRng,
  catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  // D354: Si el campo está vacío, primero hacer transición de escenario
  // (descartar el actual y revelar uno nuevo), y LUEGO reponer enemigos.
  // La spec dice: cuando el campo queda vacío, se descarta el escenario actual
  // y se revela uno nuevo antes de robar nuevos enemigos.
  if (state.battlefield.length === 0 && state.scenarioDeck.length > 0 && !state.warlordRevealed) {
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
      scenario: {
        instanceId: newScenario.instanceId,
        definitionId: newScenario.definitionId,
        ownerId: newScenario.ownerId,
        zone: 'SCENARIO_ACTIVE' as const,
      } as any,
      scenarioDeck: state.scenarioDeck.slice(1),
      scenarioCoins: state.mode === 'SOLO' ? 1 : 0,
    };

    // Aplicar efectos del nuevo escenario a los enemigos actuales (campo vacío = no hay)
    const scenarioResult = applyScenarioEffects(state, newScenario.definitionId, catalog);
    state = scenarioResult.state;
    events.push(...scenarioResult.events);
  }

  // Reponer enemigos segun especificacion 3.6.2:
  // 0 enemigos → robar 3
  // 1-2 enemigos → robar 1
  // 3 enemigos → no robar
  // El Señor de la Guerra cuenta como un enemigo normal para la reposición
  const currentCount = state.battlefield.length;
  let needed: number;
  if (currentCount === 0) {
    needed = 3;
  } else if (currentCount <= 2) {
    needed = 1;
  } else {
    needed = 0;
  }

  let newHordeDeck = [...state.hordeDeck];
  let newBattlefield = [...state.battlefield];

  for (let i = 0; i < needed && newHordeDeck.length > 0; i++) {
    // Robar desde la parte inferior del mazo (especificacion 3.2.5)
    const enemyCard = newHordeDeck[newHordeDeck.length - 1];
    newHordeDeck = newHordeDeck.slice(0, -1);

    const enemyDef = catalog.byId.get(enemyCard.definitionId);
    if (!enemyDef) continue;

    const enemy: EnemyState = {
      instanceId: enemyCard.instanceId,
      definitionId: enemyCard.definitionId,
      baseFortitude: enemyDef.printedFortitude ?? 1,
      wounds: 0,
      reward: enemyDef.reward ?? null,
      modifiers: [],
      isWarlord: enemyDef.type === 'WARLORD',
      isOrc: enemyDef.isOrc ?? false,
      specialIcons: enemyDef.specialIcons ?? [],
      damageDisabled: false,
    };

    // Ruinas de Brunmar: aplicar -1 fortaleza a enemigos revelados mientras el escenario esté activo
    if (state.scenario?.definitionId === 'scenario.brunmar-ruins') {
      enemy.modifiers.push({
        id: `scenario-brunmar-${nextSeq()}`,
        sourceId: state.scenario.instanceId,
        layer: 'FORTITUDE_MODIFIERS',
        timestamp: nextSeq(),
        duration: 'WHILE_SOURCE_ACTIVE',
        amount: -1,
      });
    }

    // Roghkiller: +1 fortaleza a cada orco mientras esté vivo en el campo
    // D374: Solo excluir al propio Roghkiller, no a todos los Warlords orcos
    // D402: Usar newBattlefield (incluye enemigos revelados en iteraciones previas del bucle)
    // D428: identificar Roghkiller por definitionId estable
    const roghkillerInField = newBattlefield.some(e =>
      e.isWarlord && e.definitionId === 'warlord.roghkiller'
    );
    const roghkillerInstanceId = newBattlefield.find(e =>
      e.isWarlord && e.definitionId === 'warlord.roghkiller'
    )?.instanceId;
    if (roghkillerInField && enemy.isOrc && enemy.instanceId !== roghkillerInstanceId) {
      enemy.modifiers.push({
        id: `roghkiller-${nextSeq()}`,
        sourceId: 'roghkiller',
        layer: 'FORTITUDE_MODIFIERS',
        timestamp: nextSeq(),
        duration: 'WHILE_SOURCE_ACTIVE',
        amount: 1,
      });
    }

    newBattlefield.push(enemy);

    events.push({
      type: 'ENEMY_REVEALED',
      enemyInstanceId: enemy.instanceId,
      definitionId: enemy.definitionId,
      fortitude: enemy.baseFortitude,
      // EnemyState completo: el reducer lo inserta en el campo durante el
      // fold del eventLog (auras de entrada ya incluidas en `enemy`).
      enemy,
      seq: nextSeq(),
    });

    // Si es un Señor de la Guerra, marcarlo como revelado
    if (enemy.isWarlord) {
      events.push({
        type: 'WARLORD_REVEALED',
        warlordInstanceId: enemy.instanceId,
        definitionId: enemy.definitionId,
        seq: nextSeq(),
      });
      // Especificacion 3.4: al entrar el Señor de la Guerra,
      // el Escenario activo se descarta y no se reemplaza
      if (state.scenario) {
        // D434 (spec §4.2): la moneda del ULTIMO escenario se recoge al
        // finalizar la partida, no ahora — scenarioCoins se conserva para
        // el recuento (applyEvent la preserva porque warlordRevealed=true)
        events.push({
          type: 'SCENARIO_DISCARDED',
          scenarioInstanceId: state.scenario.instanceId,
          seq: nextSeq(),
        });
        // Limpiar efectos continuos del escenario descartado
        const clearResult = clearScenarioEffects(state, state.scenario.definitionId);
        state = clearResult.state;
        // Marcar escenario como descartado para que el filtro de modificadores funcione
        state = { ...state, scenario: null };
      }
      // Pericia de Roghkiller: +1 fortaleza a cada orco ya en el campo
      // D374: Solo excluir al propio Roghkiller, no a todos los Warlords orcos
      // D428: identificar por definitionId estable
      if (enemy.definitionId === 'warlord.roghkiller') {
        newBattlefield = newBattlefield.map(e => {
          if (e.isOrc && e.instanceId !== enemy.instanceId) {
            return {
              ...e,
              modifiers: [
                ...e.modifiers,
                {
                  id: `roghkiller-${nextSeq()}`,
                  sourceId: 'roghkiller',
                  layer: 'FORTITUDE_MODIFIERS',
                  timestamp: nextSeq(),
                  duration: 'WHILE_SOURCE_ACTIVE' as const,
                  amount: 1,
                },
              ],
            };
          }
          return e;
        });
      }
    }
  }

  // D434 (spec §6.9 nota Brunmar + caso limite 9): un enemigo que entra bajo
  // Ruinas de Brunmar con Fortaleza efectiva 0 queda derrotado inmediatamente
  {
    let checkState: GameState = { ...state, hordeDeck: newHordeDeck, battlefield: newBattlefield };
    for (const ev of checkFortitudeDefeats(checkState, state.activePlayerId, nextSeq)) {
      events.push(ev);
      checkState = applyEvent(checkState, ev);
    }
    // Propagar TODOS los campos (players, warlordDefeated, warlordsDefeatedCount)
    state = checkState;
    newBattlefield = checkState.battlefield;
  }

  events.push({
    type: 'PHASE_CHANGED',
    phase: 'SCENARIO_TRANSITION',
    seq: nextSeq(),
  });

  return {
    state: {
      ...state,
      hordeDeck: newHordeDeck,
      battlefield: newBattlefield.map(e => ({
        ...e,
        // Limpiar modificadores de escenario (Brunmar) si el escenario fue descartado
        modifiers: state.scenario === null
          ? e.modifiers.filter(m => !m.id?.startsWith('scenario-'))
          : e.modifiers,
      })),
      phase: 'SCENARIO_TRANSITION',
    },
    events,
  };
}

// ============================================================================
// SCENARIO_TRANSITION — cambiar de escenario si el campo esta vacio
// ============================================================================

function processScenarioTransition(
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
// TURN_END — finalizar turno y pasar al siguiente jugador
// ============================================================================

function processTurnEnd(
  state: GameState,
  _rng: DeterministicRng,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  events.push({
    type: 'TURN_ENDED',
    playerId: state.activePlayerId,
    seq: nextSeq(),
  });

  // La expiración de modificadores UNTIL_END_OF_TURN (Piedra de Amolar,
  // Puerto de Eque, Flecha Corrosiva) y el reseteo de flags de Apoyo se hacen
  // via cleanupTurnEnd al final — mismo helper que el reducer de EFFECTS_EXPIRED.
  const player = state.players[state.activePlayerId];
  if (player) {
    // D349/D363: Devolver cartas robadas de Apoyo según spec §4.2:
    // - Carta USADA → devolver al fondo de su mazo de origen (sea cual sea
    //   su zona: Desgaste, frente al jugador, etc.)
    // - Carta NO USADA (sigue en mano) → se descarta. Es carta del mazo de
    //   Apoyo: NO va al Desgaste del jugador (contaminaría su mazo al
    //   reciclar). Sale del juego hacia el Desgaste del héroe de Apoyo.
    const borrowedIds = player.borrowedSupportCardIds ?? [];
    if (borrowedIds.length > 0) {
      const usedDeckIndex = player.supportDeckIndexUsedThisTurn ?? null;
      // Cartas USADAS: en Desgaste o frente al jugador (Trampa) → al fondo
      // de su mazo de Apoyo de origen
      const usedBorrowed = usedDeckIndex !== null
        ? [
            ...player.wearPile.filter(c => borrowedIds.includes(c.instanceId)),
            ...(player.persistentCards ?? []).filter(c => borrowedIds.includes(c.instanceId)),
          ]
        : [];
      const cleanedWearPile = player.wearPile.filter(c => !borrowedIds.includes(c.instanceId));
      const cleanedPersistent = (player.persistentCards ?? []).filter(c => !borrowedIds.includes(c.instanceId));
      // Cartas NO USADAS: siguen en la mano → descartar fuera del juego.
      // Defensivo: si no hay mazo de Apoyo registrado, las prestadas en
      // cualquier zona salen del juego (no contaminan el mazo del jugador).
      const unusedBorrowed = usedDeckIndex !== null
        ? player.hand.filter(c => borrowedIds.includes(c.instanceId))
        : [
            ...player.hand.filter(c => borrowedIds.includes(c.instanceId)),
            ...player.wearPile.filter(c => borrowedIds.includes(c.instanceId)),
            ...(player.persistentCards ?? []).filter(c => borrowedIds.includes(c.instanceId)),
          ];
      const cleanedHand = player.hand.filter(c => !borrowedIds.includes(c.instanceId));
      for (const c of unusedBorrowed) {
        events.push({
          type: 'CARD_REMOVED_FROM_GAME',
          cardInstanceId: c.instanceId,
          seq: nextSeq(),
        });
      }
      // D434: emitir CARD_MOVED para las usadas devueltas al mazo de Apoyo —
      // en replay, applyEvent las redirige al mazo de origen via
      // borrowedSupportCardIds + supportDeckIndexUsedThisTurn
      for (const c of usedBorrowed) {
        const fromZone = player.wearPile.some(w => w.instanceId === c.instanceId)
          ? 'WEAR_PILE' as const
          : 'IN_FRONT_OF_PLAYER' as const;
        events.push({
          type: 'CARD_MOVED',
          cardInstanceId: c.instanceId,
          from: fromZone,
          to: 'ABILITY_DECK',
          seq: nextSeq(),
        });
      }
      state = mapPlayerState(state, state.activePlayerId, p => ({
        ...p,
        hand: cleanedHand,
        wearPile: cleanedWearPile,
        persistentCards: cleanedPersistent,
        supportDecks: usedDeckIndex !== null
          ? p.supportDecks.map((d, i) =>
              i === usedDeckIndex ? [...d, ...usedBorrowed.map(c => ({ ...c, zone: 'ABILITY_DECK' as Zone }))] : d
            )
          : p.supportDecks,
        borrowedSupportCardIds: [],
        supportCardUsedThisTurn: false,
      }));
    }
  }

  // Expirar modificadores UNTIL_END_OF_TURN (jugadores y enemigos) y resetear
  // flags de Apoyo — event-sourced para que el fold del eventLog converja.
  // Va DESPUÉS de los CARD_MOVED/CARD_REMOVED de cartas prestadas: su
  // redirección al mazo de Apoyo depende de borrowedSupportCardIds.
  state = cleanupTurnEnd(state);
  events.push({ type: 'EFFECTS_EXPIRED', scope: 'TURN_END', seq: nextSeq() });

  // Pas al siguiente jugador (saltando jugadores eliminados)
  const currentIndex = state.playerOrder.indexOf(state.activePlayerId);
  // Filtrar jugadores no eliminados (wounds < maxWounds)
  const alivePlayers = state.playerOrder.filter(id => {
    const p = state.players[id];
    return p && p.wounds < (p.maxWounds ?? 3);
  });
  // Si no quedan jugadores vivos, el GAME_END_CHECK detectará derrota colectiva
  const playerList = alivePlayers.length > 0 ? alivePlayers : state.playerOrder;
  const aliveIndex = playerList.indexOf(state.activePlayerId);
  // Si el jugador actual ya no está vivo, buscar el siguiente desde el inicio
  const searchStart = aliveIndex >= 0 ? aliveIndex + 1 : 0;
  let nextIndex = searchStart % playerList.length;
  // Avanzar hasta encontrar un jugador distinto o volver al inicio
  if (playerList[nextIndex] === state.activePlayerId && playerList.length > 1) {
    nextIndex = (nextIndex + 1) % playerList.length;
  }
  const nextPlayerId = playerList[nextIndex];
  // Determinar si el turno incrementa: si el siguiente jugador está antes en el orden original
  const nextOriginalIndex = state.playerOrder.indexOf(nextPlayerId);
  const newTurnNumber = state.turnNumber + (nextOriginalIndex <= currentIndex ? 1 : 0);

  events.push({
    type: 'PHASE_CHANGED',
    phase: 'GAME_END_CHECK',
    seq: nextSeq(),
  });

  return {
    state: {
      ...state,
      phase: 'GAME_END_CHECK',
      activePlayerId: nextPlayerId,
      turnNumber: newTurnNumber,
    },
    events,
  };
}

// ============================================================================
// GAME_END_CHECK — comprobar si la partida ha terminado
// ============================================================================

function processGameEndCheck(
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
    // Recuento de Gloria
    // Recuento de Gloria (especificacion 3.8):
    // 1. Fichas de Gloria acumuladas (ya incluyen Gloria de trofeos
    //    porque applyEvent la suma al derrotar enemigos)
    // 2. 1 Gloria por cada 3 Monedas
    // 3. Tenaz: +1 Gloria si llegas al final sin Heridas
    const scores: Record<string, number> = {};
    const trophyCounts: Record<string, number> = {};
    for (const playerId of state.playerOrder) {
      const player = state.players[playerId];
      let total = player.glory;
      // 1 Gloria por cada 3 Monedas
      total += Math.floor(player.coins / 3);
      // Tenaz: +1 si sin Heridas
      if (player.wounds === 0) {
        total += 1;
      }
      scores[playerId] = total;
      trophyCounts[playerId] = player.trophies.length;
    }

    // Determinar ganador (mas Gloria)
    // Empate: gana el jugador con mas cartas de enemigos derrotados (especificacion 3.8)
    let winnerId: string | null = null;
    let maxGlory = -1;
    for (const playerId of state.playerOrder) {
      const glory = scores[playerId];
      if (glory > maxGlory) {
        maxGlory = glory;
        winnerId = playerId;
      } else if (glory === maxGlory && winnerId !== null) {
        // Desempate por trofeos
        if (trophyCounts[playerId] > trophyCounts[winnerId]) {
          winnerId = playerId;
        }
      }
    }

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
            ...state.pendingChoices,
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

