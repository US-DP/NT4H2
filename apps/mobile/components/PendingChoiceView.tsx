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
import { useTranslation } from 'react-i18next';
import { useGameStore } from '../store/gameStore';

export function PendingChoiceView() {
  const { t } = useTranslation();
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
  if (!choice) {
    // UI-133: si hay una elección pendiente de OTRO jugador (hot-seat local;
    // en online la proyección ya filtra las ajenas), mostrar espera no
    // interactiva en lugar de ocultar el estado de la partida.
    const foreign = gameState.pendingChoices[0];
    if (!foreign) return null;
    const deciderHero = gameState.players[foreign.playerId]?.heroId;
    const decider = (deciderHero && catalog.byId.get(deciderHero)?.name) ?? foreign.playerId;
    return (
      <View style={styles.container} accessibilityRole="alert">
        <Text style={styles.waitingText}>{t('panels.choiceWaiting', { decider })}</Text>
      </View>
    );
  }

  // UI-135: sin opción legal la elección no debe bloquear la mesa.
  // RESOLVE_CHOICE admite [] solo cuando minSelections === 0 (motor);
  // si exige selecciones pero no hay opciones, solo queda esperar.
  const noLegalOption = choice.type !== 'REACTION_WINDOW' && choice.options.length === 0;
  if (noLegalOption) {
    return (
      <View style={styles.container} accessibilityRole="alert">
        <Text style={styles.title}>{choice.prompt}</Text>
        <Text style={styles.subtitle}>{t('panels.choiceNoOptions')}</Text>
        {choice.minSelections === 0 ? (
          <Pressable
            style={styles.secondaryButton}
            onPress={() => resolvePendingChoice(choice.choiceId, [])}
            accessibilityRole="button"
            accessibilityLabel={t('panels.choiceContinue')}
          >
            <Text style={styles.buttonText}>{t('panels.choiceContinue')}</Text>
          </Pressable>
        ) : (
          <Text style={styles.subtitle}>{t('common.phases.WAITING_FOR_CHOICE')}</Text>
        )}
      </View>
    );
  }

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
    if (cardDef) return t('panels.pendingCardAttack', { name: cardDef.name, value: cardDef.printedAttack ?? 0 });
    // Buscar instanceId en mano/mazo/desgaste/mercado/horda/enemigos
    const player = gameState.players[actorId];
    const inHand = player?.hand.find(c => c.instanceId === optionId);
    if (inHand) {
      const def = catalog.byId.get(inHand.definitionId);
      return def ? t('panels.pendingCardAttack', { name: def.name, value: def.printedAttack ?? 0 }) : optionId;
    }
    const inDeck = player?.abilityDeck.find(c => c.instanceId === optionId);
    if (inDeck) {
      const def = catalog.byId.get(inDeck.definitionId);
      return def ? def.name : optionId;
    }
    const inWear = player?.wearPile.find(c => c.instanceId === optionId);
    if (inWear) {
      const def = catalog.byId.get(inWear.definitionId);
      return def ? def.name : optionId;
    }
    const inMarket = gameState.market.find(c => c.instanceId === optionId);
    if (inMarket) {
      const def = catalog.byId.get(inMarket.definitionId);
      return def ? t('panels.pendingCardCost', { name: def.name, value: def.printedCost ?? 0 }) : optionId;
    }
    const inMarketDeck = gameState.marketDeck?.find(c => c.instanceId === optionId);
    if (inMarketDeck) {
      const def = catalog.byId.get(inMarketDeck.definitionId);
      return def ? def.name : optionId;
    }
    const inHorde = gameState.hordeDeck?.find(c => c.instanceId === optionId);
    if (inHorde) {
      const def = catalog.byId.get(inHorde.definitionId);
      return def ? def.name : optionId;
    }
    const enemy = gameState.battlefield.find(e => e.instanceId === optionId);
    if (enemy) {
      const def = catalog.byId.get(enemy.definitionId);
      return def ? t('panels.pendingCardFort', { name: def.name, value: def.printedFortitude ?? '?' }) : optionId;
    }
    // Trofeos (Portal de Ulthar): el enemigo derrotado ya no está en el campo;
    // su definitionId se recupera del eventLog
    const defeated = gameState.eventLog?.find(
      (e) => e.type === 'ENEMY_DEFEATED' && e.enemyInstanceId === optionId,
    );
    if (defeated && defeated.type === 'ENEMY_DEFEATED') {
      const def = catalog.byId.get(defeated.enemyDefinitionId);
      return def ? def.name : optionId;
    }
    // Monedas a robar ('p2#coin3'): una opción por moneda del héroe origen
    if (optionId.includes('#coin')) {
      const pid = optionId.split('#coin')[0];
      const victim = gameState.players[pid];
      const name = victim
        ? (catalog.byId.get(victim.heroId)?.name ?? victim.heroId)
        : pid;
      return t('panels.pendingHero', { hero: name });
    }
    const otherPlayer = gameState.players[optionId];
    if (otherPlayer) {
      const name = catalog.byId.get(otherPlayer.heroId)?.name ?? otherPlayer.heroId;
      return t('panels.pendingHero', { hero: name });
    }
    // Opciones textuales (USE_ABILITY, PASS, glory, coins, yes/no…)
    const labels: Record<string, string> = {
      USE_ABILITY: t('panels.pendingUseAbility'),
      PASS: t('panels.pass'),
      glory: t('panels.pendingPayGlory'),
      coins: t('panels.pendingPayCoins'),
      yes: t('panels.yes'),
      no: t('panels.no'),
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
            accessibilityRole="button"
            accessibilityLabel={t('panels.pendingUseAbility')}
          >
            <Text style={styles.buttonText}>{t('panels.pendingUseAbility')}</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={handlePass}
            accessibilityRole="button"
            accessibilityLabel={t('panels.pass')}
          >
            <Text style={styles.buttonText}>{t('panels.pass')}</Text>
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
              accessibilityRole="button"
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
          ? t('panels.pendingChooseExact', { n: choice.minSelections })
          : t('panels.pendingChooseRange', { min: choice.minSelections, max: choice.maxSelections })}
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
        accessibilityRole="button"
        accessibilityState={{ disabled: !canConfirm }}
        accessibilityLabel={t('panels.pendingConfirmA11y')}
      >
        <Text style={styles.buttonText}>
          {isLeaderBid
            ? t('panels.pendingBid', { selected: selected.length, max: choice.maxSelections })
            : t('panels.pendingConfirm', { selected: selected.length, max: choice.maxSelections })}
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
  waitingText: {
    color: '#bdc3c7',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 6,
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
