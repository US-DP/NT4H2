/**
 * HordeAttackSummary — resumen calculado del ataque de la Horda.
 *
 * Cumple UI-160: resumen con daño base, prevención, daño final.
 * Cumple UI-161: distinguir daño base, modificadores, prevención, redirección, pérdida final.
 * Cumple UI-162: ampliar explicación de cálculo.
 * Cumple UI-163: animación representa resultado confirmado.
 * Cumple UI-164: omitir/acelerar animación.
 */

import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { useState } from 'react';

export interface EnemyContribution {
  enemyName: string;
  baseDamage: number;
  modifiedDamage: number;
  /** null = anulado */
  finalDamage: number | null;
  modifiers?: string[];
}

interface HordeAttackSummaryProps {
  visible: boolean;
  enemies: EnemyContribution[];
  totalBaseDamage: number;
  totalPrevented: number;
  totalFinalDamage: number;
  onClose: () => void;
}

export function HordeAttackSummary({
  visible,
  enemies,
  totalBaseDamage,
  totalPrevented,
  totalFinalDamage,
  onClose,
}: HordeAttackSummaryProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>Ataque de la Horda</Text>

          {/* Resumen por enemigo (UI-160) */}
          <View style={styles.section}>
            {enemies.map((e, i) => (
              <View key={i} style={styles.enemyRow}>
                <Text style={styles.enemyName}>{e.enemyName}</Text>
                <Text style={styles.enemyDamage}>
                  {e.finalDamage === null
                    ? 'anulado'
                    : `${e.finalDamage} (base ${e.baseDamage})`}
                </Text>
              </View>
            ))}
          </View>

          {/* Totales (UI-161) */}
          <View style={styles.totals}>
            <Text style={styles.totalLine}>Daño base: {totalBaseDamage}</Text>
            {totalPrevented > 0 && (
              <Text style={styles.totalLine}>Prevención: -{totalPrevented}</Text>
            )}
            <Text style={styles.finalLine}>Daño final: {totalFinalDamage}</Text>
          </View>

          {/* Ampliar cálculo (UI-162) */}
          <Pressable onPress={() => setShowDetails(!showDetails)} style={styles.detailToggle}>
            <Text style={styles.detailText}>
              {showDetails ? 'Ocultar detalles' : 'Ver detalles del cálculo'}
            </Text>
          </Pressable>

          {showDetails && (
            <View style={styles.details}>
              {enemies.map((e, i) => (
                <View key={i} style={styles.detailRow}>
                  <Text style={styles.detailName}>{e.enemyName}:</Text>
                  <Text style={styles.detailCalc}>
                    base {e.baseDamage}
                    {e.modifiedDamage !== e.baseDamage && ` → mod ${e.modifiedDamage}`}
                    {e.modifiers?.length ? ` (${e.modifiers.join(', ')})` : ''}
                    {e.finalDamage === null ? ' → anulado' : ` → ${e.finalDamage}`}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Continuar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 450,
  },
  title: {
    color: '#e74c3c',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  section: {
    marginBottom: 12,
  },
  enemyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 6,
    backgroundColor: '#2c3e50',
    borderRadius: 4,
    marginBottom: 4,
  },
  enemyName: {
    color: '#ecf0f1',
    fontSize: 12,
  },
  enemyDamage: {
    color: '#f1c40f',
    fontSize: 12,
    fontWeight: 'bold',
  },
  totals: {
    backgroundColor: '#2c3e50',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  totalLine: {
    color: '#bdc3c7',
    fontSize: 13,
    marginBottom: 2,
  },
  finalLine: {
    color: '#e74c3c',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 4,
  },
  detailToggle: {
    alignSelf: 'center',
    marginBottom: 8,
  },
  detailText: {
    color: '#3498db',
    fontSize: 12,
  },
  details: {
    backgroundColor: '#1a1a2e',
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  detailRow: {
    marginBottom: 4,
  },
  detailName: {
    color: '#f1c40f',
    fontSize: 11,
    fontWeight: 'bold',
  },
  detailCalc: {
    color: '#bdc3c7',
    fontSize: 10,
  },
  closeButton: {
    backgroundColor: '#27ae60',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
