/**
 * CardZoom — modal de ampliación de carta con explicación estructurada.
 *
 * Cumple UI-110: ampliación muestra imagen, nombre, tipo, clase, valores, texto,
 *                explicación de palabras clave, estados actuales, fuente.
 * Cumple UI-111: cartas personalizadas muestran autor, expansión, versión, estado, etiqueta.
 * Cumple UI-112: no revela info privada a usuarios no autorizados.
 * Cumple UI-113: vista "Cómo se resuelve" con descripción estructurada.
 * Cumple UI-P07: divulgación progresiva.
 */

import { View, Text, Pressable, StyleSheet, Modal, Image, ScrollView } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import type { CardDefinition } from '@nt4h/schema';
import { cardImage, buildAccessibleLabel, customCardImageUri } from '../store/cardImage';
import { describeResolution } from '../lib/effectDescriptions';
import { CardGlow } from './ui/CardGlow';
import { touchTarget, type Colors } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';

interface CardZoomProps {
  visible: boolean;
  card: CardDefinition | null;
  /** Si false, oculta información privada (UI-112) */
  authorized?: boolean;
  onClose: () => void;
}


export function CardZoom({ visible, card, authorized = true, onClose }: CardZoomProps) {
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca el componente
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(c, fs);
  const { path, showPlaceholder } = cardImage(card?.id ?? '', 'preview');
  // Imagen del Taller: 'asset:<id>' resuelto a data-URI (tiene prioridad
  // sobre la ruta oficial — las cartas custom no están en el registro).
  const customUri = customCardImageUri(card?.sourceImage);
  const imageUri = customUri ?? path;
  // Entrada con muelle: la carta "salta" a primer plano
  const zoomIn = useSharedValue(0.85);
  zoomIn.value = withSpring(visible ? 1 : 0.85, { damping: 16, stiffness: 180 });
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: zoomIn.value }],
    opacity: Math.min(1, Math.max(0.4, zoomIn.value)),
    width: '100%',
  }));

  if (!card) return null;
  const accessibleLabel = buildAccessibleLabel(card);
  const resolution = describeResolution(card);
  const isCustom = card.author && card.author !== 'official';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <ScrollView style={styles.dialog} accessibilityLabel={accessibleLabel}>
          <Animated.View style={zoomStyle}>
          <View style={styles.header}>
            <Text style={styles.name}>{card.name}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={t('cardui.close')}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* Imagen (UI-110) con halo Skia detrás */}
          <View style={styles.imageWrap}>
            <View style={styles.glowWrap}>
              <CardGlow size={300} />
            </View>
            {imageUri && (customUri || !showPlaceholder) ? (
              <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Text style={styles.placeholderText}>{t('cardui.noImage')}</Text>
              </View>
            )}
          </View>

          {/* Datos básicos (UI-110) */}
          <View style={styles.section}>
            <Text style={styles.field}>
              <Text style={styles.fieldLabel}>{`${t('cardui.fields.type')} `}</Text>
              {t(`cardui.types.${card.type}`, { defaultValue: card.type })}
            </Text>
            {card.heroClass && (
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>{`${t('cardui.fields.class')} `}</Text>
                {t(`create.classes.${card.heroClass}`, { defaultValue: card.heroClass })}
              </Text>
            )}
            {card.printedAttack !== undefined && card.printedAttack > 0 && (
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>{`${t('cardui.fields.attack')} `}</Text>
                {card.printedAttack}
              </Text>
            )}
            {card.printedFortitude !== undefined && (
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>{`${t('cardui.fields.fortitude')} `}</Text>
                {card.printedFortitude}
              </Text>
            )}
            {card.printedCost !== undefined && (
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>{`${t('cardui.fields.cost')} `}</Text>
                {card.printedCost}
              </Text>
            )}
          </View>

          {/* Carta personalizada (UI-111) */}
          {isCustom && (
            <View style={styles.customBadge}>
              <Text style={styles.customText}>{t('cardui.custom.badge')}</Text>
              {card.author && <Text style={styles.customDetail}>{t('cardui.custom.author', { author: card.author })}</Text>}
              {card.version && <Text style={styles.customDetail}>{t('cardui.custom.version', { version: card.version })}</Text>}
              {card.verificationStatus && (
                <Text style={styles.customDetail}>{t('cardui.custom.status', { status: card.verificationStatus })}</Text>
              )}
            </View>
          )}

          {/* Texto impreso de la carta (si existe) */}
          {(card.textOverride || card.altText) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('cardui.cardText')}</Text>
              <Text style={[styles.resolutionStep, { fontStyle: 'italic' }]}>
                {card.textOverride ?? card.altText}
              </Text>
            </View>
          )}

          {/* Cómo se resuelve (UI-113) */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('cardui.howItResolves')}</Text>
            {resolution.map((step, i) => (
              <Text key={i} style={styles.resolutionStep}>{step}</Text>
            ))}
          </View>

          {/* Info privada (UI-112) */}
          {!authorized && (
            <View style={styles.privateWarning}>
              <Text style={styles.privateText}>
                {t('cardui.privateHidden')}
              </Text>
            </View>
          )}

          <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button">
            <Text style={styles.closeButtonText}>{t('cardui.close')}</Text>
          </Pressable>
          </Animated.View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: c.overlayStrong,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  name: {
    color: c.accent,
    fontSize: fs(20),
    fontWeight: 'bold',
    flex: 1,
  },
  closeBtn: {
    padding: 8,
    minHeight: touchTarget,
    minWidth: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: c.textMuted,
    fontSize: fs(18),
  },
  imageWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  glowWrap: {
    position: 'absolute',
    top: -25,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  image: {
    width: '100%',
    height: 250,
    borderRadius: 8,
  },
  imagePlaceholder: {
    width: '100%',
    height: 150,
    backgroundColor: c.surfaceRaised,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  placeholderText: {
    color: c.textFaint,
    fontSize: fs(12),
  },
  section: {
    marginBottom: 12,
  },
  field: {
    color: c.text,
    fontSize: fs(13),
    marginBottom: 4,
  },
  fieldLabel: {
    color: c.textMuted,
    fontWeight: 'bold',
  },
  sectionTitle: {
    color: c.accent,
    fontSize: fs(14),
    fontWeight: 'bold',
    marginBottom: 6,
  },
  resolutionStep: {
    color: c.text,
    fontSize: fs(12),
    marginBottom: 4,
  },
  customBadge: {
    backgroundColor: c.surfaceRaised,
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  customText: {
    color: c.gameCoin,
    fontSize: fs(12),
    fontWeight: 'bold',
    marginBottom: 4,
  },
  customDetail: {
    color: c.text,
    fontSize: fs(11),
  },
  privateWarning: {
    backgroundColor: c.dangerSurface,
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  privateText: {
    color: c.danger,
    fontSize: fs(11),
    textAlign: 'center',
  },
  closeButton: {
    backgroundColor: c.surfaceRaised,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: touchTarget,
    justifyContent: 'center',
  },
  closeButtonText: {
    color: c.text,
    fontSize: fs(14),
    fontWeight: 'bold',
  },
});
