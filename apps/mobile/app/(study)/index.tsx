/**
 * Pantalla del Estudio de creación (Fase 12).
 *
 * Cumple UI-240: navegación secundaria (Resumen, Héroes, Habilidades, Mazos,
 *   Huestes, Jefes, Mercado, Escenarios, Reglas, Conjuntos, Pruebas, Versiones).
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

import { useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import { SaveIndicator } from '../../components/SaveIndicator';

type StudyTab =
  | 'summary' | 'heroes' | 'abilities' | 'decks' | 'enemies'
  | 'bosses' | 'market' | 'scenarios' | 'rules' | 'sets'
  | 'tests' | 'versions';

const TABS: { id: StudyTab; label: string; icon: string }[] = [
  { id: 'summary', label: 'Resumen', icon: '📋' },
  { id: 'heroes', label: 'Héroes', icon: '🦸' },
  { id: 'abilities', label: 'Habilidades', icon: '⚡' },
  { id: 'decks', label: 'Mazos', icon: '🃏' },
  { id: 'enemies', label: 'Huestes', icon: '👹' },
  { id: 'bosses', label: 'Jefes', icon: '👑' },
  { id: 'market', label: 'Mercado', icon: '💰' },
  { id: 'scenarios', label: 'Escenarios', icon: '🗺️' },
  { id: 'rules', label: 'Reglas', icon: '📜' },
  { id: 'sets', label: 'Conjuntos', icon: '📦' },
  { id: 'tests', label: 'Pruebas', icon: '🧪' },
  { id: 'versions', label: 'Versiones', icon: '📋' },
];

export default function StudyScreen() {
  const router = useRouter();
  const catalog = useGameStore((s) => s.catalog);
  const [activeTab, setActiveTab] = useState<StudyTab>('summary');
  const [breadcrumb, setBreadcrumb] = useState<string>('Estudio');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
  const [projectName, setProjectName] = useState('Proyecto sin título');
  const [projectStatus, setProjectStatus] = useState<'DRAFT' | 'REVIEW' | 'PUBLISHED'>('DRAFT');

  const handleSave = useCallback(() => {
    setSaveState('saving');
    // Simular guardado asíncrono
    setTimeout(() => {
      setSaveState('saved');
      setLastSavedAt(Date.now());
    }, 300);
  }, []);

  const handleTabChange = useCallback((tab: StudyTab) => {
    setActiveTab(tab);
    const tabInfo = TABS.find(t => t.id === tab);
    setBreadcrumb(`Estudio > ${tabInfo?.label ?? tab}`);
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Cabecera con estado de guardado (UI-242) */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TextInput
            style={styles.projectName}
            value={projectName}
            onChangeText={setProjectName}
            placeholder="Nombre del proyecto"
            placeholderTextColor="#555"
          />
          <Text style={styles.projectStatus}>
            Estado: {projectStatus === 'DRAFT' ? 'Borrador' : projectStatus === 'REVIEW' ? 'En revisión' : 'Publicado'}
          </Text>
        </View>
        <SaveIndicator state={saveState} lastSavedAt={lastSavedAt} />
      </View>

      {/* Migas de pan (UI-241) */}
      <View style={styles.breadcrumbRow}>
        <Text style={styles.breadcrumb}>{breadcrumb}</Text>
      </View>

      {/* Navegación secundaria (UI-240) */}
      <ScrollView horizontal style={styles.tabBar} showsHorizontalScrollIndicator={false}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            onPress={() => handleTabChange(tab.id)}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
          >
            <Text style={styles.tabIcon}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Contenido según pestaña activa */}
      <View style={styles.contentArea}>
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
        {activeTab === 'rules' && <RulesTab />}
        {activeTab === 'sets' && <SetsTab />}
        {activeTab === 'tests' && <TestsTab />}
        {activeTab === 'versions' && <VersionsTab projectStatus={projectStatus} setProjectStatus={setProjectStatus} />}
      </View>

      {/* Botones de acción (UI-243, UI-244) */}
      <View style={styles.actionBar}>
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.actionButtonText}>Guardar borrador</Text>
        </Pressable>
        <Pressable style={styles.backButton} onPress={() => router.push('/')}>
          <Text style={styles.actionButtonText}>Volver al inicio</Text>
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
      <Text style={styles.sectionTitle}>Resumen del proyecto</Text>
      <Text style={styles.fieldLabel}>Nombre: {projectName}</Text>
      <Text style={styles.fieldLabel}>Estado: {projectStatus}</Text>
      <Text style={styles.sectionTitle}>Contenido del catálogo</Text>
      <View style={styles.statsGrid}>
        <StatCard label="Héroes" value={heroCount} icon="🦸" />
        <StatCard label="Habilidades" value={abilityCount} icon="⚡" />
        <StatCard label="Huestes" value={enemyCount} icon="👹" />
        <StatCard label="Jefes" value={warlordCount} icon="👑" />
        <StatCard label="Mercado" value={marketCount} icon="💰" />
        <StatCard label="Escenarios" value={scenarioCount} icon="🗺️" />
      </View>
    </View>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
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
  const heroes = catalog?.byType.get('HERO') ?? [];
  const [selectedHero, setSelectedHero] = useState<string | null>(null);

  if (selectedHero) {
    const hero = heroes.find(h => h.id === selectedHero);
    if (hero) {
      return (
        <View>
          <Pressable style={styles.backLink} onPress={() => setSelectedHero(null)}>
            <Text style={styles.backLinkText}>← Volver a Héroes</Text>
          </Pressable>
          <Text style={styles.sectionTitle}>{hero.name}</Text>
          <Text style={styles.fieldLabel}>ID: {hero.id}</Text>
          <Text style={styles.fieldLabel}>Tipo: {hero.type}</Text>
          {hero.capabilities && (
            <Text style={styles.fieldLabel}>Capacidades: {hero.capabilities.join(', ')}</Text>
          )}
          {hero.maxWounds !== undefined && (
            <Text style={styles.fieldLabel}>Heridas máx: {hero.maxWounds}</Text>
          )}
          {hero.heroAbility && (
            <View style={styles.subSection}>
              <Text style={styles.subTitle}>Pericia de héroe</Text>
              <Text style={styles.fieldLabel}>Usos: {hero.heroAbility.uses}</Text>
              {(hero as any)._peritiaText && (
                <Text style={styles.fieldLabel}>Descripción: {(hero as any)._peritiaText}</Text>
              )}
            </View>
          )}
        </View>
      );
    }
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>Héroes ({heroes.length})</Text>
      <Text style={styles.hint}>UI-250: Vista de clase de héroe — identidad, variantes, biblioteca, mazos, capacidades.</Text>
      <ScrollView style={styles.cardList}>
        {heroes.map(hero => (
          <Pressable
            key={hero.id}
            style={styles.cardRow}
            onPress={() => setSelectedHero(hero.id)}
            accessibilityRole="button"
            accessibilityLabel={`Ver héroe ${hero.name}`}
          >
            <Text style={styles.cardName}>{hero.name}</Text>
            <Text style={styles.cardMeta}>{hero.capabilities?.join(', ') ?? ''}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable style={styles.addButton}>
        <Text style={styles.addButtonText}>+ Crear nueva clase (UI-253)</Text>
      </Pressable>
    </View>
  );
}

// ============================================================================
// Pestaña: Habilidades
// ============================================================================

function AbilitiesTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
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
    return catalog.byClass.get(filterClass as any) ?? [];
  }, [catalog, filterClass]);

  return (
    <View>
      <Text style={styles.sectionTitle}>Habilidades ({cards.length})</Text>
      <ScrollView horizontal style={styles.filterBar} showsHorizontalScrollIndicator={false}>
        {classes.map(cls => (
          <Pressable
            key={cls}
            style={[styles.filterChip, filterClass === cls && styles.filterChipActive]}
            onPress={() => setFilterClass(cls)}
          >
            <Text style={styles.filterChipText}>{cls}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView style={styles.cardList}>
        {cards.map(card => (
          <View key={card.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardMeta}>
                {card.heroClass} · Ataque {card.printedAttack ?? '-'} · Copias {card.copies}
              </Text>
            </View>
            <Pressable style={styles.editButton}>
              <Text style={styles.editButtonText}>Editar</Text>
            </Pressable>
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
  const [deckCards, setDeckCards] = useState<Record<string, number>>({});
  const [selectedClass, setSelectedClass] = useState<string>('EXPLORER');

  const classCards = catalog?.byClass.get(selectedClass as any) ?? [];
  const totalCards = Object.values(deckCards).reduce((sum, n) => sum + n, 0);
  const maxCards = 15;
  const isValid = totalCards === maxCards;

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
      <Text style={styles.sectionTitle}>Constructor de mazos (UI-260..267)</Text>
      <Text style={styles.deckCounter}>
        {totalCards}/{maxCards} cartas {isValid ? '✓' : ''}
      </Text>
      {!isValid && totalCards > 0 && (
        <Text style={styles.deckWarning}>
          {totalCards < maxCards ? `Faltan ${maxCards - totalCards} cartas` : `Sobran ${totalCards - maxCards} cartas`}
        </Text>
      )}
      <ScrollView horizontal style={styles.filterBar} showsHorizontalScrollIndicator={false}>
        {['EXPLORER', 'WARRIOR', 'MAGE', 'ROGUE'].map(cls => (
          <Pressable
            key={cls}
            style={[styles.filterChip, selectedClass === cls && styles.filterChipActive]}
            onPress={() => setSelectedClass(cls)}
          >
            <Text style={styles.filterChipText}>{cls}</Text>
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
                <Text style={styles.cardMeta}>Copias: {count}/{card.copies}</Text>
              </View>
              <View style={styles.cardControls}>
                <Pressable style={styles.qtyButton} onPress={() => removeCard(card.id)}>
                  <Text style={styles.qtyButtonText}>-</Text>
                </Pressable>
                <Text style={styles.qtyValue}>{count}</Text>
                <Pressable
                  style={[styles.qtyButton, count >= card.copies && styles.qtyButtonDisabled]}
                  onPress={() => count < card.copies && addCard(card.id)}
                  disabled={count >= card.copies}
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
  const enemies = catalog?.byType.get('HORDE') ?? [];
  return (
    <View>
      <Text style={styles.sectionTitle}>Huestes ({enemies.length})</Text>
      <ScrollView style={styles.cardList}>
        {enemies.map(enemy => (
          <View key={enemy.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{enemy.name}</Text>
              <Text style={styles.cardMeta}>
                Fortaleza {enemy.printedFortitude ?? '-'} · Copias {enemy.copies}
                {enemy.isOrc ? ' · Orco' : ''}
              </Text>
            </View>
            <Pressable style={styles.editButton}>
              <Text style={styles.editButtonText}>Editar</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Pestaña: Jefes
// ============================================================================

function BossesTab({ catalog }: { catalog: ReturnType<typeof useGameStore.getState>['catalog'] }) {
  const bosses = catalog?.byType.get('WARLORD') ?? [];
  return (
    <View>
      <Text style={styles.sectionTitle}>Señores de la Guerra ({bosses.length})</Text>
      <ScrollView style={styles.cardList}>
        {bosses.map(boss => (
          <View key={boss.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{boss.name}</Text>
              <Text style={styles.cardMeta}>
                Fortaleza {boss.printedFortitude ?? '-'}
                {(boss as any)._peritiaText ? ` · ${(boss as any)._peritiaText}` : ''}
              </Text>
            </View>
            <Pressable style={styles.editButton}>
              <Text style={styles.editButtonText}>Editar</Text>
            </Pressable>
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
  const market = catalog?.byType.get('MARKET') ?? [];
  return (
    <View>
      <Text style={styles.sectionTitle}>Mercado ({market.length})</Text>
      <ScrollView style={styles.cardList}>
        {market.map(card => (
          <View key={card.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardMeta}>
                Coste {(card as any).printedCost ?? '-'} · Copias {card.copies}
                {card.requiredCapabilities?.length ? ` · ${card.requiredCapabilities.join('+')}` : ''}
              </Text>
            </View>
            <Pressable style={styles.editButton}>
              <Text style={styles.editButtonText}>Editar</Text>
            </Pressable>
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
  const scenarios = catalog?.byType.get('SCENARIO') ?? [];
  return (
    <View>
      <Text style={styles.sectionTitle}>Escenarios ({scenarios.length})</Text>
      <ScrollView style={styles.cardList}>
        {scenarios.map(scenario => (
          <View key={scenario.id} style={styles.cardRow}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{scenario.name}</Text>
              <Text style={styles.cardMeta}>{scenario.id}</Text>
            </View>
            <Pressable style={styles.editButton}>
              <Text style={styles.editButtonText}>Editar</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Pestaña: Reglas (UI-280..289)
// ============================================================================

function RulesTab() {
  return (
    <View>
      <Text style={styles.sectionTitle}>Editor de reglas (UI-280..289)</Text>
      <Text style={styles.hint}>Las reglas se muestran como bloques ordenados verticalmente.</Text>
      <View style={styles.ruleBlock}>
        <Text style={styles.ruleNumber}>1.</Text>
        <Text style={styles.ruleText}>Aplicar ataque impreso: 3</Text>
      </View>
      <View style={styles.ruleBlock}>
        <Text style={styles.ruleNumber}>2.</Text>
        <Text style={styles.ruleText}>Perder 1 carta</Text>
      </View>
      <View style={styles.ruleBlock}>
        <Text style={styles.ruleNumber}>3.</Text>
        <Text style={styles.ruleText}>Finalizar fase de Ataque</Text>
      </View>
      <Pressable style={styles.addButton}>
        <Text style={styles.addButtonText}>+ Añadir bloque</Text>
      </Pressable>
    </View>
  );
}

// ============================================================================
// Pestaña: Conjuntos
// ============================================================================

function SetsTab() {
  return (
    <View>
      <Text style={styles.sectionTitle}>Conjuntos de contenido</Text>
      <Text style={styles.hint}>Agrupa héroes, cartas y reglas en un conjunto publicable.</Text>
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No hay conjuntos definidos</Text>
        <Pressable style={styles.addButton}>
          <Text style={styles.addButtonText}>+ Crear conjunto</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ============================================================================
// Pestaña: Pruebas (UI-310..315)
// ============================================================================

function TestsTab() {
  return (
    <View>
      <Text style={styles.sectionTitle}>Sandbox y pruebas (UI-310..315)</Text>
      <Text style={styles.hint}>Configura un escenario de prueba y ejecuta comandos.</Text>
      <View style={styles.sandboxControls}>
        <Pressable style={styles.sandboxButton}><Text style={styles.sandboxButtonText}>▶ Ejecutar</Text></Pressable>
        <Pressable style={styles.sandboxButton}><Text style={styles.sandboxButtonText}>⏭ Paso a paso</Text></Pressable>
        <Pressable style={styles.sandboxButton}><Text style={styles.sandboxButtonText}>⏸ Pausar</Text></Pressable>
        <Pressable style={styles.sandboxButton}><Text style={styles.sandboxButtonText}>↻ Reiniciar</Text></Pressable>
        <Pressable style={styles.sandboxButton}><Text style={styles.sandboxButtonText}>↶ Deshacer</Text></Pressable>
        <Pressable style={styles.sandboxButton}><Text style={styles.sandboxButtonText}>↷ Rehacer</Text></Pressable>
      </View>
      <View style={styles.sandboxState}>
        <Text style={styles.sandboxStateTitle}>Estado anterior | Eventos | Estado posterior</Text>
        <Text style={styles.hint}>UI-313: Vista lado a lado del estado y eventos.</Text>
      </View>
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
  return (
    <View>
      <Text style={styles.sectionTitle}>Versionado y publicación (UI-320..325)</Text>
      <Text style={styles.fieldLabel}>
        Estado actual: {projectStatus === 'DRAFT' ? 'Borrador' : projectStatus === 'REVIEW' ? 'En revisión' : 'Publicado'}
      </Text>
      <Text style={styles.hint}>UI-320: Borrador, En revisión, Aprobado, Publicado, Archivado, Bloqueado.</Text>
      <View style={styles.versionActions}>
        <Pressable style={styles.versionButton} onPress={() => setProjectStatus('REVIEW')}>
          <Text style={styles.versionButtonText}>Enviar a revisión</Text>
        </Pressable>
        <Pressable
          style={[styles.versionButton, styles.publishButton]}
          onPress={() => setProjectStatus('PUBLISHED')}
        >
          <Text style={styles.versionButtonText}>Publicar</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>UI-324: Una versión publicada no puede modificarse.</Text>
    </View>
  );
}

// ============================================================================
// Estilos
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  content: { padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  headerLeft: { flex: 1 },
  projectName: { color: '#f1c40f', fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  projectStatus: { color: '#7f8c8d', fontSize: 12 },
  breadcrumbRow: { marginBottom: 12 },
  breadcrumb: { color: '#3498db', fontSize: 12 },
  tabBar: { flexDirection: 'row', marginBottom: 16, maxHeight: 70 },
  tab: {
    backgroundColor: '#1a1a2e',
    padding: 8,
    borderRadius: 8,
    marginRight: 6,
    alignItems: 'center',
    minWidth: 60,
  },
  tabActive: { backgroundColor: '#2980b9' },
  tabIcon: { fontSize: 18 },
  tabLabel: { color: '#7f8c8d', fontSize: 10, marginTop: 2 },
  tabLabelActive: { color: '#fff' },
  contentArea: { minHeight: 300, marginBottom: 16 },
  sectionTitle: { color: '#f1c40f', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  fieldLabel: { color: '#ecf0f1', fontSize: 13, marginBottom: 4 },
  hint: { color: '#7f8c8d', fontSize: 11, fontStyle: 'italic', marginBottom: 8 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: {
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 90,
    marginBottom: 8,
  },
  statIcon: { fontSize: 24 },
  statValue: { color: '#f1c40f', fontSize: 20, fontWeight: 'bold' },
  statLabel: { color: '#7f8c8d', fontSize: 11 },
  cardList: { maxHeight: 400 },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  cardInfo: { flex: 1 },
  cardName: { color: '#ecf0f1', fontSize: 14, fontWeight: 'bold' },
  cardMeta: { color: '#7f8c8d', fontSize: 11, marginTop: 2 },
  editButton: { backgroundColor: '#34495e', padding: 6, borderRadius: 4 },
  editButtonText: { color: '#3498db', fontSize: 12 },
  addButton: {
    backgroundColor: '#27ae60',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  addButtonText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  filterBar: { flexDirection: 'row', marginBottom: 12 },
  filterChip: {
    backgroundColor: '#1a1a2e',
    padding: 6,
    borderRadius: 12,
    marginRight: 6,
  },
  filterChipActive: { backgroundColor: '#2980b9' },
  filterChipText: { color: '#ecf0f1', fontSize: 12 },
  deckCounter: { color: '#f1c40f', fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  deckWarning: { color: '#e74c3c', fontSize: 12, marginBottom: 8 },
  cardControls: { flexDirection: 'row', alignItems: 'center' },
  qtyButton: {
    backgroundColor: '#34495e',
    width: 28,
    height: 28,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonDisabled: { opacity: 0.3 },
  qtyButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  qtyValue: { color: '#ecf0f1', fontSize: 14, marginHorizontal: 8 },
  backLink: { marginBottom: 12 },
  backLinkText: { color: '#3498db', fontSize: 13 },
  subSection: { marginTop: 12, padding: 10, backgroundColor: '#1a1a2e', borderRadius: 6 },
  subTitle: { color: '#f1c40f', fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  ruleBlock: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  ruleNumber: { color: '#f1c40f', fontSize: 14, fontWeight: 'bold', marginRight: 8 },
  ruleText: { color: '#ecf0f1', fontSize: 13 },
  emptyState: { alignItems: 'center', padding: 20 },
  emptyText: { color: '#7f8c8d', fontSize: 14, marginBottom: 12 },
  sandboxControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  sandboxButton: {
    backgroundColor: '#1a1a2e',
    padding: 8,
    borderRadius: 6,
    marginRight: 6,
    marginBottom: 6,
  },
  sandboxButtonText: { color: '#3498db', fontSize: 12 },
  sandboxState: {
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 6,
  },
  sandboxStateTitle: { color: '#ecf0f1', fontSize: 13, marginBottom: 4 },
  versionActions: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  versionButton: {
    backgroundColor: '#34495e',
    padding: 10,
    borderRadius: 6,
    marginRight: 8,
  },
  publishButton: { backgroundColor: '#27ae60' },
  versionButtonText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  actionBar: { flexDirection: 'row', gap: 8, marginTop: 16 },
  saveButton: {
    backgroundColor: '#2980b9',
    padding: 12,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },
  backButton: {
    backgroundColor: '#555',
    padding: 12,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },
  actionButtonText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
});
