/**
 * Handlers de flujo: condicionales, repeticiones, listeners, estados y variables.
 * Extraido de registry.ts (split por dominio).
 */

import type {
  TargetSelector,
  GameState,
  GameEvent,
  ResolutionContext,
} from '@nt4h/schema';
import { applyEvent } from '../../events/applyEvent.js';
import { getEffectiveFortitude } from '../../modifiers/index.js';
import {
  evalValue,
  resolveTarget,
  evalCondition,
  ResolutionBudgetError,
  type EffectRegistry,
} from '../registry.js';

export function registerControlEffects(registry: EffectRegistry): void {

  /** Todos los instanceIds que resuelve un selector (ALL_ENEMIES itera). */
  const resolveEnemyIds = (
    selector: TargetSelector,
    ctx: ResolutionContext,
    state: GameState,
  ): string[] => {
    if (selector.kind === 'ALL_ENEMIES') {
      const f = selector.filter;
      return state.battlefield
        .filter(e => {
          if (!f) return true;
          if (f.minFortitude !== undefined && getEffectiveFortitude(e, state) < f.minFortitude) return false;
          if (f.isOrc !== undefined && e.isOrc !== f.isOrc) return false;
          if (f.isWarlord !== undefined && e.isWarlord !== f.isWarlord) return false;
          return true;
        })
        .map(e => e.instanceId);
    }
    const id = resolveTarget(selector, ctx, state);
    return id ? [id] : [];
  };

  // --- Dano ---
  registry.register('ON_ENEMY_DEFEATED', (eff: any, ctx, state, rng, eventBus) => {
    // ON_ENEMY_DEFEATED: efecto condicional al derrotar un enemigo.
    // Evalúa condition.fortitudeGte contra la fortaleza del enemigo derrotado.
    const condition = eff.condition as { fortitudeGte?: number } | undefined;
    const innerEffects = eff.effects as any[] | undefined;
    if (!innerEffects || innerEffects.length === 0) return [];

    // ctx.lastDefeatedEnemyFortitude se establece desde el resolver
    const enemyFortitude = (ctx as any).lastDefeatedEnemyFortitude ?? 0;
    if (condition?.fortitudeGte !== undefined && enemyFortitude < condition.fortitudeGte) {
      return [];
    }

    // Ejecutar los efectos internos pasando rng y eventBus
    const events: GameEvent[] = [];
    for (const innerEff of innerEffects) {
      const innerEvents = registry.execute(innerEff, ctx, state, rng, eventBus);
      events.push(...innerEvents);
    }
    return events;
  });
  registry.register('CONDITIONAL', (eff, ctx, state, rng, bus) => {
    if (evalCondition(eff.condition, ctx, state)) {
      return eff.then.flatMap(e => registry.execute(e, ctx, state, rng, bus));
    }
    return eff.else?.flatMap(e => registry.execute(e, ctx, state, rng, bus)) ?? [];
  });
  registry.register('REPEAT', (eff, ctx, state, rng, bus) => {
    const times = Math.min(Math.max(0, evalValue(eff.times, ctx, state)), eff.max);
    const events: GameEvent[] = [];
    for (let i = 0; i < times; i++) {
      for (const inner of eff.effects) {
        events.push(...registry.execute(inner, ctx, state, rng, bus));
      }
    }
    return events;
  });
  registry.register('CHOOSE_ONE', (_eff, _ctx, _state) => []);

  // --- Enemigos ---
  registry.register('DISABLE_ENEMY_DAMAGE', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    return [{
      type: 'ENEMY_DAMAGE_DISABLED',
      enemyInstanceId: targetId,
      duration: eff.duration,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('ON_DEFEAT', (_eff, _ctx, _state) => []);

  // ON_HORDE_ATTACK: los efectos reactivos al ataque de la Horda
  // se procesan via EventBus. Este handler es un no-op.
  registry.register('ON_HORDE_ATTACK', (_eff, _ctx, _state) => []);

  // MODIFY_DAMAGE: anade un modificador de dano al jugador activo
  // (ej: Piedra de Amolar: +1 al dano de cartas este turno)
  registry.register('MODIFY_DAMAGE', (eff, ctx, state) => {
    const amount = evalValue(eff.modifier, ctx, state);
    return [{
      type: 'MODIFIER_ADDED',
      modifierId: `dmg-mod-${registry.nextSeq()}`,
      targetId: ctx.activePlayerId,
      layer: 'DAMAGE_BONUS',
      amount,
      scope: eff.scope,
      filter: eff.filter,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('FOR_EACH', (eff, ctx, state, rng, bus) => {
    const items: { enemyId?: string; heroId?: string }[] =
      eff.collection === 'ENEMIES'
        ? state.battlefield.map(e => ({ enemyId: e.instanceId }))
        : eff.collection === 'ALL_HEROES'
          ? state.playerOrder.map(id => ({ heroId: id }))
          : state.playerOrder
              .filter(id => id !== ctx.activePlayerId)
              .map(id => ({ heroId: id }));
    const events: GameEvent[] = [];
    const savedEnemy = ctx.selectedEnemyId;
    const savedHero = ctx.forEachHeroId;
    // Estado de trabajo: los eventos de cada efecto interno se aplican
    // incrementalmente — si una iteración elimina/mueve un enemigo, la
    // siguiente no opera sobre el snapshot obsoleto del inicio.
    let work = state;
    for (const item of items) {
      // Saltar elementos que ya no están en la colección (derrotados,
      // devueltos a la Horda, héroes eliminados…) en iteraciones previas.
      if (item.enemyId && !work.battlefield.some(e => e.instanceId === item.enemyId)) continue;
      if (item.heroId && !work.playerOrder.includes(item.heroId)) continue;
      if (item.enemyId) ctx.selectedEnemyId = item.enemyId;
      if (item.heroId) ctx.forEachHeroId = item.heroId;
      for (const inner of eff.effects) {
        const innerEvents = registry.execute(inner, ctx, work, rng, bus);
        events.push(...innerEvents);
        for (const ev of innerEvents) work = applyEvent(work, ev);
      }
    }
    ctx.selectedEnemyId = savedEnemy;
    ctx.forEachHeroId = savedHero;
    return events;
  });
  registry.register('APPLY_STATUS', (eff, ctx, state) => {
    const stacks = Math.max(1, evalValue(eff.stacks, ctx, state));
    const targetIds = resolveEnemyIds(eff.target, ctx, state);
    return targetIds.map(enemyInstanceId => ({
      type: 'STATUS_APPLIED' as const,
      enemyInstanceId,
      status: eff.status,
      stacks,
      duration: eff.duration ?? 'PERMANENT',
      seq: registry.nextSeq(),
    }));
  });
  registry.register('REMOVE_STATUS', (eff, ctx, state) => {
    const targetIds = resolveEnemyIds(eff.target, ctx, state);
    return targetIds.map(enemyInstanceId => ({
      type: 'STATUS_REMOVED' as const,
      enemyInstanceId,
      status: eff.status,
      seq: registry.nextSeq(),
    }));
  });
  registry.register('INCREASE_STATUS', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    if (amount === 0) return [];
    const targetIds = resolveEnemyIds(eff.target, ctx, state);
    return targetIds.map(enemyInstanceId => ({
      type: 'STATUS_APPLIED' as const,
      enemyInstanceId,
      status: eff.status,
      stacks: amount,
      seq: registry.nextSeq(),
    }));
  });
  registry.register('SET_VARIABLE', (eff, ctx, state) => {
    const value = evalValue(eff.value, ctx, state);
    if ((eff.scope ?? 'RESOLUTION') === 'GAME') {
      return [{ type: 'VARIABLE_SET' as const, name: eff.name, value, seq: registry.nextSeq() }];
    }
    ctx.variables = { ...(ctx.variables ?? {}), [eff.name]: value };
    return [];
  });
  registry.register('TRY_EFFECT', (eff, ctx, state, rng, bus) => {
    try {
      return eff.effects.flatMap(inner => registry.execute(inner, ctx, state, rng, bus));
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      const failed = err instanceof ResolutionBudgetError
        ? [{ type: 'RESOLUTION_HALTED' as const, cardInstanceId: ctx.currentCardInstanceId, reason: err.message, seq: registry.nextSeq() }]
        : [];
      // El fallback también está protegido: si el presupuesto ya se agotó,
      // no ejecuta nada pero tampoco propaga una segunda excepción.
      const fallback = (eff.onFailure ?? []).flatMap(inner => {
        try {
          return registry.execute(inner, ctx, state, rng, bus);
        } catch {
          return [];
        }
      });
      return [...failed, ...fallback];
    }
  });
  registry.register('REGISTER_LISTENER', (eff, ctx) => {
    const listener = {
      id: `lis-${registry.nextSeq()}`,
      playerId: ctx.activePlayerId,
      trigger: eff.event,
      once: eff.once ?? false,
      duration: eff.duration ?? 'THIS_TURN',
      tag: eff.tag,
      effects: eff.effects,
    };
    return [{ type: 'LISTENER_REGISTERED' as const, listener, seq: registry.nextSeq() }];
  });
  registry.register('REMOVE_LISTENER', (eff, ctx, state) => {
    const mine = (state.listeners ?? [])
      .filter(l => l.tag === eff.tag && l.playerId === ctx.activePlayerId);
    return mine.map(l => ({
      type: 'LISTENER_REMOVED' as const, listenerId: l.id, seq: registry.nextSeq(),
    }));
  });
}
