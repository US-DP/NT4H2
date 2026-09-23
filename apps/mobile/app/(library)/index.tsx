/**
 * Pantalla de biblioteca / colección.
 *
 * Cumple UI-230: vistas/filtros.
 * Cumple UI-231: filtros mínimos (tipo, clase).
 * Cumple UI-232: info de tarjeta.
 * Cumple UI-233: archivadas visibles.
 * Cumple UI-234: operaciones masivas (seleccionar/deseleccionar).
 */

import { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import type { CardDefinition } from '@nt4h/schema';

const CARD_TYPES = ['ABILITY', 'HERO', 'ENEMY', 'MARKET', 'SCENARIO'] as const;
const HERO_CLASSES = ['EXPLORER', 'WARRIOR', 'ROGUE', 'MAGE'] as const;

export default function LibraryScreen() {
  const router = useRouter();
  const catalog = useGameStore((s) => s.catalog);

  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterClass, setFilterClass] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<CardDefinition | null>(null);

  const allCards = useMemo(() => {
    if (!catalog) return [];
    return Array.from(catalog.byId.values());
  }, [catalog]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allCards.filter((card) => {
      if (filterType && card.type !== filterType) return false;
      if (filterClass && card.heroClass !== filterClass) return false;
      if (!q) return true;
      return card.name.toLowerCase().includes(q) || card.id.toLowerCase().includes(q);
    });
  }, [allCards, query, filterType, filterClass]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(filtered.map((c) => c.id)));
  const clearSelection = () => setSelected(new Set());

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Colección</Text>

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar carta..."
        placeholderTextColor="#777"
        accessibilityLabel="Buscar carta"
      />

      <View style={styles.filters}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {CARD_TYPES.map((t) => (
            <Pressable
              key={t}
              onPress={() => setFilterType(filterType === t ? null : t)}
              style={[styles.filterChip, filterType === t && styles.filterChipActive]}
            >
              <Text style={styles.filterChipText}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {HERO_CLASSES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setFilterClass(filterClass === c ? null : c)}
              style={[styles.filterChip, filterClass === c && styles.filterChipActive]}
            >
              <Text style={styles.filterChipText}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.massActions}>
        <Pressable onPress={selectAll} style={styles.massButton}>
          <Text style={styles.massText}>Seleccionar todo</Text>
        </Pressable>
        <Pressable onPress={clearSelection} style={styles.massButton}>
          <Text style={styles.massText}>Limpiar ({selected.size})</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.list}>
        {filtered.length === 0 ? (
          <Text style={styles.empty}>No se encontraron cartas.</Text>
        ) : (
          filtered.map((card) => (
            <Pressable
              key={card.id}
              onPress={() => setDetail(card)}
              onLongPress={() => toggleSelect(card.id)}
              style={[
                styles.card,
                selected.has(card.id) && styles.cardSelected,
              ]}
            >
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardMeta}>
                {card.type} {card.heroClass ? `• ${card.heroClass}` : ''}
              </Text>
              {selected.has(card.id) && <Text style={styles.selectedMark}>✓</Text>}
            </Pressable>
          ))
        )}
      </ScrollView>

      {detail && (
        <View style={styles.detailOverlay}>
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>{detail.name}</Text>
            <Text style={styles.detailMeta}>ID: {detail.id}</Text>
            <Text style={styles.detailMeta}>Tipo: {detail.type}</Text>
            {detail.heroClass && <Text style={styles.detailMeta}>Clase: {detail.heroClass}</Text>}
            {detail.printedAttack !== undefined && <Text style={styles.detailMeta}>Ataque: {detail.printedAttack}</Text>}
            {detail.printedFortitude !== undefined && <Text style={styles.detailMeta}>Fortaleza: {detail.printedFortitude}</Text>}
            {detail.printedCost !== undefined && <Text style={styles.detailMeta}>Coste: {detail.printedCost}</Text>}
            {detail.capabilities && detail.capabilities.length > 0 && (
              <Text style={styles.detailMeta}>Capacidades: {detail.capabilities.join(', ')}</Text>
            )}
            <Pressable onPress={() => setDetail(null)} style={styles.closeButton}>
              <Text style={styles.closeText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Pressable style={styles.backButton} onPress={() => router.push('/')}>
        <Text style={styles.backText}>Volver</Text>
      </Pressable>
    </View>
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
  input: {
    backgroundColor: '#2c3e50',
    color: '#ecf0f1',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  filters: {
    marginBottom: 8,
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  filterChip: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#34495e',
    marginRight: 6,
  },
  filterChipActive: {
    backgroundColor: '#f1c40f',
    borderColor: '#f1c40f',
  },
  filterChipText: {
    color: '#ecf0f1',
    fontSize: 12,
    fontWeight: 'bold',
  },
  massActions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  massButton: {
    backgroundColor: '#34495e',
    padding: 8,
    borderRadius: 6,
    flex: 1,
    alignItems: 'center',
  },
  massText: {
    color: '#ecf0f1',
    fontSize: 12,
  },
  list: {
    flex: 1,
  },
  empty: {
    color: '#777',
    textAlign: 'center',
    marginTop: 20,
  },
  card: {
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#34495e',
  },
  cardSelected: {
    borderColor: '#f1c40f',
  },
  cardName: {
    color: '#ecf0f1',
    fontSize: 14,
    fontWeight: 'bold',
  },
  cardMeta: {
    color: '#7f8c8d',
    fontSize: 11,
  },
  selectedMark: {
    color: '#f1c40f',
    position: 'absolute',
    right: 8,
    top: 8,
    fontSize: 16,
    fontWeight: 'bold',
  },
  detailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  detailCard: {
    backgroundColor: '#1a1a2e',
    padding: 20,
    borderRadius: 12,
    width: '100%',
    maxWidth: 420,
  },
  detailTitle: {
    color: '#f1c40f',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  detailMeta: {
    color: '#ecf0f1',
    fontSize: 13,
    marginBottom: 6,
  },
  closeButton: {
    backgroundColor: '#2980b9',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 12,
  },
  closeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
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
