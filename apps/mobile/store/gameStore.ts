/**
 * gameStore — estado del juego en el cliente (Zustand + immer).
 *
 * Mantiene:
 * - El estado del motor (GameState)
 * - El catalogo cargado
 * - El RNG
 * - Acciones para ejecutar comandos
 * - Estado de UI (pantalla actual, carta seleccionada, etc.)
 * - Modo hot-seat: viewerId para proyección de información
 * - Persistencia básica en localStorage (web) para guardar/cargar partidas
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GameState, GameConfig, Command } from '@nt4h/schema';
import {
  DeterministicRng,
  EffectRegistry,
  registerCoreEffects,
  setupGame,
  startFirstTurn,
  processPhases,
  execute,
  isLegal,
  resetInstanceCounter,
  resetPhaseSeq,
  resetResolveSeq,
  createReplay,
  projectEventsForPlayer,
  ENGINE_VERSION,
} from '@nt4h/engine';
import { loadCatalog, type CatalogLoadResult } from '@nt4h/catalog';
import { API_BASE, WS_BASE, fetchWithTimeout } from '../lib/config.js';

interface GameUIState {
  selectedCardInstanceId: string | null;
  selectedEnemyInstanceId: string | null;
  showHand: boolean;
  message: string | null;
  /** En hot-seat, indica si estamos en la pantalla de privacidad */
  privacyScreen: boolean;
}

interface SavedGame {
  id: string;
  name: string;
  savedAt: number;
  envelope: ReturnType<typeof createReplay>;
}

interface GameStore {
  // Estado del motor
  gameState: GameState | null;
  rng: DeterministicRng | null;
  registry: EffectRegistry | null;
  catalog: CatalogLoadResult | null;

  // Modo de conexión
  connectionMode: 'local' | 'online';
  online: {
    roomId: string | null;
    playerId: string | null;
    /** D431: token de autorizacion emitido por el backend al unirse */
    playerToken: string | null;
    socket: WebSocket | null;
  };

  // Hot-seat: jugador que está viendo la pantalla (null = espectador)
  viewerId: string | null;
  /** Comando inicial para reconstruir la partida */
  initialCommands: Command[];
  initialConfig: GameConfig | null;

  // Estado de UI
  ui: GameUIState;

  // Partidas guardadas
  savedGames: SavedGame[];

  // Acciones
  initCatalog: () => void;
  newGame: (config: GameConfig) => void;
  playCard: (cardInstanceId: string, targetEnemyId?: string) => void;
  endAttack: () => void;
  buyCard: (marketCardInstanceId: string) => void;
  endTurn: () => void;
  playHeroAbility: (targetId?: string) => void;
  selectCard: (cardInstanceId: string | null) => void;
  selectEnemy: (enemyInstanceId: string | null) => void;
  setMessage: (msg: string | null) => void;
  setGameState: (state: GameState) => void;
  setConnectionMode: (mode: 'local' | 'online', roomId?: string, playerId?: string, playerToken?: string) => void;
  connectOnline: (roomId: string, playerId: string, playerToken?: string, onMessage?: (msg: any) => void) => () => void;
  /** Cierra la conexión online: para heartbeat/reconnect y el socket */
  disconnectOnline: () => void;
  sendOnlineCommand: (command: CommandWithoutCid) => void;
  /** Verifica si una carta de la mano es jugable y devuelve el motivo si no */
  checkCardPlayable: (cardInstanceId: string) => { ok: boolean; reason?: string };
  /** Verifica si una carta del mercado es comprable y devuelve el motivo si no */
  checkMarketCardBuyable: (marketCardInstanceId: string) => { ok: boolean; reason?: string };
  /** Resolver una elección pendiente del viewer (puja de líder, reacción, etc.) */
  resolvePendingChoice: (choiceId: string, selectedIds: string[]) => void;
  /** Enviar puja de Líder (CHOOSE_LEADER_CARDS) */
  chooseLeaderCards: (cardInstanceIds: string[]) => void;
  setViewer: (id: string | null) => void;
  passPrivacy: () => void;
  saveGame: (name: string) => void;
  loadGame: (id: string) => void;
  loadSavedGames: () => void;
  deleteSavedGame: (id: string) => void;
}

const STORAGE_KEY = 'nt4h-saved-games';

// cid único: Date.now() solo da granularidad de ms — dos comandos en el
// mismo ms colisionarían y el servidor los deduplicaría en silencio (D434)
let _cidCounter = 0;
function newCid(prefix: string): string {
  return `${prefix}-${Date.now()}-${(++_cidCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Cleanup de la conexión online activa (fuera del estado: no serializable)
let _onlineCleanup: (() => void) | null = null;

/** Omit distributivo sobre uniones discriminadas (Command) */
type CommandWithoutCid = Command extends infer C ? (C extends Command ? Omit<C, 'cid'> : never) : never;

/** definitionId centinela para cartas cuyo contenido es secreto */
const HIDDEN_CARD = 'hidden.card';

/**
 * D420: sanitiza el estado recibido del servidor en modo online.
 * Mantiene la forma de GameState (las UI dependen de ella) pero oculta:
 * - Manos ajenas (mismo numero de cartas, definitionId oculto)
 * - Contenido de mazos (hordeDeck, marketDeck, abilityDeck — orden secreto)
 * - Recompensas de enemigos no derrotados
 * - RNG state (evita predecir robo futuro)
 * - pendingChoices de otros jugadores
 * - Eventos privados del log
 */
function sanitizeOnlineState(state: GameState, viewerId: string | null): GameState {
  const players: GameState['players'] = {};
  for (const [id, p] of Object.entries(state.players)) {
    players[id] = id === viewerId
      ? p
      : {
          ...p,
          hand: p.hand.map(c => ({ ...c, definitionId: HIDDEN_CARD })),
          abilityDeck: p.abilityDeck.map(c => ({ ...c, definitionId: HIDDEN_CARD })),
          wearPile: p.wearPile.map(c => ({ ...c, definitionId: HIDDEN_CARD })),
        };
  }
  return {
    ...state,
    players,
    hordeDeck: state.hordeDeck.map(c => ({ ...c, definitionId: HIDDEN_CARD })),
    marketDeck: state.marketDeck.map(c => ({ ...c, definitionId: HIDDEN_CARD })),
    scenarioDeck: state.scenarioDeck.map(c => ({ ...c, definitionId: HIDDEN_CARD })),
    battlefield: state.battlefield.map(e => ({ ...e, reward: null })),
    pendingChoices: state.pendingChoices.filter(c => c.playerId === viewerId),
    eventLog: projectEventsForPlayer(state.eventLog, viewerId),
    rngState: { seed: '', state: 0 },
  };
}

function readSavedGames(): SavedGame[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedGame[];
  } catch {
    return [];
  }
}

function writeSavedGames(games: SavedGame[]): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
    return true;
  } catch {
    return false;
  }
}

export const useGameStore = create<GameStore>()(
  immer((set, get) => ({
    gameState: null,
    rng: null,
    registry: null,
    catalog: null,
    connectionMode: 'local',
    online: {
      roomId: null,
      playerId: null,
      playerToken: null,
      socket: null,
    },
    viewerId: null,
    initialCommands: [],
    initialConfig: null,
    savedGames: [],
    ui: {
      selectedCardInstanceId: null,
      selectedEnemyInstanceId: null,
      showHand: true,
      message: null,
      privacyScreen: false,
    },

    initCatalog: () => {
      const catalog = loadCatalog();
      set((state) => {
        state.catalog = catalog;
      });
    },

    newGame: (config: GameConfig) => {
      const catalog = get().catalog ?? loadCatalog();
      resetInstanceCounter();
      resetPhaseSeq();
      resetResolveSeq();

      const result = setupGame(config, catalog);
      // D427: si hay pujas de Líder pendientes, la partida espera a que los
      // jugadores elijan cartas (CHOOSE_LEADER_CARDS). En solitario o si no
      // hay pujas, se arranca el turno 1 directamente.
      const hasPendingBids = result.state.pendingChoices.some(c => c.choiceId.startsWith('leader-bid-'));
      const turnResult = hasPendingBids
        ? { state: result.state, events: result.events }
        : startFirstTurn(result.state, result.rng, catalog);

      const registry = new EffectRegistry();
      registerCoreEffects(registry);

      set((state) => {
        state.gameState = turnResult.state;
        state.rng = result.rng;
        state.registry = registry;
        state.catalog = catalog;
        state.initialConfig = config;
        state.initialCommands = [];
        // En puja pendiente, el primer viewer es el primer jugador sin pujar
        state.viewerId = hasPendingBids
          ? result.state.playerOrder[0] ?? null
          : turnResult.state.activePlayerId;
        state.ui.message = hasPendingBids
          ? 'Puja de Líder: cada jugador elige 1-2 cartas'
          : `Partida iniciada. Líder: ${turnResult.state.activePlayerId}`;
        state.ui.privacyScreen = config.playerCount > 1;
      });
    },

    playCard: (cardInstanceId: string, targetEnemyId?: string) => {
      const { gameState, rng, registry, catalog, connectionMode } = get();
      if (!gameState || !rng || !registry || !catalog) return;

      // D419: en online el servidor es autoritativo — nunca ejecutar localmente
      if (connectionMode === 'online') {
        get().sendOnlineCommand({ type: 'PLAY_CARD', cardInstanceId, targetEnemyId });
        set((state) => { state.ui.selectedCardInstanceId = null; });
        return;
      }

      const cardDef = catalog.byId.get(
        gameState.players[gameState.activePlayerId]?.hand.find(c => c.instanceId === cardInstanceId)?.definitionId ?? ''
      );

      // D430: pasar por execute — valida (isLegal), emite CARD_PLAYED/CARD_MOVED
      // y resuelve efectos via applyEvent (necesario para replay correcto)
      const cmd: Command = {
        type: 'PLAY_CARD',
        cid: newCid('play'),
        cardInstanceId,
        targetEnemyId,
      };
      const result = execute(gameState, cmd, rng, registry, catalog);
      if (!result.accepted) {
        set((state) => {
          state.ui.message = result.reason ?? 'No se pudo jugar la carta';
          state.ui.selectedCardInstanceId = null;
        });
        return;
      }
      // Procesar fases automáticas si la carta dejó pendingPhase
      const final = processPhases(result.newState, rng, catalog);

      set((state) => {
        if (state.gameState) {
          state.gameState = final.state;
        }
        state.initialCommands.push(cmd);
        state.ui.selectedCardInstanceId = null;
        state.ui.message = `Carta jugada: ${cardDef?.name ?? cardInstanceId}`;
      });
    },

    endAttack: () => {
      const { gameState, rng, registry, catalog, connectionMode } = get();
      if (!gameState || !rng || !registry || !catalog) return;

      if (connectionMode === 'online') {
        get().sendOnlineCommand({ type: 'END_ATTACK' });
        return;
      }

      // D430: pasar por execute para validar (isLegal) y emitir eventos correctos
      const cmd: Command = {
        type: 'END_ATTACK',
        cid: newCid('ea'),
      };
      const execResult = execute(gameState, cmd, rng, registry, catalog);
      if (!execResult.accepted) {
        set((state) => {
          state.ui.message = execResult.reason ?? 'No se puede finalizar el ataque';
        });
        return;
      }
      const result = processPhases(execResult.newState, rng, catalog);

      set((state) => {
        state.gameState = result.state;
        state.initialCommands.push(cmd);
        state.ui.message = 'Ataque finalizado. Procesando fases...';
      });
    },

    buyCard: (marketCardInstanceId: string) => {
      const { gameState, rng, registry, connectionMode } = get();
      if (!gameState || !rng || !registry) return;

      if (connectionMode === 'online') {
        get().sendOnlineCommand({ type: 'BUY_CARD', marketCardInstanceId });
        return;
      }

      const cmd: Command = {
        type: 'BUY_CARD',
        cid: newCid('buy'),
        marketCardInstanceId,
      };

      const result = execute(gameState, cmd, rng, registry, get().catalog ?? undefined);
      if (!result.accepted) {
        set((state) => {
          state.ui.message = result.reason ?? 'No se pudo comprar la carta';
        });
        return;
      }

      set((state) => {
        if (state.gameState) {
          state.gameState = result.newState;
        }
        state.initialCommands.push(cmd);
        state.ui.message = 'Carta comprada';
      });
    },

    endTurn: () => {
      const { gameState, rng, registry, catalog, connectionMode } = get();
      if (!gameState || !rng || !registry || !catalog) return;

      if (connectionMode === 'online') {
        get().sendOnlineCommand({ type: 'END_TURN' });
        return;
      }

      // D430: pasar por execute para validar (isLegal) y emitir PHASE_CHANGED
      const cmd: Command = {
        type: 'END_TURN',
        cid: newCid('et'),
      };
      const execResult = execute(gameState, cmd, rng, registry, get().catalog ?? undefined);
      if (!execResult.accepted) {
        set((state) => {
          state.ui.message = execResult.reason ?? 'No se puede finalizar el turno';
        });
        return;
      }
      const result = processPhases(execResult.newState, rng, catalog);

      set((state) => {
        state.gameState = result.state;
        state.initialCommands.push(cmd);
        state.ui.message = `Turno del jugador: ${result.state.activePlayerId}`;
        // En hot-seat, mostrar pantalla de privacidad al cambiar de jugador
        if (state.initialConfig && state.initialConfig.playerCount > 1) {
          state.ui.privacyScreen = true;
          state.viewerId = result.state.activePlayerId;
        }
      });
    },

    playHeroAbility: (targetId?: string) => {
      const { gameState, rng, registry, connectionMode } = get();
      if (!gameState || !rng || !registry) return;

      if (connectionMode === 'online') {
        get().sendOnlineCommand({ type: 'USE_HERO_ABILITY', targetId });
        return;
      }

      const cmd: Command = {
        type: 'USE_HERO_ABILITY',
        cid: newCid('ability'),
        targetId,
      };

      const result = execute(gameState, cmd, rng, registry, get().catalog ?? undefined);
      if (!result.accepted) {
        set((state) => {
          state.ui.message = result.reason ?? 'No se pudo usar la pericia';
        });
        return;
      }

      set((state) => {
        if (state.gameState) {
          state.gameState = result.newState;
        }
        state.initialCommands.push(cmd);
        state.ui.message = 'Pericia de héroe usada';
      });
    },

    selectCard: (cardInstanceId: string | null) => {
      set((state) => {
        state.ui.selectedCardInstanceId = cardInstanceId;
      });
    },

    selectEnemy: (enemyInstanceId: string | null) => {
      set((state) => {
        state.ui.selectedEnemyInstanceId = enemyInstanceId;
      });
    },

    setMessage: (msg: string | null) => {
      set((state) => {
        state.ui.message = msg;
      });
    },

    setGameState: (gameState: GameState) => {
      const catalog = get().catalog ?? loadCatalog();
      const registry = get().registry ?? new EffectRegistry();
      if (get().registry === null) {
        registerCoreEffects(registry);
      }
      const { connectionMode, online } = get();
      // D420: en online, el servidor envía el estado completo — sanitizar para
      // ocultar manos ajenas, mazos, RNG y eventos privados antes de guardar.
      const sanitized = connectionMode === 'online'
        ? sanitizeOnlineState(gameState, online.playerId)
        : gameState;
      const viewerId = connectionMode === 'online' && online.playerId
        ? online.playerId
        : gameState.activePlayerId;
      set((state) => {
        state.gameState = sanitized;
        state.catalog = catalog;
        state.registry = registry;
        state.viewerId = viewerId;
      });
    },

    setConnectionMode: (mode, roomId, playerId, playerToken) => {
      set((state) => {
        state.connectionMode = mode;
        state.online.roomId = roomId ?? null;
        state.online.playerId = playerId ?? null;
        if (playerToken !== undefined) {
          state.online.playerToken = playerToken;
        }
      });
    },

    connectOnline: (roomId, playerId, playerToken, onMessage) => {
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
              state.ui.message = `No se pudo obtener el estado (${res.status})`;
            });
            return;
          }
          const data = await res.json();
          if (data.state) {
            set((state) => {
              state.gameState = data.state;
              state.viewerId = playerId;
            });
          }
        } catch {
          // red caída — se reintentará en el siguiente comando o reconexión
          set((state) => {
            state.ui.message = 'Sin conexión — reintentando…';
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
        let msg: { type?: string; reason?: string; stateChanged?: boolean } | null = null;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return; // mensaje malformado — ignorar
        }
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'game.command_result') {
          if (msg.stateChanged) {
            void fetchProjectedState();
          } else if (msg.reason) {
            set((state) => {
              state.ui.message = `Comando rechazado: ${msg.reason}`;
            });
          }
        }
        onMessage?.(msg);
      };

      const connect = () => {
        if (closed) return;
        const query = `?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(`${WS_BASE}/game/${roomId}/${query}`);
        socket = ws;

        ws.onopen = () => {
          reconnectDelay = 1000;
          heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, HEARTBEAT_MS);
          void fetchProjectedState();
        };
        ws.onmessage = onSocketMessage;
        ws.onerror = () => {
          set((state) => {
            state.ui.message = 'Error de conexión con el servidor';
          });
        };
        ws.onclose = () => {
          if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
          if (closed) return;
          set((state) => {
            if (state.connectionMode === 'online') {
              state.ui.message = 'Conexión perdida — reintentando…';
            }
          });
          reconnectTimer = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_BACKOFF_MS);
        };

        set((state) => {
          state.online.socket = ws;
        });
      };

      set((state) => {
        state.connectionMode = 'online';
        state.online = { roomId, playerId, playerToken: token || null, socket: null };
      });
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
      get().online.socket?.close();
      set((state) => {
        state.online = { roomId: null, playerId: null, playerToken: null, socket: null };
        state.connectionMode = 'local';
      });
    },

    sendOnlineCommand: (command) => {
      const { online, connectionMode } = get();
      if (connectionMode !== 'online' || !online.socket || !online.roomId || !online.playerId) return;
      if (online.socket.readyState !== WebSocket.OPEN) {
        set((state) => {
          state.ui.message = 'Sin conexión — comando no enviado';
        });
        return;
      }
      const cid = newCid('cmd');
      const fullCommand: Command = { ...command, cid } as Command;
      online.socket.send(JSON.stringify({
        type: 'game.command',
        cid,
        playerId: online.playerId,
        command: fullCommand,
      }));
    },

    checkCardPlayable: (cardInstanceId: string) => {
      const { gameState, catalog, connectionMode, online, viewerId } = get();
      if (!gameState || !catalog) return { ok: false, reason: 'No hay partida activa' };
      // En online la jugabilidad es del jugador autenticado; en hot-seat, del viewer
      const actorId = connectionMode === 'online' && online.playerId
        ? online.playerId
        : viewerId ?? gameState.activePlayerId;
      const player = gameState.players[actorId];
      if (!player) return { ok: false, reason: 'Jugador no encontrado' };
      const cmd: Command = { type: 'PLAY_CARD', cid: newCid('check'), cardInstanceId };
      return isLegal(gameState, player.playerId, cmd, catalog);
    },

    checkMarketCardBuyable: (marketCardInstanceId: string) => {
      const { gameState, catalog, connectionMode, online, viewerId } = get();
      if (!gameState || !catalog) return { ok: false, reason: 'No hay partida activa' };
      const actorId = connectionMode === 'online' && online.playerId
        ? online.playerId
        : viewerId ?? gameState.activePlayerId;
      const player = gameState.players[actorId];
      if (!player) return { ok: false, reason: 'Jugador no encontrado' };
      const cmd: Command = { type: 'BUY_CARD', cid: newCid('check-buy'), marketCardInstanceId };
      return isLegal(gameState, player.playerId, cmd, catalog);
    },

    resolvePendingChoice: (choiceId: string, selectedIds: string[]) => {
      const { gameState, rng, registry, catalog, connectionMode, viewerId } = get();
      if (!gameState || !rng || !registry) return;

      // D427: el viewer actual resuelve SU elección (no la del jugador activo)
      const actorId = viewerId ?? gameState.activePlayerId;

      if (connectionMode === 'online') {
        get().sendOnlineCommand({ type: 'RESOLVE_CHOICE', choiceId, selectedIds });
        return;
      }

      const cmd: Command = { type: 'RESOLVE_CHOICE', cid: newCid('cmd'), choiceId, selectedIds };
      const result = execute(gameState, cmd, rng, registry, catalog ?? undefined, actorId);
      if (!result.accepted) {
        set((state) => {
          state.ui.message = `Elección rechazada: ${result.reason ?? 'desconocido'}`;
        });
        return;
      }

      // Procesar fases automáticas tras la resolución
      const phaseResult = catalog
        ? processPhases(result.newState, rng, catalog)
        : { state: result.newState };
      const finalState = phaseResult.state;

      set((state) => {
        state.gameState = finalState;
        state.initialCommands.push(cmd);
      });
    },

    chooseLeaderCards: (cardInstanceIds: string[]) => {
      const { gameState, rng, registry, catalog, connectionMode, viewerId } = get();
      if (!gameState || !rng || !registry) return;

      const actorId = viewerId ?? gameState.activePlayerId;

      if (connectionMode === 'online') {
        get().sendOnlineCommand({ type: 'CHOOSE_LEADER_CARDS', cardInstanceIds });
        return;
      }

      const cmd: Command = { type: 'CHOOSE_LEADER_CARDS', cid: newCid('cmd'), cardInstanceIds };
      const result = execute(gameState, cmd, rng, registry, catalog ?? undefined, actorId);
      if (!result.accepted) {
        set((state) => {
          state.ui.message = `Puja rechazada: ${result.reason ?? 'desconocido'}`;
        });
        return;
      }

      const finalState = result.newState;
      set((state) => {
        state.gameState = finalState;
        state.initialCommands.push(cmd);
        // Tras pujar, pasar al siguiente jugador con puja pendiente (hot-seat)
        const nextBid = finalState.pendingChoices.find(c => c.choiceId.startsWith('leader-bid-'));
        if (nextBid) {
          state.viewerId = nextBid.playerId;
          state.ui.privacyScreen = true;
        } else {
          state.viewerId = finalState.activePlayerId;
          state.ui.privacyScreen = true;
        }
      });
    },

    setViewer: (id: string | null) => {
      set((state) => {
        state.viewerId = id;
      });
    },

    passPrivacy: () => {
      set((state) => {
        state.ui.privacyScreen = false;
      });
    },

    saveGame: (name: string) => {
      const { gameState, rng, initialConfig, initialCommands, connectionMode } = get();
      // En online el gameState es la proyección sanitizada (manos ocultas,
      // RNG zeroed, sin comandos): guardar eso corrompería la partida.
      if (connectionMode === 'online') {
        set((state) => {
          state.ui.message = 'No se puede guardar una partida online';
        });
        return;
      }
      if (!gameState || !rng || !initialConfig) return;

      const envelope = createReplay(
        initialConfig.mode,
        initialConfig.seed,
        gameState,
        initialCommands,
        {},
        rng,
      );

      const saved: SavedGame = {
        id: `save-${Date.now()}`,
        name: name || `Partida ${new Date().toLocaleString()}`,
        savedAt: Date.now(),
        envelope,
      };

      const games = [...readSavedGames(), saved];
      const persisted = writeSavedGames(games);

      set((state) => {
        if (persisted) {
          state.savedGames = games;
          state.ui.message = `Partida guardada: ${saved.name}`;
        } else {
          state.ui.message = 'No se pudo guardar la partida';
        }
      });
    },

    loadGame: (id: string) => {
      const games = readSavedGames();
      const saved = games.find(g => g.id === id);
      if (!saved) return;

      const catalog = get().catalog ?? loadCatalog();
      resetInstanceCounter();
      resetPhaseSeq();
      resetResolveSeq();

      const registry = new EffectRegistry();
      registerCoreEffects(registry);

      // Reconstruir el estado final ejecutando los comandos guardados
      // sobre el snapshot inicial (event sourcing §51.12).
      const rng = DeterministicRng.deserialize({
        seed: saved.envelope.seed,
        state: saved.envelope.initialState.rngState,
      });
      let restoredState = saved.envelope.initialState.state;
      let rejectedCount = 0;
      for (const cmd of saved.envelope.commands) {
        const result = execute(restoredState, cmd, rng, registry, catalog);
        if (result.accepted) {
          restoredState = processPhases(result.newState, rng, catalog).state;
        } else {
          // Un comando rechazado diverge el estado restaurado — avisar
          rejectedCount++;
          console.warn(`loadGame: comando rechazado (${result.reason})`, cmd);
        }
      }

      set((state) => {
        state.gameState = restoredState;
        state.rng = rng;
        state.registry = registry;
        state.catalog = catalog;
        state.initialCommands = [...saved.envelope.commands];
        state.viewerId = restoredState.activePlayerId;
        state.ui.message = rejectedCount > 0
          ? `Partida cargada: ${saved.name} (${rejectedCount} comando(s) rechazados)`
          : `Partida cargada: ${saved.name}`;
        state.ui.privacyScreen = false;
      });
    },

    loadSavedGames: () => {
      set((state) => {
        state.savedGames = readSavedGames();
      });
    },

    deleteSavedGame: (id: string) => {
      const games = readSavedGames().filter(g => g.id !== id);
      writeSavedGames(games);
      set((state) => {
        state.savedGames = games;
      });
    },
  }))
);

// Re-exportar para uso en componentes
export { ENGINE_VERSION };
