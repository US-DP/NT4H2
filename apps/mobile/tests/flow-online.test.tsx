/**
 * Nivel 15b: Pruebas del flujo online (store real).
 *
 * Ejercita el store de verdad (Zustand) mockeando solo WebSocket y fetch:
 * - connectOnline pide ticket efímero, abre el socket autenticado y devuelve cleanup real
 * - sendOnlineCommand firma con cid único por el socket
 * - command_result.stateChanged dispara fetch proyectado con token por header
 * - comandos rechazados y frames malformados actualizan la UI correctamente
 * - disconnectOnline detiene heartbeat/reconnect y resetea el modo
 * - saveGame se niega en online (estado sanitizado → corrupción)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';

// Mock WebSocket — implementa la interfaz que usa connectOnline
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: any[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
  addEventListener() {}
  removeEventListener() {}
  open() {
    this.onopen?.();
  }
  emitMessage(msg: any) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  emitRaw(data: string) {
    this.onmessage?.({ data });
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

// Enrutador de fetch: ws-ticket devuelve ticket efímero, el resto estado nulo
function routeFetch(url: string | URL | Request) {
  const u = typeof url === 'string' ? url : String(url);
  if (u.includes('/ws-ticket/')) return Promise.resolve(jsonResponse({ ticket: 'tk-1' }));
  return Promise.resolve(jsonResponse({ state: null }));
}

// El socket se crea tras un await (fetch del ticket) — hay que esperar
async function waitForSocket(index = 0, timeout = 4000): Promise<MockWebSocket> {
  await vi.waitFor(() => {
    expect(MockWebSocket.instances.length).toBeGreaterThan(index);
  }, { timeout });
  return MockWebSocket.instances[index];
}

const initialStore = useGameStore.getState();

describe('Flujo online — gameStore real', () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation(routeFetch);
    useGameStore.setState(initialStore, true);
  });

  it('connectOnline pide ticket efímero, abre WebSocket y guarda referencia', async () => {
    const cleanup = useGameStore.getState().connectOnline('ROOM1', 'p1', 'tok-1');
    const s = useGameStore.getState();
    expect(s.connectionMode).toBe('online');
    expect(s.online.roomId).toBe('ROOM1');
    expect(s.online.playerId).toBe('p1');
    expect(s.online.playerToken).toBe('tok-1');
    // Primera llamada: el ticket (POST con playerId+playerToken en el body)
    const ws = await waitForSocket();
    const ticketCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/ws-ticket/'));
    expect(ticketCall).toBeDefined();
    expect(String(ticketCall![0])).toContain('/api/rooms/ROOM1/ws-ticket/');
    // El socket usa el ticket — el token largo NO viaja en la URL
    expect(ws.url).toContain('/ws/game/ROOM1/');
    expect(ws.url).toContain('ticket=tk-1');
    expect(ws.url).not.toContain('tok-1');
    cleanup();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('sendOnlineCommand envía comando con cid único', async () => {
    useGameStore.getState().connectOnline('ROOM2', 'p2', 'tok');
    const ws = await waitForSocket();
    useGameStore.getState().sendOnlineCommand({ type: 'END_TURN' });
    // El dedup de doble-submit veta un comando idéntico en vuelo —
    // simular el ack del servidor antes del segundo envío.
    ws.onmessage?.({ data: JSON.stringify({ type: 'game.command_result', cid: ws.sent[0].cid, accepted: true }) });
    useGameStore.getState().sendOnlineCommand({ type: 'END_TURN' });
    expect(ws.sent).toHaveLength(2);
    expect(ws.sent[0].type).toBe('game.command');
    expect(ws.sent[0].command.type).toBe('END_TURN');
    // cids únicos — Date.now() solo no bastaba (D434)
    expect(ws.sent[0].cid).not.toBe(ws.sent[1].cid);
    useGameStore.getState().disconnectOnline();
  });

  it('sendOnlineCommand no envía nada si el socket no está OPEN', async () => {
    useGameStore.getState().connectOnline('ROOM3', 'p3', 'tok');
    const ws = await waitForSocket();
    ws.readyState = MockWebSocket.CLOSED;
    useGameStore.getState().sendOnlineCommand({ type: 'END_TURN' });
    // El comando se encola (reconexión en marcha) — el socket no recibe nada
    expect(ws.sent).toHaveLength(0);
    useGameStore.getState().disconnectOnline();
  });

  it('command_result stateChanged pide el estado proyectado con token por header', async () => {
    fetchMock.mockImplementation((url: any) => {
      if (String(url).includes('/ws-ticket/')) return Promise.resolve(jsonResponse({ ticket: 'tk-1' }));
      return Promise.resolve(jsonResponse({
        state: { phase: 'PLAYER_ATTACK', players: {}, playerOrder: [] },
      }));
    });
    useGameStore.getState().connectOnline('ROOM4', 'p4', 'tok-4');
    const ws = await waitForSocket();
    ws.emitMessage({ type: 'game.command_result', cid: 'c1', stateChanged: true });
    // fetchProjectedState es async — esperar a que se invoque
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/engine/'))).toBe(true);
    });
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/engine/'))!;
    expect(String(url)).toContain('/api/rooms/ROOM4/engine/');
    expect(String(url)).toContain('playerId=p4');
    expect(String(url)).not.toContain('playerToken');
    expect((init as RequestInit).headers).toMatchObject({ 'X-Player-Token': 'tok-4' });
    await vi.waitFor(() => {
      expect(useGameStore.getState().gameState?.phase).toBe('PLAYER_ATTACK');
    });
    useGameStore.getState().disconnectOnline();
  });

  it('command_result rechazado muestra el motivo en la UI', async () => {
    useGameStore.getState().connectOnline('ROOM5', 'p5', 'tok');
    const ws = await waitForSocket();
    ws.emitMessage({ type: 'game.command_result', cid: 'c1', stateChanged: false, reason: 'Not your turn' });
    expect(useGameStore.getState().ui.message).toContain('Not your turn');
    useGameStore.getState().disconnectOnline();
  });

  it('frames malformados se ignoran sin romper el store', async () => {
    useGameStore.getState().connectOnline('ROOM6', 'p6', 'tok');
    const ws = await waitForSocket();
    ws.emitRaw('{not json');
    ws.emitRaw('"just a string"');
    ws.emitRaw('12345');
    // No lanza, no cambia estado
    expect(useGameStore.getState().connectionMode).toBe('online');
    useGameStore.getState().disconnectOnline();
  });

  it('disconnectOnline cierra el socket y resetea el modo', async () => {
    useGameStore.getState().connectOnline('ROOM7', 'p7', 'tok');
    const ws = await waitForSocket();
    useGameStore.getState().disconnectOnline();
    const s = useGameStore.getState();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(s.connectionMode).toBe('local');
    expect(s.online.roomId).toBeNull();
    expect(s.online.socket).toBeNull();
  });

  it('saveGame se niega en modo online (estado sanitizado)', () => {
    useGameStore.setState({
      connectionMode: 'online',
      online: { roomId: 'R', playerId: 'p1', playerToken: 't', socket: null, lastRevision: null, lastMessageAt: null, hostId: null, turnStartedAt: null, lastCid: null },
      gameState: {} as any,
      rng: {} as any,
      initialConfig: {} as any,
    });
    useGameStore.getState().saveGame('test');
    expect(useGameStore.getState().ui.message).toContain('online');
  });

  it('mensajes del servidor llegan al callback onMessage', async () => {
    const received: any[] = [];
    const cleanup = useGameStore.getState().connectOnline('ROOM8', 'p8', 'tok', (msg) => received.push(msg));
    const ws = await waitForSocket();
    ws.emitMessage({ type: 'chat.message', sender: 'p9', text: 'hola' });
    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('hola');
    cleanup();
  });

  it('los comandos encolados se envían al reconectar (D439: cola drenada tras re-sync)', async () => {
    fetchMock.mockImplementation((url: any) => {
      if (String(url).includes('/ws-ticket/')) return Promise.resolve(jsonResponse({ ticket: 'tk-2' }));
      return Promise.resolve(jsonResponse({ state: null }));
    });
    useGameStore.getState().connectOnline('ROOM9', 'p9', 'tok-9');
    const ws1 = await waitForSocket(0);
    ws1.open();
    await vi.waitFor(() => expect(useGameStore.getState().online.socket).toBe(ws1));

    // Conexión perdida con un comando en mano → se encola, no se envía
    ws1.readyState = MockWebSocket.CLOSED;
    useGameStore.getState().sendOnlineCommand({ type: 'END_TURN' });
    expect(ws1.sent).toHaveLength(0);

    // onclose dispara scheduleReconnect (NetInfo conectado → backoff ~1s real)
    ws1.onclose?.();
    const ws2 = await waitForSocket(1);
    expect(ws2).not.toBe(ws1);
    ws2.open();

    // Tras re-sincronizar, la cola se vacía sobre el socket NUEVO
    await vi.waitFor(() => {
      expect(ws2.sent.length).toBeGreaterThan(0);
    });
    const gameCmd = ws2.sent.find(m => m.type === 'game.command');
    expect(gameCmd?.command?.type).toBe('END_TURN');
    useGameStore.getState().disconnectOnline();
  });

  it('clientSequence crece entre rejoins (semilla wall-clock, no vuelve a 1)', async () => {
    // Regresión: _clientSeq=0 en cada connectOnline hacía que tras un
    // re-join completo (reinicio de app) el runner rechazara todo con
    // out_of_order_command — conserva lastClientSeq del jugador.
    useGameStore.getState().connectOnline('SEQ1', 'ps', 'tok');
    const ws1 = await waitForSocket(0);
    useGameStore.getState().sendOnlineCommand({ type: 'END_TURN' });
    const seq1 = ws1.sent.find(m => m.type === 'game.command')?.clientSequence;
    expect(typeof seq1).toBe('number');
    // Semilla epoch-ms: claramente > el contador por sesión (1,2,3…)
    expect(seq1).toBeGreaterThan(1e12);

    // Rejoin completo a la MISMA sala (connectOnline de nuevo)
    useGameStore.getState().connectOnline('SEQ1', 'ps', 'tok');
    const ws2 = await waitForSocket(1);
    useGameStore.getState().sendOnlineCommand({ type: 'END_TURN' });
    const seq2 = ws2.sent.find(m => m.type === 'game.command')?.clientSequence;
    // Estrictamente mayor que el último de la sesión anterior —
    // el runner los acepta en vez de rechazarlos como out_of_order.
    expect(seq2).toBeGreaterThan(seq1);
    useGameStore.getState().disconnectOnline();
  });
});

describe('Robustez del estado proyectado online', () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation(routeFetch);
    useGameStore.setState(initialStore, true);
  });

  const plausibleState = {
    phase: 'PLAYER_ATTACK',
    players: { p1: { playerId: 'p1', hand: [] } },
    playerOrder: ['p1'],
  };

  it('connectOnline conserva hostId fijado por setConnectionMode para la misma sala', async () => {
    useGameStore.getState().setConnectionMode('online', 'RH1', 'ph1', 'tok', 'host-9');
    useGameStore.getState().connectOnline('RH1', 'ph1', 'tok');
    expect(useGameStore.getState().online.hostId).toBe('host-9');
    useGameStore.getState().disconnectOnline();
  });

  it('connectOnline a OTRA sala no hereda el hostId de la anterior', async () => {
    useGameStore.getState().setConnectionMode('online', 'RH2a', 'ph', 'tok', 'host-old');
    useGameStore.getState().connectOnline('RH2a', 'ph', 'tok');
    expect(useGameStore.getState().online.hostId).toBe('host-old');
    // Reconectar a otra sala sin setConnectionMode previo → sin hostId
    useGameStore.getState().connectOnline('RH2b', 'ph', 'tok');
    expect(useGameStore.getState().online.roomId).toBe('RH2b');
    expect(useGameStore.getState().online.hostId).toBeNull();
    useGameStore.getState().disconnectOnline();
  });

  it('una respuesta REST tardía tras disconnect no pisa el estado local', async () => {
    let resolveFetch: ((r: Response) => void) | null = null;
    fetchMock.mockImplementation((url: any) => {
      if (String(url).includes('/ws-ticket/')) return Promise.resolve(jsonResponse({ ticket: 'tk' }));
      return new Promise<Response>((resolve) => { resolveFetch = resolve; });
    });
    useGameStore.getState().connectOnline('RS1', 'ps1', 'tok');
    const ws = await waitForSocket();
    ws.emitMessage({ type: 'game.command_result', cid: 'c1', stateChanged: true });
    await vi.waitFor(() => expect(resolveFetch).not.toBeNull());

    // El usuario abandona antes de que llegue la respuesta
    useGameStore.getState().disconnectOnline();
    resolveFetch!(jsonResponse({ state: plausibleState, revision: 5 }));
    await Promise.resolve();

    const s = useGameStore.getState();
    expect(s.connectionMode).toBe('local');
    expect(s.gameState).toBeNull();
  });

  it('un payload de estado malformado no rompe el store', async () => {
    fetchMock.mockImplementation((url: any) => {
      if (String(url).includes('/ws-ticket/')) return Promise.resolve(jsonResponse({ ticket: 'tk' }));
      return Promise.resolve(jsonResponse({ state: { garbage: true }, revision: 1 }));
    });
    useGameStore.getState().connectOnline('RM1', 'pm1', 'tok');
    const ws = await waitForSocket();
    ws.emitMessage({ type: 'game.command_result', cid: 'c1', stateChanged: true });
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/engine/'))).toBe(true);
    });
    // state sin players/playerOrder → ignorado
    await vi.waitFor(() => expect(useGameStore.getState().gameState).toBeNull());
    useGameStore.getState().disconnectOnline();
  });

  it('una respuesta sin revisión no retrocede un estado ya versionado', async () => {
    let n = 0;
    fetchMock.mockImplementation((url: any) => {
      if (String(url).includes('/ws-ticket/')) return Promise.resolve(jsonResponse({ ticket: 'tk' }));
      n += 1;
      // 1ª respuesta: revisión 7 (válida). 2ª: sin revision → vieja.
      return Promise.resolve(jsonResponse(
        n === 1
          ? { state: { ...plausibleState, phase: 'RESTORATION' }, revision: 7 }
          : { state: { ...plausibleState, phase: 'STALE_PHASE' } },
      ));
    });
    useGameStore.getState().connectOnline('RV1', 'pv1', 'tok');
    const ws = await waitForSocket();
    ws.emitMessage({ type: 'game.command_result', cid: 'c1', stateChanged: true });
    await vi.waitFor(() => {
      expect(useGameStore.getState().gameState?.phase).toBe('RESTORATION');
    });
    ws.emitMessage({ type: 'game.command_result', cid: 'c2', stateChanged: true });
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/engine/')).length).toBe(2);
    });
    await vi.waitFor(() => {
      // La respuesta revision-less no debe haber pisado el estado
      expect(useGameStore.getState().gameState?.phase).toBe('RESTORATION');
    });
    useGameStore.getState().disconnectOnline();
  });

  it('una revisión antigua (<= lastRevision) se descarta', async () => {
    fetchMock.mockImplementation((url: any) => {
      if (String(url).includes('/ws-ticket/')) return Promise.resolve(jsonResponse({ ticket: 'tk' }));
      return Promise.resolve(jsonResponse({ state: plausibleState, revision: 3 }));
    });
    useGameStore.getState().connectOnline('RV2', 'pv2', 'tok');
    const ws = await waitForSocket();
    // Simular que ya conocemos la revisión 9 (vía command_ack)
    ws.emitMessage({ type: 'game.command_ack', revision: 9 });
    ws.emitMessage({ type: 'game.command_result', cid: 'c1', stateChanged: true });
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/engine/'))).toBe(true);
    });
    await vi.waitFor(() => expect(useGameStore.getState().gameState).toBeNull());
    useGameStore.getState().disconnectOnline();
  });

  it('disconnectOnline limpia estado/rng/registry del juego proyectado', async () => {
    useGameStore.getState().connectOnline('RD1', 'pd1', 'tok');
    await waitForSocket();
    useGameStore.setState({
      gameState: { phase: 'PLAYER_ATTACK' } as any,
      rng: {} as any,
      registry: {} as any,
      initialCommands: [{ type: 'END_TURN', cid: 'c' } as any],
      undoBase: {} as any,
      viewerId: 'pd1',
    });
    useGameStore.getState().disconnectOnline();
    const s = useGameStore.getState();
    expect(s.gameState).toBeNull();
    expect(s.rng).toBeNull();
    expect(s.registry).toBeNull();
    expect(s.initialCommands).toHaveLength(0);
    expect(s.undoBase).toBeNull();
    expect(s.viewerId).toBeNull();
  });

  it('newGame con sesión online activa la desconecta primero', async () => {
    useGameStore.getState().connectOnline('RN1', 'pn1', 'tok');
    await waitForSocket();
    expect(useGameStore.getState().connectionMode).toBe('online');
    useGameStore.getState().newGame({
      mode: 'SOLO',
      playerCount: 1,
      seed: 'disconnect-on-newgame',
      heroes: [
        { playerId: 'pn1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
      ],
      useScenarios: false,
    });
    const s = useGameStore.getState();
    expect(s.connectionMode).toBe('local');
    expect(s.online.roomId).toBeNull();
    expect(s.gameState?.mode).toBe('SOLO');
  });
});

describe('sanitizeOnlineState — paridad con redactCard del runner', () => {
  it('oculta definitionId + name + persistentTrigger + auraModifiers de cartas ajenas', async () => {
    const { sanitizeOnlineState, HIDDEN_CARD } = await import('../store/shared.js');
    const secretCard = {
      instanceId: 'i1',
      definitionId: 'card.secret',
      name: 'Nombre secreto',
      zone: 'HAND',
      ownerId: 'other',
      persistentTrigger: { on: 'X' },
      auraModifiers: [{ layer: 'Y' }],
    } as any;
    const state = {
      players: {
        me: { playerId: 'me', hand: [secretCard], abilityDeck: [], wearPile: [] },
        other: { playerId: 'other', hand: [secretCard], abilityDeck: [secretCard], wearPile: [secretCard] },
      },
      playerOrder: ['me', 'other'],
      hordeDeck: [secretCard],
      marketDeck: [secretCard],
      scenarioDeck: [],
      battlefield: [],
      pendingChoices: [],
      eventLog: [],
      rngState: { seed: 'real', state: 42 },
    } as any;

    const clean = sanitizeOnlineState(state, 'me');
    // Mi mano NO se redacta
    expect(clean.players.me.hand[0].definitionId).toBe('card.secret');
    // Mano ajena: redacción completa
    const other = clean.players.other.hand[0] as any;
    expect(other.definitionId).toBe(HIDDEN_CARD);
    expect(other.name).toBeUndefined();
    expect(other.persistentTrigger).toBeUndefined();
    expect(other.auraModifiers).toBeUndefined();
    // Mazos: igual
    expect(clean.hordeDeck[0].name).toBeUndefined();
    expect(clean.hordeDeck[0].persistentTrigger).toBeUndefined();
    // RNG sellado
    expect(clean.rngState.seed).toBe('');
  });
});
