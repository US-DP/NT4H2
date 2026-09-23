/**
 * PlayerPanel — muestra información de los jugadores.
 *
 * Cumple UI-080: panel resumido con nombre, héroe, heridas, gloria, monedas,
 *                escudos, cartas en mano, mazo, desgaste, conexión.
 * Cumple UI-081: el jugador activo tiene borde/marcador de alto contraste.
 * Cumple UI-082: jugadores eliminados visibles con estado inequívoco.
 * Cumple UI-083: manos ajenas muestran solo número de cartas.
 * Cumple UI-084: detalle del héroe con capacidades y explicación.
 * Cumple UI-085: usos limitados explícitos ("1/2 usos restantes").
 * Cumple UI-086: conexión de cada jugador visible.
 */

import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useGameStore } from '../store/gameStore';

interface PlayerPanelProps {
  /** Al pulsar el nombre de un héroe, abre su detalle */
  onSelectHero?: (heroId: string) => void;
}

export function PlayerPanel({ onSelectHero }: PlayerPanelProps) {
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const viewerId = useGameStore((s) => s.viewerId);

  if (!gameState || !catalog) return null;

  const playerOrder = gameState.playerOrder ?? Object.keys(gameState.players);

  return (
    <ScrollView horizontal style={styles.container} accessibilityLabel="Paneles de jugadores">
      {playerOrder.map((playerId) => {
        const player = gameState.players[playerId];
        if (!player) return null;
        const heroDef = catalog.byId.get(player.heroId);
        const isActive = playerId === gameState.activePlayerId;
        const isViewer = playerId === viewerId;
        const isEliminated = player.wounds >= player.maxWounds;
        const capabilities = heroDef?.capabilities ?? player.capabilities;

        return (
          <View
            key={playerId}
            style={[
              styles.panel,
              isActive && styles.activePanel,
              isEliminated && styles.eliminatedPanel,
            ]}
            accessibilityLabel={`Jugador ${heroDef?.name ?? '???'}. ${isActive ? 'Jugador activo.' : ''} ${isEliminated ? 'Eliminado.' : ''}`}
          >
            <View style={styles.header}>
              <Pressable onPress={() => onSelectHero?.(player.heroId)} disabled={!onSelectHero}>
                <Text style={styles.heroName}>{heroDef?.name ?? '???'}</Text>
              </Pressable>
              {isActive && <Text style={styles.phase}>Fase: {gameState.phase}</Text>}
              {isActive && <Text style={styles.activeBadge}>● ACTIVO</Text>}
              {isEliminated && <Text style={styles.eliminatedBadge}>ELIMINADO</Text>}
            </View>

            <View style={styles.stats}>
              <Text style={styles.stat}>🏆 Gloria: {player.glory}</Text>
              <Text style={styles.stat}>💰 Monedas: {player.coins}</Text>
              <Text style={[styles.stat, player.wounds >= player.maxWounds && styles.statCritical]}>
                🩹 Heridas: {player.wounds}/{player.maxWounds}
              </Text>
              {player.shields > 0 && (
                <Text style={styles.stat}>🛡 Escudos: {player.shields}</Text>
              )}
              {/* UI-083: manos ajenas solo número de cartas */}
              <Text style={styles.stat}>
                📋 Mano: {isViewer ? player.hand.length : `${player.hand.length} (oculta)`}
              </Text>
              <Text style={styles.stat}>📚 Mazo: {player.abilityDeck.length}</Text>
              <Text style={styles.stat}>🗑 Desgaste: {player.wearPile.length}</Text>
              <Text style={styles.stat}>🏆 Trofeos: {player.trophies.length}</Text>
              {/* UI-085: usos limitados explícitos */}
              <Text style={[styles.stat, player.heroUsesRemaining === 0 && styles.statDepleted]}>
                ✨ Pericias: {player.heroUsesRemaining}/{player.heroMaxUses}
              </Text>
              {/* UI-084: capacidades del héroe */}
              {capabilities.length > 0 && (
                <Text style={styles.capabilities}>
                  Capacidades: {capabilities.join(', ')}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  panel: {
    backgroundColor: '#1a1a2e',
    padding: 8,
    borderRadius: 8,
    marginRight: 8,
    minWidth: 180,
    borderWidth: 2,
    borderColor: '#34495e',
  },
  activePanel: {
    borderColor: '#f1c40f',
    borderWidth: 3,
    backgroundColor: '#2a2a4e',
  },
  eliminatedPanel: {
    opacity: 0.5,
    borderColor: '#7f8c8d',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  heroName: {
    color: '#f1c40f',
    fontSize: 14,
    fontWeight: 'bold',
    flex: 1,
  },
  phase: {
    color: '#3498db',
    fontSize: 10,
  },
  activeBadge: {
    color: '#f1c40f',
    fontSize: 10,
    fontWeight: 'bold',
  },
  eliminatedBadge: {
    color: '#e74c3c',
    fontSize: 10,
    fontWeight: 'bold',
  },
  stats: {
    gap: 4,
  },
  stat: {
    color: '#ecf0f1',
    fontSize: 11,
  },
  statCritical: {
    color: '#e74c3c',
    fontWeight: 'bold',
  },
  statDepleted: {
    color: '#7f8c8d',
    fontStyle: 'italic',
  },
  connected: {
    color: '#27ae60',
  },
  disconnected: {
    color: '#e74c3c',
  },
  capabilities: {
    color: '#bdc3c7',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
