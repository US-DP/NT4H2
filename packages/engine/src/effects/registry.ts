/**
 * EffectRegistry — registro de handlers para cada tipo de CardEffect.
 *
 * El motor despacha por effect.type, no por nombre de carta.
 * Esto permite que las cartas personalizadas usen los mismos efectos
 * sin necesidad de programar codigo nuevo.
 */

import type {
  CardEffect,
  Condition,
  ValueExpr,
  TargetSelector,
  HeroSelector,
  GameState,
  GameEvent,
  ResolutionContext,
  EnemyState,
  Zone,
  CardInstance,
} from '@nt4h/schema';

import type { DeterministicRng } from '../rng/index.js';
import type { EventBus } from '../triggers/index.js';
import { getEffectiveFortitude, getEnemyDamageBonus } from '../modifiers/index.js';
import { applyDamageModifiers } from './resolver.js';
import { nextSeq, resetSeq } from '../seq.js';

export type EffectHandler<E extends CardEffect = CardEffect> = (
  effect: E,
  ctx: ResolutionContext,
  state: GameState,
  rng: DeterministicRng,
  eventBus: EventBus,
) => GameEvent[];

/** Extrae el tipo especifico de CardEffect dado su discriminador */
type EffectOfType<T extends string> = Extract<CardEffect, { type: T }>;

export class EffectRegistry {
  private handlers = new Map<string, EffectHandler<any>>();

  register<T extends CardEffect['type']>(
    type: T,
    handler: EffectHandler<EffectOfType<T>>,
  ): void {
    this.handlers.set(type, handler as EffectHandler<any>);
  }

  execute(
    effect: CardEffect,
    ctx: ResolutionContext,
    state: GameState,
    rng: DeterministicRng,
    eventBus: EventBus,
  ): GameEvent[] {
    const handler = this.handlers.get(effect.type);
    if (!handler) {
      throw new Error(`Unknown effect type: ${effect.type}`);
    }
    return handler(effect, ctx, state, rng, eventBus);
  }

  /** D426: delega en el contador global (§51.12 — seq monotonico global) */
  nextSeq(): number {
    return nextSeq();
  }

  resetSeq(): void {
    resetSeq();
  }
}

// ============================================================================
// Evaluadores de ValueExpr
// ============================================================================

export function evalValue(
  expr: ValueExpr,
  ctx: ResolutionContext,
  state: GameState,
): number {
  switch (expr.kind) {
    case 'CONSTANT':
      return expr.value;

    case 'COUNT_LIVING_ENEMIES':
      return state.battlefield.length;

    case 'COUNT_ENEMIES_IN_FIELD':
      return state.battlefield.length;

    case 'FORTITUDE_OF': {
      const targetId = resolveTarget(expr.target, ctx, state);
      if (!targetId) return 0;
      const enemy = state.battlefield.find(e => e.instanceId === targetId);
      // Fortaleza efectiva (con modificadores: Brunmar, Roghkiller, etc.) —
      // consistente con ENEMY_WITH_MAX_FORTITUDE y el cálculo de daño
      return enemy ? getEffectiveFortitude(enemy, state) : 0;
    }

    case 'SUM':
      return expr.of.reduce((acc, sub) => acc + evalValue(sub, ctx, state), 0);

    case 'MULTIPLY':
      return expr.factors.reduce((acc, sub) => acc * evalValue(sub, ctx, state), 1);

    case 'EVASION_DISCARDED_COUNT':
      // Numero de cartas descartadas en la evasion actual
      // Se lee del contexto de resolución o del estado temporal
      return (ctx as any).evasionDiscardedCount ?? (state as any).evasionDiscardedCount ?? 0;

    case 'FLOOR_DIV':
      return Math.floor(evalValue(expr.numerator, ctx, state) / expr.denominator);

    default: {
      const _exhaustive: never = expr;
      void _exhaustive;
      return 0;
    }
  }
}

// ============================================================================
// Evaluadores de Condition
// ============================================================================

export function evalCondition(
  condition: Condition,
  ctx: ResolutionContext,
  state: GameState,
): boolean {
  switch (condition.kind) {
    case 'FIRST_CARD_OF_NAME_THIS_TURN':
      // Buscar por nombre exacto (applyEvent indexa por nombre y definitionId)
      return (ctx.cardsPlayedThisTurn[condition.name] ?? 0) === 0;

    case 'ALREADY_USED_AGAINST_THIS_ENEMY': {
      if (!ctx.selectedEnemyId) return false;
      const enemyMap = ctx.cardsPlayedAgainstEnemy[ctx.selectedEnemyId];
      if (!enemyMap) return false;
      return (enemyMap[condition.name] ?? 0) > 0;
    }

    case 'ENEMY_DEFEATED_BY_THIS_CARD':
      return ctx.selectedEnemyId !== null &&
             ctx.enemiesDefeatedThisResolution.includes(ctx.selectedEnemyId);

    case 'HAS_CAPABILITY': {
      const player = state.players[ctx.activePlayerId];
      return player.capabilities.includes(condition.icon);
    }

    case 'ENEMY_FORTITUDE_GTE': {
      if (!ctx.selectedEnemyId) return false;
      const enemy = state.battlefield.find(e => e.instanceId === ctx.selectedEnemyId);
      return enemy ? getEffectiveFortitude(enemy, state) >= condition.value : false;
    }

    case 'NOT':
      return !evalCondition(condition.condition, ctx, state);

    case 'AND':
      return condition.conditions.every(c => evalCondition(c, ctx, state));

    case 'OR':
      return condition.conditions.some(c => evalCondition(c, ctx, state));

    default: {
      const _exhaustive: never = condition;
      void _exhaustive;
      return false;
    }
  }
}

// ============================================================================
// Resolucion de selectores
// ============================================================================

export function resolveTarget(
  selector: TargetSelector,
  ctx: ResolutionContext,
  state: GameState,
): string | null {
  switch (selector.kind) {
    case 'ONE_ENEMY':
    case 'SELECTED_ENEMY': {
      const targetId = ctx.selectedEnemyId;
      if (!targetId) return null;
      // Validar filter si existe
      if (selector.kind === 'ONE_ENEMY' && selector.filter) {
        const enemy = state.battlefield.find(e => e.instanceId === targetId);
        if (!enemy) return null;
        const f = selector.filter;
        if (f.minFortitude !== undefined && getEffectiveFortitude(enemy, state) < f.minFortitude) return null;
        if (f.isOrc !== undefined && enemy.isOrc !== f.isOrc) return null;
        if (f.isWarlord !== undefined && enemy.isWarlord !== f.isWarlord) return null;
      }
      return targetId;
    }

    case 'ALL_ENEMIES':
      return null; // ALL_ENEMIES se maneja de forma especial en el handler

    case 'ENEMY_WITH_MAX_FORTITUDE': {
      if (state.battlefield.length === 0) return null;
      // Si el jugador ya eligió (via pendingChoice), usar esa elección
      if (ctx.chosenEnemyTarget) {
        const chosen = state.battlefield.find(e => e.instanceId === ctx.chosenEnemyTarget);
        if (chosen) return chosen.instanceId;
      }
      // Usar getEffectiveFortitude (no baseFortitude) para respetar modificadores
      const max = state.battlefield.reduce((best, e) =>
        getEffectiveFortitude(e, state) > getEffectiveFortitude(best, state) ? e : best
      );
      return max.instanceId;
    }

    case 'ENEMY_WITH_FEWEST_WOUNDS': {
      if (state.battlefield.length === 0) return null;
      const min = state.battlefield.reduce((best, e) =>
        e.wounds < best.wounds ? e : best
      );
      return min.instanceId;
    }

    default: {
      const _exhaustive: never = selector;
      void _exhaustive;
      return null;
    }
  }
}

export function resolveHeroTargets(
  selector: HeroSelector,
  ctx: ResolutionContext,
  state: GameState,
): string[] {
  switch (selector.kind) {
    case 'SELF':
      return [ctx.activePlayerId];

    case 'ALL_OTHERS':
    case 'EACH_OTHER':
      return state.playerOrder.filter(id => id !== ctx.activePlayerId);

    case 'HERO_WITH_FEWEST_WOUNDS': {
      // Lluvia de Flechas: daña al héroe con menos Heridas, incluyendo al activo
      // En empate, el jugador elige (via pendingChoice); si no hay choice, preferir al activo
      if (ctx.chosenHeroTarget) return [ctx.chosenHeroTarget];
      const all = state.playerOrder;
      if (all.length === 0) return [];
      const minWounds = Math.min(...all.map(id => state.players[id].wounds));
      const candidates = all.filter(id => state.players[id].wounds === minWounds);
      if (candidates.length === 1) return [candidates[0]];
      // Fallback sin UI: preferir al jugador activo
      if (candidates.includes(ctx.activePlayerId)) return [ctx.activePlayerId];
      return [candidates[0]];
    }

    case 'OTHER_HERO':
      return state.playerOrder.filter(id => id !== ctx.activePlayerId);

    default: {
      const _exhaustive: never = selector;
      void _exhaustive;
      return [];
    }
  }
}

/**
 * Aplicar dano a un heroe: perdida de cartas del mazo, con reciclaje de Desgaste
 * y herida si el mazo se agota (igual que el ataque de la Horda).
 */
export function applyHeroDamage(
  playerId: string,
  amount: number,
  state: GameState,
  rng: DeterministicRng,
  nextSeqFn: () => number,
): GameEvent[] {
  const player = state.players[playerId];
  const events: GameEvent[] = [];
  let remaining = amount;
  let deck = [...player.abilityDeck];
  let wear = [...player.wearPile];
  let wounds = player.wounds;
  let pendingLost: string[] = [];

  while (remaining > 0) {
    if (deck.length === 0) {
      // D372: Si no hay Desgaste para reciclar, no se puede herir ni perder cartas
      if (wear.length === 0) break;
      if (pendingLost.length > 0) {
        events.push({
          type: 'CARDS_LOST' as const,
          playerId,
          count: pendingLost.length,
          cardInstanceIds: pendingLost,
          seq: nextSeqFn(),
        });
        pendingLost = [];
      }
      wounds++;
      events.push({
        type: 'DECK_EXHAUSTED' as const,
        playerId,
        seq: nextSeqFn(),
      });
      events.push({
        type: 'HERO_WOUNDED' as const,
        playerId,
        woundCount: wounds,
        seq: nextSeqFn(),
      });
      deck = rng.shuffle([...wear]);
      wear = [];
      events.push({
        type: 'DECK_RESHUFFLED' as const,
        playerId,
        newDeckSize: deck.length,
        newOrder: deck.map(c => c.instanceId),
        seq: nextSeqFn(),
      });
    }
    const lost = deck.slice(0, remaining).map(c => c.instanceId);
    pendingLost.push(...lost);
    const lostCards = deck.slice(0, remaining);
    wear = [...wear, ...lostCards.map(c => ({ ...c, zone: 'WEAR_PILE' as Zone }))];
    deck = deck.slice(lost.length);
    remaining -= lost.length;
  }
  if (pendingLost.length > 0) {
    events.push({
      type: 'CARDS_LOST' as const,
      playerId,
      count: pendingLost.length,
      cardInstanceIds: pendingLost,
      seq: nextSeqFn(),
    });
  }
  return events;
}

/**
 * Robar N cartas del mazo de Habilidad aplicando la regla de mazo agotado:
 * si el mazo se vacia, el heroe recibe 1 Herida y el Desgaste se recicla
 * (barajado) como nuevo mazo antes de seguir robando (spec §3.10 Heridas,
 * §9.7). Devuelve los eventos y el estado resultante de mazo/desgaste/heridas
 * para que el llamador pueda aplicarlo inline si lo necesita.
 */
export function drawCardsWithReshuffle(
  playerId: string,
  count: number,
  state: GameState,
  rng: DeterministicRng,
  nextSeqFn: () => number,
): {
  events: GameEvent[];
  drawn: CardInstance[];
  abilityDeck: CardInstance[];
  wearPile: CardInstance[];
  wounds: number;
} {
  const player = state.players[playerId];
  const events: GameEvent[] = [];
  const drawn: CardInstance[] = [];
  let remaining = count;
  let deck = [...player.abilityDeck];
  let wear = [...player.wearPile];
  let wounds = player.wounds;

  while (remaining > 0) {
    if (deck.length === 0) {
      // D372: si no hay Desgaste que reciclar, no hay Herida ni robo
      if (wear.length === 0) break;
      wounds++;
      events.push({
        type: 'DECK_EXHAUSTED' as const,
        playerId,
        seq: nextSeqFn(),
      });
      events.push({
        type: 'HERO_WOUNDED' as const,
        playerId,
        woundCount: wounds,
        seq: nextSeqFn(),
      });
      deck = rng.shuffle([...wear]);
      wear = [];
      events.push({
        type: 'DECK_RESHUFFLED' as const,
        playerId,
        newDeckSize: deck.length,
        newOrder: deck.map(c => c.instanceId),
        seq: nextSeqFn(),
      });
    }
    const batch = deck.slice(0, remaining);
    drawn.push(...batch);
    deck = deck.slice(batch.length);
    remaining -= batch.length;
    events.push({
      type: 'CARDS_DRAWN' as const,
      playerId,
      count: batch.length,
      cardInstanceIds: batch.map(c => c.instanceId),
      seq: nextSeqFn(),
    });
  }

  return { events, drawn, abilityDeck: deck, wearPile: wear, wounds };
}

// ============================================================================
// Registro de handlers core
// ============================================================================

export function registerCoreEffects(registry: EffectRegistry): void {
  // --- Dano ---
  registry.register('DEAL_DAMAGE', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    // Aplicar vulnerabilidad del enemigo (Flecha Corrosiva)
    const enemy = state.battlefield.find(e => e.instanceId === targetId);
    const bonus = enemy ? getEnemyDamageBonus(enemy) : 0;
    return [
      { type: 'DAMAGE_DEALT', targetId, amount: amount + bonus, sourceCardInstanceId: ctx.currentCardInstanceId, seq: registry.nextSeq() },
    ];
  });

  registry.register('DEAL_DAMAGE_ALL_ENEMIES', (eff, ctx, state) => {
    const baseAmount = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    const amount = player ? applyDamageModifiers(baseAmount, ctx.currentCardName, player) : baseAmount;
    return state.battlefield.map(e => ({
      type: 'DAMAGE_DEALT' as const,
      targetId: e.instanceId,
      amount: amount + getEnemyDamageBonus(e),
      sourceCardInstanceId: ctx.currentCardInstanceId,
      seq: registry.nextSeq(),
    }));
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
    return targets.map((e, i) => ({
      type: 'DAMAGE_DEALT' as const,
      targetId: e.instanceId,
      amount: perTarget + (i < remainder ? 1 : 0) + getEnemyDamageBonus(e),
      sourceCardInstanceId: ctx.currentCardInstanceId,
      seq: registry.nextSeq(),
    }));
  });

  registry.register('DEAL_DAMAGE_TO_HERO', (eff, ctx, state, rng) => {
    const amount = evalValue(eff.amount, ctx, state);
    const targets = resolveHeroTargets(eff.target, ctx, state);
    // El dano a heroes se convierte en perdida de cartas (con herida/reciclaje si mazo vacio)
    return targets.flatMap(targetId => applyHeroDamage(targetId, amount, state, rng, () => registry.nextSeq()));
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
    return targets.flatMap(targetId => applyHeroDamage(targetId, amount, state, rng, () => registry.nextSeq()));
  });

  // --- Prevencion ---
  registry.register('PREVENT_DAMAGE', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    return [{
      type: 'PREVENTION_APPLIED',
      playerId: ctx.activePlayerId,
      amount,
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

  registry.register('CANCEL_ALL_DAMAGE', (_eff, ctx, _state) => {
    return [{
      type: 'CANCELLATION_ACTIVATED',
      playerId: ctx.activePlayerId,
      seq: registry.nextSeq(),
    }];
  });

  registry.register('PREVENT_ENEMY_DAMAGE', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    return [{
      type: 'ENEMY_DAMAGE_DISABLED',
      enemyInstanceId: targetId,
      seq: registry.nextSeq(),
    }];
  });

  // --- Cartas ---
  registry.register('DRAW_CARDS', (eff, ctx, state, rng) => {
    const count = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    const source = eff.source ?? 'ABILITY_DECK';
    if (source === 'SUPPORT_DECK') {
      // Robar del mazo de Apoyo usado este turno (spec §4.2: solo 1 mazo/turno);
      // si ninguno se ha usado aun, del primer mazo disponible
      const decks = player.supportDecks ?? [];
      const usedIdx = player.supportDeckIndexUsedThisTurn;
      const deckIdx = usedIdx !== null && usedIdx !== undefined
        ? usedIdx
        : decks.findIndex(d => d.length > 0);
      const supportDeck = deckIdx >= 0 ? decks[deckIdx] : undefined;
      const drawn = supportDeck ? supportDeck.slice(0, count).map(c => c.instanceId) : [];
      if (drawn.length === 0) return [];
      return [{
        type: 'CARDS_DRAWN',
        playerId: ctx.activePlayerId,
        count: drawn.length,
        cardInstanceIds: drawn,
        seq: registry.nextSeq(),
      }];
    }

    // D434: robo del mazo de Habilidad con Herida + reciclaje de Desgaste
    // si el mazo se agota (spec §3.10 Heridas, §9.7)
    return drawCardsWithReshuffle(ctx.activePlayerId, count, state, rng, () => registry.nextSeq()).events;
  });

  registry.register('LOSE_CARDS', (eff, ctx, state, rng) => {
    const count = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];

    // Si el mazo tiene suficientes cartas, perder normalmente
    if (player.abilityDeck.length >= count) {
      const lost = player.abilityDeck.slice(0, count).map(c => c.instanceId);
      return [{
        type: 'CARDS_LOST',
        playerId: ctx.activePlayerId,
        count: lost.length,
        cardInstanceIds: lost,
        seq: registry.nextSeq(),
      }];
    }

    // Mazo agotado o insuficiente: usar applyHeroDamage para reciclaje + herida
    if (count > 0) {
      return applyHeroDamage(ctx.activePlayerId, count, state, rng, () => registry.nextSeq());
    }
    return [];
  });

  registry.register('RECOVER_CARDS', (eff, ctx, state) => {
    const count = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    // Recuperar de la parte INFERIOR del desgaste (las cartas mas antiguas)
    const recovered = player.wearPile.slice(0, count).map(c => c.instanceId);

    if (recovered.length === 0) return [];

    return [{
      type: 'CARDS_RECOVERED',
      playerId: ctx.activePlayerId,
      count: recovered.length,
      cardInstanceIds: recovered,
      toZone: eff.to === 'BOTTOM_OF_DECK' ? 'ABILITY_DECK' : 'HAND',
      seq: registry.nextSeq(),
    }];
  });

  registry.register('ALL_HEROES_RECOVER', (eff, ctx, state) => {
    const count = evalValue(eff.amount, ctx, state);
    return state.playerOrder.flatMap(playerId => {
      const player = state.players[playerId];
      const recovered = player.wearPile.slice(0, count).map(c => c.instanceId);
      if (recovered.length === 0) return [];
      return [{
        type: 'CARDS_RECOVERED' as const,
        playerId,
        count: recovered.length,
        cardInstanceIds: recovered,
        toZone: 'ABILITY_DECK' as const,
        seq: registry.nextSeq(),
      }];
    });
  });

  registry.register('OTHER_HEROES_RECOVER', (eff, ctx, state) => {
    const count = evalValue(eff.amount, ctx, state);
    const others = state.playerOrder.filter(id => id !== ctx.activePlayerId);
    // D434 (spec §4.4): en solitario, una carta de Apoyo que haga recuperar a
    // "otros heroes" se aplica al propio jugador (la carta es de otro heroe)
    const active = state.players[ctx.activePlayerId];
    const isBorrowed = active?.borrowedSupportCardIds?.includes(ctx.currentCardInstanceId ?? '') ?? false;
    const targets = others.length > 0
      ? others
      : (state.mode === 'SOLO' && isBorrowed ? [ctx.activePlayerId] : []);
    return targets.flatMap(playerId => {
      const player = state.players[playerId];
      const recovered = player.wearPile.slice(0, count).map(c => c.instanceId);
      if (recovered.length === 0) return [];
      return [{
        type: 'CARDS_RECOVERED' as const,
        playerId,
        count: recovered.length,
        cardInstanceIds: recovered,
        toZone: 'ABILITY_DECK' as const,
        seq: registry.nextSeq(),
      }];
    });
  });

  // --- Recursos ---
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
      targetIds = [ctx.activePlayerId];
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

  registry.register('STEAL_COINS', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    const targets = resolveHeroTargets(eff.from, ctx, state);
    // En modo solitario (sin otros héroes), robar de la reserva
    if (targets.length === 0) {
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

  // --- Control de flujo ---
  registry.register('CONDITIONAL', (eff, ctx, state, rng, bus) => {
    if (evalCondition(eff.condition, ctx, state)) {
      return eff.then.flatMap(e => registry.execute(e, ctx, state, rng, bus));
    }
    return eff.else?.flatMap(e => registry.execute(e, ctx, state, rng, bus)) ?? [];
  });

  registry.register('END_ATTACK', (_eff, _ctx, _state) => {
    // Senala fin del enfrentamiento; el motor de fases lo procesara
    return [];
  });

  // --- Enemigos ---
  registry.register('DISABLE_ENEMY_DAMAGE', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    return [{
      type: 'ENEMY_DAMAGE_DISABLED',
      enemyInstanceId: targetId,
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
      seq: registry.nextSeq(),
    }];
  });

  registry.register('DEFEAT_ENEMY', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    const enemy = state.battlefield.find(e => e.instanceId === targetId);
    if (!enemy) return [];

    let reward = eff.loot ? (enemy.reward ?? { coins: 0, glory: 0 }) : { coins: 0, glory: 0 };
    // Respetar modificadores de escenario (IGNORE_COIN/GLORY_REWARDS)
    if (state.ignoreCoinRewards) reward = { ...reward, coins: 0 };
    if (state.ignoreGloryRewards) reward = { ...reward, glory: 0 };
    return [{
      type: 'ENEMY_DEFEATED',
      enemyInstanceId: targetId,
      enemyDefinitionId: enemy.definitionId,
      defeatingPlayerId: ctx.activePlayerId,
      reward,
      seq: registry.nextSeq(),
    }];
  });

  // --- Especiales ---
  registry.register('REMOVE_FROM_GAME', (_eff, ctx, _state) => {
    return [{
      type: 'CARD_REMOVED_FROM_GAME',
      cardInstanceId: ctx.currentCardInstanceId,
      seq: registry.nextSeq(),
    }];
  });

  registry.register('PLACE_PERSISTENT', (eff, ctx, _state) => {
    return [{
      type: 'PERSISTENT_CARD_PLACED',
      playerId: ctx.activePlayerId,
      cardInstanceId: ctx.currentCardInstanceId,
      cardDefinitionId: ctx.currentCardId,
      trigger: eff.trigger,
      seq: registry.nextSeq(),
    }];
  });

  registry.register('COST', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    if (eff.resource === 'COINS') {
      // Validar que hay monedas suficientes
      if (player.coins < amount) return [];
      return [{
        type: 'COINS_GAINED',
        playerId: ctx.activePlayerId,
        amount: -amount,
        seq: registry.nextSeq(),
      }];
    } else {
      // GLORY: usar GLORY_LOST (no GLORY_GAINED negativo)
      if (player.glory < amount) return [];
      return [{
        type: 'GLORY_LOST',
        playerId: ctx.activePlayerId,
        amount,
        seq: registry.nextSeq(),
      }];
    }
  });

  // DRAW_AND_CHECK, PLAY_IMMEDIATELY, MODIFY_DAMAGE, etc.
  // se manejan en el motor de resolucion con logica especial
  registry.register('DRAW_AND_CHECK', (_eff, _ctx, _state) => {
    // Manejado por el motor de resolucion (necesita logica de cadena)
    return [];
  });

  registry.register('DRAW_AND_ADD_ATTACK', (_eff, _ctx, _state) => {
    // Manejado por el motor de resolucion (logica especial en resolver.ts)
    return [];
  });

  registry.register('PLAY_IMMEDIATELY', (_eff, _ctx, _state) => {
    // Manejado por el motor de resolucion
    return [];
  });

  registry.register('CUSTOM_SCENARIO', (_eff, _ctx, _state) => {
    // Los handlers reales estan en scenarios/index.ts (applyScenarioEffects, onTurnStart, etc.)
    return [];
  });

  registry.register('RECOVER_THIS_CARD', (eff, ctx, _state) => {
    return [{
      type: 'CARDS_RECOVERED',
      playerId: ctx.activePlayerId,
      count: 1,
      cardInstanceIds: [ctx.currentCardInstanceId],
      toZone: eff.to === 'HAND' ? 'HAND' : 'ABILITY_DECK',
      seq: registry.nextSeq(),
    }];
  });

  // === Handlers para efectos especiales ===

  // ON_DEFEAT: los efectos al derrotar se procesan en el resolver,
  // no aqui. Este handler es un no-op para efectos sueltos.
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

  // MODIFY_FORTITUDE: anade un modificador de fortaleza a un enemigo
  // (ej: Ruinas de Brunmar: -1 a todos; Roghkiller: +1 a orcos)
  registry.register('MODIFY_FORTITUDE', (eff, ctx, state) => {
    const amount = evalValue(eff.modifier, ctx, state);
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    return [{
      type: 'MODIFIER_ADDED',
      modifierId: `fort-mod-${registry.nextSeq()}`,
      targetId,
      layer: 'FORTITUDE_MODIFIERS',
      amount,
      duration: eff.duration,
      seq: registry.nextSeq(),
    }];
  });

  // MODIFY_MARKET_COST: modificador global de coste de mercado
  // (ej: Mercado de Lotharion: -1 a todos los articulos)
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

  // SHUFFLE_DECK: barajar el mazo de habilidad o mercado
  registry.register('SHUFFLE_DECK', (eff, ctx, state, rng) => {
    const player = state.players[ctx.activePlayerId];
    if (eff.deck === 'ABILITY') {
      const shuffled = rng.shuffle(player.abilityDeck);
      return [{
        type: 'DECK_SHUFFLED',
        playerId: ctx.activePlayerId,
        deck: 'ABILITY',
        newOrder: shuffled.map(c => c.instanceId),
        seq: registry.nextSeq(),
      }];
    }
    if (eff.deck === 'MARKET') {
      // Barajar el mazo de Mercado (Pericia de Neddia)
      const shuffled = rng.shuffle(state.marketDeck);
      return [{
        type: 'DECK_SHUFFLED',
        playerId: ctx.activePlayerId,
        deck: 'MARKET',
        newOrder: shuffled.map(c => c.instanceId),
        seq: registry.nextSeq(),
      }];
    }
    if (eff.deck === 'HORDE') {
      const shuffled = rng.shuffle(state.hordeDeck);
      return [{
        type: 'DECK_SHUFFLED',
        playerId: ctx.activePlayerId,
        deck: 'HORDE',
        newOrder: shuffled.map(c => c.instanceId),
        seq: registry.nextSeq(),
      }];
    }
    return [];
  });

  // SEARCH_DECK: buscar una carta en el mazo y ponerla en mano o intercambiar
  // (ej: Aranel: buscar en mazo y sustituir por una de mano)
  registry.register('SEARCH_DECK', (eff, ctx, state) => {
    const player = state.players[ctx.activePlayerId];
    // Determinar el mazo objetivo (ABILITY por defecto, MARKET si se especifica)
    const deck = eff.deck === 'MARKET' ? state.marketDeck : player.abilityDeck;
    // Buscar la primera carta que cumpla el filtro
    const foundIdx = deck.findIndex(c => {
      const filter = eff.filter as any;
      if (filter.name) {
        const cName = (c as any).name ?? '';
        if (cName !== filter.name && c.definitionId !== filter.name) return false;
      }
      if (filter.definitionId) {
        if (c.definitionId !== filter.definitionId) return false;
      }
      // Si no hay filtros, coincide con cualquier carta (toma la primera)
      return true;
    });
    if (foundIdx === -1) return [];

    const foundCard = deck[foundIdx];
    const fromZone: Zone = eff.deck === 'MARKET' ? 'MARKET_DECK' : 'ABILITY_DECK';
    if (eff.action === 'PUT_IN_HAND') {
      return [{
        type: 'CARD_MOVED',
        cardInstanceId: foundCard.instanceId,
        from: fromZone,
        to: 'HAND',
        seq: registry.nextSeq(),
      }];
    }
    // SWAP_WITH_HAND: intercambiar con la primera carta de mano
    if (player.hand.length > 0) {
      const handCard = player.hand[0];
      return [
        {
          type: 'CARD_MOVED' as const,
          cardInstanceId: handCard.instanceId,
          from: 'HAND' as const,
          to: fromZone,
          seq: registry.nextSeq(),
        },
        {
          type: 'CARD_MOVED' as const,
          cardInstanceId: foundCard.instanceId,
          from: fromZone,
          to: 'HAND' as const,
          seq: registry.nextSeq(),
        },
      ];
    }
    return [];
  });

  // SEARCH_WEAR_PILE_PUT_IN_HAND: buscar en pila de desgaste y poner en mano
  // (ej: Vial de Conjuracion)
  registry.register('SEARCH_WEAR_PILE_PUT_IN_HAND', (_eff, ctx, state) => {
    const player = state.players[ctx.activePlayerId];
    if (player.wearPile.length === 0) return [];
    // Si el jugador eligió una carta concreta, usarla; si no, tomar la mas reciente
    const card = ctx.chosenWearCardId
      ? player.wearPile.find(c => c.instanceId === ctx.chosenWearCardId)
      : player.wearPile[player.wearPile.length - 1];
    if (!card) return [];
    return [{
      type: 'CARD_MOVED',
      cardInstanceId: card.instanceId,
      from: 'WEAR_PILE',
      to: 'HAND',
      seq: registry.nextSeq(),
    }];
  });

  // RECOVER_CARD_BY_NAME: recuperar una carta por nombre de desgaste a fondo del mazo
  // (ej: Recoger Flechas: recuperar "Disparo rapido")
  registry.register('RECOVER_CARD_BY_NAME', (eff, ctx, state) => {
    const player = state.players[ctx.activePlayerId];
    // Normalizar: minúsculas, sin tildes
    const normalize = (s: string) => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const targetName = normalize(eff.name);
    // Buscar desde el INICIO del desgaste (cartas más antiguas = parte inferior)
    for (let i = 0; i < player.wearPile.length; i++) {
      const c = player.wearPile[i];
      if (c.name ? normalize(c.name) === targetName : normalize(c.definitionId).includes(targetName)) {
        return [{
          type: 'CARD_MOVED',
          cardInstanceId: c.instanceId,
          from: 'WEAR_PILE',
          to: 'ABILITY_DECK',
          seq: registry.nextSeq(),
        }];
      }
    }
    return [];
  });

  // SWAP_ENEMY: cambiar un enemigo del campo por uno del mazo de la Horda
  // (ej: Supervivencia)
  registry.register('SWAP_ENEMY', (eff, ctx, state) => {
    // Nota: el resolver intercepta SWAP_ENEMY antes de llegar aqui para acceder al catalogo.
    // Este handler es fallback si el resolver no lo intercepta.
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId || state.hordeDeck.length === 0) return [];
    const newEnemyCard = state.hordeDeck[state.hordeDeck.length - 1];
    return [
      {
        type: 'ENEMY_SWAPPED' as const,
        oldEnemyInstanceId: targetId,
        newEnemyInstanceId: newEnemyCard.instanceId,
        newEnemyDefinitionId: newEnemyCard.definitionId,
        newEnemyFortitude: 1,
        newEnemyReward: null,
        newEnemyIsOrc: false,
        newEnemyIsWarlord: false,
        newEnemySpecialIcons: [],
        seq: registry.nextSeq(),
      },
    ];
  });

  // RETURN_TO_HORDE: devolver un enemigo al mazo de la Horda
  // (ej: Lodazal de Kalern, Portal de Ulthar)
  registry.register('RETURN_TO_HORDE', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    return [{
      type: 'ENEMY_RETURNED_TO_HORDE',
      enemyInstanceId: targetId,
      position: eff.position,
      seq: registry.nextSeq(),
    }];
  });

  // INTERCEPT_DAMAGE: interceptar dano de otro heroe
  // (ej: Valerys: recibir el dano de la Horda de otro heroe)
  registry.register('INTERCEPT_DAMAGE', (eff, ctx, state) => {
    // eff.from es un HeroSelector, no un string
    const fromIds = resolveHeroTargets(eff.from, ctx, state)
      .filter(id => id !== ctx.activePlayerId);
    if (fromIds.length === 0) return [];
    const fromPlayerId = fromIds[0];
    return [{
      type: 'DAMAGE_INTERCEPTED',
      interceptorPlayerId: ctx.activePlayerId,
      originalTargetPlayerId: fromPlayerId,
      amount: 0, // Se actualiza con el dano real en el motor de fases
      seq: registry.nextSeq(),
    }];
  });

  // LOOK_AT_CARDS: mirar cartas del mazo de la Horda y reordenar
  // (ej: Idril: mirar 3 cartas inferiores del mazo de la Horda)
  registry.register('LOOK_AT_CARDS', (eff, ctx, state) => {
    const count = evalValue(eff.amount, ctx, state);
    if (eff.deck !== 'HORDE') return [];
    // No genera eventos que cambien el estado directamente;
    // el reordenamiento se maneja como un evento especial
    const bottomCards = state.hordeDeck.slice(-count).map(c => c.instanceId);
    return [{
      type: 'CARDS_REVEALED_TO_PLAYER',
      playerId: ctx.activePlayerId,
      cardInstanceIds: bottomCards,
      deck: 'HORDE',
      seq: registry.nextSeq(),
    }];
  });

  // STEAL_COINS_MULTIPLE: robar monedas a multiples heroes
  // (ej: Yermo de Cemenmar: hasta 3 monedas, max 2 por heroe)
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

  // PLAY_RANDOM_CARD_FROM_OTHER_HERO: jugar una carta aleatoria de otro héroe
  // (ej: Lágrimas de Aradiel — coste en Gloria)
  registry.register('PLAY_RANDOM_CARD_FROM_OTHER_HERO', (eff, ctx, state, rng) => {
    const costGlory = evalValue(eff.costGlory ?? eff.cost_glory ?? { kind: 'CONSTANT', value: 0 }, ctx, state);
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    if (player.glory < costGlory) return []; // No hay gloria suficiente

    const events: GameEvent[] = [];
    // Pagar el coste de Gloria
    if (costGlory > 0) {
      events.push({
        type: 'GLORY_LOST',
        playerId: ctx.activePlayerId,
        amount: costGlory,
        seq: registry.nextSeq(),
      });
    }
    // Elegir un héroe aleatorio y robar una carta aleatoria de su MANO
    // (spec: la carta se "juega" de otro héroe — coincide con la ruta
    // tears-hero-* de execute.ts que también usa la mano)
    const otherPlayers = state.playerOrder
      .filter(pid => pid !== ctx.activePlayerId)
      .map(pid => state.players[pid])
      .filter(p => p.hand.length > 0);
    if (otherPlayers.length === 0) return events;
    const targetPlayer = rng.pick(otherPlayers);
    const drawnCard = rng.pick(targetPlayer.hand);
    // Mover la carta de la mano del otro héroe a la mano del jugador activo
    events.push({
      type: 'CARD_MOVED',
      cardInstanceId: drawnCard.instanceId,
      from: 'HAND',
      to: 'HAND',
      toPlayerId: ctx.activePlayerId,
      seq: registry.nextSeq(),
    });
    events.push({
      type: 'CARD_PLAYED',
      playerId: ctx.activePlayerId,
      cardInstanceId: drawnCard.instanceId,
      cardDefinitionId: drawnCard.definitionId,
      cardName: drawnCard.name,
      seq: registry.nextSeq(),
    });
    return events;
  });
}
