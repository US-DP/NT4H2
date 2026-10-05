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
  // (noColorOnly eliminado: invariante estructural — los estados combinan
  //  color+icono+borde y ningún componente lo ramificaba)
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
  /** @deprecated Solo se lee para migrar a `navMode`; ningún componente
   *  lo consume — no usar. Se conserva en el tipo para no romper el
   *  storage de versiones antiguas. */
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
  color: ['highContrast', 'colorMode'],
  motion: ['reduceMotion', 'noFlashes', 'autoPlayAnimations'],
  sound: ['volumeMaster', 'volumeMusic', 'volumeEffects', 'vibration', 'hapticFeedback', 'hapticIntensity'],
  controls: ['controlSize', 'dragSensitivity', 'holdToConfirm', 'gestureAlternatives'],
  screenReader: ['srAnnounceState', 'srExpandedLabels', 'srListPositions'],
};

const ACCESSIBILITY_KEYS: (keyof Settings)[] = [
  'useSystemTextSize', 'fontScale', 'density', 'boldText', 'highLegibilityFont',
  'extraTextSpacing', 'highContrast', 'colorMode', 'reduceMotion',
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
    });
  },
}));

// Exportar/importar ajustes vive en lib/settingsTransfer.ts (única
// implementación — una versión anterior duplicada aquí quedó muerta).
