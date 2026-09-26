/**
 * Tutorial — guía paso a paso básica.
 *
 * Cumple UI-220: tutorial paso a paso.
 * Cumple UI-221: explicación en contexto.
 * Cumple UI-222: controles de avance/retroceso/cerrar.
 */

import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';

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
              style={[styles.controlButton, isFirst && styles.disabledButton]}
            >
              <Text style={styles.controlText}>{t('panels.tutorialPrev')}</Text>
            </Pressable>
            <Pressable
              onPress={() => (isLast ? onClose() : setIndex(Math.min(steps.length - 1, index + 1)))}
              style={styles.controlButton}
            >
              <Text style={styles.controlText}>{isLast ? t('panels.tutorialFinish') : t('panels.tutorialNext')}</Text>
            </Pressable>
          </View>

          <Pressable onPress={onClose} style={styles.closeLink}>
            <Text style={styles.closeText}>{t('panels.tutorialClose')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 450,
  },
  stepCounter: {
    color: '#7f8c8d',
    fontSize: 11,
    marginBottom: 4,
  },
  title: {
    color: '#f1c40f',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  context: {
    color: '#3498db',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  body: {
    color: '#ecf0f1',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  controlButton: {
    backgroundColor: '#2980b9',
    padding: 10,
    borderRadius: 6,
    flex: 1,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: '#555',
  },
  controlText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  closeLink: {
    alignSelf: 'center',
    marginTop: 12,
  },
  closeText: {
    color: '#bdc3c7',
    fontSize: 12,
  },
});
