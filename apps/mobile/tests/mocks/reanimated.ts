/**
 * Mock de react-native-reanimated para tests.
 * Los componentes usan Animated.View + useSharedValue/useAnimatedStyle;
 * aquí devolvemos los componentes nativos tal cual y estilos estáticos.
 */

import { View } from 'react-native';

export const useSharedValue = <T,>(initial: T) => ({ value: initial });
export const useAnimatedStyle = (fn: () => unknown) => fn();
export const useAnimatedProps = (fn: () => unknown) => fn();
export const useDerivedValue = (fn: () => unknown) => ({ value: fn() });
export const useAnimatedGestureHandler = () => ({});

export const withTiming = <T,>(toValue: T) => toValue;
export const withSpring = <T,>(toValue: T) => toValue;
export const withSequence = (...args: unknown[]) => args[args.length - 1];
export const withRepeat = <T,>(animation: T) => animation;
export const withDelay = <T,>(_delay: number, animation: T) => animation;
export const cancelAnimation = () => {};
export const Easing = {
  linear: (x: number) => x,
  ease: (x: number) => x,
  inOut: (e: unknown) => e,
  out: (e: unknown) => e,
  in: (e: unknown) => e,
  bezier: () => (x: number) => x,
  quad: {}, circle: {}, bounce: {}, elastic: {},
};

// Animaciones de entrada/salida: objeto encadenable con .duration/.delay/.springify
const makeEntering = () => {
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get: (t, prop) => {
      if (prop in t) return t[prop as string];
      const fn = () => self;
      (t as Record<string, unknown>)[prop as string] = fn;
      return fn;
    },
  });
  return self;
};
export const FadeIn = makeEntering();
export const FadeOut = makeEntering();
export const SlideInRight = makeEntering();
export const SlideOutLeft = makeEntering();
export const ZoomIn = makeEntering();
export const ZoomOut = makeEntering();

export const interpolate = <T,>(_v: T, _i: unknown[], o: unknown[]) => o[0];
export const runOnJS = (fn: unknown) => fn;
export const runOnUI = (fn: unknown) => fn;

const AnimatedView = View;
const Animated = {
  View: AnimatedView,
  createAnimatedComponent: (c: unknown) => c,
};

export default Animated;
export { AnimatedView as View };
export const createAnimatedComponent = (c: unknown) => c;
