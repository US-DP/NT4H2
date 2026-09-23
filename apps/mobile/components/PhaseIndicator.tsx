/**
 * PhaseIndicator — muestra la fase actual con indicador de progreso.
 *
 * Cumple UI-071: la fase se representa con texto e indicador de progreso
 *               (Ataque → Mercado → Restablecimiento).
 * Cumple UI-072: la fase activa tiene mayor contraste.
 * Cumple UI-P02: estado visible permanente.
 */

import { View, Text, StyleSheet } from 'react-native';
import type { Phase } from '@nt4h/schema';

interface PhaseIndicatorProps {
  phase: Phase;
  turnNumber?: number;
}

const PHASES: { key: string; label: string; short: string }[] = [
  { key: 'PLAYER_ATTACK', label: 'Ataque', short: '⚔' },
  { key: 'MARKET', label: 'Mercado', short: '💰' },
  { key: 'RESTORATION', label: 'Restablecimiento', short: '↻' },
];

const PHASE_LABELS: Record<string, string> = {
  SETUP: 'Preparación',
  INITIAL_PLAYER_SELECTION: 'Elección de Líder',
  TURN_START: 'Inicio de turno',
  ATTACK_CHOICE: 'Elección de ataque',
  PLAYER_ATTACK: 'Ataque',
  RESOLVING_CARD: 'Resolviendo carta',
  WAITING_FOR_CHOICE: 'Esperando decisión',
  HORDE_ATTACK: 'Ataque de la Horda',
  MARKET: 'Mercado',
  RESTORATION: 'Restablecimiento',
  BATTLEFIELD_REPLENISHMENT: 'Reposición del campo',
  SCENARIO_TRANSITION: 'Cambio de escenario',
  TURN_END: 'Fin de turno',
  GAME_END_CHECK: 'Comprobando fin de partida',
  FINISHED: 'Partida finalizada',
};

export function PhaseIndicator({ phase, turnNumber }: PhaseIndicatorProps) {
  // Fases especiales fuera del flujo principal
  if (!['PLAYER_ATTACK', 'MARKET', 'RESTORATION'].includes(phase)) {
    return (
      <View style={styles.container}>
        <Text style={styles.specialPhase}>{PHASE_LABELS[phase] ?? phase}</Text>
        {turnNumber !== undefined && (
          <Text style={styles.round}>Turno {turnNumber}</Text>
        )}
      </View>
    );
  }

  const activeIndex = PHASES.findIndex((p) => p.key === phase);

  return (
    <View style={styles.container} accessibilityLabel={`Fase: ${PHASE_LABELS[phase]}`}>
      {turnNumber !== undefined && (
        <Text style={styles.round}>Turno {turnNumber}</Text>
      )}
      <View style={styles.phases}>
        {PHASES.map((p, i) => {
          const isActive = i === activeIndex;
          const isPast = i < activeIndex;
          return (
            <View key={p.key} style={styles.phaseItem}>
              <Text
                style={[
                  styles.phaseText,
                  isActive && styles.phaseActive,
                  isPast && styles.phasePast,
                ]}
              >
                {p.short} {p.label}
              </Text>
              {i < PHASES.length - 1 && (
                <Text style={[styles.arrow, isPast && styles.arrowPast]}>→</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    alignItems: 'center',
  },
  round: {
    color: '#bdc3c7',
    fontSize: 11,
    marginBottom: 4,
  },
  phases: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phaseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phaseText: {
    color: '#555',
    fontSize: 12,
    fontWeight: 'normal',
  },
  phaseActive: {
    color: '#f1c40f',
    fontSize: 14,
    fontWeight: 'bold',
  },
  phasePast: {
    color: '#7f8c8d',
  },
  arrow: {
    color: '#555',
    fontSize: 12,
    marginHorizontal: 2,
  },
  arrowPast: {
    color: '#7f8c8d',
  },
  specialPhase: {
    color: '#f1c40f',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
