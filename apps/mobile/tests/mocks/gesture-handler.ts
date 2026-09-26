/**
 * Mock de react-native-gesture-handler para tests.
 * Los detectores devuelven un objeto no-op; GestureDetector renderiza
 * a sus children directamente.
 */

import { View } from 'react-native';

const makeGesture = () => {
  const g: Record<string, unknown> = {};
  const chain = () => g;
  for (const m of [
    'onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize', 'onTouchesDown',
    'onTouchesMove', 'onTouchesUp', 'onTouchesCancelled', 'enabled', 'minDistance',
    'maxDistance', 'numberOfTaps', 'maxDurationMs', 'minPointers', 'maxPointers',
    'activeOffsetX', 'activeOffsetY', 'failOffsetX', 'failOffsetY', 'hitSlop',
    'requireExternalGestureToFail', 'simultaneousWithExternalGesture',
    'runOnJS', 'withTestId', 'cancelsTouchesInView', 'shouldCancelWhenOutside',
  ]) {
    g[m] = chain;
  }
  return g;
};

export const Gesture = {
  Pan: makeGesture,
  Tap: makeGesture,
  LongPress: makeGesture,
  Pinch: makeGesture,
  Rotation: makeGesture,
  Fling: makeGesture,
  ForceTouch: makeGesture,
  Hover: makeGesture,
  Native: makeGesture,
  Manual: makeGesture,
  Race: (...gs: unknown[]) => gs[0],
  Simultaneous: (...gs: unknown[]) => gs[0],
  Exclusive: (...gs: unknown[]) => gs[0],
};

export const GestureDetector = ({ children }: { children?: unknown }) =>
  (children as never) ?? null;

export const GestureHandlerRootView = View;
export const State = {};
export const Directions = {};
export const gestureHandlerRootHOC = (c: unknown) => c;
export default {};
