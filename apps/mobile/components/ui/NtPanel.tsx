/**
 * NtPanel — contenedor de superficie con elevación por niveles del tema.
 */

import { View, type ViewProps } from 'react-native';
// Side-effect: garantiza StyleSheet.configure antes del create de abajo
import '../../lib/unistyles';
import { StyleSheet } from 'react-native-unistyles';

interface NtPanelProps extends ViewProps {
  level?: 'surface' | 'raised' | 'popover' | 'modal';
  bordered?: boolean;
}

export function NtPanel({ level = 'surface', bordered = false, style, ...rest }: NtPanelProps) {
  styles.useVariants({ level, bordered });
  return <View style={[styles.panel, style]} {...rest} />;
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    variants: {
      level: {
        surface: { backgroundColor: theme.elevation.panel },
        raised: { backgroundColor: theme.elevation.card },
        popover: { backgroundColor: theme.elevation.popover },
        modal: { backgroundColor: theme.elevation.modal },
      },
      bordered: {
        true: { borderWidth: 1, borderColor: theme.colors.border },
        false: {},
      },
    },
  },
}));
