/**
 * Pantalla de reglamento — organizada por capítulos funcionales.
 *
 * Índice (izquierda) | Contenido (centro) | En esta sección (derecha).
 * Pestañas: Reglas base (10 capítulos), Solitario, Multiclase,
 * Referencia rápida. Buscador global sobre todo el contenido.
 *
 * Cumple UI-225 (buscar en el reglamento) y UI-226 (errores vinculados).
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { HelpButton } from './HelpButton';
import { Tutorial } from './Tutorial';
import {
  RULES, BASE_CHAPTERS, SOLO_ITEMS, MULTI_ITEMS, QUICKREF_IDS,
  type RulebookItem,
} from '../lib/rules';
import { GuidedSetup } from './GuidedSetup';
import { CardAnatomy } from './CardAnatomy';
import { useColors, useFontScale, useFontFamily } from '../lib/useTheme';
import { CATALOG_VERSION } from '@nt4h/catalog';
import { RULESET_VERSION } from '@nt4h/engine';

type TabId = 'base' | 'solo' | 'multiclass' | 'quickref';

const TAB_IDS: TabId[] = ['base', 'solo', 'multiclass', 'quickref'];

const QUICK_LINKS: { labelKey: string; ruleId: string }[] = [
  { labelKey: 'book.quick.setup', ruleId: 'setup-horde' },
  { labelKey: 'book.quick.turn', ruleId: 'turn-phases' },
  { labelKey: 'book.quick.glory', ruleId: 'end-game' },
  { labelKey: 'book.quick.icons', ruleId: 'enemy-icons' },
  { labelKey: 'book.quick.faq', ruleId: 'faq' },
];

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

/** Aplana el índice de una pestaña en una lista ordenada de ruleIds */
function itemsForTab(tab: TabId): RulebookItem[] {
  if (tab === 'base') return BASE_CHAPTERS.flatMap((ch) => ch.items);
  if (tab === 'solo') return SOLO_ITEMS;
  if (tab === 'multiclass') return MULTI_ITEMS;
  return QUICKREF_IDS.map((id) => ({ ruleId: id, label: RULE_BY_ID.get(id)?.title ?? id }));
}

export function RulebookScreen({ initialRule }: { initialRule?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const c = useColors();
  const fs = useFontScale();
  const fontFamily = useFontFamily();
  const { width } = useWindowDimensions();
  const wide = width >= 960;
  const showRelated = width >= 1240;

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabId>('base');
  const [selected, setSelected] = useState<string>('intro');
  const [expandedChapter, setExpandedChapter] = useState<string>('ch-intro');
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const searching = query.trim().length > 0;

  // Búsqueda global (ignora la pestaña activa)
  const results = useMemo(() => {
    if (!searching) return [];
    const q = query.trim().toLowerCase();
    return RULES.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      r.body.toLowerCase().includes(q) ||
      r.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  }, [query, searching]);

  // Navegación anterior/siguiente dentro de la pestaña activa
  const flatItems = useMemo(() => itemsForTab(tab), [tab]);
  const selectedIdx = flatItems.findIndex((i) => i.ruleId === selected);
  const selectedRule = RULE_BY_ID.get(selected);

  const openRule = useCallback((ruleId: string, tabOfRule?: TabId) => {
    const rule = RULE_BY_ID.get(ruleId);
    if (!rule) return;
    const targetTab = tabOfRule ?? (rule.category === 'solo' ? 'solo' : rule.category === 'multiclass' ? 'multiclass' : 'base');
    setTab(targetTab);
    setSelected(ruleId);
    setQuery('');
    if (targetTab === 'base') {
      const ch = BASE_CHAPTERS.find((c) => c.items.some((i) => i.ruleId === ruleId));
      if (ch) setExpandedChapter(ch.id);
    }
    setDrawerOpen(false);
  }, []);

  // Deep-link: /(rulebook)?rule=<ruleId|slug> — acepta id directo o slug
  // legible derivado del título (p.ej. "fase-de-ataque").
  const params = { rule: initialRule };
  const ruleSlugs = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of RULES) {
      const slug = r.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      if (!map.has(slug)) map.set(slug, r.id);
    }
    return map;
  }, []);
  useEffect(() => {
    if (!params.rule) return;
    const id = RULE_BY_ID.has(params.rule)
      ? params.rule
      : ruleSlugs.get(params.rule);
    if (id) openRule(id);
  }, [params.rule, ruleSlugs, openRule]);

  const goTo = useCallback((delta: number) => {
    const next = flatItems[selectedIdx + delta];
    if (next) openRule(next.ruleId, tab);
  }, [flatItems, selectedIdx, tab, openRule]);

  // Relacionados: secciones que comparten palabras clave
  const related = useMemo(() => {
    if (!selectedRule) return [];
    return RULES.filter((r) =>
      r.id !== selectedRule.id &&
      r.keywords.some((k) => selectedRule.keywords.includes(k)),
    ).slice(0, 5);
  }, [selectedRule]);

  // Índice alfabético: todas las secciones ordenadas, agrupadas por inicial
  const alphaIndex = useMemo(() => {
    const sorted = [...RULES].sort((a, b) => a.title.localeCompare(b.title, 'es'));
    const groups = new Map<string, typeof RULES>();
    for (const r of sorted) {
      const letter = r.title.charAt(0).toUpperCase();
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter)!.push(r);
    }
    return [...groups.entries()];
  }, []);

  const markdownStyles = {
    body: { color: c.textMuted, fontSize: 15 * fs, lineHeight: 23 * fs, fontFamily },
    strong: { color: c.text },
    em: { color: c.textFaint, fontStyle: 'italic' as const },
    bullet_list: { color: c.textMuted },
    list_item: { color: c.textMuted },
    heading2: { color: c.accent },
  };

  const chapterOf = (ruleId: string) =>
    BASE_CHAPTERS.find((ch) => ch.items.some((i) => i.ruleId === ruleId));

  // Índice compartido: columna lateral en escritorio, drawer en pantallas estrechas
  const indexContent = (
    <>
      <Text style={[styles.indexHeading, { color: c.textFaint, fontSize: 11 * fs }]}>{t('book.indexTitle').toUpperCase()}</Text>
      {tab === 'base' ? (
        BASE_CHAPTERS.map((ch) => {
          const isOpen = expandedChapter === ch.id;
          const containsSelected = ch.items.some((i) => i.ruleId === selected);
          return (
            <View key={ch.id}>
              <Pressable
                onPress={() => setExpandedChapter(isOpen ? '' : ch.id)}
                style={[styles.chapterRow, containsSelected && { backgroundColor: c.surfaceRaised }]}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                accessibilityLabel={t('book.chapterA11y', { num: ch.num, title: ch.title })}
              >
                <Text style={{ color: containsSelected ? c.accent : c.text, fontSize: 13 * fs, fontWeight: containsSelected ? '700' : '600', flex: 1 }}>
                  {ch.num}. {ch.title}
                </Text>
                <Text style={{ color: c.textFaint }}>{isOpen ? '▾' : '▸'}</Text>
              </Pressable>
              {isOpen && ch.items.map((item, itemIdx) => (
                <Pressable
                  key={item.ruleId}
                  onPress={() => openRule(item.ruleId, 'base')}
                  style={[styles.indexItem, selected === item.ruleId && { backgroundColor: c.surfaceRaised, borderLeftColor: c.accent }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selected === item.ruleId }}
                >
                  <Text style={{ color: selected === item.ruleId ? c.accent : c.textMuted, fontSize: 12 * fs }}>
                    {ch.num}.{itemIdx + 1} {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          );
        })
      ) : (
        flatItems.map((item, i) => (
          <Pressable
            key={item.ruleId}
            onPress={() => { setSelected(item.ruleId); setDrawerOpen(false); }}
            style={[styles.chapterRow, selected === item.ruleId && { backgroundColor: c.surfaceRaised }]}
            accessibilityRole="button"
          >
            <Text style={{ color: selected === item.ruleId ? c.accent : c.text, fontSize: 13 * fs, fontWeight: '600' }}>
              {i + 1}. {item.label}
            </Text>
          </Pressable>
        ))
      )}
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {/* Cabecera */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.accent, fontSize: 26 * fs }]}>{t('book.title')}</Text>
          <Text style={{ color: c.textMuted, fontSize: 13 * fs }}>
            {t('book.subtitle')}
          </Text>
          <Text style={{ color: c.textFaint, fontSize: 11 * fs, marginTop: 2 }}>
            {t('book.versions', { ruleset: RULESET_VERSION, catalog: CATALOG_VERSION })}
          </Text>
        </View>
        <HelpButton onPress={() => setShowTutorial(true)} />
      </View>

      {/* Buscador prominente */}
      <TextInput
        style={[styles.input, { backgroundColor: c.surfaceRaised, color: c.text, borderColor: c.border, fontSize: 15 * fs }]}
        value={query}
        onChangeText={setQuery}
        placeholder={t('book.searchPlaceholder')}
        placeholderTextColor={c.textFaint}
        accessibilityLabel={t('book.searchA11y')}
      />

      {/* Accesos rápidos */}
      {!searching && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickLinks}>
          {QUICK_LINKS.map((l) => (
            <Pressable
              key={l.ruleId}
              onPress={() => openRule(l.ruleId)}
              style={[styles.quickChip, { borderColor: c.border, backgroundColor: c.surface }]}
              accessibilityRole="button"
            >
              <Text style={{ color: c.info, fontSize: 12 * fs, fontWeight: '600' }}>{t(l.labelKey)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Pestañas */}
      {!searching && (
        <>
          <View style={styles.tabs}>
            {TAB_IDS.map((tabId) => (
              <Pressable
                key={tabId}
                onPress={() => {
                  setTab(tabId);
                  const first = itemsForTab(tabId)[0];
                  if (first) setSelected(first.ruleId);
                  if (tabId === 'base') setExpandedChapter(BASE_CHAPTERS[0].id);
                }}
                style={[
                  styles.tab,
                  { backgroundColor: c.surfaceRaised, borderColor: c.border },
                  tab === tabId && { backgroundColor: c.accent, borderColor: c.accent },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: tab === tabId }}
              >
                <Text style={[
                  styles.tabText,
                  { color: c.textMuted, fontSize: 13 * fs },
                  tab === tabId && { color: '#1a1a2e' },
                ]}>
                  {t(`book.tabs.${tabId}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: c.textFaint, fontSize: 12 * fs, marginBottom: 8 }}>
            {t(`book.tabDesc.${tab}`)}
          </Text>
        </>
      )}

      {/* Resultados de búsqueda */}
      {searching ? (
        <ScrollView style={styles.content}>
          <Text style={{ color: c.textFaint, fontSize: 12 * fs, marginBottom: 8 }}>
            {t('book.resultCount', { count: results.length })}
          </Text>
          {results.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => openRule(r.id)}
              style={[styles.resultRow, { backgroundColor: c.surface, borderColor: c.border }]}
              accessibilityRole="button"
              accessibilityLabel={t('book.openSectionA11y', { title: r.title })}
            >
              <Text style={{ color: c.text, fontSize: 14 * fs, fontWeight: '600', flex: 1 }}>{r.title}</Text>
              <Text style={{ color: c.textFaint, fontSize: 11 * fs }}>
                {t(`book.category.${r.category}`)}
              </Text>
            </Pressable>
          ))}
          {results.length === 0 && (
            <Text style={{ color: c.textFaint, fontSize: 13 * fs, marginTop: 24, textAlign: 'center' }}>
              {t('book.noResults', { query })}
            </Text>
          )}
        </ScrollView>
      ) : (
        /* Barra que abre el drawer del índice (pantallas estrechas) */
        <View style={{ flex: 1 }}>
          {!wide && (
            <View style={[styles.drawerBar, { borderColor: c.border, backgroundColor: c.surface }]}>
              <Pressable
                onPress={() => setDrawerOpen(true)}
                style={styles.drawerButton}
                accessibilityRole="button"
                accessibilityLabel={t('book.openIndexA11y')}
              >
                <Text style={{ color: c.accent, fontSize: 13 * fs, fontWeight: '700' }}>☰ {t('book.indexTitle')}</Text>
              </Pressable>
              <Text style={{ color: c.textMuted, fontSize: 12 * fs, flex: 1 }} numberOfLines={1}>
                {selectedRule?.title ?? ''}
              </Text>
            </View>
          )}
          <View style={styles.body}>
          {/* Índice: columna fija en escritorio; en estrecho se abre como drawer */}
          {wide && (
            <ScrollView style={[styles.index, { borderColor: c.border }]}>
              {indexContent}
            </ScrollView>
          )}

          {/* Contenido */}
          <ScrollView style={styles.content}>
            {selectedRule ? (
              <View>
                <Text style={{ color: c.accent, fontSize: 20 * fs, fontWeight: '800', marginBottom: 4 }}>
                  {selectedRule.title}
                </Text>
                {tab === 'base' && chapterOf(selected) && (
                  <Text style={{ color: c.textFaint, fontSize: 12 * fs, marginBottom: 12 }}>
                    {t('book.chapterOf', { num: chapterOf(selected)!.num, total: BASE_CHAPTERS.length, title: chapterOf(selected)!.title })}
                  </Text>
                )}
                {(tab === 'solo' || tab === 'multiclass') && (
                  <Text style={{ color: c.info, fontSize: 12 * fs, marginBottom: 12, fontStyle: 'italic' }}>
                    {t('book.modifiesBase')}
                  </Text>
                )}
                {selected === 'setup-checklist' ? (
                  <GuidedSetup />
                ) : selected === 'card-anatomy' ? (
                  <CardAnatomy />
                ) : selected === 'alpha-index' ? (
                  <View>
                    <Markdown style={markdownStyles}>{selectedRule.body}</Markdown>
                    {alphaIndex.map(([letter, items]) => (
                      <View key={letter} style={{ marginBottom: 8 }}>
                        <Text style={{ color: c.accent, fontSize: 15 * fs, fontWeight: '800', marginBottom: 4 }}>
                          {letter}
                        </Text>
                        {items.map((r) => (
                          <Pressable
                            key={r.id}
                            onPress={() => openRule(r.id)}
                            style={{ paddingVertical: 5 }}
                            accessibilityRole="button"
                            accessibilityLabel={t('book.openTitleA11y', { title: r.title })}
                          >
                            <Text style={{ color: c.info, fontSize: 14 * fs }}>
                              {r.title}
                              <Text style={{ color: c.textFaint, fontSize: 11 * fs }}>
                                {'  '}· {t(`book.category.${r.category}`)}
                              </Text>
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Markdown style={markdownStyles}>{selectedRule.body}</Markdown>
                )}

                {/* Anterior / Siguiente */}
                <View style={styles.prevNext}>
                  <Pressable
                    onPress={() => goTo(-1)}
                    disabled={selectedIdx <= 0}
                    style={[styles.navButton, { borderColor: c.border }, selectedIdx <= 0 && { opacity: 0.4 }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('book.prevA11y')}
                  >
                    <Text style={{ color: c.text, fontSize: 13 * fs }}>{t('book.prev')}</Text>
                  </Pressable>
                  <Text style={{ color: c.textFaint, fontSize: 12 * fs }}>
                    {t('book.pageOf', { current: selectedIdx + 1, total: flatItems.length })}
                  </Text>
                  <Pressable
                    onPress={() => goTo(1)}
                    disabled={selectedIdx >= flatItems.length - 1}
                    style={[styles.navButton, { borderColor: c.border }, selectedIdx >= flatItems.length - 1 && { opacity: 0.4 }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('book.nextA11y')}
                  >
                    <Text style={{ color: c.text, fontSize: 13 * fs }}>{t('book.next')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {/* En esta sección */}
          {showRelated && selectedRule && (
            <View style={[styles.related, { borderColor: c.border }]}>
              <Text style={[styles.indexHeading, { color: c.textFaint, fontSize: 11 * fs }]}>
                {t('book.inThisSection')}
              </Text>
              <View style={{ flexWrap: 'wrap', flexDirection: 'row', gap: 6, marginBottom: 12 }}>
                {selectedRule.keywords.slice(0, 6).map((k) => (
                  <View key={k} style={[styles.keywordChip, { borderColor: c.border }]}>
                    <Text style={{ color: c.textMuted, fontSize: 11 * fs }}>{k}</Text>
                  </View>
                ))}
              </View>
              {related.length > 0 && (
                <>
                  <Text style={[styles.indexHeading, { color: c.textFaint, fontSize: 11 * fs }]}>
                    {t('book.related')}
                  </Text>
                  {related.map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => openRule(r.id)}
                      style={{ paddingVertical: 5 }}
                      accessibilityRole="button"
                    >
                      <Text style={{ color: c.info, fontSize: 12 * fs }}>{r.title}</Text>
                    </Pressable>
                  ))}
                </>
              )}
            </View>
          )}
          </View>
        </View>
      )}

      <Pressable style={[styles.backButton, { backgroundColor: c.surfaceRaised }]} onPress={() => router.push('/')}>
        <Text style={[styles.backText, { fontSize: 14 * fs }]}>{t('book.back')}</Text>
      </Pressable>

      {/* Drawer del índice (pantallas estrechas) */}
      {!wide && drawerOpen && (
        <View style={styles.drawerOverlay}>
          <Pressable
            style={styles.drawerBackdrop}
            onPress={() => setDrawerOpen(false)}
            accessibilityLabel={t('book.closeIndexA11y')}
            accessibilityRole="button"
          />
          <View style={[styles.drawerPanel, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.drawerHeader}>
              <Text style={{ color: c.text, fontSize: 15 * fs, fontWeight: '700', flex: 1 }}>
                {t('book.drawerTitle')}
              </Text>
              <Pressable
                onPress={() => setDrawerOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t('book.closeIndexA11y')}
                hitSlop={10}
              >
                <Text style={{ color: c.info, fontSize: 14 * fs }}>{t('book.close')}</Text>
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }}>
              {indexContent}
            </ScrollView>
          </View>
        </View>
      )}

      <Tutorial
        visible={showTutorial}
        currentStep={tutorialStep}
        onStepChange={setTutorialStep}
        steps={[
          { title: t('book.tutorial.rulebook.title'), body: t('book.tutorial.rulebook.body') },
          { title: t('book.tutorial.search.title'), body: t('book.tutorial.search.body') },
          { title: t('book.tutorial.quickref.title'), body: t('book.tutorial.quickref.body') },
        ]}
        onClose={() => {
          setShowTutorial(false);
          setTutorialStep(0);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  title: { fontWeight: '800' },
  input: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
  quickLinks: { flexDirection: 'row', marginBottom: 10 },
  quickChip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  tab: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1 },
  tabText: { fontWeight: '600' },
  body: { flex: 1, flexDirection: 'row', gap: 12 },
  index: {
    width: 230,
    borderRightWidth: 1,
    paddingRight: 8,
  },
  // Barra que abre el drawer del índice en pantallas estrechas
  drawerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
    alignSelf: 'flex-start',
    maxWidth: '60%',
  },
  drawerButton: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    minHeight: 32,
    justifyContent: 'center',
  },
  drawerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    flexDirection: 'row',
  },
  drawerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  drawerPanel: {
    width: '82%',
    maxWidth: 320,
    height: '100%',
    borderRightWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 16,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  indexHeading: {
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
    marginTop: 4,
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  indexItem: {
    paddingVertical: 5,
    paddingLeft: 18,
    paddingRight: 6,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  content: { flex: 1, paddingHorizontal: 4 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
    gap: 8,
  },
  related: {
    width: 210,
    borderLeftWidth: 1,
    paddingLeft: 12,
  },
  keywordChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  prevNext: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#3B405B',
  },
  navButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backButton: { padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  backText: { color: '#fff', fontWeight: 'bold' },
});
