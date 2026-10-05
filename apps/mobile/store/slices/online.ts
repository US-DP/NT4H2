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

// Secuencia monotónica de comandos por sesión online (anti-reordenado).
// Se siembra con Date.now(): el runner conserva lastClientSeq entre
// reconexiones y snapshots — un contador que reinicia en 0 quedaría
// rechazado como 'out_of_order' para siempre tras re-entrar a la sala.
let _clientSeq = Date.now();

/** Comandos encolados mientras el socket no está OPEN (reconexión breve).
 *  Se reenvían al reabrir — no se descartan en silencio. */
let _pendingCmds: CommandWithoutCid[] = [];
const MAX_PENDING_CMDS = 32;

/** Comandos en vuelo: clave = cuerpo del comando (sin cid) → {cid, deadline}.
 *  Un doble-tap en el mismo botón enviaba el MISMO comando dos veces
 *  (dos END_TURN = dos turnos saltados; dos BUY_CARD = doble gasto).
 *  El dedup por cuerpo idéntico no bloquea jugadas distintas rápidas.
 *  Deadline para no vetar para siempre si el ack se pierde. */
const _inFlightCmds = new Map<string, { cid: string; deadline: number }>();
const INFLIGHT_CMD_TTL_MS = 10_000;

function _pruneInFlight(now: number): void {
  for (const [k, v] of _inFlightCmds) {
    if (v.deadline <= now) _inFlightCmds.delete(k);
  }
}

function _dropInFlightCid(cid: string | undefined): void {
  if (!cid) return;
  for (const [k, v] of _inFlightCmds) {
    if (v.cid === cid) {
      _inFlightCmds.delete(k);
      return;
    }
  }
}

/** Cuerpo del comando en vuelo asociado a un cid (para reintento M-7). */
function _inFlightBodyByCid(cid: string | undefined): string | undefined {
  if (!cid) return undefined;
  for (const [k, v] of _inFlightCmds) {
    if (v.cid === cid) return k;
  }
  return undefined;
}

/** M-7: comandos ya reintentados tras stale_revision — una segunda
 *  stale_revision del mismo cuerpo se rinde (no ping-pong infinito). */
const _staleRetried = new Set<string>();

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
        // Respuesta tardía: si la sesión cambió (disconnect, otra sala,
        // newGame local) no pisar el estado actual.
        if (closed || get().online.roomId !== roomId || get().online.playerId !== playerId) return;
        // Respuestas concurrentes pueden llegar desordenadas (ráfaga de
        // command_result + resync): aplicar una revisión vieja encima de
        // una nueva regresaría el estado y provocaría stale_revision.
        const rev = typeof data.revision === 'number' ? data.revision : null;
        const last = get().online.lastRevision;
        // Sin revisión válida no podemos ordenar la respuesta: si ya
        // conocemos una revisión, una respuesta revision-less solo
        // podría retroceder el estado → descartarla.
        if (last !== null && (rev === null || rev <= last)) return;
        // Forma mínima del estado: un payload malformado no debe romper
        // la UI más abajo (players ausente / playerOrder no array).
        const s = data.state;
        const plausible = s && typeof s === 'object' && s.players
          && typeof s.players === 'object' && Array.isArray(s.playerOrder);
        if (plausible) {
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
          // M-7: el comando era legal; solo su expectedRevision era vieja.
          // Tras resincronizar se reenvía UNA vez — antes el movimiento se
          // perdía en silencio y el jugador tenía que repetirlo a mano.
          const staleCid = (msg as { ref?: string; cid?: string }).ref
            ?? (msg as { cid?: string }).cid;
          const staleBody = _inFlightBodyByCid(staleCid);
          _dropInFlightCid(staleCid);
          void fetchProjectedState().then(() => {
            if (staleBody && !_staleRetried.has(staleBody)) {
              _staleRetried.add(staleBody);
              get().sendOnlineCommand(JSON.parse(staleBody) as CommandWithoutCid);
            }
          });
        }
      }
      if (msg.type === 'game.command_result') {
        // Liberar la entrada en vuelo del dedup de doble-submit.
        _dropInFlightCid((msg as { cid?: string }).cid);
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
      if (msg.type === 'error') {
        // Rate-limit del servidor (consumers.py): el comando/chat se
        // descartó — sin este handler el frame moría en silencio y el
        // jugador pensaba que su acción había entrado.
        const reason = (msg as { reason?: string }).reason;
        set((state) => {
          state.ui.message = reason === 'chat_rate_limited'
            ? i18n.t('common.msg.chatRateLimited')
            : i18n.t('common.msg.rateLimited');
        });
      }
      if (msg.type === 'room.player_kicked' && (msg as { playerId?: string }).playerId === playerId) {
        // El servidor cierra con 4401 justo después; cortar la sesión
        // aquí evita el bucle de reconexión de un jugador expulsado.
        get().disconnectOnline();
        return;
      }
      if (msg.type === 'room.finished') {
        // GAME_ENDED procesado por el backend: refetch para converger a
        // la vista final aunque un command_result se hubiera perdido.
        void fetchProjectedState();
      }
      if (msg.type === 'room.host_changed') {
        // Un transfer/disconnect cambió el host: sin actualizar
        // online.hostId el nuevo host no veía el botón de skip-AFK y el
        // antiguo lo veía pero recibía 403 del backend.
        const newHost = (msg as { playerId?: string }).playerId;
        if (typeof newHost === 'string' && newHost) {
          set((state) => { state.online.hostId = newHost; });
        }
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

    // Conservar hostId si el caller acaba de fijarlo para ESTA sala vía
    // setConnectionMode — pisarlo a null dejaba el botón de skip-turn
    // AFK del host invisible en partida.
    const keepHostId = get().online.roomId === roomId ? get().online.hostId : null;
    set((state) => {
      state.connectionMode = 'online';
      state.online = { roomId, playerId, playerToken: token || null, socket: null, lastRevision: null, lastMessageAt: null, hostId: keepHostId, turnStartedAt: null, lastCid: null };
      // Date.now() — ver nota sobre _clientSeq: debe crecer respecto a
      // cualquier sesión previa del mismo playerId en esta sala.
      _clientSeq = Math.max(_clientSeq + 1, Date.now());
      _pendingCmds = [];
      // Sesión nueva: los acks en vuelo pertenecían al socket viejo —
      // sin el reset un rejoin vetaba el primer comando idéntico.
      _inFlightCmds.clear();
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
        // No aplicar una respuesta de una sesión ya cerrada/reemplazada.
        if (closed || get().online.roomId !== roomId) return;
        // Mismo guard de revisión que el modo jugador: respuestas
        // desordenadas o sin revisión no deben retroceder la vista.
        const rev = typeof data.revision === 'number' ? data.revision : null;
        const last = get().online.lastRevision;
        if (last !== null && (rev === null || rev <= last)) return;
        const s = data.state;
        const plausible = s && typeof s === 'object' && s.players
          && typeof s.players === 'object' && Array.isArray(s.playerOrder);
        if (plausible) {
          const parsedAt = typeof data.turnStartedAt === 'string'
            ? Date.parse(data.turnStartedAt)
            : null;
          const serverTurnAt = parsedAt !== null && Number.isFinite(parsedAt) ? parsedAt : null;
          set((state) => {
            state.gameState = s;
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

    // Mismo gobierno por NetInfo que el modo jugador: sin red no se
    // gasta el backoff ni se abren sockets que nacen muertos (antes el
    // espectador reconectaba a ciegas mientras el jugador pausaba).
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
    const scheduleReconnect = () => {
      if (closed) return;
      if (!deviceOnline) {
        markOffline();
        return; // el listener de NetInfo reanuda al volver la red
      }
      NetInfo.fetch()
        .then((net) => {
          if (closed) return;
          if (net && net.isConnected === false) {
            deviceOnline = false;
            markOffline();
            return;
          }
          deviceOnline = true;
          reconnectTimer = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
        })
        .catch(() => {
          if (closed) return;
          reconnectTimer = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
        });
    };

    const connect = () => {
      if (closed || !deviceOnline) return;
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
          if (msg.type === 'room.finished') {
            // GAME_ENDED procesado: converger a la vista final aunque el
            // command_result de cierre se hubiera perdido (igual que el
            // socket de jugador).
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
        scheduleReconnect();
      };
      set((state) => { state.online.socket = ws; });
    };

    set((state) => {
      state.connectionMode = 'online';
      state.viewerId = null;
      state.online = { roomId, playerId: null, playerToken: null, socket: null, lastRevision: null, lastMessageAt: null, hostId: null, turnStartedAt: null, lastCid: null };
    });
    void fetchSpectatorState();
    NetInfo.fetch()
      .then((net) => {
        deviceOnline = !(net && net.isConnected === false);
        if (deviceOnline) connect(); else markOffline();
      })
      .catch(connect);

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

  disconnectOnline: () => {
    _onlineCleanup?.();
    _onlineCleanup = null;
    _pendingCmds = [];
    _inFlightCmds.clear();
    _staleRetried.clear();
    void clearRoomSession();
    get().online.socket?.close();
    set((state) => {
      state.online = { roomId: null, playerId: null, playerToken: null, socket: null, lastRevision: null, lastMessageAt: null, hostId: null, turnStartedAt: null, lastCid: null };
      state.connectionMode = 'local';
      // La proyección online (manos ocultas, rng zeroed) NO es una
      // partida local válida: limpiarla para que un playCard/endTurn
      // posterior no ejecute el motor local sobre estado sanitizado con
      // un RNG desalineado ni la empuje a initialCommands.
      state.gameState = null;
      state.rng = null;
      state.registry = null;
      state.viewerId = null;
      state.initialCommands = [];
      state.initialConfig = null;
      state.undoBase = null;
      state.ui.evasionSelection = null;
      state.ui.swapSelection = null;
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
    // Dedup de doble-submit: el mismo comando (cuerpo idéntico) ya en
    // vuelo → descartar el segundo envío. PLAY_CARD con la misma carta
    // repetida es un error igualmente (el servidor la rechazaría).
    const cmdKey = JSON.stringify(command);
    const now = Date.now();
    _pruneInFlight(now);
    if (_inFlightCmds.has(cmdKey)) return;
    const cid = newCid('cmd');
    _inFlightCmds.set(cmdKey, { cid, deadline: now + INFLIGHT_CMD_TTL_MS });
    // actorId documenta al actor real en el log (el runner lo
    // sobrescribe con el playerId autenticado si lo persistiera).
    const fullCommand: Command = { ...command, cid, actorId: online.playerId } as Command;
    set((state) => { state.online.lastCid = cid; });
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
