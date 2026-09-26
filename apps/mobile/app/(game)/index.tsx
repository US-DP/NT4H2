/**
 * Pantalla de partida â€” mesa de juego principal.
 *
 * Integra los componentes principales:
 * - GameHeader (UI-070..073): fase, turno, conexiÃ³n, instrucciÃ³n.
 * - PlayerPanel (UI-080..085): paneles de jugadores.
 * - Battlefield (UI-090..099): enemigos.
 * - ScenarioView (UI-150..155): escenario activo.
 * - MarketView (UI-140..146): mercado.
 * - ContextualActions (UI-120..124): acciones segÃºn fase.
 * - HandView (UI-100..108): mano del jugador.
 * - ActionHistory (UI-170..174): historial.
 * - CardZoom (UI-110..113): ampliaciÃ³n de carta.
 * - PrivacyScreen (UI-202..203): hot-seat.
 */

import { useState, useCallback, useEffect, useRef, type ReactNode, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Clipboard from 'expo-clipboard';
import { ErrorBoundary } from 'react-error-boundary';
import ConfettiCannon from 'react-native-confetti-cannon';
import { captureError } from '../../lib/monitoring';
import { PlayerPanel } from '../../components/PlayerPanel';
import { PlayersSidebar } from '../../components/PlayersSidebar';
import { HordePanel } from '../../components/HordePanel';
import { DeckPanel } from '../../components/DeckPanel';
import { Battlefield } from '../../components/Battlefield';
import { HandView } from '../../components/HandView';
import { MarketView } from '../../components/MarketView';
import { PrivacyScreen } from '../../components/PrivacyScreen';
import { PHASE_LABELS } from '../../lib/phaseLabels';
import { GameHeader } from '../../components/game/GameHeader';
import { ContextBanner } from '../../components/game/ContextBanner';
import type { ConnectionState } from '../../components/ConnectionStatus';
import { ContextualActions, type ContextualAction } from '../../components/ContextualActions';
import { ActionHistory, type HistoryEntry, type HistoryFilter } from '../../components/ActionHistory';
import { ScenarioView } from '../../components/ScenarioView';
import { PendingChoiceView } from '../../components/PendingChoiceView';
import { GameStatusPanel } from '../../components/GameStatusPanel';
import { notifyYourTurn } from '../../lib/turnNotify';
import { API_BASE, fetchWithTimeout } from '../../lib/config';
import { toast } from '../../lib/toast';
import { ChatPanel, type ChatMessage } from '../../components/ChatPanel';
import { SaveGameModal } from '../../components/SaveGameModal';
import { HordeAttackSummary, type EnemyContribution } from '../../components/HordeAttackSummary';
import { HeroDetail } from '../../components/HeroDetail';
import { SaveIndicator } from '../../components/SaveIndicator';
import { ExitGameDialog } from '../../components/ExitGameDialog';
import { HeroStatusBar } from '../../components/HeroStatusBar';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { Button } from '../../components/ui/Button';
import { useColors } from '../../lib/useTheme';
import { useGameShortcuts } from '../../lib/useGameShortcuts';
import { colors, spacing, type Colors } from '../../lib/theme';
import type { GameEvent, GameState } from '@nt4h/schema';
import { computeFinalScore, computeHordeAttackBreakdown } from '@nt4h/engine';
import { recordFinishedGame, configUsedCustom, loadHistory } from '../../lib/gameHistory';
import { evaluateAchievements, newlyUnlocked, type Achievement } from '../../lib/achievements';
import { reportIfOptedIn, reportLeaderboardResult } from '../../lib/communityStats';
import type { CatalogLoadResult } from '@nt4h/catalog';
import { Swords, Hand, Coins, Info, ScrollText , Trophy } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

/** PestaÃ±as del layout estrecho (mÃ³vil) */
type MobileTab = 'combat' | 'hand' | 'market' | 'status' | 'log';

// Etiquetas cortas: caben en barra mÃ³vil incluso con texto ampliado.
// A fontScale >= 1.5 solo la pestaÃ±a activa conserva el texto visible
// (el resto sigue accesible vÃ­a accessibilityLabel).
const MOBILE_TABS: { id: MobileTab; labelKey: string; Icon: typeof Swords }[] = [
  { id: 'combat', labelKey: 'gm.tabCombat', Icon: Swords },
  { id: 'hand', labelKey: 'gm.tabHand', Icon: Hand },
  { id: 'market', labelKey: 'gm.tabMarket', Icon: Coins },
  { id: 'status', labelKey: 'gm.tabStatus', Icon: Info },
  { id: 'log', labelKey: 'gm.tabLog', Icon: ScrollText },
];

function GameScreenInner() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  // En nativo: pantalla encendida durante la partida y mesa en horizontal.
  // En web se omite (Wake Lock API exige gesto de usuario â†’ error).
  const gameOrientation = useSettings((s) => s.gameOrientation);
  const shortcutsEnabled = useSettings((s) => s.shortcutsEnabled);
  const initialConfig = useGameStore((s) => s.initialConfig);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void activateKeepAwakeAsync('nt4h-game');
    if (gameOrientation === 'landscape') {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } else if (gameOrientation === 'portrait') {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    }
    return () => {
      deactivateKeepAwake('nt4h-game');
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, [gameOrientation]);
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);

  // Historial: registrar la partida cuando llega a FINISHED (una vez por
  // id; recordFinishedGame es idempotente). Ademas, diff de logros
  // antes/despues para el toast de desbloqueo.
  const historyRecorded = useRef(false);
  const finishedPhase = gameState?.phase === 'FINISHED';
  const [newAchievements, setNewAchievements] = useState<Achievement[]>([]);
  useEffect(() => {
    if (!finishedPhase || !gameState || historyRecorded.current) return;
    historyRecorded.current = true;
    const scores = computeFinalScore(gameState.players);
    const { winners } = scores;
    const viewerPid = useGameStore.getState().viewerId ?? gameState.activePlayerId;
    const myScore = scores.players.find((sc) => sc.playerId === viewerPid);
    const entry = {
      id: `h-${viewerPid}-${Date.now()}`,
      endedAt: Date.now(),
      mode: gameState.mode ?? 'STANDARD',
      playerCount: Object.keys(gameState.players).length,
      winners: winners.map((w) => w.heroId),
      topScore: winners[0]?.total ?? 0,
      contentScope: (configUsedCustom(initialConfig) ? 'custom' : 'official') as 'official' | 'custom',
      heroesPlayed: (gameState.playerOrder ?? Object.keys(gameState.players))
        .map((pid) => gameState.players[pid]?.heroId)
        .filter((h): h is string => Boolean(h)),
      scenariosCount: initialConfig?.scenarioIds?.length ?? 0,
      flawless: winners.some((w) => w.tenaz === 1),
      myHeroId: gameState.players[viewerPid]?.heroId,
      yourScore: myScore?.total,
      won: winners.some((w) => w.playerId === viewerPid),
      warlordsDefeated: gameState.warlordsDefeatedCount ?? 0,
      turnsTaken: gameState.turnNumber ?? 0,
      online: useGameStore.getState().connectionMode === 'online',
      marketBuys: gameState.eventLog.filter(
        (ev) => ev.type === 'MARKET_PURCHASED' && ev.playerId === viewerPid).length,
      enemiesDefeated: gameState.eventLog.filter(
        (ev) => ev.type === 'ENEMY_DEFEATED' && ev.defeatingPlayerId === viewerPid).length,
      warlordsByMe: gameState.eventLog.filter(
        (ev) => ev.type === 'ENEMY_DEFEATED' && ev.defeatingPlayerId === viewerPid
          && useGameStore.getState().catalog?.byId.get(ev.enemyDefinitionId)?.type === 'WARLORD').length,
      coinsEnd: gameState.players[viewerPid]?.coins ?? 0,
      woundsEnd: gameState.players[viewerPid]?.wounds ?? 0,
    };
    void (async () => {
      const prev = await loadHistory();
      const before = evaluateAchievements(prev);
      await recordFinishedGame(entry);
      const after = evaluateAchievements([entry, ...prev]);
      setNewAchievements(newlyUnlocked(before, after));
      // EstadÃ­sticas de comunidad (anÃ³nimas; no-op si el usuario no optÃ³)
      void reportIfOptedIn();
      // ClasificaciÃ³n pÃºblica (opt-in; NT4H es cooperativo â†’ won = victoria del equipo)
      void reportLeaderboardResult(entry.won);
    })();
  }, [finishedPhase, gameState, initialConfig]);
  useEffect(() => {
    // Nueva partida â†’ permitir registrar de nuevo
    if (!finishedPhase) {
      historyRecorded.current = false;
      setNewAchievements([]);
    }
  }, [finishedPhase]);
  const message = useGameStore((s) => s.ui.message);
  const connectionMode = useGameStore((s) => s.connectionMode);
  const canUndo = useGameStore(
    (s) => s.undoBase !== null && s.initialCommands.length > 0,
  );
  const undoLastCommand = useGameStore((s) => s.undoLastCommand);
  const onlineRoomId = useGameStore((s) => s.online.roomId);
  const privacyScreen = useGameStore((s) => s.ui.privacyScreen);
  const endTurn = useGameStore((s) => s.endTurn);
  const heroAbility = useGameStore((s) => s.playHeroAbility);
  const endAttack = useGameStore((s) => s.endAttack);
  const sendOnlineCommand = useGameStore((s) => s.sendOnlineCommand);
  const saveGame = useGameStore((s) => s.saveGame);
  const mutedChatSenders = useGameStore((s) => s.mutedChatSenders);
  const toggleMuteChatSender = useGameStore((s) => s.toggleMuteChatSender);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [zoomCardId, setZoomCardId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'history' | 'chat' | 'status'>('history');
  const [unreadChat, setUnreadChat] = useState(0);
  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [detailHeroId, setDetailHeroId] = useState<string | null>(null);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [historyPlayer, setHistoryPlayer] = useState<string | null>(null);
  const [historyAdvanced, setHistoryAdvanced] = useState(false);
  // Resumen del ataque de la Horda: se muestra una vez por entrada en la
  // fase; al salir de ella se rearma para el siguiente asalto
  // Resumen de la Horda: una vez por asalto, identificado por el evento
  // HORDE_ATTACKED (su seq). ReconexiÃ³n o re-render no lo reabre.
  const [hordeSummaryAck, setHordeSummaryAck] = useState<string | null>(null);
  const [hordeManualOpen, setHordeManualOpen] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 1100;

  // Layout estrecho: pestaÃ±as contextuales en lugar de una columna Ãºnica.
  // null = la pestaÃ±a sigue a la fase (mercado â†’ Mercado, restablecimiento â†’
  // Mano, combate â†’ Combate); al tocar una pestaÃ±a el usuario toma el control.
  const [mobileTabOverride, setMobileTabOverride] = useState<MobileTab | null>(null);
  // Auto-seguir la fase solo si el ajuste esta activo y el usuario no ha
  // elegido pestana manualmente en esta partida
  const autoFollowPhase = useSettings((s) => s.autoFollowPhaseTabs);
  const fontScale = useSettings((s) => s.fontScale);
  const hordeSummaryMode = useSettings((s) => s.hordeSummaryMode);

  // Estado de conexiÃ³n real: refleja el socket en online (RECONNECTING/OFFLINE)
  const onlineSocketState = useGameStore((s) => s.online.socket);
  const onlineLastMsgAt = useGameStore((s) => s.online.lastMessageAt);
  // STALE: socket OPEN pero sin trÃ¡fico (ni pong del heartbeat) en >30s.
  // Se reevalÃºa cada 10s; la recuperaciÃ³n la hace el reconnect del store.
  const [socketStale, setSocketStale] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      const o = useGameStore.getState().online;
      setSocketStale(
        !!o.socket && o.socket.readyState === WebSocket.OPEN
          && !!o.lastMessageAt && Date.now() - o.lastMessageAt > 30_000,
      );
    }, 10_000);
    return () => clearInterval(t);
  }, []);
  void onlineLastMsgAt; // suscripciÃ³n: re-renderiza al llegar mensajes
  const connectionState: ConnectionState = (() => {
    if (connectionMode !== 'online') return 'LOCAL';
    if (!onlineSocketState) return 'OFFLINE';
    switch (onlineSocketState.readyState) {
      case WebSocket.OPEN: return socketStale ? 'STALE' : 'CONNECTED';
      case WebSocket.CLOSED: return 'OFFLINE';
      default: return 'RECONNECTING';
    }
  })();

  // Al salir de la pantalla de partida: cerrar la conexiÃ³n online
  // (heartbeat + reconnect + socket) â€” sin esto seguÃ­an vivos de fondo
  const disconnectOnline = useGameStore((s) => s.disconnectOnline);
  useEffect(() => {
    return () => {
      if (useGameStore.getState().connectionMode === 'online') {
        disconnectOnline();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atajos de teclado (web): 1-5 pestaÃ±as Â· h/e/c panel lateral Â· Esc cierra.
  useGameShortcuts({
    enabled: shortcutsEnabled,
    setMobileTab: setMobileTabOverride,
    setSideTab,
    closeTopmost: useCallback(() => {
      setHordeManualOpen(false);
      setDetailHeroId(null);
      setShowSaveModal(false);
      setShowExitDialog(false);
    }, []),
    // â† â†’ mueve la selecciÃ³n por la mano del jugador en vista
    cycleHandCard: useCallback((dir: -1 | 1) => {
      const st = useGameStore.getState();
      const gs = st.gameState;
      if (!gs) return;
      const pid = st.viewerId ?? gs.activePlayerId;
      const hand = gs.players[pid]?.hand ?? [];
      if (hand.length === 0) return;
      const cur = st.ui.selectedCardInstanceId;
      const idx = hand.findIndex((c2) => c2.instanceId === cur);
      const next = hand[(idx + dir + hand.length) % hand.length];
      if (next.instanceId === cur && hand.length === 1) st.selectCard(null);
      else st.selectCard(next.instanceId);
    }, []),
    // Enter juega la carta seleccionada (el motor valida objetivos/coste)
    playSelectedCard: useCallback(() => {
      const st = useGameStore.getState();
      if (st.ui.selectedCardInstanceId) st.playCard(st.ui.selectedCardInstanceId);
    }, []),
  });

  // SuscripciÃ³n a mensajes del WebSocket (chat y comandos remotos).
  // Dependemos de online.socket: tras una reconexiÃ³n el socket cambia y el
  // listener debe re-vincularse al nuevo (si no, el chat muere en silencio).
  const onlineSocket = useGameStore((s) => s.online.socket);
  useEffect(() => {
    if (connectionMode !== 'online' || !onlineSocket) return;
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'chat.message') {
          // Dedupe: el propio mensaje ya se aÃ±adiÃ³ localmente al enviar
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
          // Badge de no leÃ­dos: el chat vive en su propia pestaÃ±a
          setUnreadChat((n) => n + 1);
        }
      } catch {
        // ignore
      }
    };
    onlineSocket.addEventListener('message', handler);
    return () => onlineSocket.removeEventListener('message', handler);
  }, [connectionMode, onlineSocket]);

  // â”€â”€ Espectador + reloj de turno + aviso de turno â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const onlinePlayerId = useGameStore((s) => s.online.playerId);
  const isSpectator = connectionMode === 'online' && !onlinePlayerId;

  // Reloj de turno: reinicia al cambiar el jugador activo (aproximado en
  // online â€” el motor no envÃ­a timestamps; basta para detectar AFK).
  const activePid = gameState?.activePlayerId ?? null;
  const turnStartRef = useRef(Date.now());
  const [turnElapsed, setTurnElapsed] = useState(0);
  useEffect(() => {
    turnStartRef.current = Date.now();
    setTurnElapsed(0);
    const timer = setInterval(() => {
      setTurnElapsed(Math.floor((Date.now() - turnStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [activePid]);

  // Aviso de turno (online): pestaÃ±a oculta o jugador distraÃ­do â†’
  // notificaciÃ³n del sistema + beep (permiso perezoso).
  const wasMyTurnRef = useRef(false);
  useEffect(() => {
    if (connectionMode !== 'online' || !onlinePlayerId || !gameState) return;
    const mine = gameState.activePlayerId === onlinePlayerId;
    if (mine && !wasMyTurnRef.current) {
      notifyYourTurn();
    }
    wasMyTurnRef.current = mine;
  }, [connectionMode, onlinePlayerId, gameState]);

  // Skip AFK: solo el host puede forzar el fin de un turno largo (>2min).
  // El backend inyecta END_TURN como el jugador activo; el runner valida.
  const onlineHostId = useGameStore((s) => s.online.hostId);
  const isHostOnline = connectionMode === 'online'
    && Boolean(onlinePlayerId) && onlineHostId === onlinePlayerId;
  const [skipPending, setSkipPending] = useState(false);
  const skipAfkTurn = useCallback(async () => {
    if (skipPending || !onlineRoomId || !onlinePlayerId) return;
    setSkipPending(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${onlineRoomId}/skip-turn/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: onlinePlayerId,
          playerToken: useGameStore.getState().online.playerToken,
        }),
      });
      const data = await res.json();
      toast.show(res.ok ? t('gm.skipDone') : (data?.error ?? data?.reason ?? t('gm.skipFailed')));
    } catch {
      toast.show(t('gm.skipFailed'));
    } finally {
      setSkipPending(false);
    }
  }, [skipPending, onlineRoomId, onlinePlayerId, t]);


  // D418: historial real derivado del eventLog del motor (UI-170..174)
  const historyEntries: HistoryEntry[] = buildHistoryEntries(gameState?.eventLog ?? [], catalog, t);

  const handleZoomCard = useCallback(
    (instanceId: string | null) => setZoomCardId(instanceId),
    [],
  );

  const handleSendChat = useCallback((text: string) => {
    // D417: en online el remitente es el jugador local, no el activo
    const sender = connectionMode === 'online'
      ? (useGameStore.getState().online.playerId ?? t('gm.playerFallback'))
      : (gameState?.players[gameState.activePlayerId]?.playerId ?? t('gm.playerFallback'));
    const msg: ChatMessage = {
      id: `chat-${Date.now()}`,
      sender,
      text,
      type: 'USER',
      timestamp: Date.now(),
      status: connectionMode === 'online' ? 'sending' : 'sent',
      // Estable entre reintentos: el servidor puede deduplicar por Ã©l
      clientMessageId: `cmid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    setChatMessages((prev) => [...prev, msg]);
    setChatDraft('');
    // En modo online, enviar por WebSocket â€” con estado de entrega visible
    if (connectionMode === 'online') {
      const socket = useGameStore.getState().online.socket;
      const ok = socket && socket.readyState === WebSocket.OPEN;
      if (ok) {
        try {
          socket.send(JSON.stringify({ type: 'chat.message', sender, text, timestamp: msg.timestamp, clientMessageId: msg.clientMessageId }));
        } catch {
          // send() puede lanzar si el socket se cierra entre la comprobaciÃ³n y el envÃ­o
        }
      }
      const delivered = Boolean(ok && socket.readyState === WebSocket.OPEN);
      setChatMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, status: delivered ? 'sent' : 'failed' } : m)),
      );
    }
  }, [gameState, connectionMode, t]);

  const handleRetryChat = useCallback((failed: ChatMessage) => {
    const socket = useGameStore.getState().online.socket;
    const ok = socket && socket.readyState === WebSocket.OPEN;
    setChatMessages((prev) =>
      prev.map((m) => (m.id === failed.id ? { ...m, status: ok ? 'sending' : 'failed' } : m)),
    );
    if (!ok) return;
    try {
      socket.send(JSON.stringify({
        type: 'chat.message', sender: failed.sender, text: failed.text,
        timestamp: Date.now(), clientMessageId: failed.clientMessageId,
      }));
      setChatMessages((prev) =>
        prev.map((m) => (m.id === failed.id ? { ...m, status: 'sent' } : m)),
      );
    } catch {
      setChatMessages((prev) =>
        prev.map((m) => (m.id === failed.id ? { ...m, status: 'failed' } : m)),
      );
    }
  }, []);

  const handleDiscardChat = useCallback((msg: ChatMessage) => {
    setChatMessages((prev) => prev.filter((m) => m.id !== msg.id));
  }, []);

  const handleSaveGame = useCallback((name = '') => {
    setSaveState('saving');
    try {
      saveGame(name);
      setLastSavedAt(Date.now());
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [saveGame]);

  // Wrapper que decide entre acciÃ³n local o envÃ­o online
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
  const startEvasion = useGameStore((s) => s.startEvasion);

  const handleSaveAndExit = useCallback(() => {
    handleSaveGame();
    setShowExitDialog(false);
    router.push('/');
  }, [handleSaveGame, router]);

  // Foco por fase: cada zona principal se atenÃºa fuera de su momento.
  // La mesa no muestra todo con el mismo peso en todo momento.
  // NOTA hooks: todo esto estÃ¡ ANTES de los early-returns (!gameState,
  // privacyScreen, FINISHED) â€” ningÃºn hook puede vivir tras un return.
  const marketActive = gameState?.phase === 'MARKET';

  // Layout estrecho: pestaÃ±a contextual segÃºn la fase
  const phaseTab: MobileTab = marketActive ? 'market'
    : gameState?.phase === 'RESTORATION' ||
      gameState?.phase === 'BATTLEFIELD_REPLENISHMENT' ||
      gameState?.phase === 'TURN_END' ? 'hand'
    : gameState?.phase === 'GAME_END_CHECK' ? 'status'
    : 'combat';

  // Seguimiento NO intrusivo: el auto-follow cede si el usuario estÃ¡ en
  // medio de una interacciÃ³n (escribiendo en chat, carta ampliada,
  // diÃ¡logo abierto) â€” nunca le quita la pestaÃ±a de debajo de los dedos.
  const interactionBusy =
    chatDraft.trim().length > 0 || zoomCardId !== null ||
    detailHeroId !== null || showSaveModal || showExitDialog;
  const lastShownTabRef = useRef<MobileTab>('combat');
  const mobileTab: MobileTab = mobileTabOverride
    ?? (autoFollowPhase && !interactionBusy ? phaseTab : lastShownTabRef.current);
  useEffect(() => { lastShownTabRef.current = mobileTab; }, [mobileTab]);

  // El override manual dura el turno actual: al empezar el siguiente la
  // pestaÃ±a vuelve a seguir a la fase (evita quedarse "atascado")
  const turnNumber = gameState?.turnNumber ?? 0;
  useEffect(() => { setMobileTabOverride(null); }, [turnNumber]);

  if (!gameState) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('gm.emptyNoGame')}</Text>
        <Pressable style={styles.emptyButton} onPress={() => router.push('/')}>
          <Text style={styles.emptyButtonText}>{t('gm.backHome')}</Text>
        </Pressable>
      </View>
    );
  }

  if (privacyScreen) {
    return <PrivacyScreen />;
  }

  if (gameState.phase === 'FINISHED') {
    return <FinishedScreen newAchievements={newAchievements} />;
  }

  const activePlayer = gameState.players[gameState.activePlayerId];
  const canUseAbility = activePlayer && activePlayer.heroUsesRemaining > 0;
  // Ataque previsto de la Horda (spec 3.4/3.6): el desglose lo calcula el
  // motor (computeHordeAttackBreakdown) â€” la UI solo lo representa, sin
  // recalcular fortalezas, Anti-Magia, escudos ni prevenciÃ³n.
  const hordeBreakdown = catalog
    ? computeHordeAttackBreakdown(gameState, catalog)
    : null;
  const hordeIncoming = hordeBreakdown?.enemyLines
    .reduce((sum, l) => sum + l.finalDamage, 0) ?? 0;
  const hordeAfterDefense = hordeBreakdown?.finalExhaustion ?? 0;
  // Identidad del asalto: seq del Ãºltimo HORDE_ATTACKED; si la fase aÃºn no
  // resolviÃ³ (ventana de reacciÃ³n), se usa el turno como clave provisional
  let lastHordeSeq: number | null = null;
  for (let i = gameState.eventLog.length - 1; i >= 0; i--) {
    const e = gameState.eventLog[i];
    if (e.type === 'HORDE_ATTACKED') { lastHordeSeq = e.seq; break; }
  }
  const hordeResolutionId = lastHordeSeq !== null
    ? `horde-${lastHordeSeq}`
    : `horde-pending-${gameState.turnNumber}`;
  // Apertura automÃ¡tica segÃºn preferencia: 'always' siempre, 'modifiers'
  // solo si el cÃ¡lculo no es trivial (Anti-Magia, bonus, anulados, defensas,
  // anulaciÃ³n o Feldon), 'never' nunca (el banner sigue disponible)
  const hordeInteresting = !!hordeBreakdown && (
    hordeBreakdown.cancelled || hordeBreakdown.halvedByFeldon ||
    hordeBreakdown.shieldsApplied > 0 || hordeBreakdown.preventionApplied > 0 ||
    hordeBreakdown.enemyLines.some(
      (l) => l.antiMagicReduction > 0 || l.outgoingBonus > 0 || l.damageDisabled,
    )
  );
  const hordeSummaryAutoOpen =
    hordeSummaryMode === 'always' ||
    (hordeSummaryMode === 'modifiers' && hordeInteresting);
  const showHordePreview =
    gameState.phase === 'ATTACK_CHOICE' ||
    gameState.phase === 'PLAYER_ATTACK' ||
    gameState.phase === 'HORDE_ATTACK';

  // Desglose por enemigo para HordeAttackSummary (UI-160..164)
  const hordeContributions: EnemyContribution[] = (hordeBreakdown?.enemyLines ?? []).map((l) => {
    const def = catalog?.byId.get(l.definitionId);
    const mods: string[] = [];
    if (l.antiMagicReduction > 0) mods.push(t('gm.hordeModAntiMagic', { value: l.antiMagicReduction }));
    if (l.outgoingBonus > 0) mods.push(t('gm.hordeModOutgoing', { value: l.outgoingBonus }));
    const modified = l.baseDamage - l.antiMagicReduction + l.outgoingBonus;
    return {
      enemyName: def?.name ?? l.definitionId,
      baseDamage: l.baseDamage,
      modifiedDamage: modified,
      finalDamage: l.damageDisabled ? null : l.finalDamage,
      modifiers: mods.length ? mods : undefined,
    };
  });

  // Construir acciones contextuales segÃºn fase (UI-120)
  const contextualActions: ContextualAction[] = buildContextualActions(
    gameState.phase,
    {
      endAttack: handleEndAttack,
      endTurn: handleEndTurn,
      useHeroAbility: handleUseHeroAbility,
      canUseAbility,
      startEvasion,
      handSize: activePlayer?.hand.length ?? 0,
      evasionTokenUsed: activePlayer?.evasionTokenUsed ?? false,
    },
    t,
  );

  // InstrucciÃ³n concreta (UI-073)
  const instruction = buildInstruction(gameState.phase, t);



  const marketSection = (
    <View
      style={[
        marketActive ? styles.marketFocused : styles.marketInactive,
        { borderColor: colors.border },
      ]}
    >
      {!marketActive && (
        <Text style={styles.marketInactiveLabel}>
          {t('gm.marketInactive')}
        </Text>
      )}
      <MarketView />
    </View>
  );

  const secondaryActions = (
    <View style={styles.secondaryActions}>
      <Button variant="secondary" label={t('gm.save')} onPress={() => setShowSaveModal(true)} />
    </View>
  );

  // Historial, estado y chat como pestaÃ±as separadas (no mezclar log
  // funcional con conversaciÃ³n social). El badge muestra mensajes no leÃ­dos.
  const sidePanel = (
    <View>
      <View style={styles.sideTabs} accessibilityRole="tablist">
        {(['history', 'status', 'chat'] as const).map((tab) => (
          <Pressable
            key={tab}
            onPress={() => {
              setSideTab(tab);
              if (tab === 'chat') setUnreadChat(0);
            }}
            style={[styles.sideTab, sideTab === tab && styles.sideTabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: sideTab === tab }}
            accessibilityLabel={
              tab === 'history' ? t('gm.tabHistoryA11y')
              : tab === 'status' ? t('gm.tabStatusA11y')
              : unreadChat > 0 ? t('gm.tabChatUnreadA11y', { count: unreadChat }) : t('gm.tabChat')
            }
          >
            <Text style={[styles.sideTabText, sideTab === tab && styles.sideTabTextActive]}>
              {tab === 'history' ? t('gm.tabHistory') : tab === 'status' ? t('gm.tabStatus') : t('gm.tabChat')}
              {tab === 'chat' && unreadChat > 0 && ` (${unreadChat})`}
            </Text>
          </Pressable>
        ))}
      </View>
      {sideTab === 'history' ? (
        <ZoneBoundary zone={t('gm.tabHistory')}>
          <ActionHistory
            entries={historyEntries}
            currentTurn={gameState.turnNumber}
            filter={historyFilter}
              playerFilter={historyPlayer}
              onPlayerFilterChange={setHistoryPlayer}
            advanced={historyAdvanced}
            onFilterChange={setHistoryFilter}
            onToggleAdvanced={() => setHistoryAdvanced((v) => !v)}
          />
        </ZoneBoundary>
      ) : sideTab === 'status' ? (
        <ZoneBoundary zone={t('gm.tabStatus')}>
          <GameStatusPanel />
        </ZoneBoundary>
      ) : (
        <ZoneBoundary zone={t('gm.tabChat')}>
          <ChatPanel
            messages={chatMessages}
            currentUser={activePlayer?.playerId ?? t('gm.playerFallback')}
            onSend={handleSendChat}
            draftText={chatDraft}
            onDraftChange={setChatDraft}
            onClose={() => setSideTab('history')}
            mutedSenders={mutedChatSenders}
            onToggleMute={toggleMuteChatSender}
            onRetry={handleRetryChat}
            onDiscard={handleDiscardChat}
          />
        </ZoneBoundary>
      )}
    </View>
  );

  const isMyTurn = connectionMode === 'online'
    ? gameState.activePlayerId === useGameStore.getState().online.playerId
    : true; // local/hot-seat: el turno siempre es "de la mesa"
  const activeHeroName = activePlayer
    ? catalog?.byId.get(activePlayer.heroId)?.name ?? activePlayer.heroId
    : '';

  return (
    <View style={styles.container}>
      {/* Cabecera: logo | turno/fase/jugador | conexiÃ³n | salir */}
      <GameHeader
        turnNumber={gameState.turnNumber}
        phaseLabel={PHASE_LABELS[gameState.phase] ?? gameState.phase}
        isMyTurn={isSpectator ? false : isMyTurn}
        activeHeroName={activeHeroName}
        isSpectator={isSpectator}
        turnSeconds={turnElapsed}
        connectionState={connectionState}
        onExit={() => setShowExitDialog(true)}
        onUndo={connectionMode === 'local' ? undoLastCommand : undefined}
        canUndo={connectionMode === 'local' && canUndo}
        compact={!wide}
      />

      {/* Zona Ãºnica de avisos: la prioridad decide cuÃ¡l se muestra */}
      <ContextBanner
        horde={
          showHordePreview && hordeIncoming > 0
            ? {
                incoming: hordeIncoming,
                shields: activePlayer?.shields ?? 0,
                block: activePlayer?.blockNext ?? 0,
                afterDefense: hordeAfterDefense,
                willExhaust:
                  hordeAfterDefense >= (activePlayer?.abilityDeck.length ?? 0) &&
                  hordeAfterDefense > 0,
                onShowBreakdown:
                  gameState.phase === 'HORDE_ATTACK'
                    ? () => setHordeManualOpen(true)
                    : undefined,
              }
            : null
        }
        message={message}
        instruction={instruction}
        onlineRoomId={connectionMode === 'online' ? onlineRoomId : null}
      />

      {/* Skip AFK: el host puede forzar el fin de un turno >2min */}
      {isHostOnline && !isSpectator && turnElapsed >= 120 && (
        <Pressable
          style={styles.afkSkip}
          onPress={() => void skipAfkTurn()}
          disabled={skipPending}
          accessibilityRole="button"
          accessibilityLabel={t('gm.skipAfk')}
        >
          <Text style={styles.afkSkipText}>
            {skipPending ? 'â€¦' : t('gm.skipAfk')}
          </Text>
        </Pressable>
      )}

      {wide ? (
        /* Tablero por zonas: jugadores | mesa | historial */
        <View style={styles.wideRow}>
          <View style={styles.wideLeft}>
            <PlayersSidebar onSelectHero={setDetailHeroId} />
          </View>
          <ScrollView style={styles.wideCenter}>
            {/* Franja superior: escenario + horda/enemigo final */}
            <View style={styles.topZone}>
              <View style={styles.scenarioSlot}>
                <ScenarioView />
              </View>
              <HordePanel />
            </View>

            {/* NÃºcleo: enemigos en mesa + mercado */}
            <View style={styles.boardRow}>
              <View style={[styles.boardMain, marketActive && styles.battlefieldDimmed]}>
                <Battlefield />
              </View>
              <View style={styles.boardSide}>
                {marketSection}
              </View>
            </View>

            {/* D427: elecciones pendientes del viewer */}
            <PendingChoiceView />

            {/* Mano + mazo/descarte */}
            <View style={styles.handRow}>
              <View style={styles.handMain}>
                <HandView zoomedCardId={zoomCardId} onZoomCard={handleZoomCard} />
              </View>
              <DeckPanel incomingDamage={hordeAfterDefense} />
            </View>
          </ScrollView>
          <View style={styles.wideRight}>
            {sidePanel}
          </View>
        </View>
      ) : (
        /* Layout estrecho: pestanas contextuales por fase */
        <View style={styles.narrowBody}>
          <ScrollView style={styles.scroll}>
            {mobileTab === 'combat' && (
              <>
                <PlayerPanel onSelectHero={setDetailHeroId} />
                <Battlefield />
                <ScenarioView />
                <PendingChoiceView />
              </>
            )}
            {mobileTab === 'hand' && (
              <>
                <HandView zoomedCardId={zoomCardId} onZoomCard={handleZoomCard} />
                <DeckPanel incomingDamage={hordeAfterDefense} />
              </>
            )}
            {mobileTab === 'market' && marketSection}
            {mobileTab === 'status' && <GameStatusPanel />}
            {mobileTab === 'log' && sidePanel}
          </ScrollView>
          <View style={styles.mobileTabBar} accessibilityRole="tablist">
            {MOBILE_TABS.map((tab) => {
              const selected = mobileTab === tab.id;
              const tabLabel = t(tab.labelKey);
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => setMobileTabOverride(
                    selected && mobileTabOverride !== null ? null : tab.id
                  )}
                  style={[styles.mobileTab, selected && styles.mobileTabActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={
                    tab.id === 'log' && unreadChat > 0
                      ? t('gm.tabUnreadA11y', { label: tabLabel, count: unreadChat })
                      : tabLabel
                  }
                  accessibilityHint={
                    selected && mobileTabOverride !== null
                      ? t('gm.tabFollowPhaseHint')
                      : undefined
                  }
                >
                  <tab.Icon
                    size={15}
                    color={selected ? colors.accent : colors.textMuted}
                  />
                  {(fontScale < 1.5 || selected) && (
                    <Text style={[styles.mobileTabText, selected && styles.mobileTabTextActive]}>
                      {tabLabel}
                      {tab.id === 'log' && unreadChat > 0 ? ` (${unreadChat})` : ''}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {/* Pie persistente: recursos (mazo = energÃ­a) + acciÃ³n principal */}
      <View style={styles.footer}>
        <View style={styles.footerResources}>
          <HeroStatusBar incomingDamage={hordeAfterDefense} />
        </View>
        <View style={styles.footerActions}>
          <ContextualActions actions={contextualActions} />
          {secondaryActions}
        </View>
      </View>

      <SaveIndicator state={saveState} lastSavedAt={lastSavedAt} />

      {/* Modal de guardado */}
      {/* Resumen del Ataque de la Horda (UI-160..164): una vez por asalto */}
      <HordeAttackSummary
        visible={(gameState.phase === 'HORDE_ATTACK' && hordeSummaryAck !== hordeResolutionId && hordeSummaryAutoOpen) || hordeManualOpen}
        enemies={hordeContributions}
        totalBaseDamage={hordeContributions.reduce((s, e) => s + e.baseDamage, 0)}
        totalPrevented={(activePlayer?.shields ?? 0) + (activePlayer?.prevention ?? 0) + (hordeBreakdown?.blockApplied ?? 0)}
        totalFinalDamage={hordeAfterDefense}
        onClose={() => { setHordeSummaryAck(hordeResolutionId); setHordeManualOpen(false); }}
      />

      <SaveGameModal
        visible={showSaveModal}
        onCancel={() => setShowSaveModal(false)}
        onSave={(name) => {
          handleSaveGame(name);
          setShowSaveModal(false);
        }}
      />

      {/* HeroDetail (UI-084..085) */}
      <HeroDetail
        visible={detailHeroId !== null}
        hero={detailHeroId ? (catalog?.byId.get(detailHeroId) ?? null) : null}
        usesRemaining={
          detailHeroId ? gameState.players[gameState.activePlayerId]?.heroUsesRemaining : undefined
        }
        onClose={() => setDetailHeroId(null)}
      />

      {/* CardZoom lo gestiona HandView (mantener pulsado una carta) */}

      {/* ExitGameDialog (UI-024) */}
      <ExitGameDialog
        visible={showExitDialog}
        hasUnsavedChanges={lastSavedAt === undefined}
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
        diagnostics={[
          connectionMode,
          gameState ? t('gm.diagPhase', { phase: gameState.phase }) : null,
          gameState ? t('gm.diagTurn', { n: gameState.turnNumber }) : null,
          gameState ? t('gm.diagEvents', { count: gameState.eventLog.length }) : null,
          useGameStore.getState().online.roomId
            ? t('gm.diagRoom', { id: useGameStore.getState().online.roomId }) : null,
          useGameStore.getState().online.lastRevision != null
            ? t('gm.diagRev', { n: useGameStore.getState().online.lastRevision }) : null,
        ].filter(Boolean).join(' Â· ')}
      />
    </View>
  );
}

/** Construye las acciones contextuales segÃºn la fase (UI-120). */
function buildContextualActions(
  phase: string,
  handlers: {
    endAttack: () => void;
    endTurn: () => void;
    useHeroAbility: () => void;
    canUseAbility: boolean;
    startEvasion: () => void;
    handSize: number;
    evasionTokenUsed: boolean;
  },
  t: TFunction,
): ContextualAction[] {
  switch (phase) {
    case 'ATTACK_CHOICE':
      return [
        { id: 'end-attack', label: t('gm.actionToHorde'), icon: 'âš”', onPress: handlers.endAttack, primary: true },
        {
          id: 'evasion',
          label: t('gm.actionEvade'),
          icon: 'ðŸƒ',
          onPress: handlers.startEvasion,
          disabled: handlers.handSize < 2 || handlers.evasionTokenUsed,
          disabledReason: handlers.evasionTokenUsed
            ? t('gm.evasionUsed')
            : handlers.handSize < 2 ? t('gm.evasionNeedCards') : undefined,
        },
      ];
    case 'PLAYER_ATTACK':
      return [
        { id: 'end-attack', label: t('gm.actionEndAttack'), icon: 'âš”', onPress: handlers.endAttack, primary: true },
        {
          id: 'use-ability',
          label: t('gm.actionUsePower'),
          icon: 'âœ¨',
          onPress: handlers.useHeroAbility,
          disabled: !handlers.canUseAbility,
          disabledReason: handlers.canUseAbility ? undefined : t('gm.abilityExhausted'),
        },
      ];
    case 'MARKET':
      return [
        { id: 'end-market', label: t('gm.actionEndMarket'), icon: 'ðŸ’°', onPress: handlers.endTurn, primary: true },
      ];
    case 'RESTORATION':
      return [
        { id: 'confirm-restore', label: t('gm.actionConfirm'), icon: 'âœ“', onPress: handlers.endTurn, primary: true },
      ];
    default:
      return [];
  }
}

/** Construye la instrucciÃ³n concreta segÃºn la fase (UI-073). */
function buildInstruction(phase: string, t: TFunction): string | null {
  switch (phase) {
    case 'PLAYER_ATTACK':
      return t('gm.instrPlayerAttack');
    case 'MARKET':
      return t('gm.instrMarket');
    case 'RESTORATION':
      return t('gm.instrRestoration');
    case 'ATTACK_CHOICE':
      return t('gm.instrAttackChoice');
    case 'HORDE_ATTACK':
      return t('gm.instrHordeAttack');
    case 'LEADER_CHOICE':
      return t('gm.instrLeaderChoice');
    default:
      return null;
  }
}

/** Pantalla final (UI-210..212). */
function FinishedScreen({ newAchievements = [] }: { newAchievements?: Achievement[] }) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const gameState = useGameStore((s) => s.gameState);
  const noFlashes = useSettings((s) => s.noFlashes || s.reduceMotion);
  const initialConfig = useGameStore((s) => s.initialConfig);
  const newGame = useGameStore((s) => s.newGame);
  const router = useRouter();

  if (!gameState) return null;

  const catalog = useGameStore.getState().catalog;
  const heroName = (id: string) => catalog?.byId.get(id)?.name ?? id;
  // PuntuaciÃ³n final calculada por el motor (spec 3.8): Gloria + 1/3 monedas
  // + 1 Tenaz sin heridas. Desempate: mÃ¡s trofeos.
  const { ranking: sorted, isTie } = computeFinalScore(gameState.players);
  const winner = sorted[0];

  return (
    <ScrollView style={styles.finishedContainer} contentContainerStyle={styles.finishedContent}>
      {/* CelebraciÃ³n de victoria â€” se omite si el usuario pidiÃ³ evitar destellos */}
      {!noFlashes && (
        <ConfettiCannon count={120} origin={{ x: 200, y: -20 }} fadeOut autoStart />
      )}
      <Text style={styles.finishedTitle}>{t('gm.finishedTitle')}</Text>

      {/* Toast de logros desbloqueados en esta partida */}
      {newAchievements.map((a) => (
        <View
          key={a.id}
          accessibilityRole="alert"
          style={{
            backgroundColor: colors.accent,
            borderRadius: 10,
            paddingVertical: 8,
            paddingHorizontal: 14,
            marginVertical: 3,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Trophy size={18} color="#1a1a2e" />
          <Text style={{ color: '#1a1a2e', fontWeight: '700' }}>
            {t('ach.toast', { name: t(`ach.${a.id}.name`, { defaultValue: a.name }) })}
          </Text>
        </View>
      ))}

      {isTie ? (
        <Text style={styles.tieText}>
          {t('gm.finishedTie', {
            total: winner.total,
            players: sorted
              .filter((p) => p.total === winner.total && p.trophies === winner.trophies)
              .map((p) => heroName(p.heroId))
              .join(t('gm.listAnd')),
          })}
        </Text>
      ) : (
        <Text style={styles.winnerText}>
          {t('gm.finishedWinner', { name: heroName(winner?.heroId ?? ''), total: winner?.total ?? '' })}
        </Text>
      )}

      <View style={styles.rankings}>
        {sorted.map((p, i) => (
          <View key={p.playerId} style={styles.rankingRow}>
            <Text style={styles.rankPosition}>{i + 1}.</Text>
            <View style={styles.rankMain}>
              <Text style={styles.rankName}>{heroName(p.heroId)}</Text>
              <Text style={styles.rankBreakdown}>
                {p.breakdown.filter((b) => b.value > 0).map((b) => `${b.label} ${b.value}`).join(' + ')}
                {' '}Â· {t('gm.finishedTrophies', { count: p.trophies })}
              </Text>
            </View>
            <Text style={styles.rankGlory}>{p.total}</Text>
          </View>
        ))}
      </View>

      <View style={styles.finishedActions}>
        <Pressable style={styles.finishedButton} onPress={() => router.push('/')}>
          <Text style={styles.finishedButtonText}>{t('gm.backHome')}</Text>
        </Pressable>
        <Pressable
          style={styles.finishedButtonSecondary}
          onPress={() => {
            if (initialConfig) {
              // Revancha real: misma configuraciÃ³n, semilla nueva
              newGame({ ...initialConfig, seed: `rematch-${Date.now()}` });
            } else {
              router.push({ pathname: '/(create)' } as never);
            }
          }}
        >
          <Text style={styles.finishedButtonText}>
            {initialConfig ? t('gm.rematch') : t('gm.playAgain')}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const createStyles = (c: Colors) => StyleSheet.create({
  container: {
    flex: 1,
  },
  afkSkip: {
    alignSelf: 'center',
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.warning,
    backgroundColor: 'rgba(243,156,18,0.12)',
  },
  afkSkipText: { color: c.warning, fontWeight: '700', fontSize: 13 },
  scroll: {
    flex: 1,
  },
  // Layout por zonas en pantallas anchas (doc: jugadores | tablero | historial)
  wideRow: {
    flex: 1,
    flexDirection: 'row',
  },
  wideLeft: {
    width: 260,
    borderRightWidth: 1,
    borderRightColor: c.divider,
    justifyContent: 'flex-start',
  },
  wideCenter: {
    flex: 1,
  },
  wideRight: {
    width: 300,
    borderLeftWidth: 1,
    borderLeftColor: c.divider,
  },
  marketInactive: {
    opacity: 0.45,
  },
  marketFocused: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 6,
  },
  battlefieldDimmed: {
    opacity: 0.55,
  },
  marketInactiveLabel: {
    color: c.connectionStale,
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingTop: 6,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyText: {
    color: c.textMuted,
    fontSize: 16,
    marginBottom: 16,
  },
  emptyButton: {
    backgroundColor: c.info,
    padding: 12,
    borderRadius: 8,
  },
  emptyButtonText: {
    color: c.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Cabecera tipo wireframe: logo | turno/fase | acciones
  // Zonas del tablero (layout ancho)
  topZone: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingHorizontal: 4,
  },
  scenarioSlot: {
    flex: 1,
  },
  boardRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  boardMain: {
    flex: 1.4,
  },
  boardSide: {
    flex: 1,
    minWidth: 260,
  },
  handRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingHorizontal: 4,
  },
  handMain: {
    flex: 1,
    minWidth: 0,
  },
  // Pie: recursos + acciones
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.background,
    gap: 8,
  },
  footerResources: {
    flex: 1,
    minWidth: 0,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  header: {
    backgroundColor: c.background,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  activePlayerText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingBottom: 6,
  },
  secondaryActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  sideTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    marginBottom: 6,
  },
  sideTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  sideTabActive: {
    borderBottomColor: c.accent,
  },
  sideTabText: {
    color: c.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  sideTabTextActive: {
    color: c.accent,
  },
  exitSpacer: {
    flex: 1,
    maxWidth: 120,
  },
  finishedContainer: {
    flex: 1,
    backgroundColor: c.background,
  },
  finishedContent: {
    alignItems: 'center',
    padding: 20,
  },
  finishedTitle: {
    color: c.accent,
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
    marginTop: 20,
  },
  winnerText: {
    color: c.success,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  tieText: {
    color: c.warning,
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
    backgroundColor: c.surface,
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
  },
  rankPosition: {
    color: c.accent,
    fontSize: 16,
    fontWeight: 'bold',
    width: 30,
  },
  rankName: {
    color: c.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  rankMain: {
    flex: 1,
  },
  rankBreakdown: {
    color: c.textFaint,
    fontSize: 12,
    marginTop: 2,
  },
  rankGlory: {
    color: c.info,
    fontSize: 14,
    fontWeight: 'bold',
  },
  rankTrophies: {
    color: c.textMuted,
    fontSize: 11,
    marginLeft: 8,
  },
  finishedActions: {
    flexDirection: 'row',
    gap: 12,
  },
  finishedButton: {
    backgroundColor: c.info,
    padding: 14,
    borderRadius: 8,
    minWidth: 150,
    alignItems: 'center',
  },
  finishedButtonSecondary: {
    backgroundColor: c.success,
    padding: 14,
    borderRadius: 8,
    minWidth: 150,
    alignItems: 'center',
  },
  finishedButtonText: {
    color: c.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Layout estrecho: barra de pestanas sobre el pie persistente
  narrowBody: { flex: 1 },
  mobileTabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.background,
  },
  mobileTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    minHeight: 44,
    justifyContent: 'center',
    borderTopWidth: 2,
    borderTopColor: 'transparent',
  },
  mobileTabActive: { borderTopColor: c.accent, backgroundColor: c.surface },
  mobileTabText: { color: c.textMuted, fontSize: 10, fontWeight: '600' },
  mobileTabTextActive: { color: c.accent },
});

// ============================================================================
// Historial de acciones â€” mapea eventos del motor a HistoryEntry (UI-170..174)
// ============================================================================

const HISTORY_PHASE_KEYS: Record<string, string> = {
  SETUP: 'gm.histPhaseSetup',
  INITIAL_PLAYER_SELECTION: 'gm.histPhaseLeaderSelect',
  ATTACK_CHOICE: 'gm.histPhaseAttackChoice',
  PLAYER_ATTACK: 'gm.histPhasePlayerAttack',
  HORDE_ATTACK: 'gm.histPhaseHordeAttack',
  MARKET: 'gm.histPhaseMarket',
  RESTORATION: 'gm.histPhaseRestoration',
  FINISHED: 'gm.histPhaseFinished',
};

function cardName(catalog: CatalogLoadResult | null, definitionId: string | undefined): string {
  if (!definitionId) return 'â€”';
  return catalog?.byId.get(definitionId)?.name ?? definitionId;
}

function buildHistoryEntries(
  events: GameEvent[],
  catalog: CatalogLoadResult | null,
  t: TFunction,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let turn = 1;
  const turnStartIdx = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const entry = eventToHistoryEntry(e, turn, catalog, t);
    // Eventos sin actor (fases, sistema) se marcan como globales para que el
    // filtro por jugador no los oculte (UI-172)
    if (entry && entry.actor === 'â€”') entry.global = true;
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
  t: TFunction,
): HistoryEntry | null {
  const base = { id: `ev-${e.seq}`, turn, timestamp: e.seq };
  const actor = (pid: string | undefined) => pid ?? 'â€”';
  const card = (defId: string | undefined) => cardName(catalog, defId);
  const hero = (pid: string | undefined, state: GameState | null) =>
    pid ? (state?.players[pid]?.heroId ?? pid) : 'â€”';
  void hero;

  switch (e.type) {
    case 'TURN_STARTED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histTurnStarted'), result: t('gm.histTurnN', { n: e.turnNumber }) };
    case 'TURN_ENDED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histTurnEnded'), result: 'â€”' };
    case 'CARD_PLAYED':
      return {
        ...base,
        actor: actor(e.playerId),
        action: t('gm.histCardPlayed'),
        card: e.cardName ?? card(e.cardDefinitionId),
        target: e.targetEnemyInstanceId,
        result: e.cardName ?? card(e.cardDefinitionId),
      };
    case 'DAMAGE_DEALT':
      return { ...base, actor: 'â€”', action: t('gm.histDamageDealt'), target: e.targetId, result: t('gm.histDamageN', { n: e.amount }) };
    case 'ENEMY_DEFEATED':
      return {
        ...base,
        actor: actor(e.defeatingPlayerId),
        action: t('gm.histEnemyDefeated'),
        card: card(e.enemyDefinitionId),
        result: t('gm.histReward', { glory: e.reward.glory, coins: e.reward.coins }),
      };
    case 'HORDE_ATTACKED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histHordeAttack'), result: t('gm.histDamageN', { n: e.totalDamage }) };
    case 'EVASION_PERFORMED':
      return {
        ...base,
        actor: actor(e.playerId),
        action: t('gm.histEvasion'),
        result: t('gm.histDiscardedN', { count: e.discardedCardInstanceIds.length }),
      };
    case 'CARDS_DRAWN':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCardsDrawn'), result: t('gm.histCardsN', { count: e.count }) };
    case 'CARDS_LOST':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCardsLost'), result: t('gm.histCardsN', { count: e.count }) };
    case 'CARDS_RECOVERED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCardsRecovered'), result: t('gm.histCardsN', { count: e.count }) };
    case 'GLORY_GAINED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histGloryGained'), result: `+${e.amount}` };
    case 'GLORY_LOST':
      return { ...base, actor: actor(e.playerId), action: t('gm.histGloryLost'), result: `-${e.amount}` };
    case 'COINS_GAINED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCoins'), result: `${e.amount >= 0 ? '+' : ''}${e.amount}` };
    case 'COINS_STOLEN':
      return { ...base, actor: actor(e.fromPlayerId), action: t('gm.histCoinsStolen'), target: e.toPlayerId, result: `${e.amount}` };
    case 'WOUND_HEALED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histHealing'), result: t('gm.histWoundsHeal', { count: e.amount }) };
    case 'MARKET_PURCHASED':
      return {
        ...base,
        actor: actor(e.playerId),
        action: t('gm.histMarketPurchase'),
        card: card(e.cardInstanceId),
        result: t('gm.histCoinsCost', { cost: e.cost }),
      };
    case 'MARKET_REPLENISHED':
      return { ...base, actor: t('gm.histActorMarket'), action: t('gm.histReplenish'), result: 'â€”' };
    case 'ENEMY_REVEALED':
      return {
        ...base,
        actor: t('gm.histActorHorde'),
        action: t('gm.histEnemyRevealed'),
        card: card(e.definitionId),
        result: t('gm.histFortitudeN', { n: e.fortitude }),
      };
    case 'WARLORD_REVEALED':
      return {
        ...base,
        actor: t('gm.histActorHorde'),
        action: t('gm.histWarlordRevealed'),
        card: card(e.definitionId),
        result: t('gm.histFinalBoss'),
      };
    case 'SCENARIO_REVEALED':
      return { ...base, actor: t('gm.histActorScenario'), action: t('gm.histScenarioRevealed'), card: card(e.definitionId), result: 'â€”' };
    case 'SCENARIO_DISCARDED':
      return { ...base, actor: t('gm.histActorScenario'), action: t('gm.histScenarioDiscarded'), result: 'â€”' };
    case 'PHASE_CHANGED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histPhase'), result: HISTORY_PHASE_KEYS[e.phase] ? t(HISTORY_PHASE_KEYS[e.phase]) : e.phase };
    case 'HERO_ABILITY_USED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histAbilityUsed'), result: t('gm.histUsesLeft', { count: e.usesRemaining }) };
    case 'GAME_ENDED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histGameEnded'), result: e.winnerId ? t('gm.histWinner', { name: e.winnerId }) : t('gm.histCoopDefeat') };
    case 'LEADER_DETERMINED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histLeaderChosen'), result: 'â€”' };
    case 'DECK_EXHAUSTED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histDeckExhausted'), result: t('gm.histWoundRecycle') };
    case 'DECK_RESHUFFLED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histDeckReshuffled'), result: t('gm.histCardsN', { count: e.newDeckSize }) };
    case 'SHIELD_PLACED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histShield'), result: `+${e.amount}` };
    case 'PREVENTION_APPLIED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histPrevention'), result: t('gm.histDamagePrevented', { n: e.amount }) };
    case 'DAMAGE_INTERCEPTED':
      return {
        ...base,
        actor: actor(e.interceptorPlayerId),
        action: t('gm.histInterceptsDamage'),
        target: e.originalTargetPlayerId,
        result: t('gm.histDamageN', { n: e.amount }),
      };
    case 'ENEMY_RETURNED_TO_HORDE':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histEnemyReturned'), result: 'â€”' };
    case 'ENEMY_SWAPPED':
      return {
        ...base,
        actor: t('gm.histActorSystem'),
        action: t('gm.histEnemySwapped'),
        card: card(e.newEnemyDefinitionId),
        result: t('gm.histFortitudeN', { n: e.newEnemyFortitude }),
      };
    case 'VULNERABILITY_APPLIED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histVulnerability'), target: e.enemyInstanceId, result: t('gm.histBonusDamage', { n: e.bonus }) };
    case 'HERO_WOUNDED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histHeroWound'), result: t('gm.histWoundsN', { count: e.woundCount }) };
    case 'CANCELLATION_ACTIVATED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCancellation'), result: 'â€”' };
    case 'PERSISTENT_CARD_PLACED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histPersistentCard'), card: card(e.cardDefinitionId), result: e.trigger };
    case 'PERSISTENT_CARD_REMOVED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histPersistentRemoved'), result: 'â€”' };
    case 'ENEMY_DAMAGE_DISABLED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histEnemyDamageDisabled'), target: e.enemyInstanceId, result: 'â€”' };
    case 'MODIFIER_ADDED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histModifierAdded'), target: e.targetId, result: e.layer };
    case 'MODIFIER_EXPIRED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histModifierExpired'), result: e.modifierId };
    case 'CARD_MOVED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histCardMoved'), result: `${e.from} â†’ ${e.to}` };
    case 'CARD_REMOVED_FROM_GAME':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histCardRemoved'), result: '-' };
    case 'LEADER_TIE_BREAK':
      return { ...base, actor: actor(e.winnerId), action: t('gm.histLeaderTieBreak'), result: e.method === 'AGE' ? t('gm.histTieByAge') : t('gm.histTieRandom') };
    case 'DECK_SHUFFLED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histDeckShuffled'), result: e.deck };
    case 'HORDE_DECK_REORDERED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histHordeReordered'), result: '-' };
    case 'SUPPORT_DECK_OPENED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histSupportDeck'), result: `#${e.supportDeckIndex + 1}` };
    case 'WOUND_PLACED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histWoundPlaced'), target: e.enemyInstanceId, result: `${e.amount}` };
    case 'SHIELD_TRANSFERRED':
      return { ...base, actor: actor(e.fromPlayerId), action: t('gm.histShieldTransferred'), target: e.toPlayerId, result: `${e.amount}` };
    case 'CARDS_REVEALED_TO_PLAYER':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCardsRevealed'), result: t('gm.histCardsN', { count: e.cardInstanceIds.length }) };
    case 'BLOCK_GRANTED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histBlock'), result: t('gm.histBlockNext', { n: e.amount }) };
    case 'BLOCK_CONSUMED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histBlock'), result: t('gm.histBlockConsumed') };
    case 'LISTENER_REGISTERED':
      return { ...base, actor: actor(e.listener.playerId), action: t('gm.histListener'), result: e.listener.trigger };
    case 'LISTENER_REMOVED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histListenerRemoved'), result: '-' };
    case 'VARIABLE_SET':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histVariable'), result: `${e.name} = ${e.value}` };
    case 'RESOLUTION_HALTED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histResolutionHalted'), result: e.reason };
    case 'STATUS_APPLIED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histStatusApplied'), target: e.enemyInstanceId, result: `${e.status} Ã—${e.stacks}` };
    case 'STATUS_REMOVED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histStatusRemoved'), target: e.enemyInstanceId, result: e.status };
    case 'ARMOR_GRANTED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histArmor'), result: `+${e.amount}` };
    case 'HORDE_CARD_DISCARDED':
      return { ...base, actor: t('gm.histActorHorde'), action: t('gm.histHordeDiscarded'), result: '-' };
    case 'ENEMY_SPAWNED':
      return { ...base, actor: t('gm.histActorHorde'), action: t('gm.histEnemySpawned'), card: card(e.enemyDefinitionId), result: t('gm.histFortitudeN', { n: e.enemyFortitude }) };
    default:
      return null;
  }
}


function ZoneBoundary({ zone, children }: { zone: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <View style={{ padding: 12 }}>
          <Text style={[errorStyles.detail, { textAlign: 'left' }]}>
            {t('gm.zoneUnavailable', { zone, error: String(error?.message ?? error) })}
          </Text>
          <Pressable
            onPress={resetErrorBoundary}
            accessibilityRole="button"
            accessibilityLabel={t('gm.retryZone', { zone })}
            style={{ paddingVertical: 8, minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('gm.retry')}</Text>
          </Pressable>
        </View>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

function GameErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [diagCopied, setDiagCopied] = useState(false);
  const saveRecovery = useGameStore((s) => s.saveGame);
  const hasGame = useGameStore((s) => s.gameState !== null);
  captureError(error, { screen: 'game' });
  return (
    <View style={errorStyles.container}>
      <Text style={errorStyles.title}>{t('gm.errorTitle')}</Text>
      <Text style={errorStyles.detail}>
        {t('gm.errorSaveIntact')}{"\n\n"}{String(error?.message ?? error)}
      </Text>
      {hasGame && (
        <Pressable
          style={errorStyles.button}
          onPress={() => saveRecovery(t('gm.recoverySaveName', { date: new Date().toLocaleString() }))}
          accessibilityRole="button"
        >
          <Text style={errorStyles.buttonText}>{t('gm.errorSaveRecovery')}</Text>
        </Pressable>
      )}
      <Pressable
        style={[errorStyles.button, errorStyles.secondary]}
        onPress={() => {
          void Clipboard.setStringAsync("NT4H error: " + String(error?.stack ?? error))
            .then(() => setDiagCopied(true));
        }}
        accessibilityRole="button"
      >
        <Text style={errorStyles.buttonText}>{diagCopied ? t('gm.diagCopied') : t('gm.diagCopy')}</Text>
      </Pressable>
      <Pressable style={[errorStyles.button, errorStyles.secondary]} onPress={reset} accessibilityRole="button">
        <Text style={errorStyles.buttonText}>{t('gm.retry')}</Text>
      </Pressable>
      <Pressable style={[errorStyles.button, errorStyles.secondary]} onPress={() => router.push('/')} accessibilityRole="button">
        <Text style={errorStyles.buttonText}>{t('gm.backHome')}</Text>
      </Pressable>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  detail: { color: colors.textMuted, fontSize: 12, marginBottom: 16, textAlign: 'center' },
  button: { backgroundColor: colors.primary, padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 8, minWidth: 200 },
  secondary: { backgroundColor: colors.surfaceRaised },
  buttonText: { color: colors.text, fontWeight: 'bold' },
});

export default function GameScreen() {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <GameErrorFallback error={error} reset={resetErrorBoundary} />
      )}
    >
      <GameScreenInner />
    </ErrorBoundary>
  );
}
