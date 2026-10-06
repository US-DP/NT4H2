/**
 * Handlers de dano, escudos, estados defensivos y ejecucion de enemigos.
 * Extraido de registry.ts (split por dominio).
 */

import type {
  GameEvent,
  ResolutionContext,
  EnemyState,
} from '@nt4h/schema';
import { getEffectiveFortitude, getEnemyDamageBonus } from '../../modifiers/index.js';
import { applyDamageModifiers } from '../resolver.js';
import {
  evalValue,
  resolveTarget,
  resolveHeroTargets,
  applyHeroDamage,
  type EffectRegistry,
} from '../registry.js';

export function registerDamageEffects(registry: EffectRegistry): void {

  /** Bonus del estado 'mark': suma stacks al primer daño y consume la Marca. */
  const markBonusFor = (
    enemy: EnemyState | undefined,
    ctx: ResolutionContext,
  ): { bonus: number; events: GameEvent[] } => {
    if (!enemy) return { bonus: 0, events: [] };
    const marks = (enemy.statuses ?? []).filter(s => s.id === 'mark' && s.stacks > 0);
    if (marks.length === 0) return { bonus: 0, events: [] };
    const consumed = ctx.consumedMarks ?? (ctx.consumedMarks = []);
    if (consumed.includes(enemy.instanceId)) return { bonus: 0, events: [] };
    consumed.push(enemy.instanceId);
    return {
      bonus: marks.reduce((a, m) => a + m.stacks, 0),
      events: [{
        type: 'STATUS_REMOVED',
        enemyInstanceId: enemy.instanceId,
        status: 'mark',
        seq: registry.nextSeq(),
      }],
    };
  };

  registry.register('DEAL_DAMAGE', (eff, ctx, state) => {
    const baseAmount = evalValue(eff.amount, ctx, state);
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    // Modificadores de daño del jugador (MODIFY_DAMAGE: scope THIS_TURN /
    // NEXT_CARD) — igual que DEAL_DAMAGE_ALL_ENEMIES y el daño impreso.
    const player = state.players[ctx.activePlayerId];
    const amount = player ? applyDamageModifiers(baseAmount, ctx.currentCardName, player) : baseAmount;
    // Aplicar vulnerabilidad del enemigo (Flecha Corrosiva) + Marca consumible
    const enemy = state.battlefield.find(e => e.instanceId === targetId);
    const bonus = enemy ? getEnemyDamageBonus(enemy) : 0;
    const mark = markBonusFor(enemy, ctx);
    return [
      { type: 'DAMAGE_DEALT', targetId, amount: amount + bonus + mark.bonus, sourceCardInstanceId: ctx.currentCardInstanceId, seq: registry.nextSeq() },
      ...mark.events,
    ];
  });
  registry.register('DEAL_DAMAGE_ALL_ENEMIES', (eff, ctx, state) => {
    const baseAmount = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    const amount = player ? applyDamageModifiers(baseAmount, ctx.currentCardName, player) : baseAmount;
    const events: GameEvent[] = [];
    for (const e of state.battlefield) {
      const mark = markBonusFor(e, ctx);
      events.push({
        type: 'DAMAGE_DEALT' as const,
        targetId: e.instanceId,
        amount: amount + getEnemyDamageBonus(e) + mark.bonus,
        sourceCardInstanceId: ctx.currentCardInstanceId,
        seq: registry.nextSeq(),
      });
      events.push(...mark.events);
    }
    return events;
  });
  registry.register('DEAL_DAMAGE_SPLIT', (eff, ctx, state) => {
    // Repartir amount dano entre targetCount enemigos
    const baseAmount = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    const amount = player ? applyDamageModifiers(baseAmount, ctx.currentCardName, player) : baseAmount;
    const count = eff.targetCount;
    // Resolver target selector para seleccionar los enemigos concretos
    let targets: EnemyState[] = [];
    switch (eff.target.kind) {
      case 'ALL_ENEMIES':
        targets = state.battlefield.slice(0, count);
        break;
      case 'ONE_ENEMY':
      case 'SELECTED_ENEMY': {
        const selected = state.battlefield.find(e => e.instanceId === ctx.selectedEnemyId);
        targets = selected ? [selected] : [];
        break;
      }
      case 'ENEMY_WITH_MAX_FORTITUDE': {
        if (state.battlefield.length > 0) {
          const sorted = [...state.battlefield].sort((a, b) =>
            getEffectiveFortitude(b, state) - getEffectiveFortitude(a, state)
          );
          targets = sorted.slice(0, count);
        }
        break;
      }
      case 'ENEMY_WITH_FEWEST_WOUNDS': {
        if (state.battlefield.length > 0) {
          const sorted = [...state.battlefield].sort((a, b) => a.wounds - b.wounds);
          targets = sorted.slice(0, count);
        }
        break;
      }
      default:
        targets = state.battlefield.slice(0, count);
    }
    if (targets.length === 0) return [];
    // Usar targetCount (del catálogo) para calcular daño por target, no targets.length
    // Así "2 a 2 enemigos" (amount=4, targetCount=2) = 2 por enemigo, incluso si solo hay 1
    const divisor = count;
    const perTarget = Math.floor(amount / divisor);
    const remainder = amount % divisor;
    const events: GameEvent[] = [];
    targets.forEach((e, i) => {
      const mark = markBonusFor(e, ctx);
      events.push({
        type: 'DAMAGE_DEALT' as const,
        targetId: e.instanceId,
        amount: perTarget + (i < remainder ? 1 : 0) + getEnemyDamageBonus(e) + mark.bonus,
        sourceCardInstanceId: ctx.currentCardInstanceId,
        seq: registry.nextSeq(),
      });
      events.push(...mark.events);
    });
    return events;
  });
  registry.register('DEAL_DAMAGE_TO_HERO', (eff, ctx, state, rng) => {
    const amount = evalValue(eff.amount, ctx, state);
    const targets = resolveHeroTargets(eff.target, ctx, state);
    // El dano a heroes se convierte en perdida de cartas (con herida/reciclaje si mazo vacio)
    // La armadura reduce cada instancia de daño (GRANT_ARMOR)
    return targets.flatMap(targetId => {
      const effective = Math.max(0, amount - (state.players[targetId]?.armor ?? 0));
      return applyHeroDamage(targetId, effective, state, rng, () => registry.nextSeq());
    });
  });
  registry.register('DEAL_DAMAGE_TO_OTHER_HEROES', (eff, ctx, state, rng) => {
    const amount = evalValue(eff.amount, ctx, state);
    const others = state.playerOrder.filter(id => id !== ctx.activePlayerId);
    // D434 (spec §4.4): en solitario, una carta de Apoyo que dañe a "otros
    // heroes" solo hace efecto cuando se usa desde el mazo de Apoyo — y el
    // "otro heroe" es el propio jugador (la carta pertenece a otro heroe)
    const active = state.players[ctx.activePlayerId];
    const isBorrowed = active?.borrowedSupportCardIds?.includes(ctx.currentCardInstanceId ?? '') ?? false;
    const targets = others.length > 0
      ? others
      : (state.mode === 'SOLO' && isBorrowed ? [ctx.activePlayerId] : []);
    return targets.flatMap(targetId => {
      const effective = Math.max(0, amount - (state.players[targetId]?.armor ?? 0));
      return applyHeroDamage(targetId, effective, state, rng, () => registry.nextSeq());
    });
  });
  registry.register('PREVENT_DAMAGE', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    return [{
      type: 'PREVENTION_APPLIED',
      playerId: ctx.activePlayerId,
      amount,
      // La duración declarada gobierna cuándo caduca la prevención
      // (antes era un no-op: todo expiraba al fin del ataque de la Horda).
      duration: eff.duration,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('SHIELD', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    return [{
      type: 'SHIELD_PLACED',
      playerId: ctx.activePlayerId,
      amount,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('CANCEL_ALL_DAMAGE', (eff, ctx, _state) => {
    return [{
      type: 'CANCELLATION_ACTIVATED',
      playerId: ctx.activePlayerId,
      duration: eff.duration,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('PREVENT_ENEMY_DAMAGE', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    return [{
      type: 'ENEMY_DAMAGE_DISABLED',
      enemyInstanceId: targetId,
      // Igual que DISABLE_ENEMY_DAMAGE: la duración declarada manda
      // (PERMANENT sobrevive al primer ataque, etc.).
      duration: eff.duration,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('APPLY_VULNERABILITY', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    const bonus = evalValue(eff.bonus, ctx, state);
    return [{
      type: 'VULNERABILITY_APPLIED',
      enemyInstanceId: targetId,
      bonus,
      duration: eff.duration,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('DEFEAT_ENEMY', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    const enemy = state.battlefield.find(e => e.instanceId === targetId);
    if (!enemy) return [];

    // El laurel del frente (trofeo) siempre se cobra — incluso con loot:false
    // (Trampa solo pierde el BOTÍN del dorso). IGNORE_* solo suprimen el dorso.
    const reward = {
      coins: eff.loot && !state.ignoreCoinRewards ? (enemy.reward?.coins ?? 0) : 0,
      glory: (enemy.trophyGlory ?? 0) + (eff.loot && !state.ignoreGloryRewards ? (enemy.reward?.glory ?? 0) : 0),
    };
    return [{
      type: 'ENEMY_DEFEATED',
      enemyInstanceId: targetId,
      enemyDefinitionId: enemy.definitionId,
      defeatingPlayerId: ctx.activePlayerId,
      reward,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('MODIFY_FORTITUDE', (eff, ctx, state) => {
    const amount = evalValue(eff.modifier, ctx, state);
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    // sourceId es obligatorio: purgeWhileSourceActive limpia por la carta
    // que lo creó — sin él un modificador WHILE_SOURCE_ACTIVE quedaba
    // para siempre al alcanzarse por una ruta anidada (FOR_EACH, etc.).
    return [{
      type: 'MODIFIER_ADDED',
      modifierId: `fort-mod-${registry.nextSeq()}`,
      targetId,
      layer: 'FORTITUDE_MODIFIERS',
      amount,
      sourceId: ctx.currentCardInstanceId,
      duration: eff.duration,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('INTERCEPT_DAMAGE', (eff, ctx, state) => {
    // eff.from es un HeroSelector, no un string
    const fromIds = resolveHeroTargets(eff.from, ctx, state)
      .filter(id => id !== ctx.activePlayerId);
    if (fromIds.length === 0) return [];
    // E-4: un objetivo elegido explícitamente (chosenHeroTarget del comando
    // o de una REACTION_WINDOW) gana sobre "el primero de la lista" —
    // con varios héroes, interceptar a playerOrder[0] protegía al jugador
    // equivocado.
    const fromPlayerId =
      ctx.chosenHeroTarget && fromIds.includes(ctx.chosenHeroTarget)
        ? ctx.chosenHeroTarget
        : fromIds[0];
    return [{
      type: 'DAMAGE_INTERCEPTED',
      interceptorPlayerId: ctx.activePlayerId,
      originalTargetPlayerId: fromPlayerId,
      amount: 0, // Se actualiza con el dano real en el motor de fases
      seq: registry.nextSeq(),
    }];
  });
  registry.register('DEAL_DAMAGE_HITS', (eff, ctx, state) => {
    const times = Math.max(0, evalValue(eff.times, ctx, state));
    const baseRaw = evalValue(eff.amount, ctx, state);
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId || times === 0) return [];
    const enemy = state.battlefield.find(e => e.instanceId === targetId);
    // Mismos modificadores que DEAL_DAMAGE (MODIFY_DAMAGE): antes los
    // golpes múltiples ignoraban el bonus del jugador por completo.
    const dmgPlayer = state.players[ctx.activePlayerId];
    const base = dmgPlayer ? applyDamageModifiers(baseRaw, ctx.currentCardName, dmgPlayer) : baseRaw;
    const events: GameEvent[] = [];
    for (let i = 0; i < times; i++) {
      const mark = markBonusFor(enemy, ctx);
      events.push({
        type: 'DAMAGE_DEALT' as const,
        targetId,
        amount: base + (enemy ? getEnemyDamageBonus(enemy) : 0) + mark.bonus,
        sourceCardInstanceId: ctx.currentCardInstanceId,
        seq: registry.nextSeq(),
      });
      events.push(...mark.events);
    }
    return events;
  });
  registry.register('EXECUTE_ENEMY', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    const enemy = state.battlefield.find(e => e.instanceId === targetId);
    if (!enemy) return [];
    const threshold = evalValue(eff.threshold, ctx, state);
    if (getEffectiveFortitude(enemy, state) > threshold) return [];
    const reward = {
      coins: eff.loot !== false && !state.ignoreCoinRewards ? (enemy.reward?.coins ?? 0) : 0,
      glory: (enemy.trophyGlory ?? 0) + (eff.loot !== false && !state.ignoreGloryRewards ? (enemy.reward?.glory ?? 0) : 0),
    };
    return [{
      type: 'ENEMY_DEFEATED' as const,
      enemyInstanceId: targetId,
      enemyDefinitionId: enemy.definitionId,
      defeatingPlayerId: ctx.activePlayerId,
      reward,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('OVERKILL_DAMAGE', (eff, ctx, state) => {
    // applyDamageModifiers también aquí: el bonus de la carta alimenta
    // tanto el golpe como el cálculo de exceso (antes el spill se medía
    // con el daño base sin modificadores — inconsistente con el propio
    // DAMAGE_DEALT emitido).
    const dmgPlayer = state.players[ctx.activePlayerId];
    const rawAmount = evalValue(eff.amount, ctx, state);
    const amount = dmgPlayer ? applyDamageModifiers(rawAmount, ctx.currentCardName, dmgPlayer) : rawAmount;
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    const enemy = state.battlefield.find(e => e.instanceId === targetId);
    if (!enemy) return [];
    const mark = markBonusFor(enemy, ctx);
    // E-12: el exceso se mide sobre el daño REAL aplicado al objetivo
    // primario (base + bonus del enemigo + marcas) — medirlo solo con la
    // base desperdiciaba el exceso que los bonos generaban.
    const dealt = amount + getEnemyDamageBonus(enemy) + mark.bonus;
    const events: GameEvent[] = [{
      type: 'DAMAGE_DEALT' as const,
      targetId,
      amount: dealt,
      sourceCardInstanceId: ctx.currentCardInstanceId,
      seq: registry.nextSeq(),
    }, ...mark.events];
    const remaining = Math.max(0, getEffectiveFortitude(enemy, state) - enemy.wounds);
    const over = Math.max(0, dealt - remaining);
    if (over > 0) {
      const spillId = resolveTarget(eff.spill, ctx, state);
      if (spillId) {
        const spillEnemy = state.battlefield.find(e => e.instanceId === spillId);
        const spillMark = markBonusFor(spillEnemy, ctx);
        events.push({
          type: 'DAMAGE_DEALT' as const,
          targetId: spillId,
          amount: over + (spillEnemy ? getEnemyDamageBonus(spillEnemy) : 0) + spillMark.bonus,
          sourceCardInstanceId: ctx.currentCardInstanceId,
          seq: registry.nextSeq(),
        });
        events.push(...spillMark.events);
      }
    }
    return events;
  });
  registry.register('TAKE_WOUNDS', (eff, ctx, state) => {
    const amount = Math.max(0, evalValue(eff.amount, ctx, state));
    if (amount === 0) return [];
    const targets = resolveHeroTargets(eff.hero ?? { kind: 'SELF' }, ctx, state);
    return targets.map(playerId => ({
      type: 'HERO_WOUNDED' as const,
      playerId,
      woundCount: state.players[playerId].wounds + amount,
      seq: registry.nextSeq(),
    }));
  });
  registry.register('GRANT_ARMOR', (eff, ctx, state) => {
    const amount = Math.max(0, evalValue(eff.amount, ctx, state));
    return [{
      type: 'ARMOR_GRANTED' as const,
      playerId: ctx.activePlayerId,
      amount,
      duration: eff.duration,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('BLOCK_NEXT_DAMAGE', (eff, ctx, state) => {
    const amount = Math.max(0, evalValue(eff.amount, ctx, state));
    if (amount <= 0) return [];
    return [{ type: 'BLOCK_GRANTED' as const, playerId: ctx.activePlayerId, amount, seq: registry.nextSeq() }];
  });
}
