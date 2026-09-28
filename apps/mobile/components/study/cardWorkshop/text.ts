/**
 * cardWorkshop/text — resumen legible de nodos (chip de cabecera) y
 * extracción de números para cruzar texto manual vs efectos.
 * Extraído de CreateCardTab.tsx (refactor Taller Fase 2).
 */

import { num, type EffectNode, type TFunc } from './model';
import { ACTION_DEFS, AMOUNT_MODES, CONDITIONS, LISTEN_EVENTS } from './registry';

// ============================================================================
// Texto generado automaticamente (resumen legible del efecto)
// ============================================================================

export function nodeText(n: EffectNode, t: TFunc): string {
  let amt = n.amount ?? '1';
  if (n.amountMode && n.amountMode !== 'fixed') {
    const mode = AMOUNT_MODES.find(m => m.id === n.amountMode);
    amt = mode ? t(`workshop.${mode.labelKey}`) : '';
  }
  switch (n.kind) {
    case 'ACTION': {
      const def = ACTION_DEFS.find(d => d.type === n.actionType);
      const label = def ? t(`workshop.${def.labelKey}`) : n.actionType ?? '?';
      return amt
        ? t('workshop.nodeActionAmount', { label, amount: amt })
        : t('workshop.nodeAction', { label });
    }
    case 'COND': {
      const condKey = CONDITIONS.find(c => c.id === n.condKind)?.labelKey;
      let cond = condKey ? t(`workshop.${condKey}`).toLowerCase() : '?';
      if ((n.condJoin === 'AND' || n.condJoin === 'OR') && n.condKind2) {
        const k2 = CONDITIONS.find(c => c.id === n.condKind2)?.labelKey;
        const c2 = k2 ? t(`workshop.${k2}`).toLowerCase() : '?';
        cond = n.condJoin === 'AND'
          ? t('workshop.condJoinTextAND', { a: cond, b: c2 })
          : t('workshop.condJoinTextOR', { a: cond, b: c2 });
      }
      if (n.condNot) cond = t('workshop.condNotText', { cond });
      return t('workshop.nodeCond', { cond, count: (n.thenN ?? []).length });
    }
    case 'REPEAT':
      return t('workshop.nodeRepeat', {
        times: n.times ?? '1', max: n.max ?? '3', count: (n.children ?? []).length,
      });
    case 'CHOOSE':
      return t(n.optional ? 'workshop.nodeChooseOptional' : 'workshop.nodeChoose', {
        count: (n.options ?? []).length,
      });
    case 'ON_DEFEAT': return t('workshop.nodeOnDefeat', { count: (n.children ?? []).length });
    case 'ON_HORDE': return t('workshop.nodeOnHorde', { count: (n.children ?? []).length });
    case 'ON_ENEMY_DEF': return t('workshop.nodeOnEnemyDef', { count: (n.children ?? []).length });
    case 'PERSISTENT':
      return t('workshop.nodePersistent', {
        trigger: n.persistTrigger ?? 'HORDE_ATTACK', count: (n.children ?? []).length,
      });
    case 'DRAW_CHECK':
      return t('workshop.nodeDrawCheck', {
        name: n.cardName ? ` «${n.cardName}»` : '',
        onMatch: (n.thenN ?? []).length, onMismatch: (n.elseN ?? []).length,
      });
    case 'FOR_EACH': {
      const colKey = n.collection === 'OTHER_HEROES' ? 'forEachOtherHero'
        : n.collection === 'ALL_HEROES' ? 'forEachHero' : 'forEachEnemy';
      return t('workshop.nodeForEach', {
        collection: t(`workshop.${colKey}`), count: (n.children ?? []).length,
      });
    }
    case 'TRY':
      return t('workshop.nodeTry', {
        count: (n.children ?? []).length, fallback: (n.elseN ?? []).length,
      });
    case 'LISTEN': {
      const evt = LISTEN_EVENTS.find(e => e.id === n.listenEvent);
      return t('workshop.nodeListen', {
        event: evt ? t(`workshop.${evt.labelKey}`).toLowerCase() : (n.listenEvent ?? '?'),
        count: (n.children ?? []).length,
      });
    }
  }
}

/** Extrae numeros del texto manual para compararlos con los efectos (§21). */
export function textNumbers(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number);
}
export function effectNumbers(nodes: EffectNode[]): number[] {
  const out: number[] = [];
  const pushFixed = (mode: string | undefined, v: string | undefined) => {
    if (!mode || mode === 'fixed') out.push(num(v ?? '0'));
  };
  const walk = (list: EffectNode[]) => {
    for (const n of list) {
      if (n.kind === 'ACTION') {
        pushFixed(n.amountMode, n.amount);
        pushFixed(undefined, n.targetCount);
        pushFixed(n.timesMode, n.times);
        // Números sueltos de acciones (sin modo): count/targetCount…
        if (n.actionType && ACTION_DEFS.find(d => d.type === n.actionType)?.count) {
          pushFixed(undefined, n.targetCount);
        }
      }
      if (n.kind === 'REPEAT') pushFixed(n.timesMode, n.times);
      walk(n.thenN ?? []); walk(n.elseN ?? []); walk(n.children ?? []);
      (n.options ?? []).forEach(o => walk(o.children));
    }
  };
  walk(nodes);
  return out;
}
