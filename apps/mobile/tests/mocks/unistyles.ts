/**
 * Mock de react-native-unistyles para tests.
 * StyleSheet.create devuelve objetos de estilo vacíos; useVariants no-op.
 */

const styleProxy = new Proxy(
  { useVariants: () => {} },
  {
    get: (target, key: string | symbol) => {
      if (key === 'useVariants') return target.useVariants;
      if (key === 'absoluteFill') return { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };
      if (key === 'hairlineWidth') return 1;
      return {};
    },
  },
);

export const StyleSheet = {
  create: (_styles: unknown) => styleProxy,
  configure: () => {},
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hairlineWidth: 1,
};

export const UnistylesRuntime = {
  themeName: 'nt4h',
  breakpoint: 'sm',
  screen: { width: 1024, height: 768 },
  setTheme: () => {},
  setAdaptiveThemes: () => {},
  hasAdaptiveThemes: false,
  colorScheme: 'dark',
};

export const useInitialTheme = () => {};
export const useUnistyles = () => ({ rt: UnistylesRuntime, theme: {} });
export const withUnistyles = (c: unknown) => c;
export const Display = { name: 'Display' };
