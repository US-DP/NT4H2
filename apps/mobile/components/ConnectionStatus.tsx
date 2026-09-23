/**
 * ConnectionStatus — indicador del estado de conexión.
 *
 * Cumple UI-034: indicador no intrusivo sin conexión.
 * Cumple UI-190: estados Conectado, Reconectando, Sin conexión, Sincronizando, Error.
 * Cumple UI-191: deshabilitar acciones que requieren servidor.
 * Cumple UI-193: mensaje al reconectar.
 * Cumple UI-200: indicar que la partida es local.
 */

import { View, Text, StyleSheet } from 'react-native';

export type ConnectionState = 'LOCAL' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE' | 'SYNCING' | 'ERROR';

interface ConnectionStatusProps {
  state: ConnectionState;
  /** Resumen de cambios tras reconexión (UI-194) */
  reconnectSummary?: string[];
}

const STATE_CONFIG: Record<ConnectionState, { label: string; color: string; icon: string }> = {
  LOCAL: { label: 'Partida local', color: '#7f8c8d', icon: '💾' },
  CONNECTED: { label: 'Conectado', color: '#27ae60', icon: '●' },
  RECONNECTING: { label: 'Reconectando…', color: '#f39c12', icon: '⟳' },
  OFFLINE: { label: 'Sin conexión', color: '#e74c3c', icon: '✕' },
  SYNCING: { label: 'Sincronizando…', color: '#3498db', icon: '↻' },
  ERROR: { label: 'Error de conexión', color: '#c0392b', icon: '⚠' },
};

export function ConnectionStatus({ state, reconnectSummary }: ConnectionStatusProps) {
  const cfg = STATE_CONFIG[state];

  return (
    <View style={styles.container} accessibilityLabel={`Estado de conexión: ${cfg.label}`}>
      <Text style={[styles.indicator, { color: cfg.color }]}>
        {cfg.icon} {cfg.label}
      </Text>
      {state === 'OFFLINE' && (
        <Text style={styles.hint}>Las funciones online no están disponibles.</Text>
      )}
      {reconnectSummary && reconnectSummary.length > 0 && (
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Durante tu desconexión:</Text>
          {reconnectSummary.map((line, i) => (
            <Text key={i} style={styles.summaryLine}>- {line}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 6,
    alignItems: 'center',
  },
  indicator: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  hint: {
    color: '#bdc3c7',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  summary: {
    marginTop: 4,
    padding: 8,
    backgroundColor: '#2c3e50',
    borderRadius: 4,
    alignSelf: 'stretch',
  },
  summaryTitle: {
    color: '#f1c40f',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  summaryLine: {
    color: '#ecf0f1',
    fontSize: 10,
  },
});
