/**
 * customContent — conjuntos de contenido personalizado creados en el Taller.
 *
 * Persistidos en `nt4h.customSets` (storage no sensible). Las cartas validadas
 * se fusionan al cat¡logo en `loadCatalogWithCustom`, de modo que el motor las
 * ve como cartas normales (mismos efectos registrados).
 */

import { create } from 'zustand';
import { storageGet, storageSet } from './storage';
import { deleteImageAsset, warmImageAssets } from './assetImport';
import {
  loadCatalog,
  mergeCustomCards,
  validateContentSet,
  type CatalogLoadResult,
} from '@nt4h/catalog';
import type { CardDefinition, ContentSet, DeckDefinition } from '@nt4h/schema';
import { validateDeck } from '@nt4h/schema';

const STORAGE_KEY = 'nt4h.customSets';
const DRAFT_KEY = 'nt4h.cardDraft';
/** Historial de deshacer y versiones publicadas (inmutables) por conjunto. */
const META_KEY = 'nt4h.setMeta';
const DEFAULT_SET_ID = 'set.taller-local';

/** M¡ximo de estados revertibles por conjunto (undo). */
const HISTORY_LIMIT = 30;

/** Versi³n publicada inmutable: una vez creada nunca cambia. */
export interface PublishedVersion {
  version: string;
  publishedAt: number;
  checksum: string;
  snapshot: ContentSet;
}

/** Fragmento reutilizable del Taller: subarbol de nodos nombrado.
 *  `nodes` es el EffectNode[] serializado; el editor lo re-valida al
 *  insertar. */
export interface WorkshopFragment {
  id: string;
  name: string;
  savedAt: number;
  nodes: unknown[];
}

/** Carta eliminada recuperable (papelera): conserva su borrador. */
export interface TrashedCard {
  card: CardDefinition;
  draft: unknown;
  deletedAt: number;
}

/** Hash de integridad determinista (FNV-1a). No es criptogr¡fico: sirve para
 *  detectar corrupci³n/edici³n accidental, no para seguridad. */
function checksumOf(set: ContentSet): string {
  const text = JSON.stringify(set);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function bumpPatch(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return '1.0.0';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

interface CustomContentState {
  loaded: boolean;
  sets: ContentSet[];
  /** Borrador de carta en edici³n (autoguardado, sobrevive al cambio de pesta±a). */
  draft: unknown;
  /** Carga los conjuntos persistidos (llamar una vez al arrancar). */
  init: () => Promise<void>;
  /** Carta nueva/editada dentro del conjunto local. Devuelve errores. */
  upsertCard: (card: CardDefinition) => string[];
  /** Mazo nuevo dentro del conjunto local. Devuelve errores. */
  upsertDeck: (deck: DeckDefinition) => string[];
  removeCard: (cardId: string) => void;
  removeDeck: (deckId: string) => void;
  /** Autoguardado del borrador del editor (JSON libre). */
  saveDraft: (draft: unknown) => void;
  clearDraft: () => void;
  /** Borradores de cartas ya guardadas (para reeditar sin perder estructura). */
  cardDrafts: Record<string, unknown>;
  saveCardDraft: (cardId: string, draft: unknown) => void;
  /** Importa un conjunto .nt4hpack/JSON como conjunto nuevo (validado). Devuelve errores. */
  importSet: (json: unknown) => string[];
  /** Serializa un conjunto para exportar. */
  exportSet: (setId: string) => string | null;
  /** Elimina un conjunto instalado (no el juego base). Devuelve false si no existe. */
  removeSet: (setId: string) => boolean;
  /** Pila de deshacer por conjunto (estados anteriores a cada mutaci³n). */
  history: Record<string, ContentSet[]>;
  /** Versiones publicadas inmutables por conjunto. */
  published: Record<string, PublishedVersion[]>;
  /** Revierte la ºltima mutaci³n del conjunto. Devuelve false si no hay historial. */
  undo: (setId: string) => boolean;
  /** Publica una versi³n inmutable del estado actual del conjunto. Devuelve errores de validaci³n. */
  publish: (setId: string) => string[];
  /** Restaura una versi³n publicada como copia de trabajo (revertible con undo). */
  restoreVersion: (setId: string, version: string) => boolean;
  /** Biblioteca de fragmentos reutilizables del Taller (P2). */
  fragments: WorkshopFragment[];
  saveFragment: (name: string, nodes: unknown[]) => void;
  removeFragment: (id: string) => void;
  /** Papelera: cartas eliminadas restaurables (conserva su borrador). */
  trash: Record<string, TrashedCard>;
  restoreCard: (cardId: string) => boolean;
  purgeTrash: () => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist(sets: ContentSet[]): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void storageSet(STORAGE_KEY, JSON.stringify(sets));
  }, 300);
}

function persistMeta(
  history: Record<string, ContentSet[]>,
  published: Record<string, PublishedVersion[]>,
  fragments: WorkshopFragment[] = [],
  trash: Record<string, TrashedCard> = {},
): void {
  void storageSet(META_KEY, JSON.stringify({ history, published, fragments, trash }));
}

/** Sella todo el contenido de un conjunto como CUSTOM: nada que haya pasado
 *  validateContentSet puede ser oficial, así que esto solo corrige los
 *  defaults de Zod (y persistidos antiguos) sin perder COMMUNITY/DRAFT. */
function stampSetCustom(set: ContentSet): ContentSet {
  return {
    ...set,
    cards: set.cards.map(c => (
      c.officialStatus === 'OFFICIAL' || c.officialStatus === 'OFFICIAL_PROMO'
        ? { ...c, officialStatus: 'CUSTOM' as const }
        : c
    )),
  };
}

function localSet(sets: ContentSet[]): ContentSet {
  const found = sets.find(s => s.id === DEFAULT_SET_ID);
  if (found) return found;
  return {
    id: DEFAULT_SET_ID,
    name: 'Mis creaciones',
    version: '1.0.0',
    author: 'local',
    description: 'Contenido creado en el Taller',
    status: 'PUBLISHED',
    cards: [],
    decks: [],
  };
}

/** Registra el estado previo en el historial de deshacer del conjunto. */
function pushHistory(
  get: () => CustomContentState,
  setId: string,
  before: ContentSet,
): Record<string, ContentSet[]> {
  const history = { ...get().history };
  const stack = [...(history[setId] ?? []), before];
  history[setId] = stack.slice(-HISTORY_LIMIT);
  return history;
}

export const useCustomContent = create<CustomContentState>((set, get) => ({
  loaded: false,
  sets: [],
  draft: null,
  cardDrafts: {},
  history: {},
  published: {},
  fragments: [],
  trash: {},

  init: async () => {
    if (get().loaded) return;
    try {
      const raw = await storageGet(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          // Reparación: versiones antiguas persistían el objeto YA parseado
          // por Zod, con officialStatus='OFFICIAL' por defecto → la siguiente
          // validación lo leía como "declarado oficial" y descartaba el set.
          // Nada validado puede ser oficial, así que el sello es seguro.
          const repaired = (parsed as ContentSet[]).map(stampSetCustom);
          set({ sets: repaired, loaded: true });
          if (JSON.stringify(repaired) !== raw) persist(repaired);
        }
        else set({ loaded: true });
      } else set({ loaded: true });
      // Precalentar el cache de imágenes del Taller: sourceImage 'asset:<id>'
      // se resuelve síncronamente en el render — sin warm-up, la primera
      // pasada siempre enseñaría el placeholder.
      void warmImageAssets(get().sets.flatMap(s => s.cards.map(c => c.sourceImage)));
      // Historial y versiones publicadas
      try {
        const metaRaw = await storageGet(META_KEY);
        if (metaRaw) {
          const meta = JSON.parse(metaRaw) as {
            history?: Record<string, ContentSet[]>;
            published?: Record<string, PublishedVersion[]>;
            fragments?: WorkshopFragment[];
            trash?: Record<string, TrashedCard>;
          };
          set({
            history: meta.history ?? {},
            published: meta.published ?? {},
            fragments: meta.fragments ?? [],
            trash: meta.trash ?? {},
          });
        }
      } catch { /* metadatos corruptos: empezar vac­o */ }
      const draftRaw = await storageGet(DRAFT_KEY);
      if (draftRaw) {
        try {
          const parsed = JSON.parse(draftRaw) as { current?: unknown; cards?: Record<string, unknown> };
          set({ draft: parsed?.current ?? null, cardDrafts: parsed?.cards ?? {} });
        } catch { /* borrador corrupto: ignorar */ }
      } else {
        // Migracion: borrador del editor antiguo (nt4h.study.draft) a clave nueva.
        // Se conserva el formato antiguo hasta que la migraci³n verifica.
        const legacy = await storageGet('nt4h.study.draft');
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy) as unknown;
            set({ draft: parsed });
            void storageSet(DRAFT_KEY, JSON.stringify({ current: parsed, cards: {} }));
          } catch { /* borrador antiguo corrupto: no migrar */ }
        }
      }
    } catch {
      set({ loaded: true });
    }
  },

  saveDraft: (draft) => {
    set({ draft });
    void storageSet(DRAFT_KEY, JSON.stringify({ current: draft, cards: get().cardDrafts }));
  },

  saveCardDraft: (cardId, draft) => {
    const cardDrafts = { ...get().cardDrafts, [cardId]: draft };
    set({ cardDrafts });
    void storageSet(DRAFT_KEY, JSON.stringify({ current: get().draft, cards: cardDrafts }));
  },

  clearDraft: () => {
    set({ draft: null });
    void storageSet(DRAFT_KEY, JSON.stringify({ current: null, cards: get().cardDrafts }));
  },

  importSet: (json) => {
    const catalog = loadCatalog();
    const res = validateContentSet(json, catalog.byId);
    if (!res.ok || !res.set) return res.errors;
    // Normalizar ANTES de persistir: el objeto parseado por Zod trae
    // officialStatus='OFFICIAL' por defecto en cartas que no lo declaran;
    // guardarlo tal cual haría que la revalidación lo tomara por un intento
    // explícito de marcar contenido como oficial y descartara el set.
    const stamped = stampSetCustom(res.set);
    const sets = get().sets;
    // Importar como conjunto independiente (sin tocar Mis creaciones)
    const updated = [...sets.filter(s => s.id !== stamped.id), stamped];
    set({ sets: updated });
    persist(updated);
    return [];
  },

  exportSet: (setId) => {
    const set = get().sets.find(s => s.id === setId);
    return set ? JSON.stringify(set, null, 2) : null;
  },

  removeSet: (setId) => {
    const sets = get().sets;
    if (!sets.some(s => s.id === setId)) return false;
    const updated = sets.filter(s => s.id !== setId);
    set({ sets: updated });
    persist(updated);
    return true;
  },

  upsertCard: (card) => {
    const sets = get().sets;
    const target = localSet(sets);
    const next: ContentSet = {
      ...target,
      cards: [...target.cards.filter(c => c.id !== card.id), { ...card, setId: target.id }],
    };
    const updated = [...sets.filter(s => s.id !== target.id), next];
    const catalog = loadCatalog();
    // Validar ANTES de persistir: una carta inválida no debe quedar
    // escrita en el set (ni en el almacenamiento local).
    const validation = validateContentSet(next, catalog.byId);
    if (!validation.ok) return validation.errors;
    const history = pushHistory(get, target.id, target);
    set({ sets: updated, history });
    persist(updated);
    persistMeta(history, get().published, get().fragments, get().trash);
    return validation.errors;
  },

  upsertDeck: (deck) => {
    const sets = get().sets;
    const target = localSet(sets);
    const next: ContentSet = {
      ...target,
      decks: [...target.decks.filter(d => d.id !== deck.id), { ...deck, setId: target.id }],
    };
    const updated = [...sets.filter(s => s.id !== target.id), next];
    // M-11: validar ANTES de persistir (mismo orden que upsertCard) —
    // un mazo inválido no debe quedar escrito en el set.
    const catalog = loadCatalogWithCustomSets(updated);
    const errors = validateDeck(deck, catalog.byId).errors;
    if (errors.length > 0) return errors;
    const history = pushHistory(get, target.id, target);
    set({ sets: updated, history });
    persist(updated);
    persistMeta(history, get().published, get().fragments, get().trash);
    return errors;
  },

  removeCard: (cardId) => {
    const sets = get().sets;
    const target = sets.find(s => s.cards.some(c => c.id === cardId));
    let history = get().history;
    const trash = { ...get().trash };
    if (target) {
      history = pushHistory(get, target.id, target);
      // Papelera: la carta y su borrador se conservan restaurables.
      const card = target.cards.find(c => c.id === cardId);
      if (card) {
        trash[cardId] = { card, draft: get().cardDrafts[cardId] ?? null, deletedAt: Date.now() };
      }
    }
    const updated = sets.map(s => ({
      ...s,
      cards: s.cards.filter(c => c.id !== cardId),
      // M-12: los mazos que citaban la carta quedaban con un
      // cardDefinitionId huérfano — limpiarlo en el mismo commit.
      decks: s.decks.map(d => ({
        ...d,
        cardEntries: d.cardEntries.filter(e => e.cardDefinitionId !== cardId),
      })),
    }));
    set({ sets: updated, history, trash });
    persist(updated);
    persistMeta(history, get().published, get().fragments, trash);
  },

  restoreCard: (cardId) => {
    const entry = get().trash[cardId];
    if (!entry) return false;
    const sets = get().sets;
    const target = localSet(sets);
    const history = pushHistory(get, target.id, target);
    const next: ContentSet = {
      ...target,
      cards: [...target.cards.filter(c => c.id !== cardId), entry.card],
    };
    const updated = [...sets.filter(s => s.id !== target.id), next];
    const trash = { ...get().trash };
    delete trash[cardId];
    const cardDrafts = entry.draft ? { ...get().cardDrafts, [cardId]: entry.draft } : get().cardDrafts;
    set({ sets: updated, history, trash, cardDrafts });
    persist(updated);
    persistMeta(history, get().published, get().fragments, trash);
    return true;
  },

  purgeTrash: () => {
    // Borradores huérfanos: sin la purga, nt4h.cardDraft crecería con cada
    // carta eliminada definitivamente. Vivos = en algún set o en papelera
    // (los de papelera se conservan para restaurar).
    const alive = new Set(Object.keys(get().trash));
    for (const s of get().sets) for (const c of s.cards) alive.add(c.id);
    const cardDrafts = Object.fromEntries(
      Object.entries(get().cardDrafts).filter(([id]) => alive.has(id)));
    // Imágenes del Taller huérfanas: las cartas purgadas de la papelera
    // ya no pueden restaurarse — su `nt4h.asset/<id>` sería basura
    // permanente (hasta 4 MiB por asset).
    const trashedAssets = Object.values(get().trash)
      .map(e => e.card.sourceImage)
      .filter((r): r is string => !!r);
    set({ trash: {}, cardDrafts });
    persistMeta(get().history, get().published, get().fragments, {});
    for (const ref of trashedAssets) void deleteImageAsset(ref);
  },

  saveFragment: (name, nodes) => {
    const fragments = [
      ...get().fragments,
      {
        id: `frag.${Date.now().toString(36)}-${get().fragments.length}`,
        name: name.trim() || `Fragmento ${get().fragments.length + 1}`,
        savedAt: Date.now(),
        nodes,
      },
    ];
    set({ fragments });
    persistMeta(get().history, get().published, fragments, get().trash);
  },

  removeFragment: (id) => {
    const fragments = get().fragments.filter(f => f.id !== id);
    set({ fragments });
    persistMeta(get().history, get().published, fragments, get().trash);
  },

  removeDeck: (deckId) => {
    const sets = get().sets;
    const target = sets.find(s => s.decks.some(d => d.id === deckId));
    let history = get().history;
    if (target) history = pushHistory(get, target.id, target);
    const updated = sets.map(s => ({ ...s, decks: s.decks.filter(d => d.id !== deckId) }));
    set({ sets: updated, history });
    persist(updated);
    persistMeta(history, get().published, get().fragments, get().trash);
  },

  undo: (setId) => {
    const stack = get().history[setId] ?? [];
    const before = stack[stack.length - 1];
    if (!before) return false;
    const history = { ...get().history, [setId]: stack.slice(0, -1) };
    const sets = [...get().sets.filter(s => s.id !== setId), before];
    set({ sets, history });
    persist(sets);
    persistMeta(history, get().published, get().fragments, get().trash);
    return true;
  },

  publish: (setId) => {
    const working = get().sets.find(s => s.id === setId);
    if (!working) return ['Set no encontrado'];
    const catalog = loadCatalog();
    const validation = validateContentSet(working, catalog.byId);
    if (!validation.ok) return validation.errors;
    // Versi³n inmutable: patch+1 respecto a la ºltima publicada
    const prev = get().published[setId] ?? [];
    const version = bumpPatch(prev[prev.length - 1]?.version ?? working.version);
    const snapshot: ContentSet = {
      ...JSON.parse(JSON.stringify(working)),
      version,
      status: 'PUBLISHED',
    };
    const record: PublishedVersion = {
      version,
      publishedAt: Date.now(),
      checksum: checksumOf(snapshot),
      snapshot: { ...snapshot, checksum: checksumOf(snapshot) },
    };
    const published = { ...get().published, [setId]: [...prev, record] };
    set({ published });
    persistMeta(get().history, published, get().fragments, get().trash);
    return [];
  },

  restoreVersion: (setId, version) => {
    const record = (get().published[setId] ?? []).find(v => v.version === version);
    if (!record) return false;
    // Verificaci³n de integridad: el snapshot no debe haberse alterado
    const { checksum: embedded, ...snapshotNoChecksum } = record.snapshot;
    // El snapshot restaurado debe coincidir con el checksum de publicación.
    if (typeof embedded === 'string'
      && embedded !== checksumOf(snapshotNoChecksum as ContentSet)) {
      return false;
    }
    const current = get().sets.find(s => s.id === setId);
    const history = current ? pushHistory(get, setId, current) : get().history;
    const restored: ContentSet = { ...JSON.parse(JSON.stringify(snapshotNoChecksum)), status: 'DRAFT' };
    const sets = [...get().sets.filter(s => s.id !== setId), restored];
    set({ sets, history });
    persist(sets);
    persistMeta(history, get().published, get().fragments, get().trash);
    return true;
  },
}));

function loadCatalogWithCustomSets(sets: ContentSet[]): CatalogLoadResult {
  const base = loadCatalog();
  const valid = sets
    .map(s => validateContentSet(s, base.byId))
    .filter(r => r.ok && r.set)
    .map(r => r.set!);
  return mergeCustomCards(base, valid);
}

/** Cat¡logo oficial + conjuntos personalizados v¡lidos. */
export function loadCatalogWithCustom(): CatalogLoadResult {
  return loadCatalogWithCustomSets(useCustomContent.getState().sets);
}

/** Todos los mazos personalizados declarados en los conjuntos. */
export function customDecks(): DeckDefinition[] {
  return useCustomContent.getState().sets.flatMap(s => s.decks);
}
