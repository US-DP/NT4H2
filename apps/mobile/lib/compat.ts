/**
 * compat — verificación estructurada de compatibilidad sala↔cliente.
 *
 * En vez de comparar strings de versión, produce una respuesta con motivo
 * y resolución accionable (§12 del documento de revisión):
 *
 *   { compatible: false, reason: 'ENGINE_MISMATCH', resolution: 'UPDATE_REQUIRED' }
 *
 * Política:
 *   - motor distinto            → incompatible (reglas pueden divergir)
 *   - catálogo major distinto   → incompatible (cartas/sets pueden faltar)
 *   - catálogo minor/patch      → compatible con aviso (jugar bajo riesgo)
 *   - versiones ausentes        → compatible, estado desconocido
 */

import { ENGINE_VERSION } from '@nt4h/engine';
import { CATALOG_VERSION } from '@nt4h/catalog';

export type CompatReason =
  | 'ENGINE_MISMATCH'
  | 'CATALOG_MAJOR_MISMATCH'
  | 'CATALOG_VERSION_DIFFERS'
  | 'VERSIONS_UNKNOWN';

export type CompatResolution = 'UPDATE_REQUIRED' | 'PLAY_WITH_RISK' | 'OK';

export interface CompatResult {
  compatible: boolean;
  reason: CompatReason | null;
  resolution: CompatResolution;
  hostVersion: { catalog: string | null; engine: string | null };
  clientVersion: { catalog: string; engine: string };
}

function major(v: string): number | null {
  const m = /^(\d+)\./.exec(v.trim());
  return m ? Number(m[1]) : null;
}

export function checkCompatibility(hostConfig?: {
  catalogVersion?: string;
  engineVersion?: string;
} | null): CompatResult {
  const host = {
    catalog: hostConfig?.catalogVersion ?? null,
    engine: hostConfig?.engineVersion ?? null,
  };
  const base = { hostVersion: host, clientVersion: { catalog: CATALOG_VERSION, engine: ENGINE_VERSION } };

  if (!host.catalog && !host.engine) {
    return { compatible: true, reason: 'VERSIONS_UNKNOWN', resolution: 'PLAY_WITH_RISK', ...base };
  }
  if (host.engine && host.engine !== ENGINE_VERSION) {
    return { compatible: false, reason: 'ENGINE_MISMATCH', resolution: 'UPDATE_REQUIRED', ...base };
  }
  if (host.catalog && host.catalog !== CATALOG_VERSION) {
    const hostMajor = major(host.catalog);
    const localMajor = major(CATALOG_VERSION);
    if (hostMajor !== null && localMajor !== null && hostMajor !== localMajor) {
      return { compatible: false, reason: 'CATALOG_MAJOR_MISMATCH', resolution: 'UPDATE_REQUIRED', ...base };
    }
    return { compatible: true, reason: 'CATALOG_VERSION_DIFFERS', resolution: 'PLAY_WITH_RISK', ...base };
  }
  return { compatible: true, reason: null, resolution: 'OK', ...base };
}
