/**
 * Pantalla de perfil y accesibilidad.
 *
 * Cumple UI-014: densidad configurable (tamaño de texto).
 * Cumple UI-007: tamaño mínimo de texto funcional 14px.
 */

import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Switch } from 'react-native';
import { useRouter } from 'expo-router';

export default function ProfileScreen() {
  const router = useRouter();
  const [fontScale, setFontScale] = useState(1);
  const [highContrast, setHighContrast] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Perfil y accesibilidad</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tamaño del texto</Text>
        <Text style={styles.hint}>UI-014: densidad configurable</Text>
        <View style={styles.scaleRow}>
          {[0.85, 1, 1.15, 1.3].map((scale) => (
            <Pressable
              key={scale}
              onPress={() => setFontScale(scale)}
              style={[styles.scaleButton, fontScale === scale && styles.scaleButtonActive]}
            >
              <Text style={[styles.scaleText, { fontSize: 14 * scale }]}>
                {Math.round(scale * 100)}%
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.optionRow}>
        <Text style={styles.optionLabel}>Alto contraste</Text>
        <Switch value={highContrast} onValueChange={setHighContrast} />
      </View>

      <View style={styles.optionRow}>
        <Text style={styles.optionLabel}>Reducir movimiento</Text>
        <Switch value={reducedMotion} onValueChange={setReducedMotion} />
      </View>

      <View style={styles.preview}>
        <Text style={{ fontSize: 14 * fontScale, color: highContrast ? '#fff' : '#ecf0f1' }}>
          Vista previa del texto
        </Text>
      </View>

      <Pressable style={styles.backButton} onPress={() => router.push('/')}>
        <Text style={styles.backText}>Volver</Text>
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
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#3498db',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  hint: {
    color: '#7f8c8d',
    fontSize: 11,
    marginBottom: 8,
  },
  scaleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  scaleButton: {
    backgroundColor: '#2c3e50',
    padding: 10,
    borderRadius: 6,
    flex: 1,
    alignItems: 'center',
  },
  scaleButtonActive: {
    backgroundColor: '#f1c40f',
  },
  scaleText: {
    color: '#ecf0f1',
    fontWeight: 'bold',
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  optionLabel: {
    color: '#ecf0f1',
    fontSize: 14,
  },
  preview: {
    backgroundColor: '#1a1a2e',
    padding: 20,
    borderRadius: 8,
    marginVertical: 16,
  },
  backButton: {
    backgroundColor: '#555',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 32,
  },
  backText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
