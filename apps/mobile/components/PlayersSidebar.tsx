/**
 * PlayersSidebar — lista vertical compacta de jugadores (columna izquierda).
 *
 * Cada fila muestra: clase (borde de color), héroe, heridas, escudos,
 * monedas, gloria y estado de turno. El jugador activo se destaca con
 * borde dorado y etiqueta "En turno" (no solo por color).
 */

import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useGameStore } from '../store/gameStore';
import { spacing, radius, fontSize } from '../lib/theme';
import type { Colors } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';
import { classColor as heroClassColor } from '../lib/classTokens';

interface PlayersSidebarProps {
  onSelectHero?: (heroId: string) => void;
}

export function PlayersSidebar({ onSelectHero }: PlayersSidebarProps) {
  const { t } = useTranslation();
  const colors2 = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(colors2, fs);
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const viewerId = useGameStore((s) => s.viewerId);

  if (!gameState || !catalog) return null;

  const playerOrder = gameState.playerOrder ?? Object.keys(gameState.players);

  return (
    <ScrollView style={styles.container} accessibilityLabel={t('hud.playersListA11y')}>
      <Text style={[styles.heading, { color: colors2.textMuted, fontSize: fs(fontSize.micro) }]}>
        {t('hud.playersHeading')}
      </Text>
      {playerOrder.map((playerId, index) => {
        const player = gameState.players[playerId];
        if (!player) return null;
        const heroDef = catalog.byId.get(player.heroId);
        const isActive = playerId === gameState.activePlayerId;
        const isViewer = playerId === viewerId;
        const isEliminated = player.wounds >= player.maxWounds;
        const classColor = heroClassColor(heroDef?.heroClass) ?? colors2.border;

        return (
          <Pressable
            key={playerId}
            onPress={() => onSelectHero?.(player.heroId)}
            disabled={!onSelectHero}
            accessibilityRole="button"
            accessibilityState={{ disabled: !onSelectHero }}
            accessibilityLabel={
              t('hud.playerRowA11y', {
                name: heroDef?.name ?? '???',
                wounds: player.wounds,
                maxWounds: player.maxWounds,
                glory: player.glory,
              })
              + (isActive ? t('hud.playerInTurn') : '')
              + (isEliminated ? t('hud.playerEliminatedSuffix') : '')
            }
            style={[
              styles.row,
              { backgroundColor: colors2.surface, borderLeftColor: classColor },
              isActive && styles.rowActive,
              isEliminated && styles.rowEliminated,
              !onSelectHero && styles.rowDisabled,
            ]}
          >
            <View style={styles.rowHeader}>
              <Text style={[styles.order, { color: colors2.textFaint, fontSize: fs(fontSize.micro) }]}>
                {index + 1}
              </Text>
              <Text style={[styles.heroName, { color: colors2.text, fontSize: fs(fontSize.body) }]} numberOfLines={1}>
                {heroDef?.name ?? '???'}
                {isViewer ? t('hud.youSuffix') : ''}
              </Text>
              {isActive && (
                <View style={styles.turnPill}>
                  <Text style={[styles.turnPillText, { fontSize: fs(fontSize.micro) }]}>{t('hud.inTurn')}</Text>
                </View>
              )}
              {isEliminated && <Text style={styles.eliminated}>✕</Text>}
            </View>
            <View style={styles.rowStats}>
              <Text style={[styles.stat, { color: colors2.danger, fontSize: fs(fontSize.detail) }]}>
                ♥ {player.wounds}/{player.maxWounds}
              </Text>
              <Text style={[styles.stat, { color: colors2.info, fontSize: fs(fontSize.detail) }]}>
                🛡 {player.shields}
              </Text>
              <Text style={[styles.stat, { color: colors2.gameCoin, fontSize: fs(fontSize.detail) }]}>
                ● {player.coins}
              </Text>
              <Text style={[styles.stat, { color: colors2.accent, fontSize: fs(fontSize.detail) }]}>
                ★ {player.glory}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.sm,
  },
  heading: {
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  row: {
    borderRadius: radius.md,
    borderLeftWidth: 4,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 44,
  },
  rowActive: {
    borderColor: c.borderSelected,
    backgroundColor: c.surfaceInteractiveSelected,
  },
  rowEliminated: {
    opacity: 0.45,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  order: {
    fontWeight: '700',
    width: 14,
  },
  heroName: {
    fontWeight: '700',
    flex: 1,
  },
  turnPill: {
    backgroundColor: c.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  turnPillText: {
    color: c.textOnAccent,
    fontWeight: '800',
  },
  eliminated: {
    color: c.danger,
    fontWeight: '800',
    fontSize: fs(14),
  },
  rowStats: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingLeft: 20,
  },
  stat: {
    fontWeight: '600',
  },
});
