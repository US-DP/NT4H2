/**
 * EmptyState — estado vacío con guía al siguiente paso.
 *
 * Cumple UI-350: una biblioteca/zona vacía muestra qué debería aparecer,
 *                cómo crear el primero, cómo importar, enlace a ayuda.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';

interface EmptyStateProps {
  title: string;
  description: string;
  /** Acción principal: "Crear el primero" */
  primaryAction?: { label: string; onPress: () => void };
  /** Acción secundaria: "Importar" */
  secondaryAction?: { label: string; onPress: () => void };
  /** Enlace a ayuda */
  helpAction?: { label: string; onPress: () => void };
}

export function EmptyState({
  title,
  description,
  primaryAction,
  secondaryAction,
  helpAction,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <View style={styles.actions}>
        {primaryAction && (
          <Pressable style={styles.primaryButton} onPress={primaryAction.onPress} accessibilityRole="button">
            <Text style={styles.primaryText}>{primaryAction.label}</Text>
          </Pressable>
        )}
        {secondaryAction && (
          <Pressable style={styles.secondaryButton} onPress={secondaryAction.onPress} accessibilityRole="button">
            <Text style={styles.secondaryText}>{secondaryAction.label}</Text>
          </Pressable>
        )}
        {helpAction && (
          <Pressable style={styles.helpButton} onPress={helpAction.onPress} accessibilityRole="link">
            <Text style={styles.helpText}>{helpAction.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#f1c40f',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    color: '#bdc3c7',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  actions: {
    gap: 8,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#2980b9',
    padding: 12,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: '#27ae60',
    padding: 12,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
  },
  secondaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  helpButton: {
    padding: 8,
  },
  helpText: {
    color: '#3498db',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});
