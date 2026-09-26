/**
 * useTheme — hooks que aplican las preferencias de accesibilidad.
 *
 * useColors(): paleta efectiva (alto contraste / daltonismo).
 * useFontScale(): multiplicador tipográfico del usuario.
 * useDensity(): escala de espaciado/padding según densidad.
 * useControlHeight(): altura de controles según tamaño elegido.
 */

import { PixelRatio } from 'react-native';
import { useSettings, type Density, type ControlSize, type Settings } from '../store/settingsStore';
import { resolveColors, type Colors, fontSize } from './theme';

/**
 * Lee un ajuste de forma reactiva. Fuera de un render React real
 * (p.ej. el renderer ligero de tests, que invoca componentes directamente)
 * cae a getState() sin reactividad — el comportamiento en app es idéntico.
 */
export function useSettingsSafe<T>(selector: (s: Settings) => T): T {
  try {
     
    return useSettings(selector);
  } catch {
    return selector(useSettings.getState());
  }
}

export function useColors(): Colors {
  const highContrast = useSettingsSafe((s) => s.highContrast);
  const colorMode = useSettingsSafe((s) => s.colorMode);
  return resolveColors({ highContrast, colorMode });
}

export function useFontScale(): number {
  const manual = useSettingsSafe((s) => s.fontScale);
  const useSystem = useSettingsSafe((s) => s.useSystemTextSize);
  if (!useSystem) return manual;
  // "Usar tamaño del dispositivo": la escala tipográfica del SO sustituye
  // a la manual (mismo rango 1-2). En web getFontScale() suele ser 1 —
  // el navegador no expone la preferencia y no se duplica el escalado.
  return Math.min(2, Math.max(1, PixelRatio.getFontScale()));
}

/** Escala un tamaño tipográfico base con la preferencia del usuario */
export function useFs(): (size: number) => number {
  const scale = useFontScale();
  return (size) => Math.round(size * scale * 10) / 10;
}

const DENSITY_FACTOR: Record<Density, number> = {
  compact: 0.8,
  standard: 1,
  comfortable: 1.25,
  wide: 1.5,
};

export function useDensity(): (space: number) => number {
  const density = useSettingsSafe((s) => s.density);
  return (space) => Math.round(space * DENSITY_FACTOR[density]);
}

const CONTROL_HEIGHT: Record<ControlSize, number> = {
  normal: 44,
  large: 52,
  xlarge: 60,
};

export function useControlHeight(): number {
  return CONTROL_HEIGHT[useSettingsSafe((s) => s.controlSize)];
}

/** Peso tipográfico efectivo: negrita incrementa un nivel */
export function useFontWeight(base: 'normal' | '500' | '600' | 'bold'): 'normal' | '500' | '600' | 'bold' {
  const bold = useSettingsSafe((s) => s.boldText);
  if (!bold) return base;
  const bump = { normal: '500', '500': '600', '600': 'bold', bold: 'bold' } as const;
  return bump[base];
}

/** Familia tipográfica efectiva (alta legibilidad) */
export function useFontFamily(): string | undefined {
  const legible = useSettingsSafe((s) => s.highLegibilityFont);
  return legible ? 'Verdana' : undefined;
}

/** Espaciado tipográfico extra (interlineado + tracking) */
export function useExtraTextSpacing(): { lineHeightFactor: number; letterSpacing: number } {
  const extra = useSettingsSafe((s) => s.extraTextSpacing);
  return extra ? { lineHeightFactor: 1.4, letterSpacing: 0.5 } : { lineHeightFactor: 1.2, letterSpacing: 0 };
}

/**
 * Hook consolidado: todo lo que un componente necesita para pintar con
 * el tema adaptativo del usuario (colores + escala + densidad + tamaño
 * de control + tipografía efectiva).
 */
export function useTheme(): {
  colors: Colors;
  fs: (size: number) => number;
  ds: (space: number) => number;
  controlHeight: number;
  fontWeight: (base: 'normal' | '500' | '600' | 'bold') => 'normal' | '500' | '600' | 'bold';
  fontFamily: string | undefined;
  spacing: { lineHeightFactor: number; letterSpacing: number };
} {
  const colors = useColors();
  const fs = useFs();
  const ds = useDensity();
  const controlHeight = useControlHeight();
  const fontFamily = useFontFamily();
  const spacing = useExtraTextSpacing();
  const bold = useSettingsSafe((s) => s.boldText);
  const bump = { normal: '500', '500': '600', '600': 'bold', bold: 'bold' } as const;
  return {
    colors,
    fs,
    ds,
    controlHeight,
    fontWeight: (base) => (bold ? bump[base] : base),
    fontFamily,
    spacing,
  };
}

export { fontSize };
