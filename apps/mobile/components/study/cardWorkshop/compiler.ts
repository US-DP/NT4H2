/**
 * cardWorkshop/compiler — EffectNode -> CardEffect con diagnósticos.
 *
 * Refactor Taller Fase 1: antes, buildNode() devolvía `null` para nodos
 * incompletos y el efecto desaparecía de la carta sin avisar. Ahora
 * compileTree() devuelve { effects, diagnostics } y cada descarte indica
 * severidad, código estable, ruta legible del nodo y key.
 *
 * buildNode/buildEffects se conservan con su firma histórica (tests y
 * código existente) como envolturas del compilador con diagnósticos.
 */

import type { CardEffect, Condition, ValueExpr } from '@nt4h/schema';
import { ConditionSchema } from '@nt4h/schema';
import { num, esT, type EffectNode, type TFunc } from './model';
import { ACTION_DEFS, CONDITIONS, valueExpr, rawValueExpr } from './registry';

export type DiagSeverity = 'error' | 'warning' | 'info';

export interface WorkshopDiagnostic {
  severity: DiagSeverity;
  /** Código estable p.ej. 'DISCARDED_NODE', 'REPEAT_ZERO'. */
  code: string;
  /** Ruta legible: 'raíz[2] → entonces[0] → opción 1'. */
  path: string;
  /** key del EffectNode afectado (para resaltar/navegar); los
   *  diagnósticos de nivel carta no llevan nodo. */
  nodeKey?: number;
  /** Mensaje ya resuelto (i18n). */
  message: string;
}

export interface CompileResult {
  effects: CardEffect[];
  diagnostics: WorkshopDiagnostic[];
}

// ============================================================================
// Rutas legibles dentro del árbol
// ============================================================================

const seg = {
  root: (t: TFunc, i: number) => t('workshop.pathRoot', { i }),
  then: (t: TFunc, i: number) => t('workshop.pathThen', { i }),
  else_: (t: TFunc, i: number) => t('workshop.pathElse', { i }),
  child: (t: TFunc, i: number) => t('workshop.pathChild', { i }),
  option: (t: TFunc, i: number, n: number) => t('workshop.pathOption', { i: i + 1, n }),
};

/** Tipos que SOLO el resolver intercepta a nivel raíz: anidados dentro de
 *  COND/REPEAT/CHOOSE/oyentes caen al fallback del registry y son un no-op
 *  silencioso. El compilador lo diagnostica como error (bloquea guardado)
 *  en vez de publicar una carta que no hace lo que muestra el árbol. */
const ROOT_ONLY_NODE_KINDS = new Set<EffectNode['kind']>([
  'CHOOSE', 'DRAW_CHECK', 'ON_DEFEAT', 'ON_HORDE',
]);
const ROOT_ONLY_ACTIONS = new Set<string>([
  'PLAY_IMMEDIATELY', 'DRAW_AND_ADD_ATTACK', 'SPAWN_ENEMY', 'CUSTOM_SCENARIO',
]);
/** Anidados siguen ejecutándose pero con semántica degradada (sin pausa de
 *  elección / sin datos de catálogo): aviso, no bloqueo. */
const DEGRADED_NESTED_ACTIONS = new Set<string>([
  'DISCARD_FROM_HAND', // no abre elección: descarta las últimas N
  'SWAP_ENEMY',        // fallback sin catálogo (Fortaleza 1, sin recompensa)
]);

type DiagSink = (d: Omit<WorkshopDiagnostic, 'path'>, path: string) => void;

/** Parsea una Condition passthrough (condKind 'RAW') con validación Zod. */
function parseRawCond(raw: string | undefined): Condition | null {
  if (!raw) return null;
  try {
    const parsed = ConditionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

function compileNode(
  n: EffectNode,
  path: string,
  report: DiagSink,
  t: TFunc,
  nested: boolean,
): CardEffect | null {
  const discarded = (reason: string) =>
    report({ severity: 'error', code: 'DISCARDED_NODE', nodeKey: n.key, message: reason }, path);

  if (nested) {
    if (ROOT_ONLY_NODE_KINDS.has(n.kind)) {
      report({
        severity: 'error', code: 'ROOT_ONLY_NESTED', nodeKey: n.key,
        message: t('workshop.diagRootOnlyNested'),
      }, path);
    } else if (n.kind === 'ACTION' && ROOT_ONLY_ACTIONS.has(n.actionType ?? '')) {
      report({
        severity: 'error', code: 'ROOT_ONLY_NESTED', nodeKey: n.key,
        message: t('workshop.diagRootOnlyAction', { type: n.actionType }),
      }, path);
    } else if (n.kind === 'ACTION' && DEGRADED_NESTED_ACTIONS.has(n.actionType ?? '')) {
      report({
        severity: 'warning', code: 'NESTED_DEGRADED', nodeKey: n.key,
        message: t('workshop.diagNestedDegraded', { type: n.actionType }),
      }, path);
    }
  }

  switch (n.kind) {
    case 'ACTION': {
      const def = ACTION_DEFS.find(d => d.type === n.actionType);
      if (!def) {
        discarded(t('workshop.diagUnknownAction', { type: n.actionType ?? '?' }));
        return null;
      }
      return def.build(n);
    }
    case 'COND': {
      const cond = CONDITIONS.find(c => c.id === n.condKind);
      if (!cond) {
        discarded(t('workshop.diagUnknownCondition', { id: n.condKind ?? '?' }));
        return null;
      }
      const then = compileList(n.thenN ?? [], seg.then, path, report, t);
      const elseFx = compileList(n.elseN ?? [], seg.else_, path, report, t);
      if (then.length === 0 && elseFx.length === 0) {
        // CONDITIONAL vacío = requisito de jugabilidad de la carta (el
        // catálogo lo usa: p.ej. Golpe de Bastón). Compila pero avisa —
        // probablemente el usuario quería efectos en la rama.
        report({
          severity: 'info', code: 'EMPTY_CONDITIONAL',
          message: t('workshop.diagEmptyConditional'),
        }, path);
      }
      // Condiciones compuestas (schema AND/OR/NOT — §5.2/§9):
      // join con una segunda condición si se definió, NOT envuelve todo.
      // condKind 'RAW' (decompilador): reemite la Condition conservada.
      let condition: Condition;
      if (n.condKind === 'RAW') {
        const rawCond = parseRawCond(n.condRaw);
        if (!rawCond) {
          report({ severity: 'error', code: 'INVALID_RAW_COND', nodeKey: n.key,
            message: t('workshop.diagInvalidRawCond') }, path);
        }
        condition = rawCond ?? { kind: 'ENEMY_IS_ORC' };
      } else {
        condition = cond.build(n.condParam ?? '', n.condValue);
      }
      if ((n.condJoin === 'AND' || n.condJoin === 'OR') && n.condKind2) {
        // 'RAW' solo vale como condición principal (no hay condRaw2).
        const c2 = n.condKind2 === 'RAW' ? undefined
          : CONDITIONS.find(c => c.id === n.condKind2);
        if (c2) {
          condition = {
            kind: n.condJoin,
            conditions: [condition, c2.build(n.condParam2 ?? '', n.condValue2)],
          };
        } else {
          report({
            severity: 'warning', code: 'UNKNOWN_CONDITION2', nodeKey: n.key,
            message: t('workshop.diagUnknownCondition', { id: n.condKind2 }),
          }, path);
        }
      }
      if (n.condNot) condition = { kind: 'NOT', condition };
      return { type: 'CONDITIONAL', condition, then, ...(elseFx.length ? { else: elseFx } : {}) };
    }
    case 'REPEAT': {
      const times: ValueExpr = n.timesMode === 'enemies' ? { kind: 'COUNT_LIVING_ENEMIES' }
        : n.timesMode === 'fieldEnemies' ? { kind: 'COUNT_ENEMIES_IN_FIELD' }
        : n.timesMode === 'raw' ? (rawValueExpr(n.rawExpr) ?? { kind: 'CONSTANT', value: 1 })
        : { kind: 'CONSTANT', value: num(n.times ?? '1', 1) };
      const children = compileList(n.children ?? [], seg.child, path, report, t);
      if (children.length === 0) {
        discarded(t('workshop.diagEmptyRepeat'));
        return null;
      }
      // El schema exige max ∈ [1,50]: clamp + diagnóstico en vez del error
      // Zod crudo que salía al guardar.
      const rawMax = num(n.max ?? '3', 3);
      const clampedMax = Math.min(50, Math.max(1, rawMax));
      if (clampedMax !== rawMax) {
        report({
          severity: 'warning', code: 'CLAMPED_VALUE', nodeKey: n.key,
          message: t('workshop.diagClampedMax', { from: rawMax, to: clampedMax }),
        }, path);
      }
      return { type: 'REPEAT', times, max: clampedMax, effects: children };
    }
    case 'CHOOSE': {
      const options = (n.options ?? [])
        .map((o, oi) => ({
          label: o.label || undefined,
          effects: compileList(o.children, (tt, i) => seg.option(tt, oi, i), path, report, t),
        }))
        .filter(o => o.effects.length > 0);
      if (options.length < 2) {
        discarded(t('workshop.diagChooseFewOptions', { count: options.length }));
        return null;
      }
      return { type: 'CHOOSE_ONE', prompt: n.prompt || undefined, optional: n.optional || undefined, options };
    }
    case 'ON_DEFEAT': {
      const children = compileList(n.children ?? [], seg.child, path, report, t);
      if (children.length === 0) {
        discarded(t('workshop.diagEmptyTrigger'));
        return null;
      }
      return { type: 'ON_DEFEAT', effects: children };
    }
    case 'ON_HORDE': {
      const children = compileList(n.children ?? [], seg.child, path, report, t);
      if (children.length === 0) {
        discarded(t('workshop.diagEmptyTrigger'));
        return null;
      }
      return { type: 'ON_HORDE_ATTACK', effects: children };
    }
    case 'ON_ENEMY_DEF': {
      const children = compileList(n.children ?? [], seg.child, path, report, t);
      if (children.length === 0) {
        discarded(t('workshop.diagEmptyTrigger'));
        return null;
      }
      return {
        type: 'ON_ENEMY_DEFEATED',
        effects: children,
        ...(n.fortitudeGte?.trim() ? { condition: { fortitudeGte: num(n.fortitudeGte, 0) } } : {}),
      };
    }
    case 'PERSISTENT': {
      const children = compileList(n.children ?? [], seg.child, path, report, t);
      if (children.length === 0) {
        discarded(t('workshop.diagEmptyPersistent'));
        return null;
      }
      return {
        type: 'PLACE_PERSISTENT',
        trigger: n.persistTrigger?.trim() || 'HORDE_ATTACK',
        effects: children,
      };
    }
    case 'DRAW_CHECK': {
      const onMatch = compileList(n.thenN ?? [], seg.then, path, report, t);
      const onMismatch = compileList(n.elseN ?? [], seg.else_, path, report, t);
      if (onMatch.length === 0 && onMismatch.length === 0) {
        discarded(t('workshop.diagEmptyDrawCheck'));
        return null;
      }
      return {
        type: 'DRAW_AND_CHECK',
        amount: valueExpr(n),
        ...(n.cardRef?.trim() ? { expectedCard: n.cardRef.trim() } : {}),
        ...(n.cardName?.trim() ? { expectedName: n.cardName.trim() } : {}),
        onMatch,
        onMismatch,
      };
    }
    case 'FOR_EACH': {
      const collection = (n.collection === 'OTHER_HEROES' || n.collection === 'ALL_HEROES')
        ? n.collection
        : 'ENEMIES';
      const effects = compileList(n.children ?? [], seg.child, path, report, t);
      if (effects.length === 0) {
        discarded(t('workshop.diagEmptyForEach'));
        return null;
      }
      return { type: 'FOR_EACH', collection, effects };
    }
    case 'TRY': {
      const effects = compileList(n.children ?? [], seg.child, path, report, t);
      if (effects.length === 0) {
        discarded(t('workshop.diagEmptyTry'));
        return null;
      }
      const onFailure = compileList(n.elseN ?? [], seg.else_, path, report, t);
      return { type: 'TRY_EFFECT', effects, ...(onFailure.length ? { onFailure } : {}) };
    }
    case 'LISTEN': {
      const effects = compileList(n.children ?? [], seg.child, path, report, t);
      if (effects.length === 0) {
        discarded(t('workshop.diagEmptyListener'));
        return null;
      }
      return {
        type: 'REGISTER_LISTENER',
        event: n.listenEvent ?? 'DAMAGE_DEALT',
        ...(n.once ? { once: true } : {}),
        duration: n.duration === 'GAME' ? 'GAME' as const : 'THIS_TURN' as const,
        ...(n.listenTag?.trim() ? { tag: n.listenTag.trim() } : {}),
        effects,
      };
    }
  }
}

function compileList(
  nodes: EffectNode[],
  segFn: (t: TFunc, i: number) => string,
  parentPath: string,
  report: DiagSink,
  t: TFunc,
): CardEffect[] {
  // Todo lo que compila compileList vive dentro de otro nodo → nested=true.
  return nodes
    .map((n, i) => compileNode(n, `${parentPath} → ${segFn(t, i)}`, report, t, true))
    .filter(Boolean) as CardEffect[];
}

/** Compila la lista raíz del borrador con diagnósticos completos. */
export function compileTree(nodes: EffectNode[], t: TFunc = esT): CompileResult {
  const diagnostics: WorkshopDiagnostic[] = [];
  const report: DiagSink = (d, path) => diagnostics.push({ ...d, path });
  const effects = nodes
    .map((n, i) => compileNode(n, seg.root(t, i), report, t, false))
    .filter(Boolean) as CardEffect[];
  return { effects, diagnostics };
}

// ============================================================================
// API histórica (firma compatible con código y tests existentes)
// ============================================================================

/** Compila un nodo suelto; sigue devolviendo null si es inválido, pero
 *  acepta un sumidero opcional de diagnósticos para no perder el motivo. */
export function buildNode(n: EffectNode): CardEffect | null {
  return compileTree([n]).effects[0] ?? null;
}

export function buildEffects(nodes: EffectNode[]): CardEffect[] {
  return compileTree(nodes).effects;
}
