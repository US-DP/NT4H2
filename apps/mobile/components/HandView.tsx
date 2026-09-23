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
 */

import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { CardView } from './CardView';
import { CardZoom } from './CardZoom';
import { useGameStore } from '../store/gameStore';
import type { CardInstance } from '@nt4h/schema';

interface HandViewProps {
  /** Máximo de objetivos que requiere la carta seleccionada */
  requiredTargets?: number;
  /** Carta a ampliar (controlado por el padre) */
  zoomedCardId?: string | null;
  onZoomCard?: (cardInstanceId: string | null) => void;
}

export function HandView({
  requiredTargets = 1,
  zoomedCardId,
  onZoomCard,
}: HandViewProps) {
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const selectedCard = useGameStore((s) => s.ui.selectedCardInstanceId);
  const selectCard = useGameStore((s) => s.selectCard);
  const playCard = useGameStore((s) => s.playCard);
  const checkCardPlayable = useGameStore((s) => s.checkCardPlayable);
  const viewerId = useGameStore((s) => s.viewerId);

  if (!gameState || !catalog) return null;

  // D421: mostrar la mano del viewer (en online es online.playerId;
  // en hot-seat coincide con activePlayerId tras la pantalla de privacidad)
  const playerId = viewerId ?? gameState.activePlayerId;
  const player = gameState.players[playerId];
  if (!player) return null;

  const selectedCount = selectedCard ? 1 : 0;
  const zoomedInstance = zoomedCardId ? player.hand.find((c) => c.instanceId === zoomedCardId) : undefined;
  const zoomedCard = zoomedInstance ? catalog.byId.get(zoomedInstance.definitionId) : null;

  const handleCardPress = (cardInstance: CardInstance, isPlayable: boolean, reason?: string) => {
    if (!isPlayable) {
      if (reason) selectCard(null);
      return;
    }

    if (selectedCard === cardInstance.instanceId) {
      selectCard(null);
      return;
    }

    selectCard(cardInstance.instanceId);
  };

  const handleCardLongPress = (cardInstance: CardInstance) => {
    onZoomCard?.(cardInstance.instanceId);
  };

  const handleConfirm = () => {
    if (selectedCard) {
      playCard(selectedCard);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mano ({player.hand.length})</Text>
        {selectedCard && (
          <View style={styles.selectionInfo}>
            <Text style={styles.selectionText}>
              {catalog.byId.get(player.hand.find((c) => c.instanceId === selectedCard)?.definitionId ?? '')?.name ?? 'Carta'}
            </Text>
            {requiredTargets > 1 && (
              <Text style={styles.targetProgress}>
                Objetivos seleccionados: {selectedCount} de {requiredTargets}
              </Text>
            )}
          </View>
        )}
      </View>

      <ScrollView horizontal style={styles.hand}>
        {player.hand.map((cardInstance: CardInstance) => {
          const cardDef = catalog.byId.get(cardInstance.definitionId);
          if (!cardDef) return null;

          const playable = checkCardPlayable?.(cardInstance.instanceId) ?? { ok: true };
          const isPlayable = playable.ok;
          const reason = !playable.ok ? playable.reason : undefined;

          return (
            <CardView
              key={cardInstance.instanceId}
              card={cardDef}
              selected={selectedCard === cardInstance.instanceId}
              blocked={!isPlayable}
              blockedReason={reason}
              onPress={() => handleCardPress(cardInstance, isPlayable, reason)}
              onLongPress={() => handleCardLongPress(cardInstance)}
              targetProgress={selectedCard === cardInstance.instanceId ? `${selectedCount}/${requiredTargets}` : undefined}
            />
          );
        })}
      </ScrollView>

      {selectedCard && (
        <View style={styles.actions}>
          <Pressable style={styles.cancelButton} onPress={() => selectCard(null)}>
            <Text style={styles.buttonText}>Cancelar</Text>
          </Pressable>
          <Pressable
            style={styles.playButton}
            onPress={handleConfirm}
            disabled={requiredTargets > selectedCount}
          >
            <Text style={styles.buttonText}>
              {requiredTargets > 1 ? 'Confirmar objetivos' : 'Jugar carta'}
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
  targetProgress: {
    color: '#bdc3c7',
    fontSize: 11,
  },
  hand: {
    flexDirection: 'row',
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
  cancelButton: {
    backgroundColor: '#555',
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
