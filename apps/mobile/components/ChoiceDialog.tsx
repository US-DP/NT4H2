/**
 * ChoiceDialog — diálogo para elecciones intermedias bloqueantes.
 *
 * Cumple UI-130: toda elección bloqueante aparece en diálogo inequívoco.
 * Cumple UI-131: el panel indica origen, persona, instrucción, opciones, mín/máx, omitir, tiempo.
 * Cumple UI-132: elecciones privadas no se muestran al resto.
 * Cumple UI-133: otros jugadores ven "Esperando una decisión de X".
 * Cumple UI-135: si no hay opción legal, no se bloquea.
 */

import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface ChoiceDialogProps {
  visible: boolean;
  /** Carta o regla que originó la elección */
  source: string;
  /** Persona que debe responder */
  decider: string;
  /** Instrucción concreta */
  instruction: string;
  options: ChoiceOption[];
  /** Selecciones mínimas */
  minSelections?: number;
  /** Selecciones máximas */
  maxSelections?: number;
  /** ¿Es una elección privada? */
  isPrivate?: boolean;
  /** ¿Se puede omitir? */
  canSkip?: boolean;
  /** Tiempo restante en segundos, si existe */
  timeRemaining?: number;
  /** El usuario actual no es el que decide (UI-133) */
  waitingForOther?: boolean;
  onSelect: (optionIds: string[]) => void;
  onSkip?: () => void;
  onClose?: () => void;
}

export function ChoiceDialog({
  visible,
  source,
  decider,
  instruction,
  options,
  minSelections = 1,
  maxSelections = 1,
  isPrivate = false,
  canSkip = false,
  timeRemaining,
  waitingForOther = false,
  onSelect,
  onSkip,
  onClose,
}: ChoiceDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string, disabled?: boolean) => {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= maxSelections) {
          if (maxSelections === 1) next.clear();
          else return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const validOptions = options.filter((o) => !o.disabled);
  const noLegalOption = validOptions.length === 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <View style={styles.header}>
            <Text style={styles.source}>{source}</Text>
            {isPrivate && <Text style={styles.privateBadge}>{t('panels.choicePrivate')}</Text>}
          </View>

          {waitingForOther ? (
            // UI-133: otros jugadores ven espera
            <Text style={styles.waitingText}>
              {t('panels.choiceWaiting', { decider })}
            </Text>
          ) : (
            <>
              <Text style={styles.decider}>{t('panels.choiceDecider', { decider })}</Text>
              <Text style={styles.instruction}>{instruction}</Text>

              {timeRemaining !== undefined && (
                <Text style={styles.timer}>{t('panels.choiceTimer', { seconds: timeRemaining })}</Text>
              )}

              <Text style={styles.selectionInfo}>
                {t('panels.choiceSelect', {
                  count: maxSelections,
                  range: minSelections !== maxSelections ? `${minSelections}-${maxSelections}` : `${minSelections}`,
                })}
              </Text>

              {noLegalOption ? (
                // UI-135: sin opción legal
                <View style={styles.noOption}>
                  <Text style={styles.noOptionText}>
                    {t('panels.choiceNoOptions')}
                  </Text>
                  <Pressable style={styles.noOptionButton} onPress={() => onSelect([])}>
                    <Text style={styles.buttonText}>{t('panels.choiceContinue')}</Text>
                  </Pressable>
                </View>
              ) : (
                <ScrollView style={styles.options}>
                  {options.map((opt) => (
                    <Pressable
                      key={opt.id}
                      onPress={() => toggle(opt.id, opt.disabled)}
                      disabled={opt.disabled}
                      style={[
                        styles.option,
                        selected.has(opt.id) && styles.optionSelected,
                        opt.disabled && styles.optionDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: selected.has(opt.id),
                        disabled: !!opt.disabled,
                      }}
                    >
                      <Text style={styles.optionLabel}>
                        {selected.has(opt.id) ? '☑ ' : '☐ '}{opt.label}
                      </Text>
                      {opt.description && (
                        <Text style={styles.optionDesc}>{opt.description}</Text>
                      )}
                      {opt.disabled && opt.disabledReason && (
                        <Text style={styles.optionReason}>{opt.disabledReason}</Text>
                      )}
                    </Pressable>
                  ))}
                </ScrollView>
              )}

              <View style={styles.actions}>
                {canSkip && onSkip && (
                  <Pressable style={styles.skipButton} onPress={onSkip}>
                    <Text style={styles.buttonText}>{t('panels.choiceSkip')}</Text>
                  </Pressable>
                )}
                {!noLegalOption && (
                  <Pressable
                    style={[styles.confirmButton, selected.size < minSelections && styles.confirmDisabled]}
                    onPress={() => onSelect(Array.from(selected))}
                    disabled={selected.size < minSelections}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: selected.size < minSelections }}
                  >
                    <Text style={styles.buttonText}>
                      {t('panels.choiceConfirm', { selected: selected.size, min: minSelections })}
                    </Text>
                  </Pressable>
                )}
                {onClose && (
                  <Pressable style={styles.closeButton} onPress={onClose}>
                    <Text style={styles.buttonText}>{t('panels.close')}</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  source: {
    color: '#f1c40f',
    fontSize: 14,
    fontWeight: 'bold',
  },
  privateBadge: {
    color: '#e74c3c',
    fontSize: 10,
    backgroundColor: '#3a1a1a',
    padding: 2,
    borderRadius: 3,
  },
  decider: {
    color: '#ecf0f1',
    fontSize: 12,
    marginBottom: 4,
  },
  instruction: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 8,
  },
  timer: {
    color: '#e74c3c',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  selectionInfo: {
    color: '#bdc3c7',
    fontSize: 11,
    marginBottom: 8,
  },
  waitingText: {
    color: '#ecf0f1',
    fontSize: 14,
    textAlign: 'center',
    padding: 20,
  },
  options: {
    maxHeight: 300,
    marginBottom: 12,
  },
  option: {
    backgroundColor: '#2c3e50',
    padding: 12,
    borderRadius: 6,
    marginBottom: 6,
    minHeight: 44,
  },
  optionSelected: {
    borderColor: '#f1c40f',
    borderWidth: 2,
    backgroundColor: '#3d3d20',
  },
  optionDisabled: {
    backgroundColor: '#555',
    opacity: 0.5,
  },
  optionLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  optionDesc: {
    color: '#bdc3c7',
    fontSize: 11,
    marginTop: 2,
  },
  optionReason: {
    color: '#e74c3c',
    fontSize: 10,
    marginTop: 2,
  },
  noOption: {
    alignItems: 'center',
    padding: 16,
  },
  noOptionButton: {
    backgroundColor: '#2980b9',
    padding: 10,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  noOptionText: {
    color: '#e74c3c',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  skipButton: {
    backgroundColor: '#7f8c8d',
    padding: 10,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  confirmButton: {
    backgroundColor: '#27ae60',
    padding: 10,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  confirmDisabled: {
    backgroundColor: '#3a5a47',
    opacity: 0.6,
  },
  closeButton: {
    backgroundColor: '#555',
    padding: 10,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
