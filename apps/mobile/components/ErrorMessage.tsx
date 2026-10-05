/**
 * ErrorMessage — mensajes de error clasificados con acción recuperable.
 *
 * Cumple UI-P05: explicar qué falló, por qué, qué falta, cómo corregir.
 * Cumple UI-003: estados con icono y texto.
 * Cumple UI-354: clasificar errores (validación, conexión, permisos, etc.).
 * Cumple UI-355: acción recuperable (reintentar, corregir, volver, etc.).
 * Cumple UI-356: no mostrar trazas internas al usuario normal.
 *
 * Paleta/tipografía del tema (useColors/useFs): respeta alto contraste,
 * daltonismo y escala de fuente. Iconos lucide en lugar de glyphs Unicode
 * (identidad estable en cualquier SO/navegador).
 */

import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { XCircle, TriangleAlert, Lock, Database, FileWarning } from 'lucide-react-native';
import '../lib/i18n';
import { fontSize, spacing, radius, touchTarget, type Colors } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';

export type ErrorCategory =
  | 'validation'
  | 'connection'
  | 'permissions'
  | 'compatibility'
  | 'server'
  | 'storage'
  | 'content';

export interface ErrorAction {
  label: string;
  onPress: () => void;
}

interface ErrorMessageProps {
  category: ErrorCategory;
  /** Qué acción falló */
  action: string;
  /** Por qué no puede realizarse */
  reason: string;
  /** Cómo puede corregirse */
  fix?: string;
  actions?: ErrorAction[];
}

type IconComponent = typeof XCircle;

const CATEGORY_ICON: Record<ErrorCategory, IconComponent> = {
  validation: XCircle,
  connection: TriangleAlert,
  permissions: Lock,
  compatibility: TriangleAlert,
  server: XCircle,
  storage: Database,
  content: FileWarning,
};

/** Severidad por categoría → color semántico del tema */
const CATEGORY_TONE: Record<ErrorCategory, 'danger' | 'warning' | 'info'> = {
  validation: 'danger',
  connection: 'warning',
  permissions: 'info',
  compatibility: 'warning',
  server: 'danger',
  storage: 'warning',
  content: 'warning',
};

export function ErrorMessage({ category, action, reason, fix, actions }: ErrorMessageProps) {
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  const styles = createStyles(c, fs);
  const Icon = CATEGORY_ICON[category];
  const tone = c[CATEGORY_TONE[category]];
  const label = t(`common.err.${category}`);
  const hiddenA11y =
    Platform.OS !== 'web'
      ? { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const }
      : {};

  return (
    <View
      style={[styles.container, { borderColor: tone }]}
      accessibilityRole="alert"
      accessibilityLabel={t('common.err.a11y', { label, action, reason, fix: fix ?? '' })}
    >
      <View style={styles.header}>
        <Icon size={fs(18)} color={tone} {...hiddenA11y} />
        <Text style={styles.categoryLabel}>{label}</Text>
      </View>
      <Text style={styles.action}>{t('common.err.action', { action })}</Text>
      <Text style={[styles.reason, { color: tone }]}>{reason}</Text>
      {fix && <Text style={styles.fix}>{t('common.err.fix', { fix })}</Text>}
      {actions && actions.length > 0 && (
        <View style={styles.actions}>
          {actions.map((a, i) => (
            <Pressable
              key={i}
              onPress={a.onPress}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && { backgroundColor: c.border },
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: spacing.md,
    margin: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  categoryLabel: {
    color: c.text,
    fontSize: fs(fontSize.detail),
    fontWeight: 'bold',
  },
  action: {
    color: c.text,
    fontSize: fs(fontSize.detail),
    marginBottom: 2,
  },
  reason: {
    fontSize: fs(fontSize.detail),
    marginBottom: 2,
  },
  fix: {
    color: c.success,
    fontSize: fs(fontSize.detail),
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  actionButton: {
    backgroundColor: c.surfaceRaised,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    minHeight: touchTarget,
    justifyContent: 'center',
  },
  actionText: {
    color: c.text,
    fontSize: fs(fontSize.detail),
    fontWeight: 'bold',
  },
});
