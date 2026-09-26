/**
 * Pantalla del Taller de creación (Fase 12).
 *
 * Cumple UI-240: navegación secundaria (Resumen, Héroes, Habilidades, Mazos,
 *   Huestes, Señores, Mercado, Escenarios, Reglas, Conjuntos, Pruebas, Versiones).
 * Cumple UI-241: migas de pan con jerarquía.
 * Cumple UI-242: estado de guardado permanente.
 * Cumple UI-243: guardar borradores incompletos.
 * Cumple UI-244: errores no impiden guardar.
 * Cumple UI-250..255: editor de héroes (vista básica).
 * Cumple UI-260..267: constructor de mazos (vista básica).
 * Cumple UI-270..278: editor de cartas (vista básica).
 * Cumple UI-310..315: sandbox (vista básica).
 * Cumple UI-320..325: versionado y publicación (vista básica).
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useGameStore } from '../store/gameStore';
import { SaveIndicator } from './SaveIndicator';
import { setupGame } from '@nt4h/engine';
import { loadCatalog } from '@nt4h/catalog';
import type { CardDefinition, GameEvent } from '@nt4h/schema';
import { CreateCardTab } from './study/CreateCardTab';
import { useCustomContent } from '../lib/customContent';
import { cardNameIndex, parseDeckText } from '../lib/deckText';
import { toast } from '../lib/toast';
import { storageGet, storageSet } from '../lib/storage';
import { useColors, useSettingsSafe } from '../lib/useTheme';
import { fontSize, type Colors } from '../lib/theme';

const DRAFT_KEY = 'nt4h.study.draft';

/** Campos extra del JSON de catálogo que el schema Zod descarta (pericias en texto libre) */
const peritiaText = (card: CardDefinition | null | undefined): string | undefined =>
  (card as { _peritiaText?: string } | null | undefined)?._peritiaText;

interface StudyDraft {
  projectName: string;
  projectStatus: 'DRAFT' | 'REVIEW' | 'PUBLISHED';
  savedAt: number;
}

type StudyTab =
  | 'summary' | 'heroes' | 'abilities' | 'decks' | 'enemies'
  | 'bosses' | 'market' | 'scenarios' | 'rules' | 'sets'
  | 'tests' | 'versions' | 'create';

const TABS: { id: StudyTab; icon: string }[] = [
  { id: 'summary', icon: '📋' },
  { id: 'heroes', icon: '🦸' },
  { id: 'abilities', icon: '⚡' },
  { id: 'decks', icon: '🃏' },
  { id: 'enemies', icon: '👹' },
  { id: 'bosses', icon: '👑' },
  { id: 'market', icon: '💰' },
  { id: 'scenarios', icon: '🗺️' },
  { id: 'rules', icon: '📜' },
  { id: 'sets', icon: '📦' },
  { id: 'tests', icon: '🧪' },
  { id: 'versions', icon: '📋' },
  { id: 'create', icon: '✚' },
];

type TabGroupId = 'summary' | 'content' | 'structure' | 'quality';

/** 13 pestañas agrupadas: Resumen / Contenido / Estructura / Calidad */
const TAB_GROUPS: { id: TabGroupId; tabs: StudyTab[] }[] = [
  { id: 'summary', tabs: ['summary'] },
  { id: 'content', tabs: ['heroes', 'abilities', 'enemies', 'bosses', 'market', 'scenarios', 'create'] },
  { id: 'structure', tabs: ['decks', 'sets', 'rules'] },
  { id: 'quality', tabs: ['tests', 'versions'] },
];

export function StudyScreen({ initialTab }: { initialTab?: string }) {
  const { t } = useTranslation();
  const { styles, colors } = useStudyStyles();
  const router = useRouter();
  const catalog = useGameStore((s) => s.catalog);
  const [activeTab, setActiveTab] = useState<StudyTab>(
    () => (TABS.some((tab) => tab.id === initialTab) ? (initialTab as StudyTab) : 'summary'),
  );
  const [breadcrumb, setBreadcrumb] = useState<string>(t('study.title'));
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
  const [projectName, setProjectName] = useState(t('study.untitledProject'));
  const [projectStatus, setProjectStatus] = useState<'DRAFT' | 'REVIEW' | 'PUBLISHED'>('DRAFT');
  const [width, setWidth] = useState(() => Dimensions.get('window').width);
  const [menuOpen, setMenuOpen] = useState(false);
  const wide = width >= 900;

  // Ancho reactivo (Dimensions + listener; useWindowDimensions no existe en el mock de tests)
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setWidth(window.width));
    return () => sub.remove();
  }, []);

  // Restaurar borrador persistido (UI-242/243: guardado multiplataforma vía lib/storage)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await storageGet(DRAFT_KEY);
        if (cancelled || !raw) return;
        const draft = JSON.parse(raw) as StudyDraft;
        setProjectName(draft.projectName);
        setProjectStatus(draft.projectStatus);
        setLastSavedAt(draft.savedAt);
        setSaveState('saved');
      } catch { /* borrador corrupto: ignorar */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = useCallback(() => {
    setSaveState('saving');
    const draft: StudyDraft = { projectName, projectStatus, savedAt: Date.now() };
    void storageSet(DRAFT_KEY, JSON.stringify(draft))
      .then(() => {
        setSaveState('saved');
        setLastSavedAt(draft.savedAt);
      })
      .catch(() => setSaveState('error'));
  }, [projectName, projectStatus]);

  const handleTabChange = useCallback((tab: StudyTab) => {
    setActiveTab(tab);
    setMenuOpen(false);
    setBreadcrumb(t('study.breadcrumb', { section: t(`study.tabs.${tab}`) }));
  }, [t]);

  const tabContent = (
    <View style={styles.contentArea}>
      {!catalog && (
        <Text style={styles.hint}>{t('study.loadingCatalog')}</Text>
      )}
      {activeTab === 'summary' && (
        <SummaryTab
          catalog={catalog}
          projectName={projectName}
          projectStatus={projectStatus}
        />
      )}
      {activeTab === 'heroes' && <HeroesTab catalog={catalog} />}
      {activeTab === 'abilities' && <AbilitiesTab catalog={catalog} />}
      {activeTab === 'decks' && <DecksTab catalog={catalog} />}
      {activeTab === 'enemies' && <EnemiesTab catalog={catalog} />}
      {activeTab === 'bosses' && <BossesTab catalog={catalog} />}
      {activeTab === 'market' && <MarketTab catalog={catalog} />}
      {activeTab === 'scenarios' && <ScenariosTab catalog={catalog} />}
      {activeTab === 'rules' && <RulesTab catalog={catalog} />}
      {activeTab === 'sets' && <SetsTab />}
      {activeTab === 'tests' && <TestsTab catalog={catalog} />}
      {activeTab === 'versions' && <VersionsTab projectStatus={projectStatus} setProjectStatus={setProjectStatus} />}
      {activeTab === 'create' && <CreateCardTab />}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.screenTitle}>{t('study.title')}</Text>

      {/* Cabecera con estado de guardado (UI-242) */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TextInput
            style={styles.projectName}
            value={projectName}
            onChangeText={setProjectName}
            placeholder={t('study.projectNamePlaceholder')}
            placeholderTextColor={colors.textFaint}
            accessibilityLabel={t('study.projectNameA11y')}
          />
          <Text style={styles.projectStatus}>
            {t('study.statusLabel', { status: t(`study.status.${projectStatus}`) })}
          </Text>
        </View>
        <SaveIndicator state={saveState} lastSavedAt={lastSavedAt} />
      </View>

      {/* Migas de pan (UI-241) */}
      <View style={styles.breadcrumbRow}>
        <Text style={styles.breadcrumb}>{breadcrumb}</Text>
      </View>

      {wide ? (
        /* Navegación lateral agrupada (UI-240) en pantallas anchas */
        <View style={styles.bodyRow}>
          <View style={styles.sideNav}>
            {TAB_GROUPS.map((group) => (
              <View key={group.id} style={styles.sideGroup}>
                <Text style={styles.tabGroupLabel}>{t(`study.groups.${group.id}`)}</Text>
                {group.tabs.map((tabId) => {
                  const tab = TABS.find((x) => x.id === tabId)!;
                  return (
                    <Pressable
                      key={tab.id}
                      style={[styles.sideTab, activeTab === tab.id && styles.sideTabActive]}
                      onPress={() => handleTabChange(tab.id)}
                      accessibilityRole="tab"
                      accessibilityLabel={t(`study.tabs.${tab.id}`)}
                      accessibilityState={{ selected: activeTab === tab.id }}
                    >
                      <Text style={styles.tabIcon}>{tab.icon}</Text>
                      <Text style={[styles.sideTabLabel, activeTab === tab.id && styles.tabLabelActive]}>
                        {t(`study.tabs.${tab.id}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
          <View style={styles.contentCol}>
            {tabContent}
          </View>
        </View>
      ) : (
        <View>
          {/* Selector compacto: 13 pestañas no caben en una barra estrecha.
              "☰ Taller · <sección>" abre el índice agrupado. */}
          <Pressable
            style={styles.menuButton}
            onPress={() => setMenuOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={t('study.sectionA11y', { section: t(`study.tabs.${activeTab}`) })}
            accessibilityState={{ expanded: menuOpen }}
          >
            <Text style={styles.menuButtonText}>
              {t('study.menuLabel', { section: t(`study.tabs.${activeTab}`) })}
            </Text>
            <Text style={styles.menuButtonText}>{menuOpen ? '▲' : '▼'}</Text>
          </Pressable>
          {menuOpen && (
            <View style={styles.menuList}>
              {TAB_GROUPS.map((group) => (
                <View key={group.id} style={styles.menuGroup}>
                  <Text style={styles.tabGroupLabel}>{t(`study.groups.${group.id}`)}</Text>
                  {group.tabs.map((tabId) => {
                    const tab = TABS.find((x) => x.id === tabId)!;
                    return (
                      <Pressable
                        key={tab.id}
                        style={[styles.menuItem, activeTab === tab.id && styles.sideTabActive]}
                        onPress={() => handleTabChange(tab.id)}
                        accessibilityRole="tab"
                        accessibilityLabel={t(`study.tabs.${tab.id}`)}
                        accessibilityState={{ selected: activeTab === tab.id }}
                      >
                        <Text style={[styles.menuItemLabel, activeTab === tab.id && styles.tabLabelActive]}>
                          {t(`study.tabs.${tab.id}`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
          {tabContent}
        </View>
      )}

      {/* Botones de acción (UI-243, UI-244) */}
      <View style={styles.actionBar}>
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.actionButtonText}>{t('study.saveDraft')}</Text>
        </Pressable>
        <Pressable style={styles.backButton} onPress={() => router.push('/')}>
          <Text style={styles.actionButtonText}>{t('study.backHome')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ============================================================================
// Pestaña: Resumen
// ============================================================================

function SummaryTab({ catalog, projectName, projectStatus }: {
  catalog: ReturnType<typeof useGameStore.getState>['catalog'];
  projectName: string;
  projectStatus: string;
}) {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  const heroCount = useMemo(() => catalog?.byType.get('HERO')?.length ?? 0, [catalog]);
  const abilityCount = useMemo(() => {
    if (!catalog) return 0;
    return (catalog.byClass.get('EXPLORER')?.length ?? 0)
      + (catalog.byClass.get('WARRIOR')?.length ?? 0)
      + (catalog.byClass.get('MAGE')?.length ?? 0)
      + (catalog.byClass.get('ROGUE')?.length ?? 0);
  }, [catalog]);
  const enemyCount = catalog?.byType.get('HORDE')?.length ?? 0;
  const warlordCount = catalog?.byType.get('WARLORD')?.length ?? 0;
  const marketCount = catalog?.byType.get('MARKET')?.length ?? 0;
  const scenarioCount = catalog?.byType.get('SCENARIO')?.length ?? 0;

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.summary.projectTitle')}</Text>
      <Text style={styles.fieldLabel}>{t('study.summary.name', { name: projectName })}</Text>
      <Text style={styles.fieldLabel}>
        {t('study.summary.status', { status: t(`study.status.${projectStatus}`, { defaultValue: projectStatus }) })}
      </Text>
      <Text style={styles.sectionTitle}>{t('study.summary.catalogTitle')}</Text>
      <View style={styles.statsGrid}>
        <StatCard label={t('study.tabs.heroes')} value={heroCount} icon="🦸" />
        <StatCard label={t('study.tabs.abilities')} value={abilityCount} icon="⚡" />
        <StatCard label={t('study.tabs.enemies')} value={enemyCount} icon="👹" />
        <StatCard label={t('study.tabs.bosses')} value={warlordCount} icon="👑" />
        <StatCard label={t('study.tabs.market')} value={marketCount} icon="💰" />
        <StatCard label={t('study.tabs.scenarios')} value={scenarioCount} icon="🗺️" />
      </View>
    </View>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  const { styles } = useStudyStyles();
  return (
    <View style={styles.statCard}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ============================================================================
// Pestaña: Héroes (UI-250..255)
// ============================================================================

function HeroesTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  const heroes = catalog?.byType.get('HERO') ?? [];
  const [selectedHero, setSelectedHero] = useState<string | null>(null);

  if (selectedHero) {
    const hero = heroes.find(h => h.id === selectedHero);
    if (hero) {
      return (
        <View>
          <Pressable style={styles.backLink} onPress={() => setSelectedHero(null)}>
            <Text style={styles.backLinkText}>{t('study.heroes.back')}</Text>
          </Pressable>
          <Text style={styles.sectionTitle}>{hero.name}</Text>
          <Text style={styles.fieldLabel}>{t('study.heroes.id', { id: hero.id })}</Text>
          <Text style={styles.fieldLabel}>{t('study.heroes.type', { type: hero.type })}</Text>
          {hero.capabilities && (
            <Text style={styles.fieldLabel}>
              {t('study.heroes.capabilities', { list: hero.capabilities.join(', ') })}
            </Text>
          )}
          {hero.maxWounds !== undefined && (
            <Text style={styles.fieldLabel}>{t('study.heroes.maxWounds', { count: hero.maxWounds })}</Text>
          )}
          {hero.heroAbility && (
            <View style={styles.subSection}>
              <Text style={styles.subTitle}>{t('study.heroes.heroAbility')}</Text>
              <Text style={styles.fieldLabel}>{t('study.heroes.uses', { count: hero.heroAbility.uses })}</Text>
              {peritiaText(hero) && (
                <Text style={styles.fieldLabel}>{t('study.heroes.description', { text: peritiaText(hero) })}</Text>
              )}
            </View>
          )}
        </View>
      );
    }
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.heroes.title', { count: heroes.length })}</Text>
      <Text style={styles.hint}>{t('study.heroes.hint')}</Text>
      <ScrollView style={styles.cardList}>
        {heroes.map(hero => (
          <Pressable
            key={hero.id}
            style={styles.cardRow}
            onPress={() => setSelectedHero(hero.id)}
            accessibilityRole="button"
            accessibilityLabel={t('study.heroes.viewA11y', { name: hero.name })}
          >
            <Text style={styles.cardName}>{hero.name}</Text>
            <Text style={styles.cardMeta}>{hero.capabilities?.join(', ') ?? ''}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Pestaña: Habilidades
// ============================================================================

function AbilitiesTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  const [filterClass, setFilterClass] = useState<string>('ALL');
  const classes = ['ALL', 'EXPLORER', 'WARRIOR', 'MAGE', 'ROGUE'];

  const cards = useMemo(() => {
    if (!catalog) return [];
    if (filterClass === 'ALL') {
      return [...(catalog.byClass.get('EXPLORER') ?? []),
              ...(catalog.byClass.get('WARRIOR') ?? []),
              ...(catalog.byClass.get('MAGE') ?? []),
              ...(catalog.byClass.get('ROGUE') ?? [])];
    }
    return catalog.byClass.get(filterClass ?? '') ?? [];
  }, [catalog, filterClass]);

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.abilities.title', { count: cards.length })}</Text>
      <ScrollView horizontal style={styles.filterBar} showsHorizontalScrollIndicator={false}>
        {classes.map(cls => (
          <Pressable
            key={cls}
            style={[styles.filterChip, filterClass === cls && styles.filterChipActive]}
            onPress={() => setFilterClass(cls)}
          >
            <Text style={styles.filterChipText}>{t(`study.classes.${cls}`, { defaultValue: cls })}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView style={styles.cardList}>
        {cards.map(card => (
          <View key={card.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardMeta}>
                {t('study.abilities.meta', {
                  cls: t(`study.classes.${card.heroClass}`, { defaultValue: card.heroClass }),
                  attack: card.printedAttack ?? '-',
                  copies: card.copies,
                })}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Pestaña: Mazos (UI-260..267)
// ============================================================================

function DecksTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
  const { t } = useTranslation();
  const { styles, colors } = useStudyStyles();
  const [deckCards, setDeckCards] = useState<Record<string, number>>({});
  const [selectedClass, setSelectedClass] = useState<string>('EXPLORER');
  const [deckName, setDeckName] = useState('');
  const [deckErrors, setDeckErrors] = useState<string[]>([]);
  const [importText, setImportText] = useState('');
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const upsertDeck = useCustomContent((s) => s.upsertDeck);
  const removeDeck = useCustomContent((s) => s.removeDeck);
  // Borrar un mazo guardado es irreversible — holdToConfirm lo pasa a long-press
  const holdToConfirm = useSettingsSafe((s) => s.holdToConfirm);
  const savedDecks = useCustomContent((s) => s.sets).flatMap(s => s.decks);

  const classCards = catalog?.byClass.get(selectedClass) ?? [];
  const totalCards = Object.values(deckCards).reduce((sum, n) => sum + n, 0);
  const maxCards = 15;
  const isValid = totalCards === maxCards;

  const saveDeck = () => {
    if (!deckName.trim()) { setDeckErrors([t('study.decks.needsName')]); return; }
    const slug = deckName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const errors = upsertDeck({
      id: `deck.custom.${slug || 'mazo'}`,
      name: deckName.trim(),
      heroClassIds: [selectedClass as 'EXPLORER'],
      cardEntries: Object.entries(deckCards).map(([cardDefinitionId, copies]) => ({ cardDefinitionId, copies })),
      deckSize: 15,
      allowedGameModes: ['STANDARD', 'SOLO'],
      setId: 'set.taller-local',
      officialStatus: 'CUSTOM',
      author: 'local',
      version: '1.0.0',
    });
    setDeckErrors(errors);
    if (errors.length === 0) { setDeckCards({}); setDeckName(''); }
  };

  const addCard = (cardId: string) => {
    if (totalCards >= maxCards) return;
    setDeckCards(prev => ({ ...prev, [cardId]: (prev[cardId] ?? 0) + 1 }));
  };
  const removeCard = (cardId: string) => {
    setDeckCards(prev => {
      const current = prev[cardId] ?? 0;
      if (current <= 0) return prev;
      const next = { ...prev, [cardId]: current - 1 };
      if (next[cardId] === 0) delete next[cardId];
      return next;
    });
  };

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.decks.builderTitle')}</Text>
      <Text style={styles.deckCounter}>
        {t('study.decks.counter', { count: totalCards, max: maxCards })} {isValid ? '✓' : ''}
      </Text>
      {!isValid && totalCards > 0 && (
        <Text style={styles.deckWarning}>
          {totalCards < maxCards
            ? t('study.decks.missing', { count: maxCards - totalCards })
            : t('study.decks.extra', { count: totalCards - maxCards })}
        </Text>
      )}
      {totalCards >= maxCards && (
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          {t('study.decks.complete')}
        </Text>
      )}
      {isValid && (
        <View style={styles.deckSaveRow}>
          <TextInput
            style={styles.deckNameInput}
            value={deckName}
            onChangeText={setDeckName}
            placeholder={t('study.decks.namePlaceholder')}
            placeholderTextColor={colors.textFaint}
            accessibilityLabel={t('study.decks.nameA11y')}
          />
          <Pressable style={styles.saveButton} onPress={saveDeck}
            accessibilityRole="button" accessibilityLabel={t('study.decks.saveA11y')}>
            <Text style={styles.actionButtonText}>{t('study.decks.save')}</Text>
          </Pressable>
        </View>
      )}
      {deckErrors.map((e, i) => <Text key={i} style={styles.deckWarning}>• {e}</Text>)}

      {/* Importar lista de texto ("4 Espadazo", "4x Ballesta"…) — como en
          Untap/Cockatrice. Reconoce por nombre insensible a tildes. */}
      <View style={{ marginTop: 16 }}>
        <Text style={styles.sectionTitle}>{t('study.decks.importTitle')}</Text>
        <TextInput
          style={[styles.deckNameInput, { minHeight: 64, textAlignVertical: 'top' }]}
          value={importText}
          onChangeText={setImportText}
          placeholder={t('study.decks.importPlaceholder')}
          placeholderTextColor={colors.textFaint}
          multiline
          accessibilityLabel={t('study.decks.importA11y')}
        />
        <Pressable
          style={[styles.saveButton, { alignSelf: 'flex-start', marginTop: 6 }]}
          onPress={() => {
            if (!catalog) return;
            const index = cardNameIndex(catalog.byId.values());
            const parsed = parseDeckText(importText, index);
            const notes: string[] = [];
            if (parsed.total > 0) {
              setDeckCards(parsed.cards);
              if (parsed.classes.length === 1) setSelectedClass(parsed.classes[0]);
              notes.push(t('study.decks.importApplied', { count: parsed.total }));
              if (parsed.total !== maxCards) {
                notes.push(t('study.decks.importCount', { count: parsed.total, max: maxCards }));
              }
            }
            for (const u of parsed.unknown) {
              notes.push(t('study.decks.importUnknown', { name: u }));
            }
            if (parsed.total === 0 && parsed.unknown.length === 0) {
              notes.push(t('study.decks.importEmpty'));
            }
            setImportNotes(notes);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('study.decks.importA11y')}
        >
          <Text style={styles.actionButtonText}>{t('study.decks.importButton')}</Text>
        </Pressable>
        {importNotes.map((n, i) => (
          <Text key={i} style={styles.deckWarning} accessibilityLiveRegion="polite">• {n}</Text>
        ))}
      </View>

      {savedDecks.length > 0 && (
        <View style={{ marginTop: 16 }}>
          {/* holdToConfirm: borrar un mazo guardado es irreversible */}
          <Text style={styles.sectionTitle}>{t('study.decks.customTitle', { count: savedDecks.length })}</Text>
          {savedDecks.map(d => (
            <View key={d.id} style={styles.cardRow}>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{d.name}</Text>
                <Text style={styles.cardMeta}>
                  {t('study.decks.meta', {
                    count: d.cardEntries.reduce((a, e) => a + e.copies, 0),
                    classes: d.heroClassIds.map((cls) => t(`study.classes.${cls}`, { defaultValue: cls })).join(' + '),
                  })}
                </Text>
              </View>
              <Pressable
                onPress={holdToConfirm ? undefined : () => removeDeck(d.id)}
                onLongPress={holdToConfirm ? () => removeDeck(d.id) : undefined}
                delayLongPress={600}
                accessibilityRole="button" accessibilityLabel={t('study.decks.deleteA11y', { name: d.name })}
                accessibilityHint={holdToConfirm ? t('profile.holdToConfirmHint') : undefined}>
                <Text style={styles.cardMeta}>✕</Text>
              </Pressable>
            </View>
          ))}
          <Text style={styles.hint}>{t('study.decks.customHint')}</Text>
        </View>
      )}
      <ScrollView horizontal style={styles.filterBar} showsHorizontalScrollIndicator={false}>
        {['EXPLORER', 'WARRIOR', 'MAGE', 'ROGUE'].map(cls => (
          <Pressable
            key={cls}
            style={[styles.filterChip, selectedClass === cls && styles.filterChipActive]}
            onPress={() => setSelectedClass(cls)}
          >
            <Text style={styles.filterChipText}>{t(`study.classes.${cls}`, { defaultValue: cls })}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView style={styles.cardList}>
        {classCards.map(card => {
          const count = deckCards[card.id] ?? 0;
          return (
            <View key={card.id} style={styles.cardRow}>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{card.name}</Text>
                <Text style={styles.cardMeta}>{t('study.decks.copies', { count, max: card.copies })}</Text>
              </View>
              <View style={styles.cardControls}>
                <Pressable
                  style={[styles.qtyButton, count === 0 && styles.qtyButtonDisabled]}
                  onPress={() => removeCard(card.id)}
                  disabled={count === 0}
                  accessibilityRole="button"
                  accessibilityLabel={t('study.decks.removeCopyA11y', { name: card.name })}
                >
                  <Text style={styles.qtyButtonText}>-</Text>
                </Pressable>
                <Text style={styles.qtyValue}>{count}</Text>
                <Pressable
                  style={[styles.qtyButton, (count >= card.copies || totalCards >= maxCards) && styles.qtyButtonDisabled]}
                  onPress={() => count < card.copies && addCard(card.id)}
                  disabled={count >= card.copies || totalCards >= maxCards}
                  accessibilityRole="button"
                  accessibilityLabel={t('study.decks.addCopyA11y', { name: card.name })}
                  accessibilityState={{ disabled: count >= card.copies || totalCards >= maxCards }}
                >
                  <Text style={styles.qtyButtonText}>+</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Pestaña: Huestes
// ============================================================================

function EnemiesTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  const enemies = catalog?.byType.get('HORDE') ?? [];
  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.enemies.title', { count: enemies.length })}</Text>
      <ScrollView style={styles.cardList}>
        {enemies.map(enemy => (
          <View key={enemy.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{enemy.name}</Text>
              <Text style={styles.cardMeta}>
                {t('study.enemies.meta', { fortitude: enemy.printedFortitude ?? '-', copies: enemy.copies })}
                {enemy.isOrc ? t('study.enemies.orc') : ''}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Pestaña: Señores de la Guerra
// ============================================================================

function BossesTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  const bosses = catalog?.byType.get('WARLORD') ?? [];
  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.bosses.title', { count: bosses.length })}</Text>
      <ScrollView style={styles.cardList}>
        {bosses.map(boss => (
          <View key={boss.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{boss.name}</Text>
              <Text style={styles.cardMeta}>
                {t('study.bosses.meta', { fortitude: boss.printedFortitude ?? '-' })}
                {peritiaText(boss) ? ` · ${peritiaText(boss)}` : ''}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Pestaña: Mercado
// ============================================================================

function MarketTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  const market = catalog?.byType.get('MARKET') ?? [];
  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.market.title', { count: market.length })}</Text>
      <ScrollView style={styles.cardList}>
        {market.map(card => (
          <View key={card.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardMeta}>
                {t('study.market.meta', { cost: card.printedCost ?? '-', copies: card.copies })}
                {card.requiredCapabilities?.length ? ` · ${card.requiredCapabilities.join('+')}` : ''}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Pestaña: Escenarios
// ============================================================================

function ScenariosTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  const scenarios = catalog?.byType.get('SCENARIO') ?? [];
  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.scenarios.title', { count: scenarios.length })}</Text>
      <ScrollView style={styles.cardList}>
        {scenarios.map(scenario => (
          <View key={scenario.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{scenario.name}</Text>
              <Text style={styles.cardMeta}>{scenario.id}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Pestaña: Reglas (UI-280..289)
// ============================================================================

function RulesTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  // Datos reales: qué efectos usa el catálogo y cuántas cartas los tienen
  const effectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const collect = (effects: unknown): void => {
      if (!Array.isArray(effects)) return;
      for (const e of effects) {
        const t = (e as { type?: string })?.type;
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    };
    for (const card of catalog?.byId.values() ?? []) {
      collect(card.effects);
      collect((card as { triggeredEffects?: unknown }).triggeredEffects);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [catalog]);

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.rules.title')}</Text>
      <Text style={styles.hint}>
        {t('study.rules.hint', { count: effectCounts.length })}
      </Text>
      {effectCounts.map(([type, count], i) => (
        <View key={type} style={styles.ruleBlock}>
          <Text style={styles.ruleNumber}>{i + 1}.</Text>
          <Text style={styles.ruleText}>{type}</Text>
          <Text style={styles.ruleCount}>×{count}</Text>
        </View>
      ))}
    </View>
  );
}

// ============================================================================
// Pestaña: Conjuntos
// ============================================================================

function SetsTab() {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  const sets = useCustomContent((s) => s.sets);
  const history = useCustomContent((s) => s.history);
  const published = useCustomContent((s) => s.published);
  const undo = useCustomContent((s) => s.undo);
  const publish = useCustomContent((s) => s.publish);
  const restoreVersion = useCustomContent((s) => s.restoreVersion);
  const [publishErrors, setPublishErrors] = useState<Record<string, string[]>>({});

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.sets.title')}</Text>
      <Text style={styles.hint}>
        {t('study.sets.hint')}
      </Text>
      {sets.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            {t('study.sets.empty')}
          </Text>
        </View>
      ) : (
        sets.map(set => (
          <View key={set.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{set.name}</Text>
              <Text style={styles.cardMeta}>
                {t('study.sets.meta', {
                  cards: t(set.cards.length === 1 ? 'study.sets.cardsOne' : 'study.sets.cardsOther', { count: set.cards.length }),
                  decks: t(set.decks.length === 1 ? 'study.sets.decksOne' : 'study.sets.decksOther', { count: set.decks.length }),
                  version: set.version,
                })}
              </Text>
              {set.description ? (
                <Text style={styles.cardMeta}>{set.description}</Text>
              ) : null}

              {/* Acciones de versionado */}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                <Pressable
                  onPress={() => { if (!undo(set.id)) toast.show(t('study.sets.nothingToUndo')); }}
                  disabled={(history[set.id]?.length ?? 0) === 0}
                  accessibilityRole="button"
                  accessibilityLabel={t('study.sets.undoA11y', { name: set.name })}
                >
                  <Text style={[styles.cardMeta, { color: '#7fb3d3', textDecorationLine: 'underline' }]}>
                    {t('study.sets.undo', { count: history[set.id]?.length ?? 0 })}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const errs = publish(set.id);
                    setPublishErrors((prev) => ({ ...prev, [set.id]: errs }));
                    if (errs.length === 0) toast.show(t('study.sets.published'));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('study.sets.publishA11y', { name: set.name })}
                >
                  <Text style={[styles.cardMeta, { color: '#82e0aa', textDecorationLine: 'underline' }]}>
                    {t('study.sets.publish')}
                  </Text>
                </Pressable>
              </View>
              {(publishErrors[set.id]?.length ?? 0) > 0 && (
                <Text style={styles.sandboxError}>
                  {publishErrors[set.id].join(' · ')}
                </Text>
              )}

              {/* Versiones publicadas (inmutables) */}
              {(published[set.id] ?? []).map((v) => (
                <View key={v.version} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 }}>
                  <Text style={styles.cardMeta}>
                    {t('study.sets.versionMeta', {
                      version: v.version,
                      date: new Date(v.publishedAt).toLocaleDateString(),
                      checksum: v.checksum,
                    })}
                  </Text>
                  <Pressable
                    onPress={() => { restoreVersion(set.id, v.version); toast.show(t('study.sets.restored', { version: v.version })); }}
                    accessibilityRole="button"
                    accessibilityLabel={t('study.sets.restoreA11y', { version: v.version, name: set.name })}
                  >
                    <Text style={[styles.cardMeta, { color: '#f5b041', textDecorationLine: 'underline' }]}>
                      {t('study.sets.restore')}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
            <Text style={styles.setStatus}>
              {t(`study.sets.status.${set.status}`, { defaultValue: set.status })}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

// ============================================================================
// Pestaña: Pruebas (UI-310..315)
// ============================================================================

function TestsTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  // Sandbox real: ejecuta setupGame del motor y muestra eventos + estado resultante
  const [run, setRun] = useState<{
    events: GameEvent[];
    players: number;
    enemies: number;
    pending: number;
    seed: string;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const runTest = () => {
    try {
      const cat = catalog ?? loadCatalog();
      const seed = `sandbox-${Date.now()}`;
      const result = setupGame(
        {
          mode: 'STANDARD',
          playerCount: 2,
          seed,
          heroes: [
            { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
            { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
          ],
          useScenarios: true,
        },
        cat,
      );
      setRun({
        events: result.events,
        players: Object.keys(result.state.players).length,
        enemies: result.state.battlefield.length,
        pending: result.state.pendingChoices.length,
        seed,
      });
      setRunError(null);
    } catch (e) {
      setRun(null);
      setRunError(e instanceof Error ? e.message : t('study.tests.runError'));
    }
  };

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.tests.title')}</Text>
      <Text style={styles.hint}>
        {t('study.tests.hint')}
      </Text>
      <Pressable
        style={styles.sandboxRun}
        onPress={runTest}
        accessibilityRole="button"
        accessibilityLabel={t('study.tests.runA11y')}
      >
        <Text style={styles.sandboxRunText}>{t('study.tests.run')}</Text>
      </Pressable>

      {runError && <Text style={styles.sandboxError}>{runError}</Text>}

      {run && (
        <View style={styles.sandboxState}>
          <Text style={styles.sandboxStateTitle}>{t('study.tests.result')}</Text>
          <Text style={styles.sandboxMeta}>{t('study.tests.seed', { seed: run.seed })}</Text>
          <Text style={styles.sandboxMeta}>
            {t('study.tests.summary', { players: run.players, enemies: run.enemies, pending: run.pending })}
          </Text>
          <Text style={styles.sandboxStateTitle}>{t('study.tests.events', { count: run.events.length })}</Text>
          <ScrollView style={styles.sandboxEvents}>
            {run.events.slice(0, 60).map((e, i) => (
              <Text key={i} style={styles.sandboxEvent}>
                #{e.seq} {e.type}
              </Text>
            ))}
            {run.events.length > 60 && (
              <Text style={styles.sandboxMeta}>{t('study.tests.more', { count: run.events.length - 60 })}</Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ============================================================================
// Pestaña: Versiones (UI-320..325)
// ============================================================================

function VersionsTab({ projectStatus, setProjectStatus }: {
  projectStatus: string;
  setProjectStatus: (s: 'DRAFT' | 'REVIEW' | 'PUBLISHED') => void;
}) {
  const { t } = useTranslation();
  const { styles } = useStudyStyles();
  return (
    <View>
      <Text style={styles.sectionTitle}>{t('study.versions.title')}</Text>
      <Text style={styles.fieldLabel}>
        {t('study.versions.current', { status: t(`study.status.${projectStatus}`, { defaultValue: projectStatus }) })}
      </Text>
      <Text style={styles.hint}>{t('study.versions.possible')}</Text>
      <View style={styles.versionActions}>
        <Pressable style={styles.versionButton} onPress={() => setProjectStatus('REVIEW')}>
          <Text style={styles.versionButtonText}>{t('study.versions.sendReview')}</Text>
        </Pressable>
        <Pressable
          style={[styles.versionButton, styles.publishButton]}
          onPress={() => setProjectStatus('PUBLISHED')}
        >
          <Text style={styles.versionButtonText}>{t('study.versions.publish')}</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>{t('study.versions.hint')}</Text>
    </View>
  );
}

// ============================================================================
// Estilos (tokens de tema vía useColors)
// ============================================================================

/** Hook de estilos del Taller: reconstruye la hoja si cambia la paleta. */
function useStudyStyles() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return { styles, colors: c };
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { padding: 16 },
  screenTitle: { color: c.accent, fontSize: fontSize.section, fontWeight: 'bold', marginBottom: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  headerLeft: { flex: 1 },
  projectName: { color: c.accent, fontSize: fontSize.section, fontWeight: 'bold', marginBottom: 4 },
  projectStatus: { color: c.textMuted, fontSize: fontSize.micro },
  breadcrumbRow: { marginBottom: 12 },
  breadcrumb: { color: c.info, fontSize: fontSize.micro },
  tabBar: { flexDirection: 'row', marginBottom: 16 },
  tabGroup: { marginRight: 18 },
  // Selector compacto de sección (pantallas estrechas)
  menuButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    minHeight: 44,
  },
  menuButtonText: { color: c.text, fontSize: fontSize.detail, fontWeight: '700' },
  menuList: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  menuGroup: { marginBottom: 10 },
  menuItem: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  menuItemLabel: { color: c.textMuted, fontSize: fontSize.detail },
  tabGroupLabel: {
    color: c.textFaint,
    fontSize: fontSize.micro,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  tabGroupItems: { flexDirection: 'row', gap: 4 },
  tab: {
    backgroundColor: c.surface,
    padding: 8,
    borderRadius: 8,
    marginRight: 6,
    alignItems: 'center',
    minWidth: 60,
  },
  tabActive: { backgroundColor: c.primary },
  tabIcon: { fontSize: 18 },
  tabLabel: { color: c.textMuted, fontSize: fontSize.micro, marginTop: 2 },
  tabLabelActive: { color: c.text },
  bodyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  sideNav: { width: 200 },
  sideGroup: { marginBottom: 14 },
  sideTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.surface,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  sideTabActive: { backgroundColor: c.primary },
  sideTabLabel: { color: c.textMuted, fontSize: fontSize.detail },
  contentCol: { flex: 1 },
  contentArea: { minHeight: 300, marginBottom: 16 },
  sectionTitle: { color: c.accent, fontSize: fontSize.section, fontWeight: 'bold', marginBottom: 8 },
  fieldLabel: { color: c.text, fontSize: fontSize.detail, marginBottom: 4 },
  hint: { color: c.textFaint, fontSize: fontSize.micro, fontStyle: 'italic', marginBottom: 8 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: {
    backgroundColor: c.surface,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 90,
    marginBottom: 8,
  },
  statIcon: { fontSize: 24 },
  statValue: { color: c.accent, fontSize: fontSize.section, fontWeight: 'bold' },
  statLabel: { color: c.textMuted, fontSize: fontSize.micro },
  cardList: { maxHeight: 400 },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: c.surface,
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  cardInfo: { flex: 1 },
  cardName: { color: c.text, fontSize: fontSize.detail, fontWeight: 'bold' },
  cardMeta: { color: c.textMuted, fontSize: fontSize.micro, marginTop: 2 },
  ruleCount: { color: c.textMuted, fontSize: fontSize.micro, marginLeft: 'auto' },
  addButton: {
    backgroundColor: c.success,
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  addButtonText: { color: c.text, fontSize: fontSize.detail, fontWeight: 'bold' },
  filterBar: { flexDirection: 'row', marginBottom: 12 },
  filterChip: {
    backgroundColor: c.surface,
    padding: 6,
    borderRadius: 12,
    marginRight: 6,
  },
  filterChipActive: { backgroundColor: c.primary },
  filterChipText: { color: c.text, fontSize: fontSize.micro },
  deckCounter: { color: c.accent, fontSize: fontSize.body, fontWeight: 'bold', marginBottom: 4 },
  deckWarning: { color: c.danger, fontSize: fontSize.micro, marginBottom: 8 },
  deckSaveRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  deckNameInput: {
    flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, color: c.text, fontSize: fontSize.detail,
  },
  cardControls: { flexDirection: 'row', alignItems: 'center' },
  qtyButton: {
    backgroundColor: c.surfaceRaised,
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonDisabled: { opacity: 0.3 },
  qtyButtonText: { color: c.text, fontSize: fontSize.body, fontWeight: 'bold' },
  qtyValue: { color: c.text, fontSize: fontSize.detail, marginHorizontal: 8 },
  backLink: { marginBottom: 12 },
  backLinkText: { color: c.info, fontSize: fontSize.detail },
  subSection: { marginTop: 12, padding: 10, backgroundColor: c.surface, borderRadius: 6 },
  subTitle: { color: c.accent, fontSize: fontSize.detail, fontWeight: 'bold', marginBottom: 4 },
  ruleBlock: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  ruleNumber: { color: c.accent, fontSize: fontSize.detail, fontWeight: 'bold', marginRight: 8 },
  ruleText: { color: c.text, fontSize: fontSize.detail },
  emptyState: { alignItems: 'center', padding: 20 },
  emptyText: { color: c.textMuted, fontSize: fontSize.detail, marginBottom: 12, textAlign: 'center' },
  setStatus: { color: c.accent, fontSize: fontSize.micro, fontWeight: 'bold' },
  sandboxRun: {
    backgroundColor: c.primary,
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 12,
  },
  sandboxRunText: { color: c.text, fontSize: fontSize.detail, fontWeight: 'bold' },
  sandboxError: { color: c.danger, fontSize: fontSize.micro, marginBottom: 8 },
  sandboxState: {
    backgroundColor: c.surface,
    padding: 12,
    borderRadius: 6,
  },
  sandboxStateTitle: { color: c.text, fontSize: fontSize.detail, fontWeight: 'bold', marginBottom: 4, marginTop: 8 },
  sandboxMeta: { color: c.textMuted, fontSize: fontSize.micro, marginBottom: 4 },
  sandboxEvents: { maxHeight: 300 },
  sandboxEvent: { color: c.textMuted, fontSize: fontSize.micro, marginBottom: 2 },
  versionActions: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  versionButton: {
    backgroundColor: c.surfaceRaised,
    padding: 10,
    borderRadius: 6,
    marginRight: 8,
  },
  publishButton: { backgroundColor: c.success },
  versionButtonText: { color: c.text, fontSize: fontSize.detail, fontWeight: 'bold' },
  actionBar: { flexDirection: 'row', gap: 8, marginTop: 16 },
  saveButton: {
    backgroundColor: c.primary,
    padding: 12,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },
  backButton: {
    backgroundColor: c.textFaint,
    padding: 12,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },
  actionButtonText: { color: c.text, fontSize: fontSize.body, fontWeight: 'bold' },
});

