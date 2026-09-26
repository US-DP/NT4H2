/**
 * CardGlowFallback — halo dorado animado con Reanimated.
 *
 * Usado cuando Skia no está disponible (nativo, tests o si el wasm
 * de canvaskit no carga en web).
 */

import { StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';

export function CardGlowFallback({ size = 340 }: { size?: number }) {
  const opacity = useSharedValue(0.35);
  opacity.value = withRepeat(
    withTiming(0.7, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
    -1,
    true,
  );
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        styles.glow,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          shadowRadius: size / 4,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  glow: {
    backgroundColor: 'transparent',
    shadowColor: '#f1c40f',
    shadowOpacity: 0.8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
    pointerEvents: 'none',
  },
});
