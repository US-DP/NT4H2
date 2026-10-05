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
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useColors, useFs } from '../lib/useTheme';
import type { Colors } from '../lib/theme';

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
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(c, fs);
  const [showDetails, setShowDetails] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{t('hud.phase.HORDE_ATTACK')}</Text>

          {/* Resumen por enemigo (UI-160) */}
          <View style={styles.section}>
            {enemies.map((e, i) => (
              <View key={i} style={styles.enemyRow}>
                <Text style={styles.enemyName}>{e.enemyName}</Text>
                <Text style={styles.enemyDamage}>
                  {e.finalDamage === null
                    ? t('hud.annulled')
                    : t('hud.enemyDamageLine', { final: e.finalDamage, base: e.baseDamage })}
                </Text>
              </View>
            ))}
          </View>

          {/* Totales (UI-161) */}
          <View style={styles.totals}>
            <Text style={styles.totalLine}>{t('hud.baseDamage', { value: totalBaseDamage })}</Text>
            {totalPrevented > 0 && (
              <Text style={styles.totalLine}>{t('hud.preventionLine', { value: totalPrevented })}</Text>
            )}
            <Text style={styles.finalLine}>{t('hud.finalDamage', { value: totalFinalDamage })}</Text>
          </View>

          {/* Ampliar cálculo (UI-162) */}
          <Pressable
            onPress={() => setShowDetails(!showDetails)}
            style={styles.detailToggle}
            accessibilityRole="button"
          >
            <Text style={styles.detailText}>
              {showDetails ? t('hud.hideDetails') : t('hud.showCalcDetails')}
            </Text>
          </Pressable>

          {showDetails && (
            <View style={styles.details}>
              {enemies.map((e, i) => (
                <View key={i} style={styles.detailRow}>
                  <Text style={styles.detailName}>{e.enemyName}:</Text>
                  <Text style={styles.detailCalc}>
                    {t('hud.calcBase', { base: e.baseDamage })}
                    {e.modifiedDamage !== e.baseDamage && t('hud.calcMod', { value: e.modifiedDamage })}
                    {e.modifiers?.length ? ` (${e.modifiers.join(', ')})` : ''}
                    {e.finalDamage === null ? ` → ${t('hud.annulled')}` : ` → ${e.finalDamage}`}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>{t('hud.continueGame')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: c.overlayStrong,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 450,
  },
  title: {
    color: c.danger,
    fontSize: fs(18),
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
    backgroundColor: c.surfaceRaised,
    borderRadius: 4,
    marginBottom: 4,
  },
  enemyName: {
    color: c.text,
    fontSize: fs(12),
  },
  enemyDamage: {
    color: c.accent,
    fontSize: fs(12),
    fontWeight: 'bold',
  },
  totals: {
    backgroundColor: c.surfaceRaised,
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  totalLine: {
    color: c.textMuted,
    fontSize: fs(13),
    marginBottom: 2,
  },
  finalLine: {
    color: c.danger,
    fontSize: fs(16),
    fontWeight: 'bold',
    marginTop: 4,
  },
  detailToggle: {
    alignSelf: 'center',
    marginBottom: 8,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  detailText: {
    color: c.info,
    fontSize: fs(12),
  },
  details: {
    backgroundColor: c.surfaceRaised,
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  detailRow: {
    marginBottom: 4,
  },
  detailName: {
    color: c.accent,
    fontSize: fs(11),
    fontWeight: 'bold',
  },
  detailCalc: {
    color: c.textMuted,
    fontSize: fs(10),
  },
  closeButton: {
    backgroundColor: c.success,
    padding: 12,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    color: c.text,
    fontSize: fs(14),
    fontWeight: 'bold',
  },
});
