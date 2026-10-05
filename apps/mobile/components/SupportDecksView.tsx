/**
 * SupportDecksView — mazos de Apoyo del modo SOLO (spec §4.1/§4.2).
 *
 * - Apertura secuencial durante la fase de Ataque: costes 3/5/6 monedas.
 * - Robar carta de un mazo abierto: 2 Gloria o 5 monedas la primera,
 *   +1 Gloria / +2 monedas por carta extra en el mismo turno.
 * - Solo un mazo usable por turno (lo fija supportDeckIndexUsedThisTurn).
 * - Las cartas robadas se devuelven al mazo al final del turno
 *   (borrowedSupportCardIds — ver solo.ts).
 *
 * Solo se renderiza en SOLO para el jugador del viewer.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useGameStore } from '../store/gameStore';
import { useColors, useFs } from '../lib/useTheme';
import { touchTarget } from '../lib/theme';
import type { Colors } from '../lib/theme';
import { playUi } from '../lib/audio';
import { announceA11y } from '../lib/a11y';

// Coste de apertura por orden (spec §4.1): 3, 5, 6 monedas
const OPEN_COSTS = [3, 5, 6];

export function SupportDecksView() {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const viewerId = useGameStore((s) => s.viewerId);
  const openSupportDeck = useGameStore((s) => s.openSupportDeck);
  const buySupportCard = useGameStore((s) => s.buySupportCard);
  const c = useColors();
  const fs = useFs();
  const styles = createStyles(c, fs);

  if (!gameState || gameState.mode !== 'SOLO') return null;

  const playerId = viewerId ?? gameState.activePlayerId;
  const player = gameState.players[playerId];
  const decks = player?.supportDecks ?? [];
  if (!player || decks.length === 0) return null;

  // spec §4.2: solo durante la fase de Ataque y en el propio turno
  const attackPhase = gameState.phase === 'PLAYER_ATTACK' || gameState.phase === 'ATTACK_CHOICE';
  const myTurn = playerId === gameState.activePlayerId;
  const active = attackPhase && myTurn;

  const openedCount = player.supportDecksOpened ?? 0;
  const drawnThisTurn = player.supportCardsDrawnThisTurn ?? 0;
  const usedIndex = player.supportDeckIndexUsedThisTurn ?? null;
  const gloryCost = 2 + drawnThisTurn;
  const coinsCost = 5 + drawnThisTurn * 2;

  return (
    <View style={styles.container} accessibilityLabel={t('gm.supportsA11y')}>
      <Text style={styles.title}>{t('gm.supportsTitle')}</Text>
      {decks.map((deck, i) => {
        const opened = i < openedCount;
        const nextToOpen = i === openedCount;
        const openCost = OPEN_COSTS[i] ?? OPEN_COSTS[OPEN_COSTS.length - 1];
        const otherDeckUsed = usedIndex !== null && usedIndex !== i;
        const canBuyGlory = active && opened && deck.length > 0 && !otherDeckUsed && player.glory >= gloryCost;
        const canBuyCoins = active && opened && deck.length > 0 && !otherDeckUsed && player.coins >= coinsCost;
        const canOpen = active && nextToOpen && player.coins >= openCost;

        return (
          <View key={i} style={styles.deckRow}>
            <Text style={styles.deckLabel}>
              {t('gm.supportDeckLabel', { n: i + 1, count: deck.length })}
            </Text>
            {opened ? (
              <View style={styles.deckActions}>
                <Pressable
                  style={[styles.deckButton, !canBuyGlory && styles.deckButtonDisabled]}
                  disabled={!canBuyGlory}
                  onPress={() => {
                    buySupportCard(i, 'GLORY');
                    playUi('buy');
                    announceA11y(t('gm.supportBuyA11y', { n: i + 1 }));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('gm.supportPayGloryA11y', { n: i + 1, cost: gloryCost })}
                  accessibilityState={{ disabled: !canBuyGlory }}
                >
                  <Text style={styles.deckButtonText}>
                    {t('gm.supportPayGlory', { cost: gloryCost })}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.deckButton, !canBuyCoins && styles.deckButtonDisabled]}
                  disabled={!canBuyCoins}
                  onPress={() => {
                    buySupportCard(i, 'COINS');
                    playUi('buy');
                    announceA11y(t('gm.supportBuyA11y', { n: i + 1 }));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('gm.supportPayCoinsA11y', { n: i + 1, cost: coinsCost })}
                  accessibilityState={{ disabled: !canBuyCoins }}
                >
                  <Text style={styles.deckButtonText}>
                    {t('gm.supportPayCoins', { cost: coinsCost })}
                  </Text>
                </Pressable>
              </View>
            ) : nextToOpen ? (
              <Pressable
                style={[styles.deckButton, !canOpen && styles.deckButtonDisabled]}
                disabled={!canOpen}
                onPress={() => {
                  openSupportDeck(i);
                  playUi('buy');
                  announceA11y(t('gm.supportOpenA11y', { n: i + 1 }));
                }}
                accessibilityRole="button"
                accessibilityLabel={t('gm.supportOpenLabelA11y', { n: i + 1, cost: openCost })}
                accessibilityState={{ disabled: !canOpen }}
              >
                <Text style={styles.deckButtonText}>
                  {t('gm.supportOpenLabel', { cost: openCost })}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.deckLocked}>{t('gm.supportLocked')}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  title: {
    color: c.accent,
    fontSize: fs(13),
    fontWeight: 'bold',
    marginBottom: 6,
  },
  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  deckLabel: {
    color: c.text,
    fontSize: fs(12),
    fontWeight: 'bold',
  },
  deckActions: {
    flexDirection: 'row',
    gap: 8,
  },
  deckButton: {
    backgroundColor: c.surfaceInteractive,
    borderColor: c.accent,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: touchTarget,
    justifyContent: 'center',
  },
  deckButtonDisabled: {
    opacity: 0.45,
  },
  deckButtonText: {
    color: c.text,
    fontSize: fs(12),
    fontWeight: 'bold',
  },
  deckLocked: {
    color: c.textMuted,
    fontSize: fs(11),
    fontStyle: 'italic',
  },
});
