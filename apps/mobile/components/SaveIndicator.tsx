/**
 * SaveIndicator — indicador visual de guardado automático.
 *
 * Cumple UI-201: mostrar estado de guardado (guardando, guardado, error).
 */

import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors, useFs } from '../lib/useTheme';
import type { Colors } from '../lib/theme';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface SaveIndicatorProps {
  state: SaveState;
  lastSavedAt?: number;
}

const stateColors = (c: Colors): Record<SaveState, string> => ({
  idle: 'transparent',
  saving: c.warning,
  saved: c.success,
  error: c.danger,
});

export function SaveIndicator({ state, lastSavedAt }: SaveIndicatorProps) {
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(fs);
  const STATE_COLORS = stateColors(c);
  const STATE_LABELS: Record<SaveState, string> = {
    idle: '',
    saving: t('panels.saving'),
    saved: t('panels.saved'),
    error: t('panels.saveFailed'),
  };

  if (state === 'idle') return null;

  const timeText = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString()
    : undefined;

  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <Text style={[styles.text, { color: STATE_COLORS[state] }]}>
        {STATE_LABELS[state]}{timeText ? t('panels.savedAtTime', { time: timeText }) : ''}
      </Text>
    </View>
  );
}

const createStyles = (fs: (n: number) => number) => StyleSheet.create({
  container: {
    padding: 4,
    alignItems: 'center',
  },
  text: {
    fontSize: fs(11),
    fontStyle: 'italic',
  },
});
