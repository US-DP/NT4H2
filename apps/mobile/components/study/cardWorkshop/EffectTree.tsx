/**
 * cardWorkshop/EffectTree.tsx - editor recursivo del arbol de efectos.
 *
 * Extraido de CreateCardTab: contiene el render de cada nodo (cabecera,
 * controles, parametros por tipo), el picker de insercion, la seleccion
 * multiple, el portapapeles, los fragmentos y el drag & drop web.
 *
 * El estado de UI compartido (colapso, portapapeles, modo basico, payload
 * de arrastre) vive en ./editorState para no perforar ~10 niveles de
 * recursividad con props.
 */

import { createElement, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NtInput } from '../../ui/NtInput';
import { NtButton } from '../../ui/NtButton';
import { NtBadge } from '../../ui/NtBadge';
import { useCustomContent } from '../../../lib/customContent';
import { useSettingsSafe } from '../../../lib/useTheme';
import { EFFECT_REGISTRY } from '@nt4h/catalog';
import type { CardType } from '@nt4h/schema';
import {
  CAPABILITIES, CAP_NAME_KEYS, DESTINATIONS,
  k, cloneSubtree, countNodes, wrapInContainer, wrapManyInContainer, unwrapAt,
  moveToIndex, type EffectNode, type NodeKind, type WrapKind,
} from './model';
import {
  ACTION_DEFS, CONDITIONS, ENEMY_TARGETS, HERO_TARGETS, AMOUNT_MODES,
  DURATIONS, SCOPES, STATUS_IDS, LISTEN_EVENTS, EFFECT_TEMPLATES,
} from './registry';
import { nodeText } from './text';
import {
  collapsedNodes, diagErrorKeys, diagWarnKeys, editorUi,
} from './editorState';
import { styles } from './editorStyles';

const IS_WEB = Platform.OS === 'web';

/** Contador de instancias de EffectList: cada lista tiene un id unico que
 *  identifica el origen/destino de un arrastre (permite mover entre ramas). */
let effectListSeq = 0;
/** Envoltura de drop target (web): una fila de nodo o la zona final de la
 *  lista. En nativo es transparente (los botones de orden siguen siendo el
 *  fallback accesible por teclado/tactil). */
function DndDrop({ index, onDropAt, children }: {
  index: number; onDropAt: (to: number) => void; children: ReactNode;
}) {
  if (!IS_WEB) return <>{children}</>;
  return createElement('div', {
    onDragOver: (e: DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); },
    onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); onDropAt(index); },
    style: { display: 'contents' },
  }, children);
}

/** Asa de arrastre (web): solo el handle es draggable para no romper la
 *  seleccion de texto ni los botones de la fila. */
function DndHandle({ payload }: {
  payload: { list: number; index: number; node: EffectNode };
}) {
  if (!IS_WEB) return null;
  return createElement('span', {
    draggable: true,
    role: 'button',
    'aria-label': 'Arrastrar nodo',
    style: { cursor: 'grab', userSelect: 'none', padding: '0 4px' },
    onDragStart: (e: DragEvent<HTMLElement>) => {
      editorUi.dnd = payload;
      e.dataTransfer?.setData('text/plain', String(payload.node.key));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => { editorUi.dnd = null; },
  }, '⠿');
}

export interface ListProps {
  nodes: EffectNode[];
  onChange: (nodes: EffectNode[]) => void;
  depth: number;
  cardType: CardType;
}

export function Chip({ label, selected, onPress, a11y }: { label: string; selected: boolean; onPress: () => void; a11y?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={a11y}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}


/** Handlers CUSTOM_SCENARIO permitidos = escenarios con soporte en el motor
 *  (applyScenarioEffects en engine/scenarios). Lista blanca: un handler
 *  arbitrario se ejecutaría como no-op silencioso. */
export const SCENARIO_HANDLERS = [
  'scenario.brunmar-ruins', 'scenario.lotharion-market', 'scenario.skaarg-plains',
  'scenario.battlefield', 'scenario.umbrous-swamp', 'scenario.ur-mountains',
  'scenario.eque-port', 'scenario.kalern-mud', 'scenario.ulthar-portal',
  'scenario.tears-of-aradiel', 'scenario.jade-deposits',
] as const;

/** Campo de nombre de carta con sugerencias del catálogo (P1: referencias
 *  estables sin escribir a mano). */
export function CardNameField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { t } = useTranslation();
  const q = value.trim().toLowerCase();
  const matches = q.length > 1
    ? editorUi.knownCardNames.filter(n => n.toLowerCase().includes(q) && n.toLowerCase() !== q).slice(0, 6)
    : [];
  return (
    <View>
      <NtInput label={label} value={value} onChangeText={onChange} placeholder={placeholder} />
      {matches.length > 0 && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.cardNameSuggestions')}</Text>
          <View style={styles.chipRow}>
            {matches.map(n => <Chip key={n} label={n} selected={false} onPress={() => onChange(n)} a11y={n} />)}
          </View>
        </View>
      )}
    </View>
  );
}

function ActionParams({ node, update }: { node: EffectNode; update: (p: Partial<EffectNode>) => void }) {
  const { t } = useTranslation();
  const def = ACTION_DEFS.find(d => d.type === node.actionType);
  if (!def) return null;
  return (
    <View>
      {def.amount && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.amountLabel')}</Text>
          <View style={styles.chipRow}>
            {AMOUNT_MODES.filter(m => !editorUi.basicMode || !('advanced' in m)).map(m => (
              <Chip key={m.id} label={t(`workshop.${m.labelKey}`)} selected={(node.amountMode ?? 'fixed') === m.id}
                onPress={() => update({ amountMode: m.id })} />
            ))}
          </View>
          {(node.amountMode ?? 'fixed') === 'fixed' && (
            <NtInput label={t('workshop.valueLabel')} value={node.amount ?? '1'} onChangeText={v => update({ amount: v })} keyboardType="number-pad" />
          )}
          {(node.amountMode ?? '').endsWith('Mult') && (
            <NtInput label={t('workshop.multiplierLabel')} value={node.amount ?? '2'} onChangeText={v => update({ amount: v })} keyboardType="number-pad" />
          )}
        </View>
      )}
      {def.enemyTarget && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.enemyTargetLabel')}</Text>
          <View style={styles.chipRow}>
            {ENEMY_TARGETS.map(tgt => (
              <Chip key={tgt.kind} label={t(`workshop.${tgt.labelKey}`)} selected={(node.target ?? 'SELECTED_ENEMY') === tgt.kind}
                onPress={() => update({ target: tgt.kind })} />
            ))}
          </View>
        </View>
      )}
      {def.heroTarget && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.heroTargetLabel')}</Text>
          <View style={styles.chipRow}>
            {HERO_TARGETS.map(ht => (
              <Chip key={ht.kind} label={t(`workshop.${ht.labelKey}`)} selected={(node.heroTarget ?? 'SELF') === ht.kind}
                onPress={() => update({ heroTarget: ht.kind })} />
            ))}
          </View>
        </View>
      )}
      {def.duration && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.durationLabel')}</Text>
          <View style={styles.chipRow}>
            {DURATIONS.map(d => (
              <Chip key={d.id} label={t(`workshop.${d.labelKey}`)} selected={(node.duration ?? 'HORDE_ATTACK') === d.id}
                onPress={() => update({ duration: d.id })} />
            ))}
          </View>
        </View>
      )}
      {def.scope && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.scopeLabel')}</Text>
          <View style={styles.chipRow}>
            {SCOPES.map(s => (
              <Chip key={s.id} label={t(`workshop.${s.labelKey}`)} selected={(node.scope ?? 'THIS_TURN') === s.id}
                onPress={() => update({ scope: s.id })} />
            ))}
          </View>
        </View>
      )}
      {def.count && (
        <NtInput label={t(`workshop.${def.countLabelKey ?? 'defaultCountLabel'}`)} value={node.targetCount ?? '2'} onChangeText={v => update({ targetCount: v })} keyboardType="number-pad" />
      )}
      {def.resource && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.resourceLabel')}</Text>
          <View style={styles.chipRow}>
            {(['COINS', 'GLORY'] as const).map(r => (
              <Chip key={r} label={r === 'COINS' ? t('workshop.resourceCoins') : t('workshop.resourceGlory')} selected={(node.resource ?? 'COINS') === r}
                onPress={() => update({ resource: r })} />
            ))}
          </View>
        </View>
      )}
      {def.to && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.destinationLabel')}</Text>
          <View style={styles.chipRow}>
            {DESTINATIONS.filter(d => d.id !== 'REMOVED_FROM_GAME').map(d => (
              <Chip key={d.id} label={t(`workshop.${d.labelKey}`)} selected={(node.to ?? 'HAND') === d.id}
                onPress={() => update({ to: d.id })} />
            ))}
          </View>
        </View>
      )}
      {def.cardName && (
        <CardNameField label={t('workshop.cardNameParamLabel')} value={node.cardName ?? ''}
          onChange={v => update({ cardName: v })} placeholder={t('workshop.cardNameParamPlaceholder')} />
      )}
      {def.handler && (
        <View>
          <NtInput label={t('workshop.handlerLabel')} value={node.cardName ?? ''}
            onChangeText={v => update({ cardName: v })} placeholder="scenario.kalern-mud" />
          <View style={styles.chipRow}>
            {SCENARIO_HANDLERS.map(h => (
              <Chip key={h} label={h.replace('scenario.', '')} selected={node.cardName === h}
                onPress={() => update({ cardName: h })} a11y={h} />
            ))}
          </View>
        </View>
      )}
      {def.searchAction && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.searchActionLabel')}</Text>
          <View style={styles.chipRow}>
            {([{ id: 'PUT_IN_HAND', labelKey: 'searchPutInHand' }, { id: 'SWAP_WITH_HAND', labelKey: 'searchSwapWithHand' }] as const).map(a => (
              <Chip key={a.id} label={t(`workshop.${a.labelKey}`)} selected={(node.searchAction ?? 'PUT_IN_HAND') === a.id}
                onPress={() => update({ searchAction: a.id })} />
            ))}
          </View>
        </View>
      )}
      {def.searchDeck && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.deckLabel')}</Text>
          <View style={styles.chipRow}>
            {([{ id: 'ABILITY', labelKey: 'deckAbility' }, { id: 'MARKET', labelKey: 'deckMarket' }, { id: 'HORDE', labelKey: 'deckHorde' }] as const).map(d => (
              <Chip key={d.id} label={t(`workshop.${d.labelKey}`)} selected={(node.searchDeck ?? 'ABILITY') === d.id}
                onPress={() => update({ searchDeck: d.id })} />
            ))}
          </View>
        </View>
      )}
      {def.coinTarget && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.coinTargetLabel')}</Text>
          <View style={styles.chipRow}>
            {([{ id: '', labelKey: 'coinTargetActive' }, { id: 'DEFEATING_HERO', labelKey: 'coinTargetDefeater' }, { id: 'SELF', labelKey: 'heroSelf' }] as const).map(who => (
              <Chip key={who.id} label={t(`workshop.${who.labelKey}`)} selected={(node.heroTarget ?? '') === who.id}
                onPress={() => update({ heroTarget: who.id || undefined })} />
            ))}
          </View>
        </View>
      )}
      {def.inherit && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.inheritTargetLabel')}</Text>
          <View style={styles.chipRow}>
            <Chip label={t('workshop.yes')} selected={!!node.inheritTarget} onPress={() => update({ inheritTarget: !node.inheritTarget })} />
          </View>
        </View>
      )}
      {def.times && (
        <NtInput label={t('workshop.hitsLabel')} value={node.times ?? '2'} onChangeText={v => update({ times: v })} keyboardType="number-pad" />
      )}
      {def.spillTarget && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.spillTargetLabel')}</Text>
          <View style={styles.chipRow}>
            {ENEMY_TARGETS.filter(tgt => tgt.kind !== 'SELECTED_ENEMY').map(tgt => (
              <Chip key={tgt.kind} label={t(`workshop.${tgt.labelKey}`)} selected={(node.spillTarget ?? 'OTHER_ENEMY') === tgt.kind}
                onPress={() => update({ spillTarget: tgt.kind })} />
            ))}
          </View>
        </View>
      )}
      {def.statusId && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.statusLabel')}</Text>
          <View style={styles.chipRow}>
            {STATUS_IDS.map(s => (
              <Chip key={s.id} label={t(`workshop.${s.labelKey}`)} selected={(node.statusId ?? 'mark') === s.id}
                onPress={() => update({ statusId: s.id })} />
            ))}
            <Chip label={t('workshop.statusCustom')} selected={node.statusId === 'custom'}
              onPress={() => update({ statusId: 'custom' })} />
          </View>
          {node.statusId === 'custom' && (
            <NtInput label={t('workshop.customStatusIdLabel')} value={node.cardName ?? ''}
              onChangeText={v => update({ cardName: v })} placeholder="mi_estado" />
          )}
        </View>
      )}
      {def.statusDur && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.statusDurationLabel')}</Text>
          <View style={styles.chipRow}>
            {([{ id: 'PERMANENT', labelKey: 'statusDurPermanent' }, { id: 'UNTIL_END_OF_TURN', labelKey: 'durEndOfTurn' }] as const).map(d => (
              <Chip key={d.id} label={t(`workshop.${d.labelKey}`)} selected={(node.duration ?? 'PERMANENT') === d.id}
                onPress={() => update({ duration: d.id })} />
            ))}
          </View>
        </View>
      )}
      {def.moveFromTo && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.moveFromLabel')}</Text>
          <View style={styles.chipRow}>
            {([{ id: 'HAND', labelKey: 'zoneHand' }, { id: 'WEAR_PILE', labelKey: 'zoneWearPile' }, { id: 'ABILITY_DECK', labelKey: 'zoneDeck' }] as const).map(z => (
              <Chip key={z.id} label={t(`workshop.${z.labelKey}`)} selected={(node.moveFrom ?? 'WEAR_PILE') === z.id}
                onPress={() => update({ moveFrom: z.id })} />
            ))}
          </View>
          <Text style={styles.miniLabel}>{t('workshop.destinationLabel')}</Text>
          <View style={styles.chipRow}>
            {([{ id: 'HAND', labelKey: 'zoneHand' }, { id: 'WEAR_PILE', labelKey: 'zoneWearPile' }, { id: 'ABILITY_DECK', labelKey: 'zoneDeckBottom' }, { id: 'REMOVED_FROM_GAME', labelKey: 'zoneRemoved' }] as const).map(z => (
              <Chip key={z.id} label={t(`workshop.${z.labelKey}`)} selected={(node.moveTo ?? 'HAND') === z.id}
                onPress={() => update({ moveTo: z.id })} />
            ))}
          </View>
        </View>
      )}
      {def.hordeDir && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.hordeDirLabel')}</Text>
          <View style={styles.chipRow}>
            {([{ id: 'BOTTOM', labelKey: 'hordeBottom' }, { id: 'TOP', labelKey: 'hordeTop' }] as const).map(d => (
              <Chip key={d.id} label={t(`workshop.${d.labelKey}`)} selected={(node.hordeDir ?? 'BOTTOM') === d.id}
                onPress={() => update({ hordeDir: d.id })} />
            ))}
          </View>
        </View>
      )}
      {def.varName && (
        <NtInput label={t('workshop.varNameLabel')} value={node.varName ?? ''}
          onChangeText={v => update({ varName: v })} placeholder="mi_variable" />
      )}
      {def.varScope && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.varScopeLabel')}</Text>
          <View style={styles.chipRow}>
            {([{ id: 'RESOLUTION', labelKey: 'varScopeResolution' }, { id: 'GAME', labelKey: 'varScopeGame' }] as const).map(s => (
              <Chip key={s.id} label={t(`workshop.${s.labelKey}`)} selected={(node.varScope ?? 'RESOLUTION') === s.id}
                onPress={() => update({ varScope: s.id })} />
            ))}
          </View>
        </View>
      )}
      {(node.amountMode ?? '') === 'variable' && !def.varName && (
        <NtInput label={t('workshop.varNameLabel')} value={node.varName ?? ''}
          onChangeText={v => update({ varName: v })} placeholder="mi_variable" />
      )}
    </View>
  );
}

export const KIND_META: Record<NodeKind, { badgeKey: string; labelKey: string; hintKey: string }> = {
  ACTION: { badgeKey: 'kindActionBadge', labelKey: 'kindActionLabel', hintKey: 'kindActionHint' },
  COND: { badgeKey: 'kindCondBadge', labelKey: 'kindCondLabel', hintKey: 'kindCondHint' },
  REPEAT: { badgeKey: 'kindRepeatBadge', labelKey: 'kindRepeatLabel', hintKey: 'kindRepeatHint' },
  CHOOSE: { badgeKey: 'kindChooseBadge', labelKey: 'kindChooseLabel', hintKey: 'kindChooseHint' },
  ON_DEFEAT: { badgeKey: 'kindOnDefeatBadge', labelKey: 'kindOnDefeatLabel', hintKey: 'kindOnDefeatHint' },
  ON_HORDE: { badgeKey: 'kindOnHordeBadge', labelKey: 'kindOnHordeLabel', hintKey: 'kindOnHordeHint' },
  ON_ENEMY_DEF: { badgeKey: 'kindOnEnemyDefBadge', labelKey: 'kindOnEnemyDefLabel', hintKey: 'kindOnEnemyDefHint' },
  PERSISTENT: { badgeKey: 'kindPersistentBadge', labelKey: 'kindPersistentLabel', hintKey: 'kindPersistentHint' },
  DRAW_CHECK: { badgeKey: 'kindDrawCheckBadge', labelKey: 'kindDrawCheckLabel', hintKey: 'kindDrawCheckHint' },
  FOR_EACH: { badgeKey: 'kindForEachBadge', labelKey: 'kindForEachLabel', hintKey: 'kindForEachHint' },
  TRY: { badgeKey: 'kindTryBadge', labelKey: 'kindTryLabel', hintKey: 'kindTryHint' },
  LISTEN: { badgeKey: 'kindListenBadge', labelKey: 'kindListenLabel', hintKey: 'kindListenHint' },
};





export const hasChildren = (n: EffectNode): boolean =>
  (n.thenN?.length ?? 0) + (n.elseN?.length ?? 0) + (n.children?.length ?? 0)
    + (n.options ?? []).reduce((s, o) => s + o.children.length, 0) > 0;

export function EffectList({ nodes, onChange, depth, cardType }: ListProps) {
  const { t } = useTranslation();
  const [pickerFor, setPickerFor] = useState<'root' | number | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [wrapFor, setWrapFor] = useState<number | null>(null);
  // Selección múltiple (§3.2): modo selección + conjunto de keys marcadas.
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  // Biblioteca de fragmentos reutilizables (§22, persistida en el store).
  const fragments = useCustomContent(s => s.fragments);
  const saveFragment = useCustomContent(s => s.saveFragment);
  const removeFragment = useCustomContent(s => s.removeFragment);
  // gestureAlternatives: toda interacción de arrastre tiene alternativa
  // táctil (↑↓). En nativo las flechas son obligatorias (no hay drag).
  const gestureAlt = useSettingsSafe(s => s.gestureAlternatives);
  const listIdRef = useRef(0);
  if (!listIdRef.current) listIdRef.current = ++effectListSeq;
  // Tras un drop entre listas distintas, la lista origen borra el nodo en su
  // proximo render (el onChange del destino ya inserto el clon).
  useEffect(() => {
    const r = editorUi.dndPendingRemoval;
    if (r && r.list === listIdRef.current && nodes[r.index]?.key === r.key) {
      editorUi.dndPendingRemoval = null;
      onChange(nodes.filter((_, xi) => xi !== r.index));
    }
  });
  /** Drop en la posicion toIndex: reordena dentro de la lista o mueve el
   *  nodo desde otra rama/lista (el origen lo borra via dndPendingRemoval). */
  const dropOn = (toIndex: number) => {
    const p = editorUi.dnd;
    if (!p) return;
    editorUi.dnd = null;
    if (p.list === listIdRef.current) {
      onChange(moveToIndex(nodes, p.index, toIndex));
    } else {
      editorUi.dndPendingRemoval = { list: p.list, index: p.index, key: p.node.key };
      onChange([...nodes.slice(0, toIndex), cloneSubtree(p.node), ...nodes.slice(toIndex)]);
    }
    bump();
  };
  // Tick para repintar al mutar collapsedNodes (estado global del árbol).
  const [, setCollapseTick] = useState(0);
  const bump = () => setCollapseTick(x => x + 1);
  const toggleCollapse = (key: number) => {
    if (collapsedNodes.has(key)) collapsedNodes.delete(key);
    else collapsedNodes.add(key);
    bump();
  };
  const collapseAll = () => {
    const collect = (list: EffectNode[]) => list.forEach(n => {
      if (hasChildren(n)) collapsedNodes.add(n.key);
      collect(n.thenN ?? []); collect(n.elseN ?? []); collect(n.children ?? []);
      (n.options ?? []).forEach(o => collect(o.children));
    });
    collect(nodes);
    bump();
  };
  const expandAll = () => { collapsedNodes.clear(); bump(); };

  const update = (i: number, patch: Partial<EffectNode>) =>
    onChange(nodes.map((n, xi) => (xi === i ? { ...n, ...patch } : n)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= nodes.length) return;
    const next = [...nodes];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const dup = (i: number) =>
    onChange([...nodes.slice(0, i + 1), cloneSubtree(nodes[i]), ...nodes.slice(i + 1)]);
  const del = (i: number) => {
    const size = countNodes([nodes[i]]);
    if (size > 1) {
      // Borrado con descendientes: confirmación (web) — en nativo sin
      // window.confirm se elimina directo (poco usual en móvil).
      const g = globalThis as { confirm?: (m: string) => boolean };
      if (typeof g.confirm === 'function'
        && !g.confirm(t('workshop.deleteBranchConfirm', { count: size - 1 }))) {
        return;
      }
    }
    collapsedNodes.delete(nodes[i].key);
    onChange(nodes.filter((_, xi) => xi !== i));
  };

  const addNode = (kind: NodeKind, actionType?: string) => {
    const base: EffectNode = { key: k(), kind, actionType };
    if (kind === 'COND') { base.condKind = 'HAS_CAPABILITY'; base.condParam = 'EXPERTISE'; base.thenN = []; base.elseN = []; }
    if (kind === 'REPEAT') { base.times = '2'; base.timesMode = 'fixed'; base.max = '5'; base.children = []; }
    if (kind === 'CHOOSE') {
      base.prompt = t('workshop.defaultPrompt');
      base.options = [
        { label: t('workshop.optionLabel', { n: 'A' }), children: [{ key: k(), kind: 'ACTION', actionType: 'GAIN_COINS', amountMode: 'fixed', amount: '1' }] },
        { label: t('workshop.optionLabel', { n: 'B' }), children: [{ key: k(), kind: 'ACTION', actionType: 'SHIELD', amountMode: 'fixed', amount: '1' }] },
      ];
    }
    if (kind === 'ON_DEFEAT' || kind === 'ON_HORDE' || kind === 'PERSISTENT' || kind === 'ON_ENEMY_DEF') base.children = [];
    if (kind === 'FOR_EACH') { base.collection = 'ENEMIES'; base.children = []; }
    if (kind === 'TRY') {
      base.children = [{ key: k(), kind: 'ACTION', actionType: 'GAIN_COINS', amountMode: 'fixed', amount: '1' }];
      base.elseN = [];
    }
    if (kind === 'LISTEN') {
      base.listenEvent = 'DAMAGE_DEALT';
      base.duration = 'THIS_TURN';
      base.children = [];
    }
    if (kind === 'DRAW_CHECK') {
      base.amount = '1'; base.amountMode = 'fixed';
      base.thenN = [{ key: k(), kind: 'ACTION', actionType: 'PLAY_IMMEDIATELY' }];
      base.elseN = [];
    }
    onChange([...nodes, base]);
    setPickerFor(null);
  };

  /** Envuelve el nodo i dentro de un contenedor (§3.2 "agrupar bajo"). */
  const wrap = (i: number, kind: WrapKind) => {
    onChange(wrapInContainer(nodes, i, kind));
    setWrapFor(null);
  };

  /** Extrae los hijos de un contenedor en su lista padre (inverso de wrap). */
  const unwrap = (i: number) => {
    collapsedNodes.delete(nodes[i].key);
    onChange(unwrapAt(nodes, i));
  };

  // ---- Selección múltiple (§3.2) ---------------------------------------------
  const toggleSel = (key: number) => {
    setSel(prev => { const s = new Set(prev); if (s.has(key)) s.delete(key); else s.add(key); return s; });
  };
  const selIndices = nodes.map((n, i) => (sel.has(n.key) ? i : -1)).filter(i => i >= 0);
  const bulkCopy = () => {
    editorUi.clipboard = nodes.filter(n => sel.has(n.key)).map(n => structuredClone(n));
    bump();
  };
  const bulkWrap = (kind: WrapKind) => {
    onChange(wrapManyInContainer(nodes, selIndices, kind));
    setSel(new Set()); setWrapFor(null);
  };
  const bulkDelete = () => {
    const total = countNodes(nodes.filter(n => sel.has(n.key)));
    if (total > 1) {
      const g = globalThis as { confirm?: (m: string) => boolean };
      if (typeof g.confirm === 'function'
        && !g.confirm(t('workshop.deleteBranchConfirm', { count: total - 1 }))) return;
    }
    for (const n of nodes) if (sel.has(n.key)) collapsedNodes.delete(n.key);
    onChange(nodes.filter(n => !sel.has(n.key)));
    setSel(new Set());
  };

  /** Guarda el subárbol del nodo i como fragmento reutilizable (§22). */
  const saveAsFragment = (i: number) => {
    const g = globalThis as { prompt?: (m: string, d?: string) => string | null };
    const name = typeof g.prompt === 'function'
      ? (g.prompt(t('workshop.fragmentNamePrompt'), nodeText(nodes[i], t).slice(0, 40)) ?? '')
      : '';
    saveFragment(name, structuredClone([nodes[i]]));
  };

  /** Pega el portapapeles después del nodo i (insertar debajo, §3.2). */
  const pasteBelow = (i: number) => {
    onChange([...nodes.slice(0, i + 1), ...editorUi.clipboard.map(cloneSubtree), ...nodes.slice(i + 1)]);
    bump();
  };

  const allowedActions = ACTION_DEFS.filter(d => {
    const meta = EFFECT_REGISTRY.find(m => m.type === d.type);
    return meta ? meta.allowedSources.includes(cardType) : true;
  });
  const q = pickerQuery.trim().toLowerCase();
  const filteredActions = q
    ? allowedActions.filter(d =>
      t(`workshop.${d.labelKey}`).toLowerCase().includes(q) || d.type.toLowerCase().includes(q))
    : allowedActions;

  return (
    <View style={depth > 0 ? styles.nested : undefined}>
      {nodes.map((n, i) => (
        <DndDrop key={n.key} index={i} onDropAt={dropOn}>
        <View key={n.key} style={[styles.node,
          n.key === editorUi.focusedKey ? styles.nodeFocused
          : diagErrorKeys.has(n.key) ? styles.nodeError
          : diagWarnKeys.has(n.key) ? styles.nodeWarn : null]}
          accessibilityLabel={t('workshop.nodeDepthA11y', {
            kind: t(`workshop.${KIND_META[n.kind].labelKey}`), depth: depth + 1,
          })}>
          <View style={styles.nodeHeader}>
            {selMode && (
              <Pressable onPress={() => toggleSel(n.key)} accessibilityRole="button"
                accessibilityLabel={t('workshop.selectNodeA11y', { label: nodeText(n, t) })}
                style={styles.ctrl} hitSlop={4}>
                <Text style={styles.ctrlTxt}>{sel.has(n.key) ? '☑' : '☐'}</Text>
              </Pressable>
            )}
            {hasChildren(n) && (
              <Pressable
                onPress={() => toggleCollapse(n.key)}
                accessibilityRole="button"
                accessibilityLabel={t(collapsedNodes.has(n.key) ? 'workshop.expandNodeA11y' : 'workshop.collapseNodeA11y')}
                style={styles.ctrl} hitSlop={4}
              >
                <Text style={styles.ctrlTxt}>{collapsedNodes.has(n.key) ? '▸' : '▾'}</Text>
              </Pressable>
            )}
            <NtBadge label={t(`workshop.${KIND_META[n.kind].badgeKey}`)} tone="accent" />
            <Text style={styles.nodeText} numberOfLines={1}>{nodeText(n, t)}</Text>
            <View style={styles.ctrlRow}>
              {IS_WEB && <DndHandle payload={{ list: listIdRef.current, index: i, node: n }} />}
              {(!IS_WEB || gestureAlt) && (
                <>
                  <Pressable onPress={() => move(i, -1)} disabled={i === 0} accessibilityRole="button" accessibilityLabel={t('workshop.moveUp')} style={[styles.ctrl, i === 0 && styles.ctrlOff]}><Text style={styles.ctrlTxt}>↑</Text></Pressable>
                  <Pressable onPress={() => move(i, 1)} disabled={i === nodes.length - 1} accessibilityRole="button" accessibilityLabel={t('workshop.moveDown')} style={[styles.ctrl, i === nodes.length - 1 && styles.ctrlOff]}><Text style={styles.ctrlTxt}>↓</Text></Pressable>
                </>
              )}
              <Pressable onPress={() => dup(i)} accessibilityRole="button" accessibilityLabel={t('workshop.duplicate')} style={styles.ctrl}><Text style={styles.ctrlTxt}>⧉</Text></Pressable>
              <Pressable onPress={() => { editorUi.clipboard = [structuredClone(nodes[i])]; bump(); }}
                accessibilityRole="button" accessibilityLabel={t('workshop.copyNodeA11y')} style={styles.ctrl}><Text style={styles.ctrlTxt}>⎘</Text></Pressable>
              {editorUi.clipboard.length > 0 && (
                <Pressable onPress={() => pasteBelow(i)}
                  accessibilityRole="button" accessibilityLabel={t('workshop.pasteBelowA11y')} style={styles.ctrl}><Text style={styles.ctrlTxt}>⇩</Text></Pressable>
              )}
              <Pressable onPress={() => saveAsFragment(i)}
                accessibilityRole="button" accessibilityLabel={t('workshop.saveFragmentA11y')} style={styles.ctrl}><Text style={styles.ctrlTxt}>▤</Text></Pressable>
              <Pressable onPress={() => setWrapFor(wrapFor === i ? null : i)}
                accessibilityRole="button" accessibilityLabel={t('workshop.wrapNodeA11y')} style={styles.ctrl}><Text style={styles.ctrlTxt}>⇲</Text></Pressable>
              {hasChildren(n) && (
                <Pressable onPress={() => unwrap(i)}
                  accessibilityRole="button" accessibilityLabel={t('workshop.unwrapNodeA11y')} style={styles.ctrl}><Text style={styles.ctrlTxt}>⇱</Text></Pressable>
              )}
              <Pressable onPress={() => del(i)} accessibilityRole="button" accessibilityLabel={t('workshop.delete')} style={styles.ctrl}><Text style={styles.ctrlTxt}>✕</Text></Pressable>
            </View>
          </View>
          {wrapFor === i && (
            <View style={styles.chipRow}>
              <Text style={styles.miniLabel}>{t('workshop.wrapTitle')}</Text>
              {(['COND', 'REPEAT', 'TRY', 'FOR_EACH'] as const).map(kind => (
                <Chip key={kind} label={t(`workshop.${KIND_META[kind].badgeKey}`)} selected={false}
                  onPress={() => wrap(i, kind)} />
              ))}
            </View>
          )}

          {!collapsedNodes.has(n.key) && (<>
          <Text style={styles.hint}>{t(`workshop.${KIND_META[n.kind].hintKey}`)}</Text>
          {n.kind === 'ACTION' && <ActionParams node={n} update={p => update(i, p)} />}

          {n.kind === 'COND' && (
            <View>
              <Text style={styles.miniLabel}>{t('workshop.conditionLabel')}</Text>
              <View style={styles.chipRow}>
                {CONDITIONS.map(c => (
                  <Chip key={c.id} label={t(`workshop.${c.labelKey}`)} selected={n.condKind === c.id}
                    onPress={() => update(i, { condKind: c.id })} />
                ))}
              </View>
              {CONDITIONS.find(c => c.id === n.condKind)?.param === 'cap' && (
                <View style={styles.chipRow}>
                  {CAPABILITIES.map(cap => (
                    <Chip key={cap} label={t(`workshop.${CAP_NAME_KEYS[cap]}`)} selected={(n.condParam ?? 'EXPERTISE') === cap}
                      onPress={() => update(i, { condParam: cap })} />
                  ))}
                </View>
              )}
              {CONDITIONS.find(c => c.id === n.condKind)?.param === 'name' && (
                <NtInput label={t('workshop.cardNameLabel')} value={n.condParam ?? ''}
                  onChangeText={v => update(i, { condParam: v })} />
              )}
              {CONDITIONS.find(c => c.id === n.condKind)?.param === 'int' && (
                <NtInput label={t('workshop.valueLabel')} value={n.condParam ?? '2'} onChangeText={v => update(i, { condParam: v })} keyboardType="number-pad" />
              )}
              {CONDITIONS.find(c => c.id === n.condKind)?.param === 'var' && (
                <View>
                  <NtInput label={t('workshop.varNameLabel')} value={n.condParam ?? ''}
                    onChangeText={v => update(i, { condParam: v })} placeholder="mi_variable" />
                  <NtInput label={t('workshop.valueLabel')} value={n.condValue ?? '1'}
                    onChangeText={v => update(i, { condValue: v })} keyboardType="number-pad" />
                </View>
              )}
              {CONDITIONS.find(c => c.id === n.condKind)?.param === 'name' && (
                <NtInput label={t('workshop.cardNameLabel')} value={n.condParam ?? ''} onChangeText={v => update(i, { condParam: v })} placeholder={t('workshop.cardNamePlaceholderSword')} />
              )}
              {CONDITIONS.find(c => c.id === n.condKind)?.param === 'status' && (
                <View>
                  <View style={styles.chipRow}>
                    {STATUS_IDS.map(s => (
                      <Chip key={s.id} label={t(`workshop.${s.labelKey}`)} selected={(n.condParam ?? 'mark') === s.id}
                        onPress={() => update(i, { condParam: s.id })} />
                    ))}
                    <Chip label={t('workshop.statusCustom')}
                      selected={!!n.condParam && !STATUS_IDS.some(s => s.id === n.condParam)}
                      onPress={() => update(i, { condParam: 'mi_estado' })} />
                  </View>
                  {!!n.condParam && !STATUS_IDS.some(s => s.id === n.condParam) && (
                    <NtInput label={t('workshop.statusIdLabel')} value={n.condParam} onChangeText={v => update(i, { condParam: v })} placeholder="mi_estado" />
                  )}
                </View>
              )}
              {/* Condiciones compuestas (schema AND/OR/NOT) — modo avanzado */}
              {!editorUi.basicMode && (
                <View>
                  <View style={styles.chipRow}>
                    <Chip label={t('workshop.condNotLabel')} selected={!!n.condNot}
                      onPress={() => update(i, { condNot: !n.condNot })} />
                    {(['AND', 'OR'] as const).map(j => (
                      <Chip key={j} label={t(`workshop.condJoin${j}`)} selected={n.condJoin === j}
                        onPress={() => update(i, { condJoin: n.condJoin === j ? undefined : j })} />
                    ))}
                  </View>
                  {(n.condJoin === 'AND' || n.condJoin === 'OR') && (
                    <View>
                      <Text style={styles.miniLabel}>{t('workshop.secondCondLabel')}</Text>
                      <View style={styles.chipRow}>
                        {CONDITIONS.map(c => (
                          <Chip key={c.id} label={t(`workshop.${c.labelKey}`)} selected={n.condKind2 === c.id}
                            onPress={() => update(i, { condKind2: c.id })} />
                        ))}
                      </View>
                      {CONDITIONS.find(c => c.id === n.condKind2)?.param === 'cap' && (
                        <View style={styles.chipRow}>
                          {CAPABILITIES.map(cap => (
                            <Chip key={cap} label={t(`workshop.${CAP_NAME_KEYS[cap]}`)} selected={(n.condParam2 ?? 'EXPERTISE') === cap}
                              onPress={() => update(i, { condParam2: cap })} />
                          ))}
                        </View>
                      )}
                      {CONDITIONS.find(c => c.id === n.condKind2)?.param != null
                        && CONDITIONS.find(c => c.id === n.condKind2)?.param !== 'cap' && (
                        <NtInput label={t('workshop.valueLabel')} value={n.condParam2 ?? ''}
                          onChangeText={v => update(i, { condParam2: v })} />
                      )}
                      {CONDITIONS.find(c => c.id === n.condKind2)?.param === 'var' && (
                        <NtInput label={t('workshop.valueLabel')} value={n.condValue2 ?? '1'}
                          onChangeText={v => update(i, { condValue2: v })} keyboardType="number-pad" />
                      )}
                    </View>
                  )}
                </View>
              )}
              <Text style={styles.miniLabel}>{t('workshop.thenLabel')}</Text>
              <EffectList nodes={n.thenN ?? []} onChange={l => update(i, { thenN: l })} depth={depth + 1} cardType={cardType} />
              <Text style={styles.miniLabel}>{t('workshop.elseLabel')}</Text>
              <EffectList nodes={n.elseN ?? []} onChange={l => update(i, { elseN: l })} depth={depth + 1} cardType={cardType} />
            </View>
          )}

          {n.kind === 'REPEAT' && (
            <View>
              <View style={styles.twoCol}>
                <NtInput label={t('workshop.timesLabel')} value={n.times ?? '2'} onChangeText={v => update(i, { times: v })} keyboardType="number-pad" />
                <NtInput label={t('workshop.maxLabel')} value={n.max ?? '5'} onChangeText={v => update(i, { max: v })} keyboardType="number-pad" />
              </View>
              <Text style={styles.miniLabel}>{t('workshop.repeatPerLabel')}</Text>
              <View style={styles.chipRow}>
                <Chip label={t('workshop.repeatFixed')} selected={(n.timesMode ?? 'fixed') === 'fixed'} onPress={() => update(i, { timesMode: 'fixed' })} />
                <Chip label={t('workshop.repeatPerEnemy')} selected={n.timesMode === 'enemies'} onPress={() => update(i, { timesMode: 'enemies' })} />
                <Chip label={t('workshop.repeatPerFieldEnemy')} selected={n.timesMode === 'fieldEnemies'} onPress={() => update(i, { timesMode: 'fieldEnemies' })} />
              </View>
              <EffectList nodes={n.children ?? []} onChange={l => update(i, { children: l })} depth={depth + 1} cardType={cardType} />
            </View>
          )}

          {n.kind === 'CHOOSE' && (
            <View>
              <NtInput label={t('workshop.questionLabel')} value={n.prompt ?? ''} onChangeText={v => update(i, { prompt: v })} />
              {(n.options ?? []).map((o, oi) => (
                <View key={oi} style={styles.optionBox}>
                  <View style={styles.nodeHeader}>
                    <NtInput label={t('workshop.optionLabel', { n: oi + 1 })} value={o.label}
                      onChangeText={v => update(i, { options: (n.options ?? []).map((x, xi) => xi === oi ? { ...x, label: v } : x) })} />
                    {(n.options ?? []).length > 2 && (
                      <Pressable onPress={() => update(i, { options: (n.options ?? []).filter((_, xi) => xi !== oi) })}
                        accessibilityRole="button" accessibilityLabel={t('workshop.removeOptionA11y')} style={styles.ctrl}>
                        <Text style={styles.ctrlTxt}>✕</Text>
                      </Pressable>
                    )}
                  </View>
                  <EffectList nodes={o.children}
                    onChange={l => update(i, { options: (n.options ?? []).map((x, xi) => xi === oi ? { ...x, children: l } : x) })}
                    depth={depth + 1} cardType={cardType} />
                </View>
              ))}
              {(n.options ?? []).length < 6 && (
                <NtButton label={t('workshop.addOption')} variant="ghost" size="sm"
                  onPress={() => update(i, { options: [...(n.options ?? []), { label: t('workshop.optionLabel', { n: (n.options ?? []).length + 1 }), children: [] }] })} />
              )}
              <Chip label={t('workshop.playerMaySkip')} selected={!!n.optional}
                onPress={() => update(i, { optional: !n.optional })} />
            </View>
          )}

          {n.kind === 'FOR_EACH' && (
            <View>
              <Text style={styles.miniLabel}>{t('workshop.forEachLabel')}</Text>
              <View style={styles.chipRow}>
                {([{ id: 'ENEMIES', labelKey: 'forEachEnemyChip' }, { id: 'OTHER_HEROES', labelKey: 'forEachOtherHeroChip' }, { id: 'ALL_HEROES', labelKey: 'forEachHeroChip' }] as const).map(c => (
                  <Chip key={c.id} label={t(`workshop.${c.labelKey}`)} selected={(n.collection ?? 'ENEMIES') === c.id}
                    onPress={() => update(i, { collection: c.id })} />
                ))}
              </View>
              <Text style={styles.hint}>
                {t('workshop.forEachHint')}
              </Text>
              <EffectList nodes={n.children ?? []} onChange={l => update(i, { children: l })} depth={depth + 1} cardType={cardType} />
            </View>
          )}

          {(n.kind === 'ON_DEFEAT' || n.kind === 'ON_HORDE' || n.kind === 'PERSISTENT' || n.kind === 'ON_ENEMY_DEF') && (
            <View>
              {n.kind === 'PERSISTENT' && (
                <View>
                  <Text style={styles.miniLabel}>{t('workshop.triggerLabel')}</Text>
                  <View style={styles.chipRow}>
                    <Chip label={t('workshop.triggerHordeAttack')} selected={(n.persistTrigger ?? 'HORDE_ATTACK') === 'HORDE_ATTACK'}
                      onPress={() => update(i, { persistTrigger: 'HORDE_ATTACK' })} />
                  </View>
                  <Text style={styles.hint}>
                    {t('workshop.persistentHint')}
                  </Text>
                </View>
              )}
              {n.kind === 'ON_ENEMY_DEF' && (
                <NtInput label={t('workshop.fortitudeGteLabel')} value={n.fortitudeGte ?? ''}
                  onChangeText={v => update(i, { fortitudeGte: v })} keyboardType="number-pad" />
              )}
              <EffectList nodes={n.children ?? []} onChange={l => update(i, { children: l })} depth={depth + 1} cardType={cardType} />
            </View>
          )}

          {n.kind === 'TRY' && (
            <View>
              <Text style={styles.miniLabel}>{t('workshop.tryEffectsLabel')}</Text>
              <EffectList nodes={n.children ?? []} onChange={l => update(i, { children: l })} depth={depth + 1} cardType={cardType} />
              <Text style={styles.miniLabel}>{t('workshop.tryFallbackLabel')}</Text>
              <EffectList nodes={n.elseN ?? []} onChange={l => update(i, { elseN: l })} depth={depth + 1} cardType={cardType} />
            </View>
          )}

          {n.kind === 'LISTEN' && (
            <View>
              <Text style={styles.miniLabel}>{t('workshop.listenEventLabel')}</Text>
              <View style={styles.chipRow}>
                {LISTEN_EVENTS.map(ev => (
                  <Chip key={ev.id} label={t(`workshop.${ev.labelKey}`)} selected={(n.listenEvent ?? 'DAMAGE_DEALT') === ev.id}
                    onPress={() => update(i, { listenEvent: ev.id })} />
                ))}
              </View>
              <View style={styles.chipRow}>
                {([{ id: 'THIS_TURN', labelKey: 'scopeThisTurn' }, { id: 'GAME', labelKey: 'listenDurGame' }] as const).map(d => (
                  <Chip key={d.id} label={t(`workshop.${d.labelKey}`)} selected={(n.duration ?? 'THIS_TURN') === d.id}
                    onPress={() => update(i, { duration: d.id })} />
                ))}
                <Chip label={t('workshop.listenOnce')} selected={!!n.once}
                  onPress={() => update(i, { once: !n.once })} />
              </View>
              <NtInput label={t('workshop.listenTagLabel')} value={n.listenTag ?? ''}
                onChangeText={v => update(i, { listenTag: v })} placeholder={t('workshop.listenTagPlaceholder')} />
              <Text style={styles.hint}>{t('workshop.listenHint')}</Text>
              <EffectList nodes={n.children ?? []} onChange={l => update(i, { children: l })} depth={depth + 1} cardType={cardType} />
            </View>
          )}

          {n.kind === 'DRAW_CHECK' && (
            <View>
              <NtInput label={t('workshop.expectedCardLabel')} value={n.cardName ?? ''}
                onChangeText={v => update(i, { cardName: v })} placeholder={t('workshop.expectedCardPlaceholder')} />
              <View>
                <Text style={styles.miniLabel}>{t('workshop.amountLabel')}</Text>
                <NtInput label={t('workshop.drawCountLabel')} value={n.amount ?? '1'}
                  onChangeText={v => update(i, { amount: v })} keyboardType="number-pad" />
              </View>
              <Text style={styles.miniLabel}>{t('workshop.onMatchLabel')}</Text>
              <EffectList nodes={n.thenN ?? []} onChange={l => update(i, { thenN: l })} depth={depth + 1} cardType={cardType} />
              <Text style={styles.miniLabel}>{t('workshop.onMismatchLabel')}</Text>
              <EffectList nodes={n.elseN ?? []} onChange={l => update(i, { elseN: l })} depth={depth + 1} cardType={cardType} />
            </View>
          )}
          </>)}
        </View>
        </DndDrop>
      ))}
      <DndDrop index={nodes.length} onDropAt={dropOn}><View style={{ height: 6 }} /></DndDrop>

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <NtButton label={t('workshop.addEffect')} variant="secondary" size="sm" onPress={() => setPickerFor(pickerFor === -1 ? null : -1)} />
        {editorUi.clipboard.length > 0 && (
          <NtButton label={t('workshop.pasteNode')} variant="ghost" size="sm"
            onPress={() => onChange([...nodes, ...editorUi.clipboard.map(cloneSubtree)])} />
        )}
        <NtButton label={t(selMode ? 'workshop.selectDone' : 'workshop.selectMode')}
          variant="ghost" size="sm" accessibilityLabel={t('workshop.selectModeA11y')}
          onPress={() => { setSelMode(m => !m); setSel(new Set()); }} />
        {depth === 0 && (
          <>
            <NtButton label={t('workshop.collapseAll')} variant="ghost" size="sm" onPress={collapseAll} />
            <NtButton label={t('workshop.expandAll')} variant="ghost" size="sm" onPress={expandAll} />
            <NtButton
              label={t(editorUi.basicMode ? 'workshop.modeAdvanced' : 'workshop.modeBasic')}
              variant="ghost" size="sm"
              accessibilityLabel={t('workshop.modeToggleA11y')}
              onPress={() => { editorUi.basicMode = !editorUi.basicMode; bump(); }}
            />
          </>
        )}
      </View>
      {selMode && sel.size > 0 && (
        <View style={[styles.chipRow, { alignItems: 'center' }]}>
          <Text style={styles.miniLabel}>{t('workshop.selectedCount', { count: sel.size })}</Text>
          <Chip label={t('workshop.bulkCopy')} selected={false} onPress={bulkCopy} />
          {(['COND', 'REPEAT', 'TRY', 'FOR_EACH'] as const).map(kind => (
            <Chip key={kind} label={t(`workshop.${KIND_META[kind].badgeKey}`)} selected={false}
              onPress={() => bulkWrap(kind)} />
          ))}
          <Chip label={t('workshop.bulkDelete')} selected={false} onPress={bulkDelete} />
        </View>
      )}
      {pickerFor === -1 && (
        <View style={styles.picker}>
          <NtInput label={t('workshop.pickerSearchLabel')} value={pickerQuery}
            onChangeText={setPickerQuery} placeholder={t('workshop.pickerSearchPlaceholder')} />
          <Text style={styles.miniLabel}>{t('workshop.templatesTitle')}</Text>
          {EFFECT_TEMPLATES.map(tpl => (
            <Pressable key={tpl.id} style={styles.pickerRow}
              onPress={() => { onChange([...nodes, ...tpl.build()]); setPickerFor(null); }}
              accessibilityRole="button" accessibilityLabel={t(`workshop.${tpl.labelKey}`)}>
              <Text style={styles.pickerName}>📦 {t(`workshop.${tpl.labelKey}`)}</Text>
            </Pressable>
          ))}
          {fragments.length > 0 && (
            <View>
              <Text style={styles.miniLabel}>{t('workshop.fragmentsTitle', { count: fragments.length })}</Text>
              {fragments.map(frag => (
                <View key={frag.id} style={[styles.pickerRow, { flexDirection: 'row', alignItems: 'center' }]}>
                  <Pressable style={{ flex: 1 }} accessibilityRole="button"
                    accessibilityLabel={t('workshop.insertFragmentA11y', { name: frag.name })}
                    onPress={() => {
                      onChange([...nodes, ...(frag.nodes as EffectNode[]).map(cloneSubtree)]);
                      setPickerFor(null);
                    }}>
                    <Text style={styles.pickerName}>▤ {frag.name}</Text>
                  </Pressable>
                  <Pressable onPress={() => removeFragment(frag.id)} accessibilityRole="button"
                    accessibilityLabel={t('workshop.deleteFragmentA11y')} style={styles.ctrl}>
                    <Text style={styles.ctrlTxt}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <Text style={styles.miniLabel}>{t('workshop.controlNodes')}</Text>
          {(['COND', 'REPEAT', 'CHOOSE', 'FOR_EACH', 'TRY', 'LISTEN', 'ON_DEFEAT', 'ON_HORDE', 'ON_ENEMY_DEF', 'PERSISTENT', 'DRAW_CHECK'] as NodeKind[])
            .filter(kd => !editorUi.basicMode || kd !== 'LISTEN').map(kd => (
            <Pressable key={kd} style={styles.pickerRow} onPress={() => addNode(kd)}
              accessibilityRole="button" accessibilityLabel={t('workshop.addNodeA11y', { label: t(`workshop.${KIND_META[kd].labelKey}`) })}>
              <Text style={styles.pickerName}>{t(`workshop.${KIND_META[kd].labelKey}`)}</Text>
            </Pressable>
          ))}
          <Text style={styles.miniLabel}>{t('workshop.actionsTitle', { count: filteredActions.length })}</Text>
          {filteredActions.map(d => {
            const meta = EFFECT_REGISTRY.find(m => m.type === d.type);
            return (
              <Pressable key={d.type} style={styles.pickerRow} onPress={() => addNode('ACTION', d.type)}
                accessibilityRole="button" accessibilityLabel={t('workshop.addNodeA11y', { label: t(`workshop.${d.labelKey}`) })}>
                <Text style={styles.pickerName}>{t(`workshop.${d.labelKey}`)}</Text>
                <Text style={styles.pickerDesc}>{meta?.description ?? ''}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ============================================================================
// Componente principal
// ============================================================================

