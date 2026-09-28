/**
 * listeners.ts — oyentes de eventos del Taller (REGISTER_LISTENER).
 *
 * Un oyente es un CardListener en GameState.listeners: {jugador dueño,
 * tipo de GameEvent que lo dispara, once, duración, tag, efectos}.
 *
 * Cuando el motor aplica un evento cuyo `type` coincide con el trigger,
 * el oyente resuelve sus efectos con el dueño como héroe activo y con
 * el objetivo del evento inferido (enemigo dañado/derrotado, jugador
 * herido…). Los eventos emitidos por oyentes NO vuelven a disparar
 * oyentes (no hay cascada) y comparten el presupuesto de operaciones.
 */

import type {
  GameState, GameEvent, ResolutionContext, CardListener,
} from '@nt4h/schema';
import type { DeterministicRng } from '../rng/index.js';
import type { EffectRegistry } from './registry.js';
import { MAX_RESOLUTION_OPS, ResolutionBudgetError } from './registry.js';
import { EventBus } from '../triggers/index.js';
import { applyEvent } from '../events/applyEvent.js';
import { onSeqReset } from '../seq.js';

export interface ListenerDeps {
  registry: EffectRegistry;
  rng: DeterministicRng;
  nextSeq: () => number;
}

/** Máximo de oyentes activables por evento (guarda anti-explosión). */
const MAX_LISTENERS_PER_EVENT = 16;

/** seqs de eventos que ya pasaron por dispatchListeners (o que emitieron
 *  oyentes). Los seqs son monotónicos globales por partida (seq.ts), así
 *  que el despacho es idempotente: el resolver/fases ya disparan oyentes
 *  por evento de efecto, y execute() completa la cobertura para eventos
 *  emitidos por comandos sin dispararlos dos veces. */
const dispatchedSeqs = new Set<number>();
onSeqReset(() => dispatchedSeqs.clear());

/** Deriva el contexto de resolución de un oyente desde el evento. */
function listenerCtx(listener: CardListener, event: GameEvent): ResolutionContext {
  const ev = event as Record<string, unknown>;
  const enemyId =
    (ev.enemyInstanceId as string | undefined) ??
    (ev.targetId as string | undefined) ??
    null;
  const ctx: ResolutionContext = {
    activePlayerId: listener.playerId,
    currentCardId: '',
    currentCardName: `Oyente (${listener.trigger})`,
    currentCardInstanceId: '',
    selectedEnemyId: enemyId,
    cardsPlayedThisTurn: {},
    cardsPlayedAgainstEnemy: {},
    drawnCardInstanceId: (ev.cardInstanceIds as string[] | undefined)?.[0] ?? null,
    sourceZone: 'HAND',
    enemiesDefeatedThisResolution: [],
    depth: 0,
    opsUsed: 0,
    defeatingPlayerId: (ev.defeatingPlayerId as string | undefined) ??
      (ev.playerId as string | undefined),
    // El daño del evento queda disponible como variable de resolución
    variables: typeof ev.amount === 'number' ? { event_amount: ev.amount } : {},
  };
  return ctx;
}

/**
 * Dispara los oyentes registrados que coinciden con `event.type`.
 * Devuelve los eventos producidos (incluyendo LISTENER_REMOVED para
 * oyentes `once`) y el estado resultante de aplicarlos.
 */
export function dispatchListeners(
  state: GameState,
  event: GameEvent,
  deps: ListenerDeps,
): { events: GameEvent[]; state: GameState } {
  // Idempotente por evento: un mismo seq nunca despacha oyentes dos veces.
  if (dispatchedSeqs.has(event.seq)) return { events: [], state };
  dispatchedSeqs.add(event.seq);
  const listeners = (state.listeners ?? [])
    .filter(l => l.trigger === event.type)
    .slice(0, MAX_LISTENERS_PER_EVENT);
  if (listeners.length === 0) return { events: [], state };

  const events: GameEvent[] = [];
  let current = state;
  const bus = new EventBus(deps.registry, deps.rng);
  bus.setState(current);

  // Presupuesto de operaciones COMPARTIDO entre todos los oyentes del
  // evento (no por oyente): 16 oyentes × MAX_RESOLUTION_OPS sería una
  // explosión de cómputo por cada evento disparado.
  let sharedOpsUsed = 0;

  for (const listener of listeners) {
    if (sharedOpsUsed >= MAX_RESOLUTION_OPS) break;
    // El oyente puede haberse retirado ya (once, REMOVE_LISTENER previo)
    if (!current.listeners?.some(l => l.id === listener.id)) continue;
    const ctx = listenerCtx(listener, event);
    ctx.opsUsed = sharedOpsUsed;
    try {
      for (const eff of listener.effects) {
        const inner = deps.registry.execute(eff, ctx, current, deps.rng, bus);
        for (const iev of inner) {
          events.push(iev);
          // Sin cascada: los eventos emitidos por oyentes no re-disparan
          // oyentes aunque vuelvan a pasar por dispatchListeners (p.ej. en
          // el pase de cobertura de execute()).
          dispatchedSeqs.add(iev.seq);
          current = applyEvent(current, iev);
        }
      }
    } catch (err) {
      if (err instanceof ResolutionBudgetError || err instanceof Error) {
        const halt: GameEvent = {
          type: 'RESOLUTION_HALTED',
          cardInstanceId: undefined,
          reason: `Oyente ${listener.id}: ${err.message}`,
          seq: deps.nextSeq(),
        };
        events.push(halt);
        dispatchedSeqs.add(halt.seq);
      } else {
        throw err;
      }
    } finally {
      sharedOpsUsed = ctx.opsUsed ?? sharedOpsUsed;
    }
    if (listener.once) {
      const rm: GameEvent = {
        type: 'LISTENER_REMOVED', listenerId: listener.id, seq: deps.nextSeq(),
      };
      events.push(rm);
      dispatchedSeqs.add(rm.seq);
      current = applyEvent(current, rm);
    }
  }
  return { events, state: current };
}
