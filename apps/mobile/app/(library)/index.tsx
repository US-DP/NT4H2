/**
 * Pantalla de biblioteca / colección — galería visual de cartas.
 *
 * Cuadrícula con miniaturas + panel lateral de detalle (escritorio) o
 * hoja modal (móvil). Filtros agrupados por tipo/clase, ordenación,
 * buscador con limpiar y contador de resultados.
 *
 * Cumple UI-230..233 (vistas, filtros, info de tarjeta, archivadas).
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput, Image,
  useWindowDimensions,
} from 'react-native';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { NtBottomSheet } from '../../components/ui/NtBottomSheet';
import { NtBadge } from '../../components/ui/NtBadge';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Search, X, Star, Lock } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useGameStore } from '../../store/gameStore';
import { useCollection, type CollectionSort, type OriginFilter } from '../../store/collectionStore';
import { cardImage, buildAccessibleLabel } from '../../store/cardImage';
import { describeResolution } from '../../lib/effectDescriptions';
import type { CardDefinition, HeroClass } from '@nt4h/schema';
import { validateDeck } from '@nt4h/schema';
import { CLASS_TOKENS } from '../../lib/classTokens';
import { useCustomContent } from '../../lib/customContent';
import { colors, spacing, radius, fontSize } from '../../lib/theme';
import { useColors, useFs } from '../../lib/useTheme';

const CARD_TYPES = ['ABILITY', 'HERO', 'HORDE', 'WARLORD', 'MARKET', 'SCENARIO'];
const HERO_CLASSES = Object.keys(CLASS_TOKENS);

const SORTS: CollectionSort[] = ['name', 'type', 'damage', 'cost'];

/** Filtro de origen: catálogo oficial vs. contenido creado en el Taller */
const ORIGINS: OriginFilter[] = ['all', 'official', 'custom'];

/**
 * Carta procedente del Taller: mergeCustomCards estampa officialStatus
 * (CUSTOM si el JSON no declaraba otro) y setId = id del conjunto
 * ('set.taller-local', …). Los sets oficiales usan ids 'official[.*]'.
 */
function isCustomCard(card: CardDefinition): boolean {
  if (card.officialStatus !== 'OFFICIAL' && card.officialStatus !== 'OFFICIAL_PROMO') return true;
  return !card.setId.startsWith('official');
}

/** Regla del reglamento relacionada con cada tipo de carta */
const TYPE_RULE: Record<string, string> = {
  ABILITY: 'attack-phase',
  HERO: 'hero-feats',
  HORDE: 'enemy-icons',
  WARLORD: 'warlord',
  MARKET: 'market-phase',
  SCENARIO: 'scenarios',
};

/** Distancia de edición acotada para sugerencias de búsqueda */
function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

type ViewMode = 'grid' | 'list';

export default function LibraryScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const c = useColors();
  const fs = useFs();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const catalog = useGameStore((s) => s.catalog);

  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterClass, setFilterClass] = useState<string | null>(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [onlyUndiscovered, setOnlyUndiscovered] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [section, setSection] = useState<'cards' | 'decks' | 'sets'>('cards');
  const [detail, setDetail] = useState<CardDefinition | null>(null);
const detailSheetRef = useRef<BottomSheetModal>(null);

// En pantallas estrechas el detalle se muestra como hoja inferior (BottomSheet)
useEffect(() => {
  if (wide) return;
  if (detail) {
    detailSheetRef.current?.present();
  } else {
    detailSheetRef.current?.dismiss();
  }
}, [detail, wide]);

  const sort = useCollection((s) => s.sort);
  const setSort = useCollection((s) => s.setSort);
  const favorites = useCollection((s) => s.favorites);
  const discovered = useCollection((s) => s.discovered);
  const spoilerMode = useCollection((s) => s.spoilerMode);
  const setSpoilerMode = useCollection((s) => s.setSpoilerMode);
  const originFilter = useCollection((s) => s.originFilter);
  const setOriginFilter = useCollection((s) => s.setOriginFilter);
  const hydrateCollection = useCollection((s) => s.hydrate);
  const customSets = useCustomContent((s) => s.sets);
  const customDecks = customSets.flatMap((set) => set.decks);
  useEffect(() => { hydrateCollection(); }, [hydrateCollection]);

  const allCards = useMemo(() => {
    if (!catalog) return null;
    return Array.from(catalog.byId.values());
  }, [catalog]);

  // El filtro de clase solo aplica a tipos con heroClass
  const classFilterRelevant = !filterType || filterType === 'ABILITY' || filterType === 'HERO';
  const effectiveClass = classFilterRelevant ? filterClass : null;
  const activeFilters =
    (filterType ? 1 : 0) + (effectiveClass ? 1 : 0) +
    (onlyFavorites ? 1 : 0) + (onlyUndiscovered ? 1 : 0) +
    (originFilter !== 'all' ? 1 : 0);
  const discoveredSet = useMemo(() => new Set(discovered), [discovered]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  // Búsqueda insensible a tildes/mayúsculas ("pajaro" encuentra "Pájaro")
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Etiquetas traducidas de tipo/clase (fallback al id si falta la clave)
  const typeText = (type: string) => t(`library.types.${type}`, { defaultValue: type });
  const classText = (cls: string) => t(`library.classes.${cls}`, { defaultValue: cls });

  const filtered = useMemo(() => {
    if (!allCards) return [];
    const q = norm(query.trim());
    const list = allCards.filter((card) => {
      if (filterType && card.type !== filterType) return false;
      if (effectiveClass && card.heroClass !== effectiveClass) return false;
      if (onlyFavorites && !favoriteSet.has(card.id)) return false;
      if (onlyUndiscovered && discoveredSet.has(card.id)) return false;
      // Filtro de origen: oficial (core) vs. contenido del Taller
      if (originFilter === 'official' && isCustomCard(card)) return false;
      if (originFilter === 'custom' && !isCustomCard(card)) return false;
      // Control de spoilers: 'hide' retira las no descubiertas salvo
      // que el usuario las busque explícitamente con el filtro
      if (spoilerMode === 'hide' && !discoveredSet.has(card.id) && !onlyUndiscovered) return false;
      if (!q) return true;
      return (
        norm(card.name).includes(q) ||
        norm(card.id).includes(q) ||
        norm(card.type).includes(q) ||
        (card.heroClass ? norm(card.heroClass).includes(q) : false)
      );
    });
    const typeOrder = CARD_TYPES;
    switch (sort) {
      case 'name':
        return [...list].sort((a, b) => a.name.localeCompare(b.name, i18n.language));
      case 'type':
        return [...list].sort(
          (a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || a.name.localeCompare(b.name, i18n.language),
        );
      case 'damage':
        return [...list].sort((a, b) => (b.printedAttack ?? -1) - (a.printedAttack ?? -1));
      case 'cost':
        return [...list].sort((a, b) => (a.printedCost ?? 99) - (b.printedCost ?? 99));
      default:
        return list;
    }
  }, [allCards, query, filterType, effectiveClass, sort, onlyFavorites, onlyUndiscovered, favoriteSet, discoveredSet, spoilerMode, originFilter, i18n.language]);

  // Sugerencia difusa cuando la búsqueda no encuentra nada ("lovo" → "lobo")
  const suggestion = useMemo(() => {
    if (!allCards || filtered.length > 0 || !query.trim()) return null;
    const q = query.trim().toLowerCase();
    let best: { name: string; dist: number } | null = null;
    for (const card of allCards) {
      const d = editDistance(q, card.name.toLowerCase());
      const dWord = card.name.toLowerCase().split(/\s+/)
        .reduce((m, w) => Math.min(m, editDistance(q, w)), 99);
      const dist = Math.min(d, dWord + 1);
      if (dist <= 3 && (!best || dist < best.dist)) best = { name: card.name, dist };
    }
    return best?.name ?? null;
  }, [allCards, filtered.length, query]);

  const clearFilters = () => {
    setFilterType(null);
    setFilterClass(null);
    setOnlyFavorites(false);
    setOnlyUndiscovered(false);
    setOriginFilter('all');
    setQuery('');
  };

  // Navegación anterior/siguiente dentro de los resultados
  const detailIdx = detail ? filtered.findIndex((cd) => cd.id === detail.id) : -1;
  const goDetail = (delta: number) => {
    const next = filtered[detailIdx + delta];
    if (next) setDetail(next);
  };

  const gridCols = Math.max(2, Math.floor(((wide ? width - 340 : width) - 40) / 170));

  // ── Tarjeta de la cuadrícula ──────────────────────────────────────────
  const renderTile = ({ item: card }: { item: CardDefinition }) => {
    const img = cardImage(card.id, 'thumbnail');
    const selected = detail?.id === card.id;
    const isFav = favoriteSet.has(card.id);
    // 'show' muestra las no descubiertas como cartas normales
    const isUndiscovered = !discoveredSet.has(card.id) && spoilerMode !== 'show';
    const isCustom = isCustomCard(card);
    const classColor = card.heroClass ? CLASS_TOKENS[card.heroClass]?.color : undefined;
    return (
      <Pressable
        onPress={() => setDetail(selected ? null : card)}
        style={[
          styles.tile,
          { backgroundColor: c.surface, borderColor: c.border },
          selected && { borderColor: c.accent, borderWidth: 2 },
          isUndiscovered && styles.tileUndiscovered,
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${buildAccessibleLabel(card)}${isUndiscovered ? t('library.cardA11y.undiscovered') : ''}${isCustom ? t('library.cardA11y.custom') : ''}${isFav ? t('library.cardA11y.favorite') : ''}`}
      >
        {img.path ? (
          <Image
            source={{ uri: img.path }}
            style={[styles.tileImage, isUndiscovered && { opacity: 0.35 }]}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.tileImage, styles.tileImageEmpty, { backgroundColor: c.surfaceRaised }]}>
            <Text style={{ color: c.textFaint, fontSize: 18 }}>🂠</Text>
          </View>
        )}
        {isUndiscovered && (
          <View style={styles.lockBadge} accessibilityLabel={t('library.badges.undiscoveredA11y')}>
            <Lock size={12} color="#C5C3CB" />
            <Text style={{ color: '#C5C3CB', fontSize: 9, fontWeight: '700' }}>{t('library.badges.undiscovered')}</Text>
          </View>
        )}
        {isFav && (
          <View style={styles.favBadge}>
            <Star size={12} color="#F4C94F" fill="#F4C94F" />
          </View>
        )}
        <View style={styles.tileBody}>
          <Text style={[styles.tileName, { color: c.text, fontSize: fs(fontSize.detail) }]} numberOfLines={1}>
            {card.name}
          </Text>
          <Text style={{ color: classColor ?? c.textMuted, fontSize: fs(fontSize.micro) }} numberOfLines={1}>
            {typeText(card.type)}
            {card.heroClass ? ` · ${classText(card.heroClass)}` : ''}
          </Text>
          {isCustom && (
            <View style={styles.customBadge}>
              <NtBadge label={t('library.badges.custom')} tone="accent" />
            </View>
          )}
          {card.printedAttack !== undefined && (
            <Text style={{ color: c.danger, fontSize: fs(fontSize.micro), fontWeight: '700' }}>
              ⚔ {card.printedAttack}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  const renderRow = ({ item: card }: { item: CardDefinition }) => {
    const selected = detail?.id === card.id;
    return (
      <Pressable
        onPress={() => setDetail(selected ? null : card)}
        style={[
          styles.listRow,
          { backgroundColor: c.surface },
          selected && { borderLeftColor: c.accent, borderLeftWidth: 3 },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${buildAccessibleLabel(card)}${isCustomCard(card) ? t('library.cardA11y.custom') : ''}`}
      >
        <Text style={[styles.listName, { color: c.text, fontSize: fs(fontSize.body) }]} numberOfLines={1}>
          {card.name}
        </Text>
        <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail), width: 150 }} numberOfLines={1}>
          {typeText(card.type)}
          {card.heroClass ? ` · ${classText(card.heroClass)}` : ''}
          {isCustomCard(card) ? t('library.badges.customMark') : ''}
        </Text>
        <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail), width: 60, textAlign: 'right' }}>
          {card.printedAttack !== undefined ? `⚔${card.printedAttack}` : ''}
        </Text>
      </Pressable>
    );
  };

  // ── Panel de detalle ──────────────────────────────────────────────────
  const detailContent = detail && (
    <DetailPanel
      card={detail}
      c={c}
      fs={fs}
      idx={detailIdx}
      total={filtered.length}
      onPrev={() => goDetail(-1)}
      onNext={() => goDetail(1)}
      onClose={() => setDetail(null)}
      onRules={() => router.push({
        pathname: '/(rulebook)',
        params: { rule: TYPE_RULE[detail.type] ?? 'card-types' },
      } as never)}
    />
  );

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {/* Cabecera: volver + título + progreso */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('library.back')}
          style={styles.backLink}
        >
          <Text style={{ color: c.info, fontSize: fs(fontSize.body) }}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.accent, fontSize: fs(fontSize.title) }]}>{t('library.title')}</Text>
        <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>
          {t('library.cardCount', { total: allCards?.length ?? '…' })}
        </Text>
      </View>

      {/* Buscador */}
      <View style={[styles.searchRow, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
        <Search size={16} color={c.textFaint} />
        <TextInput
          style={[styles.searchInput, { color: c.text, fontSize: fs(fontSize.body) }]}
          value={query}
          onChangeText={setQuery}
          placeholder={t('library.search.placeholder')}
          placeholderTextColor={c.textFaint}
          accessibilityLabel={t('library.search.a11y')}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel={t('library.search.clearA11y')}>
            <X size={16} color={c.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Categorías: cartas | mazos | conjuntos */}
      <View style={styles.filters}>
        <View style={styles.filterGroup} accessibilityRole="radiogroup" accessibilityLabel={t('library.categories.a11y')}>
          <Text style={[styles.filterLabel, { color: c.textFaint, fontSize: fs(fontSize.micro) }]}>{t('library.categories.label')}</Text>
          {(['cards', 'decks', 'sets'] as const).map((opt) => (
            <FilterChip
              key={opt}
              label={t(`library.categories.${opt}`)}
              active={section === opt}
              onPress={() => setSection(opt)}
              c={c}
              fs={fs}
            />
          ))}
        </View>
      </View>

      {/* Filtros agrupados */}
      {section === 'cards' && (
      <View style={styles.filters}>
        <View style={styles.filterGroup}>
          <Text style={[styles.filterLabel, { color: c.textFaint, fontSize: fs(fontSize.micro) }]}>{t('library.filters.type')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <FilterChip label={t('library.filters.allTypes')} active={!filterType} onPress={() => setFilterType(null)} c={c} fs={fs} />
            {CARD_TYPES.map((typeId) => (
              <FilterChip
                key={typeId}
                label={typeText(typeId)}
                active={filterType === typeId}
                onPress={() => setFilterType(filterType === typeId ? null : typeId)}
                c={c}
                fs={fs}
              />
            ))}
          </ScrollView>
        </View>
        {classFilterRelevant && (
          <View style={styles.filterGroup}>
            <Text style={[styles.filterLabel, { color: c.textFaint, fontSize: fs(fontSize.micro) }]}>{t('library.filters.class')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <FilterChip label={t('library.filters.allClasses')} active={!filterClass} onPress={() => setFilterClass(null)} c={c} fs={fs} />
              {HERO_CLASSES.map((cls) => (
                <FilterChip
                  key={cls}
                  label={classText(cls)}
                  active={filterClass === cls}
                  onPress={() => setFilterClass(filterClass === cls ? null : cls)}
                  accentColor={CLASS_TOKENS[cls as HeroClass].color}
                  c={c}
                  fs={fs}
                />
              ))}
            </ScrollView>
          </View>
        )}
        <View style={styles.filterGroup}>
          <Text style={[styles.filterLabel, { color: c.textFaint, fontSize: fs(fontSize.micro) }]}>{t('library.filters.more')}</Text>
          <FilterChip
            label={t('library.filters.favorites')}
            active={onlyFavorites}
            onPress={() => setOnlyFavorites((v) => !v)}
            c={c}
            fs={fs}
          />
          <FilterChip
            label={t('library.filters.undiscovered')}
            active={onlyUndiscovered}
            onPress={() => setOnlyUndiscovered((v) => !v)}
            c={c}
            fs={fs}
          />
        </View>
        {/* Origen: catálogo oficial vs. contenido creado en el Taller */}
        <View style={styles.filterGroup} accessibilityRole="radiogroup" accessibilityLabel={t('library.filters.originA11y')}>
          <Text style={[styles.filterLabel, { color: c.textFaint, fontSize: fs(fontSize.micro) }]}>{t('library.filters.origin')}</Text>
          {ORIGINS.map((opt) => (
            <FilterChip
              key={opt}
              label={t(`library.origins.${opt}`)}
              active={originFilter === opt}
              onPress={() => setOriginFilter(opt)}
              c={c}
              fs={fs}
            />
          ))}
        </View>
        {/* Control de spoilers: qué hacer con las cartas no descubiertas */}
        <View style={styles.filterGroup} accessibilityRole="radiogroup" accessibilityLabel={t('library.filters.spoilersA11y')}>
          <Text style={[styles.filterLabel, { color: c.textFaint, fontSize: fs(fontSize.micro) }]}>{t('library.filters.spoilers')}</Text>
          {(['hide', 'silhouette', 'show'] as const).map((opt) => (
            <FilterChip
              key={opt}
              label={t(`library.spoilerModes.${opt}`)}
              active={spoilerMode === opt}
              onPress={() => setSpoilerMode(opt)}
              c={c}
              fs={fs}
            />
          ))}
        </View>
        </View>
      )}

      {/* Resultados + orden + vista */}
      {section === 'cards' && (
      <View style={styles.toolbar}>
        <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail), flex: 1 }} accessibilityLiveRegion="polite">
          {allCards === null
            ? t('library.loadingCatalog')
            : `${t('library.results', { count: filtered.length })}${activeFilters ? t('library.activeFilters', { count: activeFilters }) : ''}`}
        </Text>
        {activeFilters > 0 && (
          <Pressable onPress={clearFilters} accessibilityRole="button" accessibilityLabel={t('library.filters.clearA11y')}>
            <Text style={{ color: c.info, fontSize: fs(fontSize.detail), marginRight: spacing.md }}>{t('library.filters.clear')}</Text>
          </Pressable>
        )}
        <View style={styles.sortRow}>
          {SORTS.map((s) => (
            <Pressable
              key={s}
              onPress={() => setSort(s)}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === s }}
            >
              <Text style={{
                color: sort === s ? c.accent : c.textFaint,
                fontSize: fs(fontSize.micro),
                fontWeight: sort === s ? '700' : '400',
                marginLeft: spacing.sm,
              }}>
                {t(`library.sorts.${s}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={[styles.viewToggle, { borderColor: c.border }]}>
          <Pressable
            onPress={() => setViewMode('grid')}
            style={[styles.viewBtn, viewMode === 'grid' && { backgroundColor: c.accent }]}
            accessibilityRole="button"
            accessibilityState={{ selected: viewMode === 'grid' }}
            accessibilityLabel={t('library.views.gridA11y')}
          >
            <Text style={{ color: viewMode === 'grid' ? '#1a1a2e' : c.textMuted, fontSize: 12 }}>▦</Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('list')}
            style={[styles.viewBtn, viewMode === 'list' && { backgroundColor: c.accent }]}
            accessibilityRole="button"
            accessibilityState={{ selected: viewMode === 'list' }}
            accessibilityLabel={t('library.views.listA11y')}
          >
            <Text style={{ color: viewMode === 'list' ? '#1a1a2e' : c.textMuted, fontSize: 12 }}>☷</Text>
          </Pressable>
        </View>
        </View>
      )}

      {/* Contenido: galería + panel lateral */}
      <View style={styles.body}>
        <View style={{ flex: 1 }}>
          {section === 'decks' && (
            <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
              {/* Mazos de clase oficiales */}
              {HERO_CLASSES.map((cls) => (
                <View key={cls} style={[styles.listRow, { backgroundColor: c.surface }]}>
                  <Text style={{ color: c.text, fontSize: fs(fontSize.body), fontWeight: '600' }}>
                    {t('library.decks.officialName', { class: classText(cls) })}
                  </Text>
                  <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>
                    {t('library.decks.officialMeta', { n: 15 })}
                  </Text>
                </View>
              ))}
              {/* Mazos personalizados del Taller */}
              {customDecks.map((d) => {
                const total = d.cardEntries.reduce((a, e) => a + e.copies, 0);
                const check = catalog ? validateDeck(d, catalog.byId) : { ok: false, errors: [] as string[] };
                const valid = check.ok;
                return (
                  <View key={d.id} style={[styles.listRow, { backgroundColor: c.surface }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontSize: fs(fontSize.body), fontWeight: '600' }}>
                        {d.name}
                      </Text>
                      <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>
                        {t('library.decks.cardCount', { total, size: d.deckSize })}
                        {d.heroClassIds.map((cls) => ` ${classText(cls)}`).join(' ·')}
                      </Text>
                      {/* Primer error de validación: la causa es más útil que el número */}
                      {!valid && check.errors[0] && (
                        <Text style={{ color: c.warning, fontSize: fs(fontSize.micro) }}>
                          {check.errors[0]}
                        </Text>
                      )}
                    </View>
                    <NtBadge
                      label={valid ? t('library.badges.deckReady') : t('library.badges.deckIncomplete')}
                      tone={valid ? 'accent' : 'warning'}
                    />
                    <Pressable
                      onPress={() => router.push({ pathname: '/(study)/[tab]', params: { tab: 'decks' } })}
                      accessibilityRole="link"
                      accessibilityLabel={t('library.decks.editA11y', { name: d.name })}
                      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}
                    >
                      <Text style={{ color: c.info, fontSize: fs(fontSize.detail), fontWeight: '600' }}>
                        {t('library.decks.edit')}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
              {customDecks.length === 0 && (
                <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>
                  {t('library.decks.empty')}
                </Text>
              )}
            </ScrollView>
          )}
          {section === 'sets' && (
            <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
              {/* Juego base */}
              <View style={[styles.listRow, { backgroundColor: c.surface }]}>
                <Text style={{ color: c.text, fontSize: fs(fontSize.body), fontWeight: '600' }}>
                  {t('library.sets.baseGame')}
                </Text>
                <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>
                  {t('library.sets.officialDefs', { n: catalog?.totalCards ?? 0 })}
                </Text>
                <NtBadge label={t('library.badges.official')} tone="accent" />
              </View>
              {customSets.map((set) => (
                <View key={set.id} style={[styles.listRow, { backgroundColor: c.surface }]}>
                  <Text style={{ color: c.text, fontSize: fs(fontSize.body), fontWeight: '600' }}>
                    {set.name}
                  </Text>
                  <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>
                    {t('library.sets.meta', { cards: set.cards.length, decks: set.decks.length, version: set.version, author: set.author })}
                  </Text>
                  <NtBadge label={set.status} tone="neutral" />
                </View>
              ))}
              {customSets.length === 0 && (
                <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>
                  {t('library.sets.empty')}
                </Text>
              )}
            </ScrollView>
          )}
          {section === 'cards' && (filtered.length === 0 && allCards !== null ? (
            <View style={styles.emptyBlock}>
              <Text style={{ color: c.textMuted, fontSize: fs(fontSize.body), textAlign: 'center' }}>
                {query.trim()
                  ? t('library.empty.query', { query: query.trim() })
                  : t('library.empty.filters')}
              </Text>
              {suggestion && (
                <Pressable
                  onPress={() => setQuery(suggestion)}
                  accessibilityRole="button"
                  accessibilityLabel={t('library.empty.suggestionA11y', { suggestion })}
                  style={{ marginTop: spacing.sm }}
                >
                  <Text style={{ color: c.info, fontSize: fs(fontSize.body) }}>
                    {t('library.empty.suggestion', { suggestion })}
                  </Text>
                </Pressable>
              )}
              <Pressable onPress={clearFilters} accessibilityRole="button" style={{ marginTop: spacing.md }}>
                <Text style={{ color: c.info, fontSize: fs(fontSize.body) }}>{t('library.filters.clearAll')}</Text>
              </Pressable>
            </View>
          ) : viewMode === 'grid' ? (
            <FlashList
              key={`grid-${gridCols}`}
              data={filtered}
              keyExtractor={(card) => card.id}
              numColumns={gridCols}
              estimatedItemSize={200}
              renderItem={renderTile}
              ListEmptyComponent={
                <Text style={{ color: c.textFaint, textAlign: 'center', marginTop: spacing.xl }}>
                  {t('library.loadingCatalog')}
                </Text>
              }
            />
          ) : (
            <FlashList
              data={filtered}
              keyExtractor={(card) => card.id}
              estimatedItemSize={52}
              renderItem={renderRow}
            />
          ))}
        </View>

        {wide && section === 'cards' && detailContent}
      </View>

      {/* Detalle en hoja inferior solo en pantallas estrechas */}
      {!wide && (
        <NtBottomSheet
          ref={detailSheetRef}
          title={detail?.name}
          snapPoints={['60%', '88%']}
          onDismiss={() => setDetail(null)}
        >
          {detailContent}
        </NtBottomSheet>
      )}
    </View>
  );
}

// ============================================================================
// Chip de filtro
// ============================================================================

function FilterChip({
  label, active, onPress, accentColor, c, fs,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  accentColor?: string;
  c: ReturnType<typeof useColors>;
  fs: (n: number) => number;
}) {
  const activeBg = accentColor ?? c.accent;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: active ? activeBg : c.border },
        active && { backgroundColor: activeBg },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={{
        color: active ? '#1a1a2e' : c.textMuted,
        fontSize: fs(fontSize.detail),
        fontWeight: active ? '700' : '400',
      }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ============================================================================
// Panel de detalle (lateral en escritorio, hoja en móvil)
// ============================================================================

function DetailPanel({
  card, c, fs, idx, total, onPrev, onNext, onClose, onRules,
}: {
  card: CardDefinition;
  c: ReturnType<typeof useColors>;
  fs: (n: number) => number;
  idx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onRules: () => void;
}) {
  const { t } = useTranslation();
  const img = cardImage(card.id, 'preview');
  const resolution = describeResolution(card);
  const classColor = card.heroClass ? CLASS_TOKENS[card.heroClass]?.color : c.textMuted;
  const [zoomed, setZoomed] = useState(false);
  const isFav = useCollection((s) => s.favorites.includes(card.id));
  const toggleFavorite = useCollection((s) => s.toggleFavorite);
  const isCustom = isCustomCard(card);
  // Nombre legible del conjunto del Taller al que pertenece la carta
  const customSetName = useCustomContent(
    (s) => s.sets.find((set) => set.id === card.setId)?.name,
  );

  const typeText = (type: string) => t(`library.types.${type}`, { defaultValue: type });
  const classText = (cls: string) => t(`library.classes.${cls}`, { defaultValue: cls });
  const customStatusText = (status: string) =>
    t(`library.detail.customStatus.${status}`, { defaultValue: t('library.detail.customStatus.fallback') });

  const fields: { label: string; value: string }[] = [];
  if (card.printedAttack !== undefined) fields.push({ label: t('library.detail.fields.damage'), value: String(card.printedAttack) });
  if (card.printedFortitude !== undefined) fields.push({ label: t('library.detail.fields.fortitude'), value: String(card.printedFortitude) });
  if (card.printedCost !== undefined) fields.push({ label: t('library.detail.fields.cost'), value: t('library.detail.fields.costValue', { n: card.printedCost }) });
  if (card.maxWounds !== undefined) fields.push({ label: t('library.detail.fields.maxWounds'), value: String(card.maxWounds) });
  if (card.reward) {
    const parts = [];
    if (card.reward.glory) parts.push(t('library.detail.fields.rewardGlory', { n: card.reward.glory }));
    if (card.reward.coins) parts.push(t('library.detail.fields.rewardCoins', { n: card.reward.coins }));
    if (parts.length) fields.push({ label: t('library.detail.fields.reward'), value: parts.join(' + ') });
  }
  if (card.copies > 1) fields.push({ label: t('library.detail.fields.copies'), value: String(card.copies) });
  if (card.destinationAfterUse === 'REMOVED_FROM_GAME') {
    fields.push({ label: t('library.detail.fields.usage'), value: t('library.detail.fields.singleUse') });
  }
  if (card.requiredCapabilities?.length) {
    fields.push({ label: t('library.detail.fields.requires'), value: card.requiredCapabilities.join(', ') });
  }
  if (card.heroAbility) {
    fields.push({ label: t('library.detail.fields.peritia'), value: t('library.detail.peritiaUses', { count: card.heroAbility.uses }) });
  }
  if (card.specialIcons?.length) {
    fields.push({ label: t('library.detail.fields.icons'), value: card.specialIcons.join(', ') });
  }
  // Metadatos del Taller: solo en cartas personalizadas y cuando existen
  if (isCustom) {
    fields.push({ label: t('library.detail.fields.origin'), value: customStatusText(card.officialStatus) });
    fields.push({ label: t('library.detail.fields.set'), value: customSetName ?? card.setId });
    if (card.author && card.author !== 'official') {
      fields.push({ label: t('library.detail.fields.author'), value: card.author });
    }
    if (card.version) fields.push({ label: t('library.detail.fields.version'), value: card.version });
  }

  return (
    <View style={styles.detail}>
      <View style={styles.detailHeader}>
        <Text style={{ color: c.textFaint, fontSize: fs(fontSize.micro), fontWeight: '700', letterSpacing: 1 }}>
          {t('library.detail.heading')}
          {total > 0 && t('library.detail.position', { current: idx + 1, total })}
        </Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('library.detail.closeA11y')} hitSlop={8}>
          <X size={18} color={c.textMuted} />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {img.path && (
          <Pressable
            onPress={() => setZoomed((z) => !z)}
            accessibilityRole="button"
            accessibilityLabel={zoomed ? 'Restablecer zoom de la carta' : 'Ampliar la carta'}
          >
            <ScrollView horizontal={zoomed} scrollEnabled={zoomed}>
              <Image
                source={{ uri: img.path }}
                style={[styles.detailImage, zoomed && styles.detailImageZoomed]}
                resizeMode="contain"
              />
            </ScrollView>
            <Text style={{ color: c.textFaint, fontSize: fs(fontSize.micro), textAlign: 'center' }}>
              {zoomed ? 'Tocar para restablecer zoom' : 'Tocar para ampliar'}
            </Text>
          </Pressable>
        )}

        <View style={styles.detailNameRow}>
          <Text style={{ color: c.text, fontSize: fs(fontSize.section), fontWeight: '800', flex: 1 }}>
            {card.name}
          </Text>
          <Pressable
            onPress={() => toggleFavorite(card.id)}
            accessibilityRole="button"
            accessibilityLabel={isFav ? t('library.detail.favRemoveA11y') : t('library.detail.favAddA11y')}
            accessibilityState={{ selected: isFav }}
            hitSlop={10}
          >
            <Star size={20} color={isFav ? '#F4C94F' : c.textFaint} fill={isFav ? '#F4C94F' : 'none'} />
          </Pressable>
        </View>
        <View style={styles.detailTypeRow}>
          <Text style={{ color: classColor, fontSize: fs(fontSize.body) }}>
            {typeText(card.type)}
            {card.heroClass ? ` · ${classText(card.heroClass)}` : ''}
          </Text>
          {isCustom && <NtBadge label={t('library.badges.custom')} tone="accent" />}
        </View>

        {fields.map((f) => (
          <View key={f.label} style={styles.fieldRow}>
            <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>{f.label}</Text>
            <Text style={{ color: c.text, fontSize: fs(fontSize.detail), fontWeight: '700' }}>{f.value}</Text>
          </View>
        ))}

        {(card.textOverride || card.altText) && (
          <>
            <Text style={{ color: c.textFaint, fontSize: fs(fontSize.micro), fontWeight: '700', letterSpacing: 1, marginTop: spacing.md }}>
              TEXTO DE LA CARTA
            </Text>
            <Text style={{ color: c.text, fontSize: fs(fontSize.detail), fontStyle: 'italic', marginTop: 2 }}>
              {card.textOverride ?? card.altText}
            </Text>
          </>
        )}

        <Text style={{ color: c.textFaint, fontSize: fs(fontSize.micro), fontWeight: '700', letterSpacing: 1, marginTop: spacing.md }}>
          EFECTO
        </Text>
        {resolution.map((step, i) => (
          <Text key={i} style={{ color: c.textMuted, fontSize: fs(fontSize.detail), marginTop: 2 }}>
            {step}
          </Text>
        ))}

        {card.capabilities && card.capabilities.length > 0 && (
          <>
            <Text style={{ color: c.textFaint, fontSize: fs(fontSize.micro), fontWeight: '700', letterSpacing: 1, marginTop: spacing.md }}>
              CAPACIDADES
            </Text>
            <Text style={{ color: c.textMuted, fontSize: fs(fontSize.detail) }}>
              {card.capabilities.join(' · ')}
            </Text>
          </>
        )}

        <Pressable onPress={onRules} accessibilityRole="button" style={{ marginTop: spacing.lg }}>
          <Text style={{ color: c.info, fontSize: fs(fontSize.detail) }}>Consultar reglas relacionadas →</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.detailNav}>
        <Pressable onPress={onPrev} disabled={idx <= 0} style={idx <= 0 && { opacity: 0.35 }} accessibilityRole="button" accessibilityLabel="Carta anterior">
          <Text style={{ color: c.text, fontSize: fs(fontSize.detail) }}>← Anterior</Text>
        </Pressable>
        <Pressable onPress={onNext} disabled={idx >= total - 1} style={idx >= total - 1 && { opacity: 0.35 }} accessibilityRole="button" accessibilityLabel="Carta siguiente">
          <Text style={{ color: c.text, fontSize: fs(fontSize.detail) }}>Siguiente →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  backLink: { padding: 4 },
  title: { fontWeight: '800', flex: 1 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, padding: 0 },
  filters: { marginBottom: spacing.xs },
  filterGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  filterLabel: { width: 44, fontWeight: '700', letterSpacing: 1 },
  chip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  sortRow: { flexDirection: 'row', alignItems: 'center' },
  viewToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  viewBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  body: { flex: 1, flexDirection: 'row', gap: spacing.md },
  // Cuadrícula
  tile: {
    flex: 1,
    margin: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tileImage: {
    width: '100%',
    aspectRatio: 0.72,
  },
  tileImageEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: { padding: spacing.sm },
  tileName: { fontWeight: '700' },
  customBadge: { marginTop: 4, alignSelf: 'flex-start' },
  // Lista
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: 4,
    gap: spacing.sm,
  },
  listName: { flex: 1, fontWeight: '600' },
  emptyBlock: { alignItems: 'center', marginTop: spacing.xl },
  // Panel de detalle
  detail: {
    width: 300,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingLeft: spacing.md,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  detailImage: {
    width: '100%',
    aspectRatio: 0.72,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  detailImageZoomed: {
    width: 560,
    height: 780,
  },
  tileUndiscovered: {
    opacity: 0.85,
  },
  lockBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(9,11,18,0.85)',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  favBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(9,11,18,0.85)',
    borderRadius: 10,
    padding: 4,
  },
  detailNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginBottom: spacing.md,
  },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(59,64,91,0.4)',
  },
  detailNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Hoja inferior (móvil)
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '85%',
    minHeight: 300,
  },
});


