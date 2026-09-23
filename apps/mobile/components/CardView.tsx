/**
 * CardView — componente que muestra una carta del juego.
 *
 * Cumple UI-PNG-001..011: usa PNG oficiales como representación visual principal.
 * Cumple UI-PNG-020..022: capas dinámicas (selección, objetivo, bloqueo) sobre el PNG.
 * Cumple UI-ACCESS-PNG-001..006: descripción accesible estructurada.
 * Cumple UI-PNG-007: marcador de placeholder si no hay PNG.
 */

import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import type { CardDefinition } from '@nt4h/schema';
import { cardImage, buildAccessibleLabel } from '../store/cardImage';

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
}

const CLASS_COLORS: Record<string, string> = {
  WARRIOR: '#c0392b',
  EXPLORER: '#27ae60',
  ROGUE: '#8e44ad',
  MAGE: '#2980b9',
  HORDE: '#2c3e50',
  WARLORD: '#7f1a1a',
  MARKET: '#d4a017',
  HERO: '#e67e22',
  SCENARIO: '#16a085',
};

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
}: CardViewProps) {
  const color = CLASS_COLORS[card.heroClass ?? card.type] ?? '#555';
  const variant = showBack ? 'back' : imageVariant;
  const { path, showPlaceholder } = cardImage(card.id, variant);
  const accessibleLabel = buildAccessibleLabel(card);

  // Construir estilo de borde según capas (UI-PNG-020)
  const borderStyle: Record<string, unknown> = { borderColor: color };
  if (selected) {
    borderStyle.borderColor = '#f1c40f';
    borderStyle.borderWidth = 3;
  } else if (validTarget) {
    borderStyle.borderColor = '#2ecc71';
    borderStyle.borderWidth = 3;
  } else if (blocked) {
    borderStyle.borderColor = '#e74c3c';
    borderStyle.borderWidth = 2;
    borderStyle.opacity = 0.6;
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.container, borderStyle, selected && styles.selected]}
      accessibilityRole="button"
      accessibilityLabel={accessibleLabel}
      accessibilityHint={blocked ? blockedReason : undefined}
    >
      {path && !showPlaceholder ? (
        // PNG real (UI-PNG-001, UI-GAME-001)
        <Image
          source={{ uri: path }}
          style={styles.cardImage}
          resizeMode="contain"
          accessibilityLabel={accessibleLabel}
        />
      ) : (
        // Marcador de placeholder (UI-PNG-007, UI-PNG-008)
        <View style={[styles.placeholder, { backgroundColor: color }]}>
          <Text style={styles.placeholderText}>Imagen no disponible</Text>
          <Text style={styles.placeholderName}>{card.name}</Text>
          <Text style={styles.placeholderType}>
            {card.type === 'ABILITY' && card.heroClass ? `Habilidad de ${card.heroClass}` : card.type}
          </Text>
          <Text style={styles.placeholderStatus}>PNG pendiente</Text>
        </View>
      )}

      {/* Capas dinámicas (UI-PNG-020..022) — no ocultan nombre/valores */}
      {!compact && (
        <View style={styles.overlay}>
          <Text style={styles.name}>{card.name}</Text>
          {card.printedAttack !== undefined && card.printedAttack > 0 && (
            <Text style={styles.stat}>⚔ {card.printedAttack}</Text>
          )}
          {card.printedFortitude !== undefined && (
            <Text style={styles.stat}>🛡 {card.printedFortitude}</Text>
          )}
          {card.printedCost !== undefined && (
            <Text style={styles.stat}>💰 {card.printedCost}</Text>
          )}
          {blocked && blockedReason && (
            <Text style={styles.blockedReason}>{blockedReason}</Text>
          )}
          {targetProgress && (
            <Text style={styles.targetProgress}>{targetProgress}</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 2,
    borderRadius: 8,
    margin: 4,
    minWidth: 120,
    maxWidth: 180,
    backgroundColor: '#1a1a2e',
    overflow: 'hidden',
  },
  selected: {
    transform: [{ scale: 1.05 }],
  },
  cardImage: {
    width: '100%',
    height: 160,
    borderRadius: 6,
  },
  placeholder: {
    width: '100%',
    height: 160,
    borderRadius: 6,
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
    color: '#ecf0f1',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  placeholderStatus: {
    color: '#bdc3c7',
    fontSize: 9,
    marginTop: 4,
  },
  overlay: {
    padding: 4,
    alignItems: 'center',
  },
  name: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
    textAlign: 'center',
  },
  stat: {
    color: '#ecf0f1',
    fontSize: 11,
  },
  blockedReason: {
    color: '#e74c3c',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 2,
  },
  targetProgress: {
    color: '#f1c40f',
    fontSize: 9,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 2,
  },
});
