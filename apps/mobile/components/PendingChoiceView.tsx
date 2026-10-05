/**
 * PendingChoiceView — muestra y resuelve las pendingChoices del viewer.
 *
 * Cubre:
 * - SELECT_CARDS_FOR_LEADER: puja de Líder (1-2 cartas de la mano) — usa CHOOSE_LEADER_CARDS
 * - turn-start-* (CONFIRM sin opciones): efecto opcional del escenario —
 *   usa ACCEPT_TURN_START_EFFECT (Sí/No), nunca RESOLVE_CHOICE
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
import { touchTarget, type Colors } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';

export function PendingChoiceView() {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const viewerId = useGameStore((s) => s.viewerId);
  const resolvePendingChoice = useGameStore((s) => s.resolvePendingChoice);
  const chooseLeaderCards = useGameStore((s) => s.chooseLeaderCards);
  const acceptTurnStartEffect = useGameStore((s) => s.acceptTurnStartEffect);
  const handOverTo = useGameStore((s) => s.handOverTo);
  const connectionMode = useGameStore((s) => s.connectionMode);
  const [selected, setSelected] = useState<string[]>([]);
  const c = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca el componente
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(c, fs);

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
        {connectionMode !== 'online' && (
          // M-6: hot-seat — la elección ajena bloqueaba la mesa sin forma de
          // entregar el dispositivo; ahora el viewer puede cedérselo al
          // decisor con transición de privacidad.
          <Pressable
            style={styles.secondaryButton}
            onPress={() => handOverTo(foreign.playerId)}
            accessibilityRole="button"
            accessibilityLabel={t('common.privacy.passDevice')}
          >
            <Text style={styles.buttonText}>
              {t('panels.choiceHandOver', { decider })}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  // Efecto opcional de inicio de turno del escenario (Montañas de Ur,
  // Puerto de Eque…): se responde con ACCEPT_TURN_START_EFFECT, no con
  // RESOLVE_CHOICE — el motor rechaza RESOLVE_CHOICE sobre turn-start-*.
  if (choice.choiceId.startsWith('turn-start-')) {
    return (
      <View style={styles.container} accessibilityRole="alert">
        <Text style={styles.title}>{choice.prompt}</Text>
        <View style={styles.row}>
          <Pressable
            style={styles.primaryButton}
            onPress={() => acceptTurnStartEffect(true)}
            accessibilityRole="button"
            accessibilityLabel={t('panels.yes')}
          >
            <Text style={[styles.buttonText, styles.primaryButtonText]}>{t('panels.yes')}</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => acceptTurnStartEffect(false)}
            accessibilityRole="button"
            accessibilityLabel={t('panels.no')}
          >
            <Text style={styles.buttonText}>{t('panels.no')}</Text>
          </Pressable>
        </View>
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
            <Text style={[styles.buttonText, styles.primaryButtonText]}>{t('panels.pendingUseAbility')}</Text>
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
              <Text style={[styles.buttonText, styles.primaryButtonText]}>{optionLabel(opt)}</Text>
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
        <Text style={[styles.buttonText, canConfirm && styles.primaryButtonText]}>
          {isLeaderBid
            ? t('panels.pendingBid', { selected: selected.length, max: choice.maxSelections })
            : t('panels.pendingConfirm', { selected: selected.length, max: choice.maxSelections })}
        </Text>
      </Pressable>
    </View>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    backgroundColor: c.surface,
    borderWidth: 2,
    borderColor: c.accent,
    borderRadius: 10,
    padding: 14,
    margin: 8,
  },
  title: {
    color: c.accent,
    fontSize: fs(15),
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    color: c.textMuted,
    fontSize: fs(12),
    marginBottom: 10,
  },
  waitingText: {
    color: c.textMuted,
    fontSize: fs(13),
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 6,
  },
  options: {
    maxHeight: 160,
    marginBottom: 10,
  },
  option: {
    backgroundColor: c.surfaceInteractive,
    borderRadius: 8,
    padding: 10,
    marginRight: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: c.border,
    minWidth: 110,
    minHeight: touchTarget,
    justifyContent: 'center',
  },
  optionSelected: {
    borderColor: c.accent,
    backgroundColor: c.surfaceInteractiveSelected,
  },
  optionText: {
    color: c.text,
    fontSize: fs(12),
  },
  optionTextSelected: {
    color: c.accent,
    fontWeight: 'bold',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: c.accent,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
    minHeight: touchTarget,
  },
  secondaryButton: {
    backgroundColor: c.border,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
    minHeight: touchTarget,
  },
  buttonDisabled: {
    backgroundColor: c.surfaceDisabled,
    opacity: 0.5,
  },
  buttonText: {
    color: c.text,
    fontSize: fs(13),
    fontWeight: 'bold',
  },
  primaryButtonText: {
    color: c.textOnAccent,
  },
});
