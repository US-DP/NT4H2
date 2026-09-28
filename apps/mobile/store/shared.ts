/**
 * Helpers compartidos por los slices del gameStore (extraido de gameStore.ts).
 */

import type {
  GameState,
  GameConfig,
  Command,
  ContentSet,
} from '@nt4h/schema';
import {
  type DeterministicRng,
  type EffectRegistry,
  createReplay,
  projectEventsForPlayer,
  ENGINE_VERSION,
  SNAPSHOT_VERSION,
} from '@nt4h/engine';
import type { CommandReasonCode } from '@nt4h/engine';
import type { CatalogLoadResult } from '@nt4h/catalog';


export interface GameUIState {
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
  /** Conjuntos del Taller instalados al guardar: hacen la partida
   *  autocontenida — borrar/editar el set después no corrompe el replay. */
  customSets?: ContentSet[];
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


/** Omit distributivo sobre uniones discriminadas (Command) */
export type CommandWithoutCid = Command extends infer C ? (C extends Command ? Omit<C, 'cid'> : never) : never;

/** definitionId centinela para cartas cuyo contenido es secreto */
export const HIDDEN_CARD = 'hidden.card';

// cid unico: Date.now() solo da granularidad de ms — dos comandos en el
// mismo ms colisionarian y el servidor los deduplicaria en silencio (D434)
let _cidCounter = 0;
export function newCid(prefix: string): string {
  return `${prefix}-${Date.now()}-${(++_cidCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
export function sanitizeOnlineState(state: GameState, viewerId: string | null): GameState {
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

export interface GameStore {
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
