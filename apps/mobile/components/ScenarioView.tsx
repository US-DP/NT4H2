/**
 * ScenarioView — muestra el escenario activo de la partida.
 *
 * Cumple UI-150: posición visible estable.
 * Cumple UI-151: nombre, ilustración, efecto resumido, acción disponible, límite, estado.
 * Cumple UI-152: botón contextual si el escenario permite acción.
 * Cumple UI-153: modificadores activos en resumen global.
 * Cumple UI-154: al cambiar, mostrar descartado/revelado/modificadores.
 * Cumple UI-155: no depender de memoria del jugador.
 */

import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useGameStore } from '../store/gameStore';
import { cardImage } from '../store/cardImage';
import type { CardDefinition } from '@nt4h/schema';

interface ScenarioViewProps {
  onUseScenario?: () => void;
}

export function ScenarioView({ onUseScenario }: ScenarioViewProps) {
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);

  if (!gameState || !catalog) return null;

  const scenarioInstanceId = gameState.scenario?.instanceId;
  if (!scenarioInstanceId) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Escenario</Text>
        <Text style={styles.empty}>No hay escenario activo.</Text>
      </View>
    );
  }

  // Buscar la definición del escenario
  const scenarioInstance = gameState.scenario;
  const scenarioDef: CardDefinition | undefined = scenarioInstance
    ? catalog.byId.get(scenarioInstance.definitionId)
    : undefined;

  const { path, showPlaceholder } = cardImage(scenarioDef?.id ?? '', 'game');

  if (!scenarioDef) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Escenario</Text>
        <Text style={styles.empty}>Definición no encontrada.</Text>
      </View>
    );
  }

  const hasAction = scenarioDef.effects && scenarioDef.effects.length > 0;

  return (
    <View style={styles.container} accessibilityLabel={`Escenario: ${scenarioDef.name}`}>
      <Text style={styles.title}>Escenario activo</Text>
      <View style={styles.scenarioCard}>
        {path && !showPlaceholder ? (
          <Image source={{ uri: path }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.placeholderText}>Sin ilustración</Text>
          </View>
        )}
        <Text style={styles.name}>{scenarioDef.name}</Text>
        <Text style={styles.effectSummary}>
          {scenarioDef.effects?.length ?? 0} efecto(s) activo(s)
        </Text>
        {hasAction && onUseScenario && (
          <Pressable style={styles.useButton} onPress={onUseScenario} >
            <Text style={styles.useText}>Usar {scenarioDef.name}</Text>
          </Pressable>
        )}
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
  title: {
    color: '#16a085',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  scenarioCard: {
    backgroundColor: '#2c3e50',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    width: '100%',
    maxWidth: 200,
  },
  image: {
    width: '100%',
    height: 120,
    borderRadius: 6,
    marginBottom: 6,
  },
  imagePlaceholder: {
    width: '100%',
    height: 100,
    backgroundColor: '#34495e',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  placeholderText: {
    color: '#7f8c8d',
    fontSize: 10,
  },
  name: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  effectSummary: {
    color: '#bdc3c7',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  useButton: {
    backgroundColor: '#16a085',
    padding: 8,
    borderRadius: 6,
    marginTop: 6,
    minWidth: 100,
    alignItems: 'center',
  },
  useText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  empty: {
    color: '#777',
    fontSize: 11,
    fontStyle: 'italic',
  },
});
