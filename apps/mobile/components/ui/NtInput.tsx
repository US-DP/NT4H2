/**
 * NtInput — campo de texto con etiqueta, error y foco accesible.
 */

import { useState } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';
// Side-effect: garantiza StyleSheet.configure antes del create de abajo
import '../../lib/unistyles';
import { StyleSheet } from 'react-native-unistyles';

interface NtInputProps extends TextInputProps {
  label: string;
  error?: string;
}

export function NtInput({ label, error, ...rest }: NtInputProps) {
  const [focused, setFocused] = useState(false);
  styles.useVariants({ focused, hasError: !!error });
  return (
    <View style={styles.wrap}>
      <Text style={styles.label} accessibilityRole="text">{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor="#6b7280"
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
        accessibilityLabel={label}
        {...rest}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.xs },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.typeScale.caption.size,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: theme.tokens.bg.raised,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    fontSize: theme.typeScale.body.size,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    minHeight: theme.touchTarget,
    variants: {
      focused: {
        true: { borderColor: theme.colors.accent },
        false: { borderColor: theme.colors.border },
      },
      hasError: {
        true: { borderColor: theme.colors.danger },
        false: {},
      },
    },
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typeScale.caption.size,
  },
}));
