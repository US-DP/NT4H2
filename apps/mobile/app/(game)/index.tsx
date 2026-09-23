/**
 * Pantalla de partida — mesa de juego principal.
 *
 * Integra los componentes principales:
 * - GameHeader (UI-070..073): fase, turno, conexión, instrucción.
 * - PlayerPanel (UI-080..085): paneles de jugadores.
 * - Battlefield (UI-090..099): enemigos.
 * - ScenarioView (UI-150..155): escenario activo.
 * - MarketView (UI-140..146): mercado.
 * - ContextualActions (UI-120..124): acciones según fase.
 * - HandView (UI-100..108): mano del jugador.
 * - ActionHistory (UI-170..174): historial.
 * - CardZoom (UI-110..113): ampliación de carta.
 * - PrivacyScreen (UI-202..203): hot-seat.
 */

import { useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Modal, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { PlayerPanel } from '../../components/PlayerPanel';
import { Battlefield } from '../../components/Battlefield';
import { HandView } from '../../components/HandView';
import { MarketView } from '../../components/MarketView';
import { PrivacyScreen } from '../../components/PrivacyScreen';
import { PhaseIndicator } from '../../components/PhaseIndicator';
import { ConnectionStatus, type ConnectionState } from '../../components/ConnectionStatus';
import { ContextualActions, type ContextualAction } from '../../components/ContextualActions';
import { ActionHistory, type HistoryEntry } from '../../components/ActionHistory';
import { ScenarioView } from '../../components/ScenarioView';
import { PendingChoiceView } from '../../components/PendingChoiceView';
import { CardZoom } from '../../components/CardZoom';
import { ChatPanel, type ChatMessage } from '../../components/ChatPanel';
import { HeroDetail } from '../../components/HeroDetail';
import { SaveIndicator } from '../../components/SaveIndicator';
import { ExitGameDialog } from '../../components/ExitGameDialog';
import { useGameStore } from '../../store/gameStore';
import type { CardDefinition, GameEvent, GameState } from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';

export default function GameScreen() {
  const router = useRouter();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const message = useGameStore((s) => s.ui.message);
  const connectionMode = useGameStore((s) => s.connectionMode);
  const onlineRoomId = useGameStore((s) => s.online.roomId);
  const privacyScreen = useGameStore((s) => s.ui.privacyScreen);
  const endAttack = useGameStore((s) => s.endAttack);
  const endTurn = useGameStore((s) => s.endTurn);
  const heroAbility = useGameStore((s) => s.playHeroAbility);
  const sendOnlineCommand = useGameStore((s) => s.sendOnlineCommand);
  const saveGame = useGameStore((s) => s.saveGame);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [zoomCard, setZoomCard] = useState<CardDefinition | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [detailHeroId, setDetailHeroId] = useState<string | null>(null);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);

  // Estado de conexión: LOCAL en modo local, SYNCED en online
  const connectionState: ConnectionState = connectionMode === 'online' ? 'CONNECTED' : 'LOCAL';

  // Al salir de la pantalla de partida: cerrar la conexión online
  // (heartbeat + reconnect + socket) — sin esto seguían vivos de fondo
  const disconnectOnline = useGameStore((s) => s.disconnectOnline);
  useEffect(() => {
    return () => {
      if (useGameStore.getState().connectionMode === 'online') {
        disconnectOnline();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suscripción a mensajes del WebSocket (chat y comandos remotos).
  // Dependemos de online.socket: tras una reconexión el socket cambia y el
  // listener debe re-vincularse al nuevo (si no, el chat muere en silencio).
  const onlineSocket = useGameStore((s) => s.online.socket);
  useEffect(() => {
    if (connectionMode !== 'online' || !onlineSocket) return;
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'chat.message') {
          // Dedupe: el propio mensaje ya se añadió localmente al enviar
          const me = useGameStore.getState().online.playerId;
          if (msg.sender === me) return;
          setChatMessages((prev) => [
            ...prev,
            {
              id: `chat-remote-${Date.now()}`,
              sender: msg.sender,
              text: msg.text,
              type: 'USER',
              timestamp: msg.timestamp ?? Date.now(),
            },
          ]);
        }
      } catch {
        // ignore
      }
    };
    onlineSocket.addEventListener('message', handler);
    return () => onlineSocket.removeEventListener('message', handler);
  }, [connectionMode, onlineSocket]);

  // D418: historial real derivado del eventLog del motor (UI-170..174)
  const historyEntries: HistoryEntry[] = buildHistoryEntries(gameState?.eventLog ?? [], catalog);

  const handleCloseZoom = useCallback(() => setZoomCard(null), []);

  const handleSendChat = useCallback((text: string) => {
    // D417: en online el remitente es el jugador local, no el activo
    const sender = connectionMode === 'online'
      ? (useGameStore.getState().online.playerId ?? 'Jugador')
      : (gameState?.players[gameState.activePlayerId]?.playerId ?? 'Jugador');
    const msg: ChatMessage = {
      id: `chat-${Date.now()}`,
      sender,
      text,
      type: 'USER',
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, msg]);
    setChatDraft('');
    // En modo online, enviar por WebSocket
    if (connectionMode === 'online') {
      const socket = useGameStore.getState().online.socket;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'chat.message', sender, text, timestamp: msg.timestamp }));
      }
    }
  }, [gameState, connectionMode]);

  const handleSaveGame = useCallback(() => {
    setSaveState('saving');
    try {
      saveGame(saveName);
      setLastSavedAt(Date.now());
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [saveGame, saveName]);

  // Wrapper que decide entre acción local o envío online
  const runAction = useCallback(
    (localFn: () => void, onlineCmd?: () => Parameters<typeof sendOnlineCommand>[0]) => {
      if (connectionMode === 'online' && onlineCmd) {
        sendOnlineCommand(onlineCmd());
      } else {
        localFn();
      }
    },
    [connectionMode, sendOnlineCommand],
  );

  const handleEndAttack = useCallback(
    () => runAction(endAttack, () => ({ type: 'END_ATTACK' as const })),
    [runAction, endAttack],
  );
  const handleEndTurn = useCallback(
    () => runAction(endTurn, () => ({ type: 'END_TURN' as const })),
    [runAction, endTurn],
  );
  const handleUseHeroAbility = useCallback(
    (targetId?: string) =>
      runAction(
        () => heroAbility(targetId),
        () => ({ type: 'USE_HERO_ABILITY' as const, targetId }),
      ),
    [runAction, heroAbility],
  );

  const handleSaveAndExit = useCallback(() => {
    handleSaveGame();
    setShowExitDialog(false);
    router.push('/');
  }, [handleSaveGame, router]);

  if (!gameState) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No hay partida activa</Text>
        <Pressable style={styles.emptyButton} onPress={() => router.push('/')}>
          <Text style={styles.emptyButtonText}>Volver al inicio</Text>
        </Pressable>
      </View>
    );
  }

  if (privacyScreen) {
    return <PrivacyScreen />;
  }

  if (gameState.phase === 'FINISHED') {
    return <FinishedScreen />;
  }

  const activePlayer = gameState.players[gameState.activePlayerId];
  const canUseAbility = activePlayer && activePlayer.heroUsesRemaining > 0;

  // Construir acciones contextuales según fase (UI-120)
  const contextualActions: ContextualAction[] = buildContextualActions(
    gameState.phase,
    {
      endAttack: handleEndAttack,
      endTurn: handleEndTurn,
      useHeroAbility: handleUseHeroAbility,
      canUseAbility,
    },
  );

  // Instrucción concreta (UI-073)
  const instruction = buildInstruction(gameState.phase);

  return (
    <ScrollView style={styles.container}>
      {/* Cabecera (UI-070..073) */}
      <View style={styles.header}>
        <PhaseIndicator phase={gameState.phase} turnNumber={gameState.turnNumber} />
        <ConnectionStatus state={connectionState} />
        {instruction && (
          <Text style={styles.instruction} accessibilityRole="alert">
            {instruction}
          </Text>
        )}
      </View>

      {connectionMode === 'online' && onlineRoomId && (
        <View style={styles.onlineBadge}>
          <Text style={styles.onlineText}>Sala online: {onlineRoomId}</Text>
        </View>
      )}

      <PlayerPanel onSelectHero={setDetailHeroId} />

      {message && (
        <View style={styles.messageBar}>
          <Text style={styles.messageText}>{message}</Text>
        </View>
      )}

      <Battlefield />

      <ScenarioView />

      {/* D427: elecciones pendientes del viewer (puja de Líder, reacciones, etc.) */}
      <PendingChoiceView />

      <MarketView />

      {/* Acciones contextuales (UI-120..124) */}
      <ContextualActions actions={contextualActions} />

      {/* Acciones secundarias */}
      <View style={styles.secondaryActions}>
        <Pressable style={styles.saveButton} onPress={() => setShowSaveModal(true)}>
          <Text style={styles.actionText}>Guardar</Text>
        </Pressable>
        <Pressable style={styles.chatButton} onPress={() => setShowChat((v) => !v)}>
          <Text style={styles.actionText}>Chat {showChat ? '▾' : '▸'}</Text>
        </Pressable>
        <Pressable style={styles.menuButton} onPress={() => setShowExitDialog(true)}>
          <Text style={styles.actionText}>Menú</Text>
        </Pressable>
      </View>

      {showChat && (
        <ChatPanel
          messages={chatMessages}
          currentUser={activePlayer?.playerId ?? 'Jugador'}
          onSend={handleSendChat}
          draftText={chatDraft}
          onDraftChange={setChatDraft}
          onClose={() => setShowChat(false)}
        />
      )}

      <HandView />

      {/* Historial (UI-170..174) */}
      <ActionHistory entries={historyEntries} currentTurn={gameState.turnNumber} />

      <SaveIndicator state={saveState} lastSavedAt={lastSavedAt} />

      {/* Modal de guardado */}
      <Modal visible={showSaveModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Guardar partida</Text>
            <TextInput
              style={styles.modalInput}
              value={saveName}
              onChangeText={setSaveName}
              placeholder="Nombre de la partida"
              placeholderTextColor="#777"
              accessibilityLabel="Nombre de la partida"
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setShowSaveModal(false);
                  setSaveName('');
                }}
              >
                <Text style={styles.modalButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalButtonOk]}
                onPress={() => {
                  handleSaveGame();
                  setShowSaveModal(false);
                  setSaveName('');
                }}
              >
                <Text style={styles.modalButtonText}>Guardar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* HeroDetail (UI-084..085) */}
      <HeroDetail
        visible={detailHeroId !== null}
        hero={detailHeroId ? (catalog?.byId.get(detailHeroId) ?? null) : null}
        usesRemaining={
          detailHeroId ? gameState.players[gameState.activePlayerId]?.heroUsesRemaining : undefined
        }
        onClose={() => setDetailHeroId(null)}
      />

      {/* CardZoom (UI-110..113) */}
      <CardZoom visible={zoomCard !== null} card={zoomCard} onClose={handleCloseZoom} />

      {/* ExitGameDialog (UI-024) */}
      <ExitGameDialog
        visible={showExitDialog}
        hasUnsavedChanges={true}
        onSaveAndExit={handleSaveAndExit}
        onExitWithoutSaving={() => {
          setShowExitDialog(false);
          router.push('/');
        }}
        onAbandon={() => {
          setShowExitDialog(false);
          router.push('/');
        }}
        onCancel={() => setShowExitDialog(false)}
      />
    </ScrollView>
  );
}

/** Construye las acciones contextuales según la fase (UI-120). */
function buildContextualActions(
  phase: string,
  handlers: {
    endAttack: () => void;
    endTurn: () => void;
    useHeroAbility: () => void;
    canUseAbility: boolean;
  },
): ContextualAction[] {
  switch (phase) {
    case 'PLAYER_ATTACK':
      return [
        { id: 'end-attack', label: 'Finalizar ataque', icon: '⚔', onPress: handlers.endAttack, primary: true },
        {
          id: 'use-ability',
          label: 'Usar poder',
          icon: '✨',
          onPress: handlers.useHeroAbility,
          disabled: !handlers.canUseAbility,
          disabledReason: handlers.canUseAbility ? undefined : 'Pericia agotada',
        },
      ];
    case 'MARKET':
      return [
        { id: 'end-market', label: 'Finalizar Mercado', icon: '💰', onPress: handlers.endTurn, primary: true },
      ];
    case 'RESTORATION':
      return [
        { id: 'confirm-restore', label: 'Confirmar', icon: '✓', onPress: handlers.endTurn, primary: true },
      ];
    default:
      return [];
  }
}

/** Construye la instrucción concreta según la fase (UI-073). */
function buildInstruction(phase: string): string | null {
  switch (phase) {
    case 'PLAYER_ATTACK':
      return 'Selecciona una carta de tu mano para jugarla, o finaliza el ataque.';
    case 'MARKET':
      return 'Compra objetos del Mercado o finaliza la fase.';
    case 'RESTORATION':
      return 'Ajusta tu mano a 4 cartas y confirma para terminar el turno.';
    case 'HORDE_ATTACK':
      return 'La Horda ataca. Revisa el resumen de daño.';
    case 'LEADER_CHOICE':
      return 'Elige cartas para la puja de Líder.';
    default:
      return null;
  }
}

/** Pantalla final (UI-210..212). */
function FinishedScreen() {
  const gameState = useGameStore((s) => s.gameState);
  const router = useRouter();

  if (!gameState) return null;

  const players = Object.values(gameState.players);
  const sorted = [...players].sort((a, b) => b.glory - a.glory);
  const winner = sorted[0];
  const isTie = sorted.length > 1 && sorted[0].glory === sorted[1].glory;

  return (
    <ScrollView style={styles.finishedContainer} contentContainerStyle={styles.finishedContent}>
      <Text style={styles.finishedTitle}>Partida Finalizada</Text>

      {isTie ? (
        <Text style={styles.tieText}>
          Empate a {winner.glory} de Gloria entre {sorted.filter((p) => p.glory === winner.glory).map((p) => p.heroId).join(' y ')}.
        </Text>
      ) : (
        <Text style={styles.winnerText}>
          Ganador: {winner?.heroId} con {winner?.glory} de Gloria
        </Text>
      )}

      <View style={styles.rankings}>
        {sorted.map((p, i) => (
          <View key={p.playerId} style={styles.rankingRow}>
            <Text style={styles.rankPosition}>{i + 1}.</Text>
            <Text style={styles.rankName}>{p.heroId}</Text>
            <Text style={styles.rankGlory}>{p.glory} Gloria</Text>
            <Text style={styles.rankTrophies}>{p.trophies.length} trofeos</Text>
          </View>
        ))}
      </View>

      <View style={styles.finishedActions}>
        <Pressable style={styles.finishedButton} onPress={() => router.push('/')}>
          <Text style={styles.finishedButtonText}>Volver al inicio</Text>
        </Pressable>
        <Pressable style={styles.finishedButtonSecondary} onPress={() => router.push('/')}>
          <Text style={styles.finishedButtonText}>Jugar de nuevo</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyText: {
    color: '#bdc3c7',
    fontSize: 16,
    marginBottom: 16,
  },
  emptyButton: {
    backgroundColor: '#2980b9',
    padding: 12,
    borderRadius: 8,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  header: {
    backgroundColor: '#0f0f23',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  instruction: {
    color: '#f1c40f',
    fontSize: 13,
    textAlign: 'center',
    padding: 6,
    fontStyle: 'italic',
  },
  messageBar: {
    backgroundColor: '#2c3e50',
    padding: 8,
    margin: 4,
    borderRadius: 4,
  },
  messageText: {
    color: '#ecf0f1',
    fontSize: 12,
  },
  onlineBadge: {
    backgroundColor: '#2980b9',
    padding: 6,
    margin: 4,
    borderRadius: 4,
    alignItems: 'center',
  },
  onlineText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  secondaryActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    padding: 8,
  },
  saveButton: {
    backgroundColor: '#27ae60',
    padding: 10,
    borderRadius: 6,
  },
  chatButton: {
    backgroundColor: '#2980b9',
    padding: 10,
    borderRadius: 6,
  },
  menuButton: {
    backgroundColor: '#555',
    padding: 10,
    borderRadius: 6,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    padding: 20,
    borderRadius: 12,
    width: '80%',
    maxWidth: 400,
  },
  modalTitle: {
    color: '#f1c40f',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#2c3e50',
    color: '#ecf0f1',
    padding: 10,
    borderRadius: 6,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  modalButton: {
    padding: 10,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#555',
  },
  modalButtonOk: {
    backgroundColor: '#27ae60',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  finishedContainer: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  finishedContent: {
    alignItems: 'center',
    padding: 20,
  },
  finishedTitle: {
    color: '#f1c40f',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
    marginTop: 20,
  },
  winnerText: {
    color: '#27ae60',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  tieText: {
    color: '#f39c12',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  rankings: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 24,
  },
  rankingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
  },
  rankPosition: {
    color: '#f1c40f',
    fontSize: 16,
    fontWeight: 'bold',
    width: 30,
  },
  rankName: {
    color: '#ecf0f1',
    fontSize: 14,
    flex: 1,
  },
  rankGlory: {
    color: '#3498db',
    fontSize: 14,
    fontWeight: 'bold',
  },
  rankTrophies: {
    color: '#bdc3c7',
    fontSize: 11,
    marginLeft: 8,
  },
  finishedActions: {
    flexDirection: 'row',
    gap: 12,
  },
  finishedButton: {
    backgroundColor: '#2980b9',
    padding: 14,
    borderRadius: 8,
    minWidth: 150,
    alignItems: 'center',
  },
  finishedButtonSecondary: {
    backgroundColor: '#27ae60',
    padding: 14,
    borderRadius: 8,
    minWidth: 150,
    alignItems: 'center',
  },
  finishedButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});

// ============================================================================
// Historial de acciones — mapea eventos del motor a HistoryEntry (UI-170..174)
// ============================================================================

const PHASE_LABELS: Record<string, string> = {
  SETUP: 'Preparación',
  INITIAL_PLAYER_SELECTION: 'Selección de líder',
  ATTACK_CHOICE: 'Elección de ataque',
  PLAYER_ATTACK: 'Ataque del héroe',
  HORDE_ATTACK: 'Ataque de la Horda',
  MARKET: 'Mercado',
  RESTORATION: 'Restablecimiento',
  FINISHED: 'Finalizada',
};

function cardName(catalog: CatalogLoadResult | null, definitionId: string | undefined): string {
  if (!definitionId) return '—';
  return catalog?.byId.get(definitionId)?.name ?? definitionId;
}

function buildHistoryEntries(
  events: GameEvent[],
  catalog: CatalogLoadResult | null,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let turn = 1;
  const turnStartIdx = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const entry = eventToHistoryEntry(e, turn, catalog);
    if (entry) entries.push(entry);
    if (e.type === 'TURN_STARTED') turn = e.turnNumber;
    void turnStartIdx;
  }
  return entries;
}

function eventToHistoryEntry(
  e: GameEvent,
  turn: number,
  catalog: CatalogLoadResult | null,
): HistoryEntry | null {
  const base = { id: `ev-${e.seq}`, turn, timestamp: e.seq };
  const actor = (pid: string | undefined) => pid ?? '—';
  const card = (defId: string | undefined) => cardName(catalog, defId);
  const hero = (pid: string | undefined, state: GameState | null) =>
    pid ? (state?.players[pid]?.heroId ?? pid) : '—';
  void hero;

  switch (e.type) {
    case 'TURN_STARTED':
      return { ...base, actor: actor(e.playerId), action: 'Turno iniciado', result: `Turno ${e.turnNumber}` };
    case 'TURN_ENDED':
      return { ...base, actor: actor(e.playerId), action: 'Turno terminado', result: '—' };
    case 'CARD_PLAYED':
      return {
        ...base,
        actor: actor(e.playerId),
        action: 'Carta jugada',
        card: e.cardName ?? card(e.cardDefinitionId),
        target: e.targetEnemyInstanceId,
        result: e.cardName ?? card(e.cardDefinitionId),
      };
    case 'DAMAGE_DEALT':
      return { ...base, actor: '—', action: 'Daño infligido', target: e.targetId, result: `${e.amount} daño` };
    case 'ENEMY_DEFEATED':
      return {
        ...base,
        actor: actor(e.defeatingPlayerId),
        action: 'Enemigo derrotado',
        card: card(e.enemyDefinitionId),
        result: `+${e.reward.glory} Gloria, +${e.reward.coins} Monedas`,
      };
    case 'HORDE_ATTACKED':
      return { ...base, actor: actor(e.playerId), action: 'Ataque de la Horda', result: `${e.totalDamage} daño` };
    case 'EVASION_PERFORMED':
      return {
        ...base,
        actor: actor(e.playerId),
        action: 'Evasión',
        result: `Descartó ${e.discardedCardInstanceIds.length} cartas`,
      };
    case 'CARDS_DRAWN':
      return { ...base, actor: actor(e.playerId), action: 'Robo de cartas', result: `${e.count} cartas` };
    case 'CARDS_LOST':
      return { ...base, actor: actor(e.playerId), action: 'Pierde cartas', result: `${e.count} cartas` };
    case 'CARDS_RECOVERED':
      return { ...base, actor: actor(e.playerId), action: 'Recupera cartas', result: `${e.count} cartas` };
    case 'GLORY_GAINED':
      return { ...base, actor: actor(e.playerId), action: 'Gloria ganada', result: `+${e.amount}` };
    case 'GLORY_LOST':
      return { ...base, actor: actor(e.playerId), action: 'Gloria perdida', result: `-${e.amount}` };
    case 'COINS_GAINED':
      return { ...base, actor: actor(e.playerId), action: 'Monedas', result: `${e.amount >= 0 ? '+' : ''}${e.amount}` };
    case 'COINS_STOLEN':
      return { ...base, actor: actor(e.fromPlayerId), action: 'Robo de monedas', target: e.toPlayerId, result: `${e.amount}` };
    case 'WOUND_HEALED':
      return { ...base, actor: actor(e.playerId), action: 'Curación', result: `-${e.amount} heridas` };
    case 'MARKET_PURCHASED':
      return {
        ...base,
        actor: actor(e.playerId),
        action: 'Compra en Mercado',
        card: card(e.cardInstanceId),
        result: `${e.cost} monedas`,
      };
    case 'MARKET_REPLENISHED':
      return { ...base, actor: 'Mercado', action: 'Reposición', result: '—' };
    case 'ENEMY_REVEALED':
      return {
        ...base,
        actor: 'Horda',
        action: 'Enemigo revelado',
        card: card(e.definitionId),
        result: `Fortaleza ${e.fortitude}`,
      };
    case 'WARLORD_REVEALED':
      return {
        ...base,
        actor: 'Horda',
        action: '¡Señor de la Guerra!',
        card: card(e.definitionId),
        result: 'Jefe final en juego',
      };
    case 'SCENARIO_REVEALED':
      return { ...base, actor: 'Escenario', action: 'Escenario revelado', card: card(e.definitionId), result: '—' };
    case 'SCENARIO_DISCARDED':
      return { ...base, actor: 'Escenario', action: 'Escenario descartado', result: '—' };
    case 'PHASE_CHANGED':
      return { ...base, actor: 'Sistema', action: 'Fase', result: PHASE_LABELS[e.phase] ?? e.phase };
    case 'HERO_ABILITY_USED':
      return { ...base, actor: actor(e.playerId), action: 'Pericia usada', result: `${e.usesRemaining} usos restantes` };
    case 'GAME_ENDED':
      return { ...base, actor: 'Sistema', action: 'Partida finalizada', result: e.winnerId ? `Ganador: ${e.winnerId}` : 'Derrota colectiva' };
    case 'LEADER_DETERMINED':
      return { ...base, actor: actor(e.playerId), action: 'Líder elegido', result: '—' };
    case 'DECK_EXHAUSTED':
      return { ...base, actor: actor(e.playerId), action: 'Mazo agotado', result: 'Herida + reciclar' };
    case 'DECK_RESHUFFLED':
      return { ...base, actor: actor(e.playerId), action: 'Mazo barajado', result: `${e.newDeckSize} cartas` };
    case 'SHIELD_PLACED':
      return { ...base, actor: actor(e.playerId), action: 'Escudo', result: `+${e.amount}` };
    case 'PREVENTION_APPLIED':
      return { ...base, actor: actor(e.playerId), action: 'Prevención', result: `-${e.amount} daño` };
    case 'DAMAGE_INTERCEPTED':
      return {
        ...base,
        actor: actor(e.interceptorPlayerId),
        action: 'Intercepta daño',
        target: e.originalTargetPlayerId,
        result: `${e.amount} daño`,
      };
    case 'ENEMY_RETURNED_TO_HORDE':
      return { ...base, actor: 'Sistema', action: 'Enemigo devuelto a la Horda', result: '—' };
    case 'ENEMY_SWAPPED':
      return {
        ...base,
        actor: 'Sistema',
        action: 'Enemigo cambiado',
        card: card(e.newEnemyDefinitionId),
        result: `Fortaleza ${e.newEnemyFortitude}`,
      };
    case 'VULNERABILITY_APPLIED':
      return { ...base, actor: 'Sistema', action: 'Vulnerabilidad', target: e.enemyInstanceId, result: `+${e.bonus} daño` };
    case 'HERO_WOUNDED':
      return { ...base, actor: actor(e.playerId), action: 'Herida de héroe', result: `${e.woundCount} heridas` };
    case 'CANCELLATION_ACTIVATED':
      return { ...base, actor: actor(e.playerId), action: 'Anulación de daño', result: '—' };
    case 'PERSISTENT_CARD_PLACED':
      return { ...base, actor: actor(e.playerId), action: 'Carta persistente', card: card(e.cardDefinitionId), result: e.trigger };
    case 'PERSISTENT_CARD_REMOVED':
      return { ...base, actor: 'Sistema', action: 'Persistente retirada', result: '—' };
    case 'ENEMY_DAMAGE_DISABLED':
      return { ...base, actor: 'Sistema', action: 'Daño enemigo anulado', target: e.enemyInstanceId, result: '—' };
    case 'MODIFIER_ADDED':
      return { ...base, actor: 'Sistema', action: 'Modificador añadido', target: e.targetId, result: e.layer };
    case 'MODIFIER_EXPIRED':
      return { ...base, actor: 'Sistema', action: 'Modificador expirado', result: e.modifierId };
    case 'CARD_MOVED':
      return { ...base, actor: 'Sistema', action: 'Carta movida', result: `${e.from} → ${e.to}` };
    case 'CARD_REMOVED_FROM_GAME':
      return { ...base, actor: 'Sistema', action: 'Carta retirada del juego', result: '—' };
    case 'CARDS_REVEALED_TO_PLAYER':
      return { ...base, actor: actor(e.playerId), action: 'Cartas reveladas', result: `${e.cardInstanceIds.length} cartas` };
    default:
      return null;
  }
}
