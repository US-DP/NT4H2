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
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useColors } from '../lib/useTheme';

export type ConnectionState = 'LOCAL' | 'CONNECTED' | 'STALE' | 'RECONNECTING' | 'OFFLINE' | 'SYNCING' | 'ERROR';

interface ConnectionStatusProps {
  state: ConnectionState;
  /** Resumen de cambios tras reconexión (UI-194) */
  reconnectSummary?: string[];
}

export function ConnectionStatus({ state, reconnectSummary }: ConnectionStatusProps) {
  const c = useColors();
  const { t } = useTranslation();
  const STATE_CONFIG: Record<ConnectionState, { color: string; icon: string }> = {
    // "Local" no es un estado de conexión: comunica que no se necesita red
    LOCAL: { color: c.connectionStale, icon: '💾' },
    CONNECTED: { color: c.connectionOnline, icon: '●' },
    // STALE: socket abierto pero sin tráfico (heartbeat/pong/mensajes) —
    // no es OFFLINE porque puede recuperarse sin reconectar
    STALE: { color: c.connectionReconnecting, icon: '!' },
    RECONNECTING: { color: c.connectionReconnecting, icon: '⟳' },
    OFFLINE: { color: c.connectionOffline, icon: '✕' },
    SYNCING: { color: c.info, icon: '↻' },
    ERROR: { color: c.connectionOffline, icon: '⚠' },
  };
  const cfg = STATE_CONFIG[state];
  const label = t(`common.conn.${state}`);

  return (
    <View style={styles.container} accessibilityLabel={t('common.conn.a11y', { label })}>
      <Text style={[styles.indicator, { color: cfg.color }]}>
        {cfg.icon} {label}
      </Text>
      {state === 'OFFLINE' && (
        <Text style={[styles.hint, { color: c.textMuted }]}>
          {t('common.conn.offlineHint')}
        </Text>
      )}
      {state === 'LOCAL' && (
        <Text style={[styles.hint, { color: c.textMuted }]}>
          {t('common.conn.localHint')}
        </Text>
      )}
      {state === 'STALE' && (
        <Text style={[styles.hint, { color: c.textMuted }]}>
          {t('common.conn.staleHint')}
        </Text>
      )}
      {reconnectSummary && reconnectSummary.length > 0 && (
        <View style={[styles.summary, { backgroundColor: c.surfaceRaised }]}>
          <Text style={[styles.summaryTitle, { color: c.accent }]}>
            {t('common.conn.whileAway')}
          </Text>
          {reconnectSummary.map((line, i) => (
            <Text key={i} style={[styles.summaryLine, { color: c.text }]}>- {line}</Text>
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
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  summary: {
    marginTop: 4,
    padding: 8,
    borderRadius: 4,
    alignSelf: 'stretch',
  },
  summaryTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  summaryLine: {
    fontSize: 10,
  },
});
