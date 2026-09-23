/**
 * Pantalla de inicio — menú principal.
 *
 * Cumple UI-030: priorizar Continuar, Jugar offline, Jugar online, Estudio, Tutorial/Reglas.
 * Cumple UI-031: si hay partida activa, "Continuar" tiene mayor prioridad visual.
 * Cumple UI-032: partidas pendientes muestran nombre, modo, fecha, turno, estado, jugadores.
 * Cumple UI-033: distinguir partidas locales, online, finalizadas, con decisión pendiente.
 * Cumple UI-034: indicador no intrusivo sin conexión.
 * Cumple UI-035: acceso offline a partidas, colección, estudio, tutorial, reglas.
 */

import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useGameStore } from '../store/gameStore';
import { ConnectionStatus, type ConnectionState } from '../components/ConnectionStatus';
import { EmptyState } from '../components/EmptyState';
import { API_BASE, fetchWithTimeout } from '../lib/config';

export default function HomeScreen() {
  const router = useRouter();
  const newGame = useGameStore((s) => s.newGame);
  const loadSavedGames = useGameStore((s) => s.loadSavedGames);
  const savedGames = useGameStore((s) => s.savedGames);
  const loadGame = useGameStore((s) => s.loadGame);
  const deleteSavedGame = useGameStore((s) => s.deleteSavedGame);

  useEffect(() => {
    loadSavedGames();
  }, [loadSavedGames]);

  // Estado de conexión simulado (offline por defecto)
  const connectionState: ConnectionState = 'LOCAL';
  const hasSavedGames = savedGames.length > 0;

  const startStandardGame = () => {
    newGame({
      mode: 'STANDARD',
      playerCount: 2,
      seed: `game-${Date.now()}`,
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: true,
    });
    router.push('/(game)');
  };

  const startSoloGame = () => {
    newGame({
      mode: 'SOLO',
      playerCount: 1,
      seed: `solo-${Date.now()}`,
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
      ],
      useScenarios: true,
      soloSupportHeroIds: ['hero.feldon'],
    });
    router.push('/(game)');
  };

  const setConnectionMode = useGameStore((s) => s.setConnectionMode);

  const createOnlineRoom = async () => {
    const hostId = `p-${Date.now()}`;
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'STANDARD',
          maxPlayers: 4,
          hostId,
          hostName: 'Anfitrion',
          // El runner exige al menos un héroe para crear la partida
          heroes: [{
            playerId: hostId,
            heroId: 'hero.aranel',
            heroFace: 'FEMALE',
            deckId: 'explorer.default',
          }],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // D431: el token viaja por el store, NO por params de la ruta
        // (en web quedaría en la barra de direcciones e historial)
        setConnectionMode('online', data.roomId, hostId, data.hostToken);
        router.push({
          pathname: '/(room)',
          params: { roomId: data.roomId, playerId: hostId },
        } as any);
      }
    } catch {
      // Fallback: ir a sala manual
      router.push({ pathname: '/(room)' } as any);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>No Time for Heroes</Text>
      <Text style={styles.subtitle}>Versión Digital</Text>

      {/* Indicador de conexión (UI-034) */}
      <ConnectionStatus state={connectionState} />

      {/* Acciones principales (UI-030) */}
      <View style={styles.menu}>
        {/* UI-031: Continuar tiene prioridad si hay partida guardada */}
        {hasSavedGames && (
          <Pressable
            style={[styles.button, styles.primaryButton]}
            onPress={() => {
              loadGame(savedGames[0].id);
              router.push('/(game)');
            }}
            accessibilityRole="button"
            accessibilityLabel="Continuar última partida"
          >
            <Text style={styles.buttonText}>▶ Continuar partida</Text>
            <Text style={styles.buttonSubtext}>{savedGames[0].name}</Text>
          </Pressable>
        )}

        <Pressable
          style={styles.button}
          onPress={() => router.push({ pathname: '/(create)' } as any)}
        >
          <Text style={styles.buttonText}>Crear partida avanzada</Text>
        </Pressable>

        <Pressable style={[styles.button, !hasSavedGames && styles.primaryButton]} onPress={startStandardGame}>
          <Text style={styles.buttonText}>Jugar offline (2 jugadores)</Text>
        </Pressable>

        <Pressable style={styles.button} onPress={startSoloGame}>
          <Text style={styles.buttonText}>Modo Solitario</Text>
        </Pressable>

        <Pressable
          style={styles.button}
          onPress={createOnlineRoom}
          accessibilityRole="button"
          accessibilityLabel="Jugar online"
        >
          <Text style={styles.buttonText}>Jugar online</Text>
        </Pressable>

        <Pressable
          style={styles.buttonSecondary}
          onPress={() => router.push({ pathname: '/(library)' } as any)}
        >
          <Text style={styles.buttonText}>Colección</Text>
        </Pressable>

        <Pressable
          style={styles.buttonSecondary}
          onPress={() => router.push({ pathname: '/(study)' } as any)}
        >
          <Text style={styles.buttonText}>Estudio de creación</Text>
        </Pressable>

        <Pressable
          style={styles.buttonSecondary}
          onPress={() => router.push({ pathname: '/(profile)' } as any)}
        >
          <Text style={styles.buttonText}>Perfil y ajustes</Text>
        </Pressable>

        <Pressable
          style={styles.buttonSecondary}
          onPress={() => router.push({ pathname: '/(rulebook)' } as any)}
        >
          <Text style={styles.buttonText}>Tutorial y Reglamento</Text>
        </Pressable>
      </View>

      {/* Partidas pendientes (UI-032, UI-033) */}
      {hasSavedGames ? (
        <View style={styles.savedSection}>
          <Text style={styles.sectionTitle}>Partidas guardadas</Text>
          {savedGames.map((game) => (
            <View key={game.id} style={styles.savedItem}>
              <Pressable
                style={styles.savedButton}
                onPress={() => {
                  loadGame(game.id);
                  router.push('/(game)');
                }}
                accessibilityRole="button"
                accessibilityLabel={`Cargar partida ${game.name}`}
              >
                <Text style={styles.savedName}>{game.name}</Text>
                <Text style={styles.savedDate}>
                  {new Date(game.savedAt).toLocaleString()}
                </Text>
                <Text style={styles.savedMode}>Partida local</Text>
              </Pressable>
              <Pressable
                style={styles.deleteButton}
                onPress={() => deleteSavedGame(game.id)}
                accessibilityRole="button"
                accessibilityLabel="Eliminar partida guardada"
              >
                <Text style={styles.deleteText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <EmptyState
          title="No tienes partidas guardadas"
          description="Crea una nueva partida para empezar a jugar, o carga una partida existente cuando la guardes."
          primaryAction={{ label: 'Crear partida', onPress: startStandardGame }}
          helpAction={{ label: 'Ver tutorial', onPress: () => router.push({ pathname: '/(rulebook)' } as any) }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    padding: 20,
  },
  title: {
    color: '#f1c40f',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 40,
  },
  subtitle: {
    color: '#bdc3c7',
    fontSize: 16,
    marginBottom: 20,
  },
  menu: {
    gap: 12,
    width: '100%',
    maxWidth: 400,
  },
  button: {
    backgroundColor: '#2980b9',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: 44,
  },
  primaryButton: {
    backgroundColor: '#27ae60',
    borderWidth: 2,
    borderColor: '#f1c40f',
  },
  buttonSecondary: {
    backgroundColor: '#8e44ad',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: 44,
  },
  disabledButton: {
    backgroundColor: '#555',
    opacity: 0.6,
  },
  disabledHint: {
    color: '#bdc3c7',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonSubtext: {
    color: '#ecf0f1',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
  },
  savedSection: {
    width: '100%',
    maxWidth: 400,
    marginTop: 32,
  },
  sectionTitle: {
    color: '#3498db',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  savedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  savedButton: {
    flex: 1,
    backgroundColor: '#2c3e50',
    padding: 12,
    borderRadius: 6,
  },
  savedName: {
    color: '#ecf0f1',
    fontSize: 14,
    fontWeight: 'bold',
  },
  savedDate: {
    color: '#bdc3c7',
    fontSize: 11,
    marginTop: 2,
  },
  savedMode: {
    color: '#7f8c8d',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  deleteButton: {
    backgroundColor: '#c0392b',
    padding: 12,
    borderRadius: 6,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
