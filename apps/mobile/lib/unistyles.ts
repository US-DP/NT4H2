/**
 * unistyles — registro del sistema de estilos NT4H sobre react-native-unistyles.
 *
 * Expone los tokens existentes (colors/spacing/radius/typeScale/elevation)
 * como temas Unistyles con breakpoints compartidos:
 *   - `nt4h`        → paleta medieval oscura por defecto
 *   - `highContrast` → paleta WCAG AAA (sincronizada con ajustes)
 *
 * Componentes nuevos deben usar `StyleSheet.create` de 'react-native-unistyles'
 * (no el de 'react-native') y leer `theme`/`rt.breakpoint` en vez de literales.
 */

import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import {
  colors, spacing, radius, fontSize, typeScale, tokens, elevation,
  resolveColors, touchTarget,
} from './theme';

const base = {
  spacing,
  radius,
  fontSize,
  typeScale,
  tokens,
  elevation,
  touchTarget,
};

const nt4hTheme = {
  ...base,
  colors,
};

const highContrastTheme = {
  ...base,
  colors: resolveColors({ highContrast: true, colorMode: 'default' }),
};

export const appThemes = {
  nt4h: nt4hTheme,
  highContrast: highContrastTheme,
};

export const breakpoints = {
  /** móvil estrecho */
  sm: 0,
  /** móvil grande / tableta */
  md: 640,
  /** escritorio estrecho (equivale a `wide` en pantallas) */
  lg: 960,
  /** escritorio amplio */
  xl: 1280,
} as const;

type AppBreakpoints = typeof breakpoints;
type AppThemes = typeof appThemes;

declare module 'react-native-unistyles' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface UnistylesThemes extends AppThemes {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

StyleSheet.configure({
  settings: { initialTheme: 'nt4h' },
  breakpoints,
  themes: appThemes,
});

/** Sincroniza el tema Unistyles con el ajuste de alto contraste. */
export function syncUnistylesTheme(highContrast: boolean): void {
  const target = highContrast ? 'highContrast' : 'nt4h';
  if (UnistylesRuntime.themeName !== target) {
    UnistylesRuntime.setTheme(target);
  }
}
