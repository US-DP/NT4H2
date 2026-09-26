/**
 * HandView — muestra la mano del jugador activo.
 *
 * Cumple UI-100: zona inferior estable.
 * Cumple UI-101: desplazarse, seleccionar, ampliar, jugar, consultar, cancelar.
 * Cumple UI-102: diferenciar jugables de no jugables.
 * Cumple UI-103: mostrar motivo de no jugable.
 * Cumple UI-104: selección no juega automáticamente.
 * Cumple UI-105: mantener pulsado ampliar (onLongPress).
 * Cumple UI-106: carta seleccionada se eleva y muestra nombre.
 * Cumple UI-107: progreso de objetivos.
 * Cumple UI-108: desmarcar objetivos.
 *
 * Objetivos de enemigo: la carta seleccionada explica si necesita un
 * enemigo (y con qué filtro), si afecta a todos automáticamente o si no
 * necesita objetivo. El enemigo se elige en el Battlefield y se confirma
 * aquí — nunca se juega por accidente al tocar un enemigo.
 */

import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { CardView } from './CardView';
import { CardZoom } from './CardZoom';
import { useGameStore } from '../store/gameStore';
import { useSettingsSafe } from '../lib/useTheme';
import { getCardTargeting, isValidEnemyTarget } from '../lib/targeting';
import { hapticSelect, hapticPlay, hapticError } from '../lib/haptics';
import { announceA11y } from '../lib/a11y';
import { playEffect, playUi } from '../lib/audio';
import type { CardInstance } from '@nt4h/schema';

/**
 * Carta arrastrable: arrastrar hacia arriba = intención de jugar.
 * La carta sigue el dedo y vuelve con muelle al soltar.
 */
function DraggableCard({
  onDragPlay,
  style: wrapperStyle,
  children,
}: {
  onDragPlay: () => void;
  style?: object;
  children: React.ReactNode;
}) {
  const dragSensitivity = useSettingsSafe((s) => s.dragSensitivity);
  const reduceMotion = useSettingsSafe((s) => s.reduceMotion);
  const dragY = useSharedValue(0);
  // Sensibilidad de arrastre: baja = recorrido más largo, alta = más corto
  const activateAt = { low: -24, medium: -12, high: -6 }[dragSensitivity];
  const releaseAt = { low: -110, medium: -70, high: -40 }[dragSensitivity];
  const pan = Gesture.Pan()
    .activeOffsetY(activateAt)   // solo arrastre vertical hacia arriba
    .failOffsetX(14)             // el scroll horizontal de la mano sigue funcionando
    .onUpdate((e) => {
      dragY.value = Math.min(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY < releaseAt) {
        runOnJS(onDragPlay)();
      }
      dragY.value = reduceMotion ? 0 : withSpring(0, { damping: 15 });
    })
    .onFinalize(() => {
      dragY.value = reduceMotion ? 0 : withSpring(0, { damping: 15 });
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
    zIndex: dragY.value < -8 ? 10 : 0,
  }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[wrapperStyle, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

interface HandViewProps {
  /** Carta a ampliar (controlado por el padre) */
  zoomedCardId?: string | null;
  onZoomCard?: (cardInstanceId: string | null) => void;
}

export function HandView({
  zoomedCardId,
  onZoomCard,
}: HandViewProps) {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const selectedCard = useGameStore((s) => s.ui.selectedCardInstanceId);
  const selectedEnemy = useGameStore((s) => s.ui.selectedEnemyInstanceId);
  const selectCard = useGameStore((s) => s.selectCard);
  const selectEnemy = useGameStore((s) => s.selectEnemy);
  const playCard = useGameStore((s) => s.playCard);
  const checkCardPlayable = useGameStore((s) => s.checkCardPlayable);
  const viewerId = useGameStore((s) => s.viewerId);
  const evasionSelection = useGameStore((s) => s.ui.evasionSelection);
  const toggleEvasionCard = useGameStore((s) => s.toggleEvasionCard);
  const cancelEvasion = useGameStore((s) => s.cancelEvasion);
  const evasion = useGameStore((s) => s.evasion);
  const evasionMode = Array.isArray(evasionSelection);
  // srListPositions: "Carta 2 de 7" al navegar la mano con lector
  const srPositions = useSettingsSafe((s) => s.srListPositions);

  if (!gameState || !catalog) return null;

  // D421: mostrar la mano del viewer (en online es online.playerId;
  // en hot-seat coincide con activePlayerId tras la pantalla de privacidad)
  const playerId = viewerId ?? gameState.activePlayerId;
  const player = gameState.players[playerId];
  if (!player) return null;

  const selectedInstance = selectedCard
    ? player.hand.find((c) => c.instanceId === selectedCard)
    : undefined;
  const selectedDef = selectedInstance
    ? catalog.byId.get(selectedInstance.definitionId)
    : undefined;
  const targeting = getCardTargeting(selectedDef);

  // Enemigo elegido y su validez para esta carta. Puede haber salido del
  // campo tras seleccionarlo (derrotado, cambio de estado) → sin `!`,
  // un objetivo inexistente simplemente no es válido.
  const chosenEnemy = selectedEnemy
    ? gameState.battlefield.find(e => e.instanceId === selectedEnemy)
    : undefined;
  const enemyTarget = chosenEnemy
    ? isValidEnemyTarget(targeting, chosenEnemy, gameState)
    : { ok: false };
  const chosenEnemyName = chosenEnemy
    ? catalog.byId.get(chosenEnemy.definitionId)?.name ?? t('hud.enemyFallback')
    : undefined;

  const needsEnemy = targeting.mode === 'enemy';
  const canConfirm = needsEnemy ? enemyTarget.ok : true;

  const zoomedInstance = zoomedCardId ? player.hand.find((c) => c.instanceId === zoomedCardId) : undefined;
  const zoomedCard = zoomedInstance ? catalog.byId.get(zoomedInstance.definitionId) : null;

  const handleCardPress = (cardInstance: CardInstance, isPlayable: boolean, reason?: string) => {
    // En modo evasión cualquier carta de la mano es elegible para descartar
    if (evasionMode) {
      hapticSelect();
      toggleEvasionCard(cardInstance.instanceId);
      return;
    }
    if (!isPlayable) {
      hapticError();
      announceA11y(t('hud.a11yMoveInvalid'));
      if (reason) selectCard(null);
      return;
    }

    if (selectedCard === cardInstance.instanceId) {
      hapticSelect();
      announceA11y(t('hud.a11yCardDeselected'));
      selectCard(null);
      return;
    }

    hapticSelect();
    announceA11y(t('hud.a11yCardSelected', {
      name: catalog.byId.get(cardInstance.definitionId)?.name ?? '',
    }));
    selectCard(cardInstance.instanceId);
    // Cambiar de carta descarta el enemigo elegido (puede no ser válido para la nueva)
    selectEnemy?.(null);
  };

  const handleCardLongPress = (cardInstance: CardInstance) => {
    onZoomCard?.(cardInstance.instanceId);
  };

  // Arrastrar hacia arriba: si no necesita objetivo se juega directa;
  // si lo necesita queda seleccionada para elegir enemigo en el campo.
  const handleDragPlay = (cardInstance: CardInstance, isPlayable: boolean) => {
    if (evasionMode) return;
    if (!isPlayable) {
      hapticError();
      playUi('error');
      return;
    }
    const def = catalog.byId.get(cardInstance.definitionId);
    const cardTargeting = getCardTargeting(def);
    if (cardTargeting.mode === 'enemy') {
      hapticSelect();
      selectCard(cardInstance.instanceId);
      selectEnemy?.(null);
    } else {
      hapticPlay();
      playEffect('card-play');
      playCard(cardInstance.instanceId);
    }
  };

  const handleConfirm = () => {
    if (!selectedCard || !canConfirm) return;
    hapticPlay();
    playCard(selectedCard, needsEnemy ? selectedEnemy ?? undefined : undefined);
    selectEnemy?.(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {evasionMode ? t('hud.evasionTitle') : t('hud.handTitle', { count: player.hand.length })}
        </Text>
        {selectedCard && selectedDef && !evasionMode && (
          <View style={styles.selectionInfo}>
            <Text style={styles.selectionText}>{selectedDef.name}</Text>
          </View>
        )}
      </View>

      <ScrollView horizontal style={styles.hand}>
        {player.hand.map((cardInstance: CardInstance, index: number) => {
          const cardDef = catalog.byId.get(cardInstance.definitionId);
          if (!cardDef) return null;

          const playable = checkCardPlayable?.(cardInstance.instanceId) ?? { ok: true };
          const isPlayable = evasionMode ? true : playable.ok;
          const reason = !playable.ok ? playable.reason : undefined;
          const evasionChosen = evasionSelection?.includes(cardInstance.instanceId) ?? false;

          return (
            <DraggableCard
              key={cardInstance.instanceId}
              onDragPlay={() => handleDragPlay(cardInstance, isPlayable)}
              // Solapado tipo abanico (TCG): la mano ocupa menos y se lee mejor
              style={index > 0 ? styles.fanOverlap : undefined}
            >
              <CardView
                card={cardDef}
                selected={evasionMode ? evasionChosen : selectedCard === cardInstance.instanceId}
                blocked={!isPlayable}
                blockedReason={reason}
                positionLabel={srPositions ? t('cardui.a11y.posOf', {
                  i: index + 1, n: player.hand.length,
                }) : undefined}
                onPress={() => handleCardPress(cardInstance, isPlayable, reason)}
                onLongPress={() => handleCardLongPress(cardInstance)}
              />
            </DraggableCard>
          );
        })}
      </ScrollView>

      {evasionMode && (
        <View style={styles.targetBar} accessibilityLiveRegion="polite">
          <Text style={styles.targetDesc}>
            {t('hud.evasionProgress', { count: evasionSelection.length })}
          </Text>
          <Text style={styles.targetHint}>
            {t('hud.evasionHint')}
          </Text>
        </View>
      )}

      {evasionMode && (
        <View style={styles.actions}>
          <Pressable
            style={styles.cancelButton}
            onPress={cancelEvasion}
            accessibilityRole="button"
            accessibilityLabel={t('hud.evasionCancelA11y')}
          >
            <Text style={styles.buttonText}>{t('hud.cancel')}</Text>
          </Pressable>
          <Pressable
            style={[styles.playButton, (evasionSelection?.length ?? 0) < 2 && styles.playButtonDisabled]}
            onPress={() => { if ((evasionSelection?.length ?? 0) >= 2) { hapticPlay(); evasion(evasionSelection); } }}
            disabled={(evasionSelection?.length ?? 0) < 2}
            accessibilityRole="button"
            accessibilityLabel={t('hud.evasionConfirmA11y', { count: evasionSelection?.length ?? 0 })}
            accessibilityState={{ disabled: (evasionSelection?.length ?? 0) < 2 }}
          >
            <Text style={styles.buttonText}>
              {t('hud.evade')}{evasionSelection && evasionSelection.length >= 2 ? ` (${evasionSelection.length})` : ''}
            </Text>
          </Pressable>
        </View>
      )}

      {selectedCard && (
        <View style={styles.targetBar}>
          {/* Explicación del objetivo que requiere la carta */}
          <Text style={styles.targetDesc} accessibilityLiveRegion="polite">
            {needsEnemy
              ? `⚔ ${targeting.description}`
              : `ℹ ${targeting.description}`}
          </Text>
          {needsEnemy && !chosenEnemy && (
            <Text style={styles.targetHint}>
              {t('hud.pickEnemyHint')}
            </Text>
          )}
          {needsEnemy && chosenEnemy && !enemyTarget.ok && (
            <Text style={styles.targetError}>
              {t('hud.targetError', { name: chosenEnemyName ?? '', reason: enemyTarget.reason ?? '' })}
            </Text>
          )}
          {needsEnemy && chosenEnemy && enemyTarget.ok && (
            <Text style={styles.targetOk}>
              {t('hud.targetChosen', { name: chosenEnemyName })}
            </Text>
          )}
        </View>
      )}

      {selectedCard && (
        <View style={styles.actions}>
          <Pressable
            style={styles.cancelButton}
            onPress={() => { selectCard(null); selectEnemy?.(null); }}
            accessibilityRole="button"
            accessibilityLabel={t('hud.cancelSelectionA11y')}
          >
            <Text style={styles.buttonText}>{t('hud.cancel')}</Text>
          </Pressable>
          {/* Alternativa a la pulsación larga (accesible con teclado/táctil) */}
          <Pressable
            style={styles.zoomButton}
            onPress={() => onZoomCard?.(selectedCard)}
            accessibilityRole="button"
            accessibilityLabel={t('hud.zoomA11y')}
          >
            <Text style={styles.buttonText}>{t('hud.zoom')}</Text>
          </Pressable>
          <Pressable
            style={[styles.playButton, !canConfirm && styles.playButtonDisabled]}
            onPress={handleConfirm}
            disabled={!canConfirm}
            accessibilityRole="button"
            accessibilityLabel={needsEnemy ? t('hud.playVsTargetA11y') : t('hud.playCardA11y')}
            accessibilityState={{ disabled: !canConfirm }}
          >
            <Text style={styles.buttonText}>
              {needsEnemy ? t('hud.playVsTarget') : t('hud.playCard')}
            </Text>
          </Pressable>
        </View>
      )}

      <CardZoom visible={!!zoomedCard} card={zoomedCard ?? null} onClose={() => onZoomCard?.(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: '#0f0f23',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#ecf0f1',
    fontSize: 14,
    fontWeight: 'bold',
  },
  selectionInfo: {
    alignItems: 'flex-end',
  },
  selectionText: {
    color: '#f1c40f',
    fontSize: 13,
    fontWeight: 'bold',
  },
  hand: {
    flexDirection: 'row',
    paddingVertical: 10,
  },
  fanOverlap: {
    marginLeft: -34,
  },
  targetBar: {
    marginTop: 6,
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#16213e',
  },
  targetDesc: {
    color: '#ecf0f1',
    fontSize: 12,
    fontWeight: 'bold',
  },
  targetHint: {
    color: '#bdc3c7',
    fontSize: 11,
    marginTop: 3,
    fontStyle: 'italic',
  },
  targetOk: {
    color: '#27ae60',
    fontSize: 11,
    marginTop: 3,
    fontWeight: 'bold',
  },
  targetError: {
    color: '#e74c3c',
    fontSize: 11,
    marginTop: 3,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  playButton: {
    backgroundColor: '#27ae60',
    padding: 12,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  playButtonDisabled: {
    backgroundColor: '#3a5a47',
    opacity: 0.6,
  },
  cancelButton: {
    backgroundColor: '#555',
    padding: 12,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  zoomButton: {
    backgroundColor: '#2c3e50',
    padding: 12,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
