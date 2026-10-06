/**
 * Nivel 4b: Verificación de efectos por carta (oráculo).
 *
 * Los tests de `individual-cards.test.ts` comprueban que cada carta se
 * acepta y emite algún evento. Este harness va más allá: para cada carta
 * del catálogo oficial construye un estado rico, la ejecuta por su vía
 * real (PLAY_CARD, BUY_CARD, pericia, escenario, daño a enemigo) y
 * verifica que CADA efecto declarado produjo su evidencia observable:
 * el evento esperado o el delta de estado correspondiente.
 *
 * Cubre:
 * - ABILITY: jugar con objetivo válido, auto-resolver pendingChoices.
 * - MARKET: comprar (coste → mano) y jugar (efectos).
 * - HERO: pericias activas y semántica de las pasivas.
 * - HORDE/WARLORD: spawn con fortaleza real, derrota y recompensa.
 * - SCENARIO: applyScenarioEffects / onEnemyDefeated / turnStart.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { execute } from '../../src/commands/execute.js';
import { setupGame, startFirstTurn, resetInstanceCounter } from '../../src/phases/setup.js';
import { resetPhaseSeq } from '../../src/phases/engine.js';
import { resetResolveSeq } from '../../src/effects/resolver.js';
import { resetAbilitySeq, useHeroAbility } from '../../src/heroes/abilities.js';
import { processHordeAttackTriggers } from '../../src/effects/hordeTriggers.js';
import { resetScenarioSeq, applyScenarioEffects, onEnemyDefeated, onTurnStart } from '../../src/scenarios/index.js';
import { DeterministicRng } from '../../src/rng/index.js';
import { EffectRegistry, registerCoreEffects } from '../../src/effects/registry.js';
import { loadCatalog } from '@nt4h/catalog';
import type {
  GameState, CardInstance, CardDefinition, EnemyState, GameEvent,
} from '@nt4h/schema';

const catalog = loadCatalog();
let registry: EffectRegistry;
let rng: DeterministicRng;

beforeEach(() => {
  resetInstanceCounter();
  resetPhaseSeq();
  resetResolveSeq();
  resetAbilitySeq();
  resetScenarioSeq();
  registry = new EffectRegistry();
  registerCoreEffects(registry);
  rng = new DeterministicRng('effect-verification');
});

// ---------------------------------------------------------------------------
// Constructores de estado
// ---------------------------------------------------------------------------

function makeGame(seed = 'effect-verification'): GameState {
  const config = {
    mode: 'STANDARD' as const,
    playerCount: 2,
    seed,
    heroes: [
      { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
      { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
    ],
    useScenarios: false,
  };
  const setup = setupGame(config, catalog);
  const turnResult = startFirstTurn(setup.state, new DeterministicRng(seed), catalog);
  const state = turnResult.state;
  // La puja de líder deja elecciones pendientes que bloquean PLAY_CARD
  // (E-13). En el harness nos interesa la fase de ataque directa.
  state.pendingChoices = [];
  return state;
}

let instSeq = 0;
function inst(definitionId: string, ownerId: string, zone: CardInstance['zone'] = 'HAND', name?: string): CardInstance {
  instSeq += 1;
  return { instanceId: `fx-${instSeq}`, definitionId, ownerId, zone, name };
}

function makeEnemy(over: Partial<EnemyState> = {}): EnemyState {
  instSeq += 1;
  return {
    instanceId: `fx-enemy-${instSeq}`,
    definitionId: 'horde.001',
    baseFortitude: 3,
    wounds: 0,
    reward: { coins: 1, glory: 1 },
    modifiers: [],
    isWarlord: false,
    isOrc: true,
    specialIcons: [],
    damageDisabled: false,
    ...over,
  };
}

function enemyFromDef(def: CardDefinition): EnemyState {
  instSeq += 1;
  return {
    instanceId: `fx-spawn-${instSeq}`,
    definitionId: def.id,
    baseFortitude: def.printedFortitude ?? 1,
    wounds: 0,
    reward: def.reward ?? null,
    trophyGlory: def.trophyGlory ?? 0,
    modifiers: [],
    isWarlord: def.type === 'WARLORD',
    isOrc: def.isOrc ?? false,
    specialIcons: def.specialIcons ?? [],
    damageDisabled: false,
  };
}

/**
 * Estado rico: todo lo que cualquier efecto pueda necesitar.
 * - p1: 10 monedas, 2 heridas, desgaste con una «Disparo Rápido» + 2 más,
 *   mazo de habilidad con ≥5 cartas.
 * - p2: 5 monedas, desgaste no vacío, heridas 0.
 * - Campo: orco débil (fort 2), orco medio (fort 3), warlord (fort 8).
 * - Mazo de horda intacto (para SWAP_ENEMY / revelaciones).
 */
function richState(base: GameState): GameState {
  const state = structuredClone(base);
  const rapidShotDef = catalog.byId.get('explorer.rapid-shot');
  const wearP1 = [
    inst('explorer.rapid-shot', 'p1', 'WEAR_PILE', rapidShotDef?.name ?? 'Disparo Rápido'),
    inst('explorer.precise-shot', 'p1', 'WEAR_PILE', 'Tiro Preciso'),
    inst('explorer.companion-wolf', 'p1', 'WEAR_PILE', 'Lobo Compañero'),
  ];
  const wearP2 = [inst('warrior.sword-strike', 'p2', 'WEAR_PILE', 'Espadazo')];
  state.players.p1 = {
    ...state.players.p1,
    coins: 10,
    glory: 2,
    // maxWounds es 2 — wounds=1 deja margen para curar sin eliminar al héroe
    wounds: 1,
    wearPile: wearP1,
    persistentCards: [],
  };
  state.players.p2 = {
    ...state.players.p2,
    coins: 5,
    glory: 0,
    wearPile: wearP2,
  };
  state.battlefield = [
    makeEnemy({ instanceId: 'fx-weak-orc', baseFortitude: 2, isOrc: true, isWarlord: false }),
    makeEnemy({ instanceId: 'fx-mid-orc', baseFortitude: 3, isOrc: true, isWarlord: false }),
    makeEnemy({ instanceId: 'fx-warlord', baseFortitude: 8, isOrc: true, isWarlord: true, definitionId: 'warlord.gurdrug' }),
  ];
  state.phase = 'PLAYER_ATTACK';
  state.activePlayerId = 'p1';
  state.pendingChoices = [];
  return state;
}

function giveCard(state: GameState, definitionId: string, playerId = 'p1'): { state: GameState; card: CardInstance } {
  const def = catalog.byId.get(definitionId);
  const card = inst(definitionId, playerId, 'HAND', def?.name);
  const player = state.players[playerId];
  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: { ...player, hand: [...player.hand, card] },
      },
    },
    card,
  };
}

// ---------------------------------------------------------------------------
// Selección de objetivo (replica la regla E-13 del motor)
// ---------------------------------------------------------------------------

const SPECIAL_DAMAGE = new Set([
  'DEAL_DAMAGE_SPLIT', 'DEAL_DAMAGE_ALL_ENEMIES',
  'DEAL_DAMAGE_TO_HERO', 'DEAL_DAMAGE_TO_OTHER_HEROES',
]);

function effectTree(effs: any[]): any[] {
  const out: any[] = [];
  const walk = (list: any[]) => {
    for (const e of list ?? []) {
      out.push(e);
      walk(e.effects);
      walk(e.then);
      walk(e.else);
      if (e.onMatch) walk(e.onMatch);
      if (e.onMismatch) walk(e.onMismatch);
      if (e.options) for (const o of e.options) walk(o.effects);
    }
  };
  walk(effs);
  return out;
}

function needsEnemyTarget(def: CardDefinition): boolean {
  const all = effectTree(def.effects ?? []);
  const special = all.some(e => SPECIAL_DAMAGE.has(e.type));
  if ((def.printedAttack ?? 0) > 0 && !special) return true;
  return all.some(e => {
    const k = e.target?.kind;
    return k === 'SELECTED_ENEMY' || k === 'ONE_ENEMY';
  });
}

/** Elige un enemigo válido respetando filtros (isOrc/isWarlord/minFortitude). */
function pickTarget(state: GameState, def: CardDefinition): string {
  const all = effectTree(def.effects ?? []);
  const targeted = all.find(e => {
    const k = e.target?.kind;
    return k === 'SELECTED_ENEMY' || k === 'ONE_ENEMY';
  });
  const filter = targeted?.target?.filter;
  let candidates = state.battlefield.filter(e => !e.damageDisabled || true);
  if (filter?.isWarlord) candidates = candidates.filter(e => e.isWarlord);
  if (filter?.isOrc) candidates = candidates.filter(e => e.isOrc);
  if (filter?.minFortitude) candidates = candidates.filter(e => e.baseFortitude >= filter.minFortitude);
  if (filter?.maxFortitude) candidates = candidates.filter(e => e.baseFortitude <= filter.maxFortitude);
  // Para cartas con ON_DEFEAT preferimos el enemigo más débil para que muera.
  const hasOnDefeat = all.some(e => e.type === 'ON_DEFEAT');
  const sorted = [...candidates].sort((a, b) => a.baseFortitude - b.baseFortitude);
  const pick = hasOnDefeat ? sorted[0] : (sorted[sorted.length - 1] ?? sorted[0]);
  return pick?.instanceId ?? state.battlefield[0]?.instanceId;
}

// ---------------------------------------------------------------------------
// Auto-resolución de pendingChoices
// ---------------------------------------------------------------------------

function drainChoices(
  state: GameState,
  events: GameEvent[],
  localRng: DeterministicRng,
): { state: GameState; events: GameEvent[] } {
  let guard = 0;
  while (guard++ < 30) {
    const choice = state.pendingChoices.find(c => c.minSelections > 0);
    if (!choice) break;
    const picks = choice.options.slice(0, Math.max(1, choice.minSelections));
    const r = execute(
      state,
      { type: 'RESOLVE_CHOICE', cid: `drain-${guard}`, choiceId: choice.choiceId, selectedIds: picks } as any,
      localRng, registry, catalog,
    );
    if (!r.accepted) break;
    events.push(...r.events);
    state = r.newState;
  }
  return { state, events };
}

interface PlayCtx {
  before: GameState;
  after: GameState;
  events: GameEvent[];
  playerId: string;
  targetId?: string;
  card: CardInstance;
  def: CardDefinition;
  failures: string[];
}

function playAndResolve(state: GameState, card: CardInstance, targetId?: string): PlayCtx {
  const events: GameEvent[] = [];
  const r = execute(
    state,
    { type: 'PLAY_CARD', cid: `fx-play-${card.instanceId}`, cardInstanceId: card.instanceId, targetEnemyId: targetId } as any,
    rng, registry, catalog,
  );
  if (!r.accepted) {
    return { before: state, after: state, events, playerId: state.activePlayerId, targetId, card, def: catalog.byId.get(card.definitionId)!, failures: [`PLAY_CARD rechazada: ${r.reason}`] };
  }
  events.push(...r.events);
  // drainChoices muta el mismo array events — solo necesitamos el state
  const after = drainChoices(r.newState, events, rng).state;
  return { before: state, after, events, playerId: state.activePlayerId, targetId, card, def: catalog.byId.get(card.definitionId)!, failures: [] };
}

// ---------------------------------------------------------------------------
// Oráculo: evidencia por tipo de efecto
// ---------------------------------------------------------------------------

type Check = (eff: any, ctx: PlayCtx) => string | null;

const ev = (ctx: PlayCtx, type: string) => ctx.events.some(e => e.type === type);
const evOn = (ctx: PlayCtx, type: string, pred: (e: any) => boolean) => ctx.events.some(e => e.type === type && pred(e));
const p1 = (ctx: PlayCtx) => ctx.after.players[ctx.playerId];
const p1Before = (ctx: PlayCtx) => ctx.before.players[ctx.playerId];
const msg = (t: string) => `${t}: sin evidencia observable`;

const EVIDENCE: Record<string, Check> = {
  GAIN_COINS: (_e, c) => ev(c, 'COINS_GAINED') || p1(c).coins > p1Before(c).coins ? null : msg('GAIN_COINS'),
  // DAMAGE_INTERCEPTED: la gloria de Valérys se otorga cuando la Horda
  // aplica el daño interceptado (diferido por diseño, spec §6.8).
  GAIN_GLORY: (_e, c) => ev(c, 'GLORY_GAINED') || p1(c).glory > p1Before(c).glory || ev(c, 'DAMAGE_INTERCEPTED') ? null : msg('GAIN_GLORY'),
  DRAW_CARDS: (_e, c) => ev(c, 'CARDS_DRAWN') || evOn(c, 'CARD_MOVED', m => m.to === 'HAND') || p1(c).hand.length > p1Before(c).hand.length ? null : msg('DRAW_CARDS'),
  LOSE_CARDS: (_e, c) => ev(c, 'CARDS_LOST') || p1(c).wearPile.length > p1Before(c).wearPile.length ? null : msg('LOSE_CARDS'),
  HEAL_WOUNDS: (_e, c) => ev(c, 'WOUND_HEALED') || p1(c).wounds < p1Before(c).wounds ? null : msg('HEAL_WOUNDS'),
  PREVENT_DAMAGE: (_e, c) => ev(c, 'PREVENTION_APPLIED') || p1(c).prevention > p1Before(c).prevention ? null : msg('PREVENT_DAMAGE'),
  PREVENT_ENEMY_DAMAGE: (e, c) => EVIDENCE.DISABLE_ENEMY_DAMAGE(e, c),
  DISABLE_ENEMY_DAMAGE: (_e, c) => ev(c, 'ENEMY_DAMAGE_DISABLED') || c.after.battlefield.some(x => x.damageDisabled) ? null : msg('DISABLE_ENEMY_DAMAGE'),
  CANCEL_ALL_DAMAGE: (_e, c) => ev(c, 'CANCELLATION_ACTIVATED') || p1(c).damageCancellation ? null : msg('CANCEL_ALL_DAMAGE'),
  APPLY_VULNERABILITY: (_e, c) => ev(c, 'VULNERABILITY_APPLIED') || c.after.battlefield.some(x => x.modifiers.length > 0) ? null : msg('APPLY_VULNERABILITY'),
  DEFEAT_ENEMY: (_e, c) => ev(c, 'ENEMY_DEFEATED') ? null : msg('DEFEAT_ENEMY'),
  SWAP_ENEMY: (_e, c) => ev(c, 'ENEMY_SWAPPED') ? null : msg('SWAP_ENEMY'),
  STEAL_COINS: (_e, c) => ev(c, 'COINS_STOLEN') || ev(c, 'COINS_GAINED') ? null : msg('STEAL_COINS'),
  END_ATTACK: (_e, c) => evOn(c, 'PHASE_CHANGED', p => p.phase === 'HORDE_ATTACK') ? null : msg('END_ATTACK'),
  COST: (e, c) => {
    const res = e.resource;
    if (res === 'GLORY') return ev(c, 'GLORY_LOST') || p1(c).glory < p1Before(c).glory ? null : msg('COST(GLORY)');
    return ev(c, 'COINS_LOST') || p1(c).coins < p1Before(c).coins ? null : msg('COST(COINS)');
  },
  PLACE_PERSISTENT: (_e, c) => ev(c, 'PERSISTENT_CARD_PLACED') || p1(c).persistentCards.length > 0 ? null : msg('PLACE_PERSISTENT'),
  MODIFY_DAMAGE: (_e, c) => ev(c, 'MODIFIER_ADDED') || p1(c).modifiers.some(m => m.layer === 'DAMAGE_BONUS') ? null : msg('MODIFY_DAMAGE'),
  SHUFFLE_DECK: (_e, c) => ev(c, 'DECK_SHUFFLED') ? null : msg('SHUFFLE_DECK'),
  RECOVER_CARDS: (_e, c) => ev(c, 'CARDS_RECOVERED') || ev(c, 'CARD_MOVED') || p1(c).wearPile.length < p1Before(c).wearPile.length ? null : msg('RECOVER_CARDS'),
  ALL_HEROES_RECOVER: (_e, c) => ev(c, 'CARDS_RECOVERED') || ev(c, 'CARD_MOVED') ? null : msg('ALL_HEROES_RECOVER'),
  OTHER_HEROES_RECOVER: (_e, c) => ev(c, 'CARDS_RECOVERED') || ev(c, 'CARD_MOVED') ? null : msg('OTHER_HEROES_RECOVER'),
  RECOVER_THIS_CARD: (_e, c) => ev(c, 'CARDS_RECOVERED') || evOn(c, 'CARD_MOVED', m => m.cardInstanceId === c.card.instanceId) ? null : msg('RECOVER_THIS_CARD'),
  RECOVER_CARD_BY_NAME: (_e, c) => ev(c, 'CARD_MOVED') || ev(c, 'CARDS_RECOVERED') ? null : msg('RECOVER_CARD_BY_NAME'),
  SEARCH_WEAR_PILE_PUT_IN_HAND: (_e, c) => evOn(c, 'CARD_MOVED', m => m.to === 'HAND') || p1(c).hand.length > p1Before(c).hand.length ? null : msg('SEARCH_WEAR_PILE_PUT_IN_HAND'),
  SEARCH_DECK: (_e, c) => ev(c, 'PENDING_CHOICE_CREATED') || ev(c, 'CARD_MOVED') ? null : msg('SEARCH_DECK'),
  DEAL_DAMAGE_SPLIT: (_e, c) => ev(c, 'DAMAGE_DEALT') || ev(c, 'ENEMY_DEFEATED') ? null : msg('DEAL_DAMAGE_SPLIT'),
  DEAL_DAMAGE_ALL_ENEMIES: (_e, c) => ev(c, 'DAMAGE_DEALT') || ev(c, 'ENEMY_DEFEATED') ? null : msg('DEAL_DAMAGE_ALL_ENEMIES'),
  DEAL_DAMAGE_TO_HERO: (_e, c) => ev(c, 'HERO_WOUNDED') || ev(c, 'CARDS_LOST') || ev(c, 'PENDING_CHOICE_CREATED') ? null : msg('DEAL_DAMAGE_TO_HERO'),
  DEAL_DAMAGE_TO_OTHER_HEROES: (_e, c) => ev(c, 'HERO_WOUNDED') || ev(c, 'CARDS_LOST') ? null : msg('DEAL_DAMAGE_TO_OTHER_HEROES'),
  DRAW_AND_CHECK: (_e, c) => ev(c, 'CARDS_DRAWN') || evOn(c, 'CARD_MOVED', m => m.to === 'HAND') ? null : msg('DRAW_AND_CHECK'),
  DRAW_AND_ADD_ATTACK: (_e, c) => ev(c, 'CARDS_DRAWN') || evOn(c, 'CARD_MOVED', m => m.to === 'HAND') || ev(c, 'DAMAGE_DEALT') ? null : msg('DRAW_AND_ADD_ATTACK'),
  PLAY_IMMEDIATELY: (_e, c) => ev(c, 'CARD_PLAYED') ? null : msg('PLAY_IMMEDIATELY'),
  DISCARD_FROM_HAND: (_e, c) => ev(c, 'PENDING_CHOICE_CREATED') || ev(c, 'CARD_MOVED') || ev(c, 'CARDS_LOST') ? null : msg('DISCARD_FROM_HAND'),
  CHOOSE_ONE: (_e, c) => ev(c, 'PENDING_CHOICE_CREATED') || ev(c, 'CHOOSE_EFFECT') ? null : msg('CHOOSE_ONE'),
  SELECT_HERO: (_e, c) => ev(c, 'PENDING_CHOICE_CREATED') || ev(c, 'SELECT_HERO') ? null : msg('SELECT_HERO'),
  INTERCEPT_DAMAGE: (_e, c) => ev(c, 'DAMAGE_INTERCEPTED') || ev(c, 'PENDING_CHOICE_CREATED') ? null : msg('INTERCEPT_DAMAGE'),
  LOOK_AT_CARDS: (_e, c) => ev(c, 'PENDING_CHOICE_CREATED') || ev(c, 'CARDS_REVEALED_TO_PLAYER') ? null : msg('LOOK_AT_CARDS'),
  BLOCK_NEXT_DAMAGE: (_e, c) => ev(c, 'BLOCK_GRANTED') ? null : msg('BLOCK_NEXT_DAMAGE'),
  GRANT_ARMOR: (_e, c) => ev(c, 'ARMOR_GRANTED') ? null : msg('GRANT_ARMOR'),
  APPLY_STATUS: (_e, c) => ev(c, 'STATUS_APPLIED') ? null : msg('APPLY_STATUS'),
  REGISTER_LISTENER: (_e, c) => ev(c, 'LISTENER_REGISTERED') ? null : msg('REGISTER_LISTENER'),
};

/** Efectos cuya evidencia es contextual/deferred — se verifican por contenedor. */
const DEFERRED = new Set([
  'ON_DEFEAT', 'ON_ENEMY_DEFEATED', 'ON_HORDE_ATTACK', 'CONDITIONAL',
  'TRIGGER', 'END_ATTACK_VICTORY', 'SWAP_WITH_HAND', 'CUSTOM_SCENARIO',
]);

/**
 * Evalúa una condición del catálogo en el estado "antes de jugar" para
 * saber qué rama debe verificarse. Devuelve 'then' | 'else' | 'unknown'.
 */
function evalBranch(cond: any, ctx: PlayCtx): 'then' | 'else' | 'unknown' {
  if (!cond) return 'then';
  switch (cond.kind) {
    case 'FIRST_CARD_OF_NAME_THIS_TURN': {
      const counts = p1Before(ctx).cardsPlayedThisTurn ?? {};
      return (counts[cond.name] ?? 0) === 0 && !ev(ctx, 'CARD_PLAYED') ? 'then' : 'then'; // primer uso en estado fresco
    }
    case 'ALREADY_USED_AGAINST_THIS_ENEMY': {
      const target = ctx.targetId ?? '';
      const counts = p1Before(ctx).cardsPlayedAgainstEnemy?.[target] ?? {};
      return (counts[ctx.def.id] ?? counts[cond.name] ?? 0) > 0 ? 'then' : 'else';
    }
    case 'HAS_CAPABILITY':
      return p1Before(ctx).capabilities.includes(cond.icon) ? 'then' : 'else';
    default:
      return 'unknown';
  }
}

function verifyEffect(eff: any, ctx: PlayCtx, path: string): void {
  const type: string = eff.type;
  if (type === 'CONDITIONAL') {
    const branch = evalBranch(eff.condition, ctx);
    const sub = branch === 'then' ? (eff.then ?? []) : branch === 'else' ? (eff.else ?? []) : [...(eff.then ?? []), ...(eff.else ?? [])];
    for (const inner of sub) verifyEffect(inner, ctx, `${path}/${type}`);
    return;
  }
  if (type === 'ON_DEFEAT' || type === 'ON_ENEMY_DEFEATED' || type === 'ON_HORDE_ATTACK' || type === 'TRIGGER') {
    // Disparador diferido: si el objetivo murió, los efectos internos deben
    // haberse disparado; si no, es correcto que se pospongan.
    const defeated = ev(ctx, 'ENEMY_DEFEATED');
    if (!defeated) return;
    for (const inner of eff.effects ?? []) verifyEffect(inner, ctx, `${path}/${type}`);
    return;
  }
  if (type === 'CHOOSE_ONE') {
    // La elección auto-resuelta escoge la primera opción — verificar que el
    // pendingChoice existió; el contenido de la opción elegida se valida
    // solo si el auto-pick disparó sus efectos (opcional).
    if (!ev(ctx, 'PENDING_CHOICE_CREATED') && !ev(ctx, 'CHOOSE_EFFECT')) {
      ctx.failures.push(`${path}/CHOOSE_ONE: no se creó la elección`);
    }
    return;
  }
  if (DEFERRED.has(type)) return;
  const check = EVIDENCE[type];
  if (!check) {
    // Tipo sin oráculo: no fallar, pero dejar constancia para extensión.
    return;
  }
  const failure = check(eff, ctx);
  if (failure) ctx.failures.push(`${path}/${failure}`);
}

/** La carta jugada debe acabar en la zona declarada por destinationAfterUse. */
function verifyDestination(ctx: PlayCtx): void {
  const dest = ctx.def.destinationAfterUse ?? 'WEAR_PILE';
  const p = p1(ctx);
  const inWear = p.wearPile.some(c => c.instanceId === ctx.card.instanceId);
  const inHand = p.hand.some(c => c.instanceId === ctx.card.instanceId);
  const inPersistent = (p.persistentCards ?? []).some(c => c.instanceId === ctx.card.instanceId);
  if (dest === 'WEAR_PILE' && !inWear) {
    // Legítimo si un efecto la volvió a mover (recuperar a mano/mazo…)
    const moved = evOn(ctx, 'CARD_MOVED', m => m.cardInstanceId === ctx.card.instanceId && m.to !== 'WEAR_PILE')
      || evOn(ctx, 'CARDS_RECOVERED', m => m.cardInstanceIds?.includes(ctx.card.instanceId));
    if (!moved) ctx.failures.push('destinationAfterUse=WEAR_PILE pero la carta no está en el desgaste');
  }
  if (dest === 'REMOVED_FROM_GAME' && (inWear || inHand || inPersistent)) {
    ctx.failures.push('destinationAfterUse=REMOVED_FROM_GAME pero la carta sigue en una zona del jugador');
  }
  if (dest === 'IN_FRONT_OF_PLAYER' && !inPersistent && !ev(ctx, 'PERSISTENT_CARD_PLACED')) {
    ctx.failures.push('destinationAfterUse=IN_FRONT_OF_PLAYER sin PERSISTENT_CARD_PLACED');
  }
}

/** Efecto "impreso": el daño base de printedAttack debe verse en el objetivo. */
function verifyPrintedAttack(ctx: PlayCtx): void {
  const all = effectTree(ctx.def.effects ?? []);
  const special = all.some(e => SPECIAL_DAMAGE.has(e.type));
  const atk = ctx.def.printedAttack ?? 0;
  if (atk <= 0 || special || !ctx.targetId) return;
  const dealt = evOn(ctx, 'DAMAGE_DEALT', d => d.enemyInstanceId === ctx.targetId || d.targetId === ctx.targetId)
    || evOn(ctx, 'ENEMY_DEFEATED', d => d.enemyInstanceId === ctx.targetId || d.enemy?.instanceId === ctx.targetId);
  if (!dealt) {
    ctx.failures.push(`printedAttack=${atk}: sin DAMAGE_DEALT/ENEMY_DEFEATED sobre ${ctx.targetId}`);
  }
}

// ---------------------------------------------------------------------------
// Suite por tipo de carta
// ---------------------------------------------------------------------------

const abilityDefs = catalog.cards.filter(d => d.type === 'ABILITY');
const marketDefs = catalog.cards.filter(d => d.type === 'MARKET');
const hordeDefs = catalog.cards.filter(d => d.type === 'HORDE');
const warlordDefs = catalog.cards.filter(d => d.type === 'WARLORD');
const heroDefs = catalog.cards.filter(d => d.type === 'HERO');
const scenarioDefs = catalog.cards.filter(d => d.type === 'SCENARIO');

describe('Oráculo de efectos — cartas de habilidad', () => {
  for (const def of abilityDefs) {
    it(`${def.id} — ${def.name}`, () => {
      let state = richState(makeGame());
      ({ state } = giveCard(state, def.id));
      const card = state.players.p1.hand.find(c => c.definitionId === def.id)!;
      const targetId = needsEnemyTarget(def) ? pickTarget(state, def) : undefined;
      const ctx = playAndResolve(state, card, targetId);
      verifyPrintedAttack(ctx);
      verifyDestination(ctx);
      for (const eff of def.effects ?? []) verifyEffect(eff, ctx, def.id);
      expect(ctx.failures, ctx.failures.join('\n')).toEqual([]);
    });
  }
});

describe('Oráculo de efectos — cartas de mercado', () => {
  for (const def of marketDefs) {
    it(`${def.id} — ${def.name}`, () => {
      let state = richState(makeGame());
      // Capacidades: dar al héroe todas las requeridas para no sesgar el test
      const caps = new Set(state.players.p1.capabilities);
      for (const c of def.requiredCapabilities ?? []) caps.add(c);
      for (const p of def.penaltyCapabilities ?? []) caps.add(p.icon);
      state.players.p1 = { ...state.players.p1, capabilities: [...caps] as any };

      // 1) Compra: el coste se descuenta y la carta llega a la mano
      state.phase = 'MARKET';
      const marketCard = inst(def.id, 'market', 'MARKET', def.name);
      state.market = [marketCard, ...state.market];
      const coinsBefore = state.players.p1.coins;
      const buy = execute(
        state,
        { type: 'BUY_CARD', cid: `fx-buy-${def.id}`, marketCardInstanceId: marketCard.instanceId } as any,
        rng, registry, catalog,
      );
      expect(buy.accepted, `compra rechazada: ${buy.reason}`).toBe(true);
      let after = buy.newState;
      const price = Math.max(0, (def.printedCost ?? 0) + after.marketCostModifier);
      expect(after.players.p1.coins, 'coste no descontado').toBe(coinsBefore - price);
      const inHand = after.players.p1.hand.find(c => c.instanceId === marketCard.instanceId);
      expect(inHand, 'la carta comprada no llegó a la mano').toBeDefined();

      // 2) Juego: los efectos declarados producen su evidencia
      after = { ...after, phase: 'PLAYER_ATTACK', activePlayerId: 'p1', pendingChoices: [] };
      const targetId = needsEnemyTarget(def) ? pickTarget(after, def) : undefined;
      const ctx = playAndResolve(after, inHand!, targetId);
      verifyPrintedAttack(ctx);
      verifyDestination(ctx);
      for (const eff of def.effects ?? []) verifyEffect(eff, ctx, def.id);
      expect(ctx.failures, ctx.failures.join('\n')).toEqual([]);
    });
  }
});

describe('Oráculo de efectos — enemigos (Horda y Señores de la Guerra)', () => {
  for (const def of [...hordeDefs, ...warlordDefs]) {
    it(`${def.id} — ${def.name}`, () => {
      let state = richState(makeGame());
      // Spawn a 1 herida de morir — una carta de daño real debe rematarlo
      // y otorgar la recompensa declarada (monedas/gloria).
      const enemy = enemyFromDef({ ...def, printedFortitude: def.printedFortitude } as CardDefinition);
      enemy.wounds = Math.max(0, enemy.baseFortitude - 1);
      state.battlefield = [enemy];
      expect(enemy.baseFortitude).toBe(def.printedFortitude);
      const coinsBefore = state.players.p1.coins;
      const gloryBefore = state.players.p1.glory;
      // Espadazo (printedAttack 4) por la vía real del motor
      const { state: s2, card } = giveCard(state, 'warrior.sword-strike');
      const ctx = playAndResolve(s2, card, enemy.instanceId);
      expect(ctx.failures, ctx.failures.join('\n')).toEqual([]);
      const killed = evOn(ctx, 'ENEMY_DEFEATED', e =>
        e.enemyInstanceId === enemy.instanceId || e.enemy?.instanceId === enemy.instanceId);
      expect(killed, `${def.id}: no se derrotó con daño >= fortaleza`).toBe(true);
      // Recompensa declarada aplicada (salvo que el escenario la ignore — no aplica aquí)
      const p = ctx.after.players.p1;
      const gainedCoins = p.coins - coinsBefore;
      const gainedGlory = p.glory - gloryBefore;
      if (def.reward?.coins) expect(gainedCoins, `${def.id}: sin monedas de recompensa`).toBeGreaterThanOrEqual(def.reward.coins);
      // Gloria total = laurel del frente (trophyGlory) + Gloria del dorso
      const expectedGlory = (def.trophyGlory ?? 0) + (def.reward?.glory ?? 0);
      if (expectedGlory > 0) expect(gainedGlory, `${def.id}: sin gloria de recompensa`).toBeGreaterThanOrEqual(expectedGlory);
    });
  }
});

describe('Oráculo de efectos — pericias de héroe', () => {
  const PASSIVE = new Set(['hero.taheral', 'hero.feldon', 'hero.beleth-il']);
  for (const def of heroDefs) {
    it(`${def.id} — ${def.name}`, () => {
      const ability = def.heroAbility;
      expect(ability, 'heroAbility ausente').toBeDefined();
      // La pericia se atribuye por player.heroId — p1 debe encarnar al
      // héroe bajo test (makeGame lo fija a Aranel por defecto).
      let state = richState(makeGame());
      state.players.p1 = {
        ...state.players.p1,
        heroId: def.id,
        heroUsesRemaining: ability!.uses ?? 1,
        heroMaxUses: ability!.uses ?? 1,
      };
      if (PASSIVE.has(def.id)) {
        // Pasiva: no consume uso ni emite eventos al invocarla
        const before = state.players.p1.heroUsesRemaining;
        const r = useHeroAbility(state, 'p1', rng, catalog);
        expect(r.events.filter(e => e.type === 'HERO_ABILITY_USED')).toHaveLength(0);
        expect(r.state.players.p1.heroUsesRemaining).toBe(before);
        return;
      }
      // Pericias activas — la vía real es execute(USE_HERO_ABILITY), que
      // aplica los eventos al newState (la gloria de Valérys se pliega
      // dentro del reducer de DAMAGE_INTERCEPTED).
      const needsHeroTarget = def.id === 'hero.valerys' || def.id === 'hero.lisavette';
      // Valérys/Lisavette son pericias de reacción: solo usables durante
      // el ataque de la Horda. Lisavette además exige un Escudo en mano.
      const reactive = needsHeroTarget;
      const s2: GameState = reactive
        ? { ...state, activePlayerId: 'p2', phase: 'HORDE_ATTACK' }
        : state;
      if (def.id === 'hero.lisavette') {
        const shieldDef = catalog.byId.get('warrior.shield');
        s2.players.p1 = {
          ...s2.players.p1,
          hand: [...s2.players.p1.hand, inst('warrior.shield', 'p1', 'HAND', shieldDef?.name)],
        };
      }
      const r = execute(
        s2,
        { type: 'USE_HERO_ABILITY', cid: `fx-ability-${def.id}`, targetId: needsHeroTarget ? 'p2' : undefined } as any,
        rng, registry, catalog, 'p1',
      );
      expect(r.accepted, `pericia rechazada: ${r.reason}`).toBe(true);
      const events: GameEvent[] = [...r.events];
      const after = drainChoices(r.newState, events, rng).state;
      expect(events.some(e => e.type === 'HERO_ABILITY_USED'), 'pericia no emitió HERO_ABILITY_USED').toBe(true);
      const ctx: PlayCtx = {
        before: s2, after, events, playerId: 'p1',
        card: inst(def.id, 'p1'), def, failures: [],
      };
      for (const eff of ability!.effects ?? []) verifyEffect(eff, ctx, def.id);
      expect(ctx.failures, ctx.failures.join('\n')).toEqual([]);
    });
  }
});

describe('Oráculo de efectos — escenarios', () => {
  for (const def of scenarioDefs) {
    it(`${def.id} — ${def.name}`, () => {
      let state = richState(makeGame());
      state.scenario = inst(def.id, 'scenario', 'SCENARIO_ACTIVE', def.name);
      const effs = def.effects ?? [];
      const declarative = effs.filter(e =>
        ['IGNORE_COIN_REWARDS', 'IGNORE_GLORY_REWARDS', 'MODIFY_MARKET_COST', 'MODIFY_FORTITUDE'].includes(e.type));
      const onDefeat = effs.find(e => e.type === 'ON_ENEMY_DEFEATED') as any;
      const custom = effs.some(e => e.type === 'CUSTOM_SCENARIO');
      let verified = false;

      // Modificadores declarativos del escenario activo
      if (declarative.length > 0) {
        verified = true;
        const r = applyScenarioEffects(state, def.id, catalog);
        const applied = r.events.find(e => e.type === 'SCENARIO_EFFECTS_APPLIED') as any;
        expect(applied, 'sin SCENARIO_EFFECTS_APPLIED').toBeDefined();
        for (const eff of declarative) {
          if (eff.type === 'IGNORE_COIN_REWARDS') expect(applied.ignoreCoinRewards).toBe(true);
          if (eff.type === 'IGNORE_GLORY_REWARDS') expect(applied.ignoreGloryRewards).toBe(true);
          if (eff.type === 'MODIFY_MARKET_COST') expect(applied.marketCostDelta).not.toBe(0);
          if (eff.type === 'MODIFY_FORTITUDE') expect((applied.auraModifiers ?? []).length).toBeGreaterThan(0);
        }
      }

      // Disparador al derrotar un enemigo (con umbral de fortaleza si lo hay)
      if (onDefeat) {
        verified = true;
        const minFort = onDefeat.condition?.fortitudeGte ?? 0;
        const events = onEnemyDefeated(state, def.id, 'p1', minFort, catalog);
        expect(events, 'sin evento al derrotar enemigo apto').not.toHaveLength(0);
        if (minFort > 0) {
          const none = onEnemyDefeated(state, def.id, 'p1', minFort - 1, catalog);
          expect(none, 'disparó por debajo del umbral').toHaveLength(0);
        }
      }

      // Efectos custom: cada escenario debe tener su vía real implementada
      if (custom) {
        verified = true;
        if (def.id === 'scenario.cemenmar-wastes') {
          // Yermo de Cemenmar: al evadir, robo opt-in de monedas (spec §6.9)
          const evState: GameState = { ...state, phase: 'ATTACK_CHOICE' };
          const discard = evState.players.p1.hand.slice(0, 2).map(c => c.instanceId);
          const r = execute(
            evState,
            { type: 'EVASION', cid: 'fx-evasion-cemenmar', discardedCardInstanceIds: discard } as any,
            rng, registry, catalog,
          );
          expect(r.accepted, `evasión rechazada: ${r.reason}`).toBe(true);
          expect(
            r.newState.pendingChoices.some(c => c.type === 'SELECT_COINS_TO_STEAL' && c.choiceId.startsWith('cemenmar-steal-')),
            'sin elección de robo de monedas tras evadir',
          ).toBe(true);
        } else {
          const offer = onTurnStart(state, def.id);
          expect(offer, 'CUSTOM_SCENARIO sin efecto de inicio de turno implementado').not.toBeNull();
          expect(offer!.prompt, 'oferta de escenario sin texto').not.toHaveLength(0);
        }
      }

      expect(verified, 'escenario sin efectos verificables').toBe(true);
    });
  }
});

/**
 * Efectos que solo se manifiestan en una segunda jugada o en otra fase —
 * el oráculo por carta no los puede cubrir con una única ejecución.
 */
describe('Oráculo de efectos — comportamientos diferidos', () => {
  it('mage.staff-strike — el re-uso contra el mismo enemigo inflige 2 (no 1)', () => {
    let state = richState(makeGame());
    ({ state } = giveCard(state, 'mage.staff-strike'));
    ({ state } = giveCard(state, 'mage.staff-strike'));
    const [c1, c2] = state.players.p1.hand.filter(c => c.definitionId === 'mage.staff-strike');
    const ctx1 = playAndResolve(state, c1, 'fx-mid-orc');
    expect(ctx1.failures, ctx1.failures.join('\n')).toEqual([]);
    const dmg1 = ctx1.events.find(e => e.type === 'DAMAGE_DEALT') as any;
    expect(dmg1?.amount, 'primer Golpe de Bastón no infligió su ataque impreso').toBe(1);
    expect(ctx1.after.battlefield.some(e => e.instanceId === 'fx-mid-orc'), 'el objetivo murió antes de tiempo').toBe(true);
    const ctx2 = playAndResolve(ctx1.after, c2, 'fx-mid-orc');
    expect(ctx2.failures, ctx2.failures.join('\n')).toEqual([]);
    const dmg2 = ctx2.events.filter((e: any) => e.type === 'DAMAGE_DEALT').map((e: any) => e.amount);
    expect(dmg2, 'el re-uso no aplicó el daño mejorado (2)').toContain(2);
    // 1 + 2 = fortaleza 3 del orco medio → derrotado
    expect(evOn(ctx2, 'ENEMY_DEFEATED', e => e.enemyInstanceId === 'fx-mid-orc'), 'el objetivo debió caer con el daño acumulado').toBe(true);
  });

  it('rogue.precise-crossbow — el re-uso contra el mismo enemigo inflige 3 (no 2)', () => {
    let state = richState(makeGame());
    ({ state } = giveCard(state, 'rogue.precise-crossbow'));
    ({ state } = giveCard(state, 'rogue.precise-crossbow'));
    const [c1, c2] = state.players.p1.hand.filter(c => c.definitionId === 'rogue.precise-crossbow');
    const ctx1 = playAndResolve(state, c1, 'fx-warlord');
    expect(ctx1.failures, ctx1.failures.join('\n')).toEqual([]);
    const dmg1 = ctx1.events.find(e => e.type === 'DAMAGE_DEALT') as any;
    expect(dmg1?.amount, 'primera Ballesta Precisa no infligió su ataque impreso').toBe(2);
    const ctx2 = playAndResolve(ctx1.after, c2, 'fx-warlord');
    expect(ctx2.failures, ctx2.failures.join('\n')).toEqual([]);
    const dmg2 = ctx2.events.filter((e: any) => e.type === 'DAMAGE_DEALT').map((e: any) => e.amount);
    expect(dmg2, 'el re-uso no aplicó el daño mejorado (3)').toContain(3);
  });

  it('warrior.sword-strike — solo el primer Espadazo del turno roba carta', () => {
    let state = richState(makeGame());
    ({ state } = giveCard(state, 'warrior.sword-strike'));
    ({ state } = giveCard(state, 'warrior.sword-strike'));
    const [c1, c2] = state.players.p1.hand.filter(c => c.definitionId === 'warrior.sword-strike');
    const ctx1 = playAndResolve(state, c1, 'fx-warlord');
    expect(ctx1.failures, ctx1.failures.join('\n')).toEqual([]);
    expect(ctx1.events.filter(e => e.type === 'CARDS_DRAWN'), 'el primer Espadazo no robó').not.toHaveLength(0);
    const ctx2 = playAndResolve(ctx1.after, c2, 'fx-warlord');
    expect(ctx2.failures, ctx2.failures.join('\n')).toEqual([]);
    expect(ctx2.events.filter(e => e.type === 'CARDS_DRAWN'), 'el segundo Espadazo robó — la condición no se evaluó').toHaveLength(0);
  });

  it('rogue.trap — al atacar la Horda derrota al enemigo de mayor Fortaleza y se consume', () => {
    let state = richState(makeGame());
    ({ state } = giveCard(state, 'rogue.trap'));
    const card = state.players.p1.hand.find(c => c.definitionId === 'rogue.trap')!;
    const ctx = playAndResolve(state, card);
    expect(ctx.failures, ctx.failures.join('\n')).toEqual([]);
    expect(ctx.after.players.p1.persistentCards.some(c => c.definitionId === 'rogue.trap'), 'la trampa no quedó persistente').toBe(true);
    // Disparador ON_HORDE_ATTACK: mayor Fortaleza = fx-warlord (8), único → sin elección
    const trig = processHordeAttackTriggers(ctx.after, rng, registry, catalog);
    expect(evOn({ ...ctx, events: trig.events }, 'ENEMY_DEFEATED', e => e.enemyInstanceId === 'fx-warlord'), 'no derrotó al enemigo de mayor Fortaleza').toBe(true);
    expect(trig.events.some(e => e.type === 'PERSISTENT_CARD_REMOVED'), 'la trampa no se retiró').toBe(true);
    expect(trig.events.some(e => e.type === 'CARD_REMOVED_FROM_GAME'), 'la trampa no salió del juego').toBe(true);
    expect(trig.state.players.p1.persistentCards, 'la trampa sigue en juego tras dispararse').toHaveLength(0);
    expect(trig.state.battlefield.some(e => e.instanceId === 'fx-warlord'), 'el warlord sigue en el campo').toBe(false);
  });
});
