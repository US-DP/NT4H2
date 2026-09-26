/**
 * CardGlow (web) — carga diferida de Skia vía WithSkiaWeb.
 *
 * El wasm de canvaskit se sirve desde public/ (ver metro.config.js);
 * locateFile apunta a '/canvaskit.wasm'. Si Skia no carga, se usa el
 * fallback animado con Reanimated.
 */

import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { CardGlowFallback } from './CardGlowFallback';

interface Props {
  size?: number;
}

export function CardGlow({ size = 340 }: Props) {
  return (
    <WithSkiaWeb
      getComponent={() => import('./CardGlowSkia.web')}
      opts={{ locateFile: (file: string) => `/${file}` }}
      fallback={<CardGlowFallback size={size} />}
    />
  );
}
