/**
 * collectionStore — progreso de colección del jugador.
 *
 * Persistido localmente (AsyncStorage nativo / localStorage web):
 * - favorites: cartas marcadas con estrella.
 * - discovered: cartas reveladas al jugar (héroes y mazos usados).
 * - sort: última ordenación usada en la biblioteca.
 */

import { create } from 'zustand';
import { storageGet, storageSet } from '../lib/storage';

const STORAGE_KEY = 'nt4h.collection.v1';

export type CollectionSort = 'name' | 'type' | 'damage' | 'cost';
/** Control de spoilers: ocultar del todo, silueta atenuada o mostrar todo */
export type SpoilerMode = 'hide' | 'silhouette' | 'show';
/** Filtro de origen: todo el catálogo, solo oficial o solo contenido del Taller */
export type OriginFilter = 'all' | 'official' | 'custom';

interface CollectionState {
  hydrated: boolean;
  favorites: string[];
  discovered: string[];
  sort: CollectionSort;
  spoilerMode: SpoilerMode;
  originFilter: OriginFilter;
  /** Resuelve cuando el estado persistido está en memoria. Idempotente:
   *  llamadas concurrentes comparten la misma lectura. */
  hydrate: () => Promise<void>;
  toggleFavorite: (cardId: string) => void;
  markDiscovered: (cardIds: string[]) => void;
  setSort: (sort: CollectionSort) => void;
  setSpoilerMode: (mode: SpoilerMode) => void;
  setOriginFilter: (filter: OriginFilter) => void;
}

interface Persisted {
  favorites: string[];
  discovered: string[];
  sort: CollectionSort;
  spoilerMode: SpoilerMode;
  originFilter: OriginFilter;
}

function persist(s: Persisted) {
  void storageSet(STORAGE_KEY, JSON.stringify(s));
}

/** Extrae la porción persistida del estado actual. */
function snapshot(s: CollectionState): Persisted {
  return {
    favorites: s.favorites,
    discovered: s.discovered,
    sort: s.sort,
    spoilerMode: s.spoilerMode,
    originFilter: s.originFilter,
  };
}

/** Promesa de hidratación EN CURSO: deduplica lecturas concurrentes y da
 *  a los mutadores un punto de espera — antes, un markDiscovered() ejecutado
 *  sin haber abierto la biblioteca persistía el estado VACÍO sobre el
 *  JSON guardado y borraba favoritos/descubiertos/ajustes del usuario.
 *  IMPORTANTE: se libera al completar (no se cachea para siempre) — una
 *  promesa resuelta con hydrated=false (estado reseteado) encadenaba
 *  .then(mutate)→defer→.then(mutate) en un bucle de microtareas infinito. */
let _hydrating: Promise<void> | null = null;

export const useCollection = create<CollectionState>()((set, get) => {
  /** Diferir la mutación hasta que el estado persistido esté en memoria;
   *  devuelve true si la llamada fue encolada (el llamador debe retornar).
   *  La promesa devuelta por hydrate() siempre termina con hydrated=true,
   *  así que el mutador diferido nunca se re-encola. */
  const deferUntilHydrated = (mutate: () => void): boolean => {
    if (get().hydrated) return false;
    void get().hydrate().then(mutate);
    return true;
  };

  return {
    hydrated: false,
    favorites: [],
    discovered: [],
    sort: 'name',
    spoilerMode: 'silhouette',
    originFilter: 'all',

    hydrate: () => {
      if (get().hydrated) return Promise.resolve();
      _hydrating ??= (async () => {
        try {
          const raw = await storageGet(STORAGE_KEY);
          if (raw) {
            const saved = JSON.parse(raw) as Partial<Persisted>;
            set({
              favorites: saved.favorites ?? [],
              discovered: saved.discovered ?? [],
              sort: saved.sort ?? 'name',
              spoilerMode: saved.spoilerMode ?? 'silhouette',
              originFilter: saved.originFilter ?? 'all',
              hydrated: true,
            });
            return;
          }
        } catch { /* JSON corrupto → defaults */ }
        set({ hydrated: true });
      })().finally(() => { _hydrating = null; });
      return _hydrating;
    },

    toggleFavorite: (cardId) => {
      if (deferUntilHydrated(() => get().toggleFavorite(cardId))) return;
      const favorites = get().favorites.includes(cardId)
        ? get().favorites.filter((id) => id !== cardId)
        : [...get().favorites, cardId];
      set({ favorites });
      persist(snapshot(get()));
    },

    markDiscovered: (cardIds) => {
      if (deferUntilHydrated(() => get().markDiscovered(cardIds))) return;
      const current = new Set(get().discovered);
      const next = new Set([...current, ...cardIds]);
      if (next.size === current.size) return;
      const discovered = [...next];
      set({ discovered });
      persist(snapshot(get()));
    },

    setSort: (sort) => {
      if (deferUntilHydrated(() => get().setSort(sort))) return;
      set({ sort });
      persist(snapshot(get()));
    },

    setSpoilerMode: (mode) => {
      if (deferUntilHydrated(() => get().setSpoilerMode(mode))) return;
      set({ spoilerMode: mode });
      persist(snapshot(get()));
    },

    setOriginFilter: (originFilter) => {
      if (deferUntilHydrated(() => get().setOriginFilter(originFilter))) return;
      set({ originFilter });
      persist(snapshot(get()));
    },
  };
});
