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

import { memo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { CardView } from './CardView';
import { CardZoom } from './CardZoom';
import { useGameStore } from '../store/gameStore';
import { useSettingsSafe, useColors, useFs } from '../lib/useTheme';
import { touchTarget } from '../lib/theme';
import type { Colors } from '../lib/theme';
import { getCardTargeting, isValidEnemyTarget } from '../lib/targeting';
import { engineReasonText } from '../lib/engineReasons';
import { hapticSelect, hapticPlay, hapticError } from '../lib/haptics';
import { announceA11y } from '../lib/a11y';
import { playEffect, playUi } from '../lib/audio';
import type { CardDefinition, CardInstance, GameState, PlayerState } from '@nt4h/schema';

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

/** Modo de selección de la mano (afecta a la semántica del tap). */
type HandMode = 'normal' | 'evasion' | 'swap';

/** Cambio de cartas iniciales (SOLO, una vez, spec §4.1). */
function isSetupSwapAvailable(gameState: GameState | null, player: PlayerState | undefined): boolean {
  return !!gameState && !!player &&
    gameState.mode === 'SOLO' &&
    (gameState.phase === 'SETUP' || gameState.phase === 'INITIAL_PLAYER_SELECTION') &&
    !player.startingSwapUsed;
}

interface HandCardProps {
  cardDef: CardDefinition;
  instance: CardInstance;
  mode: HandMode;
  selected: boolean;
  blocked: boolean;
  blockedReason?: string;
  positionLabel?: string;
  /** La carta siguiente la cubre por la derecha (abanico): el texto
   *  del motivo queda ilegible; solo el candado (el motivo completo
   *  sigue en accessibilityHint y en el mensaje al pulsar) */
  covered: boolean;
  fanOverlap: boolean;
  onCardPress: (c: CardInstance, isPlayable: boolean, reason?: string) => void;
  onCardLongPress: (c: CardInstance) => void;
  onCardDragPlay: (c: CardInstance, isPlayable: boolean) => void;
}

/**
 * Una carta de la mano. memo: cualquier evento del motor re-renderiza
 * HandView pero solo cambian las cartas afectadas — el resto se salta
 * el render (M-3). El comparador ignora los tres handlers: una
 * closure obsoleta sigue siendo correcta porque TODA variable que
 * cambia su comportamiento está cubierta por una prop comparada
 * (mode cubre swapActive/evasionMode; selected cubre la rama de
 * deselección por selectedCard; blocked/blockedReason cubren la
 * jugabilidad; las acciones del store son estables).
 */
// Solapado tipo abanico (TCG): la mano ocupa menos y se lee mejor.
// Estilo estático fuera de createStyles: HandCard es de módulo y no
// ve el `styles` por-render de HandView.
const FAN_OVERLAP = { marginLeft: -34 } as const;

const HandCard = memo(function HandCard({
  cardDef, instance, selected, blocked, blockedReason, covered,
  positionLabel, fanOverlap, onCardPress, onCardLongPress, onCardDragPlay,
}: HandCardProps) {
  const isPlayable = !blocked;
  return (
    <DraggableCard
      onDragPlay={() => onCardDragPlay(instance, isPlayable)}
      style={fanOverlap ? FAN_OVERLAP : undefined}
    >
      <CardView
        card={cardDef}
        selected={selected}
        blocked={blocked}
        blockedReason={blockedReason}
        blockedIconOnly={covered}
        positionLabel={positionLabel}
        onPress={() => onCardPress(instance, isPlayable, blockedReason)}
        onLongPress={() => onCardLongPress(instance)}
      />
    </DraggableCard>
  );
}, (a, b) =>
  a.cardDef === b.cardDef &&
  a.instance === b.instance &&
  a.mode === b.mode &&
  a.selected === b.selected &&
  a.blocked === b.blocked &&
  a.blockedReason === b.blockedReason &&
  a.covered === b.covered &&
  a.positionLabel === b.positionLabel &&
  a.fanOverlap === b.fanOverlap
);

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
  const swapStartingCards = useGameStore((s) => s.swapStartingCards);
  const toggleSwapMode = useGameStore((s) => s.toggleSwapMode);
  const toggleSwapCard = useGameStore((s) => s.toggleSwapCard);
  // Cambio de cartas iniciales (SOLO, una vez, spec §4.1): modo propio —
  // no reutilizamos evasionSelection (distinto límite). El estado vive en
  // el store: el renderer ligero de tests no soporta hooks extra.
  const swapSel = useGameStore((s) => s.ui.swapSelection);
  const swapMode = swapSel !== null;
  // srListPositions: "Carta 2 de 7" al navegar la mano con lector
  const srPositions = useSettingsSafe((s) => s.srListPositions);
  // Hooks de tema: seguros fuera de render (try/catch interno)
  const c = useColors();
  const fs = useFs();
  const styles = createStyles(c, fs);

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

  // Cambio de cartas iniciales: SOLO + fase de preparación + una sola vez
  const setupSwapAvailable = isSetupSwapAvailable(gameState, player);
  const swapActive = swapMode && setupSwapAvailable;

  const zoomedInstance = zoomedCardId ? player.hand.find((c) => c.instanceId === zoomedCardId) : undefined;
  const zoomedCard = zoomedInstance ? catalog.byId.get(zoomedInstance.definitionId) : null;

  const handleCardPress = (cardInstance: CardInstance, isPlayable: boolean, reason?: string) => {
    // En modo cambio inicial cualquier carta de la mano es elegible (máx 2)
    if (swapActive) {
      hapticSelect();
      toggleSwapCard(cardInstance.instanceId);
      return;
    }
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
    if (evasionMode || swapActive) return;
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
          {swapActive ? t('hud.swapTitle')
            : evasionMode ? t('hud.evasionTitle')
            : t('hud.handTitle', { count: player.hand.length })}
        </Text>
        {setupSwapAvailable && !evasionMode && (
          <Pressable
            style={styles.zoomButton}
            onPress={() => toggleSwapMode()}
            accessibilityRole="button"
            accessibilityLabel={t('hud.swapToggleA11y')}
          >
            <Text style={styles.buttonText}>
              {swapActive ? t('hud.cancel') : t('hud.swapToggle')}
            </Text>
          </Pressable>
        )}
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
          const isPlayable = evasionMode || swapActive ? true : playable.ok;
          const reason = !playable.ok
            ? engineReasonText(t, playable.reasonCode, playable.reason, playable.costs)
            : undefined;
          const evasionChosen = evasionSelection?.includes(cardInstance.instanceId) ?? false;
          const swapChosen = swapSel?.includes(cardInstance.instanceId) ?? false;

          return (
            <HandCard
              key={cardInstance.instanceId}
              cardDef={cardDef}
              instance={cardInstance}
              mode={swapActive ? 'swap' : evasionMode ? 'evasion' : 'normal'}
              selected={swapActive ? swapChosen : evasionMode ? evasionChosen : selectedCard === cardInstance.instanceId}
              blocked={!isPlayable}
              blockedReason={reason}
              positionLabel={srPositions ? t('cardui.a11y.posOf', {
                i: index + 1, n: player.hand.length,
              }) : undefined}
              covered={index < player.hand.length - 1}
              fanOverlap={index > 0}
              onCardPress={handleCardPress}
              onCardLongPress={handleCardLongPress}
              onCardDragPlay={handleDragPlay}
            />
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

      {swapActive && (
        <View style={styles.targetBar} accessibilityLiveRegion="polite">
          <Text style={styles.targetDesc}>
            {t('hud.swapProgress', { count: swapSel?.length ?? 0 })}
          </Text>
          <Text style={styles.targetHint}>
            {t('hud.swapHint')}
          </Text>
        </View>
      )}

      {swapActive && (
        <View style={styles.actions}>
          <Pressable
            style={styles.cancelButton}
            onPress={() => toggleSwapMode()}
            accessibilityRole="button"
            accessibilityLabel={t('hud.cancelSelectionA11y')}
          >
            <Text style={styles.buttonText}>{t('hud.cancel')}</Text>
          </Pressable>
          <Pressable
            style={[styles.playButton, (swapSel?.length ?? 0) === 0 && styles.playButtonDisabled]}
            onPress={() => {
              if (!swapSel || swapSel.length === 0) return;
              hapticPlay();
              swapStartingCards(swapSel);
            }}
            disabled={!swapSel || swapSel.length === 0}
            accessibilityRole="button"
            accessibilityLabel={t('hud.swapConfirmA11y', { count: swapSel?.length ?? 0 })}
            accessibilityState={{ disabled: !swapSel || swapSel.length === 0 }}
          >
            <Text style={[styles.buttonText, styles.playButtonText]}>
              {t('hud.swapConfirm')}
            </Text>
          </Pressable>
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
            <Text style={[styles.buttonText, styles.playButtonText]}>
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
            <Text style={[styles.buttonText, styles.playButtonText]}>
              {needsEnemy ? t('hud.playVsTarget') : t('hud.playCard')}
            </Text>
          </Pressable>
        </View>
      )}

      <CardZoom visible={!!zoomedCard} card={zoomedCard ?? null} onClose={() => onZoomCard?.(null)} />
    </View>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: c.background,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: c.text,
    fontSize: fs(14),
    fontWeight: 'bold',
  },
  selectionInfo: {
    alignItems: 'flex-end',
  },
  selectionText: {
    color: c.accent,
    fontSize: fs(13),
    fontWeight: 'bold',
  },
  hand: {
    flexDirection: 'row',
    paddingVertical: 10,
  },
  fanOverlap: FAN_OVERLAP,
  targetBar: {
    marginTop: 6,
    padding: 8,
    borderRadius: 6,
    backgroundColor: c.surfaceRaised,
  },
  targetDesc: {
    color: c.text,
    fontSize: fs(12),
    fontWeight: 'bold',
  },
  targetHint: {
    color: c.textMuted,
    fontSize: fs(11),
    marginTop: 3,
    fontStyle: 'italic',
  },
  targetOk: {
    color: c.success,
    fontSize: fs(11),
    marginTop: 3,
    fontWeight: 'bold',
  },
  targetError: {
    color: c.danger,
    fontSize: fs(11),
    marginTop: 3,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  playButton: {
    backgroundColor: c.accent,
    padding: 12,
    borderRadius: 8,
    minWidth: 120,
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonDisabled: {
    opacity: 0.45,
  },
  cancelButton: {
    backgroundColor: c.surfaceRaised,
    padding: 12,
    borderRadius: 8,
    minWidth: 100,
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomButton: {
    backgroundColor: c.surfaceRaised,
    padding: 12,
    borderRadius: 8,
    minWidth: 100,
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: c.text,
    fontSize: fs(13),
    fontWeight: 'bold',
  },
  playButtonText: {
    color: c.textOnAccent,
  },
});
