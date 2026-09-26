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
import { FlashList } from '@shopify/flash-list';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

export interface HistoryEntry {
  id: string;
  turn: number;
  actor: string;
  /** Evento sin actor concreto (fases, sistema) — siempre visible con cualquier filtro de jugador */
  global?: boolean;
  action: string;
  card?: string;
  target?: string;
  result: string;
  timestamp: number;
  /** ¿Era privada en el momento del evento? (UI-174): se ocultan los detalles */
  wasPrivate?: boolean;
  /** Enlace a un detalle asociado (p. ej. desglose del último asalto de la Horda) */
  linkTo?: 'horde';
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
  /** Jugador seleccionado cuando filter === 'player' */
  playerFilter?: string | null;
  /** Callback al elegir jugador en el filtro 'player' */
  onPlayerFilterChange?: (playerId: string | null) => void;
  /** Activa información técnica */
  advanced?: boolean;
  /** Callback al cambiar filtro */
  onFilterChange?: (f: HistoryFilter) => void;
  /** Callback para alternar modo avanzado */
  onToggleAdvanced?: () => void;
  /** Pulsación sobre una entrada con `linkTo` (abre su detalle) */
  onEntryPress?: (entry: HistoryEntry) => void;
}

// El filtro 'player' es funcional: muestra un selector de jugador.
const VISIBLE_FILTERS: HistoryFilter[] = ['all', 'turn', 'player', 'cards', 'damage', 'resources', 'errors'];

export function ActionHistory({
  entries,
  currentTurn,
  filter = 'all',
  playerFilter = null,
  onPlayerFilterChange,
  advanced = false,
  onFilterChange,
  onToggleAdvanced,
  onEntryPress,
}: ActionHistoryProps) {
  const { t } = useTranslation();
  const FILTER_LABELS: Record<HistoryFilter, string> = {
    all: t('panels.historyFilterAll'),
    turn: t('panels.historyFilterTurn'),
    player: t('panels.historyFilterPlayer'),
    cards: t('panels.historyFilterCards'),
    damage: t('panels.historyFilterDamage'),
    resources: t('panels.historyFilterResources'),
    errors: t('panels.historyFilterErrors'),
  };
  const effectiveFilter = filter ?? 'all';
  const effectiveAdvanced = advanced ?? false;

  // Actores únicos para el selector del filtro 'player' (incluye jugadores
  // eliminados: el historial conserva sus acciones aunque ya no jueguen)
  const actors = [...new Set(entries.filter(e => !e.global).map(e => e.actor))];
  const effectivePlayer = playerFilter ?? actors[0] ?? null;

  const filtered = entries.filter((e) => {
    switch (effectiveFilter) {
      case 'turn':
        return e.turn === currentTurn;
      case 'player':
        // Los eventos globales (sin actor) acompañan al jugador elegido:
        // sin ellos el contexto (fases, Horda) quedaría incomprensible
        return e.global || e.actor === effectivePlayer;
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

  // El modo avanzado solo se ofrece si hay entradas con datos técnicos;
  // un toggle que no revela nada es peor que no tenerlo.
  const hasTechnical = entries.some((e) => e.technical);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('panels.historyTitle')}</Text>
        {hasTechnical && (
          <Pressable
            onPress={onToggleAdvanced}
            style={styles.advToggle}
            accessibilityRole="button"
            accessibilityLabel={effectiveAdvanced ? t('panels.historyHideTechnical') : t('panels.historyShowTechnical')}
          >
            <Text style={styles.advText}>{effectiveAdvanced ? t('panels.historyBasic') : t('panels.historyAdvanced')}</Text>
          </Pressable>
        )}
      </View>

      <ScrollView horizontal style={styles.filters}>
        {VISIBLE_FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => onFilterChange?.(f)}
            style={[styles.filterChip, effectiveFilter === f && styles.filterActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: effectiveFilter === f }}
          >
            <Text style={[styles.filterText, effectiveFilter === f && styles.filterTextActive]}>
              {FILTER_LABELS[f]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Selector de jugador (filtro 'player') */}
      {effectiveFilter === 'player' && actors.length > 0 && (
        <ScrollView horizontal style={styles.filters}>
          {actors.map((a) => (
            <Pressable
              key={a}
              onPress={() => onPlayerFilterChange?.(a)}
              style={[styles.filterChip, effectivePlayer === a && styles.filterActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: effectivePlayer === a }}
              accessibilityLabel={t('panels.historyFilterByPlayer', { name: a })}
            >
              <Text style={[styles.filterText, effectivePlayer === a && styles.filterTextActive]}>
                {a}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* FlashList: el historial puede crecer a cientos de eventos por partida */}
      <FlashList
        style={styles.list}
        data={filtered}
        keyExtractor={(e) => e.id}
        estimatedItemSize={52}
        ListEmptyComponent={
          <Text style={styles.empty}>{t('panels.historyEmpty')}</Text>
        }
        renderItem={({ item: e }) => (
          <View style={styles.entry}>
            <View style={styles.entryHeader}>
              <Text style={styles.entryActor}>{e.global ? t('panels.historyGlobal') : e.actor}</Text>
              <Text style={styles.entryAction}>{e.action}</Text>
              {/* UI-171: momento del evento */}
              <Text style={styles.entryTime}>
                {t('panels.historyTurnShort', { turn: e.turn })} {format(new Date(e.timestamp), 'HH:mm')}
              </Text>
            </View>
            {/* UI-174: eventos privados — solo actor/acción, sin detalles */}
            {e.wasPrivate ? (
              <Text style={styles.entryDetail}>{t('panels.historyPrivate')}</Text>
            ) : (
              <>
                {e.card && <Text style={styles.entryDetail}>{t('panels.historyCard', { card: e.card })}</Text>}
                {e.target && <Text style={styles.entryDetail}>{t('panels.historyTarget', { target: e.target })}</Text>}
                <Text style={styles.entryResult}>{e.result}</Text>
              </>
            )}
            {e.linkTo && onEntryPress && (
              <Pressable
                onPress={() => onEntryPress(e)}
                accessibilityRole="button"
                accessibilityLabel={e.linkTo === 'horde' ? t('panels.historyViewHorde') : t('panels.historyViewDetail')}
                style={styles.entryLink}
              >
                <Text style={styles.entryLinkText}>
                  {e.linkTo === 'horde' ? t('panels.historyViewBreakdownLink') : t('panels.historyViewDetailLink')}
                </Text>
              </Pressable>
            )}
            {effectiveAdvanced && e.technical && (
              <View style={styles.technical}>
                {e.technical.commandId && (
                  <Text style={styles.techLine}>{t('panels.historyCmd', { id: e.technical.commandId })}</Text>
                )}
                {e.technical.version && (
                  <Text style={styles.techLine}>{t('panels.historyVersion', { version: e.technical.version })}</Text>
                )}
                {e.technical.seed && (
                  // Semilla parcialmente enmascarada: suficiente para
                  // correlacionar diagnósticos sin exponer la semilla activa
                  <Text style={styles.techLine}>{t('panels.historySeed', { seed: e.technical.seed.slice(0, 4) })}…</Text>
                )}
                {e.technical.events?.map((ev, i) => (
                  <Text key={i} style={styles.techLine}>• {ev}</Text>
                ))}
              </View>
            )}
          </View>
        )}
      />
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
  entryLink: {
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  entryLinkText: {
    color: '#5dade2',
    fontSize: 10,
    fontWeight: '600',
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
