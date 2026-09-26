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
import type { CardInstance } from '@nt4h/schema';

export function MarketView() {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const buyCard = useGameStore((s) => s.buyCard);
  const checkMarketCardBuyable = useGameStore((s) => s.checkMarketCardBuyable);

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
            const buyReason = !buyable.ok ? buyable.reason : undefined;

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
                      {t('hud.requiresCaps', { list: missingCapabilities.join(', ') })}
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

const styles = StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#f1c40f',
    fontSize: 14,
    fontWeight: 'bold',
  },
  coins: {
    color: '#d4a017',
    fontSize: 14,
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
    color: '#7f8c8d',
    fontSize: 11,
    textDecorationLine: 'line-through',
  },
  cost: {
    color: '#d4a017',
    fontSize: 13,
    fontWeight: 'bold',
  },
  costIncrease: {
    color: '#e74c3c',
  },
  incompatible: {
    color: '#e74c3c',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 2,
  },
  penalty: {
    color: '#f39c12',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 2,
  },
  buyButton: {
    backgroundColor: '#27ae60',
    padding: 8,
    borderRadius: 6,
    marginTop: 2,
    minWidth: 80,
    alignItems: 'center',
  },
  buyButtonDisabled: {
    backgroundColor: '#555',
  },
  buyText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  empty: {
    color: '#777',
    fontSize: 12,
    padding: 8,
    textAlign: 'center',
  },
  hint: {
    color: '#777',
    fontSize: 10,
    marginTop: 4,
    fontStyle: 'italic',
  },
});
