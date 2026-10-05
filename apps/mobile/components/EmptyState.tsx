/**
 * EmptyState — estado vacío con guía al siguiente paso.
 *
 * Cumple UI-350: una biblioteca/zona vacía muestra qué debería aparecer,
 *                cómo crear el primero, cómo importar, enlace a ayuda.
 *
 * Toda la paleta y tipografía vienen del tema (useColors/useFs): respeta
 * alto contraste, daltonismo y escala de fuente del usuario.
 */

import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { NtButton } from './ui/NtButton';
import { fontSize, spacing, type Colors } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';

interface EmptyStateProps {
  title: string;
  description: string;
  /** Acción principal: "Crear el primero" */
  primaryAction?: { label: string; onPress: () => void };
  /** Acción secundaria: "Importar" */
  secondaryAction?: { label: string; onPress: () => void };
  /** Enlace a ayuda */
  helpAction?: { label: string; onPress: () => void };
  /** Contenido en carga: muestra spinner en lugar de acciones */
  loading?: boolean;
}

export function EmptyState({
  title,
  description,
  primaryAction,
  secondaryAction,
  helpAction,
  loading,
}: EmptyStateProps) {
  const c = useColors();
  const fs = useFs();
  const styles = createStyles(c, fs);
  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {loading ? (
        <ActivityIndicator size="large" color={c.accent} />
      ) : (
        <View style={styles.actions}>
          {primaryAction && (
            <NtButton label={primaryAction.label} onPress={primaryAction.onPress} variant="primary" />
          )}
          {secondaryAction && (
            <NtButton label={secondaryAction.label} onPress={secondaryAction.onPress} variant="secondary" />
          )}
          {helpAction && (
            <NtButton label={helpAction.label} onPress={helpAction.onPress} variant="ghost" size="sm" />
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: c.accent,
    fontSize: fs(fontSize.section),
    fontWeight: 'bold',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  description: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  actions: {
    gap: spacing.sm,
    alignItems: 'center',
    alignSelf: 'stretch',
    maxWidth: 320,
  },
});
