/**
 * settingsTransfer — exportar/importar ajustes de accesibilidad.
 *
 * El JSON importado es entrada NO confiable: se valida contra
 * DEFAULT_SETTINGS (claves conocidas, tipos y rangos) y se devuelve un
 * resumen de cambios para que el usuario confirme antes de aplicar.
 */

import { DEFAULT_SETTINGS, type Settings } from '../store/settingsStore';
import i18n from './i18n';

const SETTINGS_VERSION = 1;
const MAX_SETTINGS_BYTES = 64 * 1024;

/** Claves que nunca se importan (estado interno, no preferencias). */
const EXCLUDED_KEYS = new Set(['hydrated', 'lastGameConfig']);

export function exportSettingsJson(settings: Settings): string {
  const out: Record<string, unknown> = { $settingsVersion: SETTINGS_VERSION };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (EXCLUDED_KEYS.has(key)) continue;
    out[key] = settings[key];
  }
  return JSON.stringify(out, null, 2);
}

export interface SettingsImportResult {
  ok: boolean;
  /** Ajustes válidos listos para aplicar con `set()`. */
  values?: Partial<Settings>;
  /** Resumen legible: "fontScale: 1 → 2". */
  changes?: string[];
  error?: string;
}

/** Valida y resume un JSON de ajustes sin aplicarlo. */
export function parseSettingsJson(text: string, current: Settings): SettingsImportResult {
  if (text.length > MAX_SETTINGS_BYTES) {
    return { ok: false, error: i18n.t('common.settings.fileTooBig') };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: i18n.t('common.settings.fileBadJson') };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: i18n.t('common.settings.fileNoSettings') };
  }
  const input = raw as Record<string, unknown>;
  const values: Partial<Settings> = {};
  const changes: string[] = [];
  let rejected = 0;

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (EXCLUDED_KEYS.has(key) || !(key in input)) continue;
    const incoming = input[key];
    const def = DEFAULT_SETTINGS[key];
    // Rechaza __proto__/constructor (defensa en profundidad aunque
    // keyof Settings nunca incluya estos nombres)
    const k = key as string;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (typeof incoming !== typeof def) { rejected += 1; continue; }
    if (typeof def === 'number') {
      const n = incoming as number;
      if (!Number.isFinite(n)) { rejected += 1; continue; }
      // Rangos: fontScale 1-2, volúmenes/intensidades 0-100
      if (key === 'fontScale' && (n < 1 || n > 2)) { rejected += 1; continue; }
      if (key.startsWith('volume') && (n < 0 || n > 100)) { rejected += 1; continue; }
    }
    if (typeof def === 'string' && key === 'language'
      && !['system', 'es', 'en'].includes(incoming as string)) { rejected += 1; continue; }
    (values as Record<string, unknown>)[key] = incoming;
    if (incoming !== current[key]) {
      changes.push(`${key}: ${String(current[key])} → ${String(incoming)}`);
    }
  }

  if (Object.keys(values).length === 0) {
    return { ok: false, error: i18n.t('common.settings.noneValid') };
  }
  if (rejected > 0) changes.push(i18n.t('common.settings.rejected', { count: rejected }));
  return { ok: true, values, changes };
}
