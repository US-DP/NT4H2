/**
 * engine-runner — servicio Node que ejecuta el motor TS.
 *
 * Django Channels delega la ejecucion de comandos a este servicio via HTTP.
 * El motor TS es la unica fuente de verdad para las reglas del juego.
 */

import express from 'express';
import { z } from 'zod';
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { timingSafeEqual } from 'crypto';
import { EffectRegistry, registerCoreEffects, setupGame, startFirstTurn, execute, processPhases, projectEventsForPlayer, DeterministicRng } from '@nt4h/engine';
import { loadCatalog, mergeCustomCards, validateContentSet, type CatalogLoadResult } from '@nt4h/catalog';
import { ContentSetSchema } from '@nt4h/schema';
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
function sanitizeForPlayer(state: GameState, viewerId: string): GameState {
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

// ============================================================================
// D432: Validacion Zod de comandos y payloads de entrada
// ============================================================================

const cidSchema = z.string().min(1).max(128);
// D440: ids no pueden ser claves peligrosas de objetos JS (proto-pollution)
const UNSAFE_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const idSchema = z.string().min(1).max(128).refine(
  (v) => !UNSAFE_IDS.has(v),
  { message: 'Unsafe identifier' },
);

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
    seed: z.string().max(256),
    heroes: z.array(z.object({
      playerId: idSchema,
      heroId: idSchema,
      heroFace: z.enum(['FEMALE', 'MALE']),
      deckId: z.string().max(128),
      secondDeckId: z.string().max(128).optional(),
      playerAge: z.number().int().min(0).optional(),
      customDeckId: z.string().max(128).optional(),
    })).min(1).max(4),
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
  customSets?: ContentSet[];
  savedAt: number;
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
    && typeof s.rngState?.seed === 'string'
    && typeof s.rngState?.state === 'number',
  );
}

function loadPersistedRooms(): number {
  if (!STATE_DIR || !existsSync(STATE_DIR)) return 0;
  let loaded = 0;
  for (const file of readdirSync(STATE_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const snap = JSON.parse(readFileSync(join(STATE_DIR, file), 'utf-8')) as RoomSnapshot;
      if (!isPlausibleState(snap?.state) || typeof snap.rngState?.state !== 'number') {
        console.error(`snapshot ${file} con forma inválida — ignorado`);
        continue;
      }
      const registry = new EffectRegistry();
      registerCoreEffects(registry);
      const cids = new BoundedCidSet();
      for (const cid of snap.cids ?? []) cids.add(cid);
      const roomId = file.slice(0, -5);
      const roomCatalog = snap.customSets?.length
        ? mergeCustomCards(catalog, snap.customSets)
        : catalog;
      rooms.set(roomId, {
        state: snap.state,
        rng: DeterministicRng.deserialize(snap.rngState),
        registry,
        processedCids: cids,
        // TTL fresco al restaurar: con savedAt una sala guardada hace
        // >24h moriría en el primer sweep aunque los jugadores reconecten
        // tras el reinicio del runner.
        lastActivity: Date.now(),
        revision: snap.revision ?? 0,
        lastClientSeq: new Map(Object.entries(snap.lastClientSeq ?? {})),
        catalog: roomCatalog,
        customSets: snap.customSets,
      });
      loaded++;
    } catch (err) {
      console.error(`snapshot ${file} corrupto — ignorado:`, err);
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

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      rooms.delete(roomId);
      unpersistRoom(roomId);
      console.log(`room ${roomId} expirada por inactividad`);
      // Limpiar también los contadores de rate limiting de esa sala
      for (const key of rateLimit.keys()) {
        if (key.startsWith(`${roomId}:`)) rateLimit.delete(key);
      }
    }
  }
}, SWEEP_INTERVAL_MS);
sweeper.unref();

// === App ===

const app = express();
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

// === Endpoints ===

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'engine-runner' });
});

app.post('/rooms/:roomId/create', requireEngineAuth, (req, res) => {
  const { roomId } = req.params;

  if (typeof roomId !== 'string' || roomId.length === 0 || roomId.length > 128) {
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
  const customSets: ContentSet[] = [];
  let roomCatalog: CatalogLoadResult = catalog;
  if (rawSets.length > 0) {
    for (const raw of rawSets) {
      const setParsed = ContentSetSchema.safeParse(raw);
      if (!setParsed.success) {
        res.status(400).json({ error: 'Invalid custom set' });
        return;
      }
      const validation = validateContentSet(setParsed.data, catalog.byId);
      if (!validation.ok) {
        res.status(400).json({ error: 'Custom set failed validation', issues: validation.errors });
        return;
      }
      customSets.push(setParsed.data);
    }
    roomCatalog = mergeCustomCards(catalog, customSets);
    if (roomCatalog.errors.length > catalog.errors.length) {
      res.status(400).json({ error: 'Custom set conflicts with catalog' });
      return;
    }
  }

  try {
    const result = setupGame(config, roomCatalog);
    // D427: si hay pujas de Líder pendientes, la partida espera los
    // CHOOSE_LEADER_CARDS de cada jugador; si no, arranca el turno 1.
    const hasPendingBids = result.state.pendingChoices.some(c => c.choiceId.startsWith('leader-bid-'));
    const turnResult = hasPendingBids
      ? { state: result.state, events: result.events }
      : startFirstTurn(result.state, result.rng, roomCatalog);
    const registry = new EffectRegistry();
    registerCoreEffects(registry);

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
    console.error(`create_room ${roomId} failed:`, err);
    res.status(400).json({ error: 'Invalid game config' });
  }
});

app.post('/rooms/:roomId/command', requireEngineAuth, (req, res) => {
  const { roomId } = req.params;

  const room = rooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  const parsed = CommandBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid command' });
    return;
  }
  const { cid, playerId, command, expectedRevision, clientSequence } = parsed.data;
  room.lastActivity = Date.now();

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
    res.status(429).json({ error: 'Rate limit exceeded', accepted: false });
    return;
  }

  // Comando sobre revisión antigua → el cliente debe re-sincronizar
  if (expectedRevision !== undefined && expectedRevision !== room.revision) {
    res.status(409).json({
      accepted: false,
      error: 'stale_revision',
      revision: room.revision,
    });
    return;
  }

  // Idempotencia: CID duplicado → ack cacheado. ANTES del check de
  // clientSequence: un reintento del mismo comando (mismo cid y seq ya
  // procesada) debe recibir el ack cacheado, no "out_of_order" por un
  // comando que ya se aplicó.
  if (room.processedCids.has(cid)) {
    res.json({ accepted: true, events: [], cached: true, revision: room.revision });
    return;
  }

  // Anti-reordenado: una clientSequence inferior a la última procesada es
  // un comando duplicado fuera de la ventana de cids (D434 no lo coge)
  const lastSeq = room.lastClientSeq.get(playerId);
  if (clientSequence !== undefined && lastSeq !== undefined && clientSequence <= lastSeq) {
    res.json({ accepted: false, reason: 'out_of_order_command', revision: room.revision });
    return;
  }

  try {
    // Ejecutar comando — D423: pasar playerId autenticado por el backend.
    // actorId queda sellado con el jugador autenticado: el valor enviado
    // por el cliente (si venía) no puede suplantar a otro jugador.
    const authenticatedCommand = { ...command, actorId: playerId } as Command;
    const result = execute(room.state, authenticatedCommand, room.rng, room.registry, room.catalog, playerId);

    if (!result.accepted) {
      res.json({ accepted: false, reason: result.reason });
      return;
    }

    // Actualizar estado
    room.state = result.newState;
    room.processedCids.add(cid);
    if (clientSequence !== undefined) room.lastClientSeq.set(playerId, clientSequence);
    room.revision++;

    // Procesar fases automaticas
    const phaseResult = processPhases(room.state, room.rng, room.catalog);
    room.state = phaseResult.state;
    schedulePersist(roomId);

    // D435: NO devolver el estado completo — la respuesta va al backend,
    // que difunde eventos y cada cliente pide su vista proyectada.
    res.json({
      accepted: true,
      events: [...result.events, ...phaseResult.events],
      stateChanged: true,
      revision: room.revision,
    });
  } catch (err) {
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
  });
});

// D416: eliminar sala (cleanup)
app.delete('/rooms/:roomId', requireEngineAuth, (req, res) => {
  const { roomId } = req.params;
  if (!rooms.delete(roomId)) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  unpersistRoom(roomId);
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
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' });
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
