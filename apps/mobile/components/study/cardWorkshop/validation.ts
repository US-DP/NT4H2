/**
 * cardWorkshop/validation — avisos de balance + diagnósticos semánticos.
 *
 * Extraído de CreateCardTab.tsx (refactor Fase 2) y ampliado (Fase 1):
 * - balanceWarnings: recorre TODO el árbol compilado (nested incluido) y
 *   avisa de magnitudes sin sentido o extremas. Nunca bloquea.
 * - semanticDiagnostics: cruces de árbol completo (variables, listeners,
 *   combos potencialmente infinitos, complejidad) que Zod no puede ver.
 */

import { MAX_EFFECT_DEPTH, MAX_EFFECT_NODES, type CardEffect } from '@nt4h/schema';
import {
  countNodes, maxDepth, num, walkNodes, esT,
  type EffectNode, type TFunc,
} from './model';
import { buildEffects } from './compiler';
import type { WorkshopDiagnostic } from './compiler';

// ============================================================================
// Avisos de balance (no bloquean: el Taller permite valores libres)
// ============================================================================

/** Efectos cuya cantidad debe ser > 0 para que el efecto tenga sentido. */
const MAGNITUDE_EFFECTS = new Set([
  'DEAL_DAMAGE', 'DEAL_DAMAGE_ALL_ENEMIES', 'DEAL_DAMAGE_SPLIT',
  'DEAL_DAMAGE_TO_HERO', 'DEAL_DAMAGE_TO_OTHER_HEROES',
  'PREVENT_DAMAGE', 'SHIELD', 'DRAW_CARDS', 'LOSE_CARDS', 'RECOVER_CARDS',
  'SEARCH_WEAR_PILE_PUT_IN_HAND', 'GAIN_COINS', 'GAIN_GLORY', 'STEAL_COINS',
  'HEAL_WOUNDS', 'COST', 'APPLY_VULNERABILITY', 'ALL_HEROES_RECOVER',
  'OTHER_HEROES_RECOVER', 'LOOK_AT_CARDS', 'DRAW_AND_ADD_ATTACK',
  'DRAW_AND_CHECK', 'STEAL_COINS_MULTIPLE',
  // Extensiones del Taller
  'DEAL_DAMAGE_HITS', 'OVERKILL_DAMAGE', 'EXECUTE_ENEMY', 'DRAW_FROM_BOTTOM',
  'DRAW_UP_TO', 'TAKE_WOUNDS', 'GRANT_ARMOR', 'MOVE_CARD',
  'APPLY_STATUS', 'INCREASE_STATUS',
  'BLOCK_NEXT_DAMAGE', 'DISCARD_FROM_HAND', 'SPAWN_ENEMY',
  'DISCARD_HORDE_CARD', 'MOVE_HORDE_CARDS',
]);
const MODIFIER_EFFECTS = new Set(['MODIFY_DAMAGE', 'MODIFY_FORTITUDE', 'MODIFY_MARKET_COST']);
/**
 * Perfil de balance por tipo de efecto (§11): un daño de 10 es enorme,
 * pero 10 cartas movidas no lo es tanto. Umbral de "potencia extrema"
 * por tipo — se avisa pero se permite (sandbox); fallback 25.
 */
const BALANCE_LIMITS: Record<string, number> = {
  DEAL_DAMAGE: 10, DEAL_DAMAGE_HITS: 8, DEAL_DAMAGE_ALL_ENEMIES: 6,
  DEAL_DAMAGE_SPLIT: 12, DEAL_DAMAGE_TO_HERO: 5, DEAL_DAMAGE_TO_OTHER_HEROES: 5,
  OVERKILL_DAMAGE: 8, EXECUTE_ENEMY: 15,
  SHIELD: 8, BLOCK_NEXT_DAMAGE: 10, PREVENT_DAMAGE: 10, GRANT_ARMOR: 5,
  HEAL_WOUNDS: 6, TAKE_WOUNDS: 6, ALL_HEROES_RECOVER: 5, OTHER_HEROES_RECOVER: 5,
  DRAW_CARDS: 6, DRAW_FROM_BOTTOM: 5, DRAW_UP_TO: 6, LOOK_AT_CARDS: 6,
  DRAW_AND_ADD_ATTACK: 4, DRAW_AND_CHECK: 6, LOSE_CARDS: 5, RECOVER_CARDS: 5,
  SEARCH_WEAR_PILE_PUT_IN_HAND: 4, DISCARD_FROM_HAND: 5, MOVE_CARD: 5,
  GAIN_COINS: 10, STEAL_COINS: 6, STEAL_COINS_MULTIPLE: 5, GAIN_GLORY: 6,
  COST: 15, MODIFY_DAMAGE: 8, MODIFY_FORTITUDE: 6, MODIFY_MARKET_COST: 10,
  APPLY_STATUS: 5, INCREASE_STATUS: 5, APPLY_VULNERABILITY: 5,
  DISCARD_HORDE_CARD: 5, MOVE_HORDE_CARDS: 5,
};
const EXTREME_VALUE = 25; // fallback para efectos sin perfil propio

const collectConstants = (v: unknown): number[] => {
  if (!v || typeof v !== 'object') return [];
  const o = v as { kind?: string; value?: number; factors?: unknown[]; of?: unknown[] };
  const out: number[] = [];
  if (o.kind === 'CONSTANT' && typeof o.value === 'number') out.push(o.value);
  for (const list of [o.factors, o.of]) {
    if (Array.isArray(list)) for (const item of list) out.push(...collectConstants(item));
  }
  return out;
};

const effectAmounts = (eff: CardEffect): number[] => {
  const e = eff as Record<string, unknown>;
  const out: number[] = [];
  for (const key of ['amount', 'modifier', 'bonus', 'maxTotal', 'times', 'threshold', 'stacks', 'limit', 'count'] as const) {
    const v = e[key];
    if (typeof v === 'number') out.push(v);
    else out.push(...collectConstants(v));
  }
  return out;
};

export const collectAllEffects = (list: CardEffect[]): CardEffect[] => {
  const out: CardEffect[] = [];
  const stack = [...list];
  while (stack.length) {
    const e = stack.pop()!;
    out.push(e);
    const c = e as CardEffect & {
      effects?: CardEffect[]; then?: CardEffect[]; else?: CardEffect[];
      onMatch?: CardEffect[]; onMismatch?: CardEffect[]; onFailure?: CardEffect[];
      options?: { effects?: CardEffect[] }[];
    };
    for (const key of ['effects', 'then', 'else', 'onMatch', 'onMismatch', 'onFailure'] as const) {
      if (Array.isArray(c[key])) stack.push(...(c[key] as CardEffect[]));
    }
    if (Array.isArray(c.options)) {
      for (const o of c.options) if (Array.isArray(o.effects)) stack.push(...o.effects);
    }
  }
  return out;
};

/**
 * Avisos de balance sobre los efectos del borrador. Nunca bloquean el
 * guardado: el Taller permite magnitudes libres (¿robar 99? se puede),
 * pero avisa de degenerados (≤0 donde no tiene sentido) y extremos.
 */
export function balanceWarnings(effects: CardEffect[], t: TFunc = esT): string[] {
  const warns: string[] = [];
  const labelKeys: Record<string, string> = {
    DEAL_DAMAGE: 'balanceDamage', PREVENT_DAMAGE: 'balancePrevention', SHIELD: 'balanceShield',
    DRAW_CARDS: 'balanceCardDraw', LOSE_CARDS: 'balanceCardLoss',
    GAIN_COINS: 'balanceCoinGain', GAIN_GLORY: 'balanceGloryGain',
    HEAL_WOUNDS: 'balanceHealing', RECOVER_CARDS: 'balanceRecovery',
    DEAL_DAMAGE_HITS: 'balanceHits', OVERKILL_DAMAGE: 'balanceOverkillDamage',
    EXECUTE_ENEMY: 'balanceExecutionThreshold', DRAW_FROM_BOTTOM: 'balanceBottomDraw',
    DRAW_UP_TO: 'balanceDrawUpTo', TAKE_WOUNDS: 'balanceWounds', GRANT_ARMOR: 'balanceArmor',
    MOVE_CARD: 'balanceCardMove', APPLY_STATUS: 'balanceStatusStacks',
    INCREASE_STATUS: 'balanceStatusIncrease',
    BLOCK_NEXT_DAMAGE: 'balanceBlock', DISCARD_FROM_HAND: 'balanceDiscard',
  };
  for (const eff of collectAllEffects(effects)) {
    const key = labelKeys[eff.type];
    const name = key ? t(`workshop.${key}`) : eff.type;
    for (const v of effectAmounts(eff)) {
      if (MAGNITUDE_EFFECTS.has(eff.type) && v <= 0) {
        warns.push(t('workshop.warnNoEffectOrReverse', { name, value: v }));
      } else if (MODIFIER_EFFECTS.has(eff.type) && v === 0) {
        warns.push(t('workshop.warnZeroModifier', { name }));
      }
      if (Math.abs(v) > (BALANCE_LIMITS[eff.type] ?? EXTREME_VALUE)) {
        warns.push(t('workshop.warnExtremePower', { name, value: v }));
      }
    }
  }
  return warns;
}

// ============================================================================
// Corrección automática segura (§10.2): solo cuando el arreglo es obvio y
// no cambia la intención de la carta. Devuelve null si no hay arreglo seguro.
// ============================================================================
export function quickFixFor(code: string, node: EffectNode): Partial<EffectNode> | null {
  switch (code) {
    case 'EMPTY_STATUS_ID': return { statusId: 'mark' };
    case 'EMPTY_VAR_NAME': return { varName: 'v1' };
    case 'LISTENER_NO_TAG': return { listenTag: `tag-${node.key}` };
    case 'REPEAT_ZERO': return { timesMode: 'fixed', times: '1' };
    case 'REPEAT_NO_MAX': return { max: '10' };
    case 'SAME_ZONE':
      return { moveTo: node.moveFrom === 'WEAR_PILE' ? 'HAND' : 'WEAR_PILE' };
    default: return null;
  }
}

// ============================================================================
// Diagnósticos semánticos (cruces de árbol completo — Zod no los ve)
// ============================================================================

export interface SemanticOpts {
  /** Nombres de carta conocidos (catálogo oficial + sets custom) para
   *  validar referencias SEARCH_DECK/RECOVER_CARD_BY_NAME/DRAW_CHECK. */
  knownCardNames?: Set<string>;
  /** Handlers CUSTOM_SCENARIO registrados en el motor (lista permitida). */
  knownHandlers?: Set<string>;
}

const VAR_COND_KINDS = new Set(['VARIABLE_GTE', 'VARIABLE_LTE', 'VARIABLE_EQ']);
const CARD_NAME_ACTIONS = new Set(['SEARCH_DECK', 'RECOVER_CARD_BY_NAME']);
const STATUS_ACTIONS = new Set(['APPLY_STATUS', 'INCREASE_STATUS', 'REMOVE_STATUS']);
const ENEMY_TARGETED = new Set([
  'DEAL_DAMAGE', 'DEAL_DAMAGE_SPLIT', 'DEAL_DAMAGE_HITS', 'OVERKILL_DAMAGE',
  'EXECUTE_ENEMY', 'PREVENT_ENEMY_DAMAGE', 'MODIFY_FORTITUDE', 'DEFEAT_ENEMY',
  'APPLY_VULNERABILITY', 'RETURN_TO_HORDE', 'SWAP_ENEMY', 'DISABLE_ENEMY_DAMAGE',
  'APPLY_STATUS', 'INCREASE_STATUS', 'REMOVE_STATUS',
]);

/**
 * Análisis semántico del árbol del borrador. Emite WorkshopDiagnostic
 * con path 'carta' para problemas de nivel carta (variables, combos) —
 * el path por nodo lo cubre el compilador.
 */
export function semanticDiagnostics(
  nodes: EffectNode[],
  t: TFunc = esT,
  opts: SemanticOpts = {},
): WorkshopDiagnostic[] {
  const diags: WorkshopDiagnostic[] = [];
  const root = (d: Omit<WorkshopDiagnostic, 'path'>) =>
    diags.push({ ...d, path: 'carta' });
  const at = (key: number, d: Omit<WorkshopDiagnostic, 'path' | 'nodeKey'>) =>
    diags.push({ ...d, path: `nodo #${key}`, nodeKey: key });

  // --- Variables: definidas vs leídas (orden de documento) ------------------
  const defined = new Set<string>();
  const reads: { name: string; key: number }[] = [];
  const definedOrder: { name: string; key: number }[] = [];
  walkNodes(nodes, (n) => {
    if (n.kind === 'ACTION' && n.actionType === 'SET_VARIABLE') {
      const name = n.varName?.trim();
      if (name) { defined.add(name); definedOrder.push({ name, key: n.key }); }
    }
    if (n.amountMode === 'variable' && n.varName?.trim()) {
      reads.push({ name: n.varName.trim(), key: n.key });
    }
    if (n.kind === 'COND' && VAR_COND_KINDS.has(n.condKind ?? '') && n.condParam?.trim()) {
      reads.push({ name: n.condParam.trim(), key: n.key });
    }
  });
  for (const r of reads) {
    if (!defined.has(r.name)) {
      at(r.key, {
        severity: 'warning', code: 'VARIABLE_NEVER_SET',
        message: t('workshop.diagVarNeverSet', { name: r.name }),
      });
    } else {
      const firstDef = definedOrder.find((d) => d.name === r.name);
      // Lectura antes de la primera asignación (orden del documento ≈ orden
      // de ejecución en el resolver, salvo ramas condicionales).
      if (firstDef && r.key < firstDef.key) {
        at(r.key, {
          severity: 'warning', code: 'VARIABLE_READ_BEFORE_SET',
          message: t('workshop.diagVarReadBeforeSet', { name: r.name }),
        });
      }
    }
  }
  for (const d of definedOrder) {
    if (!reads.some((r) => r.name === d.name)) {
      at(d.key, {
        severity: 'info', code: 'VARIABLE_NEVER_READ',
        message: t('workshop.diagVarNeverRead', { name: d.name }),
      });
    }
  }

  // --- Listeners: tags duplicados, sin tag, REMOVE_LISTENER huérfano --------
  const listenTags: { tag: string; key: number }[] = [];
  const untaggedListeners: number[] = [];
  const removeTags: { tag: string; key: number }[] = [];
  walkNodes(nodes, (n) => {
    if (n.kind === 'LISTEN') {
      const tag = n.listenTag?.trim();
      if (tag) listenTags.push({ tag, key: n.key });
      else if (!n.once) untaggedListeners.push(n.key);
    }
    if (n.kind === 'ACTION' && n.actionType === 'REMOVE_LISTENER' && n.varName?.trim()) {
      removeTags.push({ tag: n.varName.trim(), key: n.key });
    }
  });
  const seenTags = new Set<string>();
  for (const lt of listenTags) {
    if (seenTags.has(lt.tag)) {
      at(lt.key, {
        severity: 'warning', code: 'DUPLICATE_LISTENER_TAG',
        message: t('workshop.diagDupListenerTag', { tag: lt.tag }),
      });
    }
    seenTags.add(lt.tag);
  }
  for (const key of untaggedListeners) {
    at(key, {
      severity: 'warning', code: 'LISTENER_NO_TAG',
      message: t('workshop.diagListenerNoTag'),
    });
  }
  for (const rt of removeTags) {
    if (!seenTags.has(rt.tag)) {
      at(rt.key, {
        severity: 'warning', code: 'REMOVE_LISTENER_ORPHAN',
        message: t('workshop.diagRemoveListenerOrphan', { tag: rt.tag }),
      });
    }
  }

  // --- Combos potencialmente infinitos ---------------------------------------
  let hasPlayImmediately = false;
  let hasRecoverThis = false;
  let hasDrawFromBottom = false;
  let hasRecoverCards = false;
  walkNodes(nodes, (n) => {
    if (n.kind === 'ACTION') {
      if (n.actionType === 'PLAY_IMMEDIATELY') hasPlayImmediately = true;
      if (n.actionType === 'RECOVER_THIS_CARD') hasRecoverThis = true;
      if (n.actionType === 'DRAW_FROM_BOTTOM') hasDrawFromBottom = true;
      if (n.actionType === 'RECOVER_CARDS') hasRecoverCards = true;
    }
  });
  if (hasPlayImmediately && hasRecoverThis) {
    root({
      severity: 'warning', code: 'LOOP_PLAY_RECOVER',
      message: t('workshop.diagLoopPlayRecover'),
    });
  }
  if (hasDrawFromBottom && hasRecoverCards) {
    root({
      severity: 'info', code: 'LOOP_BOTTOM_RECOVER',
      message: t('workshop.diagLoopBottomRecover'),
    });
  }

  // --- Referencias de cartas -------------------------------------------------
  if (opts.knownCardNames && opts.knownCardNames.size > 0) {
    const known = opts.knownCardNames;
    walkNodes(nodes, (n) => {
      const name = n.cardName?.trim();
      if (n.kind === 'ACTION' && CARD_NAME_ACTIONS.has(n.actionType ?? '')
        && name && !known.has(name)) {
        at(n.key, {
          severity: 'warning', code: 'UNKNOWN_CARD_REF',
          message: t('workshop.diagUnknownCardRef', { name }),
        });
      }
      if (n.kind === 'DRAW_CHECK' && name && !known.has(name)) {
        at(n.key, {
          severity: 'warning', code: 'UNKNOWN_CARD_REF',
          message: t('workshop.diagUnknownCardRef', { name }),
        });
      }
      if (n.kind === 'COND' && n.condParam && (n.condKind === 'FIRST_CARD_OF_NAME_THIS_TURN'
        || n.condKind === 'ALREADY_USED_AGAINST_THIS_ENEMY' || n.condKind === 'HAS_CARD_IN_HAND')
        && !known.has(n.condParam)) {
        at(n.key, {
          severity: 'warning', code: 'UNKNOWN_CARD_REF',
          message: t('workshop.diagUnknownCardRef', { name: n.condParam }),
        });
      }
      // Estados personalizados: advertir que son marcadores sin semántica
      if (n.kind === 'ACTION' && STATUS_ACTIONS.has(n.actionType ?? '')
        && n.statusId === 'custom' && n.cardName?.trim()
        && !['mark', 'stun', 'poison'].includes(n.cardName.trim())) {
        at(n.key, {
          severity: 'info', code: 'CUSTOM_STATUS_VISUAL',
          message: t('workshop.diagCustomStatusVisual', { name: n.cardName.trim() }),
        });
      }
    });
  }

  // Handler CUSTOM_SCENARIO contra lista permitida (independiente de nombres)
  if (opts.knownHandlers && opts.knownHandlers.size > 0) {
    const handlers = opts.knownHandlers;
    walkNodes(nodes, (n) => {
      if (n.kind === 'ACTION' && n.actionType === 'CUSTOM_SCENARIO'
        && n.cardName?.trim() && !handlers.has(n.cardName.trim())) {
        at(n.key, {
          severity: 'warning', code: 'UNKNOWN_HANDLER',
          message: t('workshop.diagUnknownHandler', { name: n.cardName.trim() }),
        });
      }
    });
  }

  // --- Chequeos por nodo (semántica local) ------------------------------------
  walkNodes(nodes, (n) => {
    if (n.kind === 'REPEAT') {
      const isDyn = n.timesMode === 'enemies' || n.timesMode === 'fieldEnemies';
      const times = num(n.times ?? '1', 1);
      const max = num(n.max ?? '3', 3);
      if (!isDyn && times <= 0) {
        at(n.key, { severity: 'warning', code: 'REPEAT_ZERO', message: t('workshop.diagRepeatZero') });
      }
      if (max <= 0) {
        at(n.key, { severity: 'warning', code: 'REPEAT_NO_MAX', message: t('workshop.diagRepeatNoMax') });
      }
      if (!isDyn && times > max && max > 0) {
        at(n.key, {
          severity: 'info', code: 'REPEAT_MAX_CLAMPS',
          message: t('workshop.diagRepeatMaxClamps', { times, max }),
        });
      }
    }
    if (n.kind === 'CHOOSE') {
      const opts = n.options ?? [];
      const filled = opts.map((o) => JSON.stringify(o.children.map((c) => ({ ...c, key: 0 }))));
      const emptyIdx = opts.findIndex((o) => o.children.length === 0);
      if (emptyIdx >= 0) {
        at(n.key, {
          severity: 'warning', code: 'EMPTY_OPTION',
          message: t('workshop.diagEmptyOption', { n: emptyIdx + 1 }),
        });
      }
      if (opts.length >= 2 && new Set(filled).size < filled.length) {
        at(n.key, { severity: 'warning', code: 'IDENTICAL_OPTIONS', message: t('workshop.diagIdenticalOptions') });
      }
    }
    if (n.kind === 'COND') {
      const thenJ = JSON.stringify((n.thenN ?? []).map((c) => ({ ...c, key: 0 })));
      const elseJ = JSON.stringify((n.elseN ?? []).map((c) => ({ ...c, key: 0 })));
      if ((n.thenN?.length ?? 0) > 0 && thenJ === elseJ) {
        at(n.key, { severity: 'warning', code: 'IDENTICAL_BRANCHES', message: t('workshop.diagIdenticalBranches') });
      }
      // AND/OR de una condición consigo misma = redundante (§9).
      if (n.condJoin && n.condKind2 && n.condKind === n.condKind2
        && (n.condParam ?? '') === (n.condParam2 ?? '')
        && (n.condValue ?? '') === (n.condValue2 ?? '')) {
        at(n.key, { severity: 'warning', code: 'IDENTICAL_CONDITIONS', message: t('workshop.diagIdenticalConditions') });
      }
    }
    if (n.kind === 'ACTION') {
      if (n.actionType === 'MOVE_CARD' && (n.moveFrom ?? 'WEAR_PILE') === (n.moveTo ?? 'HAND')) {
        at(n.key, { severity: 'warning', code: 'SAME_ZONE', message: t('workshop.diagSameZone') });
      }
      if (n.actionType === 'SET_VARIABLE' && !n.varName?.trim()) {
        at(n.key, { severity: 'warning', code: 'EMPTY_VAR_NAME', message: t('workshop.diagEmptyVarName') });
      }
      if (STATUS_ACTIONS.has(n.actionType ?? '') && n.statusId === 'custom' && !n.cardName?.trim()) {
        at(n.key, { severity: 'warning', code: 'EMPTY_STATUS_ID', message: t('workshop.diagEmptyStatusId') });
      }
      if (n.actionType === 'CUSTOM_SCENARIO' && !n.cardName?.trim()) {
        at(n.key, { severity: 'warning', code: 'EMPTY_HANDLER', message: t('workshop.diagEmptyHandler') });
      }
      if (n.target === 'ONE_ENEMY' && ENEMY_TARGETED.has(n.actionType ?? '')) {
        at(n.key, { severity: 'info', code: 'SELECTOR_MAY_BE_EMPTY', message: t('workshop.diagSelectorMayBeEmpty') });
      }
    }
  });

  // --- Complejidad (umbrales alineados con los límites duros del schema:
  //     MAX_EFFECT_DEPTH / MAX_EFFECT_NODES en @nt4h/schema) --------------------
  const comp = complexityOf(nodes);
  if (comp.depth > MAX_EFFECT_DEPTH) {
    root({
      severity: 'error', code: 'TOO_DEEP',
      message: t('workshop.diagTooDeep', { depth: comp.depth, max: MAX_EFFECT_DEPTH }),
    });
  } else if (comp.depth > MAX_EFFECT_DEPTH - 2) {
    root({
      severity: 'warning', code: 'VERY_DEEP',
      message: t('workshop.diagVeryDeep', { depth: comp.depth }),
    });
  }
  if (comp.nodes > MAX_EFFECT_NODES - 4) {
    root({
      severity: 'warning', code: 'TOO_MANY_NODES',
      message: t('workshop.diagTooManyNodes', { count: comp.nodes }),
    });
  }
  if (comp.worstOps > 500) {
    root({
      severity: 'warning', code: 'HIGH_WORST_CASE',
      message: t('workshop.diagHighWorstCase', { ops: comp.worstOps }),
    });
  }

  return diags;
}

// ============================================================================
// Complejidad del árbol (indicador del editor)
// ============================================================================

export interface TreeComplexity {
  nodes: number;
  depth: number;
  /** Estimación pesimista de efectos ejecutables por resolución. */
  worstOps: number;
}

/** Peor caso: REPEAT multiplica por min(times,max); FOR_EACH por ~6;
 *  CHOOSE toma la peor opción; TRY suma efectos + fallback. */
function worstOpsOf(n: EffectNode): number {
  const sum = (list: EffectNode[]) => list.reduce((s, c) => s + worstOpsOf(c), 0);
  const linear = sum(n.thenN ?? []) + sum(n.elseN ?? []) + sum(n.children ?? []);
  switch (n.kind) {
    case 'ACTION': return 1;
    case 'COND': return Math.max(sum(n.thenN ?? []), sum(n.elseN ?? []));
    case 'REPEAT': {
      const times = n.timesMode === 'enemies' || n.timesMode === 'fieldEnemies'
        ? num(n.max ?? '3', 3)
        : Math.min(num(n.times ?? '1', 1), num(n.max ?? '3', 3));
      return Math.max(1, times) * Math.max(1, sum(n.children ?? []));
    }
    case 'CHOOSE':
      return Math.max(0, ...(n.options ?? []).map((o) => sum(o.children)));
    case 'FOR_EACH': return 6 * Math.max(1, linear);
    default: return Math.max(1, linear); // triggers/persistent/draw_check/listen/try
  }
}

export function complexityOf(nodes: EffectNode[]): TreeComplexity {
  return {
    nodes: countNodes(nodes),
    depth: maxDepth(nodes),
    worstOps: nodes.reduce((s, n) => s + worstOpsOf(n), 0),
  };
}

/** Efectos compilados del borrador completo (los 3 bloques: carta,
 *  habilidad de héroe y pericia) para validadores agregados. */
export function compileAllZones(draft: {
  nodes: EffectNode[]; abilityNodes: EffectNode[]; peritiaNodes: EffectNode[];
}): CardEffect[] {
  return buildEffects(draft.nodes)
    .concat(buildEffects(draft.abilityNodes), buildEffects(draft.peritiaNodes));
}
