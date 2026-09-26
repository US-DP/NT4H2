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

  resetInstanceCounter,
  resetPhaseSeq,
  resetResolveSeq,
  createReplay,
  projectEventsForPlayer,
  ENGINE_VERSION,
  evaluateCommand,
  stateHash,
  SNAPSHOT_VERSION,
} from '@nt4h/engine';
import type { CommandReasonCode } from '@nt4h/engine';
import { loadCatalog, CATALOG_VERSION, type CatalogLoadResult } from '@nt4h/catalog';
import { useCustomContent, loadCatalogWithCustom, customDecks } from '../lib/customContent';
import { deckToConfigEntry } from '@nt4h/catalog';
import { API_BASE, WS_BASE, fetchWithTimeout } from '../lib/config.js';
import NetInfo from '@react-native-community/netinfo';
import { saveRoomSession, clearRoomSession } from '../lib/roomSession.js';
import { storageGet, storageSet, storageSetAtomic } from '../lib/storage.js';
import { exportTextFile } from '../lib/exportSave.js';
import { prefetchCardImages } from '../lib/prefetch.js';
import i18n from '../lib/i18n';
import { useCollection } from './collectionStore.js';
import { useSettings } from './settingsStore.js';

interface GameUIState {
  selectedCardInstanceId: string | null;
  selectedEnemyInstanceId: string | null;
  showHand: boolean;
  message: string | null;
  /** En hot-seat, indica si estamos en la pantalla de privacidad */
  privacyScreen: boolean;
  /** Modo evasión: null = inactivo; array = cartas elegidas para descartar (mín 2) */
  evasionSelection: string[] | null;
}

export interface SavedGame {
  id: string;
  name: string;
  savedAt: number;
  envelope: ReturnType<typeof createReplay>;
  /** Config de la partida (modo, héroes, pools…). Necesaria para rejugar
   *  una partida cargada (revancha, re-guardado, estadísticas). */
  config?: GameConfig;
  /** Metadatos de compatibilidad/integridad (añadidos en v2 del save) */
  meta?: {
    engineVersion: string;
    catalogVersion: string;
    snapshotVersion: number;
    stateHash: string;
  };
}

/** Partida en papelera: conserva el save + cuándo se eliminó para la purga. */
export interface TrashedGame extends SavedGame {
  deletedAt: number;
}

/** Compatibilidad de una partida guardada con el motor/catálogo actual. */
export type SaveCompatibility = 'compatible' | 'version-mismatch' | 'incompatible';

export function classifySavedGame(saved: SavedGame): SaveCompatibility {
  const snapVersion = saved.envelope?.initialState?.version;
  if (snapVersion !== SNAPSHOT_VERSION) return 'incompatible';
  const engineVersion = saved.meta?.engineVersion ?? saved.envelope?.engineVersion;
  if (engineVersion !== ENGINE_VERSION) return 'version-mismatch';
  return 'compatible';
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
    /** Última revisión de estado conocida del runner (optimistic concurrency) */
    lastRevision: number | null;
    /** Timestamp del último mensaje recibido por el socket (detección STALE) */
    lastMessageAt: number | null;
    /** Host de la sala (para acciones de moderación en partida: skip AFK) */
    hostId: string | null;
    /** Reloj de turno autoritativo del servidor (epoch ms; null = desconocido) */
    turnStartedAt: number | null;
  };

  // Hot-seat: jugador que está viendo la pantalla (null = espectador)
  viewerId: string | null;
  /** Comando inicial para reconstruir la partida */
  initialCommands: Command[];
  initialConfig: GameConfig | null;
  /** Base del "Deshacer" local: snapshot de estado+RNG tomado al crear o
   * cargar la partida. `initialCommands.slice(0,-1)` re-ejecutado sobre
   * esta base produce el estado anterior (rewind tipo Tabletop Playground).
   * null = sin undo disponible (partida online o recién cerrada). */
  undoBase: { state: GameState; rngState: number; seed: string } | null;

  // Estado de UI
  ui: GameUIState;
  /** Remitentes de chat silenciados localmente */
  mutedChatSenders: string[];

  // Partidas guardadas
  savedGames: SavedGame[];
  /** Papelera: partidas eliminadas recuperables durante la retención */
  trashedGames: TrashedGame[];

  // Acciones
  initCatalog: () => void;
  newGame: (config: GameConfig) => void;
  playCard: (cardInstanceId: string, targetEnemyId?: string) => void;
  endAttack: () => void;
  /** Maniobra de Evasión: descarta ≥2 cartas de la mano para evitar la respuesta de la Horda */
  evasion: (cardInstanceIds: string[]) => void;
  /** Entrar al modo evasión (selección múltiple en la mano) */
  startEvasion: () => void;
  /** Marcar/desmarcar una carta para la evasión */
  toggleEvasionCard: (cardInstanceId: string) => void;
  /** Salir del modo evasión sin ejecutarla */
  cancelEvasion: () => void;
  buyCard: (marketCardInstanceId: string) => void;
  endTurn: () => void;
  playHeroAbility: (targetId?: string) => void;
  selectCard: (cardInstanceId: string | null) => void;
  selectEnemy: (enemyInstanceId: string | null) => void;
  setMessage: (msg: string | null) => void;
  /** Silenciar/dejar de silenciar a un remitente del chat (local) */
  toggleMuteChatSender: (sender: string) => void;
  setGameState: (state: GameState) => void;
  setConnectionMode: (mode: 'local' | 'online', roomId?: string, playerId?: string, playerToken?: string, hostId?: string) => void;
  connectOnline: (roomId: string, playerId: string, playerToken?: string, onMessage?: (msg: { type?: string; reason?: string; stateChanged?: boolean }) => void) => () => void;
  /** Conecta como espectador (solo lectura): sin playerId ni token.
   * El runner devuelve la vista proyectada pública (D435) y el backend
   * ignora cualquier comando/chat del socket espectador. */
  connectSpectator: (roomId: string) => () => void;
  /** Cierra la conexión online: para heartbeat/reconnect y el socket */
  disconnectOnline: () => void;
  sendOnlineCommand: (command: CommandWithoutCid) => void;
  /** Verifica si una carta de la mano es jugable y devuelve el motivo si no */
  checkCardPlayable: (cardInstanceId: string) => { ok: boolean; reason?: string; reasonCode?: CommandReasonCode };
  /** Verifica si una carta del mercado es comprable y devuelve el motivo si no */
  checkMarketCardBuyable: (marketCardInstanceId: string) => { ok: boolean; reason?: string; reasonCode?: CommandReasonCode };
  /** Deshace el último comando en partida local re-ejecutando el log
   *  sobre `undoBase` menos el último paso. No-op en online. */
  undoLastCommand: () => void;
  /** Resolver una elección pendiente del viewer (puja de líder, reacción, etc.) */
  resolvePendingChoice: (choiceId: string, selectedIds: string[]) => void;
  /** Enviar puja de Líder (CHOOSE_LEADER_CARDS) */
  chooseLeaderCards: (cardInstanceIds: string[]) => void;
  setViewer: (id: string | null) => void;
  passPrivacy: () => void;
  saveGame: (name: string) => void;
  loadGame: (id: string) => void;
  loadSavedGames: () => void;
  /** Mueve una partida a la papelera (recuperable hasta que caduque) */
  deleteSavedGame: (id: string) => void;
  /** Re-inserta una partida previamente borrada (deshacer) */
  restoreSavedGame: (saved: SavedGame) => void;
  /** Exporta una partida guardada como fichero JSON (compartir/descargar) */
  exportSavedGame: (id: string) => void;
  /** Importa un fichero JSON exportado previamente. Devuelve error o null. */
  importSavedGame: (jsonText: string) => Promise<string | null>;
  /** Renombra una partida guardada */
  renameSavedGame: (id: string, name: string) => void;
  /** Carga la papelera y purga entradas que superan la retención */
  loadTrashedGames: () => void;
  /** Devuelve una partida de la papelera a las guardadas */
  restoreTrashedGame: (id: string) => void;
  /** Borrado definitivo de una partida de la papelera (irreversible) */
  deleteTrashedGame: (id: string) => void;
  /** Vacía la papelera entera (irreversible) */
  emptyTrash: () => void;
}

const STORAGE_KEY = 'nt4h-saved-games';
const TRASH_KEY = 'nt4h-trashed-games';
/** Días que una partida permanece en la papelera antes de la purga automática */
export const TRASH_RETENTION_DAYS = 30;

// --- Importación segura de partidas (.nt4hsave / JSON exportado) -----------
/** Tamaño máximo de fichero importable (entrada no confiable). */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_DEPTH = 40;
const MAX_IMPORT_COMMANDS = 50_000;
/** Tipos de comando válidos del motor (lista cerrada del schema Command).
 *  START_GAME/SELECT_TARGET no forman parte de la union Command — el motor
 *  los rechazaría como 'Command not supported' en un replay importado. */
const KNOWN_COMMAND_TYPES = new Set([
  'PLAY_CARD', 'END_ATTACK', 'EVASION', 'BUY_CARD', 'END_TURN',
  'USE_HERO_ABILITY', 'CHOOSE_LEADER_CARDS', 'RESOLVE_CHOICE', 'PASS',
  'SWAP_STARTING_CARDS', 'ACCEPT_TURN_START_EFFECT', 'OPEN_SUPPORT_DECK',
  'BUY_SUPPORT_CARD',
]);
/** Claves que nunca deben entrar por una importación (credenciales/prototipo). */
const FORBIDDEN_KEYS = new Set([
  'authtoken', 'playertoken', 'token', 'secret', 'password',
  '__proto__', 'constructor', 'prototype',
]);

/**
 * Recorre el JSON importado: rechaza profundidad excesiva y elimina claves
 * sensibles/peligrosas. Devuelve el objeto saneado o lanza Error.
 */
function sanitizeImportedJson(value: unknown, depth = 0): unknown {
  if (depth > MAX_IMPORT_DEPTH) throw new Error('depth');
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeImportedJson(v, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) continue;
      out[k] = sanitizeImportedJson(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > MAX_IMPORT_BYTES) {
    throw new Error('size');
  }
  return value;
}

// cid único: Date.now() solo da granularidad de ms — dos comandos en el
// mismo ms colisionarían y el servidor los deduplicaría en silencio (D434)
let _cidCounter = 0;
function newCid(prefix: string): string {
  return `${prefix}-${Date.now()}-${(++_cidCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Cleanup de la conexión online activa (fuera del estado: no serializable)
let _onlineCleanup: (() => void) | null = null;

// Secuencia monotónica de comandos por sesión online (anti-reordenado)
let _clientSeq = 0;

/** Comandos encolados mientras el socket no está OPEN (reconexión breve).
 *  Se reenvían al reabrir — no se descartan en silencio. */
let _pendingCmds: CommandWithoutCid[] = [];
const MAX_PENDING_CMDS = 32;

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

/**
 * Cola FIFO: las operaciones leer-modificar-escribir sobre las partidas
 * guardadas deben serializarse — dos `saveGame`/`deleteSavedGame`
 * simultáneos pisarían la lista completa y perderían entradas.
 */
let _savesQueue: Promise<unknown> = Promise.resolve();
function enqueueSaveOp<T>(op: () => Promise<T>): Promise<T> {
  const next = _savesQueue.then(op, op);
  _savesQueue = next.catch(() => {});
  return next;
}

async function readSavedGames(): Promise<SavedGame[]> {
  try {
    const raw = await storageGet(STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as SavedGame[];
    } catch {
      // JSON corrupto: no pisar en silencio — conservar copia para
      // diagnóstico/recuperación manual antes de devolver lista vacía.
      console.warn('readSavedGames: JSON corrupto, copia en .corrupt');
      void storageSet(`${STORAGE_KEY}.corrupt`, raw).catch(() => {});
      return [];
    }
  } catch {
    return [];
  }
}

async function writeSavedGames(games: SavedGame[]): Promise<boolean> {
  try {
    // tmp→real: si la app muere a mitad no queda un JSON a medias
    await storageSetAtomic(STORAGE_KEY, JSON.stringify(games));
    return true;
  } catch {
    return false;
  }
}

async function readTrashedGames(): Promise<TrashedGame[]> {
  try {
    const raw = await storageGet(TRASH_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as TrashedGame[];
    } catch {
      console.warn('readTrashedGames: JSON corrupto, copia en .corrupt');
      void storageSet(`${TRASH_KEY}.corrupt`, raw).catch(() => {});
      return [];
    }
  } catch {
    return [];
  }
}

async function writeTrashedGames(games: TrashedGame[]): Promise<boolean> {
  try {
    await storageSetAtomic(TRASH_KEY, JSON.stringify(games));
    return true;
  } catch {
    return false;
  }
}

/** Purga entradas de la papelera que superan la retención configurada */
async function purgeExpiredTrash(): Promise<TrashedGame[]> {
  const trash = await readTrashedGames();
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const kept = trash.filter((g) => g.deletedAt >= cutoff);
  if (kept.length !== trash.length) await writeTrashedGames(kept);
  return kept;
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
      lastRevision: null,
      lastMessageAt: null,
      hostId: null,
      turnStartedAt: null,
    },
    viewerId: null,
    undoBase: null,
    initialCommands: [],
    initialConfig: null,
    savedGames: [],
    trashedGames: [],
    ui: {
      selectedCardInstanceId: null,
      selectedEnemyInstanceId: null,
      showHand: true,
      message: null,
      privacyScreen: false,
      evasionSelection: null,
    },
    mutedChatSenders: [],

    initCatalog: () => {
      // Conjuntos del Taller (persistidos) → se fusionan al catálogo al cargar
      void useCustomContent.getState().init().then(() => {
        const merged = loadCatalogWithCustom();
        set((state) => { state.catalog = merged; });
        void prefetchCardImages(merged);
      });
      const catalog = loadCatalog();
      set((state) => {
        state.catalog = catalog;
      });
      // Precargar PNGs en segundo plano — la primera partida no espera descargas
      void prefetchCardImages(catalog);
    },

    newGame: (config: GameConfig) => {
      let catalog = get().catalog ?? loadCatalogWithCustom();
      // Si algún héroe usa un mazo personalizado, resolver su snapshot ahora
      // y fusionar el catálogo con los conjuntos del Taller.
      const decks = customDecks();
      const usesCustom = config.heroes?.some(h => h.customDeckId)
        || Boolean(config.hordeCardIds?.length)
        || Boolean(config.marketCardIds?.length)
        || Boolean(config.warlordIds?.length)
        || Boolean(config.scenarioIds?.some(id => id.startsWith('custom.') || !catalog.byId.has(id)));
      if (usesCustom || get().catalog === null) {
        catalog = loadCatalogWithCustom();
      }
      let resolvedConfig = config;
      if (usesCustom) {
        resolvedConfig = {
          ...config,
          customDecks: config.heroes
            .map(h => h.customDeckId ? decks.find(d => d.id === h.customDeckId) : undefined)
            .filter((d): d is NonNullable<typeof d> => d !== undefined)
            .map(deckToConfigEntry),
        };
      }
      // Partida rápida: recordar la última configuración usada
      useSettings.getState().set({ lastGameConfig: config });
      resetInstanceCounter();
      resetPhaseSeq();
      resetResolveSeq();

      const result = setupGame(resolvedConfig, catalog);

      // Colección: las cartas que entran en juego quedan "descubiertas"
      // (héroe elegido + cartas de su(s) mazo(s) + escenarios usados).
      const discovered: string[] = [];
      const abilityClasses = new Set<string>();
      for (const h of config.heroes ?? []) {
        discovered.push(h.heroId);
        for (const deckId of [h.deckId, h.secondDeckId]) {
          if (deckId) abilityClasses.add(deckId.split('.')[0].toUpperCase());
        }
      }
      for (const c of catalog.byId.values()) {
        if (c.type === 'ABILITY' && c.heroClass && abilityClasses.has(c.heroClass)) {
          discovered.push(c.id);
        }
      }
      for (const id of config.scenarioIds ?? []) discovered.push(id);
      useCollection.getState().markDiscovered(discovered);

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
        // Punto cero del rewind local: estado tras setup+primer turno y el
        // RNG en ese instante (los comandos aún no se han registrado).
        state.undoBase = {
          state: structuredClone(turnResult.state),
          rngState: result.rng.serialize().state,
          seed: config.seed,
        };
        // En puja pendiente, el primer viewer es el primer jugador sin pujar
        state.viewerId = hasPendingBids
          ? result.state.playerOrder[0] ?? null
          : turnResult.state.activePlayerId;
        state.ui.message = hasPendingBids
          ? i18n.t('common.msg.leaderBid')
          : i18n.t('common.msg.gameStarted', { id: turnResult.state.activePlayerId });
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
          state.ui.message = result.reason ?? i18n.t('common.msg.playFailed');
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
        state.ui.message = i18n.t('common.msg.cardPlayed', { name: cardDef?.name ?? cardInstanceId });
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
          state.ui.message = execResult.reason ?? i18n.t('common.msg.endAttackFailed');
        });
        return;
      }
      const result = processPhases(execResult.newState, rng, catalog);

      set((state) => {
        state.gameState = result.state;
        state.initialCommands.push(cmd);
        state.ui.message = i18n.t('common.msg.attackEnded');
      });
    },

    startEvasion: () => {
      set((state) => {
        state.ui.evasionSelection = [];
        state.ui.selectedCardInstanceId = null;
        state.ui.selectedEnemyInstanceId = null;
        state.ui.message = i18n.t('common.msg.chooseEvasion');
      });
    },

    toggleEvasionCard: (cardInstanceId: string) => {
      set((state) => {
        const sel = state.ui.evasionSelection;
        if (sel === null) return;
        state.ui.evasionSelection = sel.includes(cardInstanceId)
          ? sel.filter((id) => id !== cardInstanceId)
          : [...sel, cardInstanceId];
      });
    },

    cancelEvasion: () => {
      set((state) => {
        state.ui.evasionSelection = null;
        state.ui.message = null;
      });
    },

    evasion: (cardInstanceIds: string[]) => {
      const { gameState, rng, registry, catalog, connectionMode } = get();
      if (!gameState || !rng || !registry || !catalog) return;

      if (connectionMode === 'online') {
        get().sendOnlineCommand({ type: 'EVASION', discardedCardInstanceIds: cardInstanceIds });
        set((state) => { state.ui.evasionSelection = null; });
        return;
      }

      const cmd: Command = {
        type: 'EVASION',
        cid: newCid('ev'),
        discardedCardInstanceIds: cardInstanceIds,
      };
      const execResult = execute(gameState, cmd, rng, registry, catalog);
      if (!execResult.accepted) {
        set((state) => {
          state.ui.message = execResult.reason ?? i18n.t('common.msg.evadeFailed');
        });
        return;
      }
      const result = processPhases(execResult.newState, rng, catalog);

      set((state) => {
        state.gameState = result.state;
        state.initialCommands.push(cmd);
        state.ui.evasionSelection = null;
        state.ui.message = i18n.t('common.msg.evasionDone', { count: cardInstanceIds.length });
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
          state.ui.message = result.reason ?? i18n.t('common.msg.buyFailed');
        });
        return;
      }

      // Comprar puede disparar oyentes (REGISTER_LISTENER) y condiciones de
      // fin de partida → avanzar fases como en endTurn.
      const catalogNow = get().catalog;
      const final = catalogNow
        ? processPhases(result.newState, rng, catalogNow)
        : { state: result.newState };

      set((state) => {
        if (state.gameState) {
          state.gameState = final.state;
        }
        state.initialCommands.push(cmd);
        state.ui.message = i18n.t('common.msg.cardBought');
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
          state.ui.message = execResult.reason ?? i18n.t('common.msg.endTurnFailed');
        });
        return;
      }
      const result = processPhases(execResult.newState, rng, catalog);

      set((state) => {
        state.gameState = result.state;
        state.initialCommands.push(cmd);
        state.ui.message = i18n.t('common.msg.turnOf', { id: result.state.activePlayerId });
        // En hot-seat, mostrar pantalla de privacidad al cambiar de jugador
        if (state.initialConfig && state.initialConfig.playerCount > 1) {
          state.ui.privacyScreen = true;
          state.viewerId = result.state.activePlayerId;
        }
      });
    },

    undoLastCommand: () => {
      const { connectionMode, undoBase, initialCommands, catalog } = get();
      // Solo local: en online el servidor es autoritativo (D419).
      if (connectionMode !== 'local' || !undoBase || !catalog) return;
      if (initialCommands.length === 0) {
        set((state) => { state.ui.message = i18n.t('gm.undoNone'); });
        return;
      }

      // Re-ejecutar el log sobre la base menos el último comando — el
      // mismo mecanismo del loadGame/replay (event sourcing §51.12).
      const cmds = initialCommands.slice(0, -1);
      const rng = DeterministicRng.deserialize({
        seed: undoBase.seed,
        state: undoBase.rngState,
      });
      const registry = new EffectRegistry();
      registerCoreEffects(registry);
      // structuredClone: si execute() mutara el estado de entrada, la base
      // del undo quedaría protegida para deshacer varios pasos seguidos.
      let restored = structuredClone(undoBase.state);
      for (const cmd of cmds) {
        const r = execute(restored, cmd, rng, registry, catalog, cmd.actorId);
        if (r.accepted) {
          restored = processPhases(r.newState, rng, catalog).state;
        }
      }

      set((state) => {
        state.gameState = restored;
        state.rng = rng;
        state.registry = registry;
        state.initialCommands = cmds;
        state.ui.selectedCardInstanceId = null;
        state.ui.selectedEnemyInstanceId = null;
        state.ui.evasionSelection = null;
        state.ui.message = i18n.t('gm.undoDone');
      });
    },

    playHeroAbility: (targetId?: string) => {
      const { gameState, rng, registry, connectionMode, viewerId } = get();
      if (!gameState || !rng || !registry) return;

      if (connectionMode === 'online') {
        get().sendOnlineCommand({ type: 'USE_HERO_ABILITY', targetId });
        return;
      }

      // El actor puede no ser el jugador activo (pericia reactiva en la
      // ventana de la Horda) — actorId lo preserva para el replay.
      const actorId = viewerId ?? gameState.activePlayerId;
      const cmd: Command = {
        type: 'USE_HERO_ABILITY',
        cid: newCid('ability'),
        actorId,
        targetId,
      };

      const result = execute(gameState, cmd, rng, registry, get().catalog ?? undefined, actorId);
      if (!result.accepted) {
        set((state) => {
          state.ui.message = result.reason ?? i18n.t('common.msg.abilityFailed');
        });
        return;
      }

      // Una pericia puede derrotar al último Señor o disparar oyentes:
      // dejar que la máquina de fases avance hasta pedir entrada de nuevo.
      const catalogNow = get().catalog;
      const final = catalogNow
        ? processPhases(result.newState, rng, catalogNow)
        : { state: result.newState };

      set((state) => {
        if (state.gameState) {
          state.gameState = final.state;
        }
        state.initialCommands.push(cmd);
        state.ui.message = i18n.t('common.msg.abilityUsed');
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

    toggleMuteChatSender: (sender: string) => {
      set((state) => {
        const idx = state.mutedChatSenders.indexOf(sender);
        if (idx >= 0) state.mutedChatSenders.splice(idx, 1);
        else state.mutedChatSenders.push(sender);
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
    // Sin playerId/token — sendOnlineCommand queda inerte (requiere ambos).
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
      const evalResult = evaluateCommand(gameState, player.playerId, cmd, catalog);
      return { ok: evalResult.legal, reason: evalResult.reason, reasonCode: evalResult.reasonCode };
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
      const evalResult = evaluateCommand(gameState, player.playerId, cmd, catalog);
      return { ok: evalResult.legal, reason: evalResult.reason, reasonCode: evalResult.reasonCode };
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

      const cmd: Command = { type: 'RESOLVE_CHOICE', cid: newCid('cmd'), actorId, choiceId, selectedIds };
      const result = execute(gameState, cmd, rng, registry, catalog ?? undefined, actorId);
      if (!result.accepted) {
        set((state) => {
          state.ui.message = i18n.t('common.msg.choiceRejected', { reason: result.reason ?? i18n.t('common.msg.reasonUnknown') });
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

      const cmd: Command = { type: 'CHOOSE_LEADER_CARDS', cid: newCid('cmd'), actorId, cardInstanceIds };
      const result = execute(gameState, cmd, rng, registry, catalog ?? undefined, actorId);
      if (!result.accepted) {
        set((state) => {
          state.ui.message = i18n.t('common.msg.bidRejected', { reason: result.reason ?? i18n.t('common.msg.reasonUnknown') });
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
          state.ui.message = i18n.t('common.msg.saveOnlineNo');
        });
        return;
      }
      if (!gameState || !rng || !initialConfig) return;

      const envelope = createReplay(
        initialConfig.mode,
        initialConfig.seed,
        gameState,
        initialCommands,
        { catalog: CATALOG_VERSION },
        rng,
      );

      const saved: SavedGame = {
        // 'Autosave' es un slot reservado: id determinista y dedupe por
        // nombre — un autosave por app-state-change llenaría la lista.
        id: name === 'Autosave'
          ? 'save-autosave'
          : `save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name || `Partida ${new Date().toLocaleString()}`,
        savedAt: Date.now(),
        envelope,
        config: initialConfig,
        meta: {
          engineVersion: ENGINE_VERSION,
          catalogVersion: CATALOG_VERSION,
          snapshotVersion: SNAPSHOT_VERSION,
          stateHash: stateHash(gameState, rng.serialize().state),
        },
      };

      void enqueueSaveOp(async () => {
        const prev = await readSavedGames();
        const games = [
          ...prev.filter(g => g.id !== saved.id && g.name !== 'Autosave'),
          saved,
        ];
        const persisted = await writeSavedGames(games);

        set((state) => {
          if (persisted) {
            state.savedGames = games;
            state.ui.message = i18n.t('common.msg.savedOk', { name: saved.name });
          } else {
            state.ui.message = i18n.t('common.msg.saveFailed');
          }
        });
      });
    },

    loadGame: (id: string) => {
      void (async () => {
        const games = await readSavedGames();
        const saved = games.find(g => g.id === id);
        if (!saved) return;

        // Clasificar compatibilidad antes de cargar: no migrar en silencio
        // partidas de otra versión si el resultado puede divergir.
        const compat = classifySavedGame(saved);
        if (compat === 'incompatible') {
          set((state) => {
            state.ui.message = i18n.t('common.msg.savedIncompatible', { name: saved.name, ver: saved.envelope?.initialState?.version ?? '?' });
          });
          return;
        }

        const catalog = get().catalog ?? loadCatalog();
        resetInstanceCounter();
        resetPhaseSeq();
        resetResolveSeq();

        const registry = new EffectRegistry();
        registerCoreEffects(registry);

        // Reconstruir el estado final ejecutando los comandos guardados
        // sobre el snapshot inicial (event sourcing §51.12). Un guardado
        // corrupto puede hacer lanzar execute/processPhases (o el acceso a
        // playerOrder más abajo): abortar la carga en vez de rechazar la
        // promesa sin manejar.
        let restoredState;
        let rng;
        let rejectedCount = 0;
        try {
          rng = DeterministicRng.deserialize({
            seed: saved.envelope.seed,
            state: saved.envelope.initialState.rngState,
          });
          restoredState = saved.envelope.initialState.state;
          for (const cmd of saved.envelope.commands) {
            // actorId preserva al actor real en comandos de jugadores no
            // activos (reacciones) — igual que replay() del motor.
            const result = execute(restoredState, cmd, rng, registry, catalog, cmd.actorId);
            if (result.accepted) {
              restoredState = processPhases(result.newState, rng, catalog).state;
            } else {
              // Un comando rechazado diverge el estado restaurado — avisar
              rejectedCount++;
              console.warn(`loadGame: comando rechazado (${result.reason})`, cmd);
            }
          }
          if (!restoredState || !Array.isArray(restoredState.playerOrder)) {
            throw new Error('restored state is malformed');
          }
        } catch (err) {
          console.warn('loadGame: guardado corrupto, no se pudo restaurar', err);
          set((state) => {
            state.ui.message = i18n.t('common.msg.loadFailed', { name: saved.name });
          });
          return;
        }

        // Integridad: el hash guardado debe coincidir con el estado
        // reproducido. Un desajuste = guardado corrupto/manipulado.
        const hashMismatch = Boolean(
          saved.meta?.stateHash &&
          saved.meta.stateHash !== stateHash(restoredState, rng.serialize().state),
        );
        if (hashMismatch) {
          console.warn(`loadGame: stateHash no coincide en "${saved.name}"`);
        }

        // Restaurar la config para permitir revancha, re-guardado y
        // estadísticas. En guardados antiguos (sin config) se sintetiza
        // una mínima a partir del estado reproducido.
        const restoredConfig: GameConfig = saved.config ?? {
          mode: restoredState.mode,
          playerCount: restoredState.playerOrder.length,
          seed: saved.envelope.seed,
          heroes: restoredState.playerOrder.map((pid) => {
            const p = restoredState.players[pid];
            return {
              playerId: pid,
              heroId: p?.heroId ?? '',
              heroFace: p?.heroFace ?? 'MALE',
              deckId: '',
            };
          }),
          useScenarios: restoredState.scenario !== null,
        };

        set((state) => {
          state.gameState = restoredState;
          state.rng = rng;
          state.registry = registry;
          state.catalog = catalog;
          state.initialCommands = [...saved.envelope.commands];
          state.initialConfig = restoredConfig;
          // El undo de una partida cargada usa el mismo replay que el
          // propio loadGame: snapshot del envelope + comandos (§51.12).
          state.undoBase = {
            state: saved.envelope.initialState.state,
            rngState: saved.envelope.initialState.rngState,
            seed: saved.envelope.seed,
          };
          state.viewerId = restoredState.activePlayerId;
          state.ui.message = rejectedCount > 0
            ? i18n.t('common.msg.loadedRejected', { name: saved.name, count: rejectedCount })
            : hashMismatch
              ? i18n.t('common.msg.loadedHashWarn', { name: saved.name })
              : compat === 'version-mismatch'
                ? i18n.t('common.msg.loadedMismatch', { name: saved.name, ver: saved.meta?.engineVersion ?? saved.envelope?.engineVersion })
                : i18n.t('common.msg.loadedOk', { name: saved.name });
          state.ui.privacyScreen = false;
        });
      })();
    },

    loadSavedGames: () => {
      void readSavedGames().then((games) => {
        set((state) => {
          state.savedGames = games;
        });
      });
    },

    deleteSavedGame: (id: string) => {
      void enqueueSaveOp(async () => {
        // Papelera: la partida no se destruye — pasa a TRASH_KEY con
        // deletedAt para restauración o purga automática (TRASH_RETENTION_DAYS)
        const games = await readSavedGames();
        const target = games.find(g => g.id === id);
        if (!target) return;
        const remaining = games.filter(g => g.id !== id);
        const trash = [...(await purgeExpiredTrash()), { ...target, deletedAt: Date.now() }];
        await writeSavedGames(remaining);
        await writeTrashedGames(trash);
        set((state) => {
          state.savedGames = remaining;
          state.trashedGames = trash;
          state.ui.message = i18n.t('common.msg.trashedOk', { name: target.name });
        });
      });
    },

    restoreSavedGame: (saved: SavedGame) => {
      void enqueueSaveOp(async () => {
        const current = await readSavedGames();
        if (current.some(g => g.id === saved.id)) return;
        const games = [...current, saved];
        await writeSavedGames(games);
        set((state) => {
          state.savedGames = games;
        });
      });
    },

    exportSavedGame: (id: string) => {
      void (async () => {
        // Busca en guardadas y en papelera (exportar antes de eliminar)
        const saved = (await readSavedGames()).find(g => g.id === id)
          ?? (await readTrashedGames()).find(g => g.id === id);
        if (!saved) return;
        const safeName = saved.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'partida';
        // Formato contenedor .nt4hsave: versión de formato + metadatos +
        // envelope. Nunca incluye tokens ni credenciales.
        const payload = {
          format: 'nt4hsave',
          formatVersion: 1,
          exportedAt: Date.now(),
          name: saved.name,
          meta: saved.meta ?? null,
          config: saved.config ?? null,
          envelope: saved.envelope,
        };
        const ok = await exportTextFile(
          `nt4h-${safeName}.nt4hsave`,
          JSON.stringify(payload, null, 2),
        );
        set((state) => {
          state.ui.message = ok
            ? i18n.t('common.msg.exportedOk', { name: saved.name })
            : i18n.t('common.msg.exportFailed');
        });
      })();
    },

    importSavedGame: (jsonText: string) => {
      return (async () => {
        // Entrada no confiable: límite de tamaño, parseo controlado,
        // saneado de claves sensibles y validación de estructura.
        if (typeof jsonText !== 'string' || jsonText.length > MAX_IMPORT_BYTES) {
          return i18n.t('common.msg.importTooBig');
        }
        let raw: unknown;
        try {
          raw = sanitizeImportedJson(JSON.parse(jsonText));
        } catch {
          return i18n.t('common.msg.importBadJson');
        }
        // Acepta tanto el envelope directo como el contenedor .nt4hsave
        const container = raw as {
          format?: string; envelope?: unknown; name?: string; config?: unknown;
          meta?: SavedGame['meta'];
        };
        const env = (container?.format === 'nt4hsave' ? container.envelope : raw) as
          (SavedGame['envelope'] & { meta?: SavedGame['meta'] }) | undefined;
        if (!env || typeof env !== 'object' || !env.initialState || !Array.isArray(env.commands)) {
          return i18n.t('common.msg.importNotNt4h');
        }
        if (env.commands.length > MAX_IMPORT_COMMANDS) {
          return i18n.t('common.msg.importTooManyCmds');
        }
        // Cada comando debe ser un objeto con un type reconocido del motor
        for (const cmd of env.commands) {
          const c = cmd as { type?: unknown; cid?: unknown };
          if (!c || typeof c !== 'object'
            || typeof c.type !== 'string' || !KNOWN_COMMAND_TYPES.has(c.type)
            || (c.cid !== undefined && typeof c.cid !== 'string')) {
            return i18n.t('common.msg.importBadCmds');
          }
        }
        const config = env.initialState?.state as { mode?: string } | undefined;
        const importedName = typeof container?.name === 'string' && container.name.trim()
          ? container.name.trim().slice(0, 80)
          : `Importada · ${config?.mode ?? 'partida'} · ${new Date().toLocaleDateString()}`;
        // La config exportada se acepta solo si tiene la forma esperada;
        // si falta, loadGame la sintetiza desde el estado reproducido.
        const importedConfig =
          container?.format === 'nt4hsave' &&
          container.config &&
          typeof container.config === 'object' &&
          typeof (container.config as GameConfig).mode === 'string' &&
          typeof (container.config as GameConfig).playerCount === 'number' &&
          Array.isArray((container.config as GameConfig).heroes)
            ? (container.config as GameConfig)
            : undefined;
        const saved: SavedGame = {
          // Id siempre nuevo: nunca confiar en el id del fichero (colisiones)
          id: `imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          name: importedName,
          savedAt: Date.now(),
          envelope: env,
          config: importedConfig,
          // En el contenedor .nt4hsave, meta/config viven al nivel raíz;
          // en un envelope desnudo pueden viajar dentro del propio envelope.
          meta: container?.format === 'nt4hsave' ? container.meta : env.meta,
        };
        const compat = classifySavedGame(saved);
        if (compat === 'incompatible') {
          return i18n.t('common.msg.importIncompatible');
        }
        await enqueueSaveOp(async () => {
          const current = await readSavedGames();
          const games = [...current, saved];
          await writeSavedGames(games);
          set((state) => {
            state.savedGames = games;
            state.ui.message = compat === 'version-mismatch'
              ? i18n.t('common.msg.importMismatch')
              : i18n.t('common.msg.importOk', { name: saved.name });
          });
        });
        return null;
      })();
    },

    renameSavedGame: (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      void enqueueSaveOp(async () => {
        const games = (await readSavedGames()).map(g =>
          g.id === id ? { ...g, name: trimmed } : g,
        );
        await writeSavedGames(games);
        set((state) => {
          state.savedGames = games;
        });
      });
    },

    loadTrashedGames: () => {
      void purgeExpiredTrash().then((trash) => {
        set((state) => {
          state.trashedGames = trash;
        });
      });
    },

    restoreTrashedGame: (id: string) => {
      void enqueueSaveOp(async () => {
        const trash = await readTrashedGames();
        const target = trash.find(g => g.id === id);
        if (!target) return;
        const { deletedAt: _deletedAt, ...saved } = target;
        const remaining = trash.filter(g => g.id !== id);
        const games = [...(await readSavedGames()), saved];
        await writeTrashedGames(remaining);
        await writeSavedGames(games);
        set((state) => {
          state.trashedGames = remaining;
          state.savedGames = games;
          state.ui.message = i18n.t('common.msg.restoredOk', { name: saved.name });
        });
      });
    },

    deleteTrashedGame: (id: string) => {
      void enqueueSaveOp(async () => {
        const trash = (await readTrashedGames()).filter(g => g.id !== id);
        await writeTrashedGames(trash);
        set((state) => {
          state.trashedGames = trash;
        });
      });
    },

    emptyTrash: () => {
      void (async () => {
        await writeTrashedGames([]);
        set((state) => {
          state.trashedGames = [];
        });
      })();
    },
  }))
);

// Colección: las cartas que se revelan durante la partida quedan
// "descubiertas" — enemigos del campo, oferta del Mercado, escenario
// activo y cartas vistas en manos/desgaste/persistentes.
let lastDiscoveryState: GameState | null = null;
useGameStore.subscribe((s) => {
  const gs = s.gameState;
  if (!gs || gs === lastDiscoveryState) return;
  lastDiscoveryState = gs;
  const revealed = new Set<string>();
  for (const e of gs.battlefield ?? []) revealed.add(e.definitionId);
  for (const c of gs.market ?? []) revealed.add(c.definitionId);
  if (gs.scenario?.definitionId) revealed.add(gs.scenario.definitionId);
  for (const p of Object.values(gs.players ?? {})) {
    for (const c of p.hand ?? []) revealed.add(c.definitionId);
    for (const c of p.wearPile ?? []) revealed.add(c.definitionId);
    for (const c of p.persistentCards ?? []) revealed.add(c.definitionId);
  }
  // El centinela online nunca debe registrarse en la colección: no es una
  // carta real (sanitizeOnlineState lo usa para ocultar manos ajenas).
  revealed.delete(HIDDEN_CARD);
  if (revealed.size > 0) useCollection.getState().markDiscovered([...revealed]);
});

// Re-exportar para uso en componentes
export { ENGINE_VERSION };
