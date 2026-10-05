/**
 * Tutorial — guía paso a paso básica.
 *
 * Cumple UI-220: tutorial paso a paso.
 * Cumple UI-221: explicación en contexto.
 * Cumple UI-222: controles de avance/retroceso/cerrar.
 */

import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors, useFs } from '../lib/useTheme';
import type { Colors } from '../lib/theme';

interface TutorialStep {
  title: string;
  body: string;
  context?: string;
}

interface TutorialProps {
  steps: TutorialStep[];
  visible: boolean;
  /** Paso actual (controlado) */
  currentStep?: number;
  /** Cambio de paso */
  onStepChange?: (index: number) => void;
  onClose: () => void;
}

export function Tutorial({ steps, visible, currentStep = 0, onStepChange, onClose }: TutorialProps) {
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(c, fs);
  const index = currentStep;
  const setIndex = onStepChange ?? (() => {});

  if (!visible || steps.length === 0) return null;

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.stepCounter}>
            {t('panels.tutorialStep', { current: index + 1, total: steps.length })}
          </Text>
          <Text style={styles.title}>{step.title}</Text>
          {step.context && <Text style={styles.context}>{step.context}</Text>}
          <Text style={styles.body}>{step.body}</Text>

          <View style={styles.controls}>
            <Pressable
              onPress={() => setIndex(Math.max(0, index - 1))}
              disabled={isFirst}
              accessibilityRole="button"
              accessibilityState={{ disabled: isFirst }}
              style={[styles.controlButton, isFirst && styles.disabledButton]}
            >
              <Text style={styles.controlText}>{t('panels.tutorialPrev')}</Text>
            </Pressable>
            <Pressable
              onPress={() => (isLast ? onClose() : setIndex(Math.min(steps.length - 1, index + 1)))}
              accessibilityRole="button"
              style={styles.controlButton}
            >
              <Text style={styles.controlText}>{isLast ? t('panels.tutorialFinish') : t('panels.tutorialNext')}</Text>
            </Pressable>
          </View>

          <Pressable onPress={onClose} style={styles.closeLink} accessibilityRole="button">
            <Text style={styles.closeText}>{t('panels.tutorialClose')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: c.overlayStrong,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 450,
  },
  stepCounter: {
    color: c.textFaint,
    fontSize: fs(11),
    marginBottom: 4,
  },
  title: {
    color: c.accent,
    fontSize: fs(18),
    fontWeight: 'bold',
    marginBottom: 8,
  },
  context: {
    color: c.info,
    fontSize: fs(12),
    fontStyle: 'italic',
    marginBottom: 8,
  },
  body: {
    color: c.text,
    fontSize: fs(14),
    lineHeight: 20,
    marginBottom: 16,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  controlButton: {
    backgroundColor: c.accent,
    padding: 10,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 6,
    flex: 1,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: c.surfaceDisabled,
  },
  controlText: {
    color: c.textOnAccent,
    fontSize: fs(13),
    fontWeight: 'bold',
  },
  closeLink: {
    alignSelf: 'center',
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  closeText: {
    color: c.textMuted,
    fontSize: fs(12),
  },
});
