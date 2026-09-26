/**
 * a11y — anuncios por lector de pantalla (ajuste `srAnnounceState`).
 *
 * En web los `accessibilityLiveRegion` de las vistas ya cubren los cambios
 * estructurales; `announceForAccessibility` solo existe en nativo, por lo
 * que en web la función es no-op.
 */

import { AccessibilityInfo, Platform } from 'react-native';
import { useSettings } from '../store/settingsStore';

/** Anuncia un mensaje al lector de pantalla si el ajuste está activo. */
export function announceA11y(msg: string): void {
  if (!msg) return;
  if (!useSettings.getState().srAnnounceState) return;
  if (Platform.OS === 'web') return;
  try {
    void AccessibilityInfo.announceForAccessibility(msg);
  } catch { /* lector no disponible */ }
}
