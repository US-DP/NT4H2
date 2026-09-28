/**
 * Handlers de gloria, monedas, curacion y costes de mercado.
 * Extraido de registry.ts (split por dominio).
 */

import type {
  GameEvent,
} from '@nt4h/schema';
import {
  evalValue,
  resolveHeroTargets,
  type EffectRegistry,
} from '../registry.js';

export function registerEconomyEffects(registry: EffectRegistry): void {
  registry.register('GAIN_GLORY', (eff, ctx, _state) => {
    const amount = evalValue(eff.amount, ctx, _state);
    return [{
      type: 'GLORY_GAINED',
      playerId: ctx.activePlayerId,
      amount,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('GAIN_COINS', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    // Resolver target: DEFEATING_HERO, SELF, o HeroSelector
    let targetIds: string[] = [ctx.activePlayerId];
    if (eff.target === 'DEFEATING_HERO') {
      targetIds = [ctx.defeatingPlayerId ?? ctx.activePlayerId];
    } else if (eff.target === 'SELF' || eff.target === undefined) {
      targetIds = [ctx.forEachHeroId ?? ctx.activePlayerId];
    } else {
      // HeroSelector
      targetIds = resolveHeroTargets(eff.target, ctx, state);
    }
    return targetIds.map(playerId => ({
      type: 'COINS_GAINED' as const,
      playerId,
      amount,
      seq: registry.nextSeq(),
    }));
  });
  registry.register('IGNORE_COIN_REWARDS', (_eff, _ctx, _state) => {
    // Se maneja en applyScenarioEffects: marca ignoreCoinRewards
    return [];
  });
  registry.register('IGNORE_GLORY_REWARDS', (_eff, _ctx, _state) => {
    // Se maneja en applyScenarioEffects: marca ignoreGloryRewards
    return [];
  });
  registry.register('STEAL_COINS', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    // Robar "de uno mismo" (SELF / ALL_HEROES incluye al activo) no tiene
    // sentido y generaba un COINS_STOLEN self→self espurio.
    const targets = resolveHeroTargets(eff.from, ctx, state)
      .filter(id => id !== ctx.activePlayerId);
    // En modo solitario (sin otros héroes), robar de la reserva
    if (targets.length === 0) {
      if (eff.from.kind === 'SELF') return [];
      return [{
        type: 'COINS_GAINED' as const,
        playerId: ctx.activePlayerId,
        amount,
        seq: registry.nextSeq(),
      }];
    }
    return targets.map(fromId => ({
      type: 'COINS_STOLEN' as const,
      fromPlayerId: fromId,
      toPlayerId: ctx.activePlayerId,
      amount: Math.min(amount, state.players[fromId].coins),
      seq: registry.nextSeq(),
    }));
  });
  registry.register('HEAL_WOUNDS', (eff, ctx, _state) => {
    const amount = evalValue(eff.amount, ctx, _state);
    return [{
      type: 'WOUND_HEALED',
      playerId: ctx.activePlayerId,
      amount,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('MODIFY_MARKET_COST', (eff, ctx, state) => {
    const modifier = evalValue(eff.modifier, ctx, state);
    return [{
      type: 'MODIFIER_ADDED',
      modifierId: `market-cost-${registry.nextSeq()}`,
      targetId: 'market',
      layer: 'MARKET_COST',
      amount: modifier,
      sourceId: ctx.currentCardInstanceId,
      duration: 'WHILE_SOURCE_ACTIVE',
      seq: registry.nextSeq(),
    }];
  });
  registry.register('STEAL_COINS_MULTIPLE', (eff, ctx, state) => {
    const maxTotal = evalValue(eff.maxTotal ?? eff.max_total ?? { kind: 'CONSTANT', value: 0 }, ctx, state);
    const maxPerHero = evalValue(eff.maxPerHero ?? eff.max_per_hero ?? { kind: 'CONSTANT', value: 0 }, ctx, state);
    const events: GameEvent[] = [];
    let stolen = 0;
    for (const playerId of state.playerOrder) {
      if (playerId === ctx.activePlayerId) continue;
      if (stolen >= maxTotal) break;
      const otherPlayer = state.players[playerId];
      const canSteal = Math.min(maxPerHero, maxTotal - stolen, otherPlayer.coins);
      if (canSteal > 0) {
        events.push({
          type: 'COINS_STOLEN',
          fromPlayerId: playerId,
          toPlayerId: ctx.activePlayerId,
          amount: canSteal,
          seq: registry.nextSeq(),
        });
        stolen += canSteal;
      }
    }
    return events;
  });
}
