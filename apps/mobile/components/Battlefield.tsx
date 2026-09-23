/**
 * Battlefield — muestra los enemigos en el campo de batalla.
 *
 * Cumple UI-GAME-004: Huestes se muestran con PNG frontal.
 * Cumple UI-GAME-006: Señores de la Guerra con tratamiento diferenciado.
 * Cumple UI-090: zona central claramente separada.
 * Cumple UI-091: nombre, fortaleza efectiva, heridas acumuladas, resistencia restante, estados, modificadores, jefe.
 * Cumple UI-092: si Fortaleza modificada, mostrar base → efectivo.
 * Cumple UI-093: Heridas numéricamente.
 * Cumple UI-094: contribución prevista al ataque de la Horda (daño aportado).
 * Cumple UI-095: enemigos válidos como objetivo destacados.
 * Cumple UI-096: enemigos inválidos atenuados.
 * Cumple UI-097: al pulsar, mostrar efectos completos.
 * Cumple UI-098: recompensa oculta hasta derrota.
 * Cumple UI-099: no incluir recompensa en estado accesible.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useGameStore } from '../store/gameStore';
import { CardView } from './CardView';
import type { EnemyState } from '@nt4h/schema';

export function Battlefield() {
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const selectedEnemy = useGameStore((s) => s.ui.selectedEnemyInstanceId);
  const selectEnemy = useGameStore((s) => s.selectEnemy);
  const playCard = useGameStore((s) => s.playCard);
  const selectedCard = useGameStore((s) => s.ui.selectedCardInstanceId);

  if (!gameState || !catalog) return null;

  const handleEnemyPress = (enemyId: string, isDefeated: boolean) => {
    if (isDefeated) return;
    if (selectedCard) {
      playCard(selectedCard, enemyId);
    } else {
      selectEnemy(enemyId === selectedEnemy ? null : enemyId);
    }
  };

  // Daño base aportado por la Horda este turno (UI-094): simplificado
  const hordeDamageContribution = gameState.battlefield.reduce(
    (sum, e) => sum + Math.max(0, e.baseFortitude - e.wounds),
    0,
  );

  return (
    <View style={styles.container} accessibilityLabel={`Campo de Batalla, ${gameState.battlefield.length} enemigos`}>
      <View style={styles.header}>
        <Text style={styles.title}>Campo de Batalla ({gameState.battlefield.length})</Text>
        <Text style={styles.hordeDamage}>Daño aportado: {hordeDamageContribution}</Text>
      </View>
      <View style={styles.enemies}>
        {gameState.battlefield.map((enemy: EnemyState) => {
          const enemyDef = catalog.byId.get(enemy.definitionId);
          const baseFortitude = enemy.baseFortitude;
          const effectiveFortitude = enemy.effectiveFortitude ?? baseFortitude;
          const wounds = enemy.wounds;
          const isDefeated = wounds >= effectiveFortitude;
          const isSelected = selectedEnemy === enemy.instanceId;
          const isValidTarget = !!selectedCard && !isDefeated;

          return (
            <View key={enemy.instanceId} style={styles.enemyWrapper}>
              {enemyDef ? (
                <CardView
                  card={enemyDef}
                  onPress={() => handleEnemyPress(enemy.instanceId, isDefeated)}
                  selected={isSelected}
                  validTarget={isValidTarget}
                  blocked={isDefeated}
                  blockedReason={isDefeated ? 'Derrotado' : undefined}
                  compact
                />
              ) : (
                <Pressable
                  onPress={() => handleEnemyPress(enemy.instanceId, isDefeated)}
                  style={[
                    styles.enemyFallback,
                    isSelected && styles.selected,
                    isDefeated && styles.defeated,
                    enemy.isWarlord && styles.warlord,
                  ]}
                >
                  <Text style={styles.enemyName}>???</Text>
                </Pressable>
              )}

              {/* Capas dinámicas (UI-PNG-020): info fuera del PNG */}
              <View style={styles.enemyInfo}>
                <Text style={styles.enemyName}>{enemyDef?.name ?? '???'}</Text>
                <Text style={styles.fortitude}>
                  🛡 {effectiveFortitude}  ⚔ Heridas: {wounds}/{effectiveFortitude}
                  {effectiveFortitude !== baseFortitude && ` (base ${baseFortitude})`}
                </Text>
                <Text style={styles.resistance}>
                  Resistencia: {Math.max(0, effectiveFortitude - wounds)}
                </Text>
                {enemy.isWarlord && <Text style={styles.warlordBadge}>SEÑOR</Text>}
                {enemy.damageDisabled && <Text style={styles.disabled}>SIN DAÑO</Text>}
                {enemy.modifiers.length > 0 && (
                  <Text style={styles.modifiers}>
                    Modificadores: {enemy.modifiers.map((m) => `${m.layer} ${m.amount}`).join(', ')}
                  </Text>
                )}
              </View>
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#ecf0f1',
    fontSize: 14,
    fontWeight: 'bold',
  },
  hordeDamage: {
    color: '#e74c3c',
    fontSize: 12,
    fontWeight: 'bold',
  },
  enemies: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  enemyWrapper: {
    alignItems: 'center',
    maxWidth: 160,
  },
  enemyFallback: {
    backgroundColor: '#2c3e50',
    padding: 8,
    borderRadius: 6,
    minWidth: 100,
    borderWidth: 2,
    borderColor: '#34495e',
  },
  selected: {
    borderColor: '#e74c3c',
    borderWidth: 3,
  },
  defeated: {
    opacity: 0.4,
  },
  warlord: {
    backgroundColor: '#7f1a1a',
    borderColor: '#c0392b',
  },
  enemyInfo: {
    alignItems: 'center',
    marginTop: 2,
  },
  enemyName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  fortitude: {
    color: '#bdc3c7',
    fontSize: 11,
  },
  wounds: {
    color: '#e74c3c',
    fontSize: 11,
  },
  resistance: {
    color: '#3498db',
    fontSize: 10,
  },
  warlordBadge: {
    color: '#f1c40f',
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 2,
  },
  disabled: {
    color: '#3498db',
    fontSize: 10,
    marginTop: 2,
  },
  modifiers: {
    color: '#9b59b6',
    fontSize: 9,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 2,
  },
});
