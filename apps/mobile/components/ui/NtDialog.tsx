/**
 * NtDialog — diálogo modal accesible del sistema NT4H.
 *
 * Para decisiones que NO pueden descartarse con un gesto (puja de Líder,
 * confirmaciones críticas, conflictos de guardado). Las hojas inferiores
 * (NtBottomSheet) son solo para contenido descartable.
 */

import { Modal, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
// Side-effect: garantiza StyleSheet.configure antes del create de abajo
import '../../lib/unistyles';
import { StyleSheet } from 'react-native-unistyles';
import { NtButton, type NtButtonVariant } from './NtButton';
import { HoldConfirmButton } from './HoldConfirmButton';

export interface NtDialogAction {
  label: string;
  onPress: () => void;
  variant?: NtButtonVariant;
  accessibilityHint?: string;
  /** Acción irreversible: con el ajuste holdToConfirm exige mantener pulsado. */
  hold?: boolean;
}

interface NtDialogProps {
  visible: boolean;
  title: string;
  description?: string;
  actions: NtDialogAction[];
  /** Acción al pulsar fuera / botón atrás. Si undefined, no se puede cerrar por fuera. */
  onDismiss?: () => void;
  children?: React.ReactNode;
}

export function NtDialog({ visible, title, description, actions, onDismiss, children }: NtDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss ?? (() => {})}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.overlay}
        onPress={onDismiss}
        accessibilityLabel={onDismiss ? t('common.a11y.closeDialog') : undefined}
        accessibilityRole={onDismiss ? 'button' : 'none'}
      >
        {/* El diálogo intercepta su propia pulsación para no cerrarse —
            View + responder (un Pressable sin acción es un "botón" falso
            que roba rol y foco a los lectores de pantalla). */}
        <View
          style={styles.dialog}
          accessibilityLabel={title}
          onStartShouldSetResponder={() => true}
        >
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
          {children}
          <View style={styles.actions}>
            {actions.map((a) => {
              const Btn = a.hold ? HoldConfirmButton : NtButton;
              return (
                <Btn
                  key={a.label}
                  label={a.label}
                  variant={a.variant ?? 'secondary'}
                  size="sm"
                  onPress={a.onPress}
                  accessibilityHint={a.accessibilityHint}
                />
              );
            })}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    flex: 1,
    backgroundColor: theme.tokens.bg.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  dialog: {
    backgroundColor: theme.elevation.modal,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.xl,
    minWidth: 280,
    maxWidth: 420,
    gap: theme.spacing.md,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typeScale.title.size,
    fontWeight: '700',
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: theme.typeScale.bodySm.size,
    lineHeight: theme.typeScale.bodySm.line,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
}));
