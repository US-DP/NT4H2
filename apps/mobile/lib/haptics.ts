/**
 * haptics — feedback táctil (solo nativo; en web es noop).
 *
 * Respeta los ajustes de accesibilidad: `hapticFeedback`, `vibration`
 * e `hapticIntensity` (off/light/medium/strong) del settingsStore.
 */

import { Platform } from 'react-native';
import type * as HapticsNS from 'expo-haptics';
import { useSettings } from '../store/settingsStore';

const isNative = Platform.OS !== 'web';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const haptics = () => require('expo-haptics') as typeof HapticsNS;

function enabled(): boolean {
  const s = useSettings.getState();
  return isNative && s.vibration && s.hapticFeedback && s.hapticIntensity !== 'off';
}

function intensityStyle() {
  const { ImpactFeedbackStyle } = haptics();
  switch (useSettings.getState().hapticIntensity) {
    case 'light': return ImpactFeedbackStyle.Light;
    case 'strong': return ImpactFeedbackStyle.Heavy;
    default: return ImpactFeedbackStyle.Medium;
  }
}

export function hapticSelect(): void {
  if (!enabled()) return;
  try {
    void haptics().impactAsync(haptics().ImpactFeedbackStyle.Light);
  } catch { /* módulo no disponible */ }
}

export function hapticPlay(): void {
  if (!enabled()) return;
  try {
    void haptics().impactAsync(intensityStyle());
  } catch { /* módulo no disponible */ }
}

export function hapticError(): void {
  if (!enabled()) return;
  try {
    void haptics().notificationAsync(haptics().NotificationFeedbackType.Error);
  } catch { /* módulo no disponible */ }
}
