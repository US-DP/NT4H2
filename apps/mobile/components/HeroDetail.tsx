/**
 * HeroDetail — detalle ampliado de un héroe.
 *
 * Cumple UI-084: detalle del héroe con capacidades y explicación.
 * Cumple UI-085: usos limitados explícitos.
 */

import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import type { CardDefinition } from '@nt4h/schema';

interface HeroDetailProps {
  visible: boolean;
  hero: CardDefinition | null;
  usesRemaining?: number;
  maxUses?: number;
  onClose: () => void;
}

export function HeroDetail({ visible, hero, usesRemaining, maxUses, onClose }: HeroDetailProps) {
  if (!visible || !hero) return null;

  const abilityUses = hero.heroAbility?.uses ?? maxUses ?? 0;
  const remaining = usesRemaining ?? abilityUses;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{hero.name}</Text>
          <Text style={styles.class}>Clase: {hero.heroClass}</Text>

          <ScrollView style={styles.content}>
            <Text style={styles.section}>Capacidades: {(hero.capabilities ?? []).join(', ') || 'Ninguna'}</Text>

            {hero.heroAbility && (
              <View style={styles.ability}>
                <Text style={styles.abilityTitle}>Pericia de héroe</Text>
                <Text style={styles.abilityUses}>
                  Usos: {remaining}/{abilityUses}
                </Text>
                <Text style={styles.abilityDescription}>
                  {formatEffects(hero.heroAbility.effects)}
                </Text>
              </View>
            )}

            <Text style={styles.section}>
              Valores base: Fortaleza {hero.printedFortitude ?? '-'}, Ataque {hero.printedAttack ?? '-'}
            </Text>
          </ScrollView>

          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Cerrar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function formatEffects(effects: { type: string }[]): string {
  if (!effects.length) return 'Sin efectos adicionales.';
  return effects.map((e) => e.type).join(', ');
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
  },
  title: {
    color: '#f1c40f',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  class: {
    color: '#bdc3c7',
    fontSize: 12,
    marginBottom: 12,
  },
  content: {
    maxHeight: 300,
    marginBottom: 16,
  },
  section: {
    color: '#ecf0f1',
    fontSize: 13,
    marginBottom: 12,
  },
  ability: {
    backgroundColor: '#2c3e50',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  abilityTitle: {
    color: '#f1c40f',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  abilityUses: {
    color: '#3498db',
    fontSize: 12,
    marginBottom: 8,
  },
  abilityDescription: {
    color: '#ecf0f1',
    fontSize: 12,
  },
  closeButton: {
    backgroundColor: '#2980b9',
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
