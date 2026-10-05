/**
 * HordePanel — mazo de horda y enemigo final.
 *
 * Muestra las cartas de horda restantes (progreso de la oleada) y la
 * proximidad del Señor de la Guerra sin revelar su identidad antes de
 * tiempo: el "enemigo final" siempre es un dorso hasta warlordRevealed.
 */

import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useGameStore } from '../store/gameStore';
import { spacing, radius, fontSize } from '../lib/theme';
import type { Colors } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';

export function HordePanel() {
  const { t } = useTranslation();
  const colors = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(colors, fs);
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);

  if (!gameState || !catalog) return null;

  const hordeCount = gameState.hordeDeck.length;
  const revealed = gameState.warlordRevealed;
  const warlordOnField = gameState.battlefield.find((e) => e.isWarlord);
  const warlordName = warlordOnField
    ? catalog.byId.get(warlordOnField.definitionId)?.name ?? t('hud.warlordFallback')
    : null;

  return (
    <View style={styles.container}>
      {/* Mazo de horda: cartas restantes de la oleada */}
      <View
        style={[styles.miniCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityLabel={t('hud.hordeDeckA11y', { count: hordeCount })}
      >
        <Text style={styles.miniTitle}>{t('hud.hordeDeckTitle')}</Text>
        <Text style={styles.skull}>☠</Text>
        <Text style={[styles.count, { color: colors.text, fontSize: fs(fontSize.body) }]}>
          {hordeCount}
        </Text>
      </View>

      {/* Enemigo final: dorso hasta que se revela */}
      <View
        style={[
          styles.miniCard,
          styles.warlordCard,
          { borderColor: revealed ? colors.danger : colors.border },
        ]}
        accessibilityLabel={
          warlordName
            ? t('hud.finalEnemyA11y', { name: warlordName })
            : t('hud.finalEnemyHiddenA11y')
        }
      >
        <Text style={styles.miniTitle}>{t('hud.finalEnemyTitle')}</Text>
        <Text style={[styles.skull, revealed && { color: colors.danger }]}>☠</Text>
        <Text style={[styles.warlordLabel, { color: revealed ? colors.danger : colors.textMuted, fontSize: fs(fontSize.detail) }]} numberOfLines={1}>
          {warlordName ?? (revealed ? t('hud.warlordRevealed') : t('hud.warlordUnrevealed'))}
        </Text>
      </View>
    </View>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  miniCard: {
    width: 96,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
    alignItems: 'center',
  },
  warlordCard: {
    backgroundColor: c.dangerSurface,
  },
  miniTitle: {
    color: c.textMuted,
    fontSize: fs(10),
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
    textAlign: 'center',
  },
  skull: {
    fontSize: fs(26),
    color: c.textMuted,
    marginBottom: 4,
  },
  count: {
    fontWeight: '800',
  },
  warlordLabel: {
    fontWeight: '600',
    textAlign: 'center',
  },
});
