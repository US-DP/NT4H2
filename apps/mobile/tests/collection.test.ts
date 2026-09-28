/**
 * collectionStore — progreso de colección (favoritos, descubiertas,
 * orden, spoiler/filtro) persistido en storage.
 *
 * Cubre los paths de estado reales del store:
 * - toggleFavorite añade/quita y persiste
 * - markDiscovered deduplica y no re-persiste sin cambios
 * - hydrate restaura un snapshot válido
 * - hydrate con JSON corrupto cae a defaults (catch) sin lanzar
 * - hydrate con snapshot parcial rellena defaults por campo
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCollection } from '../store/collectionStore';
import { storageSet, storageRemove, storageGet } from '../lib/storage';

const KEY = 'nt4h.collection.v1';

function resetStore() {
  useCollection.setState({
    hydrated: false,
    favorites: [],
    discovered: [],
    sort: 'name',
    spoilerMode: 'silhouette',
    originFilter: 'all',
  });
}

async function flush() {
  // hydrate() es async por dentro; un tick largo basta para el Map en memoria
  await new Promise(r => setTimeout(r, 10));
}

beforeEach(async () => {
  resetStore();
  await storageRemove(KEY);
});

describe('collectionStore', () => {
  it('toggleFavorite añade y quita, persistiendo cada vez', async () => {
    useCollection.getState().toggleFavorite('card.a');
    expect(useCollection.getState().favorites).toEqual(['card.a']);

    // Persistido de inmediato
    const saved = JSON.parse((await storageGet(KEY))!);
    expect(saved.favorites).toEqual(['card.a']);

    useCollection.getState().toggleFavorite('card.a');
    expect(useCollection.getState().favorites).toEqual([]);
  });

  it('markDiscovered deduplica y solo persiste con cambios', async () => {
    useCollection.getState().markDiscovered(['a', 'b']);
    expect(useCollection.getState().discovered.sort()).toEqual(['a', 'b']);

    const savedOnce = await storageGet(KEY);
    // Re-marcar los mismos ids + duplicados internos: sin cambio → sin re-escritura
    useCollection.getState().markDiscovered(['a', 'b', 'a']);
    expect(await storageGet(KEY)).toBe(savedOnce);
    expect(useCollection.getState().discovered).toHaveLength(2);

    useCollection.getState().markDiscovered(['b', 'c']);
    expect(useCollection.getState().discovered.sort()).toEqual(['a', 'b', 'c']);
  });

  it('hydrate restaura un snapshot válido', async () => {
    await storageSet(KEY, JSON.stringify({
      favorites: ['x'], discovered: ['y', 'z'],
      sort: 'cost', spoilerMode: 'show', originFilter: 'custom',
    }));
    useCollection.getState().hydrate();
    await flush();

    const s = useCollection.getState();
    expect(s.hydrated).toBe(true);
    expect(s.favorites).toEqual(['x']);
    expect(s.discovered).toEqual(['y', 'z']);
    expect(s.sort).toBe('cost');
    expect(s.spoilerMode).toBe('show');
    expect(s.originFilter).toBe('custom');
  });

  it('hydrate con JSON corrupto → defaults sin lanzar', async () => {
    await storageSet(KEY, '{{{not-json');
    useCollection.getState().hydrate();
    await flush();

    const s = useCollection.getState();
    expect(s.hydrated).toBe(true);
    expect(s.favorites).toEqual([]);
    expect(s.sort).toBe('name');
    expect(s.spoilerMode).toBe('silhouette');
  });

  it('hydrate con snapshot parcial rellena defaults por campo', async () => {
    await storageSet(KEY, JSON.stringify({ favorites: ['only-fav'] }));
    useCollection.getState().hydrate();
    await flush();

    const s = useCollection.getState();
    expect(s.favorites).toEqual(['only-fav']);
    expect(s.discovered).toEqual([]);
    expect(s.sort).toBe('name');
    expect(s.spoilerMode).toBe('silhouette');
    expect(s.originFilter).toBe('all');
  });

  it('hydrate sin datos → hydrated=true con defaults', async () => {
    useCollection.getState().hydrate();
    await flush();
    expect(useCollection.getState().hydrated).toBe(true);
    expect(useCollection.getState().favorites).toEqual([]);
  });

  it('setters de vista persisten', async () => {
    useCollection.getState().setSort('damage');
    useCollection.getState().setSpoilerMode('hide');
    useCollection.getState().setOriginFilter('official');
    const saved = JSON.parse((await storageGet(KEY))!);
    expect(saved.sort).toBe('damage');
    expect(saved.spoilerMode).toBe('hide');
    expect(saved.originFilter).toBe('official');
  });
});
