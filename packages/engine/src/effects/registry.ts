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
  HeroStat,
  GameState,
  GameEvent,
  ResolutionContext,
  EnemyState,
  PlayerState,
  Zone,
  CardInstance,
} from '@nt4h/schema';

import type { DeterministicRng } from '../rng/index.js';
import type { EventBus } from '../triggers/index.js';
import { getEffectiveFortitude } from '../modifiers/index.js';
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

/** Limite tecnico de operaciones por resolucion (Taller §18).
 *  Suficientemente alto para cartas legitimas; detiene bucles infinitos. */
export const MAX_RESOLUTION_OPS = 10_000;

export class ResolutionBudgetError extends Error {
  constructor(public readonly ops: number) {
    super(`Resolution budget exceeded: more than ${MAX_RESOLUTION_OPS} operations`);
    this.name = 'ResolutionBudgetError';
  }
}

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
    // Presupuesto de resolucion: cada efecto ejecutado consume 1 op.
    // Determinista: mismo estado + semilla => mismo punto de corte.
    ctx.opsUsed = (ctx.opsUsed ?? 0) + 1;
    if (ctx.opsUsed > MAX_RESOLUTION_OPS) {
      throw new ResolutionBudgetError(ctx.opsUsed);
    }
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

    // --- Operadores (Taller §12) ---
    case 'SUBTRACT':
      return expr.of.reduce((acc: number | null, sub) => {
        const v = evalValue(sub, ctx, state);
        return acc === null ? v : acc - v;
      }, null) ?? 0;

    case 'MIN':
      return Math.min(...expr.of.map(sub => evalValue(sub, ctx, state)));

    case 'MAX':
      return Math.max(...expr.of.map(sub => evalValue(sub, ctx, state)));

    case 'ABS':
      return Math.abs(evalValue(expr.of[0], ctx, state));

    // --- Valores del estado de partida (Taller §12) ---
    case 'HERO_STAT': {
      const heroIds = resolveHeroTargets(expr.hero ?? { kind: 'SELF' }, ctx, state);
      const player = heroIds.length > 0 ? state.players[heroIds[0]] : undefined;
      return player ? heroStatValue(expr.stat, player, ctx) : 0;
    }

    case 'ENEMY_DAMAGE_OF': {
      const targetId = resolveTarget(expr.target, ctx, state);
      const enemy = targetId ? state.battlefield.find(e => e.instanceId === targetId) : undefined;
      // "Daño del enemigo" = Fortaleza efectiva − Heridas (lo que aporta a la Horda)
      return enemy ? Math.max(0, getEffectiveFortitude(enemy, state) - enemy.wounds) : 0;
    }

    case 'ENEMY_WOUNDS_OF': {
      const targetId = resolveTarget(expr.target, ctx, state);
      const enemy = targetId ? state.battlefield.find(e => e.instanceId === targetId) : undefined;
      return enemy?.wounds ?? 0;
    }

    case 'STATUS_STACKS_OF': {
      const targetId = resolveTarget(expr.target, ctx, state);
      const enemy = targetId ? state.battlefield.find(e => e.instanceId === targetId) : undefined;
      return (enemy?.statuses ?? [])
        .filter(s => s.id === expr.status)
        .reduce((a, s) => a + s.stacks, 0);
    }

    case 'DEFEATED_ENEMIES':
      return state.players[ctx.activePlayerId]?.trophies.length ?? 0;

    case 'VARIABLE': {
      // Ambito RESOLUTION → variables del contexto; GAME → customVars del
      // estado. Sin scope: primero resolución, luego partida.
      if (expr.scope === 'GAME') return state.customVars?.[expr.name] ?? 0;
      if (expr.scope === 'RESOLUTION') return ctx.variables?.[expr.name] ?? 0;
      return ctx.variables?.[expr.name] ?? state.customVars?.[expr.name] ?? 0;
    }

    default: {
      const _exhaustive: never = expr;
      void _exhaustive;
      return 0;
    }
  }
}

/** Estadística de un héroe (Taller §10, §12) */
export function heroStatValue(
  stat: HeroStat,
  player: PlayerState,
  ctx: ResolutionContext,
): number {
  switch (stat) {
    case 'WOUNDS': return player.wounds;
    case 'COINS': return player.coins;
    case 'GLORY': return player.glory;
    case 'CARDS_IN_HAND': return player.hand.length;
    case 'CARDS_IN_WEAR': return player.wearPile.length;
    case 'CARDS_PLAYED':
      return Object.values(ctx.cardsPlayedThisTurn).reduce((a, b) => a + b, 0);
    case 'TROPHIES': return player.trophies.length;
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

    // --- Predicados de héroe (Taller §10) ---
    case 'HERO_STAT_GTE':
    case 'HERO_STAT_LTE': {
      const heroIds = resolveHeroTargets(condition.hero ?? { kind: 'SELF' }, ctx, state);
      const player = heroIds.length > 0 ? state.players[heroIds[0]] : undefined;
      if (!player) return false;
      const v = heroStatValue(condition.stat, player, ctx);
      return condition.kind === 'HERO_STAT_GTE' ? v >= condition.value : v <= condition.value;
    }

    case 'HAS_CARD_IN_HAND': {
      const normalize = (s: string) => s.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const target = normalize(condition.name);
      const player = state.players[ctx.activePlayerId];
      return player.hand.some(c =>
        (c.name ? normalize(c.name) === target : normalize(c.definitionId).includes(target)));
    }

    // --- Variables del Taller ---
    case 'VARIABLE_GTE':
    case 'VARIABLE_LTE':
    case 'VARIABLE_EQ': {
      const v = evalValue({ kind: 'VARIABLE', name: condition.name }, ctx, state);
      switch (condition.kind) {
        case 'VARIABLE_GTE': return v >= condition.value;
        case 'VARIABLE_LTE': return v <= condition.value;
        default: return v === condition.value;
      }
    }

    // --- Predicados de enemigos y campo ---
    case 'ENEMY_COUNT_GTE':
      return state.battlefield.length >= condition.value;
    case 'ENEMY_COUNT_LTE':
      return state.battlefield.length <= condition.value;
    case 'ENEMY_IS_ORC':
    case 'ENEMY_IS_WARLORD':
    case 'ENEMY_IS_UNHARMED':
    case 'ENEMY_HAS_STATUS': {
      if (!ctx.selectedEnemyId) return false;
      const enemy = state.battlefield.find(e => e.instanceId === ctx.selectedEnemyId);
      if (!enemy) return false;
      switch (condition.kind) {
        case 'ENEMY_IS_ORC': return enemy.isOrc;
        case 'ENEMY_IS_WARLORD': return enemy.isWarlord;
        case 'ENEMY_IS_UNHARMED': return enemy.wounds === 0;
        default:
          return (enemy.statuses ?? []).some(s => s.id === condition.status && s.stacks > 0);
      }
    }

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

    case 'ENEMY_WITH_MIN_FORTITUDE': {
      if (state.battlefield.length === 0) return null;
      const min = state.battlefield.reduce((best, e) =>
        getEffectiveFortitude(e, state) < getEffectiveFortitude(best, state) ? e : best
      );
      return min.instanceId;
    }

    case 'ENEMY_WITH_MAX_DAMAGE': {
      // El enemigo que más daño aporta a la Horda (Fortaleza efectiva − Heridas)
      if (state.battlefield.length === 0) return null;
      const dmg = (e: EnemyState) => Math.max(0, getEffectiveFortitude(e, state) - e.wounds);
      const max = state.battlefield.reduce((best, e) => dmg(e) > dmg(best) ? e : best);
      return max.instanceId;
    }

    case 'OTHER_ENEMY': {
      // Cualquier enemigo distinto del seleccionado (spill, cadenas)
      if (ctx.chosenEnemyTarget && ctx.chosenEnemyTarget !== ctx.selectedEnemyId
          && state.battlefield.some(e => e.instanceId === ctx.chosenEnemyTarget)) {
        return ctx.chosenEnemyTarget;
      }
      return state.battlefield.find(e => e.instanceId !== ctx.selectedEnemyId)?.instanceId ?? null;
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
  const selfId = ctx.forEachHeroId ?? ctx.activePlayerId;
  switch (selector.kind) {
    case 'SELF':
      return [selfId];

    case 'ALL_OTHERS':
    case 'EACH_OTHER':
      return state.playerOrder.filter(id => id !== selfId);

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
      return state.playerOrder.filter(id => id !== selfId);

    case 'HERO_WITH_MOST_WOUNDS':
    case 'HERO_WITH_MOST_GLORY':
    case 'HERO_WITH_MOST_COINS': {
      const all = state.playerOrder;
      if (all.length === 0) return [];
      const stat = selector.kind === 'HERO_WITH_MOST_WOUNDS' ? 'WOUNDS'
        : selector.kind === 'HERO_WITH_MOST_GLORY' ? 'GLORY' : 'COINS';
      const best = all.reduce((a, b) =>
        heroStatValue(stat, state.players[b], ctx) > heroStatValue(stat, state.players[a], ctx) ? b : a
      );
      return [best];
    }

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

  // BLOCK_NEXT_DAMAGE: el bloqueo se consume por completo la primera vez
  // que el héroe recibe daño (aunque cubra menos del daño total).
  if ((player.blockNext ?? 0) > 0 && remaining > 0) {
    remaining = Math.max(0, remaining - player.blockNext!);
    events.push({ type: 'BLOCK_CONSUMED' as const, playerId, seq: nextSeqFn() });
    if (remaining === 0) return events;
  }
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

import { registerDamageEffects } from './handlers/damage.js';
import { registerCardsEffects } from './handlers/cards.js';
import { registerEconomyEffects } from './handlers/economy.js';
import { registerEnemiesEffects } from './handlers/enemies.js';
import { registerControlEffects } from './handlers/control.js';

export function registerCoreEffects(registry: EffectRegistry): void {
  registerDamageEffects(registry);
  registerCardsEffects(registry);
  registerEconomyEffects(registry);
  registerEnemiesEffects(registry);
  registerControlEffects(registry);
}
