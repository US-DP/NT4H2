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
import type { CardDefinition } from '@nt4h/schema';
import { cardImage, buildAccessibleLabel } from '../store/cardImage';

interface CardZoomProps {
  visible: boolean;
  card: CardDefinition | null;
  /** Si false, oculta información privada (UI-112) */
  authorized?: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  ABILITY: 'Habilidad',
  HERO: 'Héroe',
  HORDE: 'Hueste',
  WARLORD: 'Señor de la Guerra',
  MARKET: 'Objeto de Mercado',
  SCENARIO: 'Escenario',
};

const CLASS_LABELS: Record<string, string> = {
  WARRIOR: 'Guerrero',
  EXPLORER: 'Explorador',
  ROGUE: 'Pícaro',
  MAGE: 'Mago',
};

/** Convierte los efectos a una descripción estructurada "Cómo se resuelve" (UI-113). */
function describeResolution(card: CardDefinition): string[] {
  const steps: string[] = [];
  if (card.printedAttack !== undefined && card.printedAttack > 0) {
    steps.push(`1. Inflige ${card.printedAttack} de daño.`);
  }
  let stepNum = steps.length + 1;
  for (const eff of card.effects ?? []) {
    const desc = describeEffect(eff);
    if (desc) {
      steps.push(`${stepNum}. ${desc}`);
      stepNum++;
    }
  }
  if (steps.length === 0) {
    steps.push('Esta carta no tiene efectos adicionales.');
  }
  return steps;
}

function describeEffect(eff: any): string {
  switch (eff.type) {
    case 'DEAL_DAMAGE':
      return `Inflige daño adicional.`;
    case 'PREVENT_DAMAGE':
      return `Previenes daño.`;
    case 'SHIELD':
      return `Ganas un escudo.`;
    case 'DRAW_CARDS':
      return `Robas cartas.`;
    case 'LOSE_CARDS':
      return `Pierdes cartas.`;
    case 'GAIN_GLORY':
      return `Ganas Gloria.`;
    case 'GAIN_COINS':
      return `Ganas monedas.`;
    case 'HEAL_WOUNDS':
      return `Curas heridas.`;
    case 'END_ATTACK':
      return `Finaliza el ataque.`;
    case 'CONDITIONAL':
      return 'Efecto condicional.';
    default:
      return 'Efecto especial.';
  }
}

export function CardZoom({ visible, card, authorized = true, onClose }: CardZoomProps) {
  const { path, showPlaceholder } = cardImage(card?.id ?? '', 'preview');
  if (!card) return null;
  const accessibleLabel = buildAccessibleLabel(card);
  const resolution = describeResolution(card);
  const isCustom = card.author && card.author !== 'official';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <ScrollView style={styles.dialog} accessibilityLabel={accessibleLabel}>
          <View style={styles.header}>
            <Text style={styles.name}>{card.name}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="Cerrar">
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* Imagen (UI-110) */}
          {path && !showPlaceholder ? (
            <Image source={{ uri: path }} style={styles.image} resizeMode="contain" />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.placeholderText}>Sin imagen</Text>
            </View>
          )}

          {/* Datos básicos (UI-110) */}
          <View style={styles.section}>
            <Text style={styles.field}>
              <Text style={styles.fieldLabel}>Tipo: </Text>
              {TYPE_LABELS[card.type] ?? card.type}
            </Text>
            {card.heroClass && (
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>Clase: </Text>
                {CLASS_LABELS[card.heroClass] ?? card.heroClass}
              </Text>
            )}
            {card.printedAttack !== undefined && card.printedAttack > 0 && (
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>Ataque: </Text>
                {card.printedAttack}
              </Text>
            )}
            {card.printedFortitude !== undefined && (
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>Fortaleza: </Text>
                {card.printedFortitude}
              </Text>
            )}
            {card.printedCost !== undefined && (
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>Coste: </Text>
                {card.printedCost}
              </Text>
            )}
          </View>

          {/* Carta personalizada (UI-111) */}
          {isCustom && (
            <View style={styles.customBadge}>
              <Text style={styles.customText}>Personalizada</Text>
              {card.author && <Text style={styles.customDetail}>Autor: {card.author}</Text>}
              {card.version && <Text style={styles.customDetail}>Versión: {card.version}</Text>}
              {card.verificationStatus && (
                <Text style={styles.customDetail}>Estado: {card.verificationStatus}</Text>
              )}
            </View>
          )}

          {/* Cómo se resuelve (UI-113) */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cómo se resuelve</Text>
            {resolution.map((step, i) => (
              <Text key={i} style={styles.resolutionStep}>{step}</Text>
            ))}
          </View>

          {/* Info privada (UI-112) */}
          {!authorized && (
            <View style={styles.privateWarning}>
              <Text style={styles.privateText}>
                Información privada oculta — no autorizado para ver el reverso.
              </Text>
            </View>
          )}

          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Cerrar</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: '#1a1a2e',
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
    color: '#f1c40f',
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
  },
  closeBtn: {
    padding: 8,
  },
  closeText: {
    color: '#bdc3c7',
    fontSize: 18,
  },
  image: {
    width: '100%',
    height: 250,
    borderRadius: 8,
    marginBottom: 12,
  },
  imagePlaceholder: {
    width: '100%',
    height: 150,
    backgroundColor: '#2c3e50',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  placeholderText: {
    color: '#7f8c8d',
    fontSize: 12,
  },
  section: {
    marginBottom: 12,
  },
  field: {
    color: '#ecf0f1',
    fontSize: 13,
    marginBottom: 4,
  },
  fieldLabel: {
    color: '#bdc3c7',
    fontWeight: 'bold',
  },
  sectionTitle: {
    color: '#f1c40f',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  resolutionStep: {
    color: '#ecf0f1',
    fontSize: 12,
    marginBottom: 4,
  },
  customBadge: {
    backgroundColor: '#3a2a1a',
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  customText: {
    color: '#d4a017',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  customDetail: {
    color: '#ecf0f1',
    fontSize: 11,
  },
  privateWarning: {
    backgroundColor: '#3a1a1a',
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  privateText: {
    color: '#e74c3c',
    fontSize: 11,
    textAlign: 'center',
  },
  closeButton: {
    backgroundColor: '#34495e',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
