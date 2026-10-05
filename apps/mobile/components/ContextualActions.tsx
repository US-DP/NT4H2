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
import { touchTarget, type Colors } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';

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

const stateColors = (c: Colors): Record<ActionState, string> => ({
  idle: c.text,
  pending: c.warning,
  confirmed: c.success,
  rejected: c.danger,
  retrying: c.info,
  offline: c.danger,
});

export function ContextualActions({ actions }: ContextualActionsProps) {
  const c = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca el componente
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(c, fs);
  const STATE_COLORS = stateColors(c);
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
            <Text style={[
              styles.label,
              action.primary && !action.dangerous && !action.disabled && styles.labelOnAccent,
            ]}>
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

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 8,
    justifyContent: 'center',
    backgroundColor: c.background,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  button: {
    backgroundColor: c.surfaceRaised,
    padding: 12,
    borderRadius: 8,
    minWidth: 100,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: c.accent,
    borderWidth: 2,
    borderColor: c.accent,
  },
  dangerous: {
    backgroundColor: c.dangerPressed,
  },
  disabled: {
    backgroundColor: c.surfaceDisabled,
    opacity: 0.6,
  },
  label: {
    color: c.text,
    fontSize: fs(13),
    fontWeight: 'bold',
    textAlign: 'center',
  },
  labelOnAccent: {
    color: c.textOnAccent,
  },
  state: {
    fontSize: fs(14),
    fontWeight: 'bold',
    marginLeft: 4,
  },
  reason: {
    color: c.danger,
    fontSize: fs(9),
    textAlign: 'center',
    marginTop: 2,
  },
});
