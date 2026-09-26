/**
 * SaveIndicator — indicador visual de guardado automático.
 *
 * Cumple UI-201: mostrar estado de guardado (guardando, guardado, error).
 */

import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface SaveIndicatorProps {
  state: SaveState;
  lastSavedAt?: number;
}

const STATE_COLORS: Record<SaveState, string> = {
  idle: 'transparent',
  saving: '#f39c12',
  saved: '#27ae60',
  error: '#e74c3c',
};

export function SaveIndicator({ state, lastSavedAt }: SaveIndicatorProps) {
  const { t } = useTranslation();
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

const styles = StyleSheet.create({
  container: {
    padding: 4,
    alignItems: 'center',
  },
  text: {
    fontSize: 11,
    fontStyle: 'italic',
  },
});
