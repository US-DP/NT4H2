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

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { ErrorBoundary } from 'react-error-boundary';
import { PlayerPanel } from '../../components/PlayerPanel';
import { PlayersSidebar } from '../../components/PlayersSidebar';
import { HordePanel } from '../../components/HordePanel';
import { DeckPanel } from '../../components/DeckPanel';
import { Battlefield } from '../../components/Battlefield';
import { HandView } from '../../components/HandView';
import { MarketView } from '../../components/MarketView';
import { SupportDecksView } from '../../components/SupportDecksView';
import { PrivacyScreen } from '../../components/PrivacyScreen';
import { PHASE_LABELS } from '../../lib/phaseLabels';
import { GameHeader } from '../../components/game/GameHeader';
import { PhaseIndicator } from '../../components/PhaseIndicator';
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
import { computeFinalScore, computeHordeAttackBreakdown } from '@nt4h/engine';
import { recordFinishedGame, configUsedCustom, loadHistory } from '../../lib/gameHistory';
import { useCustomContent } from '../../lib/customContent';
import { evaluateAchievements, newlyUnlocked, type Achievement } from '../../lib/achievements';
import { reportIfOptedIn, reportLeaderboardResult } from '../../lib/communityStats';
import { Swords, Hand, Coins, Info, ScrollText } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { buildContextualActions, buildInstruction } from './_shared/gameHelpers';
import { createStyles } from './_shared/gameStyles';
import { buildHistoryEntries } from './_shared/eventHistory';
import { FinishedScreen, ZoneBoundary, GameErrorFallback } from './_shared/auxScreens';

/** Pestañas del layout estrecho (móvil) */
type MobileTab = 'combat' | 'hand' | 'market' | 'status' | 'log';

// Etiquetas cortas: caben en barra móvil incluso con texto ampliado.
// A fontScale >= 1.5 solo la pestaña activa conserva el texto visible
// (el resto sigue accesible vía accessibilityLabel).
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
  // En web se omite (Wake Lock API exige gesto de usuario → error).
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
    // M-16: un espectador online no registró la partida — sin el guard,
    // viewerId=null caía sobre activePlayerId y la partida se grababa en
    // su historial/logros con estadísticas de otro jugador.
    const st = useGameStore.getState();
    const viewerPid = st.viewerId ?? gameState.activePlayerId;
    if ((st.connectionMode === 'online' && !st.online.playerId) || !(viewerPid in gameState.players)) return;
    historyRecorded.current = true;
    const scores = computeFinalScore(gameState.players);
    const { winners } = scores;
    const myScore = scores.players.find((sc) => sc.playerId === viewerPid);
    const online = st.connectionMode === 'online';
    // M-21: online no tiene initialConfig fiable (queda el de la última
    // partida local). contentScope se deriva de los sets del Taller
    // conocidos localmente: si alguna carta del log pertenece a un set
    // custom, la partida usó contenido custom.
    const customIds = new Set(
      useCustomContent.getState().sets.flatMap((s) => s.cards.map((c) => c.id)),
    );
    const usedCustomOnline = customIds.size > 0 && gameState.eventLog.some(
      (ev) => customIds.has((ev as { cardDefinitionId?: string }).cardDefinitionId ?? '')
        || customIds.has((ev as { definitionId?: string }).definitionId ?? ''),
    );
    const entry = {
      // M-17: id determinista — recordFinishedGame es idempotente por id,
      // así un remount de la pantalla en FINISHED no duplica el registro.
      id: online
        ? `h-on-${st.online.roomId}-${viewerPid}`
        : `h-lo-${initialConfig?.seed ?? 'x'}-${gameState.turnNumber}-${scores.players.map((s) => s.total).join('/')}`,
      endedAt: Date.now(),
      mode: gameState.mode ?? 'STANDARD',
      playerCount: Object.keys(gameState.players).length,
      winners: winners.map((w) => w.heroId),
      topScore: winners[0]?.total ?? 0,
      contentScope: ((online ? usedCustomOnline : configUsedCustom(initialConfig)) ? 'custom' : 'official') as 'official' | 'custom',
      heroesPlayed: (gameState.playerOrder ?? Object.keys(gameState.players))
        .map((pid) => gameState.players[pid]?.heroId)
        .filter((h): h is string => Boolean(h)),
      // M-19: escenarios JUGADOS (eventos reales), no el pool configurado.
      scenariosCount: gameState.eventLog.filter((ev) => ev.type === 'SCENARIO_REVEALED').length,
      // M-18: cooperativo — "sin heridas" es de equipo, no del ganador.
      flawless: scores.players.length > 0 && scores.players.every((p) => p.tenaz === 1),
      myHeroId: gameState.players[viewerPid]?.heroId,
      yourScore: myScore?.total,
      won: winners.some((w) => w.playerId === viewerPid),
      warlordsDefeated: gameState.warlordsDefeatedCount ?? 0,
      turnsTaken: gameState.turnNumber ?? 0,
      online,
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
      // Estadísticas de comunidad (anónimas; no-op si el usuario no optó)
      void reportIfOptedIn();
      // Clasificación pública (opt-in; NT4H es cooperativo → won = victoria del equipo)
      void reportLeaderboardResult(entry.won);
    })();
  }, [finishedPhase, gameState, initialConfig]);
  useEffect(() => {
    // Nueva partida → permitir registrar de nuevo
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
  // HORDE_ATTACKED (su seq). Reconexión o re-render no lo reabre.
  const [hordeSummaryAck, setHordeSummaryAck] = useState<string | null>(null);
  const [hordeManualOpen, setHordeManualOpen] = useState(false);
  // Comando contextual en vuelo (online): 'pending' hasta el ack;
  // el ack lleva el veredicto del motor (UI-123: confirmed/rejected) y
  // 'retrying' cuando el socket cambió mientras la acción seguía en vuelo
  // (reconexión — el comando encolado se drena tras el re-sync).
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionVerdict, setActionVerdict] = useState<{ id: string; ok: boolean } | null>(null);
  // Socket con el que se lanzó la acción pendiente: si cambia (nueva
  // conexión tras reconexión), la acción está en 'retrying', no 'pending'.
  const pendingSocket = useRef<WebSocket | null>(null);
  // cid del comando de la acción pendiente (null = no llegó a enviarse —
  // encolado o acción sin comando → cualquier ack la resuelve, como antes).
  const pendingCid = useRef<string | null>(null);
  const { width } = useWindowDimensions();
  const wide = width >= 1100;

  // Layout estrecho: pestañas contextuales en lugar de una columna única.
  // null = la pestaña sigue a la fase (mercado → Mercado, restablecimiento →
  // Mano, combate → Combate); al tocar una pestaña el usuario toma el control.
  const [mobileTabOverride, setMobileTabOverride] = useState<MobileTab | null>(null);
  // Auto-seguir la fase solo si el ajuste esta activo y el usuario no ha
  // elegido pestana manualmente en esta partida
  const autoFollowPhase = useSettings((s) => s.autoFollowPhaseTabs);
  const fontScale = useSettings((s) => s.fontScale);
  const hordeSummaryMode = useSettings((s) => s.hordeSummaryMode);

  // Estado de conexión real: refleja el socket en online (RECONNECTING/OFFLINE)
  const onlineSocketState = useGameStore((s) => s.online.socket);
  const onlineLastMsgAt = useGameStore((s) => s.online.lastMessageAt);
  // STALE: socket OPEN pero sin tráfico (ni pong del heartbeat) en >30s.
  // Se reevalúa cada 10s; la recuperación la hace el reconnect del store.
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
  void onlineLastMsgAt; // suscripción: re-renderiza al llegar mensajes
  const connectionState: ConnectionState = (() => {
    if (connectionMode !== 'online') return 'LOCAL';
    if (!onlineSocketState) return 'OFFLINE';
    switch (onlineSocketState.readyState) {
      case WebSocket.OPEN: return socketStale ? 'STALE' : 'CONNECTED';
      case WebSocket.CLOSED: return 'OFFLINE';
      default: return 'RECONNECTING';
    }
  })();

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

  // Atajos de teclado (web): 1-5 pestañas · h/e/c panel lateral · Esc cierra.
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
    // ← → mueve la selección por la mano del jugador en vista
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

  // Suscripción a mensajes del WebSocket (chat y comandos remotos).
  // Dependemos de online.socket: tras una reconexión el socket cambia y el
  // listener debe re-vincularse al nuevo (si no, el chat muere en silencio).
  const onlineSocket = useGameStore((s) => s.online.socket);
  useEffect(() => {
    if (connectionMode !== 'online' || !onlineSocket) return;
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'game.command_ack') {
          // Veredicto del motor sobre el comando pendiente: breve ✓/✕.
          // M-23: correlacionar por ref/cid — el ack de un comando encolado
          // distinto (drenado tras reconectar) no debe resolver la acción
          // pendiente actual ni mostrar su veredicto.
          const ackRef = (msg as { ref?: string }).ref;
          setPendingAction((id) => {
            if (id && (!pendingCid.current || !ackRef || ackRef === pendingCid.current)) {
              setActionVerdict({ id, ok: msg.accepted !== false });
              return null;
            }
            return id;
          });
          if (!pendingCid.current || !ackRef || ackRef === pendingCid.current) {
            pendingSocket.current = null;
            pendingCid.current = null;
          }
        } else if (msg.type === 'game.command_result') {
          // M-23: solo el resultado de NUESTRO comando resuelve la acción
          // pendiente — el broadcast del comando de un compañero la marcaba
          // como resuelta (spinner desaparecía sin veredicto real).
          const resultSender = (msg as { playerId?: string }).playerId;
          const resultCid = (msg as { cid?: string }).cid;
          const myPlayerId = useGameStore.getState().online.playerId;
          if (resultSender === myPlayerId
              && (!pendingCid.current || !resultCid || resultCid === pendingCid.current)) {
            setPendingAction(null);
            pendingSocket.current = null;
            pendingCid.current = null;
          }
        }
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
              ...(msg.meta ? { meta: msg.meta } : {}),
            },
          ]);
          // Badge de no leídos: el chat vive en su propia pestaña
          setUnreadChat((n) => n + 1);
        }
      } catch {
        // ignore
      }
    };
    onlineSocket.addEventListener('message', handler);
    return () => onlineSocket.removeEventListener('message', handler);
  }, [connectionMode, onlineSocket]);

  // UI-123: el veredicto (✓/✕) es una confirmación breve, no un estado
  // permanente — se limpia solo tras ~1.2s.
  useEffect(() => {
    if (!actionVerdict) return;
    const timer = setTimeout(() => setActionVerdict(null), 1200);
    return () => clearTimeout(timer);
  }, [actionVerdict]);

  // ── Espectador + reloj de turno + aviso de turno ────────────────────
  const onlinePlayerId = useGameStore((s) => s.online.playerId);
  const isSpectator = connectionMode === 'online' && !onlinePlayerId;

  // Reloj de turno: en online se ancla al timestamp autoritativo del
  // servidor (online.turnStartedAt, sincronizado en cada resync). En
  // local/hot-seat se usa el cambio de jugador activo con el reloj local.
  const activePid = gameState?.activePlayerId ?? null;
  const serverTurnAt = useGameStore((s) => s.online.turnStartedAt);
  const [turnElapsed, setTurnElapsed] = useState(0);
  useEffect(() => {
    const start = connectionMode === 'online' && serverTurnAt ? serverTurnAt : Date.now();
    const tick = () => setTurnElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [activePid, connectionMode, serverTurnAt]);

  // Aviso de turno (online): pestaña oculta o jugador distraído →
  // notificación del sistema + beep (permiso perezoso).
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

  const handleSendChat = useCallback((text: string, meta?: ChatMessage['meta']) => {
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
      // Estable entre reintentos: el servidor puede deduplicar por él
      clientMessageId: `cmid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...(meta ? { meta } : {}),
    };
    setChatMessages((prev) => [...prev, msg]);
    setChatDraft('');
    // En modo online, enviar por WebSocket — con estado de entrega visible
    if (connectionMode === 'online') {
      const socket = useGameStore.getState().online.socket;
      const ok = socket && socket.readyState === WebSocket.OPEN;
      if (ok) {
        try {
          socket.send(JSON.stringify({ type: 'chat.message', sender, text, timestamp: msg.timestamp, clientMessageId: msg.clientMessageId, ...(meta ? { meta } : {}) }));
        } catch {
          // send() puede lanzar si el socket se cierra entre la comprobación y el envío
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
        ...(failed.meta ? { meta: failed.meta } : {}),
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
    // La escritura es encolada — el indicador solo marca 'saved'
    // cuando la persistencia real confirma (antes era un falso
    // "guardado" ante fallo de almacenamiento).
    saveGame(name)
      .then((persisted) => {
        if (persisted) {
          setLastSavedAt(Date.now());
        }
        setSaveState(persisted ? 'saved' : 'error');
      })
      .catch(() => setSaveState('error'));
  }, [saveGame]);

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
  const startEvasion = useGameStore((s) => s.startEvasion);

  const handleSaveAndExit = useCallback(() => {
    handleSaveGame();
    setShowExitDialog(false);
    // Igual que salir sin guardar: la sesión online no sobrevive a la pantalla
    useGameStore.getState().disconnectOnline();
    router.push('/');
  }, [handleSaveGame, router]);

  // Foco por fase: cada zona principal se atenúa fuera de su momento.
  // La mesa no muestra todo con el mismo peso en todo momento.
  // NOTA hooks: todo esto está ANTES de los early-returns (!gameState,
  // privacyScreen, FINISHED) — ningún hook puede vivir tras un return.
  const marketActive = gameState?.phase === 'MARKET';

  // Layout estrecho: pestaña contextual según la fase
  const phaseTab: MobileTab = marketActive ? 'market'
    : gameState?.phase === 'RESTORATION' ||
      gameState?.phase === 'BATTLEFIELD_REPLENISHMENT' ||
      gameState?.phase === 'TURN_END' ? 'hand'
    : gameState?.phase === 'GAME_END_CHECK' ? 'status'
    : 'combat';

  // Seguimiento NO intrusivo: el auto-follow cede si el usuario está en
  // medio de una interacción (escribiendo en chat, carta ampliada,
  // diálogo abierto) — nunca le quita la pestaña de debajo de los dedos.
  const interactionBusy =
    chatDraft.trim().length > 0 || zoomCardId !== null ||
    detailHeroId !== null || showSaveModal || showExitDialog;
  const lastShownTabRef = useRef<MobileTab>('combat');
  const mobileTab: MobileTab = mobileTabOverride
    ?? (autoFollowPhase && !interactionBusy ? phaseTab : lastShownTabRef.current);
  useEffect(() => { lastShownTabRef.current = mobileTab; }, [mobileTab]);

  // El override manual dura el turno actual: al empezar el siguiente la
  // pestaña vuelve a seguir a la fase (evita quedarse "atascado")
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
  // motor (computeHordeAttackBreakdown) — la UI solo lo representa, sin
  // recalcular fortalezas, Anti-Magia, escudos ni prevención.
  const hordeBreakdown = catalog
    ? computeHordeAttackBreakdown(gameState, catalog)
    : null;
  const hordeIncoming = hordeBreakdown?.enemyLines
    .reduce((sum, l) => sum + l.finalDamage, 0) ?? 0;
  const hordeAfterDefense = hordeBreakdown?.finalExhaustion ?? 0;
  // Identidad del asalto: seq del último HORDE_ATTACKED; si la fase aún no
  // resolvió (ventana de reacción), se usa el turno como clave provisional
  let lastHordeSeq: number | null = null;
  for (let i = gameState.eventLog.length - 1; i >= 0; i--) {
    const e = gameState.eventLog[i];
    if (e.type === 'HORDE_ATTACKED') { lastHordeSeq = e.seq; break; }
  }
  const hordeResolutionId = lastHordeSeq !== null
    ? `horde-${lastHordeSeq}`
    : `horde-pending-${gameState.turnNumber}`;
  // Apertura automática según preferencia: 'always' siempre, 'modifiers'
  // solo si el cálculo no es trivial (Anti-Magia, bonus, anulados, defensas,
  // anulación o Feldon), 'never' nunca (el banner sigue disponible)
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

  // Construir acciones contextuales según fase (UI-120)
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
  ).map((a): ContextualAction => ({
    // UI-123: estado de la acción — 'offline' con socket caído,
    // 'pending' en vuelo, 'retrying' tras reconectar con el comando
    // encolado, 'confirmed'/'rejected' con el veredicto del command_ack.
    ...a,
    state: pendingAction === a.id
      ? (onlineSocket?.readyState !== WebSocket.OPEN
        ? 'offline'
        : pendingSocket.current !== null && pendingSocket.current !== onlineSocket
          ? 'retrying'
          : 'pending')
      : actionVerdict?.id === a.id
        ? (actionVerdict.ok ? 'confirmed' : 'rejected')
        : connectionMode === 'online' && onlineSocket?.readyState !== WebSocket.OPEN
          ? 'offline'
          : undefined,
    onPress: connectionMode === 'online'
      ? () => {
          pendingSocket.current = onlineSocket;
          setPendingAction(a.id);
          // Capturar el cid asignado por sendOnlineCommand (diff de
          // lastCid: si no cambió, el comando quedó encolado o la acción
          // no envía comando — en ambos casos cualquier ack la resuelve).
          const cidBefore = useGameStore.getState().online.lastCid;
          a.onPress();
          const cidAfter = useGameStore.getState().online.lastCid;
          pendingCid.current = cidAfter !== cidBefore ? cidAfter : null;
        }
      : a.onPress,
  }));

  // Instrucción concreta (UI-073)
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
      {/* Apoyos (SOLO): se abren/compran en fase de Ataque, no en Mercado —
          por eso van bajo el MarketView aunque son un sistema aparte */}
      <SupportDecksView />
    </View>
  );

  const secondaryActions = (
    <View style={styles.secondaryActions}>
      <Button variant="secondary" label={t('gm.save')} onPress={() => setShowSaveModal(true)} />
    </View>
  );

  // Historial, estado y chat como pestañas separadas (no mezclar log
  // funcional con conversación social). El badge muestra mensajes no leídos.
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
            onEntryPress={(entry) => {
              if (entry.linkTo === 'horde') setHordeManualOpen(true);
            }}
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
      {/* Cabecera: logo | turno/fase/jugador | conexión | salir */}
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

      {/* UI-071: progreso Ataque/Mercado/Restablecimiento (el
          componente solo existia en el showcase dev). */}
      <PhaseIndicator phase={gameState.phase} />

      {/* Zona única de avisos: la prioridad decide cuál se muestra */}
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
            {skipPending ? '…' : t('gm.skipAfk')}
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

            {/* Núcleo: enemigos en mesa + mercado */}
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

      {/* Pie persistente: recursos (mazo = energía) + acción principal */}
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
          // Las pericias restantes del DUEÑO del héroe, no del jugador
          // activo — antes mostraba las uses equivocadas al inspeccionar
          // el héroe de otro jugador.
          detailHeroId
            ? Object.values(gameState.players).find((p) => p.heroId === detailHeroId)?.heroUsesRemaining
            : undefined
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
          // Cerrar la sesión online: antes el socket (heartbeat +
          // reconexión) quedaba vivo tras salir de la pantalla.
          useGameStore.getState().disconnectOnline();
          router.push('/');
        }}
        onAbandon={() => {
          setShowExitDialog(false);
          // "Abandonar" ≠ "Salir": online se llama /leave/ para que el
          // backend cuente games_abandoned y libere el asiento (broadcast
          // room.player_left). Salir sin abandonar solo cierra el socket
          // y la sesión sigue recuperable.
          const st = useGameStore.getState();
          const { roomId: rid, playerId: pid, playerToken: tok } = st.online;
          if (connectionMode === 'online' && rid && pid) {
            void fetchWithTimeout(`${API_BASE}/rooms/${rid}/leave/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playerId: pid, playerToken: tok }),
            }).catch(() => {});
          }
          st.disconnectOnline();
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
        ].filter(Boolean).join(' · ')}
      />
    </View>
  );
}

/** Construye las acciones contextuales según la fase (UI-120). */
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
