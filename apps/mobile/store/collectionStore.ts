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
  hydrate: () => void;
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

export const useCollection = create<CollectionState>()((set, get) => ({
  hydrated: false,
  favorites: [],
  discovered: [],
  sort: 'name',
  spoilerMode: 'silhouette',
  originFilter: 'all',

  hydrate: () => {
    void (async () => {
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
    })();
  },

  toggleFavorite: (cardId) => {
    const favorites = get().favorites.includes(cardId)
      ? get().favorites.filter((id) => id !== cardId)
      : [...get().favorites, cardId];
    set({ favorites });
    persist(snapshot(get()));
  },

  markDiscovered: (cardIds) => {
    const current = new Set(get().discovered);
    const next = new Set([...current, ...cardIds]);
    if (next.size === current.size) return;
    const discovered = [...next];
    set({ discovered });
    persist(snapshot(get()));
  },

  setSort: (sort) => {
    set({ sort });
    persist(snapshot(get()));
  },

  setSpoilerMode: (mode) => {
    set({ spoilerMode: mode });
    persist(snapshot(get()));
  },

  setOriginFilter: (originFilter) => {
    set({ originFilter });
    persist(snapshot(get()));
  },
}));
