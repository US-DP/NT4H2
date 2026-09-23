/**
 * ActionHistory — historial de acciones de la partida, independiente del chat.
 *
 * Cumple UI-170: historial independiente del chat.
 * Cumple UI-171: cada entrada muestra actor, acción, carta, objetivo, resultado, momento.
 * Cumple UI-172: filtros por turno, jugador, cartas, daño, recursos, errores.
 * Cumple UI-173: modo avanzado con ID de comando, versión, semilla, eventos.
 * Cumple UI-174: no muestra información privada del momento del evento.
 */

import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';

export interface HistoryEntry {
  id: string;
  turn: number;
  actor: string;
  action: string;
  card?: string;
  target?: string;
  result: string;
  timestamp: number;
  /** ¿Era privada en el momento del evento? (UI-174) */
  wasPrivate?: boolean;
  /** Detalles técnicos para modo avanzado (UI-173) */
  technical?: {
    commandId?: string;
    version?: string;
    seed?: string;
    events?: string[];
  };
}

export type HistoryFilter = 'all' | 'turn' | 'player' | 'cards' | 'damage' | 'resources' | 'errors';

interface ActionHistoryProps {
  entries: HistoryEntry[];
  currentTurn: number;
  /** Filtro externo; por defecto 'all' */
  filter?: HistoryFilter;
  /** Activa información técnica */
  advanced?: boolean;
  /** Callback al cambiar filtro */
  onFilterChange?: (f: HistoryFilter) => void;
  /** Callback para alternar modo avanzado */
  onToggleAdvanced?: () => void;
}

const FILTER_LABELS: Record<HistoryFilter, string> = {
  all: 'Todo',
  turn: 'Turno actual',
  player: 'Por jugador',
  cards: 'Cartas',
  damage: 'Daño',
  resources: 'Recursos',
  errors: 'Errores',
};

export function ActionHistory({
  entries,
  currentTurn,
  filter = 'all',
  advanced = false,
  onFilterChange,
  onToggleAdvanced,
}: ActionHistoryProps) {
  const effectiveFilter = filter ?? 'all';
  const effectiveAdvanced = advanced ?? false;

  const filtered = entries.filter((e) => {
    switch (effectiveFilter) {
      case 'turn':
        return e.turn === currentTurn;
      case 'cards':
        return !!e.card;
      case 'damage':
        return /da[oñ]|herida|inflig/i.test(e.result);
      case 'resources':
        return /moneda|gloria|rob|recup/i.test(e.result);
      case 'errors':
        return /error|inv[aá]lid|fall/i.test(e.result);
      default:
        return true;
    }
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Historial</Text>
        <Pressable onPress={onToggleAdvanced} style={styles.advToggle}>
          <Text style={styles.advText}>{effectiveAdvanced ? 'Básico' : 'Avanzado'}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal style={styles.filters}>
        {(Object.keys(FILTER_LABELS) as HistoryFilter[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => onFilterChange?.(f)}
            style={[styles.filterChip, effectiveFilter === f && styles.filterActive]}
          >
            <Text style={[styles.filterText, effectiveFilter === f && styles.filterTextActive]}>
              {FILTER_LABELS[f]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.list}>
        {filtered.length === 0 ? (
          <Text style={styles.empty}>No hay eventos en este filtro.</Text>
        ) : (
          filtered.map((e) => (
            <View key={e.id} style={styles.entry}>
              <View style={styles.entryHeader}>
                <Text style={styles.entryActor}>{e.actor}</Text>
                <Text style={styles.entryAction}>{e.action}</Text>
                <Text style={styles.entryTime}>T{e.turn}</Text>
              </View>
              {e.card && <Text style={styles.entryDetail}>Carta: {e.card}</Text>}
              {e.target && <Text style={styles.entryDetail}>Objetivo: {e.target}</Text>}
              <Text style={styles.entryResult}>{e.result}</Text>
              {effectiveAdvanced && e.technical && (
                <View style={styles.technical}>
                  {e.technical.commandId && (
                    <Text style={styles.techLine}>CMD: {e.technical.commandId}</Text>
                  )}
                  {e.technical.version && (
                    <Text style={styles.techLine}>v{e.technical.version}</Text>
                  )}
                  {e.technical.seed && (
                    <Text style={styles.techLine}>seed: {e.technical.seed}</Text>
                  )}
                  {e.technical.events?.map((ev, i) => (
                    <Text key={i} style={styles.techLine}>• {ev}</Text>
                  ))}
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: '#1a1a2e',
    borderTopWidth: 1,
    borderTopColor: '#333',
    maxHeight: 200,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#ecf0f1',
    fontSize: 13,
    fontWeight: 'bold',
  },
  advToggle: {
    backgroundColor: '#34495e',
    padding: 4,
    borderRadius: 4,
  },
  advText: {
    color: '#bdc3c7',
    fontSize: 10,
  },
  filters: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  filterChip: {
    backgroundColor: '#2c3e50',
    padding: 4,
    borderRadius: 4,
    marginRight: 4,
  },
  filterActive: {
    backgroundColor: '#2980b9',
  },
  filterText: {
    color: '#bdc3c7',
    fontSize: 10,
  },
  filterTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  list: {
    flex: 1,
  },
  empty: {
    color: '#777',
    fontSize: 11,
    padding: 8,
    textAlign: 'center',
  },
  entry: {
    backgroundColor: '#2c3e50',
    padding: 6,
    borderRadius: 4,
    marginBottom: 4,
  },
  entryHeader: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  entryActor: {
    color: '#f1c40f',
    fontSize: 11,
    fontWeight: 'bold',
  },
  entryAction: {
    color: '#ecf0f1',
    fontSize: 11,
    flex: 1,
  },
  entryTime: {
    color: '#7f8c8d',
    fontSize: 10,
  },
  entryDetail: {
    color: '#bdc3c7',
    fontSize: 10,
    marginTop: 2,
  },
  entryResult: {
    color: '#ecf0f1',
    fontSize: 10,
    marginTop: 2,
  },
  technical: {
    marginTop: 4,
    padding: 4,
    backgroundColor: '#1a1a2e',
    borderRadius: 3,
  },
  techLine: {
    color: '#7f8c8d',
    fontSize: 9,
    fontFamily: 'monospace',
  },
});
