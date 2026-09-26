/**
 * theme — sistema de diseño de NT4H.
 *
 * Paleta limitada (regla 70/20/10), escala de espaciado única,
 * tipografía jerárquica y radios consistentes. Todo componente nuevo
 * debe consumir estos tokens en vez de colores/medidas literales.
 */

export const colors = {
  // Base neutra (~70%)
  background: '#0f0f1e',
  surface: '#1a1a2e',
  surfaceRaised: '#232340',
  border: '#2e2e4a',
  divider: '#26263c',

  // Texto (contraste alto → bajo)
  text: '#f0f2f5',
  textMuted: '#a8b0bc',
  textFaint: '#6b7280',

  // Acento de marca (~10%) — oro del juego
  accent: '#f1c40f',
  accentDim: '#8a7712',

  // Semánticos
  primary: '#3b82f6',
  primaryPressed: '#2563eb',
  success: '#27ae60',
  successPressed: '#1e8449',
  danger: '#e74c3c',
  dangerPressed: '#c0392b',
  info: '#3498db',
  warning: '#f39c12',

  // Texto funcional
  textOnAccent: '#1a1a2e',
  textDisabled: '#4b5563',
  textLink: '#3498db',
  textDanger: '#e74c3c',
  textWarning: '#f39c12',

  // Superficies interactivas
  surfaceInteractive: '#232340',
  surfaceInteractiveHover: '#2b2b4a',
  surfaceInteractivePressed: '#1e1e38',
  surfaceInteractiveSelected: '#2b2b4a',
  surfaceDisabled: '#212136',

  // Bordes funcionales
  borderFocus: '#f1c40f',
  borderSelected: '#f1c40f',
  borderDisabled: '#33334f',
  borderDanger: '#e74c3c',

  // Overlays
  overlayScrim: 'rgba(0,0,0,0.55)',
  overlayStrong: 'rgba(0,0,0,0.75)',

  // Superficie semántica de peligro (banner de previsión de la Horda)
  dangerSurface: '#3a1420',
  // Superficie semantica de informacion (mensajes propios en chat)
  infoSurface: '#1e3a52',

  // Juego (daño, curación, economía…)
  gameDamage: '#e74c3c',
  gameHealing: '#27ae60',
  gameShield: '#3498db',
  gameGlory: '#f1c40f',
  gameCoin: '#d4a017',
  gameWound: '#c0392b',

  // Estado de conexión
  connectionOnline: '#27ae60',
  connectionOffline: '#e74c3c',
  connectionReconnecting: '#f39c12',
  connectionStale: '#7f8c8d',
} as const;

/** Escala de espaciado — usar SOLO estos múltiplos */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const fontSize = {
  hero: 40,
  title: 28,
  section: 20,
  body: 15,
  detail: 13,
  micro: 11,
} as const;

/** Hit target mínimo accesible (WCAG / plataformas) */
export const touchTarget = 44;
export type Colors = { [K in keyof typeof colors]: string };

/**
 * Tokens semánticos por función — preferidos sobre `colors.*` directo
 * en componentes nuevos. Facilitan alto contraste, modos de color y
 * estados deshabilitados sin buscar hex sueltos.
 */
export const tokens = {
  bg: {
    canvas: colors.background,
    surface: colors.surface,
    raised: colors.surfaceRaised,
    overlay: 'rgba(0,0,0,0.55)',
  },
  text: {
    primary: colors.text,
    secondary: colors.textMuted,
    muted: colors.textFaint,
    /** Texto sobre acento dorado */
    inverse: '#1a1a2e',
  },
  border: {
    subtle: colors.divider,
    default: colors.border,
    strong: '#3b405b',
    focus: colors.accent,
  },
  action: {
    primary: colors.accent,
    primaryPressed: colors.accentDim,
    primaryDisabled: '#3a3a52',
    danger: colors.danger,
    dangerPressed: colors.dangerPressed,
  },
  status: {
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.info,
  },
} as const;

/** Escala tipográfica formal: tamaño/interlineado por nivel */
export const typeScale = {
  display: { size: 48, line: 54 },
  h1: { size: 36, line: 43 },
  h2: { size: 28, line: 34 },
  h3: { size: 22, line: 28 },
  title: { size: 18, line: 24 },
  body: { size: 16, line: 24 },
  bodySm: { size: 14, line: 21 },
  caption: { size: 12, line: 17 },
  button: { size: 15, line: 20 },
} as const;

/** Niveles de elevación en tema oscuro (luminancia, no solo sombra) */
export const elevation = {
  /** Nivel 0: fondo global */
  canvas: colors.background,
  /** Nivel 1: panel */
  panel: colors.surface,
  /** Nivel 2: tarjeta interactiva */
  card: colors.surfaceRaised,
  /** Nivel 3: elemento seleccionado */
  selected: '#2b2b4a',
  /** Nivel 4: popover o menú */
  popover: '#2f2f52',
  /** Nivel 5: modal */
  modal: '#34345c',
} as const;

/** Paleta de alto contraste: fondos más oscuros, texto puro, bordes claros */
const HIGH_CONTRAST: Colors = {
  ...colors,
  background: '#000000',
  surface: '#0d0d0d',
  surfaceRaised: '#1a1a1a',
  border: '#8a8a8a',
  divider: '#5a5a5a',
  text: '#ffffff',
  textMuted: '#d5dbe3',
  textFaint: '#a8a8a8',
  accent: '#ffd60a',
  accentDim: '#c9a800',
  primary: '#66aaff',
  primaryPressed: '#3388ee',
  success: '#4ade80',
  successPressed: '#22c55e',
  danger: '#ff6b5e',
  dangerPressed: '#ee4433',
  info: '#5ec8f8',
  warning: '#ffb020',

  // Texto funcional (contraste reforzado)
  textOnAccent: '#000000',
  textDisabled: '#808080',
  textLink: '#5ec8f8',
  textDanger: '#ff6b5e',
  textWarning: '#ffb020',

  // Superficies interactivas
  surfaceInteractive: '#1a1a1a',
  surfaceInteractiveHover: '#2e2e2e',
  surfaceInteractivePressed: '#101010',
  surfaceInteractiveSelected: '#383838',
  surfaceDisabled: '#141414',

  // Bordes funcionales
  borderFocus: '#ffd60a',
  borderSelected: '#ffd60a',
  borderDisabled: '#4a4a4a',
  borderDanger: '#ff6b5e',

  // Overlays
  overlayScrim: 'rgba(0,0,0,0.7)',
  overlayStrong: 'rgba(0,0,0,0.85)',
  dangerSurface: '#1a0508',
  infoSurface: '#0a2033',

  // Juego
  gameDamage: '#ff6b5e',
  gameHealing: '#4ade80',
  gameShield: '#5ec8f8',
  gameGlory: '#ffd60a',
  gameCoin: '#ffb020',
  gameWound: '#ee4433',

  // Estado de conexión
  connectionOnline: '#4ade80',
  connectionOffline: '#ff6b5e',
  connectionReconnecting: '#ffb020',
  connectionStale: '#a8a8a8',
};

/** Monocromático: acentos y semánticos en escala de grises */
const MONOCHROME: Colors = {
  ...colors,
  accent: '#e8e8e8',
  accentDim: '#a0a0a0',
  primary: '#c0c0c0',
  primaryPressed: '#909090',
  success: '#d0d0d0',
  successPressed: '#a8a8a8',
  danger: '#f0f0f0',
  dangerPressed: '#b8b8b8',
  info: '#b0b0b0',
  warning: '#d8d8d8',

  // Todo funcional en escala de grises
  textOnAccent: '#1a1a1a',
  textDisabled: '#4a4a4a',
  textLink: '#b0b0b0',
  textDanger: '#f0f0f0',
  textWarning: '#d8d8d8',
  surfaceInteractive: '#2a2a2a',
  surfaceInteractiveHover: '#363636',
  surfaceInteractivePressed: '#1e1e1e',
  surfaceInteractiveSelected: '#404040',
  surfaceDisabled: '#222222',
  dangerSurface: '#2a2a2a',
  infoSurface: '#383838',
  borderFocus: '#e8e8e8',
  borderSelected: '#e8e8e8',
  borderDisabled: '#3a3a3a',
  borderDanger: '#f0f0f0',
  gameDamage: '#f0f0f0',
  gameHealing: '#d0d0d0',
  gameShield: '#b0b0b0',
  gameGlory: '#e8e8e8',
  gameCoin: '#d8d8d8',
  gameWound: '#b8b8b8',
  connectionOnline: '#d0d0d0',
  connectionOffline: '#f0f0f0',
  connectionReconnecting: '#d8d8d8',
  connectionStale: '#909090',
};

/**
 * Paletas para deficiencias de color: los semánticos se re-mapean a
 * azul/naranja (prot/deuteranopia-safe) o azul/rojo-verdoso (tritanopia).
 * Se complementan con `noColorOnly` (iconos + bordes, no solo color).
 */
const PROTANOPIA: Colors = {
  ...colors,
  danger: '#e69f00', dangerPressed: '#c78a00',
  success: '#56b4e9', successPressed: '#3a93c8',
  warning: '#f0e442',
  // Remapeos coherentes: peligro→naranja, éxito→azul
  textDanger: '#e69f00',
  textWarning: '#f0e442',
  borderDanger: '#e69f00',
  gameDamage: '#e69f00',
  gameHealing: '#56b4e9',
  gameWound: '#c78a00',
  connectionOnline: '#56b4e9',
  connectionOffline: '#e69f00',
  connectionReconnecting: '#f0e442',
};
const DEUTERANOPIA: Colors = {
  ...colors,
  danger: '#e69f00', dangerPressed: '#c78a00',
  success: '#56b4e9', successPressed: '#3a93c8',
  warning: '#f0e442',
  textDanger: '#e69f00',
  textWarning: '#f0e442',
  borderDanger: '#e69f00',
  gameDamage: '#e69f00',
  gameHealing: '#56b4e9',
  gameWound: '#c78a00',
  connectionOnline: '#56b4e9',
  connectionOffline: '#e69f00',
  connectionReconnecting: '#f0e442',
};
const TRITANOPIA: Colors = {
  ...colors,
  danger: '#d55e00', dangerPressed: '#b04e00',
  success: '#0072b2', successPressed: '#005a8f',
  warning: '#cc79a7',
  // Remapeos coherentes: peligro→rojo-verdoso, éxito→azul
  textDanger: '#d55e00',
  textWarning: '#cc79a7',
  borderDanger: '#d55e00',
  gameDamage: '#d55e00',
  gameHealing: '#0072b2',
  gameWound: '#b04e00',
  connectionOnline: '#0072b2',
  connectionOffline: '#d55e00',
  connectionReconnecting: '#cc79a7',
};

const COLOR_MODES = {
  protanopia: PROTANOPIA,
  deuteranopia: DEUTERANOPIA,
  tritanopia: TRITANOPIA,
  monochrome: MONOCHROME,
} as const;

/** Resuelve la paleta efectiva según ajustes (sin hooks — usable fuera de React) */
export function resolveColors(opts: { highContrast: boolean; colorMode: string }): Colors {
  if (opts.highContrast) return HIGH_CONTRAST;
  const mode = COLOR_MODES[opts.colorMode as keyof typeof COLOR_MODES];
  return mode ?? colors;
}
