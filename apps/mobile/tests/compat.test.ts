import { describe, it, expect } from 'vitest';
import { checkCompatibility } from '../lib/compat';
import { CATALOG_VERSION } from '@nt4h/catalog';
import { ENGINE_VERSION } from '@nt4h/engine';

describe('compat — verificación estructurada sala↔cliente', () => {
  it('versiones iguales → compatible sin motivo', () => {
    const r = checkCompatibility({ catalogVersion: CATALOG_VERSION, engineVersion: ENGINE_VERSION });
    expect(r.compatible).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.resolution).toBe('OK');
  });

  it('motor distinto → incompatible UPDATE_REQUIRED', () => {
    const r = checkCompatibility({ catalogVersion: CATALOG_VERSION, engineVersion: '0.0.0' });
    expect(r.compatible).toBe(false);
    expect(r.reason).toBe('ENGINE_MISMATCH');
    expect(r.resolution).toBe('UPDATE_REQUIRED');
  });

  it('catálogo major distinto → incompatible', () => {
    const [maj] = CATALOG_VERSION.split('.');
    const r = checkCompatibility({ catalogVersion: `${Number(maj) + 9}.0.0`, engineVersion: ENGINE_VERSION });
    expect(r.compatible).toBe(false);
    expect(r.reason).toBe('CATALOG_MAJOR_MISMATCH');
  });

  it('catálogo minor/patch distinto → compatible con aviso', () => {
    const r = checkCompatibility({ catalogVersion: `${CATALOG_VERSION.split('.')[0]}.99.0`, engineVersion: ENGINE_VERSION });
    expect(r.compatible).toBe(true);
    expect(r.reason).toBe('CATALOG_VERSION_DIFFERS');
    expect(r.resolution).toBe('PLAY_WITH_RISK');
  });

  it('sin versiones → compatible pero desconocido', () => {
    const r = checkCompatibility(undefined);
    expect(r.compatible).toBe(true);
    expect(r.reason).toBe('VERSIONS_UNKNOWN');
  });
});
