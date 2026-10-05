/**
 * replay — serialización, snapshots y replay de partidas.
 *
 * Implementación de GameSnapshot, ReplayEnvelope, replay() y stateHash()
 * (sección 51.12 de la especificación).
 *
 * El replay permite reconstruir cualquier partida a partir de:
 * - Estado inicial (snapshot)
 * - Semilla del RNG
 * - Secuencia de comandos
 * - Versiones del contenido
 */

import type { GameState, Command, GameEvent } from '@nt4h/schema';
import { DeterministicRng } from '../rng/index.js';
import { EffectRegistry, registerCoreEffects } from '../effects/registry.js';
import { execute } from '../commands/execute.js';
import { replayEvents } from '../events/applyEvent.js';
import { processPhases } from '../phases/engine.js';
import { resetSeq, setSeq, currentSeq } from '../seq.js';
import { resetInstanceCounter } from '../phases/setup.js';
import type { CatalogLoadResult } from '@nt4h/catalog';

/** Versión del esquema de snapshot */
export const SNAPSHOT_VERSION = 1;

/** Versión actual del motor */
export const ENGINE_VERSION = '0.1.0';
/**
 * Version del reglamento digital: independiente del motor y del catalogo —
 * el reglamento puede corregirse o re-redactarse sin tocar codigo.
 */
export const RULESET_VERSION = '1.0.0';

export interface GameSnapshot {
  version: number;
  engineVersion: string;
  seed: string;
  rngState: number;
  state: GameState;
  eventCount: number;
  takenAt: number;
  /** Valor del contador de seq global al tomar el snapshot (replay bit-identico) */
  seq?: number;
}

export interface ReplayEnvelope {
  version: '1.0';
  gameType: string;
  seed: string;
  engineVersion: string;
  contentVersions: Record<string, string>;
  initialState: GameSnapshot;
  commands: Command[];
}

export interface CommandResult {
  accepted: boolean;
  reason?: string;
  events: GameEvent[];
  newState: GameState;
}

/**
 * Crear un snapshot del estado actual.
 */
export function createSnapshot(
  state: GameState,
  rng: DeterministicRng,
  eventCount: number,
): GameSnapshot {
  const rngSerialized = rng.serialize();
  return {
    version: SNAPSHOT_VERSION,
    engineVersion: ENGINE_VERSION,
    seed: rngSerialized.seed,
    rngState: rngSerialized.state,
    state,
    eventCount,
    takenAt: state.monotonicCounter,
    seq: currentSeq(),
  };
}

/** Contexto de replay incremental: el cursor de la UI de replay. */
export interface ReplayCursor {
  state: GameState;
  rng: DeterministicRng;
  registry: EffectRegistry;
}

/**
 * Inicializar un replay incremental: fija los contadores globales
 * (seq/instanceId) como hace replay() y devuelve el cursor.
 */
export function replayInit(envelope: ReplayEnvelope): ReplayCursor {
  const snapshot = envelope.initialState;
  if (snapshot.seq !== undefined) {
    setSeq(snapshot.seq);
  } else {
    resetSeq();
  }
  resetInstanceCounter();
  return {
    state: snapshot.state,
    rng: DeterministicRng.deserialize({
      seed: snapshot.seed,
      state: snapshot.rngState,
    }),
    registry: (() => {
      const r = new EffectRegistry();
      registerCoreEffects(r);
      return r;
    })(),
  };
}

/**
 * Un paso de replay: ejecuta el comando N sobre el cursor y las fases
 * automáticas. La UI de replay lo encadena paso a paso (checkpoints)
 * en vez de replay() desde cero por cada step — O(n) por salto en vez
 * de O(n²) para un visionado completo.
 */
export function replayStep(
  cursor: ReplayCursor,
  cmd: Command,
  catalog?: CatalogLoadResult,
): GameState {
  // actorId preserva al actor real (pericias reactivas de jugadores no
  // activos, pujas de líder) — sin él el replay divergiría del online.
  const result = execute(cursor.state, cmd, cursor.rng, cursor.registry, catalog, cmd.actorId);
  if (!result.accepted) return cursor.state;
  cursor.state = result.newState;
  // Ejecutar fases automáticas tras cada comando (D343)
  if (catalog) {
    cursor.state = processPhases(cursor.state, cursor.rng, catalog).state;
  }
  return cursor.state;
}

/**
 * Reconstruir una partida desde un ReplayEnvelope.
 * Reproduce exactamente el mismo estado final.
 */
export function replay(envelope: ReplayEnvelope, catalog?: CatalogLoadResult): GameState {
  const cursor = replayInit(envelope);
  for (const cmd of envelope.commands) {
    replayStep(cursor, cmd, catalog);
  }
  return cursor.state;
}

/**
 * Reconstruir desde un snapshot + eventos posteriores.
 */
export function replayFromSnapshot(
  snapshot: GameSnapshot,
  events: GameEvent[],
): GameState {
  if (snapshot.seq !== undefined) {
    setSeq(snapshot.seq);
  } else {
    resetSeq();
  }
  resetInstanceCounter();
  let state = snapshot.state;
  state = replayEvents(state, events);
  return state;
}

/**
 * Hash determinista del estado para verificación.
 * Usa un hash estable que no depende del orden de claves del objeto.
 */
export function stateHash(state: GameState, rngState?: number): string {
  const data = rngState !== undefined ? { state, rngState } : { state };
  return deterministicJsonHash(data);
}

/**
 * Hash JSON determinista.
 * Ordena las claves de los objetos alfabéticamente para garantizar
 * que el mismo estado produzca siempre el mismo hash.
 */
function deterministicJsonHash(data: unknown): string {
  const json = stableStringify(data);
  // FNV-1a hash de 32 bits
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * JSON.stringify con claves ordenadas establemente.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }

  // Set se serializa como array ordenado
  if (value instanceof Set) {
    return stableStringify(Array.from(value).sort());
  }

  // Map se serializa como array de pares ordenados por clave
  if (value instanceof Map) {
    const entries = Array.from(value.entries()).sort((a, b) =>
      String(a[0]).localeCompare(String(b[0]))
    );
    return stableStringify(entries);
  }

  // Claves con valor undefined se omiten (semántica JSON.stringify): el
  // estado vivo puede llevar propiedades opcionales explícitas que el
  // snapshot serializado pierde — sin esto el hash divergía al recargar.
  const keys = Object.keys(value)
    .filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Crear un ReplayEnvelope desde una partida jugada.
 */
export function createReplay(
  gameType: string,
  seed: string,
  initialState: GameState,
  commands: Command[],
  contentVersions: Record<string, string> = {},
  rng?: DeterministicRng,
): ReplayEnvelope {
  const rngState = rng ? rng.serialize().state : (initialState.rngState?.state ?? 0);
  return {
    version: '1.0',
    gameType,
    seed,
    engineVersion: ENGINE_VERSION,
    contentVersions,
    initialState: {
      version: SNAPSHOT_VERSION,
      engineVersion: ENGINE_VERSION,
      seed,
      rngState,
      state: initialState,
      eventCount: 0,
      takenAt: initialState.monotonicCounter,
      // Capturar el seq global para que el replay emita los mismos seq
      // (bit-idéntico, §51.12)
      seq: currentSeq(),
    },
    commands,
  };
}
