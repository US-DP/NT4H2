/** Slice saves del gameStore — extraido de gameStore.ts. */

import type { StateCreator } from 'zustand';
import type { GameStore, TrashedGame } from '../shared.js';
import { classifySavedGame } from '../shared.js';

import { useCustomContent } from '../../lib/customContent';
import { exportTextFile } from '../../lib/exportSave.js';
import { storageGet, storageSet, storageSetAtomic } from '../../lib/storage.js';
import i18n from '../../lib/i18n';
import type { SavedGame } from '../shared.js';
import {
  CATALOG_VERSION,
  loadCatalog,
  mergeCustomCards,
  validateContentSet,
} from '@nt4h/catalog';
import {
  DeterministicRng,
  ENGINE_VERSION,
  EffectRegistry,
  SNAPSHOT_VERSION,
  createReplay,
  execute,
  processPhases,
  registerCoreEffects,
  resetInstanceCounter,
  resetPhaseSeq,
  resetResolveSeq,
  resetSeq,
  setSeq,
  stateHash,
} from '@nt4h/engine';
import type { GameConfig } from '@nt4h/schema';

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

type Actions = Pick<GameStore, 'saveGame'|'loadGame'|'loadSavedGames'|'deleteSavedGame'|'exportSavedGame'|'importSavedGame'|'renameSavedGame'|'loadTrashedGames'|'restoreTrashedGame'|'deleteTrashedGame'|'emptyTrash'>;

export const createSavesSlice: StateCreator<GameStore, [['zustand/immer', never]], [], Actions> = (set, get) => ({
  saveGame: (name: string): Promise<boolean> => {
    const { gameState, rng, initialConfig, initialCommands, connectionMode, undoBase } = get();
    // En online el gameState es la proyección sanitizada (manos ocultas,
    // RNG zeroed, sin comandos): guardar eso corrompería la partida.
    if (connectionMode === 'online') {
      set((state) => {
        state.ui.message = i18n.t('common.msg.saveOnlineNo');
      });
      return Promise.resolve(false);
    }
    // undoBase es el snapshot INICIAL (post-setup): el envelope debe
    // contener ese estado — pasar gameState aquí serializaba el estado
    // FINAL como "inicial" y loadGame re-ejecutaba los comandos sobre el
    // estado ya resuelto (rechazos masivos o comandos doble-aplicados).
    if (!gameState || !rng || !initialConfig || !undoBase) return Promise.resolve(false);

    const initialRng = DeterministicRng.deserialize({
      seed: undoBase.seed,
      state: undoBase.rngState,
    });
    const envelope = createReplay(
      initialConfig.mode,
      undoBase.seed,
      structuredClone(undoBase.state),
      initialCommands,
      { catalog: CATALOG_VERSION },
      initialRng,
    );
    // createReplay estampa currentSeq() (momento del guardado); el
    // snapshot debe llevar el seq del instante de la base para que el
    // replay/reload emita los mismos identificadores de evento.
    if (typeof undoBase.seq === 'number') {
      envelope.initialState.seq = undoBase.seq;
    }

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
      customSets: useCustomContent.getState().sets.length > 0
        ? useCustomContent.getState().sets : undefined,
      meta: {
        engineVersion: ENGINE_VERSION,
        catalogVersion: CATALOG_VERSION,
        snapshotVersion: SNAPSHOT_VERSION,
        stateHash: stateHash(gameState, rng.serialize().state),
      },
    };

    // La promesa resuelve cuando la escritura REAL termina — la UI
    // mostraba "saved" síncrono aunque la escritura encolada fallara.
    return enqueueSaveOp(async () => {
      const prev = await readSavedGames();
      // El autosave solo se deduplica cuando lo que se guarda ES el
      // autosave — un guardado manual nunca debe borrarlo (era pérdida
      // de datos: saveGame("Mi partida") eliminaba la copia automática).
      const dropAutosave = saved.id === 'save-autosave' || saved.name === 'Autosave';
      const games = [
        ...prev.filter(g => g.id !== saved.id && (!dropAutosave || g.name !== 'Autosave')),
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
      return persisted;
    });
  },

  loadGame: (id: string) => {
    // Una sesión online viva seguiría pisando gameState con cada
    // broadcast command_result — cortar antes de cargar la partida local.
    if (get().connectionMode === 'online') get().disconnectOnline();
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

      // Partidas con contenido del Taller son autocontenidas: el replay
      // usa los sets CAPTURADOS en el guardado, no los instalados hoy
      // (borrar/editar un set ya no diverge la restauración).
      let catalog = get().catalog ?? loadCatalog();
      if (saved.customSets?.length) {
        const base = loadCatalog();
        const validSets = saved.customSets
          .map(s => validateContentSet(s, base.byId))
          .filter(r => r.ok && r.set)
          .map(r => r.set!);
        catalog = mergeCustomCards(base, validSets);
      }
      resetInstanceCounter();
      resetPhaseSeq();
      resetResolveSeq();
      // El seq global también debe rebobinarse al del snapshot: sin esto
      // los eventos re-generados llevarían seqs distintos del run original
      // (misma semántica que replayInit del motor).
      const snapSeq = saved.envelope.initialState.seq;
      if (typeof snapSeq === 'number' && Number.isFinite(snapSeq)) setSeq(snapSeq);
      else resetSeq();

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
        // structuredClone: rompe el alias con savedGames[i].envelope —
        // el snapshot guardado no debe compartir identidad con el estado
        // vivo ni con la base de undo.
        restoredState = structuredClone(saved.envelope.initialState.state);
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
          state: structuredClone(saved.envelope.initialState.state),
          rngState: saved.envelope.initialState.rngState,
          seed: saved.envelope.seed,
          seq: saved.envelope.initialState.seq,
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
        // Igual que newGame: ninguna selección de la partida anterior
        // sobrevive a un loadGame (los instanceIds pueden reciclarse).
        state.ui.evasionSelection = null;
        state.ui.swapSelection = null;
        state.ui.selectedCardInstanceId = null;
        state.ui.selectedEnemyInstanceId = null;
      });
    })();
  },

  loadSavedGames: () => {
    // Por la cola de escritura: una lectura concurrente con un save/
    // delete encolado devolvía la lista vieja (o un JSON a medio
    // escribir en backends sin atomicidad).
    void enqueueSaveOp(async () => {
      const games = await readSavedGames();
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

  // (restoreSavedGame eliminada: era un duplicado obsoleto de
  //  restoreTrashedGame que añadía la partida sin quitarla de la
  //  papelera ni limpiar deletedAt — nunca tuvo consumidores)
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
        // customSets: la partida con contenido del Taller debe ser
        // autocontenida — sin ellos, importar en otro dispositivo cargaba
        // el replay contra el catálogo oficial y los comandos se rechazaban.
        customSets: saved.customSets ?? null,
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
        meta?: SavedGame['meta']; customSets?: unknown;
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
        // customSets (autocontención del Taller): viajan en el contenedor
        // desde formatVersion 1; un envelope desnudo puede traerlos dentro.
        // Solo se aceptan si son un array — la validación real la hace
        // validateContentSet al cargar la partida.
        customSets: (() => {
          const rawSets = container?.format === 'nt4hsave'
            ? container.customSets
            : (env as { customSets?: unknown }).customSets;
          return Array.isArray(rawSets)
            ? rawSets as SavedGame['customSets']
            : undefined;
        })(),
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
    // Serializado como el resto de mutaciones de papelera — sin la cola
    // un delete/restore en vuelo podía escribir una lista antigua
    // encima y resucitar entradas ya purgadas.
    void enqueueSaveOp(async () => {
      await writeTrashedGames([]);
      set((state) => {
        state.trashedGames = [];
      });
    });
  },
});
