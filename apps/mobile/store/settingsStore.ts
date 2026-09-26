/**
 * settingsStore — preferencias de perfil y accesibilidad.
 *
 * Persistidas en almacenamiento local (AsyncStorage nativo / localStorage web)
 * via lib/storage.ts. Los componentes las consumen con hooks del tema
 * (useColors), haptics, animaciones y controles.
 */

import { create } from 'zustand';
import type { GameConfig } from '@nt4h/schema';
import { storageGet, storageSet } from '../lib/storage';

const STORAGE_KEY = 'nt4h:settings:v1';

export type Density = 'compact' | 'standard' | 'comfortable' | 'wide';
export type ColorMode = 'default' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'monochrome';
export type ControlSize = 'normal' | 'large' | 'xlarge';
export type DragSensitivity = 'low' | 'medium' | 'high';
export type HapticIntensity = 'off' | 'light' | 'medium' | 'strong';
export type GameOrientation = 'auto' | 'landscape' | 'portrait';
/** Apertura automática del resumen del Ataque de la Horda */
export type HordeSummaryMode = 'always' | 'modifiers' | 'never';

/** Escala mínima 100 %: por debajo el texto funcional se vuelve ilegible */
export const FONT_SCALE_MIN = 1;
export const FONT_SCALE_MAX = 2;

export interface Settings {
  // Perfil
  displayName: string;
  language: 'system' | 'es' | 'en';
  // Texto y visualización
  useSystemTextSize: boolean;
  fontScale: number; // 1 | 1.15 | 1.3 | 1.5 | 2 (mínimo 100 %)
  density: Density;
  boldText: boolean;
  highLegibilityFont: boolean;
  extraTextSpacing: boolean;
  // Color y contraste
  highContrast: boolean;
  noColorOnly: boolean;
  colorMode: ColorMode;
  // Movimiento
  reduceMotion: boolean;
  noFlashes: boolean;
  autoPlayAnimations: boolean;
  // Sonido y respuesta
  volumeMaster: number;
  volumeMusic: number;
  volumeEffects: number;
  vibration: boolean;
  hapticFeedback: boolean;
  hapticIntensity: HapticIntensity;
  // Interacción
  controlSize: ControlSize;
  dragSensitivity: DragSensitivity;
  holdToConfirm: boolean;
  gestureAlternatives: boolean;
  // Lector de pantalla
  srAnnounceState: boolean;
  srExpandedLabels: boolean;
  srListPositions: boolean;
  // Partida
  /** Móvil: la pestaña activa sigue a la fase salvo elección manual del usuario */
  autoFollowPhaseTabs: boolean;
  /** Orientación forzada durante la partida ('auto' = sin bloqueo) */
  gameOrientation: GameOrientation;
  /** Apertura del resumen de la Horda: siempre / solo si hay modificadores / nunca automático */
  hordeSummaryMode: HordeSummaryMode;
  /** Última configuración usada para crear una partida (partida rápida) */
  lastGameConfig: GameConfig | null;
  /** Atajos de teclado de la mesa activos (web; Escape siempre funciona) */
  shortcutsEnabled: boolean;
  /** Escritorio web: sidebar de navegación expandida (icono + etiqueta) */
  navExpanded: boolean;
  /** Modo del sidebar: 'auto' expande solo en monitores amplios (≥1200 px) */
  navMode: 'auto' | 'collapsed' | 'expanded';
  /** Opt-in: compartir desbloqueos de logros de forma anónima para la
   *  rareza global (nada sale del dispositivo mientras esté apagado) */
  shareStats: boolean;
  /** Opt-in separado: publicar victorias en la clasificación con el
   *  displayName visible (a diferencia de shareStats, NO es anónimo) */
  publicLeaderboard: boolean;
  /** Música ambiental generativa durante la partida (web; nativo no-op
   *  hasta disponer de assets) */
  backgroundMusic: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  language: 'system',
  useSystemTextSize: false,
  fontScale: 1,
  density: 'standard',
  boldText: false,
  highLegibilityFont: false,
  extraTextSpacing: false,
  highContrast: false,
  noColorOnly: true,
  colorMode: 'default',
  reduceMotion: false,
  noFlashes: false,
  autoPlayAnimations: true,
  volumeMaster: 70,
  volumeMusic: 50,
  volumeEffects: 80,
  vibration: true,
  hapticFeedback: true,
  hapticIntensity: 'medium',
  controlSize: 'normal',
  dragSensitivity: 'medium',
  holdToConfirm: false,
  gestureAlternatives: true,
  srAnnounceState: true,
  srExpandedLabels: true,
  srListPositions: true,
  autoFollowPhaseTabs: true,
  gameOrientation: 'landscape',
  hordeSummaryMode: 'modifiers',
  lastGameConfig: null,
  navExpanded: false,
  shortcutsEnabled: true,
  navMode: 'auto',
  shareStats: false,
  publicLeaderboard: false,
  backgroundMusic: true,
};

interface SettingsStore extends Settings {
  /** true cuando la carga inicial desde almacenamiento ha terminado */
  hydrated: boolean;
  hydrate: () => void;
  set: (partial: Partial<Settings>) => void;
  /** Restablece solo las opciones de accesibilidad (no perfil) */
  resetAccessibility: () => void;
  /** Restablece una sola sección de accesibilidad */
  resetAccessibilitySection: (section: AccessibilitySection) => void;
  /** Perfil recomendado: texto grande, contraste alto, poco movimiento, controles grandes */
  applyRecommended: () => void;
}

export type AccessibilitySection =
  'text' | 'color' | 'motion' | 'sound' | 'controls' | 'screenReader';

const SECTION_KEYS: Record<AccessibilitySection, (keyof Settings)[]> = {
  text: ['useSystemTextSize', 'fontScale', 'density', 'boldText', 'highLegibilityFont', 'extraTextSpacing'],
  color: ['highContrast', 'noColorOnly', 'colorMode'],
  motion: ['reduceMotion', 'noFlashes', 'autoPlayAnimations'],
  sound: ['volumeMaster', 'volumeMusic', 'volumeEffects', 'vibration', 'hapticFeedback', 'hapticIntensity'],
  controls: ['controlSize', 'dragSensitivity', 'holdToConfirm', 'gestureAlternatives'],
  screenReader: ['srAnnounceState', 'srExpandedLabels', 'srListPositions'],
};

const ACCESSIBILITY_KEYS: (keyof Settings)[] = [
  'useSystemTextSize', 'fontScale', 'density', 'boldText', 'highLegibilityFont',
  'extraTextSpacing', 'highContrast', 'noColorOnly', 'colorMode', 'reduceMotion',
  'noFlashes', 'autoPlayAnimations', 'volumeMaster', 'volumeMusic', 'volumeEffects',
  'vibration', 'hapticFeedback', 'hapticIntensity', 'controlSize', 'dragSensitivity',
  'holdToConfirm', 'gestureAlternatives', 'srAnnounceState', 'srExpandedLabels',
  'srListPositions',
];

function persist(s: Settings) {
  void storageSet(STORAGE_KEY, JSON.stringify(s));
}

export const useSettings = create<SettingsStore>()((set, get) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: () => {
    void (async () => {
      try {
        const raw = await storageGet(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<Settings>;
          // Clamp defensivo: valores fuera de rango (p. ej. fontScale 0.85 de
          // versiones antiguas) se ajustan a los límites actuales
          if (typeof saved.fontScale === 'number') {
            saved.fontScale = Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, saved.fontScale));
          }
          // Migración: navExpanded (bool) → navMode. Una preferencia
          // explícita previa gana a 'auto'.
          if (saved.navMode === undefined && saved.navExpanded === true) {
            saved.navMode = 'expanded';
          }
          set({ ...DEFAULT_SETTINGS, ...saved, hydrated: true });
          return;
        }
      } catch { /* JSON corrupto → defaults */ }
      set({ hydrated: true });
    })();
  },

  set: (partial) => {
    set(partial);
    const { hydrated: _h, hydrate: _hy, set: _s, resetAccessibility: _r, resetAccessibilitySection: _rs, applyRecommended: _a, ...prefs } = get();
    persist(prefs);
  },

  resetAccessibility: () => {
    const reset = Object.fromEntries(
      ACCESSIBILITY_KEYS.map((k) => [k, DEFAULT_SETTINGS[k]]),
    );
    get().set(reset as Partial<Settings>);
  },

  resetAccessibilitySection: (section) => {
    const reset = Object.fromEntries(
      SECTION_KEYS[section].map((k) => [k, DEFAULT_SETTINGS[k]]),
    );
    get().set(reset as Partial<Settings>);
  },

  applyRecommended: () => {
    get().set({
      fontScale: 1.15,
      highContrast: true,
      reduceMotion: true,
      noFlashes: true,
      controlSize: 'large',
      noColorOnly: true,
    });
  },
}));

/* ---------- Exportar / importar ajustes ---------- */

const SETTINGS_ENVELOPE = { app: 'nt4h', kind: 'settings', version: 1 } as const;

/** Claves exportables: todo excepto lastGameConfig (datos de partida, no preferencia). */
const EXPORT_KEYS = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[])
  .filter((k) => k !== 'lastGameConfig');

const ENUM_OPTIONS: Partial<Record<keyof Settings, readonly string[]>> = {
  language: ['system', 'es', 'en'],
  density: ['compact', 'standard', 'comfortable', 'wide'],
  colorMode: ['default', 'protanopia', 'deuteranopia', 'tritanopia', 'monochrome'],
  hapticIntensity: ['off', 'light', 'medium', 'strong'],
  controlSize: ['normal', 'large', 'xlarge'],
  dragSensitivity: ['low', 'medium', 'high'],
  gameOrientation: ['auto', 'landscape', 'portrait'],
  hordeSummaryMode: ['always', 'modifiers', 'never'],
};

const NUMERIC_RANGE: Partial<Record<keyof Settings, [number, number]>> = {
  fontScale: [FONT_SCALE_MIN, FONT_SCALE_MAX],
  volumeMaster: [0, 100],
  volumeMusic: [0, 100],
  volumeEffects: [0, 100],
};

/** Serializa las preferencias exportables a JSON. */
export function exportSettingsJson(s: Settings): string {
  const settings = Object.fromEntries(EXPORT_KEYS.map((k) => [k, s[k]]));
  return JSON.stringify({ ...SETTINGS_ENVELOPE, settings }, null, 2);
}

/**
 * Valida y normaliza un fichero de ajustes importado.
 * Devuelve un Partial<Settings> seguro o null si el envelope no es válido.
 * Entrada no confiable: se ignoran claves desconocidas y valores de tipo
 * incorrecto; enums fuera de lista se descartan; números se clampean.
 */
export function parseSettingsJson(raw: string): Partial<Settings> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' || parsed === null ||
    (parsed as Record<string, unknown>).app !== SETTINGS_ENVELOPE.app ||
    (parsed as Record<string, unknown>).kind !== SETTINGS_ENVELOPE.kind
  ) {
    return null;
  }
  const incoming = (parsed as Record<string, unknown>).settings;
  if (typeof incoming !== 'object' || incoming === null) return null;

  const out: Partial<Settings> = {};
  for (const key of EXPORT_KEYS) {
    const value = (incoming as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const def = DEFAULT_SETTINGS[key];
    const enums = ENUM_OPTIONS[key];
    const range = NUMERIC_RANGE[key];
    if (enums) {
      if (typeof value === 'string' && (enums as readonly string[]).includes(value)) {
        (out as Record<string, unknown>)[key] = value;
      }
    } else if (range) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        (out as Record<string, unknown>)[key] = Math.max(range[0], Math.min(range[1], value));
      }
    } else if (typeof value === typeof def) {
      // strings (displayName) con límite razonable
      if (typeof value === 'string' && value.length > 80) continue;
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
