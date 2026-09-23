/**
 * Pantalla de configuracion — seleccion de modo, héroes y opciones.
 */

import { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Switch, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import type { GameMode } from '@nt4h/schema';

interface HeroOption {
  id: string;
  name: string;
  heroClass: string;
  face: 'FEMALE' | 'MALE';
}

const HEROES: HeroOption[] = [
  { id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER', face: 'FEMALE' },
  { id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER', face: 'MALE' },
  { id: 'hero.beleth-il', name: 'Beleth-Il', heroClass: 'EXPLORER', face: 'FEMALE' },
  { id: 'hero.beleth-il', name: 'Beleth-Il', heroClass: 'EXPLORER', face: 'MALE' },
  { id: 'hero.neddia', name: 'Neddia', heroClass: 'ROGUE', face: 'FEMALE' },
  { id: 'hero.neddia', name: 'Neddia', heroClass: 'ROGUE', face: 'MALE' },
  { id: 'hero.valerys', name: 'Valerys', heroClass: 'WARRIOR', face: 'FEMALE' },
  { id: 'hero.valerys', name: 'Valerys', heroClass: 'WARRIOR', face: 'MALE' },
  { id: 'hero.taheral', name: 'Taheral', heroClass: 'MAGE', face: 'FEMALE' },
  { id: 'hero.taheral', name: 'Taheral', heroClass: 'MAGE', face: 'MALE' },
  { id: 'hero.idril', name: 'Idril', heroClass: 'EXPLORER', face: 'FEMALE' },
  { id: 'hero.idril', name: 'Idril', heroClass: 'EXPLORER', face: 'MALE' },
  { id: 'hero.feldon', name: 'Feldon', heroClass: 'WARRIOR', face: 'FEMALE' },
  { id: 'hero.feldon', name: 'Feldon', heroClass: 'WARRIOR', face: 'MALE' },
  { id: 'hero.lisavette', name: 'Lisavette', heroClass: 'ROGUE', face: 'FEMALE' },
  { id: 'hero.lisavette', name: 'Lisavette', heroClass: 'ROGUE', face: 'MALE' },
];

const CLASS_DECKS: Record<string, string> = {
  EXPLORER: 'explorer.default',
  WARRIOR: 'warrior.default',
  ROGUE: 'rogue.default',
  MAGE: 'mage.default',
};

const CLASS_COLORS: Record<string, string> = {
  EXPLORER: '#27ae60',
  WARRIOR: '#c0392b',
  ROGUE: '#8e44ad',
  MAGE: '#2980b9',
};

export default function SettingsScreen() {
  const router = useRouter();
  const newGame = useGameStore((s) => s.newGame);

  const [mode, setMode] = useState<GameMode>('STANDARD');
  const [playerCount, setPlayerCount] = useState(2);
  const [useScenarios, setUseScenarios] = useState(true);
  const [seed, setSeed] = useState('');
  const [selectedHeroes, setSelectedHeroes] = useState<number[]>([0, 4]);

  const effectivePlayerCount = useMemo(() => {
    if (mode === 'SOLO') return 1;
    if (mode === 'MULTICLASS') return 4;
    return playerCount;
  }, [mode, playerCount]);

  const toggleHero = (index: number) => {
    setSelectedHeroes((prev) => {
      if (prev.includes(index)) {
        return prev.filter((i) => i !== index);
      }
      if (prev.length >= effectivePlayerCount) {
        return [...prev.slice(1), index];
      }
      return [...prev, index];
    });
  };

  const handleStart = () => {
    const chosen = selectedHeroes.slice(0, effectivePlayerCount).map((i) => HEROES[i]);
    if (chosen.length !== effectivePlayerCount) return;

    const finalSeed = seed.trim() || `game-${Date.now()}`;
    const heroes = chosen.map((h, idx) => ({
      playerId: `p${idx + 1}`,
      heroId: h.id,
      heroFace: h.face,
      deckId: CLASS_DECKS[h.heroClass] ?? 'explorer.default',
    }));

    const config: Parameters<typeof newGame>[0] = {
      mode,
      playerCount: effectivePlayerCount,
      seed: finalSeed,
      heroes,
      useScenarios,
    };

    if (mode === 'SOLO') {
      // Soporte: heroes no seleccionados como soporte
      const supportIds = HEROES
        .filter((_, i) => !selectedHeroes.includes(i))
        .slice(0, 3)
        .map((h) => h.id);
      config.soloSupportHeroIds = [...new Set(supportIds)];
    }

    newGame(config);
    router.push('/(game)');
  };

  const canStart = selectedHeroes.length >= effectivePlayerCount;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Configuracion</Text>

      <Text style={styles.sectionTitle}>Modo de juego</Text>
      <View style={styles.modeRow}>
        {(['STANDARD', 'SOLO', 'MULTICLASS'] as GameMode[]).map((m) => (
          <Pressable
            key={m}
            onPress={() => {
              setMode(m);
              if (m === 'SOLO') setSelectedHeroes([0]);
              else if (m === 'MULTICLASS') setSelectedHeroes([0, 4, 8, 12]);
              else setSelectedHeroes([0, 4]);
            }}
            style={[styles.modeButton, mode === m && styles.modeButtonActive]}
          >
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
              {m === 'STANDARD' ? 'Estandar' : m === 'SOLO' ? 'Solitario' : 'Multiclase'}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === 'STANDARD' && (
        <>
          <Text style={styles.sectionTitle}>Numero de jugadores</Text>
          <View style={styles.modeRow}>
            {[2, 3, 4].map((n) => (
              <Pressable
                key={n}
                onPress={() => {
                  setPlayerCount(n);
                  setSelectedHeroes((prev) => prev.slice(0, n));
                }}
                style={[styles.modeButton, playerCount === n && styles.modeButtonActive]}
              >
                <Text style={[styles.modeText, playerCount === n && styles.modeTextActive]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>
        Héroes ({selectedHeroes.length}/{effectivePlayerCount})
      </Text>
      <View style={styles.heroesGrid}>
        {HEROES.map((hero, idx) => {
          const isSelected = selectedHeroes.includes(idx);
          const color = CLASS_COLORS[hero.heroClass] ?? '#555';
          return (
            <Pressable
              key={`${hero.id}-${hero.face}-${idx}`}
              onPress={() => toggleHero(idx)}
              style={[
                styles.heroCard,
                { borderColor: color },
                isSelected && styles.heroCardSelected,
              ]}
            >
              <Text style={styles.heroName}>{hero.name}</Text>
              <Text style={styles.heroClass}>{hero.heroClass}</Text>
              <Text style={styles.heroFace}>{hero.face === 'FEMALE' ? 'F' : 'M'}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.optionRow}>
        <Text style={styles.optionLabel}>Usar escenarios</Text>
        <Switch
          value={useScenarios}
          onValueChange={setUseScenarios}
          trackColor={{ false: '#555', true: '#27ae60' }}
        />
      </View>

      <Text style={styles.sectionTitle}>Semilla (opcional)</Text>
      <TextInput
        style={styles.input}
        value={seed}
        onChangeText={setSeed}
        placeholder="Aleatoria si vacio"
        placeholderTextColor="#777"
        autoCapitalize="none"
      />

      <Pressable
        onPress={handleStart}
        disabled={!canStart}
        style={[styles.startButton, !canStart && styles.startButtonDisabled]}
      >
        <Text style={styles.startText}>Iniciar Partida</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    color: '#f1c40f',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#3498db',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 8,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  modeButton: {
    flex: 1,
    backgroundColor: '#2c3e50',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#34495e',
  },
  modeButtonActive: {
    borderColor: '#f1c40f',
    backgroundColor: '#34495e',
  },
  modeText: {
    color: '#bdc3c7',
    fontSize: 13,
    fontWeight: 'bold',
  },
  modeTextActive: {
    color: '#f1c40f',
  },
  heroesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  heroCard: {
    backgroundColor: '#1a1a2e',
    padding: 8,
    borderRadius: 6,
    borderWidth: 2,
    minWidth: 90,
    alignItems: 'center',
  },
  heroCardSelected: {
    backgroundColor: '#34495e',
    transform: [{ scale: 1.05 }],
  },
  heroName: {
    color: '#ecf0f1',
    fontSize: 12,
    fontWeight: 'bold',
  },
  heroClass: {
    color: '#bdc3c7',
    fontSize: 10,
    fontStyle: 'italic',
  },
  heroFace: {
    color: '#f1c40f',
    fontSize: 10,
    marginTop: 2,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  optionLabel: {
    color: '#ecf0f1',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#2c3e50',
    color: '#ecf0f1',
    padding: 10,
    borderRadius: 6,
    fontSize: 14,
    marginBottom: 16,
  },
  startButton: {
    backgroundColor: '#27ae60',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 32,
  },
  startButtonDisabled: {
    backgroundColor: '#555',
  },
  startText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
