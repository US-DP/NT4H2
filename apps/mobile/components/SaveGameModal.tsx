/**
 * SaveGameModal — diálogo para nombrar y guardar la partida local.
 *
 * Extraído de app/(game)/index.tsx para reducir la responsabilidad
 * de la pantalla (composición sobre lógica embebida).
 */

import { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, fontSize } from '../lib/theme';

interface SaveGameModalProps {
  visible: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export function SaveGameModal({ visible, onSave, onCancel }: SaveGameModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');

  const close = () => {
    setName('');
    onCancel();
  };

  const confirm = () => {
    onSave(name);
    setName('');
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>{t('panels.saveTitle')}</Text>
          <TextInput
            style={styles.modalInput}
            value={name}
            onChangeText={setName}
            placeholder={t('panels.saveNamePlaceholder')}
            placeholderTextColor="#777"
            accessibilityLabel={t('panels.saveNamePlaceholder')}
          />
          <View style={styles.modalActions}>
            <Pressable
              style={[styles.modalButton, styles.modalButtonCancel]}
              onPress={close}
              accessibilityRole="button"
            >
              <Text style={styles.modalButtonText}>{t('panels.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.modalButton, styles.modalButtonOk]}
              onPress={confirm}
              accessibilityRole="button"
            >
              <Text style={styles.modalButtonText}>{t('panels.save')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.xl,
    width: '80%',
    maxWidth: 340,
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.section,
    fontWeight: 'bold',
    marginBottom: spacing.md,
  },
  modalInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.lg,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modalButton: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: colors.surface,
  },
  modalButtonOk: {
    backgroundColor: colors.success,
  },
  modalButtonText: {
    color: colors.text,
    fontWeight: 'bold',
  },
});
