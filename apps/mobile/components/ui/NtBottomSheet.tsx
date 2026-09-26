/**
 * NtBottomSheet — hoja inferior con estética NT4H sobre @gorhom/bottom-sheet.
 *
 * Pensado para contenido NO crítico que puede descartarse: detalle de carta,
 * filtros, historial, índice del reglamento. Para decisiones obligatorias
 * (puja de Líder, confirmaciones críticas) usar pantalla completa o diálogo.
 */

import { forwardRef, useCallback, useMemo } from 'react';
import { Text, View } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
// Side-effect: garantiza StyleSheet.configure antes del create de abajo
import '../../lib/unistyles';
import { StyleSheet } from 'react-native-unistyles';

interface NtBottomSheetProps {
  /** Referencia al BottomSheetModal (present/dismiss) */
  children: React.ReactNode;
  /** Título opcional en la cabecera de la hoja */
  title?: string;
  /** Snap points (porcentajes o px). Por defecto ['55%', '85%'] */
  snapPoints?: (string | number)[];
  onDismiss?: () => void;
}

export const NtBottomSheet = forwardRef<BottomSheetModal, NtBottomSheetProps>(
  function NtBottomSheet({ children, title, snapPoints, onDismiss }, ref) {
    const snaps = useMemo(() => snapPoints ?? ['55%', '85%'], [snapPoints]);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.6}
          pressBehavior="close"
        />
      ),
      [],
    );

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snaps}
        backdropComponent={renderBackdrop}
        onDismiss={onDismiss}
        backgroundStyle={styles.background}
        handleIndicatorStyle={styles.handle}
        accessibilityViewIsModal
      >
        <View style={styles.content}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          <BottomSheetScrollView>{children}</BottomSheetScrollView>
        </View>
      </BottomSheetModal>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  background: {
    backgroundColor: theme.elevation.modal,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  handle: {
    backgroundColor: theme.colors.textFaint,
  },
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typeScale.h3.size,
    fontWeight: '700',
    marginBottom: theme.spacing.md,
  },
}));
