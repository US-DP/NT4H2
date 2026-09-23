/**
 * PendingChoiceView — muestra y resuelve las pendingChoices del viewer.
 *
 * Cubre:
 * - SELECT_CARDS_FOR_LEADER: puja de Líder (1-2 cartas de la mano) — usa CHOOSE_LEADER_CARDS
 * - REACTION_WINDOW: usar pericia reactiva o pasar (Valèrys, Lisavette)
 * - CONFIRM: confirmaciones con opciones textuales (ej: Portal de Ulthar)
 * - SELECT_ENEMY / SELECT_HERO: elegir objetivo entre opciones
 * - SELECT_CARD_FROM_HAND / SEARCH_DECK / SELECT_FROM_MARKET / SELECT_ORDER:
 *   elegir cartas entre las opciones disponibles
 * - SELECT_CARD_FROM_WEAR: elegir carta del desgaste
 *
 * Cumple UI-170 (transparencia de decisiones) y las reglas de privacidad:
 * solo se muestran las pendingChoices del viewer actual.
 */

import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useGameStore } from '../store/gameStore';

export function PendingChoiceView() {
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const viewerId = useGameStore((s) => s.viewerId);
  const resolvePendingChoice = useGameStore((s) => s.resolvePendingChoice);
  const chooseLeaderCards = useGameStore((s) => s.chooseLeaderCards);
  const [selected, setSelected] = useState<string[]>([]);

  if (!gameState || !catalog) return null;

  const actorId = viewerId ?? gameState.activePlayerId;
  // Solo mostrar la elección del viewer actual (privacidad UI-174)
  const choice = gameState.pendingChoices.find(c => c.playerId === actorId);
  if (!choice) return null;

  const isLeaderBid = choice.type === 'SELECT_CARDS_FOR_LEADER';
  const isReaction = choice.type === 'REACTION_WINDOW';
  const isConfirm = choice.type === 'CONFIRM';
  const isOrder = choice.type === 'SELECT_ORDER';

  const toggle = (id: string) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= choice.maxSelections) return prev;
      return [...prev, id];
    });
  };

  const optionLabel = (optionId: string): string => {
    // Intentar resolver como carta del catálogo
    const cardDef = catalog.byId.get(optionId);
    if (cardDef) return `${cardDef.name} (Atq ${cardDef.printedAttack ?? 0})`;
    // Buscar instanceId en mano/mazo/mercado/enemigos
    const player = gameState.players[actorId];
    const inHand = player?.hand.find(c => c.instanceId === optionId);
    if (inHand) {
      const def = catalog.byId.get(inHand.definitionId);
      return def ? `${def.name} (Atq ${def.printedAttack ?? 0})` : optionId;
    }
    const inDeck = player?.abilityDeck.find(c => c.instanceId === optionId);
    if (inDeck) {
      const def = catalog.byId.get(inDeck.definitionId);
      return def ? def.name : optionId;
    }
    const inMarket = gameState.market.find(c => c.instanceId === optionId);
    if (inMarket) {
      const def = catalog.byId.get(inMarket.definitionId);
      return def ? `${def.name} (${def.printedCost ?? 0} monedas)` : optionId;
    }
    const enemy = gameState.battlefield.find(e => e.instanceId === optionId);
    if (enemy) {
      const def = catalog.byId.get(enemy.definitionId);
      return def ? `${def.name} (Fort ${def.printedFortitude ?? '?'})` : optionId;
    }
    const otherPlayer = gameState.players[optionId];
    if (otherPlayer) return `Héroe: ${otherPlayer.heroId}`;
    // Opciones textuales (USE_ABILITY, PASS, glory, coins…)
    const labels: Record<string, string> = {
      USE_ABILITY: 'Usar pericia',
      PASS: 'Pasar',
      glory: 'Pagar 1 Gloria',
      coins: 'Pagar 2 Monedas',
    };
    return labels[optionId] ?? optionId;
  };

  const handleConfirm = () => {
    if (selected.length < choice.minSelections) return;
    if (isLeaderBid) {
      chooseLeaderCards(selected);
    } else {
      resolvePendingChoice(choice.choiceId, selected);
    }
    setSelected([]);
  };

  const handlePass = () => {
    resolvePendingChoice(choice.choiceId, ['PASS']);
    setSelected([]);
  };

  // REACTION_WINDOW: botones directos (Usar pericia / Pasar)
  if (isReaction) {
    return (
      <View style={styles.container} accessibilityRole="alert">
        <Text style={styles.title}>{choice.prompt}</Text>
        <View style={styles.row}>
          <Pressable
            style={styles.primaryButton}
            onPress={() => resolvePendingChoice(choice.choiceId, ['USE_ABILITY'])}
            accessibilityLabel="Usar pericia"
          >
            <Text style={styles.buttonText}>Usar pericia</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={handlePass}
            accessibilityLabel="Pasar"
          >
            <Text style={styles.buttonText}>Pasar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // CONFIRM: opciones como botones
  if (isConfirm) {
    return (
      <View style={styles.container} accessibilityRole="alert">
        <Text style={styles.title}>{choice.prompt}</Text>
        <View style={styles.row}>
          {choice.options.map(opt => (
            <Pressable
              key={opt}
              style={styles.primaryButton}
              onPress={() => resolvePendingChoice(choice.choiceId, [opt])}
              accessibilityLabel={optionLabel(opt)}
            >
              <Text style={styles.buttonText}>{optionLabel(opt)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  // SELECT_*: lista de opciones seleccionables
  const canConfirm = selected.length >= choice.minSelections && selected.length <= choice.maxSelections;

  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>{choice.prompt}</Text>
      <Text style={styles.subtitle}>
        {choice.minSelections === choice.maxSelections
          ? `Elige ${choice.minSelections}`
          : `Elige ${choice.minSelections}-${choice.maxSelections}`}
      </Text>
      <ScrollView style={styles.options} horizontal={isLeaderBid}>
        {choice.options.map(opt => {
          const isSelected = selected.includes(opt);
          return (
            <Pressable
              key={opt}
              style={[styles.option, isSelected && styles.optionSelected]}
              onPress={() => toggle(opt)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={optionLabel(opt)}
            >
              <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                {isOrder && isSelected ? `${selected.indexOf(opt) + 1}. ` : ''}
                {optionLabel(opt)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable
        style={[styles.primaryButton, !canConfirm && styles.buttonDisabled]}
        onPress={handleConfirm}
        disabled={!canConfirm}
        accessibilityLabel="Confirmar selección"
      >
        <Text style={styles.buttonText}>
          {isLeaderBid ? 'Pujar' : 'Confirmar'} ({selected.length}/{choice.maxSelections})
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a2e',
    borderWidth: 2,
    borderColor: '#f1c40f',
    borderRadius: 10,
    padding: 14,
    margin: 8,
  },
  title: {
    color: '#f1c40f',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    color: '#bdc3c7',
    fontSize: 12,
    marginBottom: 10,
  },
  options: {
    maxHeight: 160,
    marginBottom: 10,
  },
  option: {
    backgroundColor: '#2c3e50',
    borderRadius: 8,
    padding: 10,
    marginRight: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#34495e',
    minWidth: 110,
  },
  optionSelected: {
    borderColor: '#f1c40f',
    backgroundColor: '#3d3d1f',
  },
  optionText: {
    color: '#ecf0f1',
    fontSize: 12,
  },
  optionTextSelected: {
    color: '#f1c40f',
    fontWeight: 'bold',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: '#27ae60',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 120,
  },
  secondaryButton: {
    backgroundColor: '#555',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 100,
  },
  buttonDisabled: {
    backgroundColor: '#555',
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
