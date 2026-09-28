/**
 * Pantalla de sala multijugador.
 *
 * Cumple UI-060: copiar código de sala.
 * Cumple UI-061: estado de jugadores.
 * Cumple UI-062: anfitrión distinguible.
 * Cumple UI-063: botón iniciar explicado.
 * Cumple UI-064: cambios en tiempo real (WebSocket).
 * Cumple UI-066: chat contraíble.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Switch, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useGameStore } from '../../store/gameStore';
import { toast } from '../../lib/toast';
import { useSettings } from '../../store/settingsStore';
import { useTranslation } from 'react-i18next';
import { ChatPanel, type ChatMessage } from '../../components/ChatPanel';
import { API_BASE, WS_BASE, fetchWithTimeout } from '../../lib/config';
import { authHeaders } from '../../lib/auth';
import { loadRoomSession, saveRoomSession, clearRoomSession } from '../../lib/roomSession';
import { NtDialog } from '../../components/ui/NtDialog';
import { useColors, useFs } from '../../lib/useTheme';
import { fontSize } from '../../lib/theme';
import { checkCompatibility } from '../../lib/compat';
import { useCustomContent, customDecks } from '../../lib/customContent';
import { deckToConfigEntry } from '@nt4h/catalog';

interface JoinForm {
  roomCode: string;
  playerName: string;
}

interface PlayerInfo {
  playerId: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  heroId: string;
  /** Mazo de habilidades elegido (deckId) y cara del héroe */
  deckId?: string;
  /** Mazo del Taller (customDeckId): si existe, sustituye a deckId. */
  customDeckId?: string;
  heroFace?: string;
  /** Preparado para iniciar (invitados). Ausente en backends antiguos */
  ready?: boolean;
}

interface RoomInfo {
  roomId: string;
  mode: string;
  status: string;
  hostId: string;
  maxPlayers: number;
  players: PlayerInfo[];
  /** Config persistida (catálogo, motor, manifiesto y sets del host) */
  config?: {
    catalogVersion?: string;
    engineVersion?: string;
    contentManifest?: { id: string; name: string; version: string }[];
    customSets?: unknown[];
  };
  /** Ids expulsados (el host los ve para poder «Permitir volver») */
  kickedIds?: string[];
  /** Revisión monotónica del servidor (anti-stale) */
  revision?: number;
}

export default function RoomScreen() {
  const router = useRouter();
  const colors = useColors();
  const fs = useFs();
  const { t } = useTranslation();
  // El token NUNCA viaja por URL (historial, logs, enlaces compartidos):
  // llega por el store o se restaura desde SecureStore (saveRoomSession)
  const params = useLocalSearchParams<{ roomId?: string; playerId?: string }>();
  const roomId = params.roomId;
  const setGameState = useGameStore((s) => s.setGameState);
  const setConnectionMode = useGameStore((s) => s.setConnectionMode);
  const connectOnline = useGameStore((s) => s.connectOnline);
  const connectSpectator = useGameStore((s) => s.connectSpectator);
  const [localRoomId, setLocalRoomId] = useState(roomId ?? '');
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [playerName, setPlayerName] = useState(t('lobby.player'));
  // D431: si venimos de crear la sala, ya somos miembros (host) con token
  const [playerId] = useState(params.playerId || `p-${Date.now()}`);
  const isCreator = Boolean(useGameStore.getState().online.playerToken);
  const [error, setError] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  // Feedback visible al copiar el código (UI-060)
  const [copied, setCopied] = useState(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  // Elección del invitado: héroe, clase (mazo) y cara. Sin héroe+mazo el
  // backend no puede incluirlo en el roster del motor al iniciar.
  const catalog = useGameStore((s) => s.catalog);
  const [joinHeroId, setJoinHeroId] = useState('');
  const [joinDeckClass, setJoinDeckClass] = useState('EXPLORER');
  const [joinHeroFace, setJoinHeroFace] = useState<'FEMALE' | 'MALE'>('FEMALE');
  // Mazo del Taller (opcional): sustituye al mazo de clase. Solo se ofrecen
  // mazos cuyas cartas resuelven en el catálogo de la sala (oficial + sets
  // del host) — si no, el runner rechazaría la baraja al iniciar.
  const [joinCustomDeckId, setJoinCustomDeckId] = useState('');
  const eligibleCustomDecks = useMemo(() => {
    const knownIds = new Set<string>([...(catalog?.byId.keys() ?? [])]);
    for (const s of (room?.config?.customSets ?? []) as { cards?: { id: string }[] }[]) {
      for (const c of s.cards ?? []) knownIds.add(c.id);
    }
    return customDecks().filter((d) =>
      d.cardEntries.every((e) => knownIds.has(e.cardDefinitionId)));
  }, [catalog, room?.config?.customSets]);
  // D431: token emitido por el backend al unirse — necesario para
  // autenticar el WebSocket y las acciones (start, estado proyectado)
  const [playerToken, setPlayerToken] = useState(
    useGameStore.getState().online.playerToken ?? ''
  );
  const [socketOpen, setSocketOpen] = useState(false);
  // Latencia RTT del socket de lobby (ping cada 15s → pong)
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const pingSentAtRef = useRef(0);
  // Roster accesible desde handlers WS (evita closures obsoletas)
  const roomRef = useRef<RoomInfo | null>(null);
  useEffect(() => { roomRef.current = room; }, [room]);
  const [readyPending, setReadyPending] = useState(false);
  // Revisiones de sala: respuestas REST o broadcasts con revisión <= a la
  // última aplicada se descartan (evita que un poll lento pise un estado
  // más nuevo recibido por WebSocket).
  const lastRevisionRef = useRef(-1);
  // Compatibilidad de catálogo/motor: si la sala fue creada con versiones
  // distintas, se avisa una vez (no se bloquea — el contenido custom puede
  // diferir legítimamente, pero el jugador debe saberlo)
  const catalogWarnedRef = useRef(false);
  const manifestWarnedRef = useRef(false);
  const [compatBlocked, setCompatBlocked] = useState<string | null>(null);
  // Sets del host que faltan en este dispositivo (bloquea 'listo'/iniciar)
  const [missingSets, setMissingSets] = useState<string[]>([]);
  const checkCatalogCompat = useCallback((r: RoomInfo) => {
    const cfg = (r as {
      config?: {
        catalogVersion?: string;
        engineVersion?: string;
        contentManifest?: { id: string; name: string; version: string }[];
      };
    }).config;
    // Manifiesto de contenido del host: estado persistente (no un aviso
    // único) — bloquea 'listo'/iniciar hasta que el set esté instalado.
    if (cfg?.contentManifest?.length) {
      const installed = new Set(
        useCustomContent.getState().sets.map((s) => `${s.id}@${s.version}`),
      );
      const missing = cfg.contentManifest.filter(
        (s) => !installed.has(`${s.id}@${s.version}`),
      );
      const names = missing.map((ms) => `${ms.name} v${ms.version}`);
      setMissingSets(names);
      if (names.length > 0 && !manifestWarnedRef.current) {
        manifestWarnedRef.current = true;
        setError(t('room.missingSets', { sets: names.join(', ') }));
      }
    } else {
      setMissingSets([]);
    }
    const compat = checkCompatibility(cfg);
    // Incompatible (motor distinto / catálogo major distinto): motivo estructurado
    if (!compat.compatible) {
      setCompatBlocked(
        t(`room.incompat.${compat.reason}`, {
          host: compat.reason === 'ENGINE_MISMATCH'
            ? compat.hostVersion.engine
            : compat.hostVersion.catalog,
          local: compat.reason === 'ENGINE_MISMATCH'
            ? compat.clientVersion.engine
            : compat.clientVersion.catalog,
        }),
      );
      return;
    }
    setCompatBlocked(null);
    // Compatible con diferencias menores: aviso una sola vez
    if (catalogWarnedRef.current || compat.reason !== 'CATALOG_VERSION_DIFFERS') return;
    catalogWarnedRef.current = true;
    setError(t('room.catalogMismatch', {
      issues: t('lobby.catalogIssue', {
        host: compat.hostVersion.catalog,
        local: compat.clientVersion.catalog,
      }),
    }));
  }, [t]);

  const applyRoomState = useCallback((next: RoomInfo | null) => {
    if (!next) { setRoom(null); return; }
    checkCatalogCompat(next);
    const rev = next.revision ?? 0;
    if (rev <= lastRevisionRef.current) return;
    lastRevisionRef.current = rev;
    setRoom(next);
  }, [checkCatalogCompat]);
  // Socket del lobby: se cierra al desmontar o antes de abrir otro
  const lobbySocketRef = useRef<WebSocket | null>(null);
  // Marca de vida del socket: si está abierto pero no llega nada en 30s,
  // se considera STALE → polling de respaldo + reconexión
  const lastMsgAtRef = useRef(Date.now());
  // clientMessageIds enviados (eco optimista → dedupe del broadcast)
  const sentCmidsRef = useRef<Set<string>>(new Set());
  // Cleanup de connectOnline (heartbeat + reconnect + socket del juego)
  const onlineCleanupRef = useRef<(() => void) | null>(null);

  // Formulario de unirse (react-hook-form + zod)
  // El nombre se precarga desde el perfil (settings.displayName)
  const profileName = useSettings((s) => s.displayName);
  const mutedChatSenders = useGameStore((s) => s.mutedChatSenders);
  const toggleMuteChatSender = useGameStore((s) => s.toggleMuteChatSender);
  const importSet = useCustomContent((s) => s.importSet);
  // Mensajes de validación traducidos: el schema se crea por render para
  // que siga el idioma activo
  const joinSchema = z.object({
    roomCode: z.string().trim().min(1, t('lobby.errRoomCode')),
    playerName: z.string().trim().min(2, t('lobby.errPlayerName')),
  });
  const { control, handleSubmit, formState: { errors } } = useForm<JoinForm>({
    resolver: zodResolver(joinSchema),
    defaultValues: { roomCode: roomId ?? '', playerName: profileName || t('lobby.player') },
  });

  // TanStack Query: estado de la sala con caché. El polling cada 5s es SOLO
  // fallback: cuando el WebSocket está abierto las actualizaciones llegan por
  // broadcast (player_ready, joins) y el polling queda desactivado para no
  // competir ni pisar estados más recientes.
  const { data: roomData } = useQuery<RoomInfo>({
    queryKey: ['room', localRoomId],
    enabled: Boolean(localRoomId && room),
    queryFn: async () => {
      // Config privada (customSets del host) solo para miembros: el
      // backend la sirve cuando autenticamos con playerId+token.
      const url = playerToken
        ? `${API_BASE}/rooms/${localRoomId}/?playerId=${encodeURIComponent(playerId)}`
        : `${API_BASE}/rooms/${localRoomId}/`;
      const res = await fetchWithTimeout(
        url,
        playerToken ? { headers: { 'X-Player-Token': playerToken } } : undefined,
      );
      if (!res.ok) throw new Error(t('lobby.errLoadRoom'));
      return res.json() as Promise<RoomInfo>;
    },
    refetchInterval: socketOpen ? false : 5000,
  });
  useEffect(() => {
    if (roomData) applyRoomState(roomData);
  }, [roomData, applyRoomState]);

  // P0: el WS se autentica con un ticket efímero (un solo uso, ~60s),
  // no con el token de larga vida — evita que el token quede en URLs,
  // logs de proxy, historiales o capturas de diagnóstico.
  const connect = useCallback(async (token: string) => {
    lobbySocketRef.current?.close();
    let ticket: string;
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/ws-ticket/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, playerToken: token }),
      });
      if (!res.ok) throw new Error('ticket');
      ticket = (await res.json()).ticket;
    } catch {
      setError(t('lobby.errWsAuth'));
      return;
    }
    const ws = new WebSocket(`${WS_BASE}/game/${localRoomId}/?ticket=${encodeURIComponent(ticket)}`);
    lobbySocketRef.current = ws;
    lastMsgAtRef.current = Date.now();
    ws.onopen = () => {
      setSocketOpen(true);
      pingSentAtRef.current = Date.now();
      ws.send(JSON.stringify({ type: 'ping' }));
    };
    ws.onclose = () => setSocketOpen(false);
    ws.onmessage = (event) => {
      lastMsgAtRef.current = Date.now();
      let msg: { type?: string; sender?: string; text?: string; timestamp?: number; command?: string; playerId?: string; ready?: boolean; roomRevision?: number };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // frame malformado — ignorar
      }
      if (msg.type === 'pong') {
        // RTT del heartbeat de lobby — alimenta el indicador de latencia
        if (pingSentAtRef.current) {
          setLatencyMs(Date.now() - pingSentAtRef.current);
          pingSentAtRef.current = 0;
        }
        return;
      }
      // Anti-stale: descartar broadcasts con revisión más antigua que la
      // última vista completa aplicada (p. ej. un kick WS vs un poll REST)
      if (typeof msg.roomRevision === 'number') {
        if (msg.roomRevision <= lastRevisionRef.current) return;
        lastRevisionRef.current = msg.roomRevision;
      }
      if (msg.type === 'chat.message') {
        // Eco del servidor: si lleva un clientMessageId nuestro ya está en
        // pantalla (envío optimista) — no duplicar
        const m = msg as { clientMessageId?: string; messageId?: string; seq?: number };
        if (m.clientMessageId && sentCmidsRef.current.has(m.clientMessageId)) return;
        const chat: ChatMessage = {
          id: m.messageId ?? `chat-${Date.now()}`,
          sender: msg.sender ?? t('lobby.player'),
          text: msg.text ?? '',
          type: 'USER',
          timestamp: msg.timestamp ?? Date.now(),
        };
        setChatMessages((prev) => [...prev, chat]);
      } else if (msg.type === 'room.player_ready') {
        // Broadcast del backend: actualizar el flag sin esperar al polling
        setRoom((prev) => prev ? {
          ...prev,
          players: prev.players.map((p) =>
            p.playerId === msg.playerId ? { ...p, ready: msg.ready === true } : p
          ),
        } : prev);
      } else if (msg.type === 'game.command') {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            sender: t('lobby.system'),
            text: t('lobby.sysCommand', { command: msg.command ?? '', playerId: msg.playerId ?? '' }),
            type: 'SYSTEM',
            timestamp: Date.now(),
          },
        ]);
      } else if (msg.type === 'room.player_kicked') {
        // D440: expulsión — fuera del roster y veto persistente (kicked_ids)
        const kickedName = roomRef.current?.players.find((p) => p.playerId === msg.playerId)?.name ?? msg.playerId ?? t('lobby.player');
        setRoom((prev) => prev ? {
          ...prev,
          players: prev.players.filter((p) => p.playerId !== msg.playerId),
        } : prev);
        setChatMessages((prev) => [
          ...prev,
          { id: `sys-kick-${Date.now()}`, sender: t('lobby.system'), text: t('room.sysKicked', { name: kickedName }), type: 'SYSTEM', timestamp: Date.now() },
        ]);
        if (msg.playerId === playerId) {
          setRoom(null);
          void clearRoomSession();
          setError(t('room.youWereKicked'));
        }
      } else if (msg.type === 'room.player_left') {
        const name = roomRef.current?.players.find((p) => p.playerId === msg.playerId)?.name ?? msg.playerId ?? t('lobby.player');
        setRoom((prev) => prev ? {
          ...prev,
          players: prev.players.filter((p) => p.playerId !== msg.playerId),
        } : prev);
        // Distinguir abandono de expulsión en el registro visible
        setChatMessages((prev) => [
          ...prev,
          { id: `sys-left-${Date.now()}`, sender: t('lobby.system'), text: t('room.sysLeft', { name }), type: 'SYSTEM', timestamp: Date.now() },
        ]);
      } else if (msg.type === 'room.host_changed') {
        const newHost = roomRef.current?.players.find((p) => p.playerId === msg.playerId)?.name ?? msg.playerId ?? t('lobby.player');
        setChatMessages((prev) => [
          ...prev,
          { id: `sys-host-${Date.now()}`, sender: t('lobby.system'), text: t('room.sysHost', { name: newHost }), type: 'SYSTEM', timestamp: Date.now() },
        ]);
        // Transferencia/auto-promoción: nuevo anfitrión en el roster.
        // Si soy yo, el toast lo avisa.
        setRoom((prev) => prev ? {
          ...prev,
          hostId: msg.playerId ?? prev.hostId,
          players: prev.players.map((pl) => ({ ...pl, isHost: pl.playerId === msg.playerId })),
        } : prev);
        if (msg.playerId === playerId) {
          toast.show(t('lobby.youAreHost'));
        }
      } else if (msg.type === 'room.closed') {
        // El anfitrión cerró la sala — desmontar y limpiar sesión
        setRoom(null);
        void clearRoomSession();
        setError(t('room.roomClosedByHost'));
      }
    };
    ws.onerror = () => {
      setSocketOpen(false);
      setError(t('lobby.errWs'));
    };
    setSocket(ws);
    return ws;
  }, [localRoomId, playerId, t]);

  // Watchdog de socket obsoleto: abierto pero sin tráfico → el polling se
  // reactiva (socketOpen=false) y se intenta una reconexión limpia
  useEffect(() => {
    const t = setInterval(() => {
      if (socketOpen && Date.now() - lastMsgAtRef.current > 30_000) {
        setSocketOpen(false);
        lobbySocketRef.current?.close();
        lobbySocketRef.current = null;
        if (playerToken) void connect(playerToken);
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [socketOpen, playerToken, connect]);

  // Ping periódico del lobby: mantiene el watchdog despierto y mide RTT
  useEffect(() => {
    if (!socketOpen) return;
    const t = setInterval(() => {
      const ws = lobbySocketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        pingSentAtRef.current = Date.now();
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15_000);
    return () => clearInterval(t);
  }, [socketOpen]);

  // Restaurar sesión guardada (SecureStore): si el usuario recargó la app
  // estando en una sala, recuperamos su token sin pasar por join otra vez
  useEffect(() => {
    if (playerToken || !localRoomId) return;
    void (async () => {
      const saved = await loadRoomSession();
      if (saved && saved.roomId === localRoomId) {
        setPlayerToken(saved.playerToken);
        setConnectionMode('online', saved.roomId, saved.playerId, saved.playerToken);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localRoomId]);

  // D431: el creador ya es miembro (host) — cargar la sala y conectar sin join
  useEffect(() => {
    if (!isCreator || !localRoomId || !playerToken) return;
    void (async () => {
      try {
        const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/`);
        const data = await res.json();
        if (res.ok) applyRoomState(data);
        void connect(playerToken);
      } catch {
        setError(t('lobby.errLoadRoom'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerToken]);

  // Al salir de la sala: cerrar el socket del lobby y la conexión del juego
  useEffect(() => {
    return () => {
      lobbySocketRef.current?.close();
      lobbySocketRef.current = null;
      onlineCleanupRef.current?.();
      onlineCleanupRef.current = null;
    };
  }, []);

  const joinRoom = async (values: JoinForm) => {
    const code = values.roomCode;
    if (!joinHeroId) {
      setError(t('lobby.errPickHero'));
      return;
    }
    setLocalRoomId(code);
    setPlayerName(values.playerName);
    setJoining(true);
    setError('');
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${code}/join/`, {
        method: 'POST',
        // Con sesión activa el backend vincula el Player a la cuenta.
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          playerId,
          name: values.playerName,
          playerToken: playerToken || undefined,
          heroId: joinHeroId,
          heroFace: joinHeroFace,
          deckId: `${joinDeckClass.toLowerCase()}.default`,
          // Mazo del Taller: el snapshot viaja en el join y el backend lo
          // registra en session.config.customDecks para el runner.
          ...(joinCustomDeckId ? (() => {
            const deck = eligibleCustomDecks.find((d) => d.id === joinCustomDeckId);
            return deck
              ? { customDeckId: deck.id, customDeck: deckToConfigEntry(deck) }
              : {};
          })() : {}),
        }),
      });
      const data = await res.json();
      // D440: identidad vetada por el anfitrión
      if (data.kicked) throw new Error(t('lobby.errKicked'));
      if (!res.ok) throw new Error(data.error || t('lobby.errJoin'));
      applyRoomState(data.room);
      // D431: guardar el token devuelto por el backend
      const token = data.authToken ?? '';
      setPlayerToken(token);
      void saveRoomSession({ roomId: code, playerId, playerToken: token });
      void connect(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lobby.errGeneric'));
    } finally {
      setJoining(false);
    }
  };

  const startGame = async () => {
    if (!localRoomId || starting) return;
    setStarting(true);
    setError('');
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/start/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, playerToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('lobby.errStart'));
      applyRoomState(data.room);

      // Load engine state — vista proyectada para este jugador (RF-J095).
      // Token por header, nunca por query param.
      const stateRes = await fetchWithTimeout(
        `${API_BASE}/rooms/${localRoomId}/engine/?playerId=${encodeURIComponent(playerId)}`,
        { headers: { 'X-Player-Token': playerToken } },
      );
      const stateData = await stateRes.json();
      if (stateData.state) {
        setGameState(stateData.state);
        setConnectionMode('online', localRoomId, playerId, playerToken, roomRef.current?.hostId);
        // D422: connectOnline espera playerId (para firmar comandos), no el nombre.
        // Guardar el cleanup para cerrar heartbeat/reconnect al salir.
        onlineCleanupRef.current = connectOnline(localRoomId, playerId, playerToken);
        router.push('/(game)');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lobby.errGeneric'));
    } finally {
      setStarting(false);
    }
  };

  // Expulsar a un invitado (solo host, sala en espera). Requiere
  // confirmación: es irreversible para esa sesión de sala (D440).
  const [kickTarget, setKickTarget] = useState<{ id: string; name: string } | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [kicking, setKicking] = useState(false);
  const kickPlayer = async (targetId: string) => {
    if (kicking) return;
    setKicking(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/kick/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, playerToken, targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('lobby.errKick'));
      applyRoomState(data.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lobby.errGeneric'));
    } finally {
      setKicking(false);
    }
  };

  // Permitir volver: levanta el veto a un expulsado (solo host, WAITING)
  const unkickPlayer = async (targetId: string) => {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/unkick/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, playerToken, targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('lobby.errUnkick'));
      applyRoomState(data.room);
      toast.show(t('room.unkicked'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lobby.errGeneric'));
    }
  };

  // Transferir anfitrión (menú de moderación): cede el rol sin expulsar
  const [transferring, setTransferring] = useState(false);
  const transferHost = async (targetId: string) => {
    if (transferring) return;
    setTransferring(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/transfer-host/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, playerToken, targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('lobby.errTransfer'));
      applyRoomState(data.room);
      toast.show(t('room.hostTransferred'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lobby.errGeneric'));
    } finally {
      setTransferring(false);
    }
  };

  // Cerrar sala: broadcast room.closed y borrado en el backend
  const [closing, setClosing] = useState(false);
  const closeRoom = async () => {
    if (closing) return;
    setClosing(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/close/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, playerToken }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('lobby.errClose'));
      }
      void clearRoomSession();
      router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lobby.errGeneric'));
    } finally {
      setClosing(false);
    }
  };

  // Invitado que abandona la sala (WAITING): el backend lo quita del
  // roster al instante en vez de quedar "desconectado" hasta el reaper.
  const leaveRoom = async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/leave/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, playerToken }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('lobby.errGeneric'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lobby.errGeneric'));
      return;
    }
    void clearRoomSession();
    router.push('/');
  };

  // Enlace de invitación (web): /rooms/CODIGO abre la pantalla intermedia
  // (nunca une automáticamente — el invitado decide)
  const copyRoomLink = () => {
    const origin = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
    const link = origin ? `${origin}/rooms/${localRoomId}` : localRoomId;
    void Clipboard.setStringAsync(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.show(t(origin ? 'room.linkCopied' : 'room.codeCopied'));
    });
  };

  const copyRoomCode = () => {
    void Clipboard.setStringAsync(localRoomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.show(t('room.codeCopied'));
    });
  };

  // Sala en curso: los miembros reingresan como jugadores; el resto puede
  // mirar como espectador (vista proyectada pública, sin comandos).
  const enterGame = async () => {
    try {
      const stateRes = await fetchWithTimeout(
        `${API_BASE}/rooms/${localRoomId}/engine/?playerId=${encodeURIComponent(playerId)}`,
        { headers: { 'X-Player-Token': playerToken } },
      );
      const stateData = await stateRes.json();
      if (stateData.state) {
        setGameState(stateData.state);
        setConnectionMode('online', localRoomId, playerId, playerToken, roomRef.current?.hostId);
        onlineCleanupRef.current = connectOnline(localRoomId, playerId, playerToken);
        router.push('/(game)');
      }
    } catch {
      setError(t('lobby.errGeneric'));
    }
  };

  const spectate = () => {
    connectSpectator(localRoomId);
    router.push('/(game)');
  };

  // Instalar en este dispositivo los sets del Taller que el host declaró
  // (el runner ya los fusiona para la partida; esto los deja en la
  // biblioteca local para verlos/crearlos fuera de la sala).
  const installHostSets = () => {
    const sets = room?.config?.customSets ?? [];
    let ok = 0;
    let failed = 0;
    for (const s of sets) {
      const errs = importSet(s);
      if (errs.length === 0) ok++; else failed++;
    }
    setMissingSets([]);
    // El catálogo en memoria se cargó antes del import: recargarlo para
    // que los ids de las cartas del host dejen de verse crudos.
    useGameStore.getState().initCatalog();
    toast.show(failed === 0
      ? t('room.setsInstalled', { count: ok })
      : t('room.setsInstallPartial', { ok, failed }));
    if (room) checkCatalogCompat(room);
  };

  const sendChat = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (socket && socket.readyState === WebSocket.OPEN) {
      // El servidor asigna sender/tipo/seq/timestamp; el cliente solo envía
      // texto + clientMessageId (idempotencia ante reintentos)
      const cmid = `cmid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sentCmidsRef.current.add(cmid);
      socket.send(JSON.stringify({ type: 'chat.message', clientMessageId: cmid, text: trimmed }));
      // Eco optimista: se muestra ya; el broadcast con este cmid se ignora
      setChatMessages((prev) => [
        ...prev,
        {
          id: cmid,
          sender: playerName || t('lobby.you'),
          text: trimmed,
          type: 'USER',
          timestamp: Date.now(),
        },
      ]);
    }
    setChatDraft('');
  };

  // Preparado: el invitado marca/desmarca su estado; el host lo tiene implícito
  const toggleReady = async () => {
    if (readyPending) return; // evita doble toque mientras la petición viaja
    const me = room?.players.find((p) => p.playerId === playerId);
    const next = !(me?.ready ?? false);
    setReadyPending(true);
    // Optimista: el broadcast del backend confirmará; revertir si falla
    setRoom((prev) => prev ? {
      ...prev,
      players: prev.players.map((p) => p.playerId === playerId ? { ...p, ready: next } : p),
    } : prev);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/ready/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, playerToken, ready: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('lobby.errReady'));
      if (data.room) applyRoomState(data.room);
    } catch (e) {
      setRoom((prev) => prev ? {
        ...prev,
        players: prev.players.map((p) => p.playerId === playerId ? { ...p, ready: !next } : p),
      } : prev);
      setError(e instanceof Error ? e.message : t('lobby.errGeneric'));
    } finally {
      setReadyPending(false);
    }
  };

  const isHost = room?.hostId === playerId;
  const me = room?.players.find((p) => p.playerId === playerId);
  // Backends antiguos no devuelven `ready`: tratar undefined como preparado
  // para no bloquear el inicio con un servidor desactualizado.
  const notReadyCount = room
    ? room.players.filter((p) => !p.isHost && p.ready === false).length
    : 0;
  const canStart = isHost && room && room.players.length >= 1
    && room.status === 'WAITING' && notReadyCount === 0;

  if (!room) {
    return (
      <ScrollView style={styles.container}>
        <Text style={styles.title}>{t('room.joinTitle')}</Text>
        <Controller
          control={control}
          name="roomCode"
          render={({ field: { value, onChange } }) => (
            <TextInput
              style={[styles.input, errors.roomCode && styles.inputError]}
              value={value}
              onChangeText={onChange}
              placeholder={t('room.codePlaceholder')}
              placeholderTextColor="#777"
              autoCapitalize="characters"
              accessibilityLabel={t('room.codePlaceholder')}
            />
          )}
        />
        {errors.roomCode && <Text style={styles.error}>{errors.roomCode.message}</Text>}
        <Controller
          control={control}
          name="playerName"
          render={({ field: { value, onChange } }) => (
            <TextInput
              style={[styles.input, errors.playerName && styles.inputError]}
              value={value}
              onChangeText={onChange}
              placeholder={t('lobby.namePlaceholder')}
              placeholderTextColor="#777"
              accessibilityLabel={t('room.yourName')}
            />
          )}
        />
        {errors.playerName && <Text style={styles.error}>{errors.playerName.message}</Text>}
        {/* Héroe + clase + cara del invitado: el roster del motor se
            construye con la elección de cada miembro al iniciar */}
        <Text style={[styles.sectionTitle, { color: colors.info, fontSize: fs(fontSize.body) }]}>
          {t('lobby.pickHero')}
        </Text>
        <ScrollView horizontal style={styles.heroPickList}>
          {(catalog?.byType.get('HERO') ?? []).map((hero) => (
            <Pressable
              key={hero.id}
              style={[styles.chip, joinHeroId === hero.id && styles.chipSelected]}
              onPress={() => setJoinHeroId(hero.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: joinHeroId === hero.id }}
              accessibilityLabel={hero.name}
            >
              <Text style={styles.chipText}>{hero.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={[styles.sectionTitle, { color: colors.info, fontSize: fs(fontSize.body) }]}>
          {t('lobby.pickClass')}
        </Text>
        <View style={styles.chipRow}>
          {(['EXPLORER', 'WARRIOR', 'MAGE', 'ROGUE'] as const).map((cls) => (
            <Pressable
              key={cls}
              style={[styles.chip, joinDeckClass === cls && styles.chipSelected]}
              onPress={() => setJoinDeckClass(cls)}
              accessibilityRole="button"
              accessibilityState={{ selected: joinDeckClass === cls }}
              accessibilityLabel={t(`create.classes.${cls}`)}
            >
              <Text style={styles.chipText}>{t(`create.classes.${cls}`)}</Text>
            </Pressable>
          ))}
        </View>
        {eligibleCustomDecks.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.info, fontSize: fs(fontSize.body) }]}>
              {t('lobby.pickCustomDeck')}
            </Text>
            <View style={styles.chipRow}>
              <Pressable
                style={[styles.chip, joinCustomDeckId === '' && styles.chipSelected]}
                onPress={() => setJoinCustomDeckId('')}
                accessibilityRole="button"
                accessibilityState={{ selected: joinCustomDeckId === '' }}
                accessibilityLabel={t('lobby.classDeck')}
              >
                <Text style={styles.chipText}>{t('lobby.classDeck')}</Text>
              </Pressable>
              {eligibleCustomDecks.map((d) => (
                <Pressable
                  key={d.id}
                  style={[styles.chip, joinCustomDeckId === d.id && styles.chipSelected]}
                  onPress={() => setJoinCustomDeckId(d.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: joinCustomDeckId === d.id }}
                  accessibilityLabel={d.name}
                >
                  <Text style={styles.chipText}>{d.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        <View style={styles.chipRow}>
          {(['FEMALE', 'MALE'] as const).map((face) => (
            <Pressable
              key={face}
              style={[styles.chip, joinHeroFace === face && styles.chipSelected]}
              onPress={() => setJoinHeroFace(face)}
              accessibilityRole="button"
              accessibilityState={{ selected: joinHeroFace === face }}
              accessibilityLabel={face === 'FEMALE' ? t('create.heroes.faceFemale') : t('create.heroes.faceMale')}
            >
              <Text style={styles.chipText}>
                {face === 'FEMALE' ? t('create.heroes.faceFemale') : t('create.heroes.faceMale')}
              </Text>
            </Pressable>
          ))}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={[styles.button, joining && styles.buttonDisabled]}
          onPress={handleSubmit(joinRoom)}
          disabled={joining}
          accessibilityRole="button"
          accessibilityState={{ disabled: joining }}
        >
          {joining
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>{t('room.join')}</Text>}
        </Pressable>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => router.push('/')} accessibilityRole="button">
          <Text style={styles.buttonText}>{t('room.back')}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.roomContent}>
      <Text style={[styles.title, { color: colors.accent, fontSize: fs(24) }]}>{t('room.title', { id: room.roomId })}</Text>
      <Text style={[styles.meta, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}>
        {t('room.meta', { mode: room.mode, status: room.status })}
      </Text>
      <Text style={[styles.meta, { color: socketOpen ? colors.textMuted : colors.warning ?? '#f39c12', fontSize: fs(fontSize.micro) }]}>
        {socketOpen
          ? t('room.live', { lat: latencyMs != null ? ` · ${latencyMs} ms` : '' })
          : t('room.polling')}
      </Text>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">{error}</Text>
      ) : null}
      {/* Incompatibilidad estructurada: bloquea unirse/preparado con motivo */}
      {compatBlocked ? (
        <View style={[styles.error, { padding: 10, borderRadius: 8 }]} accessibilityRole="alert">
          <Text style={[styles.error, { textAlign: 'center' }]}>{compatBlocked}</Text>
        </View>
      ) : null}

      <Pressable
        style={[styles.copyButton, copied && styles.copyButtonDone]}
        onPress={copyRoomCode}
        accessibilityRole="button"
        accessibilityLabel={t('room.copyCode')}
      >
        <Text style={styles.buttonText}>{copied ? t('room.copied') : t('room.copyCode')}</Text>
      </Pressable>
              <Pressable
                onPress={copyRoomLink}
                accessibilityRole="button"
                accessibilityLabel={t('room.copyLink')}
                style={styles.copyLinkBtn}
              >
                <Text style={[styles.copyLinkText, { fontSize: fs(fontSize.detail) }]}>
                  {t('room.copyLink')}
                </Text>
              </Pressable>

      <Text style={[styles.sectionTitle, { color: colors.info, fontSize: fs(fontSize.body) }]}>
        {t('room.players', { n: room.players.length, max: room.maxPlayers })}
      </Text>
      <View style={styles.playerList}>
        {room.players.map((p) => (
          <View key={p.playerId} style={[styles.playerRow, { backgroundColor: colors.surface }]}>
            <Text style={[styles.playerName, { color: colors.text, fontSize: fs(fontSize.body) }]}>
              {p.name}
              {p.isHost ? t('lobby.hostSuffix') : ''}
              {p.playerId === playerId ? t('lobby.youSuffix') : ''}
              {p.heroId ? ` — ${catalog?.byId.get(p.heroId)?.name ?? p.heroId}` : ''}
            </Text>
            <View style={styles.playerStatusCol}>
              <Text style={[styles.playerStatus, { fontSize: fs(fontSize.detail) }, p.connected ? styles.connected : styles.disconnected]}>
                {p.connected ? t('room.connected') : t('room.disconnected')}
              </Text>
              {room.status === 'WAITING' && (
                <Text style={[styles.playerStatus, { fontSize: fs(fontSize.micro) }, (p.isHost || p.ready) ? styles.connected : styles.pending]}>
                  {p.isHost ? t('room.host') : p.ready ? t('room.ready') : t('room.pending')}
                </Text>
              )}
            </View>
            {/* Moderación del host: menú contextual (transferir / expulsar) */}
            {isHost && !p.isHost && room.status === 'WAITING' && (
              <Pressable
                style={styles.kickButton}
                onPress={() => setKickTarget({ id: p.playerId, name: p.name })}
                accessibilityRole="button"
                accessibilityLabel={t('lobby.playerOptions', { name: p.name })}
                accessibilityHint={t('lobby.modMenuHint')}
              >
                <Text style={[styles.playerStatus, styles.disconnected]}>⋯</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>

      {/* Expulsados: el host puede levantar el veto (expulsión accidental) */}
      {isHost && room.status === 'WAITING' && (room.kickedIds?.length ?? 0) > 0 && (
        <View style={styles.playerList}>
          <Text style={[styles.sectionTitle, { color: colors.warning ?? '#f39c12', fontSize: fs(fontSize.detail) }]}>
            {t('room.kickedTitle')}
          </Text>
          {room.kickedIds!.map((kid) => (
            <View key={kid} style={[styles.playerRow, { backgroundColor: colors.surface }]}>
              <Text style={[styles.playerName, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}>{kid}</Text>
              <Pressable
                style={styles.kickButton}
                onPress={() => void unkickPlayer(kid)}
                accessibilityRole="button"
                accessibilityLabel={t('room.unkickA11y', { id: kid })}
              >
                <Text style={[styles.playerStatus, { fontSize: fs(fontSize.micro), color: colors.info }]}>
                  {t('room.unkick')}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* UI-063: el botón permanece visible y explica por qué está deshabilitado */}
      {room.status === 'WAITING' && (
        <>
          {/* Bloqueo persistente: faltan sets del host en este dispositivo */}
          {missingSets.length > 0 && (
            <View>
              <Text style={[styles.waitingHint, { color: colors.warning, fontSize: fs(fontSize.detail) }]}
                accessibilityRole="alert">
                {t('room.missingSets', { sets: missingSets.join(', ') })}
              </Text>
              {/* El snapshot de sets viaja en la config de la sala: instalar
                  directamente desde el anfitrión sin exportar/importar JSON */}
              {(room.config?.customSets?.length ?? 0) > 0 && (
                <Pressable
                  style={[styles.button, styles.secondaryButton]}
                  onPress={installHostSets}
                  accessibilityRole="button"
                  accessibilityLabel={t('room.installHostSets')}
                >
                  <Text style={styles.buttonText}>{t('room.installHostSets')}</Text>
                </Pressable>
              )}
            </View>
          )}
          {/* Invitados: marcar preparado; el host lo tiene implícito */}
          {!isHost && (
            <Pressable
              style={[styles.readyButton, me?.ready && styles.readyButtonActive, (readyPending || compatBlocked || missingSets.length > 0) && styles.startButtonDisabled]}
              onPress={() => void toggleReady()}
              disabled={readyPending || Boolean(compatBlocked) || missingSets.length > 0}
              accessibilityRole="button"
              accessibilityState={{ checked: me?.ready ?? false, disabled: readyPending || Boolean(compatBlocked) || missingSets.length > 0 }}
              accessibilityLabel={me?.ready ? t('room.unready') : t('room.imReady')}
            >
              <Text style={styles.buttonText}>
                {me?.ready ? t('room.unready') : t('room.imReady')}
              </Text>
            </Pressable>
          )}
          {/* Abandonar limpio: /leave/ quita al invitado del roster */}
          {!isHost && me && (
            <Pressable
              style={[styles.button, styles.secondaryButton, { marginTop: 8 }]}
              onPress={() => void leaveRoom()}
              accessibilityRole="button"
              accessibilityLabel={t('room.leaveRoom')}
              accessibilityHint={t('room.leaveRoomA11y')}
            >
              <Text style={styles.buttonText}>{t('room.leaveRoom')}</Text>
            </Pressable>
          )}
          {isHost ? (
            <>
              <Pressable
                style={[styles.startButton, (!canStart || starting || compatBlocked || missingSets.length > 0) && styles.startButtonDisabled]}
                onPress={startGame}
                disabled={!canStart || starting || Boolean(compatBlocked) || missingSets.length > 0}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canStart || starting || Boolean(compatBlocked) || missingSets.length > 0 }}
                accessibilityLabel={t('room.startGame')}
                accessibilityHint={notReadyCount > 0 ? t('lobby.notReadyHint', { n: notReadyCount }) : undefined}
              >
                {starting
                  ? <ActivityIndicator color="#1a1a2e" />
                  : <Text style={[styles.buttonText, styles.startButtonText]}>{t('room.startGame')}</Text>}
              </Pressable>
              {notReadyCount > 0 && (
                <Text style={[styles.waitingHint, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}>
                  {t('room.waitingReady', { n: notReadyCount })}
                </Text>
              )}
              {/* P2: el host puede cerrar la sala para todos */}
              <Pressable
                style={[styles.button, styles.secondaryButton, { marginTop: 8 }]}
                onPress={() => setShowCloseConfirm(true)}
                accessibilityRole="button"
                accessibilityLabel={t('room.closeRoom')}
                accessibilityHint={t('lobby.closeRoomHint')}
              >
                <Text style={styles.buttonText}>{t('room.closeRoom')}</Text>
              </Pressable>
            </>
          ) : (
            /* Para invitados, estado de espera en vez de botón muerto (UI-063) */
            <View style={styles.waitingHost} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.body) }}>
                {t('room.waitingHost')}
              </Text>
            </View>
          )}
        </>
      )}

      {/* Partida en curso: reingreso del miembro o espectador */}
      {room.status === 'PLAYING' && (
        <Pressable
          style={[styles.button, me ? styles.startButton : styles.secondaryButton]}
          onPress={() => void (me ? enterGame() : spectate())}
          accessibilityRole="button"
          accessibilityLabel={me ? t('room.enterGame') : t('room.spectate')}
        >
          <Text style={styles.buttonText}>
            {me ? t('room.enterGame') : t('room.spectate')}
          </Text>
        </Pressable>
      )}

      <View style={styles.chatToggleRow}>
        <Text style={[styles.sectionTitle, { color: colors.info, fontSize: fs(fontSize.body) }]}>{t('room.chat')}</Text>
        <Switch
          value={showChat}
          onValueChange={setShowChat}
          accessibilityLabel={t('room.showChat')}
        />
      </View>

      {showChat && (
        <ChatPanel
          messages={chatMessages}
          currentUser={playerName}
          onSend={sendChat}
          draftText={chatDraft}
          onDraftChange={setChatDraft}
          onClose={() => setShowChat(false)}
          mutedSenders={mutedChatSenders}
          onToggleMute={toggleMuteChatSender}
        />
      )}

      <Pressable
        style={[styles.button, styles.secondaryButton]}
        onPress={() => router.push('/')}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>{t('room.back')}</Text>
      </Pressable>

      {/* Menú de moderación del host: transferir o expulsar (ambas con
          confirmación implícita en el diálogo) */}
      <NtDialog
        visible={kickTarget !== null}
        title={kickTarget?.name ?? ''}
        description={t('room.modDesc')}
        onDismiss={() => setKickTarget(null)}
        actions={[
          { label: t('room.cancel'), variant: 'ghost', onPress: () => setKickTarget(null) },
          {
            label: transferring ? t('room.transferring') : t('room.makeHost'),
            variant: 'secondary',
            onPress: () => {
              const target = kickTarget;
              setKickTarget(null);
              if (target) void transferHost(target.id);
            },
          },
          {
            label: kicking ? t('room.kicking') : t('room.kickPlayer'),
            variant: 'danger',
            onPress: () => {
              const target = kickTarget;
              setKickTarget(null);
              if (target) void kickPlayer(target.id);
            },
          },
        ]}
      />

      {/* Confirmación de cierre de sala */}
      <NtDialog
        visible={showCloseConfirm}
        title={t('room.closeTitle')}
        description={t('room.closeDesc')}
        onDismiss={() => setShowCloseConfirm(false)}
        actions={[
          { label: t('room.cancel'), variant: 'ghost', onPress: () => setShowCloseConfirm(false) },
          {
            label: closing ? t('room.closing') : t('room.closeConfirm'),
            variant: 'danger',
            onPress: () => { setShowCloseConfirm(false); void closeRoom(); },
          },
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  roomContent: {
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    color: '#f1c40f',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  meta: {
    color: '#7f8c8d',
    fontSize: 12,
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#2c3e50',
    color: '#ecf0f1',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  inputError: {
    borderWidth: 1,
    borderColor: '#e74c3c',
    marginBottom: 4,
  },
  button: {
    backgroundColor: '#27ae60',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  secondaryButton: {
    backgroundColor: '#555',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  error: {
    color: '#e74c3c',
    marginBottom: 8,
  },
  copyButtonDone: {
    backgroundColor: '#27ae60',
  },
  copyButton: {
    backgroundColor: '#2980b9',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#3498db',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 8,
  },
  heroPickList: {
    maxHeight: 48,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  chip: {
    backgroundColor: '#2c3e50',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 6,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: '#27ae60',
  },
  chipText: {
    color: '#ecf0f1',
    fontSize: 12,
  },
  playerList: {
    maxHeight: 200,
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a2e',
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  playerName: {
    color: '#ecf0f1',
    fontSize: 13,
  },
  playerStatus: {
    fontSize: 12,
  },
  connected: {
    color: '#27ae60',
  },
  pending: {
    color: '#f39c12',
  },
  playerStatusCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  copyLinkBtn: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3B82F6',
    alignSelf: 'center',
  },
  copyLinkText: { color: '#3B82F6', fontWeight: '600' },
  kickButton: {
    paddingHorizontal: 10,
    minWidth: 40,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  readyButton: {
    backgroundColor: '#2980b9',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 48,
    justifyContent: 'center',
  },
  readyButtonActive: {
    backgroundColor: '#27ae60',
  },
  waitingHint: {
    textAlign: 'center',
    marginTop: 6,
  },
  disconnected: {
    color: '#e74c3c',
  },
  startButton: {
    backgroundColor: '#f1c40f',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 48,
    justifyContent: 'center',
  },
  startButtonDisabled: {
    backgroundColor: '#8a7712',
    opacity: 0.6,
  },
  startButtonText: {
    color: '#1a1a2e',
  },
  waitingHost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  chatToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
});
