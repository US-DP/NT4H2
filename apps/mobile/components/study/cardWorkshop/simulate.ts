/**
 * cardWorkshop/simulate.ts — Simulador de carta del Taller (P1).
 *
 * Ejecuta los efectos compilados del borrador contra un estado de partida
 * sintético usando el MISMO resolver del motor (`resolveCard` +
 * `EffectRegistry` + `registerCoreEffects`), nunca una reimplementación.
 *
 * Determinista: `DeterministicRng` con semilla fija → mismo resultado en
 * todas las ejecuciones. El resultado incluye la traza de eventos, los
 * deltas de estado y la elección pendiente si la carta la requiere.
 */

import { DeterministicRng, EffectRegistry, registerCoreEffects, resolveCard } from '@nt4h/engine';
import type {
  CardDefinition, CardEffect, CardInstance, EnemyState, GameEvent,
  GameState, PlayerState,
} from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import type { TFunc } from './model';

export interface SimOptions {
  /** Enemigos en el campo de batalla. */
  enemies: number;
  /** Fortaleza base de cada enemigo. */
  enemyFortitude: number;
  /** Si el enemigo objetivo es orco (condiciones IS_ORC). */
  enemyIsOrc: boolean;
  /** Heridas del héroe activo. */
  heroWounds: number;
  /** Cartas en la mano además de la probada. */
  handSize: number;
  /** Cartas en el mazo de habilidades. */
  deckSize: number;
  /** Cartas en la pila de desgaste. */
  wearSize: number;
  /** Semilla del RNG (misma entrada → misma traza). */
  seed: string;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  enemies: 2,
  enemyFortitude: 3,
  enemyIsOrc: false,
  heroWounds: 0,
  handSize: 2,
  deckSize: 5,
  wearSize: 2,
  seed: 'taller',
};

export interface SimEventLine {
  /** Icono/categoría para color en UI. */
  kind: 'damage' | 'card' | 'resource' | 'meta' | 'info';
  text: string;
}

export interface SimResult {
  ok: boolean;
  /** Error de ejecución (budget, tipo desconocido, etc.). */
  error?: string;
  /** Traza legible de eventos generados por el resolver. */
  trace: SimEventLine[];
  /** Resúmenes de estado antes → después. */
  deltas: string[];
  /** Enemigos derrotados (instanceId). */
  enemiesDefeated: number;
  /** La carta pide una elección al jugador (prompt). */
  pendingChoice?: string;
}

// === Construcción del estado sintético ===

function makeEnemy(i: number, opts: SimOptions): EnemyState {
  return {
    instanceId: `sim-enemy-${i}`,
    definitionId: 'sim-enemy',
    baseFortitude: opts.enemyFortitude,
    wounds: 0,
    reward: { coins: 1, glory: 1 },
    modifiers: [],
    isWarlord: false,
    isOrc: opts.enemyIsOrc,
    specialIcons: [],
    damageDisabled: false,
  };
}

function makePlayer(opts: SimOptions, cardInst: CardInstance): PlayerState {
  const fillers = (n: number, zone: CardInstance['zone'], tag: string): CardInstance[] =>
    Array.from({ length: n }, (_, i) => ({
      instanceId: `sim-${tag}-${i}`, definitionId: 'sim-filler', ownerId: 'p1', zone,
    }));
  return {
    playerId: 'p1',
    heroId: 'sim-hero',
    heroFace: 'FEMALE',
    heroMaxUses: 1,
    capabilities: ['MELEE', 'RANGED', 'EXPERTISE', 'MAGIC'],
    maxWounds: 6,
    wounds: opts.heroWounds,
    coins: 5,
    glory: 0,
    hand: [cardInst, ...fillers(opts.handSize, 'HAND', 'hand')],
    abilityDeck: fillers(opts.deckSize, 'ABILITY_DECK', 'deck'),
    wearPile: fillers(opts.wearSize, 'WEAR_PILE', 'wear'),
    trophies: [],
    shields: 0,
    prevention: 0,
    armor: 0,
    damageCancellation: false,
    interceptedBy: null,
    heroUsesRemaining: 1,
    persistentCards: [],
    modifiers: [],
    cardsPlayedThisTurn: {},
    cardsPlayedAgainstEnemy: {},
    supportDecks: [],
  };
}

function makeState(opts: SimOptions, player: PlayerState): GameState {
  return {
    phase: 'PLAYER_ATTACK',
    mode: 'STANDARD',
    activePlayerId: 'p1',
    turnNumber: 1,
    players: { p1: player },
    playerOrder: ['p1'],
    battlefield: Array.from({ length: opts.enemies }, (_, i) => makeEnemy(i, opts)),
    hordeDeck: [],
    market: [],
    marketDeck: [],
    scenarioDeck: [],
    scenario: null,
    scenarioCoins: 0,
    warlordRevealed: false,
    warlordDefeated: false,
    warlordsDefeatedCount: 0,
    pendingChoices: [],
    eventLog: [],
    rngState: { seed: opts.seed, state: 0 },
    monotonicCounter: 0,
    orcFortitudeBonus: 0,
    marketCostModifier: 0,
    ignoreCoinRewards: false,
    ignoreGloryRewards: false,
  };
}

// === Traza legible ===

function describeEvent(ev: GameEvent, t: TFunc): SimEventLine {
  const e = ev as Record<string, unknown> & { type: string };
  const num = (k: string) => (typeof e[k] === 'number' ? e[k] : '?');
  switch (ev.type) {
    case 'DAMAGE_DEALT':
      return { kind: 'damage', text: t('workshop.simDamage', { amount: num('amount'), target: String(e.targetId) }) };
    case 'WOUND_PLACED':
      return { kind: 'damage', text: t('workshop.simWound', { amount: num('amount'), target: String(e.enemyInstanceId) }) };
    case 'ENEMY_DEFEATED':
      return { kind: 'damage', text: t('workshop.simDefeat', { enemy: String(e.enemyInstanceId) }) };
    case 'CARDS_DRAWN':
      return { kind: 'card', text: t('workshop.simDraw', { count: num('count') }) };
    case 'CARDS_LOST':
      return { kind: 'card', text: t('workshop.simLost', { count: num('count') }) };
    case 'CARDS_RECOVERED':
      return { kind: 'card', text: t('workshop.simRecovered', { count: num('count'), zone: String(e.toZone) }) };
    case 'CARD_MOVED':
      return { kind: 'card', text: t('workshop.simMoved', { from: String(e.from), to: String(e.to) }) };
    case 'CARD_REMOVED_FROM_GAME':
      return { kind: 'card', text: t('workshop.simRemoved') };
    case 'CARD_PLAYED':
      return { kind: 'card', text: t('workshop.simPlayed', { name: String(e.cardName ?? e.cardDefinitionId) }) };
    case 'COINS_GAINED':
      return { kind: 'resource', text: t('workshop.simCoins', { amount: num('amount') }) };
    case 'COINS_STOLEN':
      return { kind: 'resource', text: t('workshop.simStolen', { amount: num('amount') }) };
    case 'GLORY_GAINED':
      return { kind: 'resource', text: t('workshop.simGlory', { amount: num('amount') }) };
    case 'GLORY_LOST':
      return { kind: 'resource', text: t('workshop.simGloryLost', { amount: num('amount') }) };
    case 'WOUND_HEALED':
      return { kind: 'resource', text: t('workshop.simHealed', { amount: num('amount') }) };
    case 'HORDE_ATTACKED':
      return { kind: 'damage', text: t('workshop.simHordeAttack', { amount: num('totalDamage') }) };
    case 'PREVENTION_APPLIED':
      return { kind: 'resource', text: t('workshop.simPrevention', { amount: num('amount') }) };
    case 'MODIFIER_ADDED':
      return { kind: 'meta', text: t('workshop.simModifier', { layer: String(e.layer), amount: e.amount != null ? String(e.amount) : '' }) };
    case 'ENEMY_DAMAGE_DISABLED':
      return { kind: 'damage', text: t('workshop.simDamageDisabled', { enemy: String(e.enemyInstanceId) }) };
    default:
      return { kind: 'meta', text: `${ev.type}` };
  }
}

// === Punto de entrada ===

/**
 * Ejecuta `effects` como carta `cardDef` contra el estado sintético.
 * Devuelve traza + deltas; nunca lanza (captura errores del resolver).
 */
export function simulateEffects(
  cardDef: CardDefinition,
  effects: CardEffect[],
  opts: SimOptions,
  catalog: CatalogLoadResult,
  t: TFunc,
): SimResult {
  if (effects.length === 0) {
    return { ok: false, error: t('workshop.simNoEffects'), trace: [], deltas: [], enemiesDefeated: 0 };
  }
  const def: CardDefinition = { ...cardDef, effects };
  const cardInst: CardInstance = {
    instanceId: 'sim-card-0', definitionId: def.id, ownerId: 'p1', zone: 'HAND',
  };
  const player = makePlayer(opts, cardInst);
  const state = makeState(opts, player);
  const registry = new EffectRegistry();
  registerCoreEffects(registry);
  const rng = new DeterministicRng(opts.seed);

  try {
    const target = state.battlefield[0]?.instanceId ?? null;
    const res = resolveCard(state, cardInst, def, target, player, rng, registry, catalog);
    const p = res.newState.players.p1;
    const deltas: string[] = [];
    if (p.coins !== player.coins) deltas.push(t('workshop.simDeltaCoins', { before: player.coins, after: p.coins }));
    if (p.glory !== player.glory) deltas.push(t('workshop.simDeltaGlory', { before: player.glory, after: p.glory }));
    if (p.wounds !== player.wounds) deltas.push(t('workshop.simDeltaWounds', { before: player.wounds, after: p.wounds }));
    if (p.shields !== player.shields) deltas.push(t('workshop.simDeltaShields', { before: player.shields, after: p.shields }));
    if (p.armor !== player.armor) deltas.push(t('workshop.simDeltaArmor', { before: player.armor, after: p.armor }));
    if (p.prevention !== player.prevention) deltas.push(t('workshop.simDeltaPrevention', { before: player.prevention, after: p.prevention }));
    if (p.hand.length !== player.hand.length) {
      deltas.push(t('workshop.simDeltaHand', { before: player.hand.length, after: p.hand.length }));
    }
    if (res.newState.battlefield.length !== state.battlefield.length) {
      deltas.push(t('workshop.simDeltaField', {
        before: state.battlefield.length, after: res.newState.battlefield.length,
      }));
    }
    return {
      ok: true,
      trace: res.events.map(ev => describeEvent(ev, t)),
      deltas,
      enemiesDefeated: res.enemiesDefeated.length,
      ...(res.pendingChoice ? { pendingChoice: res.pendingChoice.prompt } : {}),
    };
  } catch (err) {
    // El resolver puede lanzar ResolutionBudgetError (bucles), UnknownEffectError,
    // etc. — el simulador lo muestra en vez de congelar la UI.
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      trace: [], deltas: [], enemiesDefeated: 0,
    };
  }
}
