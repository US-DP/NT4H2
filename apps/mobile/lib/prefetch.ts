/**
 * prefetch — precarga en segundo plano de los PNGs del catálogo.
 *
 * Usa expo-image.prefetch (caché nativa en iOS/Android, HTTP cache en web).
 * Falla en silencio: es una optimización, no un requisito.
 */

import { Image } from 'expo-image';
import { getImagePath, hasFrontImage, type CatalogLoadResult } from '@nt4h/catalog';

export function prefetchCardImages(catalog: CatalogLoadResult): void {
  try {
    const urls: string[] = [];
    for (const id of catalog.byId.keys()) {
      if (!hasFrontImage(id)) continue;
      const rel = getImagePath(id, 'game');
      if (rel) urls.push(`/${rel}`);
    }
    // Lotes para no saturar la red ni el hilo de UI
    const CHUNK = 20;
    let i = 0;
    const next = () => {
      const batch = urls.slice(i, i + CHUNK);
      i += CHUNK;
      if (batch.length === 0) return;
      void Image.prefetch(batch).then(() => {
        if (i < urls.length) setTimeout(next, 300);
      }).catch(() => {});
    };
    next();
  } catch {
    // prefetch es best-effort
  }
}
