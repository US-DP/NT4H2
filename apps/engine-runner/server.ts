/**
 * engine-runner — servicio Node que ejecuta el motor TS.
 *
 * Django Channels delega la ejecucion de comandos a este servicio via HTTP.
 * El motor TS es la unica fuente de verdad para las reglas del juego.
 */

import express from 'express';
import { z } from 'zod';
import { EffectRegistry, registerCoreEffects, setupGame, startFirstTurn, execute, processPhases, projectEventsForPlayer, DeterministicRng } from '@nt4h/engine';
import { loadCatalog } from '@nt4h/catalog';
import type { GameConfig, Command, GameState } from '@nt4h/schema';

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

const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PLAY_CARD'), cid: cidSchema, cardInstanceId: idSchema, targetEnemyId: idSchema.optional() }),
  z.object({ type: z.literal('END_ATTACK'), cid: cidSchema }),
  z.object({ type: z.literal('EVASION'), cid: cidSchema, discardedCardInstanceIds: z.array(idSchema).max(60) }),
  z.object({ type: z.literal('BUY_CARD'), cid: cidSchema, marketCardInstanceId: idSchema }),
  z.object({ type: z.literal('END_TURN'), cid: cidSchema }),
  z.object({ type: z.literal('USE_HERO_ABILITY'), cid: cidSchema, targetId: idSchema.optional() }),
  z.object({ type: z.literal('CHOOSE_LEADER_CARDS'), cid: cidSchema, cardInstanceIds: z.array(idSchema).min(1).max(2) }),
  z.object({ type: z.literal('RESOLVE_CHOICE'), cid: cidSchema, choiceId: z.string().min(1).max(200), selectedIds: z.array(idSchema).max(60) }),
  z.object({ type: z.literal('PASS'), cid: cidSchema }),
  z.object({ type: z.literal('SWAP_STARTING_CARDS'), cid: cidSchema, cardInstanceIds: z.array(idSchema).max(10) }),
  z.object({ type: z.literal('ACCEPT_TURN_START_EFFECT'), cid: cidSchema, accepted: z.boolean() }),
  z.object({ type: z.literal('OPEN_SUPPORT_DECK'), cid: cidSchema, supportDeckIndex: z.number().int().min(0).max(10) }),
  z.object({ type: z.literal('BUY_SUPPORT_CARD'), cid: cidSchema, supportDeckIndex: z.number().int().min(0).max(10), payment: PaymentSchema }),
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
    })).min(1).max(4),
    useScenarios: z.boolean(),
    scenarioIds: z.array(z.string().max(128)).optional(),
    soloMarketCardIds: z.array(z.string().max(128)).optional(),
    soloSupportHeroIds: z.array(z.string().max(128)).optional(),
  }),
});

const CommandBodySchema = z.object({
  cid: cidSchema,
  playerId: idSchema,
  command: CommandSchema,
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
  if (typeof token !== 'string' || token !== ENGINE_TOKEN) {
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
}

const rooms = new Map<string, {
  state: GameState;
  rng: DeterministicRng;
  registry: EffectRegistry;
  processedCids: BoundedCidSet;
  lastActivity: number;
}>();

// D415: limite de salas en memoria para evitar memory leak / DoS
const MAX_ROOMS = 1000;
// Salas inactivas se eliminan tras 24h — evita leak de partidas abandonadas
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      rooms.delete(roomId);
      console.log(`room ${roomId} expirada por inactividad`);
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
  if (rooms.size >= MAX_ROOMS && !rooms.has(roomId)) {
    res.status(503).json({ error: 'Too many rooms' });
    return;
  }

  const parsed = CreateRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid game config' });
    return;
  }
  const config = parsed.data.config as unknown as GameConfig;

  try {
    const result = setupGame(config, catalog);
    // D427: si hay pujas de Líder pendientes, la partida espera los
    // CHOOSE_LEADER_CARDS de cada jugador; si no, arranca el turno 1.
    const hasPendingBids = result.state.pendingChoices.some(c => c.choiceId.startsWith('leader-bid-'));
    const turnResult = hasPendingBids
      ? { state: result.state, events: result.events }
      : startFirstTurn(result.state, result.rng, catalog);
    const registry = new EffectRegistry();
    registerCoreEffects(registry);

    rooms.set(roomId, {
      state: turnResult.state,
      rng: result.rng,
      registry,
      processedCids: new BoundedCidSet(),
      lastActivity: Date.now(),
    });

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
  const { cid, playerId, command } = parsed.data;
  room.lastActivity = Date.now();

  // Idempotencia: CID duplicado → ack cacheado
  if (room.processedCids.has(cid)) {
    res.json({ accepted: true, events: [], cached: true });
    return;
  }

  try {
    // Ejecutar comando — D423: pasar playerId autenticado por el backend
    const result = execute(room.state, command as Command, room.rng, room.registry, catalog, playerId);

    if (!result.accepted) {
      res.json({ accepted: false, reason: result.reason });
      return;
    }

    // Actualizar estado
    room.state = result.newState;
    room.processedCids.add(cid);

    // Procesar fases automaticas
    const phaseResult = processPhases(room.state, room.rng, catalog);
    room.state = phaseResult.state;

    // D435: NO devolver el estado completo — la respuesta va al backend,
    // que difunde eventos y cada cliente pide su vista proyectada.
    res.json({
      accepted: true,
      events: [...result.events, ...phaseResult.events],
      stateChanged: true,
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
  res.json({ state: sanitizeForPlayer(room.state, playerId) });
});

// D416: eliminar sala (cleanup)
app.delete('/rooms/:roomId', requireEngineAuth, (req, res) => {
  const { roomId } = req.params;
  if (!rooms.delete(roomId)) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json({ ok: true });
});

// ============================================================================
// D436: graceful shutdown
// ============================================================================

const PORT = Number(process.env.ENGINE_RUNNER_PORT ?? 3001);
const server = app.listen(PORT, () => {
  console.log(`engine-runner listening on port ${PORT}`);
});

function shutdown(signal: string): void {
  console.log(`engine-runner received ${signal}, shutting down`);
  server.close(() => {
    process.exit(0);
  });
  // Si hay conexiones persistentes que no cierran, forzar salida
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
