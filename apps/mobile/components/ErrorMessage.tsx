/**
 * ErrorMessage — mensajes de error clasificados con acción recuperable.
 *
 * Cumple UI-P05: explicar qué falló, por qué, qué falta, cómo corregir.
 * Cumple UI-003: estados con icono y texto.
 * Cumple UI-354: clasificar errores (validación, conexión, permisos, etc.).
 * Cumple UI-355: acción recuperable (reintentar, corregir, volver, etc.).
 * Cumple UI-356: no mostrar trazas internas al usuario normal.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';

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

const CATEGORY_CONFIG: Record<ErrorCategory, { icon: string; color: string; label: string }> = {
  validation: { icon: '✕', color: '#e74c3c', label: 'Error de validación' },
  connection: { icon: '⚠', color: '#f39c12', label: 'Error de conexión' },
  permissions: { icon: '🔒', color: '#8e44ad', label: 'Error de permisos' },
  compatibility: { icon: '⚠', color: '#f39c12', label: 'Error de compatibilidad' },
  server: { icon: '⚠', color: '#e74c3c', label: 'Error del servidor' },
  storage: { icon: '💾', color: '#f39c12', label: 'Error de almacenamiento' },
  content: { icon: '⚠', color: '#f39c12', label: 'Error de contenido' },
};

export function ErrorMessage({ category, action, reason, fix, actions }: ErrorMessageProps) {
  const cfg = CATEGORY_CONFIG[category];

  return (
    <View
      style={[styles.container, { borderColor: cfg.color }]}
      accessibilityRole="alert"
      accessibilityLabel={`${cfg.label}. ${action}. ${reason}. ${fix ?? ''}`}
    >
      <View style={styles.header}>
        <Text style={[styles.icon, { color: cfg.color }]}>{cfg.icon}</Text>
        <Text style={styles.categoryLabel}>{cfg.label}</Text>
      </View>
      <Text style={styles.action}>Acción: {action}</Text>
      <Text style={styles.reason}>{reason}</Text>
      {fix && <Text style={styles.fix}>Solución: {fix}</Text>}
      {actions && actions.length > 0 && (
        <View style={styles.actions}>
          {actions.map((a, i) => (
            <Pressable
              key={i}
              onPress={a.onPress}
              style={styles.actionButton}
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

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#2c3e50',
    borderWidth: 2,
    borderRadius: 8,
    padding: 12,
    margin: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  icon: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  categoryLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  action: {
    color: '#ecf0f1',
    fontSize: 12,
    marginBottom: 2,
  },
  reason: {
    color: '#e74c3c',
    fontSize: 12,
    marginBottom: 2,
  },
  fix: {
    color: '#27ae60',
    fontSize: 12,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  actionButton: {
    backgroundColor: '#34495e',
    padding: 8,
    borderRadius: 6,
    minHeight: 36,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
