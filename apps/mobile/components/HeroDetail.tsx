/**
 * HeroDetail — detalle ampliado de un héroe.
 *
 * Cumple UI-084: detalle del héroe con capacidades y explicación.
 * Cumple UI-085: usos limitados explícitos.
 */

import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import type { CardDefinition } from '@nt4h/schema';
import { useColors, useFs } from '../lib/useTheme';
import type { Colors } from '../lib/theme';
import { capListLabel, classLabel } from '../lib/capabilities';

interface HeroDetailProps {
  visible: boolean;
  hero: CardDefinition | null;
  usesRemaining?: number;
  maxUses?: number;
  onClose: () => void;
}

export function HeroDetail({ visible, hero, usesRemaining, maxUses, onClose }: HeroDetailProps) {
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(c, fs);
  if (!visible || !hero) return null;

  const abilityUses = hero.heroAbility?.uses ?? maxUses ?? 0;
  const remaining = usesRemaining ?? abilityUses;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{hero.name}</Text>
          <Text style={styles.class}>{t('hud.heroClass', { class: classLabel(t, hero.heroClass ?? '') })}</Text>

          <ScrollView style={styles.content}>
            <Text style={styles.section}>
              {t('hud.capabilitiesLabel', {
                list: capListLabel(t, hero.capabilities ?? []) || t('hud.capabilitiesNone'),
              })}
            </Text>

            {hero.heroAbility && (
              <View style={styles.ability}>
                <Text style={styles.abilityTitle}>{t('hud.heroAbilityTitle')}</Text>
                <Text style={styles.abilityUses}>
                  {t('hud.heroUses', { remaining, max: abilityUses })}
                </Text>
                <Text style={styles.abilityDescription}>
                  {formatEffects(hero.heroAbility.effects, t)}
                </Text>
              </View>
            )}

            <Text style={styles.section}>
              {t('hud.baseValues', {
                fortitude: hero.printedFortitude ?? '-',
                attack: hero.printedAttack ?? '-',
              })}
            </Text>
          </ScrollView>

          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>{t('hud.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function formatEffects(
  effects: { type: string }[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!effects.length) return t('hud.noExtraEffects');
  return effects.map((e) => e.type).join(', ');
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
    maxWidth: 420,
    maxHeight: '80%',
  },
  title: {
    color: c.accent,
    fontSize: fs(20),
    fontWeight: 'bold',
    marginBottom: 4,
  },
  class: {
    color: c.textMuted,
    fontSize: fs(12),
    marginBottom: 12,
  },
  content: {
    maxHeight: 300,
    marginBottom: 16,
  },
  section: {
    color: c.text,
    fontSize: fs(13),
    marginBottom: 12,
  },
  ability: {
    backgroundColor: c.surfaceRaised,
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  abilityTitle: {
    color: c.accent,
    fontSize: fs(14),
    fontWeight: 'bold',
    marginBottom: 4,
  },
  abilityUses: {
    color: c.info,
    fontSize: fs(12),
    marginBottom: 8,
  },
  abilityDescription: {
    color: c.text,
    fontSize: fs(12),
  },
  closeButton: {
    backgroundColor: c.accent,
    padding: 12,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    color: c.textOnAccent,
    fontSize: fs(14),
    fontWeight: 'bold',
  },
});
