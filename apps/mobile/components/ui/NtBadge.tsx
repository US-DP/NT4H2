/**
 * NtBadge — insignia de estado semántico (recursos, estados de enemigo, fases).
 */

import { View, Text } from 'react-native';
// Side-effect: garantiza StyleSheet.configure antes del create de abajo
import '../../lib/unistyles';
import { StyleSheet } from 'react-native-unistyles';

export type NtBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function NtBadge({ label, tone = 'neutral' }: { label: string; tone?: NtBadgeTone }) {
  styles.useVariants({ tone });
  return (
    <View style={styles.badge} accessibilityRole="text">
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    variants: {
      tone: {
        neutral: {
          backgroundColor: theme.tokens.bg.raised,
          borderColor: theme.colors.border,
        },
        success: {
          backgroundColor: 'rgba(39,174,96,0.15)',
          borderColor: theme.colors.success,
        },
        warning: {
          backgroundColor: 'rgba(243,156,18,0.15)',
          borderColor: theme.colors.warning,
        },
        danger: {
          backgroundColor: 'rgba(231,76,60,0.15)',
          borderColor: theme.colors.danger,
        },
        info: {
          backgroundColor: 'rgba(52,152,219,0.15)',
          borderColor: theme.colors.info,
        },
        accent: {
          backgroundColor: 'rgba(241,196,15,0.15)',
          borderColor: theme.colors.accent,
        },
      },
    },
  },
  text: {
    fontSize: theme.fontSize.micro,
    fontWeight: '600',
    color: theme.colors.text,
  },
}));
