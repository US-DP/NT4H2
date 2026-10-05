/**
 * EventBus — sistema de disparadores (triggers) para efectos reactivos.
 *
 * Cuando un evento ocurre (ej. ENEMY_DEFEATED), el bus busca todos los
 * listeners que coinciden, los ordena por prioridad y timestamp,
 * y encola sus efectos para resolucion.
 *
 * Limites de seguridad:
 * - MAX_EVENT_DEPTH: maximo numero de iteraciones de procesamiento.
 * - MAX_CHAIN_DEPTH: maxima profundidad de cadenas (Disparo Rapido).
 */

import type { GameEvent, GameState, CardEffect } from '@nt4h/schema';
import type { EffectRegistry } from '../effects/registry.js';
import type { DeterministicRng } from '../rng/index.js';

export interface TriggerListener {
  eventType: string;
  predicate: (event: GameEvent, state: GameState) => boolean;
  effects: CardEffect[];
  ownerId: string;
  timestamp: number;
  priority: number; // menor = mayor prioridad (activo < escenario < horda)
}

export const MAX_EVENT_DEPTH = 100;
export const MAX_CHAIN_DEPTH = 20;
export const MAX_EFFECT_RECURSION = 64;

// Prioridades
export const PRIORITY_ACTIVE_PLAYER = 10;
export const PRIORITY_OTHER_PLAYERS = 20;
export const PRIORITY_SCENARIO = 30;
export const PRIORITY_HORDE = 40;
export const PRIORITY_STATE_CHECKS = 50;

export class EventBus {
  private listeners: TriggerListener[] = [];
  private queue: GameEvent[] = [];
  private processing = false;
  private depth = 0;

  private registry: EffectRegistry;
  private rng: DeterministicRng;

  constructor(
    registry: EffectRegistry,
    rng: DeterministicRng,
  ) {
    this.registry = registry;
    this.rng = rng;
  }

  subscribe(listener: TriggerListener): void {
    this.listeners.push(listener);
  }

  unsubscribe(ownerId: string): void {
    this.listeners = this.listeners.filter(l => l.ownerId !== ownerId);
  }

  emit(event: GameEvent): void {
    this.queue.push(event);
    if (!this.processing) {
      this.process();
    }
  }

  private process(): void {
    this.processing = true;
    this.depth = 0;

    // try/finally: un throw (MAX_EVENT_DEPTH, error de handler) dejaba
    // `processing=true` para siempre y el bus entero envenenado — los
    // emits posteriores encolaban eventos que ya nadie procesaba.
    try {
      while (this.queue.length > 0) {
      this.depth++;
      if (this.depth > MAX_EVENT_DEPTH) {
        throw new Error(
          `EventBus: exceeded MAX_EVENT_DEPTH (${MAX_EVENT_DEPTH}). Possible infinite loop.`
        );
      }

      const event = this.queue.shift()!;
      // Guard antes del predicate: un emit() anterior a setState() se
      // evaluaba con `this.currentState!` (TypeError dentro del filtro).
      // `continue` drena la cola: sin estado los eventos no pueden
      // evaluarse y dejarlos encolados los dispararía sobre un estado
      // futuro equivocado.
      if (!this.currentState) continue;
      const triggered = this.listeners
        .filter(l => l.eventType === event.type)
        .filter(l => l.predicate(event, this.currentState!))
        .sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp);

      for (const listener of triggered) {
        // Ejecutar los efectos del listener via el registry
        // Los eventos resultantes se encolan para procesamiento recursivo
        if (this.currentState) {
          const ctx = {
            activePlayerId: this.currentState.activePlayerId,
            currentCardId: listener.ownerId,
            currentCardName: listener.ownerId,
            currentCardInstanceId: listener.ownerId,
            selectedEnemyId: null,
            cardsPlayedThisTurn: {},
            cardsPlayedAgainstEnemy: {},
            drawnCardInstanceId: null,
            sourceZone: 'IN_FRONT_OF_PLAYER' as const,
            enemiesDefeatedThisResolution: [],
            depth: this.depth,
          };
          for (const effect of listener.effects) {
            const triggeredEvents = this.registry.execute(
              effect, ctx, this.currentState, this.rng, this
            );
            for (const te of triggeredEvents) {
              this.queue.push(te);
            }
          }
        }
      }
      }
    } finally {
      this.processing = false;
    }
  }

  private currentState: GameState | null = null;

  setState(state: GameState): void {
    this.currentState = state;
  }

  clear(): void {
    this.listeners = [];
    this.queue = [];
    this.processing = false;
    this.depth = 0;
  }
}
