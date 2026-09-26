/**
 * CardGlowSkia — halo dorado con Skia (GPU).
 *
 * Solo se carga en web a través de WithSkiaWeb (import lazy), por eso
 * puede usar la API completa de Skia sin afectar a tests ni a nativo.
 * El pulso de opacidad lo da el Animated.View externo (Reanimated).
 */

import {
  Canvas, Circle, RadialGradient, SweepGradient, BlurMask, vec,
} from '@shopify/react-native-skia';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';

interface Props {
  size?: number;
}

export default function CardGlowSkia({ size = 340 }: Props) {
  const opacity = useSharedValue(0.5);
  opacity.value = withRepeat(
    withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
    -1,
    true,
  );
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const c = vec(size / 2, size / 2);

  return (
    <Animated.View style={[{ width: size, height: size }, pulse]}>
      <Canvas style={{ width: size, height: size }}>
        {/* Anillo dorado con gradiente cónico */}
        <Circle cx={c.x} cy={c.y} r={size * 0.44}>
          <SweepGradient
            c={c}
            colors={['transparent', '#f1c40f', '#ffe98a', 'transparent']}
          />
          <BlurMask blur={10} style="normal" />
        </Circle>
        {/* Resplandor radial central */}
        <Circle cx={c.x} cy={c.y} r={size * 0.46}>
          <RadialGradient
            c={c}
            r={size * 0.46}
            colors={['rgba(241,196,15,0.4)', 'rgba(241,196,15,0.12)', 'transparent']}
          />
        </Circle>
      </Canvas>
    </Animated.View>
  );
}
