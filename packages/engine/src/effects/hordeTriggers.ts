/**
 * processHordeAttackTriggers — disparadores reactivos ON_HORDE_ATTACK (Trampa).
 * Extraido de resolver.ts.
 */

import type {
  GameState,
  GameEvent,
  PendingChoice,
  ResolutionContext,
} from '@nt4h/schema';
import type { DeterministicRng } from '../rng/index.js';
import type { EffectRegistry } from './registry.js';
import type { CatalogLoadResult } from '@nt4h/catalog';
import { EventBus } from '../triggers/index.js';
import { getEffectiveFortitude } from '../modifiers/index.js';
import { onEnemyDefeated as scenarioOnEnemyDefeated } from '../scenarios/index.js';
import { nextSeq } from '../seq.js';
import { applyEventInline } from './resolver.js';

// ============================================================================
// Disparadores reactivos: ON_HORDE_ATTACK (Trampa)
// ============================================================================

export function processHordeAttackTriggers(
  state: GameState,
  rng: DeterministicRng,
  registry: EffectRegistry,
  catalog: CatalogLoadResult,
  chosenEnemyTarget?: string | null,
): { events: GameEvent[]; state: GameState; pendingChoice?: PendingChoice } {
  const events: GameEvent[] = [];
  let currentState = state;

  // Buscar cartas persistentes con trigger HORDE_ATTACK
  // D378: Solo se activan para el jugador activo (la Horda ataca al héroe activo)
  for (const playerId of [state.activePlayerId]) {
    const player = state.players[playerId];
    if (!player) continue;
    for (const persistentCard of player.persistentCards) {
      if (persistentCard.persistentTrigger !== 'HORDE_ATTACK') continue;

      const cardDef = catalog.byId.get(persistentCard.definitionId);
      if (!cardDef) continue;

      // Buscar el efecto PLACE_PERSISTENT y ejecutar sus efectos internos
      for (const effect of cardDef.effects) {
        if (effect.type !== 'PLACE_PERSISTENT') continue;

        // Detectar empate de Fortaleza máxima para Trampa (spec: el jugador elige)
        if (chosenEnemyTarget === undefined) {
          const innerEffects = (effect as any).effects ?? [];
          const hasMaxFortitudeTarget = innerEffects.some((e: any) =>
            e.target?.kind === 'ENEMY_WITH_MAX_FORTITUDE'
          );
          if (hasMaxFortitudeTarget && currentState.battlefield.length > 0) {
            const maxFort = Math.max(...currentState.battlefield.map(e => getEffectiveFortitude(e, currentState)));
            const tied = currentState.battlefield.filter(e => getEffectiveFortitude(e, currentState) === maxFort);
            if (tied.length > 1) {
              const tieChoice: PendingChoice = {
                choiceId: `trap-${nextSeq()}`,
                playerId,
                type: 'SELECT_ENEMY',
                prompt: `Trampa: elige el enemigo a derrotar (empate de Fortaleza ${maxFort})`,
                options: tied.map(e => e.instanceId),
                minSelections: 1,
                maxSelections: 1,
              };
              return { events, state: currentState, pendingChoice: tieChoice };
            }
          }
        }

        // La Trampa derrota al enemigo con mayor fortaleza
        const ctx: ResolutionContext = {
          activePlayerId: playerId,
          currentCardId: persistentCard.definitionId,
          currentCardName: cardDef.name,
          currentCardInstanceId: persistentCard.instanceId,
          selectedEnemyId: null,
          cardsPlayedThisTurn: {},
          cardsPlayedAgainstEnemy: {},
          drawnCardInstanceId: null,
          sourceZone: 'IN_FRONT_OF_PLAYER',
          enemiesDefeatedThisResolution: [],
          depth: 0,
          chosenEnemyTarget: chosenEnemyTarget ?? null,
        };

        // Ejecutar los efectos internos del PLACE_PERSISTENT (no el PLACE_PERSISTENT mismo)
        const innerEffects = (effect as any).effects ?? [];
        const bus = new EventBus(registry, rng);
        for (const innerEff of innerEffects) {
          const triggerEvents = registry.execute(innerEff, ctx, currentState, rng, bus);
          events.push(...triggerEvents);
          // Aplicar eventos al estado
          for (const ev of triggerEvents) {
            // Capturar enemigo ANTES de applyEventInline (que lo elimina del battlefield)
            const enemyBeforeApply = ev.type === 'ENEMY_DEFEATED'
              ? currentState.battlefield.find(e => e.instanceId === ev.enemyInstanceId)
              : null;
            currentState = applyEventInline(currentState, ev);
            // Si se emitió ENEMY_DEFEATED, invocar escenario
            if (ev.type === 'ENEMY_DEFEATED' && enemyBeforeApply && !ctx.enemiesDefeatedThisResolution.includes(ev.enemyInstanceId)) {
              ctx.enemiesDefeatedThisResolution.push(ev.enemyInstanceId);
              const scenarioDefId = currentState.scenario?.definitionId;
              if (scenarioDefId) {
                const enemy = enemyBeforeApply;
                if (enemy) {
                  const enemyFortitude = getEffectiveFortitude(enemy, currentState);
                  (ctx as any).lastDefeatedEnemyFortitude = enemyFortitude;
                  const scenarioEvents = scenarioOnEnemyDefeated(
                    currentState, scenarioDefId, ev.defeatingPlayerId, enemyFortitude, catalog,
                  );
                  events.push(...scenarioEvents);
                  for (const sev of scenarioEvents) {
                    currentState = applyEventInline(currentState, sev);
                  }
                }
              }
            }
          }
        }

        // Remover la carta persistente (se consume). Hay que aplicarlas
        // inline a currentState igual que los efectos internos: el camino
        // con empate (resolveChoice) usa `state` tal cual, sin re-aplicar
        // `events` — sin esto la trampa quedaba en juego y re-disparaba
        // en cada ataque de la Horda, divergiendo del fold del eventLog.
        const removalEvents: GameEvent[] = [
          {
            type: 'PERSISTENT_CARD_REMOVED',
            cardInstanceId: persistentCard.instanceId,
            seq: nextSeq(),
          },
          {
            type: 'CARD_REMOVED_FROM_GAME',
            cardInstanceId: persistentCard.instanceId,
            seq: nextSeq(),
          },
        ];
        events.push(...removalEvents);
        for (const rev of removalEvents) {
          currentState = applyEventInline(currentState, rev);
        }
      }
    }
  }

  // D402: devolver currentState (acumulado), no el state original de entrada
  return { events, state: currentState };
}

