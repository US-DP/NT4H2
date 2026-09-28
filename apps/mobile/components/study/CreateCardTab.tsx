/**
 * CreateCardTab — editor de contenido estructurado del Taller.
 *
 * Cada carta es un pequeño programa declarativo: lista ordenada y anidable
 * de nodos de efecto (accion / condicion / repeticion / eleccion /
 * disparadores ON_*), construida solo con tipos registrados del motor.
 * Nunca se edita codigo libre ni cartas oficiales (duplicar como copia).
 *
 * Seguridad: validateCardEffects (limites anti-recursion) +
 * validateEffectSources (tipo permitido) + CardDefinitionSchema (Zod)
 * + presupuesto de resolucion del motor (MAX_RESOLUTION_OPS).
 */

import { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NtInput } from '../ui/NtInput';
import { NtButton } from '../ui/NtButton';
import { HoldConfirmButton } from '../ui/HoldConfirmButton';
import { NtBadge } from '../ui/NtBadge';
import { toast } from '../../lib/toast';
import { useCustomContent } from '../../lib/customContent';
import { importImageAsset } from '../../lib/assetImport';
import { validateEffectSources, loadCatalog, mergeCustomCards } from '@nt4h/catalog';
import {
  validateCardEffects, CardDefinitionSchema,
  type CardDefinition, type CardType, type HeroClass,
} from '@nt4h/schema';
import { colors, fontSize } from '../../lib/theme';
import { describeEffect } from '../../lib/effectDescriptions';
import {
  CARD_TYPES, CLASSES, CLASS_NAME_KEYS, CAPABILITIES, CAP_NAME_KEYS, DESTINATIONS,
  EMPTY_DRAFT, num, migrateDraft, patchNode, findNode, diffDrafts,
  type CardDraft, type EffectNode,
} from './cardWorkshop/model';
import { compileTree, buildEffects } from './cardWorkshop/compiler';
import { decompileCard } from './cardWorkshop/decompile';
import {
  balanceWarnings, semanticDiagnostics, complexityOf, quickFixFor,
} from './cardWorkshop/validation';
import { textNumbers, effectNumbers } from './cardWorkshop/text';
import { EffectList, Chip, SCENARIO_HANDLERS } from './cardWorkshop/EffectTree';
import { FxPreview } from './cardWorkshop/FxPreview';
import { SimPanel } from './cardWorkshop/SimPanel';
import { styles } from './cardWorkshop/editorStyles';
import {
  collapsedNodes, diagErrorKeys, diagWarnKeys, editorUi, useDebouncedValue,
} from './cardWorkshop/editorState';

// Re-exports (compatibilidad con tests y consumidores existentes)
export { ACTION_DEFS } from './cardWorkshop/registry';
export { SCENARIO_HANDLERS } from './cardWorkshop/EffectTree';
export { buildNode, buildEffects } from './cardWorkshop/compiler';
export { balanceWarnings } from './cardWorkshop/validation';
export type { EffectNode, NodeKind } from './cardWorkshop/model';

// ============================================================================
// Editor recursivo de lista de efectos
// (modelo/registry/compilador/validación → ./cardWorkshop/*)
// ============================================================================


export function CreateCardTab() {
  const { t } = useTranslation();
  const sets = useCustomContent(s => s.sets);
  const upsertCard = useCustomContent(s => s.upsertCard);
  const removeCard = useCustomContent(s => s.removeCard);
  const saveDraft = useCustomContent(s => s.saveDraft);
  const saveCardDraft = useCustomContent(s => s.saveCardDraft);
  const clearDraft = useCustomContent(s => s.clearDraft);
  const storedDraft = useCustomContent(s => s.draft) as CardDraft | null;
  const cardDrafts = useCustomContent(s => s.cardDrafts);
  const importSet = useCustomContent(s => s.importSet);
  const trash = useCustomContent(s => s.trash);
  const restoreCard = useCustomContent(s => s.restoreCard);
  const purgeTrash = useCustomContent(s => s.purgeTrash);
  const exportSet = useCustomContent(s => s.exportSet);

  const [draft, setDraft] = useState<CardDraft>(() => migrateDraft(storedDraft) ?? { ...EMPTY_DRAFT });
  /** El borrador persistido no se pudo migrar (versión futura/corrupto):
   *  NO autoguardar sobre él hasta que el usuario edite algo — evita
   *  sobrescribir datos que otra versión del editor sí entiende. */
  const draftLocked = useRef(storedDraft != null && migrateDraft(storedDraft) === null);
  const touched = useRef(false);

  // init() del store es async: si el tab se monta antes de que resuelva,
  // storedDraft llega tarde. Restaurarlo entonces — salvo que el usuario
  // ya haya empezado a editar (no pisar trabajo).
  const hydratedDraft = useRef(storedDraft != null);
  useEffect(() => {
    if (hydratedDraft.current || storedDraft == null) return;
    hydratedDraft.current = true;
    const migrated = migrateDraft(storedDraft);
    if (migrated && !touched.current) setDraft(migrated);
    else if (!migrated) draftLocked.current = true;
  }, [storedDraft]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dupQuery, setDupQuery] = useState('');
  const [importJson, setImportJson] = useState('');
  const [showData, setShowData] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  /** Borrador persistido de la carta en edición (para el comparador). */
  const savedDraftForEdit = useMemo(
    () => (draft.editingId ? migrateDraft(cardDrafts[draft.editingId]) : null),
    [draft.editingId, cardDrafts],
  );
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // --- Historial deshacer/rehacer (P1) ------------------------------------
  // Snapshot anterior por "ráfaga" de edición: mismo campo dentro de 1,2 s
  // no crea paso nuevo (no registrar cada pulsación).
  const history = useRef<{ past: CardDraft[]; future: CardDraft[] }>({ past: [], future: [] });
  const lastEditRef = useRef<{ field: string; at: number }>({ field: '', at: 0 });
  const [, setHistTick] = useState(0);
  const pushHistory = (prev: CardDraft) => {
    touched.current = true; // cargar/duplicar también cuenta como edición
    const h = history.current;
    h.past.push(prev);
    if (h.past.length > 60) h.past.shift();
    h.future = [];
    setHistTick(x => x + 1);
  };
  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    // Reiniciar la ráfaga: la primera edición tras undo debe crear paso
    // (si no, el estado post-undo se pierde del historial).
    lastEditRef.current = { field: '', at: 0 };
    h.future.push(draft);
    setDraft(prev);
    setHistTick(x => x + 1);
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    lastEditRef.current = { field: '', at: 0 };
    h.past.push(draft);
    setDraft(next);
    setHistTick(x => x + 1);
  };

  // Autoguardado del borrador (debounce ligero via effect) + sello visible
  useEffect(() => {
    if (draftLocked.current && !touched.current) return; // versión futura: no pisar
    const timer = setTimeout(() => { saveDraft(draft); setLastSavedAt(Date.now()); }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const set = (patch: Partial<CardDraft>) => {
    touched.current = true;
    // Tocar una zona de efectos descarta su respaldo "preserved" (efectos
    // originales de una carta editada sin borrador): el usuario está
    // reconstruyendo esa zona a propósito.
    let next = patch;
    if (draft.preserved && ('nodes' in patch || 'abilityNodes' in patch || 'peritiaNodes' in patch)) {
      const p = { ...draft.preserved };
      if ('nodes' in patch) delete p.effects;
      if ('abilityNodes' in patch) delete p.heroAbility;
      if ('peritiaNodes' in patch) delete p.peritia;
      next = { ...patch, preserved: p };
    }
    const field = Object.keys(patch).join(',');
    const now = Date.now();
    const le = lastEditRef.current;
    if (field !== le.field || now - le.at > 1200) pushHistory(draft);
    lastEditRef.current = { field, at: now };
    setDraft(d => ({ ...d, ...next }));
  };
  const customCards = sets.flatMap(s => s.cards);
  const officialCatalog = useMemo(() => loadCatalog(), []);
  /** Catálogo oficial + sets del usuario: referencias del simulador. */
  const mergedCatalog = useMemo(
    () => mergeCustomCards(officialCatalog, sets),
    [officialCatalog, sets],
  );
  /** CartDefinition de solo-lectura para el simulador (efectos del borrador). */
  const simCardDef = useMemo<CardDefinition>(() => ({
    id: 'sim.draft',
    name: draft.name.trim() || t('workshop.simCardName'),
    type: draft.cardType,
    copies: 1,
    effects: buildEffects(draft.nodes),
    destinationAfterUse: draft.destination as CardDefinition['destinationAfterUse'],
    officialStatus: 'CUSTOM',
    setId: 'set.taller-local',
    author: 'local',
    version: '1.0.0',
    verificationStatus: 'INFERRED',
  }), [draft.name, draft.cardType, draft.destination, draft.nodes, t]);

  // Referencias conocidas para sugerencias + validación de nombres de carta.
  const cardNames = useMemo(() => {
    const names = new Set<string>();
    for (const list of officialCatalog.byType.values()) for (const c of list) names.add(c.name);
    for (const c of customCards) names.add(c.name);
    return names;
  }, [officialCatalog, customCards]);
  // editorUi es estado global compartido: asignarlo en render es un
  // side-effect que StrictMode ejecuta 2× — moverlo a efecto.
  useEffect(() => {
    editorUi.knownCardNames = [...cardNames];
  }, [cardNames]);
  const knownHandlers = useMemo(() => new Set<string>(SCENARIO_HANDLERS), []);

  const liveErrors = useMemo(() => {
    const effects = buildEffects(draft.nodes);
    return [
      ...validateCardEffects(effects),
      ...validateEffectSources(draft.cardType, effects),
      ...(draft.cardType === 'HERO' ? validateCardEffects(buildEffects(draft.abilityNodes)) : []),
    ];
  }, [draft.nodes, draft.abilityNodes, draft.cardType]);

  const liveWarnings = useMemo(() => balanceWarnings(
    buildEffects(draft.nodes)
      .concat(buildEffects(draft.abilityNodes), buildEffects(draft.peritiaNodes)),
    t,
  ), [draft.nodes, draft.abilityNodes, draft.peritiaNodes, t]);

  // Diagnósticos: compilación (nodos descartados = error, no se guarda) +
  // análisis semántico de las 3 zonas de efectos. Todo en vivo.
  const debouncedZones = useDebouncedValue(
    [draft.nodes, draft.abilityNodes, draft.peritiaNodes] as const, 350);
  const liveDiagnostics = useMemo(() => {
    const opts = { knownCardNames: cardNames, knownHandlers };
    return debouncedZones.flatMap(zone => [
      ...compileTree(zone, t).diagnostics,
      ...semanticDiagnostics(zone, t, opts),
    ]);
  }, [debouncedZones, cardNames, knownHandlers, t]);
  const diagCounts = useMemo(() => ({
    errors: liveDiagnostics.filter(d => d.severity === 'error').length,
    warnings: liveDiagnostics.filter(d => d.severity === 'warning').length,
    infos: liveDiagnostics.filter(d => d.severity === 'info').length,
  }), [liveDiagnostics]);
  const treeComplexity = useMemo(() => complexityOf(draft.nodes), [draft.nodes]);

  // Reflejar diagnósticos en el árbol (borde rojo = error, ámbar = aviso).
  // Se hace en render a propósito: los Sets son estado global compartido y
  // EffectList los lee en SU render — un useEffect llegaría un frame tarde
  // y nadie re-renderizaría el árbol. La mutación es idempotente (clear +
  // add sobre el mismo input), así que StrictMode es inocuo.
  diagErrorKeys.clear(); diagWarnKeys.clear();
  for (const d of liveDiagnostics) {
    if (d.nodeKey == null) continue;
    if (d.severity === 'error') diagErrorKeys.add(d.nodeKey);
    else if (d.severity === 'warning') diagWarnKeys.add(d.nodeKey);
  }

  /** Cadena de claves ancestro→nodo (para expandir al saltar a un nodo). */
  const parentChains = useMemo(() => {
    const m = new Map<number, number[]>();
    const walk = (list: EffectNode[], chain: number[]) => {
      for (const n of list) {
        m.set(n.key, chain);
        const next = [...chain, n.key];
        walk(n.thenN ?? [], next);
        walk(n.elseN ?? [], next);
        walk(n.children ?? [], next);
        for (const o of n.options ?? []) walk(o.children, next);
      }
    };
    walk(draft.nodes, []); walk(draft.abilityNodes, []); walk(draft.peritiaNodes, []);
    return m;
  }, [draft.nodes, draft.abilityNodes, draft.peritiaNodes]);

  /** Clic en un problema: expande los ancestros y enfoca el nodo afectado.
   *  El resaltado es transitorio (se limpia solo): si no, el borde de foco
   *  quedaba fijo sobre nodos cuyo problema ya se resolvió. */
  const jumpToNode = (key?: number) => {
    if (key == null) return;
    editorUi.focusedKey = key;
    for (const p of parentChains.get(key) ?? []) collapsedNodes.delete(p);
    setHistTick(x => x + 1);
    setTimeout(() => {
      if (editorUi.focusedKey === key) {
        editorUi.focusedKey = null;
        setHistTick(x => x + 1);
      }
    }, 2400);
  };

  /** Corrección automática segura: aplica el patch en la zona donde vive
   *  el nodo (puede estar en cualquiera de las 3 listas). Vía `set` para
   *  que quede en el historial deshacer. */
  const applyFix = (key: number, patch: Partial<EffectNode>) => {
    set({
      nodes: patchNode(draft.nodes, key, patch),
      abilityNodes: patchNode(draft.abilityNodes, key, patch),
      peritiaNodes: patchNode(draft.peritiaNodes, key, patch),
    });
    toast.show(t('workshop.fixApplied'));
  };

  // Texto impreso generado por los efectos (estilo PSCT): sirve para poblar
  // textOverride de una vez y para que "guardar" no pierda la descripción.
  const generatedText = useMemo(() => {
    const parts: string[] = [];
    for (const eff of buildEffects(draft.nodes)
      .concat(buildEffects(draft.abilityNodes), buildEffects(draft.peritiaNodes))) {
      try { const d = describeEffect(eff); if (d) parts.push(d); } catch { /* nodo a medias */ }
    }
    return parts.join(' ');
  }, [draft.nodes, draft.abilityNodes, draft.peritiaNodes]);

  /** Texto manual desactualizado respecto al texto generado (§12):
   *  avisa si textOverride ya no coincide con lo que producen los efectos. */
  const staleText = useMemo(() => {
    if (!draft.textOverride.trim() || !generatedText.trim()) return false;
    return draft.textOverride.trim() !== generatedText.trim();
  }, [draft.textOverride, generatedText]);

  /** Estado visual compartido ligado al borrador: al cambiar de carta no
   *  deben sobrevivir colapsos ni el foco de diagnóstico de otra carta. */
  const resetEditorView = () => {
    collapsedNodes.clear();
    diagErrorKeys.clear(); diagWarnKeys.clear();
    editorUi.focusedKey = null;
    editorUi.dnd = null; editorUi.dndPendingRemoval = null;
    history.current = { past: [], future: [] };
    lastEditRef.current = { field: '', at: 0 };
  };

  const startEdit = (card: CardDefinition) => {
    // migrateDraft sanea el árbol (whitelist + claves únicas) y detecta
    // versiones futuras → null = borrador no recuperable, modo campos base.
    const saved = migrateDraft(cardDrafts[card.id]);
    resetEditorView();
    if (saved) {
      setDraft(saved);
    } else {
      // Decompilador CardEffect→EffectNode: la carta llega con su árbol
      // real (oficial o importada), no con las zonas vacías.
      const dec = decompileCard(card, t);
      setDraft({
        ...EMPTY_DRAFT,
        cardType: card.type, editingId: card.id, name: card.name,
        heroClass: card.heroClass ?? 'EXPLORER',
        copies: String(card.copies), printedAttack: String(card.printedAttack ?? 0),
        printedCost: String(card.printedCost ?? 0), printedFortitude: String(card.printedFortitude ?? 2),
        rewardCoins: String(card.reward?.coins ?? 0), rewardGlory: String(card.reward?.glory ?? 0),
        maxWounds: String(card.maxWounds ?? 10),
        capabilities: (card.capabilities ?? []) as string[],
        requiredCapabilities: (card.requiredCapabilities ?? []) as string[],
        destination: card.destinationAfterUse,
        abilityUses: dec.abilityUses,
        textOverride: card.textOverride ?? '', altText: card.altText ?? '',
        peritiaTrigger: dec.peritiaTrigger,
        peritiaCondition: dec.peritiaCondition,
        nodes: dec.nodes, abilityNodes: dec.abilityNodes, peritiaNodes: dec.peritiaNodes,
        // Red de seguridad: si una zona decompila a vacío pese a tener
        // efectos (tipos futuros que el decompilador no conoce), save()
        // conserva los originales en vez de publicar la zona vacía.
        preserved: {
          ...(dec.nodes.length === 0 && card.effects.length ? { effects: card.effects } : {}),
          ...(dec.abilityNodes.length === 0 && card.heroAbility ? { heroAbility: card.heroAbility } : {}),
          ...(dec.peritiaNodes.length === 0 && card.peritia ? { peritia: card.peritia } : {}),
        },
      });
      const nonInfo = dec.diagnostics.filter(d => d.severity !== 'info');
      if (nonInfo.length > 0) {
        toast.show(t('workshop.decompiledWithWarnings', { count: nonInfo.length }), { durationMs: 5000 });
      }
    }
  };

  const duplicateOfficial = (card: CardDefinition) => {
    resetEditorView();
    // Duplicar conserva el árbol de efectos completo (decompile), no solo
    // los metadatos — la copia editable parte del comportamiento real.
    const dec = decompileCard(card, t);
    setDraft({
      ...EMPTY_DRAFT,
      cardType: card.type, name: t('workshop.copyNameSuffix', { name: card.name }),
      heroClass: card.heroClass ?? 'EXPLORER',
      copies: String(card.copies), printedAttack: String(card.printedAttack ?? 0),
      printedCost: String(card.printedCost ?? 0), printedFortitude: String(card.printedFortitude ?? 2),
      rewardCoins: String(card.reward?.coins ?? 0), rewardGlory: String(card.reward?.glory ?? 0),
      maxWounds: String(card.maxWounds ?? 10),
      capabilities: (card.capabilities ?? []) as string[],
      requiredCapabilities: (card.requiredCapabilities ?? []) as string[],
      destination: card.destinationAfterUse,
      basedOn: card.id,
      abilityUses: dec.abilityUses,
      nodes: dec.nodes, abilityNodes: dec.abilityNodes, peritiaNodes: dec.peritiaNodes,
      peritiaTrigger: dec.peritiaTrigger, peritiaCondition: dec.peritiaCondition,
      preserved: {
        ...(dec.nodes.length === 0 && card.effects.length ? { effects: card.effects } : {}),
        ...(dec.abilityNodes.length === 0 && card.heroAbility ? { heroAbility: card.heroAbility } : {}),
        ...(dec.peritiaNodes.length === 0 && card.peritia ? { peritia: card.peritia } : {}),
      },
    });
    const nonInfo = dec.diagnostics.filter(d => d.severity !== 'info');
    if (nonInfo.length > 0) {
      toast.show(t('workshop.decompiledWithWarnings', { count: nonInfo.length }), { durationMs: 5000 });
    } else {
      toast.show(t('workshop.copyToast', { name: card.name }));
    }
  };

  /** Importa una imagen para la carta: magic bytes, sin SVG, EXIF limpiado. */
  const attachImage = async () => {
    try {
      const DocPicker = await import('expo-document-picker');
      const res = await DocPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      let bytes: Uint8Array;
      if (asset.file) {
        // Web: File directo
        bytes = new Uint8Array(await asset.file.arrayBuffer());
      } else {
        const resp = await fetch(asset.uri);
        bytes = new Uint8Array(await resp.arrayBuffer());
      }
      const result = await importImageAsset(bytes);
      if ('error' in result) {
        const msgs: Record<string, string> = {
          'too-large': t('workshop.imageTooLarge'),
          'unsupported-format': t('workshop.imageUnsupported'),
          'svg-rejected': t('workshop.imageSvgRejected'),
          'empty': t('workshop.imageEmpty'),
        };
        toast.show(msgs[result.error] ?? t('workshop.imageInvalid'), { durationMs: 5000 });
        return;
      }
      set({ imageRef: result.ref });
      toast.show(result.exifStripped ? t('workshop.imageAttachedExif') : t('workshop.imageAttached'));
    } catch {
      toast.show(t('workshop.imageReadError'), { durationMs: 5000 });
    }
  };

  const changeType = (next: CardType) => {
    // Resumen de incompatibilidades antes de cambiar (espec. §3)
    const effects = buildEffects(draft.nodes);
    const incompat = validateEffectSources(next, effects);
    const dropped: string[] = [];
    if (draft.cardType === 'ABILITY' || draft.cardType === 'HERO') {
      if (next !== 'ABILITY' && next !== 'HERO') {
        dropped.push(t('workshop.dropClass', { name: t(`workshop.${CLASS_NAME_KEYS[draft.heroClass]}`) }));
      }
    }
    if (num(draft.printedCost) > 0 && next !== 'MARKET') dropped.push(t('workshop.dropMarketCost'));
    if (num(draft.printedFortitude) > 0 && next !== 'HORDE' && next !== 'WARLORD') dropped.push(t('workshop.dropFortitude'));
    if (incompat.length > 0) dropped.push(...incompat.map(e => t('workshop.dropIncompatible', { effect: e })));
    if (dropped.length > 0) {
      setWarnings([t('workshop.changeTypeWarning', { type: next }), ...dropped]);
    }
    set({ cardType: next });
  };

  const save = (asCopy = false) => {
    const errs: string[] = [];
    if (!draft.name.trim()) errs.push(t('workshop.errNeedName'));
    errs.push(...liveErrors);
    // P0: compilar AHORA, síncrono — los diagnósticos del panel llegan con
    // debounce (350 ms) y un guardado rápido podría colar nodos que el
    // compilador descartaría. Nunca publicar una carta que pierde efectos
    // en silencio ni contiene ramas que el motor ignora.
    const diagOpts = { knownCardNames: cardNames, knownHandlers };
    const saveDiags = [draft.nodes, draft.abilityNodes, draft.peritiaNodes].flatMap(zone => [
      ...compileTree(zone, t).diagnostics,
      ...semanticDiagnostics(zone, t, diagOpts),
    ]);
    if (saveDiags.some(d => d.severity === 'error')) errs.push(t('workshop.publishBlocked'));

    // Zonas intactas de una carta sin borrador conservan sus efectos
    // originales (respaldo 'preserved'), en vez de publicar vacías.
    const effects = draft.nodes.length === 0 && draft.preserved?.effects
      ? draft.preserved.effects
      : buildEffects(draft.nodes);
    const abilityEffects = draft.abilityNodes.length === 0 && draft.preserved?.heroAbility
      ? draft.preserved.heroAbility.effects
      : buildEffects(draft.abilityNodes);
    const peritiaEffects = draft.peritiaNodes.length === 0 && draft.preserved?.peritia
      ? draft.preserved.peritia.effects
      : buildEffects(draft.peritiaNodes);
    if (draft.cardType === 'WARLORD' && draft.peritiaTrigger !== '' && peritiaEffects.length === 0) {
      errs.push(t('workshop.errPeritiaNeedsEffect'));
    }
    const card: CardDefinition = {
      id: !asCopy && draft.editingId
        ? draft.editingId
        : `custom.${slugify(draft.name)}-${Date.now().toString(36)}`,
      name: draft.name.trim() || 'Sin nombre',
      type: draft.cardType,
      ...(draft.cardType === 'ABILITY' || draft.cardType === 'HERO' ? { heroClass: draft.heroClass } : {}),
      copies: Math.max(1, num(draft.copies, 1)),
      ...(num(draft.printedAttack) > 0 || draft.cardType === 'ABILITY' || draft.cardType === 'MARKET'
        ? { printedAttack: num(draft.printedAttack) } : {}),
      ...(num(draft.printedCost) > 0 ? { printedCost: num(draft.printedCost) } : {}),
      ...(draft.cardType === 'HORDE' || draft.cardType === 'WARLORD'
        ? { printedFortitude: num(draft.printedFortitude, 2), reward: { coins: num(draft.rewardCoins), glory: num(draft.rewardGlory) } } : {}),
      ...(draft.cardType === 'HERO'
        ? { maxWounds: Math.max(1, num(draft.maxWounds, 10)), capabilities: draft.capabilities as CardDefinition['capabilities'] } : {}),
      ...(draft.cardType === 'MARKET' && draft.requiredCapabilities.length > 0
        ? { requiredCapabilities: draft.requiredCapabilities as CardDefinition['requiredCapabilities'] } : {}),
      effects,
      ...(draft.cardType === 'HERO' && abilityEffects.length > 0
        ? { heroAbility: { uses: Math.max(1, num(draft.abilityUses, 1)), effects: abilityEffects } } : {}),
      ...(draft.cardType === 'WARLORD' && draft.peritiaTrigger !== '' && peritiaEffects.length > 0
        ? {
            peritia: {
              trigger: draft.peritiaTrigger,
              effects: peritiaEffects,
              ...(draft.peritiaCondition.trim()
                ? { condition: draft.peritiaCondition.trim() } : {}),
            },
          }
        : {}),
      destinationAfterUse: draft.destination as CardDefinition['destinationAfterUse'],
      ...(draft.textOverride.trim() ? { textOverride: draft.textOverride.trim() } : {}),
      ...(draft.altText.trim() ? { altText: draft.altText.trim() } : {}),
      ...(draft.imageRef ? { sourceImage: draft.imageRef } : {}),
      officialStatus: 'CUSTOM',
      setId: 'set.taller-local',
      author: 'local',
      version: '1.0.0',
      verificationStatus: 'INFERRED',
    };

    // Validacion estructural final con Zod (la red completa)
    const parsed = CardDefinitionSchema.safeParse(card);
    if (!parsed.success) {
      errs.push(...parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`));
    }

    // §21: texto manual vs efectos (advertencia, no bloqueo)
    const warns: string[] = [];
    if (draft.textOverride.trim()) {
      const fxNums = effectNumbers(
        [...draft.nodes, ...draft.abilityNodes, ...draft.peritiaNodes]);
      const missing = textNumbers(draft.textOverride).filter(n => !fxNums.includes(n));
      if (missing.length > 0) {
        warns.push(t('workshop.warnTextNumbers', { values: missing.join(', ') }));
      }
    }
    if (!draft.altText.trim()) warns.push(t('workshop.warnMissingAltText'));
    setWarnings(warns);
    setErrors(errs);
    if (errs.length > 0) return;

    const saveErrors = upsertCard(card);
    if (saveErrors.length > 0) { setErrors(saveErrors); return; }
    // Guardar el borrador con el editingId REAL de la carta publicada:
    // en "guardar como copia" el borrador conservaba el id original y
    // la próxima edición de la copia sobrescribía la carta original.
    saveCardDraft(card.id, { ...draft, editingId: card.id });
    toast.show(t('workshop.savedToast', { name: card.name }));
    // Historial ligado al borrador: tras guardar, undo no debe resucitar
    // la carta recién publicada ni reescribirla por autoguardado.
    history.current = { past: [], future: [] };
    lastEditRef.current = { field: '', at: 0 };
    touched.current = false;
    setDraft({ ...EMPTY_DRAFT });
    clearDraft();
    setErrors([]); setWarnings([]);
  };

  const dupResults = dupQuery.trim().length > 1
    ? [...officialCatalog.byId.values()].filter(c =>
        c.name.toLowerCase().includes(dupQuery.toLowerCase())).slice(0, 8)
    : [];

  return (
    <ScrollView style={styles.scroll}>
      {/* 1. Tipo de carta */}
      <Text style={styles.sectionTitle}>{t('workshop.sectionCardType')}</Text>
      <View style={styles.chipRow}>
        {CARD_TYPES.map(ct => (
          <Chip key={ct.id} label={t(`workshop.${ct.labelKey}`)} selected={draft.cardType === ct.id}
            onPress={() => changeType(ct.id)} a11y={t('workshop.cardTypeA11y', { type: t(`workshop.${ct.labelKey}`) })} />
        ))}
      </View>
      <Text style={styles.hint}>{(() => { const d = CARD_TYPES.find(x => x.id === draft.cardType)?.descKey; return d ? t(`workshop.${d}`) : ''; })()}</Text>
      {draft.editingId && (
        <NtBadge label={t('workshop.editingBadge', { id: draft.editingId })} tone="info" />
      )}
      {draft.basedOn && (
        <NtBadge label={t('workshop.basedOnBadge', { id: draft.basedOn })} tone="neutral" />
      )}
      {draft.preserved && draft.nodes.length === 0
        && draft.abilityNodes.length === 0 && draft.peritiaNodes.length === 0 && (
        <NtBadge label={t('workshop.preservedNotice')} tone="neutral" />
      )}

      {/* 2. Información general */}
      <Text style={styles.sectionTitle}>{t('workshop.sectionGeneral')}</Text>
      <NtInput label={t('workshop.nameLabel')} value={draft.name} onChangeText={v => set({ name: v })} placeholder={t('workshop.namePlaceholder')} />

      {(draft.cardType === 'ABILITY' || draft.cardType === 'HERO') && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.classLabel')}</Text>
          <View style={styles.chipRow}>
            {CLASSES.map(c => (
              <Chip key={c} label={t(`workshop.${CLASS_NAME_KEYS[c]}`)} selected={draft.heroClass === c}
                onPress={() => set({ heroClass: c })} />
            ))}
          </View>
        </View>
      )}

      {/* 3. Propiedades por tipo */}
      <Text style={styles.sectionTitle}>{t('workshop.sectionProperties')}</Text>
      <View style={styles.twoCol}>
        {(draft.cardType === 'ABILITY' || draft.cardType === 'MARKET') && (
          <NtInput label={t('workshop.printedAttackLabel')} value={draft.printedAttack}
            onChangeText={v => set({ printedAttack: v })} keyboardType="number-pad" />
        )}
        {draft.cardType === 'MARKET' && (
          <NtInput label={t('workshop.printedCostLabel')} value={draft.printedCost}
            onChangeText={v => set({ printedCost: v })} keyboardType="number-pad" />
        )}
        {(draft.cardType === 'HORDE' || draft.cardType === 'WARLORD') && (
          <NtInput label={t('workshop.fortitudeLabel')} value={draft.printedFortitude}
            onChangeText={v => set({ printedFortitude: v })} keyboardType="number-pad" />
        )}
        {draft.cardType === 'HERO' && (
          <NtInput label={t('workshop.maxWoundsLabel')} value={draft.maxWounds}
            onChangeText={v => set({ maxWounds: v })} keyboardType="number-pad" />
        )}
        {(draft.cardType === 'ABILITY' || draft.cardType === 'MARKET') && (
          <NtInput label={t('workshop.copiesLabel')} value={draft.copies}
            onChangeText={v => set({ copies: v })} keyboardType="number-pad" />
        )}
        {(draft.cardType === 'HORDE' || draft.cardType === 'WARLORD') && (
          <>
            <NtInput label={t('workshop.rewardCoinsLabel')} value={draft.rewardCoins}
              onChangeText={v => set({ rewardCoins: v })} keyboardType="number-pad" />
            <NtInput label={t('workshop.rewardGloryLabel')} value={draft.rewardGlory}
              onChangeText={v => set({ rewardGlory: v })} keyboardType="number-pad" />
          </>
        )}
      </View>

      {draft.cardType === 'HERO' && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.heroCapabilitiesLabel')}</Text>
          <View style={styles.chipRow}>
            {CAPABILITIES.map(cap => (
              <Chip key={cap} label={t(`workshop.${CAP_NAME_KEYS.get(cap)}`)} selected={draft.capabilities.includes(cap)}
                onPress={() => set({
                  capabilities: draft.capabilities.includes(cap)
                    ? draft.capabilities.filter(x => x !== cap)
                    : [...draft.capabilities, cap],
                })} />
            ))}
          </View>
          <NtInput label={t('workshop.abilityUsesLabel')} value={draft.abilityUses}
            onChangeText={v => set({ abilityUses: v })} keyboardType="number-pad" />
          <Text style={styles.miniLabel}>{t('workshop.abilityEffectsLabel')}</Text>
          <EffectList nodes={draft.abilityNodes} onChange={l => set({ abilityNodes: l })} depth={0} cardType={draft.cardType} />
          <FxPreview nodes={draft.abilityNodes} label={t('workshop.previewAbility')} />
        </View>
      )}

      {draft.cardType === 'WARLORD' && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.peritiaTriggerLabel')}</Text>
          <View style={styles.chipRow}>
            {([
              ['', 'workshop.peritiaNone'],
              ['DAMAGE_DEALT', 'workshop.peritiaOnDamage'],
              ['CARD_PLAYED', 'workshop.peritiaOnCardPlayed'],
              ['CONTINUOUS', 'workshop.peritiaContinuous'],
            ] as const).map(([id, label]) => (
              <Chip key={id} label={t(label)} selected={draft.peritiaTrigger === id}
                onPress={() => set({ peritiaTrigger: id })} />
            ))}
          </View>
          {draft.peritiaTrigger === 'CARD_PLAYED' && (
            <NtInput label={t('workshop.peritiaConditionLabel')}
              value={draft.peritiaCondition} onChangeText={v => set({ peritiaCondition: v })} />
          )}
          {draft.peritiaTrigger === 'CONTINUOUS' && (
            <Text style={styles.hint}>{t('workshop.peritiaContinuousHint')}</Text>
          )}
          {draft.peritiaTrigger !== '' && (
            <>
              <Text style={styles.miniLabel}>{t('workshop.abilityEffectsLabel')}</Text>
              <EffectList nodes={draft.peritiaNodes} onChange={l => set({ peritiaNodes: l })} depth={0} cardType={draft.cardType} />
              <FxPreview nodes={draft.peritiaNodes} label={t('workshop.previewPeritia')} />
            </>
          )}
        </View>
      )}

      {draft.cardType === 'MARKET' && (
        <View>
          <Text style={styles.miniLabel}>{t('workshop.requiredCapsLabel')}</Text>
          <View style={styles.chipRow}>
            {CAPABILITIES.map(cap => (
              <Chip key={cap} label={t(`workshop.${CAP_NAME_KEYS.get(cap)}`)} selected={draft.requiredCapabilities.includes(cap)}
                onPress={() => set({
                  requiredCapabilities: draft.requiredCapabilities.includes(cap)
                    ? draft.requiredCapabilities.filter(x => x !== cap)
                    : [...draft.requiredCapabilities, cap],
                })} />
            ))}
          </View>
        </View>
      )}

      <Text style={styles.miniLabel}>{t('workshop.destinationAfterUseLabel')}</Text>
      <View style={styles.chipRow}>
        {DESTINATIONS.map(d => (
          <Chip key={d.id} label={t(`workshop.${d.labelKey}`)} selected={draft.destination === d.id}
            onPress={() => set({ destination: d.id })} />
        ))}
      </View>

      {/* 4. Efectos */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={styles.sectionTitle}>{t('workshop.sectionEffects', { count: draft.nodes.length })}</Text>
        {draft.nodes.length > 0 && (
          <Text style={styles.complexityText}>
            {t('workshop.complexitySummary', {
              nodes: treeComplexity.nodes, depth: treeComplexity.depth, ops: treeComplexity.worstOps,
            })}
          </Text>
        )}
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Pressable onPress={undo} disabled={history.current.past.length === 0}
            accessibilityRole="button" accessibilityLabel={t('workshop.undoA11y')}
            style={[styles.ctrl, history.current.past.length === 0 && styles.ctrlOff]} hitSlop={4}>
            <Text style={styles.ctrlTxt}>↶</Text>
          </Pressable>
          <Pressable onPress={redo} disabled={history.current.future.length === 0}
            accessibilityRole="button" accessibilityLabel={t('workshop.redoA11y')}
            style={[styles.ctrl, history.current.future.length === 0 && styles.ctrlOff]} hitSlop={4}>
            <Text style={styles.ctrlTxt}>↷</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.hint}>{t('workshop.effectsHint')}</Text>
      <EffectList nodes={draft.nodes} onChange={l => set({ nodes: l })} depth={0} cardType={draft.cardType} />
      <FxPreview nodes={draft.nodes} />
      <SimPanel nodes={draft.nodes} cardDef={simCardDef} catalog={mergedCatalog} />
      {!editorUi.basicMode && (
        <>
          <NtButton label={t('workshop.viewJson')} variant="ghost" size="sm"
            onPress={() => setShowJson(v => !v)} />
          {showJson && (
            <Text style={styles.jsonBox} selectable>
              {JSON.stringify(buildEffects(draft.nodes), null, 2)}
            </Text>
          )}
        </>
      )}

      {/* 5. Texto */}
      <Text style={styles.sectionTitle}>{t('workshop.sectionText')}</Text>
      <NtInput label={t('workshop.textOverrideLabel')} value={draft.textOverride}
        onChangeText={v => set({ textOverride: v })} multiline
        placeholder={t('workshop.textOverridePlaceholder')} />
      {generatedText && (
        <NtButton label={t('workshop.useAsText')} variant="secondary" size="sm"
          onPress={() => set({ textOverride: generatedText })} />
      )}
      {staleText && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text style={styles.warnText}>⚠ {t('workshop.warnStaleText')}</Text>
          <NtButton label={t('workshop.refreshText')} variant="ghost" size="sm"
            onPress={() => set({ textOverride: generatedText })} />
        </View>
      )}
      <NtInput label={t('workshop.altTextLabel')} value={draft.altText}
        onChangeText={v => set({ altText: v })}
        placeholder={t('workshop.altTextPlaceholder')} />
      {generatedText.trim() !== '' && !draft.altText.trim() && (
        <NtButton label={t('workshop.useAsAltText')} variant="ghost" size="sm"
          accessibilityLabel={t('workshop.useAsAltTextA11y')}
          onPress={() => set({ altText: generatedText })} />
      )}

      {/* Imagen de la carta: importación segura (magic bytes, sin SVG,
          EXIF limpiado en web). Los assets no se mezclan con los oficiales. */}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <NtButton
          label={draft.imageRef ? t('workshop.changeImage') : t('workshop.attachImage')}
          variant="secondary" size="sm"
          onPress={() => void attachImage()}
        />
        {draft.imageRef ? (
          <>
            <NtBadge label={t('workshop.imageAttachedBadge')} tone="info" />
            <Pressable onPress={() => set({ imageRef: undefined })}
              accessibilityRole="button" accessibilityLabel={t('workshop.removeImageA11y')}>
              <Text style={{ color: colors.danger, fontSize: fontSize.detail }}>{t('workshop.removeImage')}</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {/* 6. Validación */}
      <Text style={styles.sectionTitle}>{t('workshop.sectionValidation')}</Text>
      {liveErrors.length === 0 ? (
        <Text style={styles.okText}>{t('workshop.structureValid')}</Text>
      ) : (
        <View style={styles.errorBox} accessibilityLiveRegion="polite">
          {liveErrors.map((e, i) => <Text key={i} style={styles.errorText}>• {e}</Text>)}
        </View>
      )}
      {/* Panel de problemas: diagnósticos del compilador + semántica.
          Los errores bloquean el guardado; warnings/infos no. */}
      <Text style={styles.miniLabel}>
        {t('workshop.problemsTitle', {
          errors: diagCounts.errors, warnings: diagCounts.warnings, infos: diagCounts.infos,
        })}
      </Text>
      {liveDiagnostics.length === 0 ? (
        <Text style={styles.okText}>{t('workshop.noProblems')}</Text>
      ) : (
        <View style={styles.diagBox} accessibilityLiveRegion="polite">
          {liveDiagnostics.map((d, i) => {
            const node = d.nodeKey != null
              ? findNode([...draft.nodes, ...draft.abilityNodes, ...draft.peritiaNodes], d.nodeKey)
              : null;
            const fix = node ? quickFixFor(d.code, node) : null;
            return (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Pressable onPress={() => jumpToNode(d.nodeKey)}
                  disabled={d.nodeKey == null}
                  style={{ flex: 1 }}
                  accessibilityRole={d.nodeKey != null ? 'button' : 'text'}
                  accessibilityLabel={d.nodeKey != null
                    ? t('workshop.jumpToNodeA11y', { path: d.path }) : undefined}>
                  <Text
                    style={d.severity === 'error' ? styles.errorText
                      : d.severity === 'warning' ? styles.warnText : styles.infoText}
                  >
                    {d.severity === 'error' ? '⛔' : d.severity === 'warning' ? '⚠' : 'ℹ'} {d.nodeKey != null ? '↗ ' : ''}{d.path}: {d.message}
                  </Text>
                </Pressable>
                {fix && d.nodeKey != null && (
                  <NtButton label={t('workshop.fixAction')} variant="ghost" size="sm"
                    onPress={() => applyFix(d.nodeKey!, fix)} />
                )}
              </View>
            );
          })}
        </View>
      )}
      {[...warnings, ...liveWarnings].map((w, i) => <Text key={i} style={styles.warnText}>⚠ {w}</Text>)}
      {errors.map((e, i) => <Text key={i} style={styles.errorText}>• {e}</Text>)}

      {lastSavedAt !== null && (
        <Text style={styles.hint}>
          {t('workshop.lastSavedAt', { time: new Date(lastSavedAt).toLocaleTimeString() })}
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <NtButton label={draft.editingId ? t('workshop.saveChanges') : t('workshop.saveToCreations')} variant="primary" onPress={() => save(false)} />
        {draft.editingId && (
          <NtButton label={t('workshop.saveAsCopy')} variant="secondary" size="sm"
            onPress={() => save(true)} />
        )}
        {draft.editingId && savedDraftForEdit && (
          <NtButton label={t('workshop.compareSaved')} variant="ghost" size="sm"
            onPress={() => setShowDiff(v => !v)} />
        )}
      </View>
      {showDiff && savedDraftForEdit && (
        <View style={styles.diagBox}>
          {(() => {
            const diffs = diffDrafts(savedDraftForEdit, draft);
            return diffs.length === 0
              ? <Text style={styles.okText}>{t('workshop.diffNoChanges')}</Text>
              : diffs.map((d, i) => (
                <Text key={i} style={styles.infoText}>
                  ± {t('workshop.diffLine', { field: d.field, from: d.from, to: d.to })}
                </Text>
              ));
          })()}
        </View>
      )}

      {/* 7. Duplicar oficial */}
      <Text style={styles.sectionTitle}>{t('workshop.sectionDuplicate')}</Text>
      <Text style={styles.hint}>{t('workshop.duplicateHint')}</Text>
      <NtInput label={t('workshop.searchOfficialLabel')} value={dupQuery} onChangeText={setDupQuery} placeholder={t('workshop.searchOfficialPlaceholder')} />
      {dupResults.map(c => (
        <Pressable key={c.id} style={styles.pickerRow} onPress={() => duplicateOfficial(c)}
          accessibilityRole="button" accessibilityLabel={t('workshop.duplicateA11y', { name: c.name })}>
          <Text style={styles.pickerName}>{c.name}</Text>
          <Text style={styles.pickerDesc}>{c.id} · {t(`workshop.${CLASS_NAME_KEYS[(c.heroClass ?? 'EXPLORER') as HeroClass]}`)}</Text>
        </Pressable>
      ))}

      {/* 8. Importar / exportar */}
      <Text style={styles.sectionTitle}>{t('workshop.sectionImportExport')}</Text>
      <NtButton label={showData ? t('workshop.hideSetJson') : t('workshop.exportSetJson')}
        variant="secondary" size="sm"
        onPress={() => setShowData(v => !v)} />
      {showData && (
        <Text style={styles.jsonBox} selectable>{exportSet('set.taller-local') ?? t('workshop.emptyJson')}</Text>
      )}
      <NtInput label={t('workshop.importSetLabel')} value={importJson}
        onChangeText={setImportJson} multiline placeholder='{"id":"set.x","cards":[...]}' />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <NtButton label={t('workshop.exportDraft')} variant="ghost" size="sm"
          onPress={() => setImportJson(JSON.stringify(draft, null, 2))} />
      </View>
      {importJson.trim().length > 0 && (
        <NtButton label={t('workshop.importSetButton')} variant="secondary" size="sm"
          onPress={() => {
            // Entrada no confiable: límite de tamaño antes de parsear
            if (importJson.length > 1_000_000) {
              setErrors([t('workshop.errSetTooLarge')]);
              return;
            }
            try {
              const parsed: unknown = JSON.parse(importJson);
              // ¿Es un borrador (árbol de nodos) en vez de un set?
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                && !('cards' in parsed)
                && ('nodes' in parsed || 'cardType' in parsed)) {
                const d = migrateDraft(parsed);
                if (!d) { setErrors([t('workshop.errInvalidDraft')]); return; }
                pushHistory(draft);
                setDraft(d);
                setImportJson('');
                toast.show(t('workshop.draftImportedToast'));
                return;
              }
              const errs = importSet(parsed);
              if (errs.length > 0) setErrors(errs);
              else { toast.show(t('workshop.setImportedToast')); setImportJson(''); }
            } catch { setErrors([t('workshop.errInvalidJson')]); }
          }} />
      )}

      {/* 9. Biblioteca de custom */}
      {customCards.length > 0 && (
        <View style={styles.customList}>
          <Text style={styles.sectionTitle}>{t('workshop.myCreationsTitle', { count: customCards.length })}</Text>
          {customCards.map(c => (
            <View key={c.id} style={styles.cardRow}>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{c.name}</Text>
                <Text style={styles.cardMeta}>
                  {(() => { const ct = CARD_TYPES.find(x => x.id === c.type); return ct ? t(`workshop.${ct.labelKey}`) : c.type; })()}
                  {c.heroClass ? ` · ${t(`workshop.${CLASS_NAME_KEYS[c.heroClass]}`)}` : ''}
                  {t('workshop.cardEffectsMeta', { count: c.effects.length })}
                </Text>
              </View>
              <NtBadge label={t('workshop.customBadge')} tone="accent" />
              <Pressable onPress={() => startEdit(c)} accessibilityRole="button"
                accessibilityLabel={t('workshop.editCardA11y', { name: c.name })} style={styles.ctrl}>
                <Text style={styles.ctrlTxt}>✎</Text>
              </Pressable>
              <Pressable onPress={() => removeCard(c.id)} accessibilityRole="button"
                accessibilityLabel={t('workshop.deleteCardA11y', { name: c.name })} style={styles.ctrl}>
                <Text style={styles.ctrlTxt}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* 10. Papelera: cartas eliminadas restaurables */}
      {Object.keys(trash).length > 0 && (
        <View style={styles.customList}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.sectionTitle}>{t('workshop.trashTitle', { count: Object.keys(trash).length })}</Text>
            <HoldConfirmButton label={t('workshop.trashEmpty')} variant="ghost" size="sm" onPress={purgeTrash} />
          </View>
          {Object.values(trash).map(entry => (
            <View key={entry.card.id} style={styles.cardRow}>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{entry.card.name}</Text>
                <Text style={styles.cardMeta}>
                  {t('workshop.trashDeletedMeta', { n: entry.card.effects.length })}
                </Text>
              </View>
              <NtButton label={t('workshop.trashRestore')} variant="secondary" size="sm"
                accessibilityLabel={t('workshop.trashRestoreA11y', { name: entry.card.name })}
                onPress={() => restoreCard(entry.card.id)} />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function slugify(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
}

// ============================================================================
// Estilos
// ============================================================================


