/** Disparadores y resolucion del ataque de la Horda. */

import type {
  GameEvent,
  GameState,
  Zone,
} from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import type { DeterministicRng } from '../../rng/index.js';
import { computeHordeAttackBreakdown } from '../../analysis/hordeBreakdown.js';
import { applyEvent, mapPlayerState } from '../../events/applyEvent.js';
import { cleanupHordeAttackEnd, getEffectiveFortitude } from '../../modifiers/index.js';
import { nextSeq } from '../../seq.js';

export function processHordeAttack(
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
