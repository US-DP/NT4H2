/**
 * cardWorkshop/decompile — CardEffect[] → EffectNode[] (inverso del compilador).
 *
 * Permite abrir cualquier carta del catálogo (oficial o importada) en el
 * editor con su árbol de efectos real, en vez de un borrador vacío.
 *
 * Cobertura lossless: todo el vocabulario del editor. Para expresiones o
 * condiciones que el editor no sabe representar (SUM complejas, filtros
 * minFortitude, AND/OR de 3+ ramas…) el nodo conserva el JSON serializado
 * en `rawExpr`/`condRaw` y el compilador lo reemite verbatim → la carta
 * nunca pierde efectos al guardarse. Cada degradación emite un diagnóstico
 * DECOMPILE_LOSSY visible en el panel de problemas.
 */

import type {
  CardEffect, CardDefinition, Condition, HeroSelector, TargetSelector, ValueExpr,
} from '@nt4h/schema';
import { nextNodeKey, type EffectNode, type TFunc, esT } from './model';
import type { WorkshopDiagnostic } from './compiler';

export interface DecompileResult {
  nodes: EffectNode[];
  diagnostics: WorkshopDiagnostic[];
}

type DiagFn = (
  code: string,
  severity: WorkshopDiagnostic['severity'],
  i18nKey: string,
  params?: Record<string, string>,
) => void;

// ============================================================================
// ValueExpr → amountMode/amount/varName/statusId (o 'raw' passthrough)
// ============================================================================

/** Reconoce `{kind:'MULTIPLY', factors:[C(k), X]}` (o el orden inverso). */
const multOf = (e: ValueExpr): { k: number; inner: ValueExpr } | null => {
  if (e.kind !== 'MULTIPLY' || e.factors.length !== 2) return null;
  const [a, b] = e.factors;
  if (a.kind === 'CONSTANT') return { k: a.value, inner: b };
  if (b.kind === 'CONSTANT') return { k: b.value, inner: a };
  return null;
};

/** SUM de N términos idénticos (catálogo: SUM(COUNT_LIVING_ENEMIES ×2)). */
const sumOfSame = (e: ValueExpr): { n: number; inner: ValueExpr } | null => {
  if (e.kind !== 'SUM' || e.of.length < 2) return null;
  const kinds = new Set(e.of.map(x => x.kind));
  if (kinds.size !== 1) return null;
  return { n: e.of.length, inner: e.of[0] };
};

function decompileValue(v: ValueExpr, n: EffectNode, diag: DiagFn): void {
  const raw = () => {
    n.amountMode = 'raw';
    n.rawExpr = JSON.stringify(v);
    diag('DECOMPILE_RAW_EXPR', 'info', 'workshop.diagDecompileRawExpr', { kind: v.kind });
  };
  switch (v.kind) {
    case 'CONSTANT': n.amountMode = 'fixed'; n.amount = String(v.value); return;
    case 'COUNT_LIVING_ENEMIES': n.amountMode = 'enemies'; return;
    case 'COUNT_ENEMIES_IN_FIELD': n.amountMode = 'fieldEnemies'; return;
    case 'EVASION_DISCARDED_COUNT': n.amountMode = 'evasion'; return;
    case 'FORTITUDE_OF':
      if (v.target.kind === 'SELECTED_ENEMY') { n.amountMode = 'fortitude'; return; }
      return raw();
    case 'HERO_STAT': {
      const map: Record<string, string> = {
        WOUNDS: 'heroWounds', COINS: 'heroCoins', GLORY: 'heroGlory',
        CARDS_IN_HAND: 'handCards', CARDS_IN_WEAR: 'wearCards',
        CARDS_PLAYED: 'playedCards', TROPHIES: 'trophies',
      };
      const mode = map[v.stat];
      if (mode && !v.hero) { n.amountMode = mode; return; }
      return raw();
    }
    case 'ENEMY_DAMAGE_OF':
      if (v.target.kind === 'SELECTED_ENEMY') { n.amountMode = 'enemyDamage'; return; }
      return raw();
    case 'ENEMY_WOUNDS_OF':
      if (v.target.kind === 'SELECTED_ENEMY') { n.amountMode = 'enemyWounds'; return; }
      return raw();
    case 'STATUS_STACKS_OF':
      if (v.target.kind === 'SELECTED_ENEMY') {
        n.amountMode = 'statusStacks'; n.statusId = v.status; return;
      }
      return raw();
    case 'DEFEATED_ENEMIES': n.amountMode = 'defeatedEnemies'; return;
    case 'VARIABLE':
      if (v.scope && v.scope !== 'RESOLUTION') {
        // El editor solo modela lectura de variables; el ámbito va implícito.
        diag('DECOMPILE_LOSSY', 'warning', 'workshop.diagDecompileLossy', { detail: `VARIABLE.scope=${v.scope}` });
      }
      n.amountMode = 'variable'; n.varName = v.name; return;
    case 'MULTIPLY': {
      const m = multOf(v);
      if (!m) return raw();
      const mode = multMode(m.inner);
      if (!mode) return raw();
      n.amountMode = mode; n.amount = String(m.k); return;
    }
    case 'SUM': {
      const s = sumOfSame(v);
      if (!s) return raw();
      const mode = multMode(s.inner);
      if (!mode) return raw();
      n.amountMode = mode; n.amount = String(s.n); return;
    }
    default: return raw();
  }
}

const multMode = (inner: ValueExpr): string | null => {
  switch (inner.kind) {
    case 'COUNT_LIVING_ENEMIES': return 'enemiesMult';
    case 'COUNT_ENEMIES_IN_FIELD': return 'fieldMult';
    case 'EVASION_DISCARDED_COUNT': return 'evasionMult';
    case 'HERO_STAT': {
      if (inner.hero) return null;
      const map: Record<string, string> = {
        WOUNDS: 'heroWoundsMult', COINS: 'heroCoinsMult', CARDS_IN_HAND: 'handCardsMult',
      };
      return map[inner.stat] ?? null;
    }
    default: return null;
  }
};

// ============================================================================
// Selectores y campos escalares
// ============================================================================

const decompileTarget = (sel: TargetSelector | undefined, n: EffectNode, diag: DiagFn) => {
  if (!sel) return;
  n.target = sel.kind;
  const f = 'filter' in sel ? sel.filter : undefined;
  if (f) {
    if (f.isOrc) n.orcOnly = true;
    if (f.minFortitude != null || f.isWarlord != null) {
      diag('DECOMPILE_LOSSY', 'warning', 'workshop.diagDecompileLossy',
        { detail: 'target.filter(minFortitude/isWarlord)' });
    }
  }
};

const decompileHero = (sel: HeroSelector | string | undefined, n: EffectNode) => {
  if (!sel) return;
  n.heroTarget = typeof sel === 'string' ? sel : sel.kind;
};

// ============================================================================
// Condition → condKind/condParam/condValue (+ NOT / AND·OR / RAW)
// ============================================================================

type CondParts = { id: string; param?: string; value?: string };

const COND_BY_KIND: Record<string, (c: Condition) => CondParts> = {
  HAS_CAPABILITY: (c) => ({ id: 'HAS_CAPABILITY', param: (c as { icon: string }).icon }),
  ENEMY_DEFEATED_BY_THIS_CARD: () => ({ id: 'ENEMY_DEFEATED_BY_THIS_CARD' }),
  ENEMY_FORTITUDE_GTE: (c) => ({ id: 'ENEMY_FORTITUDE_GTE', param: String((c as { value: number }).value) }),
  FIRST_CARD_OF_NAME_THIS_TURN: (c) => ({ id: 'FIRST_CARD_OF_NAME_THIS_TURN', param: (c as { name: string }).name }),
  ALREADY_USED_AGAINST_THIS_ENEMY: (c) => ({ id: 'ALREADY_USED_AGAINST_THIS_ENEMY', param: (c as { name: string }).name }),
  HAS_CARD_IN_HAND: (c) => ({ id: 'HAS_CARD_IN_HAND', param: (c as { name: string }).name }),
  ENEMY_COUNT_GTE: (c) => ({ id: 'ENEMY_COUNT_GTE', param: String((c as { value: number }).value) }),
  ENEMY_COUNT_LTE: (c) => ({ id: 'ENEMY_COUNT_LTE', param: String((c as { value: number }).value) }),
  ENEMY_IS_ORC: () => ({ id: 'ENEMY_IS_ORC' }),
  ENEMY_IS_WARLORD: () => ({ id: 'ENEMY_IS_WARLORD' }),
  ENEMY_IS_UNHARMED: () => ({ id: 'ENEMY_IS_UNHARMED' }),
  ENEMY_HAS_STATUS: (c) => ({ id: 'ENEMY_HAS_STATUS', param: (c as { status: string }).status }),
  VARIABLE_GTE: (c) => ({ id: 'VARIABLE_GTE', param: (c as { name: string }).name, value: String((c as { value: number }).value) }),
  VARIABLE_LTE: (c) => ({ id: 'VARIABLE_LTE', param: (c as { name: string }).name, value: String((c as { value: number }).value) }),
  VARIABLE_EQ: (c) => ({ id: 'VARIABLE_EQ', param: (c as { name: string }).name, value: String((c as { value: number }).value) }),
};

const HERO_STAT_COND: Record<string, { GTE?: string; LTE?: string }> = {
  WOUNDS: { GTE: 'HERO_WOUNDS_GTE', LTE: 'HERO_WOUNDS_LTE' },
  COINS: { GTE: 'HERO_COINS_GTE' },
  GLORY: { GTE: 'HERO_GLORY_GTE' },
  CARDS_IN_HAND: { GTE: 'HAND_GTE' },
};

/** Condición simple → partes editables; null si no es representable. */
function condParts(c: Condition): CondParts | null {
  switch (c.kind) {
    case 'HERO_STAT_GTE': {
      const id = HERO_STAT_COND[c.stat]?.GTE;
      return id ? { id, param: String(c.value) } : null;
    }
    case 'HERO_STAT_LTE': {
      const id = HERO_STAT_COND[c.stat]?.LTE;
      return id ? { id, param: String(c.value) } : null;
    }
    case 'AND': case 'OR': case 'NOT':
      return null;
    default: {
      const fn = COND_BY_KIND[c.kind];
      return fn ? fn(c) : null;
    }
  }
}

const applyParts = (p: CondParts, n: EffectNode, suffix: '' | '2') => {
  if (suffix === '2') {
    n.condKind2 = p.id;
    if (p.param != null) n.condParam2 = p.param;
    if (p.value != null) n.condValue2 = p.value;
  } else {
    n.condKind = p.id;
    if (p.param != null) n.condParam = p.param;
    if (p.value != null) n.condValue = p.value;
  }
};

function decompileCondition(c: Condition, n: EffectNode, diag: DiagFn): void {
  let inner = c;
  if (inner.kind === 'NOT') {
    n.condNot = true;
    inner = inner.condition;
  }
  if ((inner.kind === 'AND' || inner.kind === 'OR') && inner.conditions.length === 2) {
    const [a, b] = inner.conditions.map(condParts);
    if (a && b) {
      n.condJoin = inner.kind;
      applyParts(a, n, '');
      applyParts(b, n, '2');
      return;
    }
    // AND/OR de 3+ ramas o con ramas no simples → passthrough del conjunto.
    n.condKind = 'RAW'; n.condRaw = JSON.stringify(inner);
    diag('DECOMPILE_RAW_COND', 'info', 'workshop.diagDecompileRawCond', { kind: inner.kind });
    return;
  }
  const parts = condParts(inner);
  if (parts) {
    applyParts(parts, n, '');
  } else {
    // NOT ya consumido arriba: conservar la condición INTERNA y el flag.
    n.condKind = 'RAW'; n.condRaw = JSON.stringify(inner);
    diag('DECOMPILE_RAW_COND', 'info', 'workshop.diagDecompileRawCond', { kind: inner.kind });
  }
}

// ============================================================================
// Acciones → ACTION
// ============================================================================

function decompileAction(e: CardEffect, n: EffectNode, diag: DiagFn): void {
  n.actionType = e.type;
  const ve = (v: ValueExpr | undefined | null) => {
    if (v && typeof v === 'object') decompileValue(v, n, diag);
  };
  switch (e.type) {
    case 'DEAL_DAMAGE': ve(e.amount); decompileTarget(e.target, n, diag); break;
    case 'DEAL_DAMAGE_ALL_ENEMIES': ve(e.amount); break;
    case 'DEAL_DAMAGE_SPLIT': ve(e.amount); n.targetCount = String(e.targetCount); decompileTarget(e.target, n, diag); break;
    case 'DEAL_DAMAGE_TO_HERO': ve(e.amount); decompileHero(e.target, n); break;
    case 'DEAL_DAMAGE_TO_OTHER_HEROES': ve(e.amount); break;
    case 'PREVENT_DAMAGE': ve(e.amount); n.duration = e.duration; break;
    case 'PREVENT_ENEMY_DAMAGE': decompileTarget(e.target, n, diag); n.duration = e.duration; break;
    case 'CANCEL_ALL_DAMAGE': n.duration = e.duration; break;
    case 'SHIELD': case 'LOSE_CARDS': case 'SEARCH_WEAR_PILE_PUT_IN_HAND':
    case 'GAIN_GLORY': case 'HEAL_WOUNDS': case 'ALL_HEROES_RECOVER':
    case 'OTHER_HEROES_RECOVER': case 'DRAW_FROM_BOTTOM': case 'BLOCK_NEXT_DAMAGE':
      ve(e.amount); break;
    case 'DRAW_CARDS': {
      ve(e.amount);
      if (e.source && e.source !== 'ABILITY_DECK') {
        diag('DECOMPILE_LOSSY', 'warning', 'workshop.diagDecompileLossy', { detail: `source=${e.source}` });
      }
      break;
    }
    case 'DRAW_AND_ADD_ATTACK': ve(e.amount); break;
    case 'RECOVER_CARDS': ve(e.amount); n.to = e.to; break;
    case 'GAIN_COINS': {
      ve(e.amount);
      const tgt = e.target;
      if (typeof tgt === 'string') n.heroTarget = tgt;
      else if (tgt) n.heroTarget = tgt.kind;
      break;
    }
    case 'STEAL_COINS': ve(e.amount); decompileHero(e.from, n); break;
    case 'COST': ve(e.amount); n.resource = e.resource; break;
    case 'MODIFY_DAMAGE': {
      ve(e.modifier); n.scope = e.scope;
      if (e.filter) diag('DECOMPILE_LOSSY', 'warning', 'workshop.diagDecompileLossy', { detail: 'MODIFY_DAMAGE.filter' });
      break;
    }
    case 'MODIFY_FORTITUDE': ve(e.modifier); decompileTarget(e.target, n, diag); n.duration = e.duration; break;
    case 'MODIFY_MARKET_COST': ve(e.modifier); break;
    case 'DISABLE_ENEMY_DAMAGE': decompileTarget(e.target, n, diag); n.duration = e.duration; break;
    case 'APPLY_VULNERABILITY': ve(e.bonus); decompileTarget(e.target, n, diag); n.duration = e.duration; break;
    case 'DEFEAT_ENEMY': decompileTarget(e.target, n, diag); n.loot = e.loot ? 'kept' : 'lost'; break;
    case 'RETURN_TO_HORDE': decompileTarget(e.target, n, diag); break;
    case 'RECOVER_THIS_CARD': n.to = e.to; break;
    case 'REMOVE_FROM_GAME': case 'END_ATTACK': case 'IGNORE_COIN_REWARDS':
    case 'IGNORE_GLORY_REWARDS': case 'PLAY_RANDOM_CARD_FROM_OTHER_HERO': {
      if (e.type === 'PLAY_RANDOM_CARD_FROM_OTHER_HERO' && (e.costGlory ?? e.cost_glory)) {
        diag('DECOMPILE_LOSSY', 'warning', 'workshop.diagDecompileLossy', { detail: 'costGlory' });
      }
      break;
    }
    case 'LOOK_AT_CARDS': ve(e.amount); break;
    case 'SHUFFLE_DECK': n.searchDeck = e.deck; break;
    case 'SEARCH_DECK': {
      if (e.filter.name) n.cardName = e.filter.name;
      if (e.filter.definitionId) {
        diag('DECOMPILE_LOSSY', 'warning', 'workshop.diagDecompileLossy', { detail: 'SEARCH_DECK.definitionId' });
      }
      n.searchAction = e.action;
      if (e.deck) n.searchDeck = e.deck;
      if (e.amount != null) n.targetCount = String(e.amount);
      break;
    }
    case 'RECOVER_CARD_BY_NAME': n.cardName = e.name; n.to = e.to; break;
    case 'SWAP_ENEMY': decompileTarget(e.target, n, diag); break;
    case 'INTERCEPT_DAMAGE': decompileHero(e.from, n); break;
    case 'PLAY_IMMEDIATELY': n.inheritTarget = e.inheritTarget; break;
    case 'CUSTOM_SCENARIO': n.cardName = e.handler; break;
    case 'STEAL_COINS_MULTIPLE': {
      const mt = e.maxTotal ?? e.max_total;
      if (mt) decompileValue(mt, n, diag);
      if (e.maxPerHero ?? e.max_per_hero) {
        diag('DECOMPILE_LOSSY', 'warning', 'workshop.diagDecompileLossy', { detail: 'maxPerHero' });
      }
      break;
    }
    case 'DEAL_DAMAGE_HITS': {
      ve(e.amount);
      if (e.times.kind === 'CONSTANT') n.times = String(e.times.value);
      else diag('DECOMPILE_LOSSY', 'warning', 'workshop.diagDecompileLossy', { detail: 'DEAL_DAMAGE_HITS.times' });
      decompileTarget(e.target, n, diag); break;
    }
    case 'EXECUTE_ENEMY': ve(e.threshold); decompileTarget(e.target, n, diag); n.loot = e.loot ? 'kept' : 'lost'; break;
    case 'OVERKILL_DAMAGE': {
      ve(e.amount); decompileTarget(e.target, n, diag);
      n.spillTarget = e.spill.kind;
      break;
    }
    case 'SPAWN_ENEMY': n.amountMode = 'fixed'; n.amount = String(e.count); break;
    case 'DISCARD_HORDE_CARD': n.amountMode = 'fixed'; n.amount = String(e.count); n.hordeDir = e.from; break;
    case 'MOVE_HORDE_CARDS': n.amountMode = 'fixed'; n.amount = String(e.count); n.hordeDir = e.to; break;
    case 'DRAW_UP_TO': n.amountMode = 'fixed'; n.amount = String(e.limit); break;
    case 'TAKE_WOUNDS': ve(e.amount); decompileHero(e.hero, n); break;
    case 'GRANT_ARMOR': {
      ve(e.amount);
      // El compilador fija UNTIL_END_OF_TURN: otra duración se pierde.
      if (e.duration !== 'UNTIL_END_OF_TURN') {
        diag('DECOMPILE_LOSSY', 'warning', 'workshop.diagDecompileLossy', { detail: `GRANT_ARMOR.duration=${e.duration}` });
      }
      break;
    }
    case 'MOVE_CARD': ve(e.count); n.moveFrom = e.from; n.moveTo = e.to; break;
    case 'APPLY_STATUS': {
      statusIdOf(e.status, n); ve(e.stacks);
      n.duration = e.duration === 'UNTIL_END_OF_TURN' ? 'UNTIL_END_OF_TURN' : 'PERMANENT';
      decompileTarget(e.target, n, diag); break;
    }
    case 'INCREASE_STATUS': statusIdOf(e.status, n); ve(e.amount); decompileTarget(e.target, n, diag); break;
    case 'REMOVE_STATUS': statusIdOf(e.status, n); decompileTarget(e.target, n, diag); break;
    case 'SET_VARIABLE': {
      n.varName = e.name; ve(e.value);
      n.varScope = e.scope === 'GAME' ? 'GAME' : 'RESOLUTION';
      break;
    }
    case 'REMOVE_LISTENER': n.varName = e.tag; break;
    case 'DISCARD_FROM_HAND': ve(e.count); break;
    default: {
      // Efecto fuera del vocabulario del editor: no debería pasar (Zod lo
      // rechaza antes), pero nunca descartar en silencio.
      const unk = e as { type: string };
      diag('DECOMPILE_UNKNOWN', 'error', 'workshop.diagDecompileUnknown', { type: unk.type });
      n.actionType = '__unknown__';
      n.rawExpr = JSON.stringify(e);
      break;
    }
  }
}

function statusIdOf(status: string, n: EffectNode): void {
  const known = ['mark', 'stun', 'poison'];
  if (known.includes(status)) n.statusId = status;
  else { n.statusId = 'custom'; n.cardName = status; }
}

// ============================================================================
// Contenedores (recursivo)
// ============================================================================

function decompileNode(e: CardEffect, path: string, diags: WorkshopDiagnostic[], t: TFunc): EffectNode | null {
  const n: EffectNode = { key: nextNodeKey(), kind: 'ACTION' };
  const diag: DiagFn = (code, severity, i18nKey, params) =>
    diags.push({ severity, code, path, nodeKey: n.key, message: t(i18nKey, params ?? {}) });
  const kids = (list: CardEffect[] | undefined, segFn: (i: number) => string): EffectNode[] =>
    (list ?? [])
      .map((c, i) => decompileNode(c, `${path} → ${segFn(i)}`, diags, t))
      .filter((x): x is EffectNode => x !== null);

  switch (e.type) {
    case 'CONDITIONAL': {
      n.kind = 'COND';
      decompileCondition(e.condition, n, diag);
      n.thenN = kids(e.then, i => `entonces[${i}]`);
      n.elseN = kids(e.else, i => `sino[${i}]`);
      return n;
    }
    case 'REPEAT': {
      n.kind = 'REPEAT';
      if (e.times.kind === 'CONSTANT') { n.timesMode = 'fixed'; n.times = String(e.times.value); }
      else if (e.times.kind === 'COUNT_LIVING_ENEMIES') n.timesMode = 'enemies';
      else if (e.times.kind === 'COUNT_ENEMIES_IN_FIELD') n.timesMode = 'fieldEnemies';
      else {
        n.timesMode = 'raw'; n.rawExpr = JSON.stringify(e.times);
        diag('DECOMPILE_RAW_EXPR', 'info', 'workshop.diagDecompileRawExpr', { kind: e.times.kind });
      }
      n.max = String(e.max);
      n.children = kids(e.effects, i => `hijos[${i}]`);
      return n;
    }
    case 'CHOOSE_ONE': {
      n.kind = 'CHOOSE';
      n.prompt = e.prompt;
      n.optional = e.optional;
      n.options = e.options.map((o, oi) => ({
        label: o.label ?? '',
        children: kids(o.effects, i => `opción ${oi + 1}[${i}]`),
      }));
      return n;
    }
    case 'ON_DEFEAT': n.kind = 'ON_DEFEAT'; n.children = kids(e.effects, i => `hijos[${i}]`); return n;
    case 'ON_HORDE_ATTACK': n.kind = 'ON_HORDE'; n.children = kids(e.effects, i => `hijos[${i}]`); return n;
    case 'ON_ENEMY_DEFEATED': {
      n.kind = 'ON_ENEMY_DEF';
      n.children = kids(e.effects, i => `hijos[${i}]`);
      const fg = e.condition?.fortitudeGte;
      if (fg != null) n.fortitudeGte = String(fg);
      return n;
    }
    case 'PLACE_PERSISTENT': {
      n.kind = 'PERSISTENT';
      n.persistTrigger = e.trigger;
      n.children = kids(e.effects, i => `hijos[${i}]`);
      return n;
    }
    case 'DRAW_AND_CHECK': {
      n.kind = 'DRAW_CHECK';
      decompileValue(e.amount, n, diag);
      const expected = e.expectedName ?? e.expected_name;
      if (expected) n.cardName = expected;
      if (e.expectedCard) n.cardRef = e.expectedCard;
      n.thenN = kids(e.onMatch ?? e.on_match, i => `entonces[${i}]`);
      n.elseN = kids(e.onMismatch ?? e.on_mismatch, i => `sino[${i}]`);
      return n;
    }
    case 'FOR_EACH': {
      n.kind = 'FOR_EACH';
      n.collection = e.collection;
      n.children = kids(e.effects, i => `hijos[${i}]`);
      return n;
    }
    case 'TRY_EFFECT': {
      n.kind = 'TRY';
      n.children = kids(e.effects, i => `hijos[${i}]`);
      n.elseN = kids(e.onFailure, i => `sino[${i}]`);
      return n;
    }
    case 'REGISTER_LISTENER': {
      n.kind = 'LISTEN';
      n.listenEvent = e.event;
      n.once = e.once || undefined;
      n.duration = e.duration;
      if (e.tag) n.listenTag = e.tag;
      n.children = kids(e.effects, i => `hijos[${i}]`);
      return n;
    }
    default:
      decompileAction(e, n, diag);
      return n;
  }
}

/** Decompila una lista de efectos a nodos raíz del editor. */
export function decompileEffects(effects: CardEffect[] | undefined, t: TFunc = esT): DecompileResult {
  const diags: WorkshopDiagnostic[] = [];
  const nodes = (effects ?? [])
    .map((e, i) => decompileNode(e, `raíz[${i}]`, diags, t))
    .filter((x): x is EffectNode => x !== null);
  return { nodes, diagnostics: diags };
}

/** Decompila las 3 zonas de efecto de una carta a campos del borrador. */
export function decompileCard(card: CardDefinition, t: TFunc = esT): {
  nodes: EffectNode[];
  abilityNodes: EffectNode[];
  abilityUses: string;
  peritiaNodes: EffectNode[];
  peritiaTrigger: '' | 'DAMAGE_DEALT' | 'CARD_PLAYED' | 'CONTINUOUS';
  peritiaCondition: string;
  diagnostics: WorkshopDiagnostic[];
} {
  const main = decompileEffects(card.effects, t);
  const ability = decompileEffects(card.heroAbility?.effects, t);
  const peritia = decompileEffects(card.peritia?.effects, t);
  const trigger = card.peritia?.trigger;
  return {
    nodes: main.nodes,
    abilityNodes: ability.nodes,
    abilityUses: String(card.heroAbility?.uses ?? 1),
    peritiaNodes: peritia.nodes,
    peritiaTrigger:
      trigger === 'DAMAGE_DEALT' || trigger === 'CARD_PLAYED' || trigger === 'CONTINUOUS'
        ? trigger : '',
    peritiaCondition: card.peritia?.condition ?? '',
    diagnostics: [...main.diagnostics, ...ability.diagnostics, ...peritia.diagnostics],
  };
}
