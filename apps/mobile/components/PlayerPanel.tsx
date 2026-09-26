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

interface PlayerPanelProps {
  /** Al pulsar el nombre de un héroe, abre su detalle */
  onSelectHero?: (heroId: string) => void;
}

export function PlayerPanel({ onSelectHero }: PlayerPanelProps) {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const viewerId = useGameStore((s) => s.viewerId);

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
                accessibilityHint={t('hud.heroDetailHint')}
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
                  {t('hud.capabilitiesLabel', { list: capabilities.join(', ') })}
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
    fontStyle: 'italic',
    marginBottom: 4,
  },
  activePill: {
    backgroundColor: 'rgba(241,196,15,0.15)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
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
