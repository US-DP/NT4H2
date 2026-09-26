/**
 * DeckPanel — mazo de habilidades y pila de descartes del héroe.
 *
 * Van juntos porque representan el desgaste del héroe: cuando el mazo se
 * agota y se reconstruye desde el desgaste, el héroe sufre 1 herida.
 * El aviso aparece junto al mazo, no escondido en un menú.
 */

import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useGameStore } from '../store/gameStore';
import { spacing, radius, fontSize } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';

interface DeckPanelProps {
  /** Daño previsto de la horda para avisar si agotará el mazo */
  incomingDamage?: number;
}

export function DeckPanel({ incomingDamage = 0 }: DeckPanelProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const fs = useFs();
  const gameState = useGameStore((s) => s.gameState);
  const viewerId = useGameStore((s) => s.viewerId);

  if (!gameState) return null;

  const playerId = viewerId ?? gameState.activePlayerId;
  const player = gameState.players[playerId];
  if (!player) return null;

  const deckCount = player.abilityDeck.length;
  const wearCount = player.wearPile.length;
  const rebuildImminent = deckCount === 0 || (incomingDamage > 0 && incomingDamage >= deckCount);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.miniCard,
          { backgroundColor: colors.surface, borderColor: rebuildImminent ? colors.warning : colors.border },
          rebuildImminent && styles.miniCardWarn,
        ]}
        accessibilityLabel={`${t('panels.deckAbilityA11y', { count: deckCount })}${rebuildImminent ? t('panels.deckRebuildWarn') : ''}`}
      >
        <Text style={styles.miniTitle}>{t('panels.deckTitle')}</Text>
        <Text style={[styles.deckIcon]}>🂠</Text>
        <Text style={[styles.count, { color: rebuildImminent ? colors.warning : colors.text, fontSize: fs(fontSize.body) }]}>
          {deckCount}
        </Text>
        {rebuildImminent && (
          <Text style={[styles.warnText, { color: colors.warning, fontSize: fs(fontSize.micro) }]}>
            {t('panels.deckWoundWarn')}
          </Text>
        )}
      </View>

      <View
        style={[styles.miniCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityLabel={t('panels.discardA11y', { count: wearCount })}
      >
        <Text style={styles.miniTitle}>{t('panels.discardTitle')}</Text>
        <Text style={[styles.deckIcon, { color: colors.textMuted }]}>🂠</Text>
        <Text style={[styles.count, { color: colors.textMuted, fontSize: fs(fontSize.body) }]}>
          {wearCount}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignSelf: 'center',
  },
  miniCard: {
    width: 84,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
    alignItems: 'center',
  },
  miniCardWarn: {
    borderWidth: 2,
  },
  miniTitle: {
    color: '#92909D',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
    textAlign: 'center',
  },
  deckIcon: {
    fontSize: 22,
    marginBottom: 2,
    color: '#C5C3CB',
  },
  count: {
    fontWeight: '800',
  },
  warnText: {
    fontWeight: '700',
    marginTop: 2,
  },
});
