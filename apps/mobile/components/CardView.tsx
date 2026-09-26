/**
 * CardView — componente que muestra una carta del juego.
 *
 * Diseño tipo TCG moderno (Hearthstone/MTG Arena): el PNG es la carta
 * completa a sangre; los stats se muestran como insignias-orbe en las
 * esquinas (no texto duplicado) y los estados como anillos brillantes.
 *
 * Cumple UI-PNG-001..011: usa PNG oficiales como representación visual principal.
 * Cumple UI-PNG-020..022: capas dinámicas (selección, objetivo, bloqueo) sobre el PNG.
 * Cumple UI-ACCESS-PNG-001..006: descripción accesible estructurada.
 * Cumple UI-PNG-007: marcador de placeholder si no hay PNG.
 */

import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import type { CardDefinition } from '@nt4h/schema';
import { cardImage, buildAccessibleLabel } from '../store/cardImage';
import { colors } from '../lib/theme';
import { cardAccentColor } from '../lib/classTokens';
import { useColors } from '../lib/useTheme';
import { useSettingsSafe } from '../lib/useTheme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface CardViewProps {
  card: CardDefinition;
  onPress?: () => void;
  /** UI-105: mantener pulsado amplía sin jugar */
  onLongPress?: () => void;
  selected?: boolean;
  compact?: boolean;
  /** Mostrar el reverso en lugar del frontal (UI-GAME-003) */
  showBack?: boolean;
  /** La carta es un objetivo válido (UI-PNG-020: borde de objetivo válido) */
  validTarget?: boolean;
  /** La carta está bloqueada/no jugable (UI-103, UI-PNG-020) */
  blocked?: boolean;
  /** Motivo del bloqueo (UI-103) */
  blockedReason?: string;
  /** Variante de imagen a cargar (UI-PNG-009) */
  imageVariant?: 'front' | 'back' | 'thumbnail' | 'game' | 'preview';
  /** Progreso de selección de objetivos (UI-107) */
  targetProgress?: string;
  /** Sufijo accesible de posición en lista ("Carta 2 de 7") — srListPositions */
  positionLabel?: string;
}



export function CardView({
  card,
  onPress,
  onLongPress,
  selected,
  compact,
  showBack,
  validTarget,
  blocked,
  blockedReason,
  imageVariant = 'game',
  targetProgress,
  positionLabel,
}: CardViewProps) {
  const themed = useColors();
  const { t } = useTranslation();
  const reduceMotion = useSettingsSafe((s) => s.reduceMotion);
  const srExpanded = useSettingsSafe((s) => s.srExpandedLabels);
  const color = cardAccentColor(card);
  const variant = showBack ? 'back' : imageVariant;
  const { path, showPlaceholder } = cardImage(card.id, variant);
  // Descripción accesible estructurada (UI-ACCESS-PNG-001) — ya resuelta
  // via i18n dentro de buildAccessibleLabel. srExpandedLabels añade
  // tipo, clase y estadísticas completas; sin el ajuste solo nombre+tipo.
  const accessibleLabel = buildAccessibleLabel(card, srExpanded)
    + (positionLabel ? ` ${positionLabel}` : '');

  // Animación: la carta seleccionada se eleva y crece con muelle;
  // con "reducir movimiento" el cambio es instantáneo (sin muelle)
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const targetScale = selected ? 1.06 : 1;
  const targetLift = selected ? -8 : 0;
  scale.value = reduceMotion ? targetScale : withSpring(targetScale, { damping: 14, stiffness: 200 });
  lift.value = reduceMotion ? targetLift : withSpring(targetLift, { damping: 14, stiffness: 200 });
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: lift.value }],
    zIndex: selected ? 5 : 0,
  }));

  // Estado visual como anillo (nunca solo color: forma + etiqueta accesible)
  const ringStyle: Record<string, unknown> = { borderColor: color };
  if (selected) {
    ringStyle.borderColor = themed.accent;
    ringStyle.borderWidth = 3;
    ringStyle.shadowColor = themed.accent;
    ringStyle.shadowOpacity = 0.9;
    ringStyle.shadowRadius = 10;
  } else if (validTarget) {
    ringStyle.borderColor = themed.success;
    ringStyle.borderWidth = 3;
    ringStyle.shadowColor = themed.success;
    ringStyle.shadowOpacity = 0.9;
    ringStyle.shadowRadius = 8;
  } else if (blocked) {
    ringStyle.borderColor = colors.textFaint;
    ringStyle.borderWidth = 2;
  }

  const badgeSize = compact ? 22 : 30;

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => { if (!reduceMotion) scale.value = withTiming(0.94, { duration: 90 }); }}
      onPressOut={() => { scale.value = reduceMotion ? (selected ? 1.06 : 1) : withSpring(selected ? 1.06 : 1, { damping: 14 }); }}
      style={[
        styles.container,
        compact && styles.containerCompact,
        ringStyle,
        animStyle,
        blocked && styles.blockedDim,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibleLabel}
      accessibilityHint={blocked ? blockedReason : undefined}
      accessibilityState={{ selected: !!selected, disabled: !!blocked }}
    >
      {path && !showPlaceholder ? (
        // PNG real a sangre (UI-PNG-001, UI-GAME-001)
        // Escenarios: apaisados (~1.48); resto de cartas: verticales (0.656)
        <Image
          source={{ uri: path }}
          style={[
            styles.cardImage,
            card.type === 'SCENARIO' && styles.cardImageLandscape,
          ]}
          resizeMode="cover"
          accessibilityLabel={accessibleLabel}
        />
      ) : (
        // Marcador de placeholder (UI-PNG-007, UI-PNG-008)
        <View style={[styles.placeholder, { backgroundColor: color }]}>
          <Text style={styles.placeholderText}>{t('cardui.imageUnavailable')}</Text>
          <Text style={styles.placeholderName}>{card.name}</Text>
          <Text style={styles.placeholderType}>
            {card.type === 'ABILITY' && card.heroClass ? t('cardui.abilityOfClass', { class: card.heroClass }) : card.type}
          </Text>
          <Text style={styles.placeholderStatus}>{t('cardui.pngPending')}</Text>
        </View>
      )}

      {/* Insignias-orbe de stats (esquinas, estilo TCG) */}
      {card.printedAttack !== undefined && card.printedAttack > 0 && (
        <View style={[styles.badge, styles.badgeAttack, { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: themed.dangerPressed }]}>
          <Text style={[styles.badgeText, compact && styles.badgeTextCompact]}>⚔{card.printedAttack}</Text>
        </View>
      )}
      {card.printedFortitude !== undefined && (
        <View style={[styles.badge, styles.badgeFortitude, { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: themed.primaryPressed }]}>
          <Text style={[styles.badgeText, compact && styles.badgeTextCompact]}>🛡{card.printedFortitude}</Text>
        </View>
      )}
      {card.printedCost !== undefined && (
        <View style={[styles.badge, styles.badgeCost, { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: themed.warning }]}>
          <Text style={[styles.badgeText, compact && styles.badgeTextCompact]}>💰{card.printedCost}</Text>
        </View>
      )}

      {/* Nombre en píldora inferior (legible sobre el arte) */}
      {!compact && (
        <View style={styles.namePill}>
          <Text style={styles.name} numberOfLines={1}>{card.name}</Text>
        </View>
      )}

      {/* Capas dinámicas de estado */}
      {blocked && (
        <View style={styles.blockedVeil}>
          <Text style={styles.blockedIcon}>🔒</Text>
          {blockedReason && <Text style={styles.blockedReason}>{blockedReason}</Text>}
        </View>
      )}
      {targetProgress && (
        <View style={styles.progressBar}>
          <Text style={styles.targetProgress}>{targetProgress}</Text>
        </View>
      )}
      {selected && (
        <View style={styles.selectedFlag}>
          <Text style={styles.selectedFlagText}>✓</Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 2,
    borderRadius: 10,
    margin: 4,
    width: 132,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  containerCompact: {
    width: 104,
    margin: 2,
  },
  blockedDim: {
    opacity: 0.55,
  },
  cardImage: {
    width: '100%',
    // Los PNG oficiales son ~800x1219 → aspecto 0.656
    aspectRatio: 0.656,
    borderRadius: 8,
  },
  cardImageLandscape: {
    // Escenarios: PNG ~711x479 → apaisado
    aspectRatio: 1.48,
  },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.text,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  badgeAttack: {
    bottom: 6,
    left: 6,
    backgroundColor: colors.dangerPressed,
  },
  badgeFortitude: {
    bottom: 6,
    right: 6,
    backgroundColor: colors.info,
  },
  badgeCost: {
    top: 6,
    right: 6,
    backgroundColor: colors.accentDim,
  },
  badgeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
    textShadowColor: '#000',
    textShadowRadius: 2,
  },
  badgeTextCompact: {
    fontSize: 10,
  },
  namePill: {
    position: 'absolute',
    bottom: 6,
    left: 34,
    right: 34,
    backgroundColor: 'rgba(10,10,20,0.78)',
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  name: {
    color: colors.text,
    fontWeight: 'bold',
    fontSize: 11,
    textAlign: 'center',
  },
  blockedVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,20,30,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  blockedIcon: {
    fontSize: 18,
    marginBottom: 2,
  },
  blockedReason: {
    color: colors.danger,
    fontSize: 10,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  progressBar: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(10,10,20,0.8)',
    borderRadius: 6,
    padding: 3,
    alignItems: 'center',
  },
  targetProgress: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  selectedFlag: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedFlagText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: 'bold',
  },
  placeholder: {
    width: '100%',
    aspectRatio: 0.656,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
  },
  placeholderText: {
    color: '#fff',
    fontSize: 10,
    opacity: 0.7,
    marginBottom: 4,
  },
  placeholderName: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
    textAlign: 'center',
  },
  placeholderType: {
    color: colors.textMuted,
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  placeholderStatus: {
    color: colors.textMuted,
    fontSize: 9,
    marginTop: 4,
  },
});
