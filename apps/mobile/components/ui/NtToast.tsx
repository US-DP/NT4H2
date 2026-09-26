/**
 * NtToast — notificaciones efímeras no invasivas.
 *
 * Regla de uso: SOLO para feedback fuera del flujo del juego
 * ("Partida guardada", "Código copiado", "Filtros restablecidos").
 * NUNCA para eventos de partida — esos van al campo y al historial.
 *
 *   import { toast } from '../../lib/toast';
 *   toast.show('Partida guardada');
 *
 * El host (`NtToastHost`) se monta una vez en el layout raíz.
 */

import { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming,
} from 'react-native-reanimated';
// Side-effect: garantiza StyleSheet.configure antes del create de abajo
import '../../lib/unistyles';
import { StyleSheet } from 'react-native-unistyles';
import { useToastStore } from '../../lib/toast';

export function NtToastHost() {
  const { t } = useTranslation();
  const current = useToastStore((s) => s.current);
  const dismiss = useToastStore((s) => s.dismiss);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(current ? 1 : 0, { duration: 160 });
  }, [current, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: (1 - opacity.value) * -10 }],
  }));

  if (!current) return null;
  return (
    <Animated.View
      style={[styles.toast, style]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Text style={styles.text}>{current.message}</Text>
      {current.action ? (
        <Pressable onPress={current.action.onPress} accessibilityRole="button">
          <Text style={styles.action}>{current.action.label}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={dismiss} accessibilityLabel={t('common.a11y.dismissToast')} accessibilityRole="button">
        <Text style={styles.close}>✕</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  toast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.elevation.popover,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    zIndex: 9999,
  },
  text: {
    color: theme.colors.text,
    fontSize: theme.typeScale.bodySm.size,
  },
  action: {
    color: theme.colors.accent,
    fontSize: theme.typeScale.bodySm.size,
    fontWeight: '700',
  },
  close: {
    color: theme.colors.textMuted,
    fontSize: theme.typeScale.bodySm.size,
  },
}));
