/**
 * Pantalla de reglamento.
 *
 * Cumple UI-225: buscar en el reglamento.
 * Cumple UI-226: errores vinculados a reglas.
 */

import { useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { HelpButton } from '../../components/HelpButton';
import { Tutorial } from '../../components/Tutorial';

const RULES = [
  {
    id: 'r1',
    title: 'Objetivo',
    body: 'El objetivo es acumular Gloria derrotando enemigos y completar el escenario.',
    keywords: ['Gloria', 'objetivo', 'escenario'],
  },
  {
    id: 'r2',
    title: 'Fases del turno',
    body: 'Cada turno consta de: Ataque del Jugador, Ataque de la Horda, Mercado y Restauración.',
    keywords: ['turno', 'fases', 'ataque', 'horda', 'mercado', 'restauración'],
  },
  {
    id: 'r3',
    title: 'Heridas y eliminación',
    body: 'Un jugador recibe heridas igual al daño final. Si alcanza su máximo de heridas, queda eliminado.',
    keywords: ['heridas', 'daño', 'eliminado'],
  },
  {
    id: 'r4',
    title: 'Mercado',
    body: 'En la fase de Mercado puedes comprar cartas pagando monedas. Algunas cartas requieren capacidades.',
    keywords: ['mercado', 'monedas', 'comprar', 'capacidades'],
  },
  {
    id: 'r5',
    title: 'Pericias de héroe',
    body: 'Cada héroe tiene una pericia con usos limitados por turno. Gasta un uso al activarla.',
    keywords: ['pericia', 'héroe', 'usos'],
  },
];

export default function RulebookScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return RULES;
    return RULES.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      r.body.toLowerCase().includes(q) ||
      r.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  }, [query]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Reglamento</Text>
        <HelpButton onPress={() => setShowTutorial(true)} />
      </View>

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar regla..."
        placeholderTextColor="#777"
        accessibilityLabel="Buscar en el reglamento"
      />

      <ScrollView style={styles.list}>
        {filtered.length === 0 ? (
          <Text style={styles.empty}>No se encontraron reglas.</Text>
        ) : (
          filtered.map((rule) => (
            <View key={rule.id} style={styles.rule}>
              <Pressable onPress={() => setSelectedRule(selectedRule === rule.id ? null : rule.id)}>
                <Text style={styles.ruleTitle}>{rule.title}</Text>
              </Pressable>
              {selectedRule === rule.id && (
                <View style={styles.ruleBody}>
                  <Text style={styles.ruleText}>{rule.body}</Text>
                  <Text style={styles.keywords}>Palabras clave: {rule.keywords.join(', ')}</Text>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>

      <Pressable style={styles.backButton} onPress={() => router.push('/')}>
        <Text style={styles.backText}>Volver</Text>
      </Pressable>

      <Tutorial
        visible={showTutorial}
        currentStep={tutorialStep}
        onStepChange={setTutorialStep}
        steps={[
          { title: 'Reglamento', body: 'Busca palabras clave para encontrar reglas rápidamente.' },
          { title: 'Palabras clave', body: 'Cada regla tiene palabras clave que facilitan la búsqueda.' },
          { title: 'Contexto', body: 'Si un error te trae aquí, revisa la sección relacionada.' },
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
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#f1c40f',
    fontSize: 24,
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: '#2c3e50',
    color: '#ecf0f1',
    padding: 10,
    borderRadius: 6,
    marginBottom: 16,
  },
  list: {
    flex: 1,
  },
  empty: {
    color: '#777',
    fontSize: 13,
    textAlign: 'center',
  },
  rule: {
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  ruleTitle: {
    color: '#ecf0f1',
    fontSize: 14,
    fontWeight: 'bold',
  },
  ruleBody: {
    marginTop: 8,
  },
  ruleText: {
    color: '#bdc3c7',
    fontSize: 13,
    lineHeight: 18,
  },
  keywords: {
    color: '#3498db',
    fontSize: 11,
    marginTop: 8,
    fontStyle: 'italic',
  },
  backButton: {
    backgroundColor: '#555',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  backText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
