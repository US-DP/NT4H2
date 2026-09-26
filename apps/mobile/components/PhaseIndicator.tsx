/**
 * PhaseIndicator — muestra la fase actual con indicador de progreso.
 *
 * Cumple UI-071: la fase se representa con texto e indicador de progreso
 *               (Ataque → Mercado → Restablecimiento).
 * Cumple UI-072: la fase activa tiene mayor contraste.
 * Cumple UI-P02: estado visible permanente.
 *
 * Iconos lucide (SVG) en lugar de emojis — identidad visual estable en
 * cualquier SO/navegador y colores reactivos al tema.
 */

import { View, Text, StyleSheet, Platform } from 'react-native';
import { Swords, Coins, RotateCcw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import type { Phase } from '@nt4h/schema';
import { PHASE_LABELS } from '../lib/phaseLabels';
import { useColors } from '../lib/useTheme';
import type { Colors } from '../lib/theme';

// Re-export para compatibilidad con imports existentes
export { PHASE_LABELS };

interface PhaseIndicatorProps {
  phase: Phase;
  turnNumber?: number;
}

const PHASES: { key: string; labelKey: string; Icon: typeof Swords }[] = [
  { key: 'PLAYER_ATTACK', labelKey: 'hud.phase.PLAYER_ATTACK', Icon: Swords },
  { key: 'MARKET', labelKey: 'hud.phase.MARKET', Icon: Coins },
  { key: 'RESTORATION', labelKey: 'hud.phase.RESTORATION', Icon: RotateCcw },
];

export function PhaseIndicator({ phase, turnNumber }: PhaseIndicatorProps) {
  const { t } = useTranslation();
  const c = useColors();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(c);
  const hiddenA11y =
    Platform.OS !== 'web'
      ? { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const }
      : {};

  // Fases especiales fuera del flujo principal
  if (!['PLAYER_ATTACK', 'MARKET', 'RESTORATION'].includes(phase)) {
    return (
      <View style={styles.container}>
        <Text style={styles.specialPhase}>{t(`hud.phase.${phase}`, { defaultValue: phase })}</Text>
        {turnNumber !== undefined && (
          <Text style={styles.round}>{t('hud.turnShort', { number: turnNumber })}</Text>
        )}
      </View>
    );
  }

  const activeIndex = PHASES.findIndex((p) => p.key === phase);

  return (
    <View
      style={styles.container}
      accessibilityLabel={t('hud.phaseLabel', {
        phase: t(`hud.phase.${phase}`, { defaultValue: phase }),
      })}
    >
      {turnNumber !== undefined && (
        <Text style={styles.round}>{t('hud.turnShort', { number: turnNumber })}</Text>
      )}
      <View style={styles.phases}>
        {PHASES.map((p, i) => {
          const isActive = i === activeIndex;
          const isPast = i < activeIndex;
          const iconColor = isActive ? c.accent : isPast ? c.textMuted : c.textFaint;
          return (
            <View key={p.key} style={styles.phaseItem}>
              <p.Icon size={isActive ? 14 : 12} color={iconColor} {...hiddenA11y} />
              <Text
                style={[
                  styles.phaseText,
                  isActive && styles.phaseActive,
                  isPast && styles.phasePast,
                ]}
              >
                {t(p.labelKey)}
              </Text>
              {i < PHASES.length - 1 && (
                <Text style={[styles.arrow, isPast && styles.arrowPast]}>→</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (c: Colors) => StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    alignItems: 'center',
  },
  round: {
    color: c.textMuted,
    fontSize: 11,
    marginBottom: 4,
  },
  phases: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phaseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phaseText: {
    color: c.textFaint,
    fontSize: 12,
    fontWeight: 'normal',
  },
  phaseActive: {
    color: c.accent,
    fontSize: 14,
    fontWeight: 'bold',
  },
  phasePast: {
    color: c.textMuted,
  },
  arrow: {
    color: c.textFaint,
    fontSize: 12,
    marginHorizontal: 2,
  },
  arrowPast: {
    color: c.textMuted,
  },
  specialPhase: {
    color: c.accent,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
