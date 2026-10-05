/**
 * engine-runner — servicio Node que ejecuta el motor TS.
 *
 * Django Channels delega la ejecucion de comandos a este servicio via HTTP.
 * El motor TS es la unica fuente de verdad para las reglas del juego.
 */

import express from 'express';
import { z } from 'zod';
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { timingSafeEqual } from 'crypto';
import { EffectRegistry, registerCoreEffects, setupGame, startFirstTurn, execute, processPhases, projectEventsForPlayer, DeterministicRng, currentSeq, setSeq } from '@nt4h/engine';
import { loadCatalog, mergeCustomCards, validateContentSet, type CatalogLoadResult } from '@nt4h/catalog';
import type { GameConfig, Command, GameState, ContentSet } from '@nt4h/schema';

/** definitionId centinela para cartas cuyo contenido es secreto */
const HIDDEN_CARD = 'hidden.card';

/** viewerId sintetico para clientes sin jugador (espectador): no ve nada privado */
const SPECTATOR_ID = '__spectator__';

/**
 * D425 (RF-J095): sanitiza el estado para un jugador manteniendo la forma de
 * GameState (los componentes UI dependen de ella). Oculta manos/mazos ajenos,
 * recompensas de enemigos, elecciones de otros y el estado del RNG.
 */
/** Redacta una carta oculta: sin el definitionId queda visible pero el
 *  `name` y el `persistentTrigger` también revelan qué carta es — hay que
 *  limpiarlos junto con el id. */
const redactCard = (c: GameState['hordeDeck'][number]) => ({
  ...c,
  definitionId: HIDDEN_CARD,
  name: undefined,
  persistentTrigger: undefined,
  auraModifiers: undefined,
});

function sanitizeForPlayer(state: GameState, viewerId: string): GameState {
  const players: GameState['players'] = {};
  for (const [id, p] of Object.entries(state.players)) {
    players[id] = id === viewerId
      ? p
      : {
          ...p,
          hand: p.hand.map(redactCard),
          abilityDeck: p.abilityDeck.map(redactCard),
          wearPile: p.wearPile.map(redactCard),
          // Hoy solo se usan en SOLO (1 jugador), pero si un modo
          // multijugador los toca, el mazo de apoyos ajeno quedaba
          // expuesto en claro — redactar igual que el resto.
          supportDecks: (p.supportDecks ?? []).map(d => d.map(redactCard)),
        };
  }
  return {
    ...state,
    players,
    hordeDeck: state.hordeDeck.map(redactCard),
    marketDeck: state.marketDeck.map(redactCard),
    scenarioDeck: state.scenarioDeck.map(redactCard),
    battlefield: state.battlefield.map(e => ({ ...e, reward: null })),
    pendingChoices: state.pendingChoices.filter(c => c.playerId === viewerId),
    eventLog: projectEventsForPlayer(state.eventLog, viewerId),
    rngState: { seed: '', state: 0 },
  };
}

// ============================================================================
// D432: Validacion Zod de comandos y payloads de entrada
// ============================================================================

// R-1: charset whitelist — un cid/id con \n, \r o tabulaciones inyecta
// líneas falsas en los logs del runner (log forging) y con caracteres de
// control rompe herramientas que los procesan. Imprimibles ASCII +
// puntuación común de ids es suficiente para los clientes.
const SAFE_ID = /^[\w.@:+-]{1,128}$/;
const cidSchema = z.string().regex(SAFE_ID);
// D440: ids no pueden ser claves peligrosas de objetos JS (proto-pollution)
// ni prefijo '__' — reservado para centinelas internos (SPECTATOR_ID):
// un jugador llamado '__spectator__' recibiría la vista del espectador
// en /state y cualquier 'playerId' con prefijo '__' colisiona con ellos.
const UNSAFE_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const idSchema = z.string().regex(SAFE_ID).refine(
  (v) => !UNSAFE_IDS.has(v) && !v.startsWith('__'),
  { message: 'Unsafe identifier' },
);
// roomId: solo caracteres seguros para fichero — el snapshot en disco
// sanitiza el nombre, así que dos ids distintos que colapsaran al mismo
// path compartirían snapshot (a.b vs a_b). Mejor rechazarlos de entrada.
const roomIdSchema = /^[A-Za-z0-9_-]{1,128}$/;

const PaymentSchema = z.union([
  z.object({ type: z.literal('GLORY'), amount: z.number().int().min(0) }),
  z.object({ type: z.literal('COINS'), amount: z.number().int().min(0) }),
]);

// actorId (opcional): el runner lo sobrescribe con el playerId autenticado
// tras validar — sirve para el log/replay, no para suplantar identidad.
const actor = { actorId: idSchema.optional() };
const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PLAY_CARD'), cid: cidSchema, ...actor, cardInstanceId: idSchema, targetEnemyId: idSchema.optional() }),
  z.object({ type: z.literal('END_ATTACK'), cid: cidSchema, ...actor }),
  z.object({ type: z.literal('EVASION'), cid: cidSchema, ...actor, discardedCardInstanceIds: z.array(idSchema).max(60) }),
  z.object({ type: z.literal('BUY_CARD'), cid: cidSchema, ...actor, marketCardInstanceId: idSchema }),
  z.object({ type: z.literal('END_TURN'), cid: cidSchema, ...actor }),
  z.object({ type: z.literal('USE_HERO_ABILITY'), cid: cidSchema, ...actor, targetId: idSchema.optional() }),
  z.object({ type: z.literal('CHOOSE_LEADER_CARDS'), cid: cidSchema, ...actor, cardInstanceIds: z.array(idSchema).min(1).max(2) }),
  z.object({ type: z.literal('RESOLVE_CHOICE'), cid: cidSchema, ...actor, choiceId: z.string().min(1).max(200), selectedIds: z.array(idSchema).max(60) }),
  z.object({ type: z.literal('PASS'), cid: cidSchema, ...actor }),
  z.object({ type: z.literal('SWAP_STARTING_CARDS'), cid: cidSchema, ...actor, cardInstanceIds: z.array(idSchema).max(10) }),
  z.object({ type: z.literal('ACCEPT_TURN_START_EFFECT'), cid: cidSchema, ...actor, accepted: z.boolean() }),
  z.object({ type: z.literal('OPEN_SUPPORT_DECK'), cid: cidSchema, ...actor, supportDeckIndex: z.number().int().min(0).max(10) }),
  z.object({ type: z.literal('BUY_SUPPORT_CARD'), cid: cidSchema, ...actor, supportDeckIndex: z.number().int().min(0).max(10), payment: PaymentSchema }),
]);

const CreateRoomSchema = z.object({
  config: z.object({
    mode: z.enum(['STANDARD', 'SOLO', 'MULTICLASS']),
    playerCount: z.number().int().min(1).max(4),
    // Semilla vacía o solo-espacios produce partidas idénticas en cadena.
    seed: z.string().trim().min(1).max(256),
    heroes: z.array(z.object({
      playerId: idSchema,
      heroId: idSchema,
      heroFace: z.enum(['FEMALE', 'MALE']),
      deckId: z.string().max(128),
      secondDeckId: z.string().max(128).optional(),
      playerAge: z.number().int().min(0).optional(),
      customDeckId: z.string().max(128).optional(),
    })).min(1).max(4)
      // playerIds duplicados colapsan en players{} pero duplican la puja
      // leader-bid-<pid> → eventos dobles y puja irresoluble.
      .refine(
        h => new Set(h.map(x => x.playerId)).size === h.length,
        { message: 'duplicate playerId in heroes' },
      ),
    useScenarios: z.boolean(),
    scenarioIds: z.array(z.string().max(128)).optional(),
    soloMarketCardIds: z.array(z.string().max(128)).optional(),
    soloSupportHeroIds: z.array(z.string().max(128)).optional(),
    // Pools personalizados del Taller (snapshot en la config)
    customDecks: z.array(z.object({
      id: z.string().max(128),
      cardDefinitionIds: z.array(z.string().max(128)).max(60),
    })).max(8).optional(),
    hordeCardIds: z.array(z.string().max(128)).max(120).optional(),
    warlordIds: z.array(z.string().max(128)).max(10).optional(),
    marketCardIds: z.array(z.string().max(128)).max(120).optional(),
    // Conjuntos del Taller como snapshot validado: el runner fusiona sus
    // cartas con el catálogo oficial SOLO para esta sala.
    customSets: z.array(z.unknown()).max(8).optional(),
  }).superRefine((cfg, ctx) => {
    // playerCount = capacidad de la sala (puede ser > heroes.length: la
    // sala se crea solo con el host y se recrea al start con todos).
    // NO validar igualdad — el engine ignora playerCount.
    // SOLO multihéroe no está soportado: la puja de Líder quedaría
    // esperando jugadores que solo son la misma persona.
    if (cfg.mode === 'SOLO' && cfg.heroes.length !== 1) {
      ctx.addIssue({ code: 'custom', message: 'SOLO mode requires exactly one hero' });
    }
  }),
});

const CommandBodySchema = z.object({
  cid: cidSchema,
  playerId: idSchema,
  command: CommandSchema,
  /** Revisión del estado que el cliente cree vigente (optimistic check) */
  expectedRevision: z.number().int().min(0).optional(),
  /** Secuencia monotónica por cliente (anti-reordenado/replay fuera de ventana cid) */
  clientSequence: z.number().int().min(0).optional(),
});

// ============================================================================
// D433: Autenticacion backend → runner (secreto compartido)
// ============================================================================

const ENGINE_TOKEN = process.env.ENGINE_RUNNER_TOKEN ?? '';
const DEV_OPEN = process.env.ENGINE_RUNNER_DEV_OPEN === '1';
if (!ENGINE_TOKEN && !DEV_OPEN) {
  // D433 (fail-closed): sin secreto compartido el runner aceptaría comandos
  // con cualquier playerId (suplantación total). Solo se permite abrir con
  // ENGINE_RUNNER_DEV_OPEN=1 explícito (desarrollo local).
  console.error(
    'ENGINE_RUNNER_TOKEN no configurado — abortando. ' +
    'Define un secreto compartido o usa ENGINE_RUNNER_DEV_OPEN=1 en dev.',
  );
  process.exit(1);
}
if (!ENGINE_TOKEN) {
  console.warn('ENGINE_RUNNER_TOKEN vacío — endpoints abiertos (DEV_OPEN=1)');
}

function requireEngineAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!ENGINE_TOKEN) {
    next();
    return;
  }
  const token = req.headers['x-engine-token'];
  // Comparación en tiempo constante: un `!==` permitiría medir por
  // timing cuántos caracteres del secreto son correctos.
  const expected = Buffer.from(ENGINE_TOKEN, 'utf8');
  const given = typeof token === 'string' ? Buffer.from(token, 'utf8') : null;
  if (!given || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ============================================================================
// Almacenamiento en memoria (en produccion: Redis o PostgreSQL)
// ============================================================================

/** D434: processedCids acotado — Map FIFO con capacidad maxima */
const MAX_PROCESSED_CIDS = 500;
class BoundedCidSet {
  private readonly map = new Map<string, true>();
  has(cid: string): boolean {
    return this.map.has(cid);
  }
  add(cid: string): void {
    if (this.map.has(cid)) return;
    this.map.set(cid, true);
    if (this.map.size > MAX_PROCESSED_CIDS) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
  /** Para snapshots: orden de antigüedad (el primero es el más viejo). */
  toArray(): string[] {
    return [...this.map.keys()];
  }
}

const rooms = new Map<string, {
  state: GameState;
  rng: DeterministicRng;
  registry: EffectRegistry;
  processedCids: BoundedCidSet;
  lastActivity: number;
  /** Revisión del estado: se incrementa con cada comando aceptado */
  revision: number;
  /** Última clientSequence procesada por jugador */
  lastClientSeq: Map<string, number>;
  /** Catálogo de la sala: oficial + sets custom de la config (si los hay) */
  catalog: CatalogLoadResult;
  /** Sets custom recibidos en la config (necesarios para re-fusionar en restore) */
  customSets?: ContentSet[];
}>();

// ============================================================================
// Persistencia de snapshots (opt-in): si ENGINE_RUNNER_STATE_DIR está definido,
// cada sala se guarda tras cada comando aceptado y se restaura al arrancar.
// Sin él el runner sigue siendo en memoria pura (dev).
// ============================================================================

const STATE_DIR = process.env.ENGINE_RUNNER_STATE_DIR ?? '';
if (STATE_DIR) {
  mkdirSync(STATE_DIR, { recursive: true });
}

interface RoomSnapshot {
  state: GameState;
  rngState: { seed: string; state: number };
  revision: number;
  cids: string[];
  lastClientSeq: Record<string, number>;
  /** Contador de seq global del motor al persistir (ver restoreSeqFloor) */
  seq?: number;
  customSets?: ContentSet[];
  savedAt: number;
}

/**
 * El seq global del motor es compartido y monótono: al restaurar una sala
 * (arranque con STATE_DIR o /restore del backend) el contador debe quedar
 * POR ENCIMA del mayor seq del eventLog restaurado — sin esto los eventos
 * nuevos reemiten valores ya usados y rompen el orden del log, el
 * `sync?after=` del backend y la dedup de oyentes del motor.
 * `Math.max(currentSeq, floor)`: el contador nunca retrocede por debajo
 * de lo que ya usan otras salas vivas del proceso.
 */
function restoreSeqFloor(snapSeq: number | undefined, state: GameState): void {
  let floor = typeof snapSeq === 'number' && Number.isFinite(snapSeq) ? snapSeq : 0;
  for (const ev of state.eventLog) {
    if (typeof ev?.seq === 'number' && ev.seq > floor) floor = ev.seq;
  }
  if (floor > currentSeq()) setSeq(floor);
}

/** R-4: entero no negativo seguro — NaN, negativos o floats en revision/
 *  lastClientSeq del snapshot corrompían los checks de expectedRevision y
 *  el orden por clientSequence (NaN < x es falso → todo pasaba). */
function safeNonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
}

function sanitizeLastClientSeq(m: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (m && typeof m === 'object') {
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      const n = safeNonNegInt(v);
      if (n > 0) out.set(k, n);
    }
  }
  return out;
}

function snapshotPath(roomId: string): string {
  // roomId es idSchema (≤128, sin '/'); filtrar por seguridad extra
  const safe = roomId.replace(/[^A-Za-z0-9_-]/g, '_');
  return join(STATE_DIR, `${safe}.json`);
}

function persistRoom(roomId: string, room: NonNullable<ReturnType<typeof rooms.get>>): void {
  if (!STATE_DIR) return;
  const snap: RoomSnapshot = {
    state: room.state,
    rngState: room.rng.serialize(),
    revision: room.revision,
    cids: room.processedCids.toArray(),
    lastClientSeq: Object.fromEntries(room.lastClientSeq),
    seq: currentSeq(),
    customSets: room.customSets,
    savedAt: Date.now(),
  };
  const path = snapshotPath(roomId);
  try {
    // Escritura atómica: tmp + rename (evita snapshots a medias en crash)
    writeFileSync(`${path}.tmp`, JSON.stringify(snap));
    renameSync(`${path}.tmp`, path);
  } catch (err) {
    console.error(`persist ${roomId} failed:`, err);
  }
}

// Escritura diferida: un comando aceptado marca la sala como "sucia" y el
// flush agrupa todos los cambios en un tick (antes: stringify+rename de
// todo el estado por CADA comando — trabajo redundante en ráfagas).
const dirtyRooms = new Set<string>();
let persistTimer: NodeJS.Timeout | null = null;
const PERSIST_DEBOUNCE_MS = 500;

function flushPersists(): void {
  persistTimer = null;
  for (const roomId of dirtyRooms) {
    const room = rooms.get(roomId);
    if (room) persistRoom(roomId, room);
  }
  dirtyRooms.clear();
}

function schedulePersist(roomId: string): void {
  if (!STATE_DIR) return;
  dirtyRooms.add(roomId);
  if (!persistTimer) {
    persistTimer = setTimeout(flushPersists, PERSIST_DEBOUNCE_MS);
    persistTimer.unref?.();
  }
}

function unpersistRoom(roomId: string): void {
  if (!STATE_DIR) return;
  dirtyRooms.delete(roomId); // no resucitar una sala borrada al flush
  try { unlinkSync(snapshotPath(roomId)); } catch { /* no existe */ }
}

/** Chequeo de forma mínima del estado restaurado: sin esto un snapshot
 *  corrupto pero JSON-válido se ejecutaría con estructuras rotas. */
function isPlausibleState(state: unknown): state is GameState {
  const s = state as GameState | null;
  return Boolean(
    s && typeof s === 'object'
    && typeof s.phase === 'string'
    && s.players && typeof s.players === 'object'
    && Array.isArray(s.playerOrder)
    && Array.isArray(s.battlefield)
    && Array.isArray(s.eventLog)
    // Los arrays que sanitizeForPlayer recorre sin guard: un snapshot
    // plausible sin ellos restauraba y luego crasheaba /state con 500
    // permanente (y nunca llegaba a marcarse .corrupt-*).
    && Array.isArray(s.hordeDeck)
    && Array.isArray(s.marketDeck)
    && Array.isArray(s.scenarioDeck)
    && Array.isArray(s.market)
    && Array.isArray(s.pendingChoices)
    && typeof s.rngState?.seed === 'string'
    && typeof s.rngState?.state === 'number',
  );
}

function loadPersistedRooms(): number {
  if (!STATE_DIR || !existsSync(STATE_DIR)) return 0;
  let loaded = 0;
  const CORRUPT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // .corrupt-* >7 días: podar
  for (const file of readdirSync(STATE_DIR)) {
    // Restos de un crash a mitad de persist: el .tmp nunca llegó al rename.
    if (file.endsWith('.tmp')) {
      try { unlinkSync(join(STATE_DIR, file)); } catch { /* mejor esfuerzo */ }
      continue;
    }
    // Snapshots apartados por corrupción: se conservan un tiempo para
    // inspección manual, pero no indefinidamente.
    if (file.includes('.corrupt-')) {
      try {
        if (Date.now() - statSync(join(STATE_DIR, file)).mtimeMs > CORRUPT_TTL_MS) {
          unlinkSync(join(STATE_DIR, file));
        }
      } catch { /* mejor esfuerzo */ }
      continue;
    }
    if (!file.endsWith('.json')) continue;
    // R-2: el boot cargaba TODOS los snapshots en memoria — miles de
    // ficheros stale = OOM antes de poder rechazarlos por MAX_ROOMS.
    if (loaded >= MAX_ROOMS) {
      console.warn(`snapshot ${file} ignorado: MAX_ROOMS alcanzado en boot`);
      continue;
    }
    try {
      const snap = JSON.parse(readFileSync(join(STATE_DIR, file), 'utf-8')) as RoomSnapshot;
      if (!isPlausibleState(snap?.state) || typeof snap.rngState?.state !== 'number') {
        throw new Error('snapshot con forma inválida');
      }
      const registry = new EffectRegistry();
      registerCoreEffects(registry);
      const cids = new BoundedCidSet();
      for (const cid of snap.cids ?? []) cids.add(cid);
      const roomId = file.slice(0, -5);
      // R-2: el roomId derivado del filename debe pasar la misma
      // validación que la ruta HTTP — un fichero 'weird‮name.json'
      // de otro proceso entraba al mapa y a los logs sin validar.
      if (!roomIdSchema.test(roomId)) {
        console.error(`snapshot ${file}: roomId inválido — apartado`);
        try {
          renameSync(join(STATE_DIR, file), join(STATE_DIR, `${file}.corrupt-${Date.now()}`));
        } catch { /* el fichero ya se movió o no es accesible */ }
        continue;
      }
      const roomCatalog = snap.customSets?.length
        ? mergeCustomCards(catalog, snap.customSets)
        : catalog;
      restoreSeqFloor(snap.seq, snap.state);
      rooms.set(roomId, {
        state: snap.state,
        rng: DeterministicRng.deserialize(snap.rngState),
        registry,
        processedCids: cids,
        // TTL fresco al restaurar: con savedAt una sala guardada hace
        // >24h moriría en el primer sweep aunque los jugadores reconecten
        // tras el reinicio del runner.
        lastActivity: Date.now(),
        revision: safeNonNegInt(snap.revision),
        lastClientSeq: sanitizeLastClientSeq(snap.lastClientSeq),
        catalog: roomCatalog,
        customSets: snap.customSets,
      });
      loaded++;
    } catch (err) {
      // Apartar el fichero corrupto: sin ello el error se repite en cada
      // arranque y el snapshot queda invisible para inspección manual.
      console.error(`snapshot ${file} corrupto — ignorado:`, err);
      try {
        renameSync(join(STATE_DIR, file), join(STATE_DIR, `${file}.corrupt-${Date.now()}`));
      } catch { /* el fichero ya se movió o no es accesible */ }
    }
  }
  return loaded;
}

// D415: limite de salas en memoria para evitar memory leak / DoS
const MAX_ROOMS = 1000;

// Rate limiting por sala+jugador (ventana deslizante simple)
const rateLimit = new Map<string, { count: number; windowStart: number }>();
// Salas inactivas se eliminan tras 24h — evita leak de partidas abandonadas
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

/** Elimina una sala y todo su estado auxiliar (rate-limit, persistencia). */
function dropRoom(roomId: string): void {
  rooms.delete(roomId);
  metrics.roomsDropped++;
  unpersistRoom(roomId);
  for (const key of rateLimit.keys()) {
    if (key.startsWith(`${roomId}:`)) rateLimit.delete(key);
  }
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      dropRoom(roomId);
      console.log(`room ${roomId} expirada por inactividad`);
    }
  }
}, SWEEP_INTERVAL_MS);
sweeper.unref();

// === App ===

const app = express();
// La restauración de sala sube el snapshot COMPLETO del motor (estado +
// RNG + log de eventos), que supera el límite global de 100kb — esta
// ruta tiene su propio parser, montado antes que el general.
app.use('/rooms/:roomId/restore', express.json({ limit: '10mb' }));
// D414: limitar el tamano del body para evitar DoS por memoria
app.use(express.json({ limit: '100kb' }));

const catalog = loadCatalog();
// D441: un catálogo malformado dejaría cartas fuera en silencio (hordas o
// mercados cortos). En el runner es un error fatal de arranque.
if (catalog.errors.length > 0) {
  for (const e of catalog.errors) {
    console.error(`catalog error ${e.setId}/${e.cardId}: ${e.error}`);
  }
  process.exit(1);
}

type MergedSets =
  | { ok: true; catalog: CatalogLoadResult; customSets: ContentSet[] }
  | { ok: false; body: { error: string; issues?: unknown } };

/** Sets del Taller: validar contra el schema + reglas de contenido y
 * fusionar en un catálogo propio de la sala (el oficial no se toca).
 * Compartido por create y restore. */
function mergeRoomCustomSets(rawSets: unknown[]): MergedSets {
  const customSets: ContentSet[] = [];
  if (rawSets.length === 0) {
    return { ok: true, catalog, customSets };
  }
  for (const raw of rawSets) {
    // Pasar el JSON CRUDO a validateContentSet (hace safeParse propio):
    // si se le pasa el objeto ya parseado, el default
    // officialStatus='OFFICIAL' del schema hace que TODAS las cartas
    // parezcan marcarse como oficiales y el set se rechaza entero.
    const validation = validateContentSet(raw, catalog.byId);
    if (!validation.ok) {
      return { ok: false, body: { error: 'Custom set failed validation', issues: validation.errors } };
    }
    customSets.push(validation.set!);
  }
  const roomCatalog = mergeCustomCards(catalog, customSets);
  if (roomCatalog.errors.length > catalog.errors.length) {
    return { ok: false, body: { error: 'Custom set conflicts with catalog' } };
  }
  return { ok: true, catalog: roomCatalog, customSets };
}

// === Endpoints ===

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'engine-runner' });
});

// Métricas en memoria (contadores del proceso — suficiente para un
// runner mono-instancia; el backend agrega las suyas aparte).
const metrics = {
  commands: 0,
  commandsAccepted: 0,
  commandsRejected: 0,
  dedupHits: 0,
  roomsCreated: 0,
  roomsDropped: 0,
  restores: 0,
  startedAt: Date.now(),
};

// Sin auth igual que /health — el runner es un servicio interno; la
// red/proxy lo aísla de clientes públicos.
app.get('/metrics', (_req, res) => {
  const lines = [
    '# HELP nt4h_runner_rooms Salas vivas en memoria',
    '# TYPE nt4h_runner_rooms gauge',
    `nt4h_runner_rooms ${rooms.size}`,
    '# HELP nt4h_runner_rooms_created_total Salas creadas',
    '# TYPE nt4h_runner_rooms_created_total counter',
    `nt4h_runner_rooms_created_total ${metrics.roomsCreated}`,
    '# HELP nt4h_runner_rooms_dropped_total Salas eliminadas/expiradas',
    '# TYPE nt4h_runner_rooms_dropped_total counter',
    `nt4h_runner_rooms_dropped_total ${metrics.roomsDropped}`,
    '# HELP nt4h_runner_commands_total Comandos recibidos',
    '# TYPE nt4h_runner_commands_total counter',
    `nt4h_runner_commands_total ${metrics.commands}`,
    '# HELP nt4h_runner_commands_accepted_total Comandos aceptados',
    '# TYPE nt4h_runner_commands_accepted_total counter',
    `nt4h_runner_commands_accepted_total ${metrics.commandsAccepted}`,
    '# HELP nt4h_runner_commands_rejected_total Comandos rechazados (4xx/5xx)',
    '# TYPE nt4h_runner_commands_rejected_total counter',
    `nt4h_runner_commands_rejected_total ${metrics.commandsRejected}`,
    '# HELP nt4h_runner_dedup_hits_total Respuestas servidas por dedup de cid',
    '# TYPE nt4h_runner_dedup_hits_total counter',
    `nt4h_runner_dedup_hits_total ${metrics.dedupHits}`,
    '# HELP nt4h_runner_restores_total Restauraciones desde snapshot',
    '# TYPE nt4h_runner_restores_total counter',
    `nt4h_runner_restores_total ${metrics.restores}`,
    '# HELP nt4h_runner_uptime_seconds Uptime del proceso',
    '# TYPE nt4h_runner_uptime_seconds gauge',
    `nt4h_runner_uptime_seconds ${Math.floor((Date.now() - metrics.startedAt) / 1000)}`,
  ];
  res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
});

app.post('/rooms/:roomId/create', requireEngineAuth, (req, res) => {
  const { roomId } = req.params;

  if (!roomIdSchema.test(roomId)) {
    res.status(400).json({ error: 'Invalid roomId' });
    return;
  }
  // Una sala existente no se reinicia en silencio: crear sobre ella
  // reseteaba estado/revisión sin avisar a los jugadores conectados.
  if (rooms.has(roomId)) {
    res.status(409).json({ error: 'Room already exists' });
    return;
  }
  if (rooms.size >= MAX_ROOMS) {
    res.status(503).json({ error: 'Too many rooms' });
    return;
  }

  const parsed = CreateRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid game config' });
    return;
  }
  const config = parsed.data.config as unknown as GameConfig;

  // Sets del Taller: validar contra el schema + reglas de contenido y
  // fusionar en un catálogo propio de la sala (el oficial no se toca).
  const rawSets = (parsed.data.config as { customSets?: unknown[] }).customSets ?? [];
  const merged = mergeRoomCustomSets(rawSets);
  if (!merged.ok) {
    res.status(400).json(merged.body);
    return;
  }
  const roomCatalog = merged.catalog;
  const customSets = merged.customSets;

  try {
    const result = setupGame(config, roomCatalog);
    // setupGame acumula errores en result.errors SIN lanzar — crear la
    // sala igualmente dejaba partidas degradadas: mazos inválidos, pools
    // vacíos o un héroe inexistente → playerOrder con un id sin entrada
    // en players → leader-bid-<pid> irresoluble → partida colgada en
    // INITIAL_PLAYER_SELECTION para siempre. Rechazar el create.
    if (result.errors.length > 0) {
      res.status(400).json({ error: 'Invalid game config', details: result.errors.slice(0, 10) });
      return;
    }
    // D427: si hay pujas de Líder pendientes, la partida espera los
    // CHOOSE_LEADER_CARDS de cada jugador; si no, arranca el turno 1.
    const hasPendingBids = result.state.pendingChoices.some(c => c.choiceId.startsWith('leader-bid-'));
    const turnResult = hasPendingBids
      ? { state: result.state, events: result.events }
      : startFirstTurn(result.state, result.rng, roomCatalog);
    const registry = new EffectRegistry();
    registerCoreEffects(registry);

    metrics.roomsCreated++;
  rooms.set(roomId, {
      state: turnResult.state,
      rng: result.rng,
      registry,
      processedCids: new BoundedCidSet(),
      lastActivity: Date.now(),
      revision: 0,
      lastClientSeq: new Map(),
      catalog: roomCatalog,
      customSets: customSets.length > 0 ? customSets : undefined,
    });
    schedulePersist(roomId);

    res.json({ ok: true, roomId });
  } catch (err) {
    // Los errores de config se devuelven arriba como 400 con details;
    // un throw aquí es un fallo INTERNO (setupGame/startFirstTurn) —
    // reportar 400 haría pasar un bug del motor por culpa del cliente.
    console.error(`create_room ${roomId} failed:`, err);
    res.status(500).json({ error: 'Room creation failed' });
  }
});

app.post('/rooms/:roomId/command', requireEngineAuth, (req, res) => {
  const { roomId } = req.params;

  const room = rooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  metrics.commands++;
  const parsed = CommandBodySchema.safeParse(req.body);
  if (!parsed.success) {
    metrics.commandsRejected++;
    res.status(400).json({ error: 'Missing or invalid command', reason: 'invalid_command', accepted: false });
    return;
  }
  const { cid, playerId, command, expectedRevision, clientSequence } = parsed.data;
  room.lastActivity = Date.now();

  // Idempotencia: CID duplicado → ack cacheado. ANTES del rate-limit y
  // de los checks de revisión/clientSequence: un reintento legítimo del
  // mismo comando no debe consumir cuota ni recibir "stale_revision".
  if (room.processedCids.has(cid)) {
    // stateChanged:true — el comando SÍ se aplicó en su primera
    // presentación; sin el flag el cliente asumía "sin cambios" y no
    // re-pedía la vista proyectada tras un reintento.
    metrics.dedupHits++;
    res.json({ accepted: true, events: [], cached: true, stateChanged: true, revision: room.revision });
    return;
  }

  // El playerId viene autenticado por el backend, pero si no pertenece a
  // esta sala el comando iba a ser rechazado por el motor de todos modos:
  // rechazarlo antes evita poblar rateLimit/lastClientSeq con ids
  // arbitrarios (mapas no acotados por sala).
  if (!Object.hasOwn(room.state.players, playerId)) {
    metrics.commandsRejected++;
    res.status(403).json({ accepted: false, error: 'unknown_player', reason: 'unknown_player' });
    return;
  }

  // Rate limiting por sala+jugador: máx 30 comandos por 10 s (anti-spam)
  const rlKey = `${roomId}:${playerId}`;
  const rl = rateLimit.get(rlKey) ?? { count: 0, windowStart: Date.now() };
  if (Date.now() - rl.windowStart > 10_000) {
    rl.count = 0;
    rl.windowStart = Date.now();
  }
  rl.count++;
  rateLimit.set(rlKey, rl);
  if (rl.count > 30) {
    metrics.commandsRejected++;
    res.status(429).json({ error: 'Rate limit exceeded', reason: 'rate_limited', accepted: false });
    return;
  }

  // Comando sobre revisión antigua → el cliente debe re-sincronizar
  if (expectedRevision !== undefined && expectedRevision !== room.revision) {
    metrics.commandsRejected++;
    res.status(409).json({
      accepted: false,
      error: 'stale_revision',
      reason: 'stale_revision',
      revision: room.revision,
    });
    return;
  }

  // Anti-reordenado: una clientSequence inferior a la última procesada es
  // un comando duplicado fuera de la ventana de cids (D434 no lo coge)
  const lastSeq = room.lastClientSeq.get(playerId);
  if (clientSequence !== undefined && lastSeq !== undefined && clientSequence <= lastSeq) {
    res.json({ accepted: false, reason: 'out_of_order_command', revision: room.revision });
    return;
  }

  // El cid del envelope es el que se deduplica y persiste: si difiere del
  // del propio comando, el dedup del runner y el del backend quedarían
  // auditando identidades distintas.
  if (command.cid !== cid) {
    metrics.commandsRejected++;
    res.status(400).json({ error: 'cid mismatch between envelope and command', reason: 'cid_mismatch', accepted: false });
    return;
  }

  const rngBackup = room.rng.serialize();
  try {
    // Ejecutar comando — D423: pasar playerId autenticado por el backend.
    // actorId queda sellado con el jugador autenticado: el valor enviado
    // por el cliente (si venía) no puede suplantar a otro jugador.
    const authenticatedCommand = { ...command, actorId: playerId } as Command;
    const result = execute(room.state, authenticatedCommand, room.rng, room.registry, room.catalog, playerId);

    if (!result.accepted) {
      // Un rechazo puede haber consumido RNG (elecciones/efectos que
      // barajan antes de fallar): restaurar el backup para que el RNG
      // vivo siga coincidiendo con un replay de comandos aceptados.
      room.rng = DeterministicRng.deserialize(rngBackup);
      metrics.commandsRejected++;
      res.json({ accepted: false, reason: result.reason });
      return;
    }

    // Procesar fases ANTES de confirmar: si lanza, el comando queda sin
    // aplicar — ni estado, ni cid, ni revisión — y el 500 es coherente
    // con lo persistido (antes el commit parcial divergía del veredicto).
    let phaseResult;
    try {
      phaseResult = processPhases(result.newState, room.rng, room.catalog);
    } catch (phaseErr) {
      room.rng = DeterministicRng.deserialize(rngBackup);
      throw phaseErr;
    }

    // halted=true: processPhases agotó su presupuesto de iteraciones —
    // el estado está "a medias" (una fase automática quedó sin cerrar).
    // Commitearlo lo dejaría indistinguible de uno terminado: rechazar
    // y restaurar el RNG para no divergir del replay.
    if (phaseResult.halted) {
      room.rng = DeterministicRng.deserialize(rngBackup);
      metrics.commandsRejected++;
      console.error(`command ${cid} en ${roomId}: phase processing halted`);
      res.status(500).json({ accepted: false, error: 'Phase processing did not converge', reason: 'phase_halted' });
      return;
    }

    // Commit: estado + dedup + secuencia + revisión, todo junto.
    room.state = phaseResult.state;
    room.processedCids.add(cid);
    if (clientSequence !== undefined) room.lastClientSeq.set(playerId, clientSequence);
    room.revision++;
    metrics.commandsAccepted++;
    schedulePersist(roomId);
    // GAME_ENDED: flush inmediato — la ventana de debounce tras el
    // último comando perdía la resolución final ante un crash y el
    // restore recuperaba la partida a mitad.
    if ([...result.events, ...phaseResult.events].some(e => e.type === 'GAME_ENDED')) {
      flushPersists();
    }

    // D435: NO devolver el estado completo — la respuesta va al backend,
    // que difunde eventos y cada cliente pide su vista proyectada.
    res.json({
      accepted: true,
      events: [...result.events, ...phaseResult.events],
      stateChanged: true,
      revision: room.revision,
    });
  } catch (err) {
    // Restaurar el RNG también si el fallo fue en execute() (no solo en
    // processPhases): un throw a mitad de resolución podía dejar el RNG
    // avanzado y divergir del replay del eventLog.
    room.rng = DeterministicRng.deserialize(rngBackup);
    metrics.commandsRejected++;
    console.error(`command ${cid} en ${roomId} failed:`, err);
    res.status(500).json({ error: 'Command execution failed' });
  }
});

app.get('/rooms/:roomId/state', requireEngineAuth, (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  // D424/D435: RF-J095 — siempre devolver estado sanitizado. Sin playerId se
  // devuelve la vista de espectador (sin informacion privada), nunca el
  // estado completo (evita fuga de manos/mazos/RNG).
  const playerId = typeof req.query.playerId === 'string' ? req.query.playerId : SPECTATOR_ID;
  // El polling de estado también es actividad: una sala en una fase larga
  // (puja de líder, espera de rival) no debe expirar mientras los
  // clientes siguen consultándola.
  room.lastActivity = Date.now();
  res.json({ state: sanitizeForPlayer(room.state, playerId), revision: room.revision });
});

// Estado COMPLETO de la sala (estado + RNG + dedup). Uso interno del
// backend para snapshots/replay — contiene manos privadas y entropía:
// nunca exponer a clientes (requiere X-Engine-Token como todo lo demás,
// pero además los clientes nunca llaman a esta ruta).
app.get('/rooms/:roomId/full-state', requireEngineAuth, (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json({
    state: room.state,
    rngState: room.rng.serialize(),
    revision: room.revision,
    lastClientSeq: Object.fromEntries(room.lastClientSeq),
    // cids procesados: sin ellos un restore pierde la dedup del runner
    // y un comando reenviado tras la restauración se ejecutaría dos veces.
    cids: room.processedCids.toArray(),
    // seq global: el eventLog puede estar vacío en estados tempranos —
    // sin el contador, un restore reemitiría seqs ya usados.
    seq: currentSeq(),
    // customSets: el snapshot GameSnapshot del backend queda
    // autocontenido — sin ellos el restore dependía de que
    // session.config siguiera intacta en Django.
    customSets: room.customSets,
  });
});

// Restauración a demanda: el backend guarda GameSnapshot periódicos con
// el estado COMPLETO. Si el runner se reinició sin STATE_DIR, Django
// resucita la sala llamando aquí con el último snapshot + customSets.
app.post('/rooms/:roomId/restore', requireEngineAuth, (req, res) => {
  const { roomId } = req.params;
  if (!roomIdSchema.test(roomId)) {
    res.status(400).json({ error: 'Invalid roomId' });
    return;
  }
  if (rooms.has(roomId)) {
    res.status(409).json({ error: 'Room already exists' });
    return;
  }
  if (rooms.size >= MAX_ROOMS) {
    res.status(503).json({ error: 'Too many rooms' });
    return;
  }
  const snap = (req.body as { snapshot?: unknown } | null)?.snapshot as Partial<RoomSnapshot> | undefined;
  const rngState = snap?.rngState;
  if (
    !snap
    || !rngState
    || !isPlausibleState(snap.state)
    || typeof rngState.seed !== 'string'
    || typeof rngState.state !== 'number'
  ) {
    res.status(400).json({ error: 'Invalid snapshot' });
    return;
  }
  const merged = mergeRoomCustomSets(Array.isArray(snap.customSets) ? snap.customSets : []);
  if (!merged.ok) {
    res.status(400).json(merged.body);
    return;
  }
  const registry = new EffectRegistry();
  registerCoreEffects(registry);
  const cids = new BoundedCidSet();
  for (const cid of snap.cids ?? []) cids.add(cid);
  const revision = safeNonNegInt(snap.revision);
  restoreSeqFloor(snap.seq, snap.state);
  rooms.set(roomId, {
    state: snap.state,
    rng: DeterministicRng.deserialize(rngState),
    registry,
    processedCids: cids,
    lastActivity: Date.now(),
    revision,
    lastClientSeq: sanitizeLastClientSeq(snap.lastClientSeq),
    catalog: merged.catalog,
    customSets: merged.customSets.length > 0 ? merged.customSets : undefined,
  });
  schedulePersist(roomId);
  metrics.restores++;
  console.log(`room ${roomId} restaurada desde snapshot del backend (rev ${revision})`);
  res.json({ ok: true, roomId, revision });
});

// D416: eliminar sala (cleanup)
app.delete('/rooms/:roomId', requireEngineAuth, (req, res) => {
  const { roomId } = req.params;
  if (!rooms.has(roomId)) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  dropRoom(roomId);
  res.json({ ok: true });
});

// ============================================================================
// D436: graceful shutdown
// ============================================================================

const PORT = Number(process.env.ENGINE_RUNNER_PORT ?? 3001);
const restored = loadPersistedRooms();
if (restored > 0) console.log(`${restored} sala(s) restauradas desde disco`);
// Sin middleware de error, un JSON malformado devolvía la página HTML por
// defecto de Express (con stack fuera de producción): responder JSON 400.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const type = err && typeof err === 'object' ? (err as { type?: string }).type : undefined;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  // Un body >límite devolvía 500 — el backend lo clasificaba como fallo
  // del runner en vez de "payload demasiado grande" (413 correcto).
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Payload too large' });
    return;
  }
  console.error('unhandled error:', err);
  res.status(500).json({ error: 'Internal error' });
});

const exportedApp: express.Express = app;
export { exportedApp as app };

// Solo escuchar cuando se ejecuta como proceso principal — los tests
// importan `app` y la montan en un puerto efímero.
const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const server = app.listen(PORT, () => {
    console.log(`engine-runner listening on port ${PORT}`);
  });

  function shutdown(signal: string): void {
    console.log(`engine-runner received ${signal}, shutting down`);
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    // Dejar de aceptar conexiones PRIMERO: los comandos aceptados durante
    // el drain marcarían dirty después del volcado y se perderían.
    // server.close espera a que las peticiones en vuelo terminen.
    server.close(() => {
      flushPersists();
      process.exit(0);
    });
    // Si hay conexiones persistentes que no cierran, volcar y forzar salida
    setTimeout(() => {
      flushPersists();
      process.exit(0);
    }, 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
