/**
 * NtRadioGroup — grupo de opciones excluyentes accesible.
 * Alternativa visible a gestos: cada opción es un Pressable con rol radio.
 */

import { Pressable, Text, View } from 'react-native';
// Side-effect: garantiza StyleSheet.configure antes del create de abajo
import '../../lib/unistyles';
import { StyleSheet } from 'react-native-unistyles';

export interface NtRadioOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface NtRadioGroupProps<T extends string> {
  label: string;
  options: NtRadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function NtRadioGroup<T extends string>({ label, options, value, onChange }: NtRadioGroupProps<T>) {
  return (
    <View accessibilityLabel={label} style={styles.group}>
      <Text style={styles.label} accessibilityRole="header">{label}</Text>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
            onPress={() => onChange(opt.value)}
            style={[styles.option, selected && styles.selected]}
          >
            <View style={[styles.dot, selected && styles.dotSelected]} />
            <View style={styles.texts}>
              <Text style={styles.optionLabel}>{opt.label}</Text>
              {opt.description ? <Text style={styles.optionDesc}>{opt.description}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  group: { gap: theme.spacing.xs },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.typeScale.caption.size,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: theme.spacing.xs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.tokens.bg.raised,
  },
  selected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.elevation.selected,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: theme.colors.textMuted,
  },
  dotSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  texts: { flex: 1 },
  optionLabel: { color: theme.colors.text, fontSize: theme.typeScale.body.size },
  optionDesc: { color: theme.colors.textMuted, fontSize: theme.typeScale.caption.size },
}));
