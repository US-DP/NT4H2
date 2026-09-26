/**
 * NtButton — botón del sistema NT4H sobre Unistyles.
 *
 * Variantes semánticas (primary/danger/ghost/secondary), tamaño accesible
 * garantizado (44px mínimo) y estados pressed/disabled declarativos.
 * Los estilos se resuelven en el hilo nativo y respetan el tema activo
 * (incluido highContrast) sin lógica en el componente.
 */

import { Pressable, Text, type PressableProps } from 'react-native';
// Side-effect: garantiza StyleSheet.configure antes del create de abajo
import '../../lib/unistyles';
import { StyleSheet } from 'react-native-unistyles';
import { useExtraTextSpacing } from '../../lib/useTheme';
import { typeScale } from '../../lib/theme';

export type NtButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type NtButtonSize = 'sm' | 'md' | 'lg';

export interface NtButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: NtButtonVariant;
  size?: NtButtonSize;
  disabled?: boolean;
}

export function NtButton({ label, variant = 'primary', size = 'md', disabled, ...rest }: NtButtonProps) {
  styles.useVariants({ variant, size, disabled: !!disabled });
  // extraTextSpacing: más interlineado + tracking en las etiquetas
  const spacing = useExtraTextSpacing();
  const labelExtra = spacing.letterSpacing !== 0
    ? {
        letterSpacing: spacing.letterSpacing,
        lineHeight: Math.round(typeScale.button.line * spacing.lineHeightFactor / 1.2),
      }
    : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [styles.button, pressed && !disabled && styles.pressed]}
      {...rest}
    >
      <Text style={[styles.label, labelExtra]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    variants: {
      variant: {
        primary: { backgroundColor: theme.colors.accent },
        secondary: {
          backgroundColor: theme.tokens.bg.raised,
          borderColor: theme.colors.border,
        },
        danger: { backgroundColor: theme.colors.danger },
        ghost: { backgroundColor: 'transparent' },
      },
      size: {
        sm: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
        md: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
        lg: { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md },
      },
      disabled: {
        true: { opacity: 0.45 },
        false: {},
      },
    },
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    fontSize: theme.typeScale.button.size,
    lineHeight: theme.typeScale.button.line,
    fontWeight: '600',
    color: theme.tokens.text.primary,
    variants: {
      variant: {
        primary: { color: theme.tokens.text.inverse },
        secondary: {},
        danger: { color: '#ffffff' },
        ghost: { color: theme.colors.accent },
      },
    },
  },
}));
