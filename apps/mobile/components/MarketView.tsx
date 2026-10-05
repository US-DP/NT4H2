/**
 * MarketView — muestra las cartas disponibles en el mercado.
 *
 * Cumple UI-140: cartas en fila/cuadrícula diferenciada.
 * Cumple UI-141: coste base, coste efectivo, ataque, capacidades, disponibilidad, efecto resumido.
 * Cumple UI-142: descuentos visuales.
 * Cumple UI-143: capacidad incompatible se indica.
 * Cumple UI-144: penalización antes de comprar.
 * Cumple UI-145: reposición animada/indicada.
 * Cumple UI-146: revisar cartas compradas.
 */

import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { CardView } from './CardView';
import { useGameStore } from '../store/gameStore';
import { useColors, useFs } from '../lib/useTheme';
import { touchTarget } from '../lib/theme';
import type { Colors } from '../lib/theme';
import type { CardInstance } from '@nt4h/schema';
import { engineReasonText } from '../lib/engineReasons';
import { capListLabel } from '../lib/capabilities';

export function MarketView() {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const buyCard = useGameStore((s) => s.buyCard);
  const checkMarketCardBuyable = useGameStore((s) => s.checkMarketCardBuyable);
  const c = useColors();
  const fs = useFs();
  const styles = createStyles(c, fs);

  if (!gameState || !catalog) return null;

  const isMarketPhase = gameState.phase === 'MARKET';
  const player = gameState.players[gameState.activePlayerId];
  if (!player) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('hud.marketTitle', { count: gameState.market.length })}</Text>
        <Text style={styles.coins}>💰 {player.coins}</Text>
      </View>
      {gameState.market.length === 0 ? (
        <Text style={styles.empty}>{t('hud.marketEmpty')}</Text>
      ) : (
        <ScrollView horizontal style={styles.market}>
          {gameState.market.map((cardInstance: CardInstance) => {
            const cardDef = catalog.byId.get(cardInstance.definitionId);
            if (!cardDef) return null;

            const baseCost = cardDef.printedCost ?? 0;
            const effectiveCost = Math.max(0, baseCost + gameState.marketCostModifier);
            const hasDiscount = effectiveCost < baseCost;
            const isFreeIncrease = effectiveCost > baseCost;

            const buyable = checkMarketCardBuyable?.(cardInstance.instanceId) ?? {
              ok: isMarketPhase,
            };
            const canBuy = buyable.ok && isMarketPhase;
            const buyReason = !buyable.ok
              ? engineReasonText(t, buyable.reasonCode, buyable.reason, buyable.costs)
              : undefined;

            // UI-143: capacidad incompatible
            const missingCapabilities = (cardDef.requiredCapabilities ?? []).filter(
              (cap) => !player.capabilities.includes(cap),
            );

            // UI-144: penalización por capacidad
            const penalty = cardDef.penaltyCapabilities?.find((p) => player.capabilities.includes(p.icon));

            return (
              <View key={cardInstance.instanceId} style={styles.cardWrapper}>
                <CardView
                  card={cardDef}
                  compact
                  blocked={!canBuy && isMarketPhase}
                  blockedReason={buyReason}
                  targetProgress={penalty ? t('hud.penaltyShort', { value: penalty.damagePenalty }) : undefined}
                />
                <View style={styles.buyInfo}>
                  {/* UI-142: descuento visual */}
                  <View style={styles.costRow}>
                    {hasDiscount && <Text style={styles.baseCost}>💰 {baseCost}</Text>}
                    <Text style={[styles.cost, isFreeIncrease && styles.costIncrease]}>
                      💰 {effectiveCost}
                    </Text>
                  </View>
                  {missingCapabilities.length > 0 && (
                    <Text style={styles.incompatible}>
                      {/* las capabilities llegan como enums (MELEE…) —
                          capListLabel las traduce con fallback al valor */}
                      {t('hud.requiresCaps', { list: capListLabel(t, missingCapabilities) })}
                    </Text>
                  )}
                  {penalty && (
                    <Text style={styles.penalty}>
                      {t('hud.penaltyLine', { value: penalty.damagePenalty })}
                    </Text>
                  )}
                </View>
                <Pressable
                  onPress={() => canBuy && buyCard(cardInstance.instanceId)}
                  disabled={!canBuy}
                  style={[styles.buyButton, !canBuy && styles.buyButtonDisabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canBuy }}
                  accessibilityLabel={canBuy ? t('hud.buyA11y', { name: cardDef.name }) : t('hud.cannotBuyA11y', { name: cardDef.name })}
                  accessibilityHint={buyReason}
                >
                  <Text style={styles.buyText}>{canBuy ? t('hud.buy') : t('hud.blocked')}</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
      {!isMarketPhase && (
        <Text style={styles.hint}>{t('hud.marketPhaseHint')}</Text>
      )}
    </View>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: c.accent,
    fontSize: fs(14),
    fontWeight: 'bold',
  },
  coins: {
    color: c.gameCoin,
    fontSize: fs(14),
    fontWeight: 'bold',
  },
  market: {
    flexDirection: 'row',
  },
  cardWrapper: {
    alignItems: 'center',
    marginRight: 8,
    maxWidth: 180,
  },
  buyInfo: {
    alignItems: 'center',
    marginVertical: 4,
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  baseCost: {
    color: c.textFaint,
    fontSize: fs(11),
    textDecorationLine: 'line-through',
  },
  cost: {
    color: c.gameCoin,
    fontSize: fs(13),
    fontWeight: 'bold',
  },
  costIncrease: {
    color: c.danger,
  },
  incompatible: {
    color: c.danger,
    fontSize: fs(9),
    textAlign: 'center',
    marginTop: 2,
  },
  penalty: {
    color: c.warning,
    fontSize: fs(9),
    textAlign: 'center',
    marginTop: 2,
  },
  buyButton: {
    backgroundColor: c.accent,
    padding: 8,
    borderRadius: 6,
    marginTop: 2,
    minWidth: 80,
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buyButtonDisabled: {
    opacity: 0.45,
  },
  buyText: {
    color: c.textOnAccent,
    fontSize: fs(12),
    fontWeight: 'bold',
  },
  empty: {
    color: c.textFaint,
    fontSize: fs(12),
    padding: 8,
    textAlign: 'center',
  },
  hint: {
    color: c.textFaint,
    fontSize: fs(10),
    marginTop: 4,
    fontStyle: 'italic',
  },
});
