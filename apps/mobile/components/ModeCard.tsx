/**
 * ModeCard — tarjeta de modo de juego (icono, meta, descripción).
 * Compartida entre Inicio y la pantalla Jugar.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fontSize, radius, spacing } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';

interface ModeCardProps {
  icon: React.ReactNode;
  title: string;
  meta: string;
  description: string;
  onPress: () => void;
  loading?: boolean;
}

export function ModeCard({ icon, title, meta, description, onPress, loading }: ModeCardProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const fs = useFs();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={t('panels.modeCardA11y', { title, meta, description })}
      accessibilityState={{ busy: !!loading }}
      style={({ pressed }) => [
        styles.modeCard,
        {
          backgroundColor: colors.surface,
          borderColor: pressed ? colors.accent : colors.border,
        },
        pressed && styles.modeCardPressed,
        loading && { opacity: 0.6 },
      ]}
    >
      <View style={[styles.modeIcon, { backgroundColor: colors.surfaceRaised }]}>
        {loading ? <ActivityIndicator size="small" color={colors.accent} /> : icon}
      </View>
      <Text style={[styles.modeTitle, { color: colors.text, fontSize: fs(fontSize.section) }]}>
        {title}
      </Text>
      <Text style={[styles.modeMeta, { color: colors.accent, fontSize: fs(fontSize.detail) }]}>
        {meta}
      </Text>
      <Text style={[styles.modeDesc, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}>
        {description}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modeCard: {
    flexGrow: 1,
    flexBasis: 240,
    maxWidth: 340,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.xs,
    minHeight: 148,
  },
  modeCardPressed: {
    transform: [{ translateY: -2 }],
  },
  modeIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  modeTitle: {
    fontWeight: '700',
  },
  modeMeta: {
    fontWeight: '600',
  },
  modeDesc: {},
});
