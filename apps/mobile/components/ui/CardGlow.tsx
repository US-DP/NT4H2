/**
 * CardGlow — halo dorado tras la carta.
 *
 * En web se resuelve a CardGlow.web.tsx (Skia vía WithSkiaWeb).
 * Este archivo es el fallback para nativo y tests: halo animado
 * con Reanimated sin dependencias de GPU.
 */

import { CardGlowFallback } from './CardGlowFallback';

/** En nativo/tests: usa el fallback Reanimated (Skia solo en web). */
export function CardGlow({ size = 340 }: { size?: number }) {
  return <CardGlowFallback size={size} />;
}
