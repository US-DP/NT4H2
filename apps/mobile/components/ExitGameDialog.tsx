/**
 * ExitGameDialog — confirma salir de la partida sin perder progreso.
 *
 * Cumple UI-024: distinguir entre salir (guardar y salir) y abandonar (perder progreso).
 */

import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';

interface ExitGameDialogProps {
  visible: boolean;
  hasUnsavedChanges: boolean;
  onSaveAndExit: () => void;
  onExitWithoutSaving: () => void;
  onAbandon: () => void;
  onCancel: () => void;
}

export function ExitGameDialog({
  visible,
  hasUnsavedChanges,
  onSaveAndExit,
  onExitWithoutSaving,
  onAbandon,
  onCancel,
}: ExitGameDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>Salir de la partida</Text>
          <Text style={styles.description}>
            {hasUnsavedChanges
              ? 'Tienes cambios sin guardar. ¿Qué quieres hacer?'
              : '¿Seguro que quieres salir?'}
          </Text>

          <View style={styles.actions}>
            {hasUnsavedChanges && (
              <Pressable style={[styles.button, styles.saveButton]} onPress={onSaveAndExit}>
                <Text style={styles.buttonText}>Guardar y salir</Text>
              </Pressable>
            )}

            <Pressable
              style={[styles.button, styles.exitButton]}
              onPress={hasUnsavedChanges ? onExitWithoutSaving : onSaveAndExit}
            >
              <Text style={styles.buttonText}>
                {hasUnsavedChanges ? 'Salir sin guardar' : 'Salir'}
              </Text>
            </Pressable>

            <Pressable style={[styles.button, styles.abandonButton]} onPress={onAbandon}>
              <Text style={styles.buttonText}>Abandonar partida</Text>
            </Pressable>

            <Pressable style={[styles.button, styles.cancelButton]} onPress={onCancel}>
              <Text style={styles.buttonText}>Cancelar</Text>
            </Pressable>
          </View>
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
    maxWidth: 380,
  },
  title: {
    color: '#f1c40f',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    color: '#ecf0f1',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  actions: {
    gap: 8,
  },
  button: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButton: {
    backgroundColor: '#27ae60',
  },
  exitButton: {
    backgroundColor: '#2980b9',
  },
  abandonButton: {
    backgroundColor: '#c0392b',
  },
  cancelButton: {
    backgroundColor: '#555',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
