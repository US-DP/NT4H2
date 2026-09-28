/**
 * CreateGameFlow — asistente de creación de partida por pasos.
 *
 * Cumple UI-040..050:
 * - Selección de modo (tarjetas con descripción, jugadores, conexión, dificultad).
 * - Participantes (jugadores + apoyos en solitario).
 * - Selección de héroe, cara, clase de mazo y segunda clase (multiclase).
 * - Selección de escenarios (conjunto completo o subconjunto).
 * - Resumen con validación por paso.
 *
 * Todos los textos vienen del namespace `create` de lib/i18n y el color/
 * tipografía se resuelven con useColors()/useFs() para respetar los ajustes
 * de accesibilidad (alto contraste, daltonismo, escala de fuente).
 */

import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { User, Users, Layers } from 'lucide-react-native';
import { useGameStore } from '../store/gameStore';
import { useCustomContent } from '../lib/customContent';
import { CardView } from '../components/CardView';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import { NtBadge } from './ui/NtBadge';
import { NtDialog } from './ui/NtDialog';
import type { CardDefinition } from '@nt4h/schema';
import { validateDeck } from '@nt4h/schema';
import { useColors, useFs } from '../lib/useTheme';
import { fontSize } from '../lib/theme';
import { makeStyles } from './createGameFlow.styles';

export type GameModeOption = 'SOLO' | 'STANDARD' | 'MULTICLASS';
type HeroClass = 'EXPLORER' | 'WARRIOR' | 'MAGE' | 'ROGUE';
type StepId = 'mode' | 'participants' | 'content' | 'heroes' | 'scenarios' | 'summary';

const CLASSES: HeroClass[] = ['EXPLORER', 'WARRIOR', 'MAGE', 'ROGUE'];

/** Escenarios excluidos en solitario (spec §4.1) */
const SOLO_EXCLUDED_SCENARIOS = new Set([
  'scenario.tears-of-aradiel',
  'scenario.cemenmar-wastes',
]);

interface ModeCard {
  id: GameModeOption;
  /** Subclave dentro de `create.mode` en i18n */
  i18nKey: 'solo' | 'standard' | 'multiclass';
  /** Puntos de complejidad de reglas (1-3), misma escala para todos */
  complexity: number;
  /** Si el modo muestra insignia superior (RECOMENDADO, AVANZADO…) */
  hasBadge: boolean;
  available: boolean;
}

const MODES: ModeCard[] = [
  { id: 'SOLO', i18nKey: 'solo', complexity: 2, hasBadge: false, available: true },
  { id: 'STANDARD', i18nKey: 'standard', complexity: 1, hasBadge: true, available: true },
  { id: 'MULTICLASS', i18nKey: 'multiclass', complexity: 3, hasBadge: true, available: true },
];

const MODE_ICONS: Record<GameModeOption, typeof User> = {
  SOLO: User,
  STANDARD: Users,
  MULTICLASS: Layers,
};

interface HeroSelection {
  playerId: string;
  /** En solitario, true = héroe de apoyo (solo se elige héroe) */
  isSupport?: boolean;
  heroId?: string;
  heroFace?: 'FEMALE' | 'MALE';
  /** Clase del mazo de habilidades (por defecto la del héroe) */
  deckClass?: HeroClass;
  /** Segunda clase (solo multiclase) */
  secondClass?: HeroClass;
  /** Mazo personalizado del Taller (sustituye al mazo de clase) */
  customDeckId?: string;
}

export function CreateGameFlow() {
  const router = useRouter();
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  const styles = useMemo(() => makeStyles(c, fs), [c, fs]);
  const catalog = useGameStore((s) => s.catalog);
  const newGame = useGameStore((s) => s.newGame);

  // Mazos personalizados creados en el Taller (reactivo a cambios)
  const customDeckOptions = useCustomContent((s) => s.sets).flatMap(s => s.decks);
  // Cartas personalizadas por tipo para los pools de Horda/Señor/Mercado
  const customCards = useCustomContent((s) => s.sets).flatMap(s => s.cards);
  // Pools personalizados seleccionados. La fuente es explícita por pool:
  // 'custom' con selección vacía se avisa (no se degrada en silencio a
  // contenido oficial).
  const [poolSel, setPoolSel] = useState<{
    horde: Set<string>; warlord: Set<string>; market: Set<string>;
  }>({ horde: new Set(), warlord: new Set(), market: new Set() });
  const [poolSource, setPoolSource] = useState<
    Record<'horde' | 'warlord' | 'market', 'official' | 'custom'>
  >({ horde: 'official', warlord: 'official', market: 'official' });
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<GameModeOption | null>(null);
  const [selections, setSelections] = useState<HeroSelection[]>([
    { playerId: 'p1', heroFace: 'FEMALE' },
  ]);
  const [useScenarios, setUseScenarios] = useState(true);
  /** 'random' = el motor elige del conjunto completo; 'manual' = subconjunto elegido */
  const [scenarioMode, setScenarioMode] = useState<'random' | 'manual'>('random');
  // Paso Contenido: 'official' = solo juego base; 'custom' permite mazos
  // personalizados del Taller. Hordas/Mercados/Escenarios custom son una
  // limitación temporal — se indica explícitamente (no se finge soporte).
  const [contentScope, setContentScope] = useState<'official' | 'custom'>('official');
  const [selectedScenarios, setSelectedScenarios] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showSoloConfirm, setShowSoloConfirm] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  const className = (id?: string) => (id ? t(`create.classes.${id}`) : '');
  const stepLabel = (s: StepId) => t(`create.steps.${s}`);

  if (!catalog) {
    return (
      <EmptyState
        title={t('create.common.loadingCatalog')}
        description={t('create.common.loadingCatalogDesc')}
      />
    );
  }

  const heroes = catalog.byType.get('HERO') ?? [];
  const scenarios = catalog.byType.get('SCENARIO') ?? [];
  const isSolo = mode === 'SOLO';
  const steps: StepId[] = isSolo
    ? ['mode', 'content', 'heroes', 'scenarios', 'summary']
    : ['mode', 'participants', 'content', 'heroes', 'scenarios', 'summary'];

  /** Lo que se purgaría al cambiar a Solitario con la configuración actual */
  const soloPurgePlayers = Math.max(0, selections.length - 1);
  const soloPurgeScenarios = [...selectedScenarios].filter((id) =>
    SOLO_EXCLUDED_SCENARIOS.has(id),
  ).length;

  const update = (playerId: string, patch: Partial<HeroSelection>) => {
    setSelections((prev) =>
      prev.map((h) => (h.playerId === playerId ? { ...h, ...patch } : h)),
    );
  };

  const addPlayer = () => {
    if (selections.length < 4) {
      setSelections([
        ...selections,
        { playerId: `p${selections.length + 1}`, heroFace: 'FEMALE' },
      ]);
    }
  };

  const removePlayer = () => {
    const min = isSolo ? 1 : 2;
    if (selections.length > min) {
      setSelections(selections.slice(0, -1));
    }
  };

  const toggleScenario = (id: string) => {
    setSelectedScenarios((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const heroClassOf = (heroId?: string): HeroClass | undefined => {
    const hc = catalog.byId.get(heroId ?? '')?.heroClass;
    return hc ? (hc.toUpperCase() as HeroClass) : undefined;
  };

  /** Etiqueta "El jugador P2" / "El apoyo P2" para mensajes de validación */
  const whoLabel = (h: HeroSelection) =>
    h.isSupport
      ? t('create.validation.supportThe', { id: h.playerId.toUpperCase() })
      : t('create.validation.playerThe', { id: h.playerId.toUpperCase() });

  /** Validación por paso: devuelve el motivo o null si el paso es válido */
  const stepError = (s: number): string | null => {
    const stepId = steps[s];
    switch (stepId) {
      case 'mode':
        return mode ? null : t('create.validation.chooseMode');
      case 'heroes': {
        for (const h of selections) {
          if (!h.heroId) {
            return t('create.validation.heroRequired', { who: whoLabel(h) });
          }
          if (!h.isSupport && mode === 'MULTICLASS') {
            if (!h.secondClass) {
              return t('create.validation.secondClassRequired', { who: whoLabel(h) });
            }
            const first = h.deckClass ?? heroClassOf(h.heroId);
            if (h.secondClass === first) {
              return t('create.validation.secondClassDistinct', {
                id: h.playerId.toUpperCase(),
              });
            }
          }
        }
        return null;
      }
      case 'scenarios':
        if (useScenarios && scenarioMode === 'manual' && selectedScenarios.size === 0) {
          return t('create.validation.scenariosRequired');
        }
        return null;
      default:
        return null;
    }
  };

  const validateAll = (): boolean => {
    const errs: string[] = [];
    if (!mode) errs.push(t('create.validation.selectMode'));
    for (let i = 0; i < steps.length; i++) {
      const e = stepError(i);
      if (e) errs.push(e + t('flow.sentenceEnd'));
    }
    if (mode === 'STANDARD' || mode === 'MULTICLASS') {
      if (selections.length < 2) errs.push(t('create.validation.minPlayers'));
    }
    setErrors(errs);
    return errs.length === 0;
  };

  const startGame = () => {
    if (!validateAll() || !mode) return;

    const mainPlayers = selections.filter((h) => !h.isSupport);
    const supports = selections.filter((h) => h.isSupport && h.heroId);

    const heroSelections = mainPlayers.map((h) => {
      const deckClass = h.deckClass ?? heroClassOf(h.heroId) ?? 'EXPLORER';
      return {
        playerId: h.playerId,
        heroId: h.heroId!,
        heroFace: h.heroFace ?? 'FEMALE' as const,
        deckId: `${deckClass.toLowerCase()}.default`,
        ...(h.customDeckId ? { customDeckId: h.customDeckId } : {}),
        ...(mode === 'MULTICLASS' && h.secondClass && !h.customDeckId
          ? { secondDeckId: `${h.secondClass.toLowerCase()}.default` }
          : {}),
      };
    });

    newGame({
      mode,
      playerCount: mainPlayers.length,
      seed: `game-${Date.now()}`,
      heroes: heroSelections,
      useScenarios,
      ...(useScenarios && scenarioMode === 'manual' && selectedScenarios.size > 0
        ? { scenarioIds: [...selectedScenarios] }
        : {}),
      // Pools personalizados del paso Contenido: solo se envían los pools
      // cuya fuente es explícitamente 'custom' y tienen selección.
      ...(contentScope === 'custom' && poolSource.horde === 'custom' && poolSel.horde.size > 0
        ? { hordeCardIds: [...poolSel.horde] } : {}),
      ...(contentScope === 'custom' && poolSource.warlord === 'custom' && poolSel.warlord.size > 0
        ? { warlordIds: [...poolSel.warlord] } : {}),
      ...(contentScope === 'custom' && poolSource.market === 'custom' && poolSel.market.size > 0
        ? { marketCardIds: [...poolSel.market] } : {}),
      ...(mode === 'SOLO' ? { soloSupportHeroIds: supports.map((h) => h.heroId!) } : {}),
    });
    router.push('/(game)');
  };

  /** Aplica el modo: en solitario convierte jugadores extra en apoyos y depura escenarios */
  const applyMode = (m: GameModeOption) => {
    setMode(m);
    if (m === 'SOLO') {
      setSelections((prev) =>
        prev.map((h, i) => ({ ...h, isSupport: i > 0 })),
      );
      // En solitario, quitar escenarios excluidos de la selección
      setSelectedScenarios((prev) => {
        const next = new Set(prev);
        SOLO_EXCLUDED_SCENARIOS.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelections((prev) => prev.map((h) => ({ ...h, isSupport: false })));
      if (selections.length < 2) {
        setSelections([
          { playerId: 'p1', heroFace: 'FEMALE' },
          { playerId: 'p2', heroFace: 'FEMALE' },
        ]);
      }
    }
  };

  // Al cambiar a solitario con selecciones que se purgarían, pedir confirmación
  const pickMode = (m: GameModeOption) => {
    if (m === 'SOLO' && mode !== 'SOLO' && (soloPurgePlayers > 0 || soloPurgeScenarios > 0)) {
      setShowSoloConfirm(true);
      return;
    }
    applyMode(m);
  };

  const renderHeroPicker = (h: HeroSelection, idx: number) => {
    const label = h.isSupport
      ? t('create.heroes.support', { n: idx })
      : t('create.heroes.player', { n: idx + 1 });
    const firstClass = h.deckClass ?? heroClassOf(h.heroId);
    return (
      <View key={h.playerId} style={styles.heroRow}>
        <Text style={styles.heroPlayer}>{label}</Text>
        <ScrollView horizontal style={styles.heroList}>
          {heroes.map((hero: CardDefinition) => (
            // CardView ya es pulsable (botón propio): no envolver en Pressable
            // o se genera un <button> dentro de <button> en web.
            <CardView
              key={hero.id}
              card={hero}
              compact
              imageVariant="thumbnail"
              onPress={() => update(h.playerId, { heroId: hero.id })}
              selected={h.heroId === hero.id}
            />
          ))}
        </ScrollView>

        {h.heroId && !h.isSupport && (
          <View style={styles.subPickers}>
            {/* Cara del héroe */}
            <View style={styles.subPicker}>
              <Text style={styles.subLabel}>{t('create.heroes.face')}</Text>
              {(['FEMALE', 'MALE'] as const).map((face) => (
                <Pressable
                  key={face}
                  onPress={() => update(h.playerId, { heroFace: face })}
                  style={[styles.chip, h.heroFace === face && styles.chipSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: h.heroFace === face }}
                >
                  <Text style={styles.chipText}>
                    {face === 'FEMALE' ? t('create.heroes.faceFemale') : t('create.heroes.faceMale')}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Clase del mazo */}
            <View style={styles.subPicker}>
              <Text style={styles.subLabel}>{t('create.heroes.deck')}</Text>
              {CLASSES.map((cls) => (
                <Pressable
                  key={cls}
                  onPress={() => update(h.playerId, { deckClass: cls, customDeckId: undefined })}
                  style={[styles.chip, firstClass === cls && !h.customDeckId && styles.chipSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: firstClass === cls && !h.customDeckId }}
                >
                  <Text style={styles.chipText}>{className(cls)}</Text>
                </Pressable>
              ))}
              {/* Mazos personalizados del Taller compatibles con la clase
                  (solo si el paso Contenido lo permite) */}
              {contentScope === 'custom' && customDeckOptions
                .filter(d => d.heroClassIds.includes(firstClass ?? 'EXPLORER'))
                .map(d => {
                  // Los mazos incompletos se guardan en el Taller pero no son
                  // seleccionables: se muestran deshabilitados con su cuenta.
                  const total = d.cardEntries.reduce((a, e) => a + e.copies, 0);
                  const valid = validateDeck(d, catalog.byId).ok;
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => update(h.playerId, { customDeckId: h.customDeckId === d.id ? undefined : d.id })}
                      disabled={!valid}
                      style={[
                        styles.chip,
                        styles.chipRow,
                        h.customDeckId === d.id && styles.chipSelected,
                        !valid && styles.chipDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: h.customDeckId === d.id, disabled: !valid }}
                      accessibilityLabel={t('create.heroes.customDeckA11y', { name: d.name })}
                      accessibilityHint={!valid ? t('create.heroes.deckIncompleteHint') : undefined}
                    >
                      <Text style={styles.chipText}>{d.name}</Text>
                      {valid
                        ? <NtBadge label={t('create.heroes.customBadge')} tone="accent" />
                        : <NtBadge label={t('flow.deckCount', { total, size: d.deckSize })} tone="warning" />}
                      {!valid && (
                        <Pressable
                          onPress={() => router.push({ pathname: '/(study)/[tab]', params: { tab: 'decks' } })}
                          accessibilityRole="link"
                          accessibilityLabel={`${d.name}${t('flow.labelSeparator')}${t('create.heroes.fixInWorkshop')}`}
                          style={{ marginLeft: 6 }}
                        >
                          <Text style={[styles.chipText, { color: c.info, textDecorationLine: 'underline' }]}>
                            {t('create.heroes.fixInWorkshop')}
                          </Text>
                        </Pressable>
                      )}
                    </Pressable>
                  );
                })}
            </View>

            {/* Segunda clase (multiclase) */}
            {mode === 'MULTICLASS' && (
              <View style={styles.subPicker}>
                <Text style={styles.subLabel}>{t('create.heroes.secondClass')}</Text>
                {CLASSES.map((cls) => (
                  <Pressable
                    key={cls}
                    onPress={() => update(h.playerId, { secondClass: cls })}
                    style={[
                      styles.chip,
                      h.secondClass === cls && styles.chipSelected,
                      cls === firstClass && styles.chipDisabled,
                    ]}
                    disabled={cls === firstClass}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: h.secondClass === cls,
                      disabled: cls === firstClass,
                    }}
                  >
                    <Text style={styles.chipText}>{className(cls)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderStep = () => {
    const stepId = steps[step];
    switch (stepId) {
      case 'mode':
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>{t('create.mode.title')}</Text>
            <Text style={styles.stepSubtitle}>{t('create.mode.subtitle')}</Text>
            <View style={[styles.modes, wide && styles.modesWide]} accessibilityRole="radiogroup">
              {MODES.map((m) => {
                const Icon = MODE_ICONS[m.id];
                const selected = mode === m.id;
                const name = t(`create.mode.${m.i18nKey}.name`);
                const description = t(`create.mode.${m.i18nKey}.description`);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => { if (m.available) pickMode(m.id); setAttempted(false); }}
                    style={[
                      styles.modeCard,
                      wide && styles.modeCardWide,
                      selected && styles.modeCardSelected,
                      !m.available && styles.modeCardDisabled,
                    ]}
                    disabled={!m.available}
                    accessibilityRole="button"
                    accessibilityLabel={`${name}${t('flow.sentenceSeparator')}${description}`}
                    accessibilityState={{ disabled: !m.available, selected }}
                  >
                    {m.hasBadge && (
                      <View style={styles.modeBadge}>
                        <Text style={styles.modeBadgeText}>
                          {t(`create.mode.${m.i18nKey}.badge`)}
                        </Text>
                      </View>
                    )}
                    <View style={styles.modeIconWrap}>
                      <Icon size={32} color={selected ? c.accent : c.textMuted} />
                    </View>
                    <Text style={[styles.modeName, selected && { color: c.accent }]}>{name}</Text>
                    <Text style={styles.modeDesc}>{description}</Text>
                    <View style={styles.modeMetaBlock}>
                      <Text style={styles.modeMeta}>
                        {t('flow.iconPlayers')} {t(`create.mode.${m.i18nKey}.playerCount`)}
                      </Text>
                      <Text style={styles.modeMeta}>
                        {t('flow.iconDuration')} {t(`create.mode.${m.i18nKey}.duration`)}
                      </Text>
                      <Text style={styles.modeMeta}>
                        {t('flow.complexityDotFilled').repeat(m.complexity)}{t('flow.complexityDotEmpty').repeat(3 - m.complexity)}{' '}
                        {t(`create.mode.${m.i18nKey}.complexityLabel`)}
                      </Text>
                    </View>
                    <Text style={styles.modeHint}>{t(`create.mode.${m.i18nKey}.hint`)}</Text>
                    <View style={styles.modeSelect}>
                      <Text style={[styles.modeSelectText, selected && styles.modeSelectTextActive]}>
                        {selected ? t('create.mode.selected') : t('create.mode.select')}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );

      case 'participants':
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>{t('create.participants.title')}</Text>
            <Text style={styles.stepSubtitle}>{t('create.participants.subtitle')}</Text>
            <Text style={styles.label}>
              {t('create.participants.players', { count: selections.length })}
            </Text>
            <View style={styles.countControls}>
              <Pressable
                style={[styles.countButton, selections.length <= 2 && styles.countButtonDisabled]}
                onPress={removePlayer}
                disabled={selections.length <= 2}
                accessibilityRole="button"
                accessibilityLabel={t('create.participants.remove')}
              >
                <Text style={styles.countText}>{t('flow.countDecrement')}</Text>
              </Pressable>
              <Text style={styles.countValue}>{selections.length}</Text>
              <Pressable
                style={[styles.countButton, selections.length >= 4 && styles.countButtonDisabled]}
                onPress={addPlayer}
                disabled={selections.length >= 4}
                accessibilityRole="button"
                accessibilityLabel={t('create.participants.add')}
              >
                <Text style={styles.countText}>{t('flow.countIncrement')}</Text>
              </Pressable>
            </View>
          </View>
        );

      case 'content': {
        const hasCustomDecks = customDeckOptions.length > 0;
        const option = (
          id: 'official' | 'custom',
          label: string,
          desc: string,
          disabled = false,
        ) => (
          <Pressable
            key={id}
            onPress={() => {
              if (disabled) return;
              setContentScope(id);
              if (id === 'official') {
                // Limpiar mazos custom al volver al contenido oficial
                setSelections((prev) => prev.map((h) => ({ ...h, customDeckId: undefined })));
              }
            }}
            style={[styles.chip, styles.chipRow, contentScope === id && styles.chipSelected, disabled && styles.chipDisabled]}
            accessibilityRole="button"
            accessibilityState={{ selected: contentScope === id, disabled }}
            accessibilityLabel={label}
          >
            <View>
              <Text style={styles.chipText}>{label}</Text>
              <Text style={{ fontSize: fs(fontSize.micro), color: c.textMuted }}>{desc}</Text>
            </View>
          </Pressable>
        );
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>{t('create.content.title')}</Text>
            <Text style={styles.stepSubtitle}>{t('create.content.subtitle')}</Text>
            <View style={styles.subPicker}>
              {option('official', t('create.content.official'), t('create.content.officialDesc'))}
              {option(
                'custom',
                t('create.content.custom'),
                hasCustomDecks || customCards.length > 0
                  ? t('create.content.customDesc')
                  : t('create.content.customEmpty'),
                !hasCustomDecks && customCards.length === 0,
              )}
            </View>

            {/* Pools personalizados: la fuente se elige explícitamente */}
            {contentScope === 'custom' && (['horde', 'warlord', 'market'] as const).map((kind) => {
              const cardsOfType = customCards.filter(card => card.type === kind.toUpperCase());
              if (cardsOfType.length === 0) return null;
              const sel = poolSel[kind];
              const customSource = poolSource[kind] === 'custom';
              return (
                <View key={kind} style={styles.subPicker}>
                  <Text style={styles.subLabel}>
                    {t(`create.content.pool.${kind}`, { n: sel.size || 0 })}
                  </Text>
                  <View style={styles.chipRow}>
                    {(['official', 'custom'] as const).map((src) => (
                      <Pressable
                        key={src}
                        onPress={() => setPoolSource((prev) => ({ ...prev, [kind]: src }))}
                        style={[styles.chip, poolSource[kind] === src && styles.chipSelected]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: poolSource[kind] === src }}
                      >
                        <Text style={styles.chipText}>
                          {src === 'official'
                            ? t('flow.poolSourceOfficial')
                            : t('flow.poolSourceCustom')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {customSource && sel.size === 0 && (
                    <Text style={{ fontSize: fs(fontSize.micro), color: c.warning }}>
                      {t('create.content.poolEmpty')}
                    </Text>
                  )}
                  {customSource && cardsOfType.map((card) => (
                    <Pressable
                      key={card.id}
                      onPress={() => setPoolSel((prev) => {
                        const next = new Set(prev[kind]);
                        if (next.has(card.id)) next.delete(card.id); else next.add(card.id);
                        return { ...prev, [kind]: next };
                      })}
                      style={[styles.chip, styles.chipRow, sel.has(card.id) && styles.chipSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: sel.has(card.id) }}
                    >
                      <Text style={styles.chipText}>{card.name}</Text>
                      <NtBadge label={t('create.heroes.customBadge')} tone="accent" />
                    </Pressable>
                  ))}
                </View>
              );
            })}

            <Text style={{ fontSize: fs(fontSize.micro), color: c.textMuted, fontStyle: 'italic' }}>
              {t('create.content.limitation')}
            </Text>
          </View>
        );
      }

      case 'heroes':
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>
              {isSolo ? t('create.heroes.titleSolo') : t('create.heroes.title')}
            </Text>
            <Text style={styles.stepSubtitle}>
              {isSolo
                ? t('create.heroes.subtitleSolo')
                : mode === 'MULTICLASS'
                  ? t('create.heroes.subtitleMulticlass')
                  : t('create.heroes.subtitle')}
            </Text>
            {selections.map((h, i) => renderHeroPicker(h, i))}
            {isSolo && selections.length < 4 && (
              <Pressable
                style={styles.addSupport}
                onPress={() =>
                  setSelections([
                    ...selections,
                    { playerId: `p${selections.length + 1}`, isSupport: true, heroFace: 'FEMALE' },
                  ])
                }
                accessibilityRole="button"
              >
                <Text style={styles.addSupportText}>{t('create.heroes.addSupport')}</Text>
              </Pressable>
            )}
          </View>
        );

      case 'scenarios':
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>{t('create.scenarios.title')}</Text>
            <Text style={styles.stepSubtitle}>{t('create.scenarios.subtitle')}</Text>
            <View style={styles.optionRow}>
              <Text style={styles.label}>{t('create.scenarios.use')}</Text>
              <Pressable
                onPress={() => setUseScenarios(!useScenarios)}
                style={[styles.toggle, useScenarios && styles.toggleActive]}
                accessibilityRole="switch"
                accessibilityState={{ checked: useScenarios }}
              >
                <Text style={styles.toggleText}>
                  {useScenarios ? t('create.common.yes') : t('create.common.no')}
                </Text>
              </Pressable>
            </View>

            {useScenarios && (
              <>
                {/* Selección: aleatoria (mazo completo) o subconjunto manual */}
                <View style={styles.optionRow}>
                  <Text style={styles.label}>{t('create.scenarios.selectionLabel')}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {(['random', 'manual'] as const).map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => setScenarioMode(m)}
                        style={[styles.chip, scenarioMode === m && styles.chipSelected]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: scenarioMode === m }}
                      >
                        <Text style={styles.chipText}>
                          {m === 'random'
                            ? t('create.scenarios.random')
                            : t('create.scenarios.manual')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                {scenarioMode === 'random' && (
                  <Text style={styles.scenarioHint}>{t('create.scenarios.randomHint')}</Text>
                )}
                {scenarioMode === 'manual' && (
                  <>
                <Text style={styles.scenarioHint}>
                  {t('create.scenarios.manualHint', {
                    selected: selectedScenarios.size,
                    total: scenarios.length,
                  })}
                </Text>
                <View style={styles.scenarioGrid}>
                  {scenarios.map((sc: CardDefinition) => {
                    const soloBlocked = isSolo && SOLO_EXCLUDED_SCENARIOS.has(sc.id);
                    const chosen = selectedScenarios.has(sc.id);
                    return (
                      <CardView
                        key={sc.id}
                        card={sc}
                        compact
                        imageVariant="thumbnail"
                        onPress={soloBlocked ? undefined : () => toggleScenario(sc.id)}
                        selected={chosen}
                        blocked={!!soloBlocked}
                        blockedReason={t('create.scenarios.blockedSolo')}
                      />
                    );
                  })}
                </View>
                <View style={styles.scenarioActions}>
                  <Pressable
                    onPress={() =>
                      setSelectedScenarios(
                        new Set(
                          scenarios
                            .filter((s) => !(isSolo && SOLO_EXCLUDED_SCENARIOS.has(s.id)))
                            .map((s) => s.id),
                        ),
                      )
                    }
                    accessibilityRole="button"
                  >
                    <Text style={styles.linkText}>{t('create.scenarios.selectAll')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSelectedScenarios(new Set())}
                    accessibilityRole="button"
                  >
                    <Text style={styles.linkText}>{t('create.scenarios.selectNone')}</Text>
                  </Pressable>
                </View>
                  </>
                )}
              </>
            )}
          </View>
        );

      case 'summary': {
        // Resumen editable: cada bloque salta al paso correspondiente
        const goToStep = (id: StepId) => setStep(steps.indexOf(id));
        const editBtn = (stepId: StepId, label: string) => (
          <Pressable
            onPress={() => goToStep(stepId)}
            style={styles.editButton}
            accessibilityRole="button"
            accessibilityLabel={t('create.summary.editA11y', { label })}
          >
            <Text style={styles.editButtonText}>{t('create.common.edit')}</Text>
          </Pressable>
        );
        const selectedMode = MODES.find((m) => m.id === mode);
        const modeName = selectedMode
          ? t(`create.mode.${selectedMode.i18nKey}.name`)
          : t('flow.noValue');
        const scenariosValue = useScenarios
          ? scenarioMode === 'random'
            ? t('create.summary.scenariosRandom')
            : t('create.summary.scenariosSelected', { count: selectedScenarios.size })
          : t('create.summary.scenariosOff');
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>{t('create.summary.title')}</Text>
            <Text style={styles.stepSubtitle}>{t('create.summary.subtitle')}</Text>
            {/* UI-052: aviso antes de empezar un modo avanzado */}
            {(mode === 'MULTICLASS' || contentScope === 'custom') && (
              <View style={{
                backgroundColor: c.infoSurface ?? c.surface,
                borderRadius: 8, padding: 10, marginBottom: 8,
                borderWidth: 1, borderColor: c.info,
              }} accessibilityRole="alert">
                <Text style={{ color: c.text, fontSize: 12 }}>
                  {t('create.summary.complexityHint')}
                </Text>
              </View>
            )}
            <View style={styles.summary}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryItem}>
                  {t('create.summary.mode', { name: modeName })}
                </Text>
                {editBtn('mode', t('create.summary.editMode'))}
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryItem}>
                  {t('create.summary.content', {
                    name: contentScope === 'custom'
                      ? t('create.content.custom')
                      : t('create.content.official'),
                  })}
                </Text>
                {editBtn('content', t('create.summary.editContent'))}
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryItem}>
                  {isSolo
                    ? t('create.summary.playersSolo', {
                        count: selections.filter((h) => h.isSupport).length,
                      })
                    : t('create.summary.players', { count: selections.length })}
                </Text>
                {editBtn(isSolo ? 'heroes' : 'participants', t('create.summary.editParticipants'))}
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryItem}>
                  {t('create.summary.scenariosLabel', { value: scenariosValue })}
                </Text>
                {editBtn('scenarios', t('create.summary.editScenarios'))}
              </View>
              {selections.map((h) => (
                <View key={h.playerId} style={styles.summaryRow}>
                  <Text style={styles.summaryItem}>
                    {h.isSupport ? t('create.summary.support') : h.playerId.toUpperCase()}{t('flow.labelSeparator')}
                    {catalog.byId.get(h.heroId ?? '')?.name ?? t('create.summary.notChosen')}
                    {h.heroId && !h.isSupport && (
                      <>{t('flow.dotSeparator')}{t('create.summary.deck', {
                        name: className(h.deckClass ?? heroClassOf(h.heroId)),
                      })}
                      {mode === 'MULTICLASS' && h.secondClass
                        ? `${t('flow.plusSeparator')}${className(h.secondClass)}`
                        : ''}</>
                    )}
                  </Text>
                  {editBtn('heroes', t('create.summary.editHero', { player: h.playerId }))}
                </View>
              ))}
            </View>
            {errors.length > 0 && (
              <View style={styles.errors}>
                {errors.map((e, i) => (
                  <ErrorMessage
                    key={i}
                    category="validation"
                    action={t('create.common.start')}
                    reason={e}
                    fix={t('create.summary.errorFix')}
                  />
                ))}
              </View>
            )}
          </View>
        );
      }

      default:
        return null;
    }
  };

  const currentError = stepError(step);
  const nextLabel = step < steps.length - 1 ? stepLabel(steps[step + 1]).toLowerCase() : null;
  // El error solo se muestra después de intentar continuar, no de forma preventiva
  const showError = attempted && currentError;

  const goNext = () => {
    if (currentError) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    setStep(step + 1);
  };

  const soloSwitchDescription =
    t('create.modeSwitchSolo.intro') +
    '\n' +
    [
      soloPurgePlayers > 0
        ? t('create.modeSwitchSolo.convertPlayers', { count: soloPurgePlayers })
        : null,
      soloPurgeScenarios > 0
        ? t('create.modeSwitchSolo.removeScenarios', { count: soloPurgeScenarios })
        : null,
    ]
      .filter(Boolean)
      .join('\n');

  return (
    <View style={styles.container}>
      {/* Cabecera del asistente */}
      <View style={styles.wizardHeader}>
        <Pressable
          onPress={() => {
            // Si ya hay decisiones tomadas, confirmar antes de perderlas
            if (mode !== null || selections.some((h) => h.heroId)) {
              setShowExitConfirm(true);
            } else {
              router.back();
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={t('create.common.cancelSetup')}
        >
          <Text style={styles.cancelText}>{t('flow.backArrow')} {t('create.common.cancel')}</Text>
        </Pressable>
        <Text style={styles.wizardTitle}>{t('create.common.title')}</Text>
        <View style={{ width: 70 }} />
      </View>

      {/* Indicador de pasos: círculos con estado, clicables hacia atrás */}
      {wide ? (
        <View
          style={styles.stepper}
          accessibilityLabel={t('create.common.stepOfName', {
            current: step + 1,
            total: steps.length,
            name: stepLabel(steps[step]),
          })}
        >
          {steps.map((s, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <View key={s} style={styles.stepperItem}>
                {i > 0 && <View style={[styles.stepperLine, done && styles.stepperLineDone]} />}
                <Pressable
                  onPress={() => { if (done) { setStep(i); setAttempted(false); } }}
                  disabled={!done}
                  accessibilityRole="button"
                  accessibilityLabel={t('create.common.stepA11y', {
                    n: i + 1,
                    name: stepLabel(s),
                    status: done
                      ? t('create.common.stepStatusDone')
                      : current
                        ? t('create.common.stepStatusCurrent')
                        : '',
                  })}
                  accessibilityState={{ disabled: !done }}
                  style={styles.stepperDotWrap}
                >
                  <View style={[
                    styles.stepperDot,
                    current && styles.stepperDotCurrent,
                    done && styles.stepperDotDone,
                  ]}>
                    <Text style={[styles.stepperDotText, (current || done) && styles.stepperDotTextActive]}>
                      {done ? t('flow.stepDone') : i + 1}
                    </Text>
                  </View>
                  <Text style={[styles.stepperLabel, current && styles.stepperLabelActive]}>
                    {stepLabel(s)}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.stepperCompact}>
          <Text style={styles.stepperCompactText}>
            {t('create.common.stepOf', { current: step + 1, total: steps.length })}{t('flow.dotSeparator')}
            {stepLabel(steps[step])}
          </Text>
          <View style={styles.stepperBar}>
            <View style={[styles.stepperBarFill, { width: `${((step + 1) / steps.length) * 100}%` }]} />
          </View>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {renderStep()}

        {showError && (
          <Text style={styles.stepError} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {t('flow.warningIcon')} {currentError}
          </Text>
        )}
      </ScrollView>

      {/* Barra inferior fija con la acción principal */}
      <View style={styles.footer}>
        <Text style={styles.footerStep}>
          {t('create.common.stepOf', { current: step + 1, total: steps.length })}
        </Text>
        <View style={styles.footerActions}>
          {step > 0 && (
            <Pressable
              style={styles.secondaryButton}
              onPress={() => { setStep(step - 1); setAttempted(false); }}
              accessibilityRole="button"
              accessibilityLabel={t('create.common.backA11y')}
            >
              <Text style={styles.secondaryButtonText}>{t('create.common.back')}</Text>
            </Pressable>
          )}
          {step < steps.length - 1 ? (
            <Pressable
              style={styles.primaryButton}
              onPress={goNext}
              accessibilityRole="button"
              accessibilityLabel={
                currentError
                  ? `${t('create.common.next', { step: nextLabel })}${t('flow.sentenceSeparator')}${currentError}`
                  : t('create.common.next', { step: nextLabel })
              }
            >
              <Text style={styles.buttonText}>
                {t('create.common.next', { step: nextLabel })}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.primaryButton}
              onPress={startGame}
              accessibilityRole="button"
              accessibilityLabel={t('create.common.startA11y')}
            >
              <Text style={styles.buttonText}>{t('create.common.start')}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Confirmación al cambiar a Solitario con selecciones que se purgarán */}
      <NtDialog
        visible={showSoloConfirm}
        title={t('create.modeSwitchSolo.title')}
        description={soloSwitchDescription}
        onDismiss={() => setShowSoloConfirm(false)}
        actions={[
          {
            label: t('create.modeSwitchSolo.keep'),
            variant: 'ghost',
            onPress: () => setShowSoloConfirm(false),
          },
          {
            label: t('create.modeSwitchSolo.confirm'),
            variant: 'primary',
            onPress: () => {
              setShowSoloConfirm(false);
              applyMode('SOLO');
              setAttempted(false);
            },
          },
        ]}
      />

      {/* Confirmación al cancelar con configuración en curso */}
      <Modal
        visible={showExitConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExitConfirm(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} accessibilityRole="alert">
            <Text style={styles.modalTitle}>{t('create.exit.title')}</Text>
            <Text style={styles.modalBody}>{t('create.exit.body')}</Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => setShowExitConfirm(false)}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>{t('create.exit.stay')}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { marginTop: 10 }]}
              onPress={() => { setShowExitConfirm(false); router.back(); }}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>{t('create.exit.leave')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Estilos derivados del tema activo: se regeneran cuando cambian la paleta
 * (alto contraste / daltonismo) o la escala tipográfica del usuario.
 */
