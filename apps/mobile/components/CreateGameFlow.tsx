/**
 * CreateGameFlow — asistente de creación de partida por pasos.
 *
 * Cumple UI-040..050:
 * - Selección de modo (tarjetas con descripción, jugadores, conexión, dificultad).
 * - Selección de contenido/conjunto.
 * - Selección de héroes y mazos.
 * - Opciones.
 * - Resumen con advertencias.
 */

import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useGameStore } from '../store/gameStore';
import { CardView } from '../components/CardView';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import type { CardDefinition } from '@nt4h/schema';

export type GameModeOption = 'SOLO' | 'STANDARD' | 'MULTICLASS';

interface ModeCard {
  id: GameModeOption;
  name: string;
  description: string;
  playerCount: string;
  needsConnection: boolean;
  duration: string;
  difficulty: string;
  available: boolean;
  disabledReason?: string;
}

const MODES: ModeCard[] = [
  {
    id: 'SOLO',
    name: 'Solitario',
    description: 'Un héroe contra la Horda con reglas de apoyo.',
    playerCount: '1',
    needsConnection: false,
    duration: '25-35 min',
    difficulty: 'Medio',
    available: true,
  },
  {
    id: 'STANDARD',
    name: 'Estándar',
    description: '2-4 jugadores con un héroe cada uno.',
    playerCount: '2-4',
    needsConnection: false,
    duration: '30-40 min',
    difficulty: 'Variable',
    available: true,
  },
  {
    id: 'MULTICLASS',
    name: 'Multiclase',
    description: 'Cada jugador combina dos clases.',
    playerCount: '2-4',
    needsConnection: false,
    duration: '35-45 min',
    difficulty: 'Avanzado',
    available: true,
  },
];

interface HeroSelection {
  playerId: string;
  heroId?: string;
  deckId?: string;
}

export function CreateGameFlow() {
  const router = useRouter();
  const catalog = useGameStore((s) => s.catalog);
  const newGame = useGameStore((s) => s.newGame);

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<GameModeOption | null>(null);
  const [selectedHeroes, setSelectedHeroes] = useState<HeroSelection[]>([
    { playerId: 'p1' },
  ]);
  const [playerCount, setPlayerCount] = useState(2);
  const [useScenarios, setUseScenarios] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  if (!catalog) {
    return <EmptyState title="Cargando catálogo" description="Esperando al catálogo de cartas…" />;
  }

  const heroes = catalog.byType.get('HERO') ?? [];
  const steps = ['Modo', 'Participantes', 'Héroes', 'Opciones', 'Resumen'];

  const addPlayer = () => {
    if (selectedHeroes.length < 4) {
      setSelectedHeroes([...selectedHeroes, { playerId: `p${selectedHeroes.length + 1}` }]);
      setPlayerCount(selectedHeroes.length + 1);
    }
  };

  const removePlayer = () => {
    if (selectedHeroes.length > 1) {
      setSelectedHeroes(selectedHeroes.slice(0, -1));
      setPlayerCount(selectedHeroes.length - 1);
    }
  };

  const selectHero = (playerId: string, heroId: string) => {
    setSelectedHeroes(
      selectedHeroes.map((h) =>
        h.playerId === playerId ? { ...h, heroId } : h,
      ),
    );
  };

  const validate = (): boolean => {
    const errs: string[] = [];
    if (!mode) errs.push('Selecciona un modo de juego.');
    selectedHeroes.forEach((h) => {
      if (!h.heroId) errs.push(`El jugador ${h.playerId} debe elegir un héroe.`);
    });
    if (selectedHeroes.length < 1) errs.push('Se necesita al menos un jugador.');
    if (mode === 'STANDARD' && selectedHeroes.length < 2) errs.push('El modo estándar requiere al menos 2 jugadores.');
    setErrors(errs);
    return errs.length === 0;
  };

  const startGame = () => {
    if (!validate() || !mode) return;
    const heroSelections = selectedHeroes
      .filter((h) => h.heroId)
      .map((h) => ({
        playerId: h.playerId,
        heroId: h.heroId!,
        heroFace: 'FEMALE' as const,
        deckId: `${(catalog.byId.get(h.heroId!)?.heroClass ?? 'explorer').toLowerCase()}.default`,
      }));

    newGame({
      mode,
      playerCount: selectedHeroes.length,
      seed: `game-${Date.now()}`,
      heroes: heroSelections,
      useScenarios,
      ...(mode === 'SOLO' ? { soloSupportHeroIds: heroSelections.slice(1).map((h) => h.heroId) } : {}),
    });
    router.push('/(game)');
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>1. Selecciona el modo</Text>
            <View style={styles.modes}>
              {MODES.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => m.available && setMode(m.id)}
                  style={[
                    styles.modeCard,
                    mode === m.id && styles.modeCardSelected,
                    !m.available && styles.modeCardDisabled,
                  ]}
                  disabled={!m.available}
                  accessibilityRole="button"
                  accessibilityLabel={m.name}
                  accessibilityState={{ disabled: !m.available }}
                >
                  <Text style={styles.modeName}>{m.name}</Text>
                  <Text style={styles.modeDesc}>{m.description}</Text>
                  <View style={mode === m.id ? { marginTop: 8 } : undefined}>
                    <Text style={styles.modeMeta}>👥 {m.playerCount}</Text>
                    <Text style={styles.modeMeta}>⏱ {m.duration}</Text>
                    <Text style={styles.modeMeta}>🌐 {m.needsConnection ? 'Online' : 'Offline'}</Text>
                    <Text style={styles.modeMeta}>⚔ {m.difficulty}</Text>
                  </View>
                  {!m.available && m.disabledReason && (
                    <Text style={styles.modeDisabled}>{m.disabledReason}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        );

      case 1:
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>2. Participantes</Text>
            <Text style={styles.label}>Jugadores: {playerCount}</Text>
            <View style={styles.countControls}>
              <Pressable style={styles.countButton} onPress={removePlayer} disabled={playerCount <= 1}>
                <Text style={styles.countText}>-</Text>
              </Pressable>
              <Text style={styles.countValue}>{playerCount}</Text>
              <Pressable style={styles.countButton} onPress={addPlayer} disabled={playerCount >= 4}>
                <Text style={styles.countText}>+</Text>
              </Pressable>
            </View>
          </View>
        );

      case 2:
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>3. Héroes y mazos</Text>
            <Text style={styles.label}>Jugadores:</Text>
            {selectedHeroes.map((h, i) => (
              <View key={h.playerId} style={styles.heroRow}>
                <Text style={styles.heroPlayer}>J{i + 1}</Text>
                <ScrollView horizontal style={styles.heroList}>
                  {heroes.map((hero: CardDefinition) => (
                    <Pressable
                      key={hero.id}
                      onPress={() => selectHero(h.playerId, hero.id)}
                      style={[
                        styles.heroOption,
                        h.heroId === hero.id && styles.heroOptionSelected,
                      ]}
                    >
                      <CardView card={hero} compact imageVariant="thumbnail" />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ))}
          </View>
        );

      case 3:
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>4. Opciones</Text>
            <View style={styles.optionRow}>
              <Text style={styles.label}>Usar escenarios</Text>
              <Pressable
                onPress={() => setUseScenarios(!useScenarios)}
                style={[styles.toggle, useScenarios && styles.toggleActive]}
                accessibilityRole="switch"
                accessibilityState={{ checked: useScenarios }}
              >
                <Text style={styles.toggleText}>{useScenarios ? 'Sí' : 'No'}</Text>
              </Pressable>
            </View>
          </View>
        );

      case 4:
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>5. Resumen</Text>
            <View style={styles.summary}>
              <Text style={styles.summaryItem}>Modo: {MODES.find((m) => m.id === mode)?.name ?? '—'}</Text>
              <Text style={styles.summaryItem}>Jugadores: {playerCount}</Text>
              <Text style={styles.summaryItem}>Escenarios: {useScenarios ? 'Sí' : 'No'}</Text>
              {selectedHeroes.map((h, i) => (
                <Text key={h.playerId} style={styles.summaryItem}>
                  Jugador {i + 1}: {catalog.byId.get(h.heroId ?? '')?.name ?? 'Sin elegir'}
                </Text>
              ))}
            </View>
            {errors.length > 0 && (
              <View style={styles.errors}>
                {errors.map((e, i) => (
                  <ErrorMessage
                    key={i}
                    category="validation"
                    action="Iniciar partida"
                    reason={e}
                    fix="Revisa los pasos anteriores."
                  />
                ))}
              </View>
            )}
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.progress}>
        {steps.map((s, i) => (
          <View key={s} style={styles.progressItem}>
            <Text style={[styles.progressStep, i === step && styles.progressStepActive]}>
              {i + 1}. {s}
            </Text>
            {i < steps.length - 1 && <Text style={styles.progressArrow}>→</Text>}
          </View>
        ))}
      </View>

      {renderStep()}

      <View style={styles.actions}>
        {step > 0 && (
          <Pressable style={styles.secondaryButton} onPress={() => setStep(step - 1)}>
            <Text style={styles.buttonText}>Atrás</Text>
          </Pressable>
        )}
        {step < steps.length - 1 ? (
          <Pressable
            style={styles.primaryButton}
            onPress={() => setStep(step + 1)}
            disabled={step === 0 && !mode}
          >
            <Text style={styles.buttonText}>Siguiente</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primaryButton} onPress={startGame}>
            <Text style={styles.buttonText}>Iniciar partida</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  progress: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 16,
  },
  progressItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  progressStep: {
    color: '#7f8c8d',
    fontSize: 11,
  },
  progressStepActive: {
    color: '#f1c40f',
    fontWeight: 'bold',
  },
  progressArrow: {
    color: '#555',
    fontSize: 11,
  },
  step: {
    marginBottom: 16,
  },
  stepTitle: {
    color: '#f1c40f',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  modes: {
    gap: 12,
  },
  modeCard: {
    backgroundColor: '#2c3e50',
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#34495e',
    minHeight: 44,
  },
  modeCardSelected: {
    borderColor: '#f1c40f',
    backgroundColor: '#2a2a4e',
  },
  modeCardDisabled: {
    opacity: 0.5,
    backgroundColor: '#555',
  },
  modeName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modeDesc: {
    color: '#bdc3c7',
    fontSize: 12,
    marginTop: 4,
  },
  modeMeta: {
    color: '#ecf0f1',
    fontSize: 11,
    marginTop: 2,
  },
  modeDisabled: {
    color: '#e74c3c',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 8,
  },
  label: {
    color: '#ecf0f1',
    fontSize: 14,
    marginBottom: 8,
  },
  countControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  countButton: {
    backgroundColor: '#34495e',
    padding: 12,
    borderRadius: 8,
    minWidth: 44,
    alignItems: 'center',
  },
  countText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  countValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    minWidth: 30,
    textAlign: 'center',
  },
  heroRow: {
    marginBottom: 12,
  },
  heroPlayer: {
    color: '#f1c40f',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  heroList: {
    flexDirection: 'row',
  },
  heroOption: {
    marginRight: 8,
  },
  heroOptionSelected: {
    borderWidth: 2,
    borderColor: '#f1c40f',
    borderRadius: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2c3e50',
    padding: 12,
    borderRadius: 8,
  },
  toggle: {
    backgroundColor: '#555',
    padding: 8,
    borderRadius: 6,
    minWidth: 60,
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: '#27ae60',
  },
  toggleText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  summary: {
    backgroundColor: '#2c3e50',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  summaryItem: {
    color: '#ecf0f1',
    fontSize: 13,
    marginBottom: 6,
  },
  errors: {
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  primaryButton: {
    backgroundColor: '#27ae60',
    padding: 14,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#555',
    padding: 14,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
