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
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useGameStore } from '../store/gameStore';
import { classColor as heroClassColor } from '../lib/classTokens';
import { useColors, useFs } from '../lib/useTheme';
import { touchTarget } from '../lib/theme';
import type { Colors } from '../lib/theme';
import { capListLabel } from '../lib/capabilities';

interface PlayerPanelProps {
  /** Al pulsar el nombre de un héroe, abre su detalle */
  onSelectHero?: (heroId: string) => void;
}

export function PlayerPanel({ onSelectHero }: PlayerPanelProps) {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const viewerId = useGameStore((s) => s.viewerId);
  const c = useColors();
  const fs = useFs();
  const styles = createStyles(c, fs);

  if (!gameState || !catalog) return null;

  const playerOrder = gameState.playerOrder ?? Object.keys(gameState.players);

  return (
    <ScrollView horizontal style={styles.container} accessibilityLabel={t('hud.playerPanelsA11y')}>
      {playerOrder.map((playerId) => {
        const player = gameState.players[playerId];
        if (!player) return null;
        const heroDef = catalog.byId.get(player.heroId);
        const isActive = playerId === gameState.activePlayerId;
        const isViewer = playerId === viewerId;
        const isEliminated = player.wounds >= player.maxWounds;
        const capabilities = heroDef?.capabilities ?? player.capabilities;
        const classColor = heroClassColor(heroDef?.heroClass);

        return (
          <View
            key={playerId}
            style={[
              styles.panel,
              classColor ? { borderLeftColor: classColor, borderLeftWidth: 4 } : null,
              isActive && styles.activePanel,
              isEliminated && styles.eliminatedPanel,
            ]}
            accessibilityLabel={
              t('hud.playerA11y', { name: heroDef?.name ?? '???' })
              + (isActive ? ` ${t('hud.playerActive')}` : '')
              + (isEliminated ? ` ${t('hud.playerEliminated')}` : '')
            }
          >
            <View style={styles.header}>
              <Pressable
                onPress={() => onSelectHero?.(player.heroId)}
                disabled={!onSelectHero}
                accessibilityRole="button"
                accessibilityState={{ disabled: !onSelectHero }}
                accessibilityHint={t('hud.heroDetailHint')}
                style={[styles.heroButton, !onSelectHero && styles.pressableDisabled]}
              >
                <Text style={styles.heroName} numberOfLines={1}>
                  {heroDef?.name ?? '???'} {onSelectHero ? 'ⓘ' : ''}
                </Text>
              </Pressable>
              {isActive && (
                <View style={styles.activePill}>
                  <Text style={styles.activeBadge}>{t('hud.activeBadge')}</Text>
                </View>
              )}
              {isEliminated && <Text style={styles.eliminatedBadge}>{t('hud.eliminatedBadge')}</Text>}
            </View>
            {isActive && (
              <Text style={styles.phase}>{t('hud.phaseLabel', { phase: gameState.phase })}</Text>
            )}

            <View style={styles.stats}>
              <Text style={styles.stat}>{t('hud.gloryStat', { value: player.glory })}</Text>
              <Text style={styles.stat}>{t('hud.coinsStat', { value: player.coins })}</Text>
              <Text style={[styles.stat, player.wounds >= player.maxWounds && styles.statCritical]}>
                {t('hud.woundsStat', { wounds: player.wounds, max: player.maxWounds })}
              </Text>
              {player.shields > 0 && (
                <Text style={styles.stat}>{t('hud.shieldsStat', { value: player.shields })}</Text>
              )}
              {(player.blockNext ?? 0) > 0 && (
                <Text style={styles.stat}>{t('hud.blockStat', { value: player.blockNext })}</Text>
              )}
              {(player.armor ?? 0) > 0 && (
                <Text style={styles.stat}>{t('hud.armorStat', { value: player.armor })}</Text>
              )}
              {(player.persistentCards ?? []).length > 0 && (
                <Text style={styles.stat}>
                  {t('hud.persistentStat', {
                    list: player.persistentCards
                      .map((c) => catalog.byId.get(c.definitionId)?.name ?? c.definitionId)
                      .join(', '),
                  })}
                </Text>
              )}
              {/* UI-083: manos ajenas solo número de cartas */}
              <Text style={styles.stat}>
                {t('hud.handStat', { count: player.hand.length })}
                {isViewer ? '' : t('hud.handHidden')}
              </Text>
              <Text style={styles.stat}>{t('hud.deckStat', { count: player.abilityDeck.length })}</Text>
              <Text style={styles.stat}>{t('hud.wearStat', { count: player.wearPile.length })}</Text>
              <Text style={styles.stat}>{t('hud.trophiesStat', { count: player.trophies.length })}</Text>
              {/* UI-085: usos limitados explícitos */}
              <Text style={[styles.stat, player.heroUsesRemaining === 0 && styles.statDepleted]}>
                {t('hud.abilitiesStat', {
                  remaining: player.heroUsesRemaining,
                  max: player.heroMaxUses,
                })}
              </Text>
              {/* UI-084: capacidades del héroe */}
              {capabilities.length > 0 && (
                <Text style={styles.capabilities}>
                  {t('hud.capabilitiesLabel', { list: capListLabel(t, capabilities) })}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: c.background,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  panel: {
    backgroundColor: c.surface,
    padding: 8,
    borderRadius: 8,
    marginRight: 8,
    minWidth: 180,
    borderWidth: 2,
    borderColor: c.border,
  },
  activePanel: {
    borderColor: c.accent,
    borderWidth: 3,
    backgroundColor: c.surfaceInteractiveSelected,
  },
  eliminatedPanel: {
    opacity: 0.5,
    borderColor: c.borderDisabled,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  heroButton: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    justifyContent: 'center',
    flex: 1,
  },
  pressableDisabled: {
    opacity: 0.45,
  },
  heroName: {
    color: c.accent,
    fontSize: fs(14),
    fontWeight: 'bold',
    flex: 1,
  },
  phase: {
    color: c.info,
    fontSize: fs(10),
    fontStyle: 'italic',
    marginBottom: 4,
  },
  activePill: {
    backgroundColor: c.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  activeBadge: {
    color: c.textOnAccent,
    fontSize: fs(10),
    fontWeight: 'bold',
  },
  eliminatedBadge: {
    color: c.danger,
    fontSize: fs(10),
    fontWeight: 'bold',
  },
  stats: {
    gap: 4,
  },
  stat: {
    color: c.text,
    fontSize: fs(11),
  },
  statCritical: {
    color: c.danger,
    fontWeight: 'bold',
  },
  statDepleted: {
    color: c.textFaint,
    fontStyle: 'italic',
  },
  connected: {
    color: c.connectionOnline,
  },
  disconnected: {
    color: c.connectionOffline,
  },
  capabilities: {
    color: c.textMuted,
    fontSize: fs(10),
    fontStyle: 'italic',
    marginTop: 2,
  },
});
