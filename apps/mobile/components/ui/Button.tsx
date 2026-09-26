/**
 * Button — botón del sistema de diseño con todos los estados definidos:
 * default, pressed, disabled, loading. Una sola acción principal por
 * pantalla (`primary`); el resto son `secondary` o `ghost`.
 */

import { Pressable, Text, StyleSheet, type PressableProps } from 'react-native';
import { colors, spacing, radius, fontSize, touchTarget, type Colors } from '../../lib/theme';
import { useColors, useFontScale, useDensity, useControlHeight, useFontWeight, useFontFamily } from '../../lib/useTheme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  sublabel?: string;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
}

function makePalettes(c: Colors) {
  return {
    BG: {
      primary: c.accent,
      secondary: c.surfaceRaised,
      ghost: 'transparent',
      danger: c.danger,
    } as Record<Variant, string>,
    BG_PRESSED: {
      primary: c.accentDim,
      secondary: c.border,
      ghost: c.surface,
      danger: c.dangerPressed,
    } as Record<Variant, string>,
    FG: {
      primary: '#1a1a2e',
      secondary: c.text,
      ghost: c.textMuted,
      danger: '#fff',
    } as Record<Variant, string>,
  };
}

export function Button({
  label,
  sublabel,
  variant = 'secondary',
  loading = false,
  disabled = false,
  ...rest
}: ButtonProps) {
  const inactive = disabled || loading;
  // Preferencias de accesibilidad aplicadas al control
  const themedColors = useColors();
  const fontScale = useFontScale();
  const density = useDensity();
  const controlHeight = useControlHeight();
  const labelWeight = useFontWeight('bold');
  const fontFamily = useFontFamily();
  const { BG, BG_PRESSED, FG } = makePalettes(themedColors);
  return (
    <Pressable
      {...rest}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed && !inactive ? BG_PRESSED[variant] : BG[variant],
          minHeight: Math.max(controlHeight, touchTarget),
          paddingVertical: density(spacing.md),
          paddingHorizontal: density(spacing.lg),
        },
        variant === 'ghost' && [styles.ghost, { borderColor: themedColors.border }],
        inactive && styles.disabled,
      ]}
    >
      <Text style={[styles.label, { color: FG[variant], fontSize: fontSize.body * fontScale, fontWeight: labelWeight, fontFamily }]}>
        {loading ? 'Cargando…' : label}
      </Text>
      {sublabel != null && (
        <Text style={[styles.sublabel, { color: FG[variant], fontSize: fontSize.micro * fontScale, fontFamily }]}>{sublabel}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: fontSize.body,
    fontWeight: 'bold',
  },
  sublabel: {
    fontSize: fontSize.micro,
    marginTop: spacing.xs,
    opacity: 0.8,
  },
});
