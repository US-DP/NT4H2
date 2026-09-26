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
import { getEffectiveFortitude, getEnemyDamageBonus } from '../modifiers/index.js';
import { applyDamageModifiers } from './resolver.js';
import { applyEvent } from '../events/applyEvent.js';
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

export function registerCoreEffects(registry: EffectRegistry): void {
  // --- Helpers de estados de enemigo (Taller §3) ---

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
  registry.register('DEAL_DAMAGE', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
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

  // REPEAT: repite la lista interna N veces con limite duro (Taller §9.7).
  // `times` se evalua UNA vez al inicio (determinista, acotado por `max`);
  // los efectos internos consumen ops del presupuesto compartido, por lo que
  // una repeticion con sub-efectos que generen mas repeticiones se corta
  // de forma controlada al agotar MAX_RESOLUTION_OPS.
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

  // CHOOSE_ONE no es un handler: requiere pendingChoice del jugador.
  // El resolver lo intercepta antes de llegar aqui; si llegara, es un no-op
  // seguro (los eventos de opciones se resuelven via RESOLVE_CHOICE).
  registry.register('CHOOSE_ONE', (_eff, _ctx, _state) => []);

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
        playerId: ctx.activePlayerId,

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
          playerId: ctx.activePlayerId,

          seq: registry.nextSeq(),
        },
        {
          type: 'CARD_MOVED' as const,
          cardInstanceId: foundCard.instanceId,
          from: fromZone,
          to: 'HAND' as const,
          playerId: ctx.activePlayerId,

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
      playerId: ctx.activePlayerId,

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
      playerId: targetPlayer.playerId,
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

  // ==========================================================================
  // Extensiones del Taller (fase 1+)
  // ==========================================================================

  // DEAL_DAMAGE_HITS: N golpes separados (cada uno dispara pericias/Marcas)
  registry.register('DEAL_DAMAGE_HITS', (eff, ctx, state) => {
    const times = Math.max(0, evalValue(eff.times, ctx, state));
    const base = evalValue(eff.amount, ctx, state);
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId || times === 0) return [];
    const enemy = state.battlefield.find(e => e.instanceId === targetId);
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

  // EXECUTE_ENEMY: derrota al enemigo si su Fortaleza efectiva <= umbral
  registry.register('EXECUTE_ENEMY', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    const enemy = state.battlefield.find(e => e.instanceId === targetId);
    if (!enemy) return [];
    const threshold = evalValue(eff.threshold, ctx, state);
    if (getEffectiveFortitude(enemy, state) > threshold) return [];
    let reward = eff.loot !== false ? (enemy.reward ?? { coins: 0, glory: 0 }) : { coins: 0, glory: 0 };
    if (state.ignoreCoinRewards) reward = { ...reward, coins: 0 };
    if (state.ignoreGloryRewards) reward = { ...reward, glory: 0 };
    return [{
      type: 'ENEMY_DEFEATED' as const,
      enemyInstanceId: targetId,
      enemyDefinitionId: enemy.definitionId,
      defeatingPlayerId: ctx.activePlayerId,
      reward,
      seq: registry.nextSeq(),
    }];
  });

  // OVERKILL_DAMAGE: el exceso sobre la Fortaleza restante salta a otro enemigo
  registry.register('OVERKILL_DAMAGE', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    const enemy = state.battlefield.find(e => e.instanceId === targetId);
    if (!enemy) return [];
    const mark = markBonusFor(enemy, ctx);
    const events: GameEvent[] = [{
      type: 'DAMAGE_DEALT' as const,
      targetId,
      amount: amount + getEnemyDamageBonus(enemy) + mark.bonus,
      sourceCardInstanceId: ctx.currentCardInstanceId,
      seq: registry.nextSeq(),
    }, ...mark.events];
    const remaining = Math.max(0, getEffectiveFortitude(enemy, state) - enemy.wounds);
    const over = Math.max(0, amount - remaining);
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

  // SPAWN_ENEMY: revela N cartas del fondo del mazo de la Horda al campo.
  // El resolver lo intercepta (necesita el catálogo para los stats).
  // Fallback defensivo: no-op sin catálogo.
  registry.register('SPAWN_ENEMY', (_eff, _ctx, _state) => []);

  // DISCARD_HORDE_CARD: elimina N cartas del mazo de la Horda
  registry.register('DISCARD_HORDE_CARD', (eff, _ctx, state) => {
    const fromTop = eff.from === 'TOP';
    const cards = fromTop
      ? state.hordeDeck.slice(0, eff.count)
      : state.hordeDeck.slice(-eff.count);
    return cards.map(c => ({
      type: 'HORDE_CARD_DISCARDED' as const,
      cardInstanceId: c.instanceId,
      seq: registry.nextSeq(),
    }));
  });

  // MOVE_HORDE_CARDS: mueve N cartas del extremo de robo al otro extremo
  registry.register('MOVE_HORDE_CARDS', (eff, _ctx, state) => {
    const deck = state.hordeDeck;
    if (deck.length === 0) return [];
    const n = Math.min(eff.count, deck.length);
    // Se roba desde el FONDO (fin del array)
    const drawn = deck.slice(-n);
    const rest = deck.slice(0, deck.length - n);
    const newDeck = eff.to === 'TOP' ? [...drawn, ...rest] : [...rest, ...drawn];
    return [{
      type: 'HORDE_DECK_REORDERED' as const,
      newOrder: newDeck.map(c => c.instanceId),
      seq: registry.nextSeq(),
    }];
  });

  // DRAW_FROM_BOTTOM: roba desde el fondo del mazo de Habilidad
  registry.register('DRAW_FROM_BOTTOM', (eff, ctx, state, rng) => {
    const count = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    const deck = player.abilityDeck;
    // Caso simple: el mazo alcanza — sacar del fondo
    if (deck.length >= count) {
      const drawn = deck.slice(deck.length - count).map(c => c.instanceId);
      if (drawn.length === 0) return [];
      return [{
        type: 'CARDS_DRAWN' as const,
        playerId: ctx.activePlayerId,
        count: drawn.length,
        cardInstanceIds: drawn,
        seq: registry.nextSeq(),
      }];
    }
    // Mazo insuficiente: robar lo que queda por el fondo y el resto con
    // la regla normal de agotamiento (herida + reciclaje, spec §3.10)
    const events: GameEvent[] = [];
    if (deck.length > 0) {
      const drawn = deck.map(c => c.instanceId);
      events.push({
        type: 'CARDS_DRAWN' as const,
        playerId: ctx.activePlayerId,
        count: drawn.length,
        cardInstanceIds: drawn,
        seq: registry.nextSeq(),
      });
    }
    const depleted = {
      ...state,
      players: {
        ...state.players,
        [ctx.activePlayerId]: { ...player, abilityDeck: [] },
      },
    };
    events.push(...drawCardsWithReshuffle(
      ctx.activePlayerId, count - deck.length, depleted, rng, () => registry.nextSeq(),
    ).events);
    return events;
  });

  // DRAW_UP_TO: roba hasta completar N cartas en mano
  registry.register('DRAW_UP_TO', (eff, ctx, state, rng) => {
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    const count = Math.max(0, eff.limit - player.hand.length);
    if (count === 0) return [];
    return drawCardsWithReshuffle(
      ctx.activePlayerId, count, state, rng, () => registry.nextSeq(),
    ).events;
  });

  // TAKE_WOUNDS: heridas directas (riesgo), sin pasar por pérdida de cartas
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

  // GRANT_ARMOR: reduce CADA instancia de daño recibido en N hasta fin de turno
  registry.register('GRANT_ARMOR', (eff, ctx, state) => {
    const amount = Math.max(0, evalValue(eff.amount, ctx, state));
    return [{
      type: 'ARMOR_GRANTED' as const,
      playerId: ctx.activePlayerId,
      amount,
      seq: registry.nextSeq(),
    }];
  });

  // MOVE_CARD: mueve N cartas entre zonas del jugador activo
  registry.register('MOVE_CARD', (eff, ctx, state) => {
    const count = Math.max(0, evalValue(eff.count, ctx, state));
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    const zone = eff.from === 'HAND' ? player.hand
      : eff.from === 'WEAR_PILE' ? player.wearPile : player.abilityDeck;
    const cards = zone.slice(-count); // las más recientes
    if (cards.length === 0) return [];
    const fromZone: Zone = eff.from === 'ABILITY_DECK' ? 'ABILITY_DECK' : eff.from;
    return cards.map(c => eff.to === 'REMOVED_FROM_GAME'
      ? {
          type: 'CARD_REMOVED_FROM_GAME' as const,
          cardInstanceId: c.instanceId,
          seq: registry.nextSeq(),
        }
      : {
          type: 'CARD_MOVED' as const,
          cardInstanceId: c.instanceId,
          from: fromZone,
          to: eff.to as Zone,
          playerId: ctx.activePlayerId,
          seq: registry.nextSeq(),
        });
  });

  // FOR_EACH: ejecuta sus efectos una vez por elemento de la colección.
  // ENEMIES → fija ctx.selectedEnemyId; *_HEROES → fija ctx.forEachHeroId
  // (los selectores SELF/ALL_OTHERS apuntan al héroe iterado).
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

  // APPLY_STATUS: aplica un estado a enemigos (ids libres; el motor da
  // semántica a 'mark', 'stun' y 'poison')
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

  // REMOVE_STATUS: retira un estado de enemigos
  registry.register('REMOVE_STATUS', (eff, ctx, state) => {
    const targetIds = resolveEnemyIds(eff.target, ctx, state);
    return targetIds.map(enemyInstanceId => ({
      type: 'STATUS_REMOVED' as const,
      enemyInstanceId,
      status: eff.status,
      seq: registry.nextSeq(),
    }));
  });

  // INCREASE_STATUS: suma acumulaciones a un estado existente
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

  // ==========================================================================
  // Fase 2 del Taller: variables, bloqueo, TRY, oyentes, descarte
  // ==========================================================================

  // SET_VARIABLE: RESOLUTION guarda en ctx (sin evento); GAME emite
  // VARIABLE_SET para persistir en state.customVars (replayable).
  registry.register('SET_VARIABLE', (eff, ctx, state) => {
    const value = evalValue(eff.value, ctx, state);
    if ((eff.scope ?? 'RESOLUTION') === 'GAME') {
      return [{ type: 'VARIABLE_SET' as const, name: eff.name, value, seq: registry.nextSeq() }];
    }
    ctx.variables = { ...(ctx.variables ?? {}), [eff.name]: value };
    return [];
  });

  // BLOCK_NEXT_DAMAGE: escudo de un solo uso — cancela hasta N del próximo
  // daño que reciba el héroe (applyEvent lo suma a player.blockNext).
  registry.register('BLOCK_NEXT_DAMAGE', (eff, ctx, state) => {
    const amount = Math.max(0, evalValue(eff.amount, ctx, state));
    if (amount <= 0) return [];
    return [{ type: 'BLOCK_GRANTED' as const, playerId: ctx.activePlayerId, amount, seq: registry.nextSeq() }];
  });

  // TRY_EFFECT: ejecuta los efectos y, si fallan (presupuesto, handler
  // desconocido…), ejecuta onFailure. Los eventos ya emitidos antes del
  // fallo se mantienen (los efectos son atómicos por evento).
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

  // REGISTER_LISTENER: registra un oyente de eventos de partida. El
  // oyente dispara sus efectos cuando el motor emite un GameEvent del
  // tipo indicado (se resuelven con el dueño como héroe activo).
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

  // REMOVE_LISTENER: retira todos los oyentes del dueño con esa etiqueta.
  registry.register('REMOVE_LISTENER', (eff, ctx, state) => {
    const mine = (state.listeners ?? [])
      .filter(l => l.tag === eff.tag && l.playerId === ctx.activePlayerId);
    return mine.map(l => ({
      type: 'LISTENER_REMOVED' as const, listenerId: l.id, seq: registry.nextSeq(),
    }));
  });

  // DISCARD_FROM_HAND: la elección la hace el jugador — el resolver la
  // intercepta y emite una PendingChoice SELECT_CARD_FROM_HAND. Si llega
  // aquí (cadena sin resolver), descarta las últimas cartas de la mano.
  registry.register('DISCARD_FROM_HAND', (eff, ctx, state) => {
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    const count = Math.max(0, evalValue(eff.count, ctx, state));
    const discards = player.hand
      .filter(c => c.instanceId !== ctx.currentCardInstanceId)
      .slice(-count);
    return discards.map(c => ({
      type: 'CARD_MOVED' as const,
      cardInstanceId: c.instanceId,
      from: 'HAND' as const,
      to: 'WEAR_PILE' as const,
      playerId: ctx.activePlayerId,
      seq: registry.nextSeq(),
    }));
  });
}
