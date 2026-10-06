/**
 * HeroStatusBar — barra persistente de recursos del héroe.
 *
 * El mazo de habilidades también es la energía del héroe: cuando se agota y
 * hay que reconstruirlo, el héroe sufre 1 herida. Esta relación debe ser
 * visible en todo momento porque condiciona las decisiones tácticas.
 *
 * Muestra: Heridas, Escudos, Monedas, Gloria, Pericias + Mazo/Desgaste
 * con aviso cuando la reconstrucción es inminente.
 *
 * Los iconos son lucide (SVG propio): los emojis varían por SO/navegador
 * y no son un lenguaje funcional fiable.
 */

import { View, Text, StyleSheet, Platform } from 'react-native';
import {
  Heart,
  Shield,
  Coins,
  Star,
  Sparkles,
  LibraryBig,
  Trash2,
  AlertTriangle,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useGameStore } from '../store/gameStore';
import { spacing, fontSize } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';

interface HeroStatusBarProps {
  /** Daño previsto de la horda (tras escudos) para avisar si agotará el mazo */
  incomingDamage?: number;
}

export function HeroStatusBar({ incomingDamage = 0 }: HeroStatusBarProps) {
  const { t } = useTranslation();
  const colors2 = useColors();
  const fs = useFs();
  const gameState = useGameStore((s) => s.gameState);
  const viewerId = useGameStore((s) => s.viewerId);

  if (!gameState) return null;

  const playerId = viewerId ?? gameState.activePlayerId;
  const player = gameState.players[playerId];
  if (!player) return null;

  const deckCount = player.abilityDeck.length;
  const wearCount = player.wearPile.length;
  // Reconstruir el mazo cuesta 1 herida: aviso si el mazo está vacío
  // o si el daño previsto de la horda lo va a agotar este turno.
  const rebuildImminent = deckCount === 0 || (incomingDamage > 0 && incomingDamage >= deckCount);
  const deckLow = !rebuildImminent && deckCount > 0 && deckCount <= 3;

  const iconSize = Math.round(fs(fontSize.body)) + 2;
  const hidden =
    Platform.OS !== 'web'
      ? ({ accessibilityElementsHidden: true, importantForAccessibility: 'no' as const })
      : {};

  const stats: { Icon: typeof Heart; value: string; color: string; labelKey: string }[] = [
    { Icon: Heart, value: `${player.wounds}/${player.maxWounds}`, color: colors2.danger, labelKey: 'hud.statWounds' },
    { Icon: Shield, value: `${player.shields}`, color: colors2.info, labelKey: 'hud.statShields' },
    { Icon: Coins, value: `${player.coins}`, color: colors2.gameCoin, labelKey: 'hud.statCoins' },
    { Icon: Star, value: `${player.glory}`, color: colors2.accent, labelKey: 'hud.statGlory' },
    { Icon: Sparkles, value: `${player.heroUsesRemaining}/${player.heroMaxUses}`, color: colors2.textMuted, labelKey: 'hud.statAbilities' },
  ];

  return (
    <View
      style={[styles.bar, { backgroundColor: colors2.surfaceRaised, borderTopColor: colors2.border }]}
      accessibilityLabel={t('hud.resourcesA11y', {
        wounds: player.wounds,
        maxWounds: player.maxWounds,
        shields: player.shields,
        coins: player.coins,
        glory: player.glory,
        deck: deckCount,
        wear: wearCount,
      })}
    >
      <View style={styles.statsRow}>
        {stats.map(({ Icon, value, color, labelKey }) => (
          <View
            key={labelKey}
            style={styles.statWrap}
            accessibilityLabel={t('hud.statValueA11y', { label: t(labelKey), value })}
          >
            <Icon size={iconSize} color={color} {...hidden} />
            <Text style={[styles.stat, { color, fontSize: fs(fontSize.body) }]}>{value}</Text>
          </View>
        ))}
      </View>

      {/* Mazo = energía: desgaste del héroe */}
      <View style={styles.deckBlock}>
        <View style={styles.statWrap}>
          <LibraryBig size={iconSize} color={colors2.text} {...hidden} />
          <Text style={[styles.deckText, { color: colors2.text, fontSize: fs(fontSize.body) }]}>
            {t('hud.deckCount', { count: deckCount })}
          </Text>
        </View>
        <View style={styles.statWrap}>
          <Trash2 size={iconSize} color={colors2.textMuted} {...hidden} />
          <Text style={[styles.deckText, { color: colors2.textMuted, fontSize: fs(fontSize.body) }]}>
            {t('hud.wearCount', { count: wearCount })}
          </Text>
        </View>
        {rebuildImminent && (
          <View style={styles.statWrap}>
            <AlertTriangle size={iconSize} color={colors2.warning} {...hidden} />
            <Text
              style={[styles.rebuildWarning, { color: colors2.warning, fontSize: fs(fontSize.detail) }]}
              accessibilityRole="alert"
            >
              {t('hud.rebuildWarn')}
            </Text>
          </View>
        )}
        {deckLow && (
          <Text style={[styles.deckLowText, { color: colors2.textMuted, fontSize: fs(fontSize.detail) }]}>
            {t('hud.deckLow')}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    gap: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    alignItems: 'center',
    // RN-web usa flexShrink:0 por defecto: sin esto la fila no encoge
    // en viewports estrechos y desborda el footer (overflow horizontal).
    flexShrink: 1,
    minWidth: 0,
  },
  statWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  stat: {
    fontWeight: '700',
  },
  deckBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    // Idem: con shrink:0 el bloque se mide sin envolver (~444px con el
    // aviso de reconstrucción) y rebosa la barra en móvil.
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
  },
  deckText: {
    fontWeight: '600',
  },
  rebuildWarning: {
    fontWeight: '700',
  },
  deckLowText: {
    fontStyle: 'italic',
  },
});
