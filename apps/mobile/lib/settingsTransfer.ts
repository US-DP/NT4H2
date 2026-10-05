/**
 * settingsTransfer — exportar/importar ajustes de accesibilidad.
 *
 * Exporta un sobre autoidentificable `{app:'nt4h',kind:'settings',version,settings}`.
 * Importa tanto el sobre como el formato plano histórico (`$settingsVersion`
 * + claves a nivel raíz), así que los ficheros ya exportados siguen abriéndose.
 *
 * El JSON importado es entrada NO confiable: solo se aceptan claves de
 * DEFAULT_SETTINGS, con comprobación de tipo, lista cerrada para enums,
 * rango para números y tope de longitud para strings. Se devuelve un
 * resumen de cambios para que el usuario confirme antes de aplicar.
 */

import {
  DEFAULT_SETTINGS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  type Settings,
} from '../store/settingsStore';
import i18n from './i18n';

const SETTINGS_VERSION = 1;
const MAX_SETTINGS_BYTES = 64 * 1024;
const MAX_STRING_LEN = 80;

const SETTINGS_ENVELOPE = { app: 'nt4h', kind: 'settings', version: SETTINGS_VERSION } as const;

/** Claves que nunca se importan ni exportan (estado interno, no preferencias). */
const EXCLUDED_KEYS = new Set(['hydrated', 'lastGameConfig']);

const EXPORT_KEYS = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[])
  .filter((k) => !EXCLUDED_KEYS.has(k));

/** Enums: lista cerrada de valores admitidos para ajustes string. */
const ENUM_OPTIONS: Partial<Record<keyof Settings, readonly string[]>> = {
  language: ['system', 'es', 'en'],
  density: ['compact', 'standard', 'comfortable', 'wide'],
  colorMode: ['default', 'protanopia', 'deuteranopia', 'tritanopia', 'monochrome'],
  hapticIntensity: ['off', 'light', 'medium', 'strong'],
  controlSize: ['normal', 'large', 'xlarge'],
  dragSensitivity: ['low', 'medium', 'high'],
  gameOrientation: ['auto', 'landscape', 'portrait'],
  hordeSummaryMode: ['always', 'modifiers', 'never'],
  navMode: ['auto', 'collapsed', 'expanded'],
};

const NUMERIC_RANGE: Partial<Record<keyof Settings, [number, number]>> = {
  fontScale: [FONT_SCALE_MIN, FONT_SCALE_MAX],
  volumeMaster: [0, 100],
  volumeMusic: [0, 100],
  volumeEffects: [0, 100],
};

export function exportSettingsJson(settings: Settings): string {
  const out: Record<string, unknown> = {};
  for (const key of EXPORT_KEYS) out[key] = settings[key];
  return JSON.stringify({ ...SETTINGS_ENVELOPE, settings: out }, null, 2);
}

export interface SettingsImportResult {
  ok: boolean;
  /** Ajustes válidos listos para aplicar con `set()`. */
  values?: Partial<Settings>;
  /** Resumen legible: "fontScale: 1 → 2". */
  changes?: string[];
  error?: string;
}

/**
 * Valida y resume un JSON de ajustes sin aplicarlo.
 * Acepta el sobre `{app,kind,settings}` y el formato plano legado.
 */
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
  const obj = raw as Record<string, unknown>;
  // Sobre nuevo: {app:'nt4h', kind:'settings', settings:{...}}.
  // Plano legado: {$settingsVersion:1, fontScale:…} — claves a nivel raíz.
  const input = (
    obj.app === SETTINGS_ENVELOPE.app && obj.kind === SETTINGS_ENVELOPE.kind
      ? obj.settings
      : obj
  ) as Record<string, unknown> | undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: i18n.t('common.settings.fileNoSettings') };
  }

  const values: Partial<Settings> = {};
  const changes: string[] = [];
  let rejected = 0;

  for (const key of EXPORT_KEYS) {
    if (!(key in input)) continue;
    const incoming = input[key];
    const def = DEFAULT_SETTINGS[key];
    const enums = ENUM_OPTIONS[key];
    const range = NUMERIC_RANGE[key];
    let ok = false;
    let value: unknown = incoming;
    if (enums) {
      ok = typeof incoming === 'string' && (enums as readonly string[]).includes(incoming);
    } else if (range) {
      // Números con rango: fuera de límites se clampea en lugar de rechazar
      // (una exportación de otra versión no debería perder el ajuste entero).
      ok = typeof incoming === 'number' && Number.isFinite(incoming);
      if (ok) value = Math.max(range[0], Math.min(range[1], incoming as number));
    } else {
      ok = typeof incoming === typeof def
        && (typeof incoming !== 'string' || incoming.length <= MAX_STRING_LEN);
    }
    if (!ok) {
      rejected += 1;
      continue;
    }
    (values as Record<string, unknown>)[key] = value;
    if (value !== current[key]) {
      changes.push(`${key}: ${String(current[key])} → ${String(value)}`);
    }
  }

  if (Object.keys(values).length === 0) {
    return { ok: false, error: i18n.t('common.settings.noneValid') };
  }
  if (rejected > 0) changes.push(i18n.t('common.settings.rejected', { count: rejected }));
  return { ok: true, values, changes };
}
