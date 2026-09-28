/** Slice online del gameStore — extraido de gameStore.ts. */

import type { StateCreator } from 'zustand';
import type { CommandWithoutCid, GameStore } from '../shared.js';

import {
  API_BASE,
  WS_BASE,
  fetchWithTimeout,
} from '../../lib/config.js';
import i18n from '../../lib/i18n';
import {
  clearRoomSession,
  saveRoomSession,
} from '../../lib/roomSession.js';
import { newCid } from '../shared.js';
import type { Command } from '@nt4h/schema';
import NetInfo from '@react-native-community/netinfo';

// Cleanup de la conexión online activa (fuera del estado: no serializable)
let _onlineCleanup: (() => void) | null = null;

// Secuencia monotónica de comandos por sesión online (anti-reordenado)
let _clientSeq = 0;

/** Comandos encolados mientras el socket no está OPEN (reconexión breve).
 *  Se reenvían al reabrir — no se descartan en silencio. */
let _pendingCmds: CommandWithoutCid[] = [];
const MAX_PENDING_CMDS = 32;

type Actions = Pick<GameStore, 'setConnectionMode'|'connectOnline'|'connectSpectator'|'disconnectOnline'|'sendOnlineCommand'>;

export const createOnlineSlice: StateCreator<GameStore, [['zustand/immer', never]], [], Actions> = (set, get) => ({
  setConnectionMode: (mode, roomId, playerId, playerToken, hostId) => {
    set((state) => {
      state.connectionMode = mode;
      state.online.roomId = roomId ?? null;
      state.online.playerId = playerId ?? null;
      if (playerToken !== undefined) {
        state.online.playerToken = playerToken;
      }
      if (hostId !== undefined) {
        state.online.hostId = hostId;
      }
    });
    // Persistir sesión (token en almacenamiento seguro) para restaurar
    // tras recargar la app — solo cuando hay credencial completa
    if (mode === 'online' && roomId && playerId && playerToken) {
      void saveRoomSession({ roomId, playerId, playerToken });
    }
  },

  connectOnline: (roomId, playerId, playerToken, onMessage) => {
    // Si ya hay una sesión online viva, cerrarla antes de abrir otra:
    // sin esto el socket, el heartbeat, el timer de reconexión y el
    // listener de NetInfo de la sesión previa quedaban vivos (leak).
    _onlineCleanup?.();
    _onlineCleanup = null;
    const token = playerToken ?? get().online.playerToken ?? '';

    // D425: el broadcast no incluye estado (contiene info privada).
    // Cada cliente pide su vista proyectada por REST tras cada comando.
    // D431: la proyección requiere el token del jugador — por header,
    // nunca por query param (los GET quedan en logs e historial).
    const fetchProjectedState = async () => {
      try {
        const res = await fetchWithTimeout(
          `${API_BASE}/rooms/${roomId}/engine/?playerId=${encodeURIComponent(playerId)}`,
          { headers: { 'X-Player-Token': token } },
        );
        if (!res.ok) {
          set((state) => {
            state.ui.message = i18n.t('common.msg.stateFetchFailed', { status: res.status });
          });
          return;
        }
        const data = await res.json();
        // Respuestas concurrentes pueden llegar desordenadas (ráfaga de
        // command_result + resync): aplicar una revisión vieja encima de
        // una nueva regresaría el estado y provocaría stale_revision.
        const rev = typeof data.revision === 'number' ? data.revision : null;
        const last = get().online.lastRevision;
        if (rev !== null && last !== null && rev <= last) return;
        if (data.state) {
          const parsedAt = typeof data.turnStartedAt === 'string'
            ? Date.parse(data.turnStartedAt)
            : null;
          // Date.parse puede devolver NaN — un timestamp inválido
          // rompería cualquier cuenta atrás basada en él.
          const serverTurnAt = parsedAt !== null && Number.isFinite(parsedAt) ? parsedAt : null;
          set((state) => {
            state.gameState = data.state;
            state.viewerId = playerId;
            if (rev !== null) {
              state.online.lastRevision = rev;
            }
            // Reloj de turno autoritativo (servidor): el contador local
            // se sincroniza con este timestamp.
            state.online.turnStartedAt = serverTurnAt;
          });
        }
      } catch {
        // red caída — se reintentará en el siguiente comando o reconexión
        set((state) => {
          state.ui.message = i18n.t('common.msg.netRetrying');
        });
      }
    };

    // D439: reconexión con backoff exponencial + heartbeat (ping)
    const HEARTBEAT_MS = 20_000;
    const MAX_BACKOFF_MS = 15_000;
    let socket: WebSocket | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;
    let closed = false;

    const onSocketMessage = (event: MessageEvent) => {
      let msg: { type?: string; reason?: string; stateChanged?: boolean; revision?: number; accepted?: boolean } | null = null;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // mensaje malformado — ignorar
      }
      if (!msg || typeof msg !== 'object') return;
      // Marca de vida del socket: cualquier frame válido la refresca
      // (pong incluido) — un socket OPEN sin tráfico es STALE, no sano
      set((state) => { state.online.lastMessageAt = Date.now(); });
      if (msg.type === 'game.command_ack') {
        // Registrar la revisión del estado; si está vieja, resincronizar
        if (typeof msg.revision === 'number') {
          set((state) => { state.online.lastRevision = msg.revision ?? null; });
        }
        if (msg.accepted === false && msg.reason === 'stale_revision') {
          set((state) => {
            state.ui.message = i18n.t('common.msg.stateStale');
          });
          void fetchProjectedState();
        }
      }
      if (msg.type === 'game.command_result') {
        if (msg.stateChanged) {
          void fetchProjectedState();
        } else if (msg.reason) {
          set((state) => {
            state.ui.message = i18n.t('common.msg.cmdRejected', { reason: msg.reason });
          });
        } else if (msg.accepted === false) {
          // Rechazo sin motivo (versiones viejas del backend no llevaban
          // `reason` en el broadcast): al menos notificar que no entró.
          set((state) => {
            state.ui.message = i18n.t('common.msg.cmdRejected', {
              reason: i18n.t('common.msg.reasonUnknown'),
            });
          });
        }
      }
      if (msg.type === 'room.player_kicked' && (msg as { playerId?: string }).playerId === playerId) {
        // El servidor cierra con 4401 justo después; cortar la sesión
        // aquí evita el bucle de reconexión de un jugador expulsado.
        get().disconnectOnline();
        return;
      }
      if (msg.type === 'room.closed') {
        // Sala cerrada por el host o por abandono total: el servidor
        // cierra el socket con 4400 — cortar ya evita un ciclo de
        // reconexión/ticket contra una sala borrada.
        get().disconnectOnline();
        return;
      }
      onMessage?.(msg);
    };

    // D439+: NetInfo pausa la reconexión cuando el dispositivo está sin red
    // (evita reintentos inútiles y permite avisar de forma clara)
    let deviceOnline = true;
    const markOffline = () => {
      set((state) => {
        if (state.connectionMode === 'online') {
          state.ui.message = i18n.t('common.msg.netWait');
        }
      });
    };
    const netinfoUnsub = NetInfo.addEventListener((netState) => {
      const online = netState.isConnected !== false && netState.isInternetReachable !== false;
      const wasOffline = !deviceOnline;
      deviceOnline = online;
      if (!online) {
        markOffline();
      } else if (wasOffline && !closed && socket?.readyState !== WebSocket.OPEN) {
        reconnectDelay = 1000;
        connect();
      }
    });

    // Reconexión gobernada por NetInfo: si el dispositivo no tiene red,
    // no gastamos el backoff — el listener reanuda al volver la red
    const scheduleReconnect = () => {
      void NetInfo.fetch()
        .then((net) => {
          if (closed) return;
          if (net && net.isConnected === false) {
            deviceOnline = false;
            markOffline();
            return;
          }
          deviceOnline = true;
          reconnectTimer = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_BACKOFF_MS);
        })
        .catch(() => {
          // NetInfo no disponible — comportamiento anterior (backoff normal)
          if (closed) return;
          reconnectTimer = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_BACKOFF_MS);
        });
    };

    // D431: el socket del juego se autentica con ticket efímero (un
    // solo uso, ~60 s) — el token de larga vida no viaja en la URL del
    // WS (visible en logs de proxy). En cada reconexión se pide uno nuevo.
    const fetchWsTicket = async (): Promise<string | null | 'fatal'> => {
      try {
        const res = await fetchWithTimeout(`${API_BASE}/rooms/${roomId}/ws-ticket/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, playerToken: token }),
        });
        // 403/404 = identidad vetada (kicked) o sala borrada: reintentar
        // solo repite el mismo rechazo en bucle.
        if (res.status === 403 || res.status === 404) return 'fatal';
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.ticket === 'string' ? data.ticket : null;
      } catch {
        return null;
      }
    };

    const connect = () => {
      if (closed) return;
      void (async () => {
        const ticket = await fetchWsTicket();
        if (closed) return;
        if (ticket === 'fatal') {
          get().disconnectOnline();
          return;
        }
        if (!ticket) {
          // Sin ticket no hay socket — reprogramar con backoff
          scheduleReconnect();
          return;
        }
        const ws = new WebSocket(`${WS_BASE}/game/${roomId}/?ticket=${encodeURIComponent(ticket)}`);
        socket = ws;

        // Guard contra sockets obsoletos: tras una reconexión, los
        // handlers del socket VIEJO no deben actuar (su onclose
        // programaría una reconexión espuria encima de la nueva).
        const isStale = () => socket !== ws;
        // Heartbeat por socket: el onclose de un socket viejo no debe
        // limpiar (ni dejar vivo) el intervalo de la conexión nueva.
        let wsHeartbeat: ReturnType<typeof setInterval> | null = null;

        ws.onopen = () => {
          if (isStale()) { ws.close(); return; }
          reconnectDelay = 1000;
          wsHeartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, HEARTBEAT_MS);
          heartbeat = wsHeartbeat; // para cleanup() externo
          // Re-sincronizar primero y después vaciar la cola: así los
          // comandos en espera se envían con la revisión ya actualizada
          // y contra un estado fresco.
          void fetchProjectedState().then(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const queued = _pendingCmds;
            _pendingCmds = [];
            for (const command of queued) {
              get().sendOnlineCommand(command);
            }
          });
        };
        ws.onmessage = (event) => {
          if (isStale()) return;
          onSocketMessage(event);
        };
        ws.onerror = () => {
          if (isStale()) return;
          set((state) => {
            state.ui.message = i18n.t('common.msg.netError');
          });
        };
        ws.onclose = (ev?: CloseEvent) => {
          if (wsHeartbeat) { clearInterval(wsHeartbeat); wsHeartbeat = null; }
          if (isStale() || closed) return;
          // 4401: expulsado; 4400: abandonamos la sala por REST (p.ej.
          // otra pestaña hizo leave). Ambos son cierres terminales —
          // reconectar solo rebotaría contra la sala en bucle.
          if (ev?.code === 4401 || ev?.code === 4400) {
            get().disconnectOnline();
            return;
          }
          set((state) => {
            if (state.connectionMode === 'online') {
              state.ui.message = i18n.t('common.msg.netLost');
            }
          });
          scheduleReconnect();
        };

        set((state) => {
          state.online.socket = ws;
        });
      })();
    };

    set((state) => {
      state.connectionMode = 'online';
      state.online = { roomId, playerId, playerToken: token || null, socket: null, lastRevision: null, lastMessageAt: null, hostId: null, turnStartedAt: null };
      _clientSeq = 0;
      _pendingCmds = [];
    });
    connect();

    const cleanup = () => {
      closed = true;
      netinfoUnsub();
      if (heartbeat) clearInterval(heartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
    _onlineCleanup = cleanup;
    return cleanup;
  },

  // Espectador: proyección pública por REST + refresco ante broadcasts.
  // Sin playerId/token — sendOnlineCommand queda inerte (requiere ambos).,

  connectSpectator: (roomId) => {
    // Igual que connectOnline: cerrar cualquier sesión previa.
    _onlineCleanup?.();
    _onlineCleanup = null;
    let closed = false;
    let socket: WebSocket | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;

    const fetchSpectatorState = async () => {
      try {
        // Sin playerId: el runner devuelve la vista proyectada pública
        // (sin manos, sin elecciones privadas) — D435.
        const res = await fetchWithTimeout(`${API_BASE}/rooms/${roomId}/engine/`);
        const data = await res.json();
        if (data.state) {
          const parsedAt = typeof data.turnStartedAt === 'string'
            ? Date.parse(data.turnStartedAt)
            : null;
          const serverTurnAt = parsedAt !== null && Number.isFinite(parsedAt) ? parsedAt : null;
          set((state) => {
            state.gameState = data.state;
            state.viewerId = null;
            if (typeof data.revision === 'number') {
              state.online.lastRevision = data.revision;
            }
            state.online.turnStartedAt = serverTurnAt;
          });
        }
      } catch {
        set((state) => { state.ui.message = i18n.t('common.msg.netRetrying'); });
      }
    };

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(`${WS_BASE}/game/${roomId}/?spectator=1`);
      socket = ws;
      const isStale = () => socket !== ws;
      ws.onopen = () => {
        if (isStale()) { ws.close(); return; }
        reconnectDelay = 1000;
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20_000);
        void fetchSpectatorState();
      };
      ws.onmessage = (event) => {
        if (isStale()) return;
        try {
          const msg = JSON.parse(event.data) as { type?: string; stateChanged?: boolean; revision?: number };
          if (typeof msg.revision === 'number') {
            set((state) => { state.online.lastRevision = msg.revision ?? null; });
          }
          if (msg.type === 'game.command_result' && msg.stateChanged) {
            void fetchSpectatorState();
          }
          if (msg.type === 'room.closed') {
            // Sala borrada: el servidor cierra con 4400; sin esto el
            // espectador reconectaría en bucle contra un 404.
            get().disconnectOnline();
            return;
          }
        } catch { /* frame malformado */ }
      };
      ws.onclose = (ev?: CloseEvent) => {
        // Limpiar el heartbeat SIEMPRE: sin esto cada reconexión
        // acumulaba un intervalo de ping vivo (leak de timers).
        if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        if (isStale() || closed) return;
        // 4400 (sala cerrada) / 4403 (auth rechazada) son terminales —
        // reconectar solo repite el mismo fallo.
        if (ev?.code === 4400 || ev?.code === 4403) {
          get().disconnectOnline();
          return;
        }
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
      };
      set((state) => { state.online.socket = ws; });
    };

    set((state) => {
      state.connectionMode = 'online';
      state.viewerId = null;
      state.online = { roomId, playerId: null, playerToken: null, socket: null, lastRevision: null, lastMessageAt: null, hostId: null, turnStartedAt: null };
    });
    void fetchSpectatorState();
    connect();

    const cleanup = () => {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
    _onlineCleanup = cleanup;
    return cleanup;
  },

  disconnectOnline: () => {
    _onlineCleanup?.();
    _onlineCleanup = null;
    _pendingCmds = [];
    void clearRoomSession();
    get().online.socket?.close();
    set((state) => {
      state.online = { roomId: null, playerId: null, playerToken: null, socket: null, lastRevision: null, lastMessageAt: null, hostId: null, turnStartedAt: null };
      state.connectionMode = 'local';
    });
  },

  sendOnlineCommand: (command) => {
    const { online, connectionMode } = get();
    if (connectionMode !== 'online' || !online.roomId || !online.playerId) return;
    const socket = online.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // Socket CONNECTING o cerrado con reconexión en marcha: encolar
      // en vez de descartar el movimiento del jugador. Solo si la
      // sesión online sigue viva (roomId/playerId presentes).
      if (_pendingCmds.length < MAX_PENDING_CMDS) {
        _pendingCmds.push(command);
        set((state) => {
          state.ui.message = i18n.t('common.msg.netQueued');
        });
      } else {
        set((state) => {
          state.ui.message = i18n.t('common.msg.netNotSent');
        });
      }
      return;
    }
    const cid = newCid('cmd');
    // actorId documenta al actor real en el log (el runner lo
    // sobrescribe con el playerId autenticado si lo persistiera).
    const fullCommand: Command = { ...command, cid, actorId: online.playerId } as Command;
    socket.send(JSON.stringify({
      type: 'game.command',
      cid,
      playerId: online.playerId,
      command: fullCommand,
      // Control de concurrencia optimista + ordenación (runner lo valida)
      clientSequence: ++_clientSeq,
      ...(online.lastRevision !== null ? { expectedRevision: online.lastRevision } : {}),
    }));
  },
});
