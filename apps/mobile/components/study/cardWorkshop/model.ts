/**
 * cardWorkshop/model — tipos y utilidades del modelo del editor.
 *
 * Extraído de CreateCardTab.tsx (refactor Taller Fase 2): aquí vive el
 * árbol de nodos (EffectNode), el borrador de carta (CardDraft) y las
 * constantes de tipos de carta. Sin dependencias de React: puro modelo.
 */

import type {
  CardType,
  HeroClass,
  ValueExpr,
} from '@nt4h/schema';
import workshopEs from '../../../lib/i18n/es/workshop';

/** Firma mínima de t() para las funciones no-componente del taller. */
export type TFunc = (key: string, opts?: Record<string, unknown>) => string;

/** Resolución ES de respaldo con interpolación {{var}}: balanceWarnings y
 *  nodeText también se ejecutan en tests (vitest) fuera de React, sin hook. */
export const esT: TFunc = (key, opts) => {
  let cur: unknown = workshopEs.workshop;
  for (const part of key.replace(/^workshop\./, '').split('.')) {
    cur = (cur as Record<string, unknown> | undefined)?.[part];
  }
  const raw = typeof cur === 'string' ? cur : key;
  return raw.replace(/\{\{(\w+)\}\}/g, (m, name: string) => String(opts?.[name] ?? m));
};

export const CARD_TYPES: { id: CardType; labelKey: string; descKey: string }[] = [
  { id: 'ABILITY', labelKey: 'cardTypeAbility', descKey: 'cardTypeAbilityDesc' },
  { id: 'MARKET', labelKey: 'cardTypeMarket', descKey: 'cardTypeMarketDesc' },
  { id: 'HORDE', labelKey: 'cardTypeHorde', descKey: 'cardTypeHordeDesc' },
  { id: 'WARLORD', labelKey: 'cardTypeWarlord', descKey: 'cardTypeWarlordDesc' },
  { id: 'SCENARIO', labelKey: 'cardTypeScenario', descKey: 'cardTypeScenarioDesc' },
  { id: 'HERO', labelKey: 'cardTypeHero', descKey: 'cardTypeHeroDesc' },
];

export const CLASSES: HeroClass[] = ['EXPLORER', 'WARRIOR', 'MAGE', 'ROGUE'];
export const CLASS_NAME_KEYS: Record<HeroClass, string> = {
  EXPLORER: 'classExplorer', WARRIOR: 'classWarrior', MAGE: 'classMage', ROGUE: 'classRogue',
};
export const CAPABILITIES = ['MELEE', 'RANGED', 'EXPERTISE', 'MAGIC'] as const;
export const CAP_NAME_KEYS: Record<string, string> = {
  MELEE: 'capMelee', RANGED: 'capRanged', EXPERTISE: 'capExpertise', MAGIC: 'capMagic',
};
export const DESTINATIONS = [
  { id: 'WEAR_PILE', labelKey: 'destWearPile' },
  { id: 'REMOVED_FROM_GAME', labelKey: 'destRemovedFromGame' },
  { id: 'HAND', labelKey: 'destHand' },
  { id: 'BOTTOM_OF_DECK', labelKey: 'destBottomOfDeck' },
] as const;

export const C = (v: number): ValueExpr => ({ kind: 'CONSTANT', value: v });

// ============================================================================
// Árbol de nodos
// ============================================================================

export type NodeKind = 'ACTION' | 'COND' | 'REPEAT' | 'CHOOSE' | 'ON_DEFEAT' | 'ON_HORDE'
  | 'DRAW_CHECK' | 'PERSISTENT' | 'ON_ENEMY_DEF' | 'FOR_EACH' | 'TRY' | 'LISTEN';

export interface EffectNode {
  key: number;
  kind: NodeKind;
  // ACTION
  actionType?: string;
  amountMode?: string;
  amount?: string;
  target?: string;
  heroTarget?: string;
  duration?: string;
  scope?: string;
  to?: string;
  resource?: string;
  targetCount?: string;
  // Acciones con carta/mazo nombrado o disparador persistente
  cardName?: string;
  searchAction?: string;
  searchDeck?: string;
  persistTrigger?: string;
  fortitudeGte?: string;
  inheritTarget?: boolean;
  /** DEFEAT_ENEMY: 'lost' = el botín se pierde (sin recompensas). */
  loot?: string;
  /** Filtro 'solo orcos' sobre selectores ONE_ENEMY/ALL_ENEMIES. */
  orcOnly?: boolean;
  /** OVERKILL_DAMAGE: selector del enemigo que recibe el exceso. */
  spillTarget?: string;
  /** Estado a aplicar/retirar (APPLY_STATUS & cia) o consultar. */
  statusId?: string;
  /** MOVE_CARD: zona origen. */
  moveFrom?: string;
  /** MOVE_CARD: zona destino. */
  moveTo?: string;
  /** DISCARD_HORDE_CARD / MOVE_HORDE_CARDS: extremo de la Horda. */
  hordeDir?: string;
  /** FOR_EACH: colección iterada. */
  collection?: string;
  /** Nombre de variable (SET_VARIABLE, VARIABLE_*, modo 'variable'). */
  varName?: string;
  /** Ámbito de variable SET_VARIABLE: RESOLUTION | GAME. */
  varScope?: string;
  /** LISTEN: tipo de GameEvent que dispara el oyente. */
  listenEvent?: string;
  /** LISTEN: etiqueta (para REMOVE_LISTENER); LISTEN/TRY: un solo uso. */
  listenTag?: string;
  /** LISTEN: el oyente se retira tras la primera activación. */
  once?: boolean;
  // COND
  condKind?: string;
  condParam?: string;
  /** Segundo operando de condiciones estadísticas (valor numérico). */
  condValue?: string;
  /** COND: niega la condición final (schema Condition NOT). */
  condNot?: boolean;
  /** COND: combina con una segunda condición (schema Condition AND/OR). */
  condJoin?: 'AND' | 'OR';
  condKind2?: string;
  condParam2?: string;
  condValue2?: string;
  thenN?: EffectNode[];
  elseN?: EffectNode[];
  // REPEAT
  timesMode?: string;
  times?: string;
  max?: string;
  children?: EffectNode[];
  // CHOOSE
  prompt?: string;
  optional?: boolean;
  options?: { label: string; children: EffectNode[] }[];
}

/** Borrador completo de la carta (todo serializable). */
export interface CardDraft {
  /** Versión del formato de borrador (migraciones). v1 = sin campo. */
  draftVersion?: number;
  cardType: CardType;
  editingId: string | null;
  name: string;
  heroClass: HeroClass;
  copies: string;
  printedAttack: string;
  printedCost: string;
  printedFortitude: string;
  rewardCoins: string;
  rewardGlory: string;
  maxWounds: string;
  capabilities: string[];
  requiredCapabilities: string[];
  destination: string;
  abilityUses: string;
  abilityNodes: EffectNode[];
  /** Pericia de Señor (solo WARLORD): disparador + efectos propios */
  peritiaTrigger: '' | 'DAMAGE_DEALT' | 'CARD_PLAYED' | 'CONTINUOUS';
  peritiaCondition: string;
  peritiaNodes: EffectNode[];
  nodes: EffectNode[];
  textOverride: string;
  altText: string;
  /** Referencia 'asset:<id>' de la imagen importada (almacenamiento separado). */
  imageRef?: string;
  basedOn?: string;
}

export const EMPTY_DRAFT: CardDraft = {
  cardType: 'ABILITY',
  editingId: null,
  name: '', heroClass: 'EXPLORER',
  copies: '3', printedAttack: '0', printedCost: '0', printedFortitude: '2',
  rewardCoins: '1', rewardGlory: '1', maxWounds: '10',
  capabilities: [], requiredCapabilities: [],
  destination: 'WEAR_PILE', abilityUses: '1',
  abilityNodes: [], peritiaTrigger: '', peritiaCondition: '', peritiaNodes: [],
  nodes: [],
  textOverride: '', altText: '',
};

// ============================================================================
// Claves y operaciones de árbol
// ============================================================================

let nodeKey = 1;
export const nextNodeKey = () => nodeKey++;
// Alias histórico usado por el editor y los tests.
export const k = nextNodeKey;
/** Alias largo — mismo generador, para código nuevo. */
export const freshKey = nextNodeKey;

export const num = (s: string, def = 0) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : def;
};

/** Recorre todos los nodos del árbol (then/else/children/options). */
export function walkNodes(nodes: EffectNode[], visit: (n: EffectNode) => void): void {
  for (const n of nodes) {
    visit(n);
    walkNodes(n.thenN ?? [], visit);
    walkNodes(n.elseN ?? [], visit);
    walkNodes(n.children ?? [], visit);
    for (const o of n.options ?? []) walkNodes(o.children, visit);
  }
}

/** Clon profundo con claves nuevas en TODO el subárbol — duplicar un nodo
 *  nunca comparte `key` con el original (regresión: React keys y
 *  diagnósticos dependen de la unicidad). */
export function cloneSubtree(n: EffectNode): EffectNode {
  const c = structuredClone(n);
  walkNodes([c], (x) => { x.key = nextNodeKey(); });
  return c;
}

/** Nº total de nodos (para complejidad y confirmación de borrado). */
export function countNodes(nodes: EffectNode[]): number {
  let n = 0;
  walkNodes(nodes, () => { n += 1; });
  return n;
}

/** Tipos de contenedor en los que se puede envolver un nodo. */
export type WrapKind = 'COND' | 'REPEAT' | 'TRY' | 'FOR_EACH';

/** Envuelve `list[i]` dentro de un contenedor nuevo con clave fresca. */
export function wrapInContainer(list: EffectNode[], i: number, kind: WrapKind): EffectNode[] {
  const inner = list[i];
  if (!inner) return list;
  const container: EffectNode = { key: nextNodeKey(), kind };
  if (kind === 'COND') { container.thenN = [inner]; container.elseN = []; }
  else if (kind === 'REPEAT') {
    container.children = [inner]; container.timesMode = 'fixed';
    container.times = '3'; container.max = '5';
  } else if (kind === 'FOR_EACH') {
    container.children = [inner]; container.collection = 'ENEMIES';
  } else { container.children = [inner]; container.elseN = []; } // TRY
  return list.map((n, xi) => (xi === i ? container : n));
}

/** Envuelve varios índices seleccionados en un único contenedor que
 *  ocupa la posición del primero y conserva el orden original (§3.2,
 *  selección múltiple). Devuelve la lista sin cambios si no hay índices. */
export function wrapManyInContainer(
  list: EffectNode[], indices: number[], kind: WrapKind,
): EffectNode[] {
  const picked = indices.filter(i => i >= 0 && i < list.length).sort((a, b) => a - b);
  if (picked.length === 0) return list;
  if (picked.length === 1) return wrapInContainer(list, picked[0], kind);
  const sel = new Set(picked);
  const inner = picked.map(i => list[i]);
  const container: EffectNode = { key: nextNodeKey(), kind };
  if (kind === 'COND') { container.thenN = inner; container.elseN = []; }
  else if (kind === 'REPEAT') {
    container.children = inner; container.timesMode = 'fixed';
    container.times = '3'; container.max = '5';
  } else if (kind === 'FOR_EACH') { container.children = inner; container.collection = 'ENEMIES'; }
  else { container.children = inner; container.elseN = []; } // TRY
  const out: EffectNode[] = [];
  list.forEach((n, i) => {
    if (i === picked[0]) out.push(container);
    else if (!sel.has(i)) out.push(n);
  });
  return out;
}

/** Extrae los hijos de `list[i]` (then/else/children/options) en la lista
 *  padre, eliminando el contenedor. Lista sin cambios si no hay hijos. */
export function unwrapAt(list: EffectNode[], i: number): EffectNode[] {
  const n = list[i];
  if (!n) return list;
  const kids = [
    ...(n.thenN ?? []), ...(n.elseN ?? []), ...(n.children ?? []),
    ...(n.options ?? []).flatMap(o => o.children),
  ];
  if (kids.length === 0) return list;
  return [...list.slice(0, i), ...kids, ...list.slice(i + 1)];
}

/** Mueve el elemento `from` a la posición `to` (drag & drop, §3.2).
 *  `to` se clampa al rango [0, list.length]; sin cambios si from es inválido. */
export function moveToIndex<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const clamped = Math.max(0, Math.min(list.length, to));
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}

/** Busca un nodo por clave en el árbol (todas las ramas). */
export function findNode(nodes: EffectNode[], key: number): EffectNode | null {
  for (const n of nodes) {
    if (n.key === key) return n;
    const sub = findNode(n.thenN ?? [], key)
      ?? findNode(n.elseN ?? [], key)
      ?? findNode(n.children ?? [], key);
    if (sub) return sub;
    for (const o of n.options ?? []) {
      const f = findNode(o.children, key);
      if (f) return f;
    }
  }
  return null;
}

/** Devuelve la lista con el nodo `key` parchado (árbol nuevo, sin mutar). */
export function patchNode(nodes: EffectNode[], key: number, patch: Partial<EffectNode>): EffectNode[] {
  return nodes.map(n => {
    if (n.key === key) return { ...n, ...patch };
    const out: EffectNode = { ...n };
    if (n.thenN) out.thenN = patchNode(n.thenN, key, patch);
    if (n.elseN) out.elseN = patchNode(n.elseN, key, patch);
    if (n.children) out.children = patchNode(n.children, key, patch);
    if (n.options) out.options = n.options.map(o => ({ ...o, children: patchNode(o.children, key, patch) }));
    return out;
  });
}

/** Diferencia legible entre dos borradores (comparador §13/§22). */
export interface DraftDiff {
  /** Clave i18n workshop.diff<Field> o campo plano. */
  field: string;
  from: string;
  to: string;
}

const DIFF_SCALAR_FIELDS = [
  'name', 'cardType', 'heroClass', 'copies', 'printedAttack', 'printedCost',
  'printedFortitude', 'rewardCoins', 'rewardGlory', 'maxWounds', 'destination',
  'textOverride', 'altText', 'abilityUses', 'peritiaTrigger', 'peritiaCondition',
] as const;

export function diffDrafts(saved: CardDraft, current: CardDraft): DraftDiff[] {
  const out: DraftDiff[] = [];
  for (const f of DIFF_SCALAR_FIELDS) {
    const a = String(saved[f] ?? '');
    const b = String(current[f] ?? '');
    if (a !== b) out.push({ field: f, from: a || '—', to: b || '—' });
  }
  if (JSON.stringify(saved.capabilities) !== JSON.stringify(current.capabilities)) {
    out.push({
      field: 'capabilities',
      from: (saved.capabilities ?? []).join(',') || '—',
      to: (current.capabilities ?? []).join(',') || '—',
    });
  }
  if (JSON.stringify(saved.requiredCapabilities) !== JSON.stringify(current.requiredCapabilities)) {
    out.push({
      field: 'requiredCapabilities',
      from: (saved.requiredCapabilities ?? []).join(',') || '—',
      to: (current.requiredCapabilities ?? []).join(',') || '—',
    });
  }
  for (const [f, a, b] of [
    ['nodes', saved.nodes, current.nodes],
    ['abilityNodes', saved.abilityNodes, current.abilityNodes],
    ['peritiaNodes', saved.peritiaNodes, current.peritiaNodes],
  ] as const) {
    const ca = countNodes(a), cb = countNodes(b);
    if (ca !== cb || JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ field: f, from: `${ca} nodos`, to: `${cb} nodos` });
    }
  }
  return out;
}

/** Profundidad máxima del árbol (raíz = 1). */
export function maxDepth(nodes: EffectNode[], d = 1): number {
  let best = nodes.length ? d : 0;
  for (const n of nodes) {
    best = Math.max(
      best,
      maxDepth(n.thenN ?? [], d + 1),
      maxDepth(n.elseN ?? [], d + 1),
      maxDepth(n.children ?? [], d + 1),
      ...(n.options ?? []).map((o) => maxDepth(o.children, d + 1)),
    );
  }
  return best;
}

// ============================================================================
// Versionado y migración de borradores (P1)
// ============================================================================

/**
 * Versión actual del formato CardDraft.
 *  v1: formato original (sin campo draftVersion).
 *  v2: añade draftVersion; saneado estructural + claves únicas garantizadas.
 */
export const DRAFT_VERSION = 2;

const NODE_KINDS: ReadonlySet<string> = new Set<string>([
  'ACTION', 'COND', 'REPEAT', 'CHOOSE', 'ON_DEFEAT', 'ON_HORDE',
  'DRAW_CHECK', 'PERSISTENT', 'ON_ENEMY_DEF', 'FOR_EACH', 'TRY', 'LISTEN',
]);

/** Campos escalares permitidos en un EffectNode (whitelist anti-mojibake
 *  de datos arbitrarios inyectados en borradores externos). */
const NODE_SCALAR_FIELDS: ReadonlySet<string> = new Set([
  'actionType', 'amountMode', 'amount', 'target', 'heroTarget', 'duration',
  'scope', 'to', 'resource', 'targetCount', 'cardName', 'searchAction',
  'searchDeck', 'persistTrigger', 'fortitudeGte', 'inheritTarget', 'loot',
  'orcOnly', 'spillTarget', 'statusId', 'moveFrom', 'moveTo', 'hordeDir',
  'collection', 'varName', 'varScope', 'listenEvent', 'listenTag', 'once',
  'condKind', 'condParam', 'condValue', 'condNot', 'condJoin',
  'condKind2', 'condParam2', 'condValue2', 'timesMode', 'times', 'max',
  'prompt', 'optional',
]);

function sanitizeNode(raw: unknown, seen: Set<number>, depth: number): EffectNode | null {
  if (!raw || typeof raw !== 'object' || depth > 16) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== 'string' || !NODE_KINDS.has(r.kind)) return null;
  const out: EffectNode = { key: 0, kind: r.kind as NodeKind };
  // Clave única: conserva la original si es un número sin colisionar,
  // si no se regenera (los borradores importados pueden repetir keys).
  const rk = r.key;
  out.key = typeof rk === 'number' && !seen.has(rk) ? rk : nextNodeKey();
  seen.add(out.key);
  for (const [field, value] of Object.entries(r)) {
    if (field === 'key' || field === 'kind') continue;
    if (!NODE_SCALAR_FIELDS.has(field)) continue;
    if (typeof value === 'string' || typeof value === 'boolean') {
      (out as unknown as Record<string, unknown>)[field] = value;
    }
  }
  const sub = (v: unknown): EffectNode[] | undefined =>
    Array.isArray(v)
      ? v.map(x => sanitizeNode(x, seen, depth + 1)).filter((x): x is EffectNode => x !== null)
      : undefined;
  const thenN = sub(r.thenN); if (thenN) out.thenN = thenN;
  const elseN = sub(r.elseN); if (elseN) out.elseN = elseN;
  const children = sub(r.children); if (children) out.children = children;
  if (Array.isArray(r.options)) {
    const options = r.options
      .filter((o): o is { label: string; children: unknown[] } =>
        !!o && typeof o === 'object' && Array.isArray((o as { children?: unknown }).children))
      .map((o, i) => ({
        label: typeof o.label === 'string' ? o.label : `Opción ${i + 1}`,
        children: (sub(o.children) ?? []),
      }));
    if (options.length > 0) out.options = options;
  }
  return out;
}

function sanitizeList(raw: unknown, seen: Set<number>): EffectNode[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(x => sanitizeNode(x, seen, 1)).filter((x): x is EffectNode => x !== null);
}

/**
 * Migra/sanea un borrador persistido a la versión actual.
 * - null: datos no recuperables o versión FUTURA (no pisar lo que no se entiende).
 * - Sanea los árboles con whitelist de campos y claves únicas garantizadas.
 * - Tolera campos desconocidos de versiones anteriores (se ignoran).
 */
export function migrateDraft(raw: unknown): CardDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.draftVersion === 'number' && r.draftVersion > DRAFT_VERSION) return null;
  const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const seen = new Set<number>();
  const cardType = CARD_TYPES.some(c => c.id === r.cardType)
    ? (r.cardType as CardType)
    : EMPTY_DRAFT.cardType;
  const heroClass = CLASSES.includes(r.heroClass as HeroClass)
    ? (r.heroClass as HeroClass)
    : EMPTY_DRAFT.heroClass;
  const peritiaTrigger = r.peritiaTrigger === 'DAMAGE_DEALT'
    || r.peritiaTrigger === 'CARD_PLAYED' || r.peritiaTrigger === 'CONTINUOUS'
    ? r.peritiaTrigger : '';
  return {
    draftVersion: DRAFT_VERSION,
    cardType,
    editingId: typeof r.editingId === 'string' ? r.editingId : null,
    name: str(r.name),
    heroClass,
    copies: str(r.copies, '3'), printedAttack: str(r.printedAttack, '0'),
    printedCost: str(r.printedCost, '0'), printedFortitude: str(r.printedFortitude, '2'),
    rewardCoins: str(r.rewardCoins, '1'), rewardGlory: str(r.rewardGlory, '1'),
    maxWounds: str(r.maxWounds, '10'),
    capabilities: strArr(r.capabilities), requiredCapabilities: strArr(r.requiredCapabilities),
    destination: str(r.destination, 'WEAR_PILE'), abilityUses: str(r.abilityUses, '1'),
    abilityNodes: sanitizeList(r.abilityNodes, seen),
    peritiaTrigger,
    peritiaCondition: str(r.peritiaCondition),
    peritiaNodes: sanitizeList(r.peritiaNodes, seen),
    nodes: sanitizeList(r.nodes, seen),
    textOverride: str(r.textOverride), altText: str(r.altText),
    ...(typeof r.imageRef === 'string' ? { imageRef: r.imageRef } : {}),
    ...(typeof r.basedOn === 'string' ? { basedOn: r.basedOn } : {}),
  };
}
