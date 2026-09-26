/**
 * CardAnatomy — anatomía visual de los tipos de carta (rulebook `card-types`).
 *
 * Muestra una carta real del catálogo por tipo con llamadas numeradas sobre la
 * imagen (Fortaleza arriba-izquierda, icono especial arriba-derecha, Gloria
 * abajo-derecha) y la lista de partes con los valores reales impresos.
 */

import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { loadCatalog } from '@nt4h/catalog';
import { cardImage } from '../store/cardImage';
import { useColors, useFs } from '../lib/useTheme';
import { spacing, radius, fontSize } from '../lib/theme';

interface AnatomyPart {
  /** Posición relativa sobre la imagen (0-1) */
  x?: number;
  y?: number;
  label: string;
  value: string;
}

const TYPE_TABS: { type: string; exampleId: string }[] = [
  { type: 'ABILITY', exampleId: 'warrior.brutal-attack' },
  { type: 'HORDE', exampleId: 'horde.001' },
  { type: 'MARKET', exampleId: 'market.elven-dagger' },
  { type: 'HERO', exampleId: 'hero.aranel' },
  { type: 'SCENARIO', exampleId: 'scenario.battlefield' },
];

export function CardAnatomy() {
  const c = useColors();
  const fs = useFs();
  const { t } = useTranslation();
  const [tab, setTab] = useState('HORDE');

  const catalog = useMemo(() => {
    try { return loadCatalog(); } catch { return null; }
  }, []);

  const card = useMemo(() => {
    if (!catalog) return null;
    const wanted = TYPE_TABS.find((tt) => tt.type === tab);
    if (!wanted) return null;
    // Preferir el ejemplo prefijado; si no existe, la primera carta del tipo
    return catalog.byId.get(wanted.exampleId)
      ?? catalog.byType?.get(tab)?.[0]
      ?? [...catalog.byId.values()].find((x) => x.type === tab)
      ?? null;
  }, [catalog, tab]);

  const parts: AnatomyPart[] = useMemo(() => {
    if (!card) return [];
    const className = card.heroClass
      ? t(`create.classes.${card.heroClass}`, { defaultValue: card.heroClass })
      : '—';
    const capT = (k: string) => t(`cardui.anatomy.caps.${k}`, { defaultValue: k });
    const p: AnatomyPart[] = [];
    switch (card.type) {
      case 'HORDE':
      case 'WARLORD':
        p.push(
          { x: 0.12, y: 0.07, label: t('cardui.anatomy.fortitudeLabel'), value: t('cardui.anatomy.fortitudeValue', { n: card.printedFortitude ?? '?' }) },
          ...(card.specialIcons?.length
            ? [{ x: 0.86, y: 0.07, label: t('cardui.anatomy.specialIcon'), value: card.specialIcons.join(', ') }]
            : []),
          { x: 0.86, y: 0.93, label: t('cardui.anatomy.gloryOnDefeat'), value: `${card.reward?.glory ?? 0}` },
          { label: t('cardui.anatomy.loot'), value: t('cardui.anatomy.lootCoins', { n: card.reward?.coins ?? 0 }) },
          { label: t('cardui.anatomy.orc'), value: t(card.isOrc ? 'cardui.anatomy.orcYes' : 'cardui.anatomy.orcNo') },
        );
        break;
      case 'ABILITY':
        p.push(
          { x: 0.12, y: 0.07, label: t('cardui.anatomy.damage'), value: t('cardui.anatomy.damageValue', { n: card.printedAttack ?? '?' }) },
          ...(card.printedFortitude !== undefined
            ? [{ x: 0.86, y: 0.07, label: t('cardui.anatomy.life'), value: t('cardui.anatomy.lifeValue', { n: card.printedFortitude }) }]
            : []),
          { label: t('cardui.anatomy.classLabel'), value: className },
          { label: t('cardui.anatomy.effects'), value: t('cardui.anatomy.effectsOnPlay', { n: card.effects.length }) },
          ...(card.destinationAfterUse === 'REMOVED_FROM_GAME'
            ? [{ label: t('cardui.anatomy.singleUse'), value: t('cardui.anatomy.singleUseValue') }]
            : []),
        );
        break;
      case 'MARKET':
        p.push(
          { x: 0.12, y: 0.07, label: t('cardui.anatomy.costLabel'), value: t('cardui.anatomy.costCoins', { n: card.printedCost ?? '?' }) },
          ...(card.printedAttack !== undefined
            ? [{ x: 0.86, y: 0.07, label: t('cardui.anatomy.damage'), value: `${card.printedAttack}` }]
            : []),
          ...(card.capabilities?.length
            ? [{ label: t('cardui.anatomy.capability'), value: card.capabilities.map(capT).join(', ') }]
            : []),
          { label: t('cardui.anatomy.effects'), value: t('cardui.anatomy.effectsOnPlay', { n: card.effects.length }) },
        );
        break;
      case 'HERO':
        p.push(
          { label: t('cardui.anatomy.classLabel'), value: className },
          ...(card.capabilities?.length
            ? [{ label: t('cardui.anatomy.capabilities'), value: card.capabilities.map(capT).join(', ') }]
            : []),
          { label: t('cardui.anatomy.peritia'), value: t('cardui.anatomy.peritiaValue') },
        );
        break;
      case 'SCENARIO':
        p.push(
          { label: t('cardui.anatomy.rule'), value: t('cardui.anatomy.ruleValue') },
          { label: t('cardui.anatomy.effects'), value: t('cardui.anatomy.effectsCount', { n: card.effects.length }) },
        );
        break;
      default:
        break;
    }
    return p;
  }, [card, t]);

  const img = card ? cardImage(card.id, 'preview') : null;

  return (
    <View>
      <View style={styles.tabs}>
        {TYPE_TABS.map((tt) => {
          const label = t(`cardui.anatomy.tabs.${tt.type}`, { defaultValue: tt.type });
          return (
          <Pressable
            key={tt.type}
            onPress={() => setTab(tt.type)}
            style={[
              styles.tab,
              { backgroundColor: c.surfaceRaised, borderColor: c.border },
              tab === tt.type && { backgroundColor: c.accent, borderColor: c.accent },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === tt.type }}
            accessibilityLabel={t('cardui.anatomy.viewA11y', { type: label })}
          >
            <Text style={{ color: tab === tt.type ? '#1a1a2e' : c.text, fontSize: fs(fontSize.detail), fontWeight: '700' }}>
              {label}
            </Text>
          </Pressable>
          );
        })}
      </View>

      {!card ? (
        <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>
          {t('cardui.anatomy.noExample')}
        </Text>
      ) : (
        <View style={styles.body}>
          <View style={styles.imageWrap}>
            {img?.path && (
              <Image source={{ uri: img.path }} style={styles.image} resizeMode="contain" />
            )}
            {parts.filter((p) => p.x !== undefined).map((p, i) => (
              <View
                key={i}
                style={[styles.callout, { left: `${(p.x! - 0.035) * 100}%`, top: `${(p.y! - 0.03) * 100}%` }]}
                accessibilityLabel={t('cardui.anatomy.calloutA11y', { n: i + 1, label: p.label })}
              >
                <Text style={styles.calloutText}>{i + 1}</Text>
              </View>
            ))}
          </View>
          <View style={styles.parts}>
            <Text style={{ color: c.text, fontSize: fs(fontSize.body), fontWeight: '800', marginBottom: 4 }}>
              {card.name}
            </Text>
            {parts.map((p, i) => (
              <View key={i} style={styles.partRow}>
                {p.x !== undefined && (
                  <View style={[styles.calloutInline, { backgroundColor: c.accent }]}>
                    <Text style={styles.calloutText}>{i + 1}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.accent, fontSize: fs(fontSize.detail), fontWeight: '700' }}>
                    {p.label}
                  </Text>
                  <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>{p.value}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 36,
  },
  body: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  imageWrap: {
    width: 220,
    aspectRatio: 0.66,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
  },
  callout: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F4C94F',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calloutInline: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: 2,
  },
  calloutText: {
    color: '#1a1a2e',
    fontSize: 11,
    fontWeight: '800',
  },
  parts: {
    flex: 1,
    minWidth: 220,
  },
  partRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
});


