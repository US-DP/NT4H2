/**
 * ContextualActions — barra de acciones principales según la fase actual.
 *
 * Cumple UI-120: acciones principales según fase.
 *   - Ataque: Enfrentarse, Evasión, Jugar carta, Finalizar ataque, Usar poder, Usar escenario.
 *   - Mercado: Comprar, Inspeccionar, Finalizar Mercado.
 *   - Restablecimiento: Seleccionar descartes, Confirmar.
 * Cumple UI-121: solo una acción primaria en cada momento.
 * Cumple UI-122: botones peligrosos (abandonar) con estilo diferenciado.
 * Cumple UI-123: estado de acción (pendiente, confirmada, rechazada, reintentando, sin conexión).
 * Cumple UI-P03: acciones contextuales.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';

export type ActionState = 'idle' | 'pending' | 'confirmed' | 'rejected' | 'retrying' | 'offline';

export interface ContextualAction {
  id: string;
  label: string;
  icon?: string;
  onPress: () => void;
  /** ¿Es la acción primaria recomendada? (UI-121) */
  primary?: boolean;
  /** ¿Es peligrosa (abandonar, etc.)? (UI-122) */
  dangerous?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  state?: ActionState;
}

interface ContextualActionsProps {
  actions: ContextualAction[];
}

const STATE_LABELS: Record<ActionState, string> = {
  idle: '',
  pending: '…',
  confirmed: '✓',
  rejected: '✕',
  retrying: '⟳',
  offline: '⚠',
};

const STATE_COLORS: Record<ActionState, string> = {
  idle: '#fff',
  pending: '#f39c12',
  confirmed: '#27ae60',
  rejected: '#e74c3c',
  retrying: '#3498db',
  offline: '#e74c3c',
};

export function ContextualActions({ actions }: ContextualActionsProps) {
  return (
    <View style={styles.container} accessibilityRole="toolbar">
      {actions.map((action) => {
        const state = action.state ?? 'idle';
        const stateLabel = STATE_LABELS[state];
        const stateColor = STATE_COLORS[state];

        return (
          <Pressable
            key={action.id}
            onPress={action.disabled ? undefined : action.onPress}
            disabled={action.disabled}
            style={[
              styles.button,
              action.primary && styles.primary,
              action.dangerous && styles.dangerous,
              action.disabled && styles.disabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityHint={action.disabled ? action.disabledReason : undefined}
            accessibilityState={{ disabled: !!action.disabled }}
          >
            <Text style={styles.label}>
              {action.icon ? `${action.icon} ` : ''}
              {action.label}
            </Text>
            {stateLabel !== '' && (
              <Text style={[styles.state, { color: stateColor }]}>{stateLabel}</Text>
            )}
            {action.disabled && action.disabledReason && (
              <Text style={styles.reason}>{action.disabledReason}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 8,
    justifyContent: 'center',
    backgroundColor: '#0f0f23',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  button: {
    backgroundColor: '#34495e',
    padding: 12,
    borderRadius: 8,
    minWidth: 100,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#2980b9',
    borderWidth: 2,
    borderColor: '#f1c40f',
  },
  dangerous: {
    backgroundColor: '#c0392b',
  },
  disabled: {
    backgroundColor: '#555',
    opacity: 0.6,
  },
  label: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  state: {
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  reason: {
    color: '#e74c3c',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 2,
  },
});
