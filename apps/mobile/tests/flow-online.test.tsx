/**
 * Nivel 15b: Pruebas del flujo online (store real).
 *
 * Ejercita el store de verdad (Zustand) mockeando solo WebSocket y fetch:
 * - connectOnline abre el socket autenticado y devuelve cleanup real
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

const initialStore = useGameStore.getState();

describe('Flujo online — gameStore real', () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ state: null }));
    useGameStore.setState(initialStore, true);
  });

  it('connectOnline abre WebSocket autenticado y guarda referencia', () => {
    const cleanup = useGameStore.getState().connectOnline('ROOM1', 'p1', 'tok-1');
    const s = useGameStore.getState();
    expect(s.connectionMode).toBe('online');
    expect(s.online.roomId).toBe('ROOM1');
    expect(s.online.playerId).toBe('p1');
    expect(s.online.playerToken).toBe('tok-1');
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();
    expect(ws.url).toContain('/ws/game/ROOM1/');
    expect(ws.url).toContain('playerId=p1');
    expect(ws.url).toContain('token=tok-1');
    cleanup();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('sendOnlineCommand envía comando con cid único', () => {
    useGameStore.getState().connectOnline('ROOM2', 'p2', 'tok');
    useGameStore.getState().sendOnlineCommand({ type: 'END_TURN' });
    useGameStore.getState().sendOnlineCommand({ type: 'END_TURN' });
    const ws = MockWebSocket.instances[0];
    expect(ws.sent).toHaveLength(2);
    expect(ws.sent[0].type).toBe('game.command');
    expect(ws.sent[0].command.type).toBe('END_TURN');
    // cids únicos — Date.now() solo no bastaba (D434)
    expect(ws.sent[0].cid).not.toBe(ws.sent[1].cid);
    useGameStore.getState().disconnectOnline();
  });

  it('sendOnlineCommand no envía nada si el socket no está OPEN', () => {
    useGameStore.getState().connectOnline('ROOM3', 'p3', 'tok');
    const ws = MockWebSocket.instances[0];
    ws.readyState = MockWebSocket.CLOSED;
    useGameStore.getState().sendOnlineCommand({ type: 'END_TURN' });
    expect(ws.sent).toHaveLength(0);
    expect(useGameStore.getState().ui.message).toContain('Sin conexión');
    useGameStore.getState().disconnectOnline();
  });

  it('command_result stateChanged pide el estado proyectado con token por header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ state: { phase: 'PLAYER_ATTACK', players: {} } }));
    useGameStore.getState().connectOnline('ROOM4', 'p4', 'tok-4');
    const ws = MockWebSocket.instances[0];
    ws.emitMessage({ type: 'game.command_result', cid: 'c1', stateChanged: true });
    // fetchProjectedState es async — esperar a que se invoque
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/rooms/ROOM4/engine/');
    expect(url).toContain('playerId=p4');
    expect(url).not.toContain('playerToken');
    expect((init as RequestInit).headers).toMatchObject({ 'X-Player-Token': 'tok-4' });
    await vi.waitFor(() => {
      expect(useGameStore.getState().gameState?.phase).toBe('PLAYER_ATTACK');
    });
    useGameStore.getState().disconnectOnline();
  });

  it('command_result rechazado muestra el motivo en la UI', () => {
    useGameStore.getState().connectOnline('ROOM5', 'p5', 'tok');
    const ws = MockWebSocket.instances[0];
    ws.emitMessage({ type: 'game.command_result', cid: 'c1', stateChanged: false, reason: 'Not your turn' });
    expect(useGameStore.getState().ui.message).toContain('Not your turn');
    useGameStore.getState().disconnectOnline();
  });

  it('frames malformados se ignoran sin romper el store', () => {
    useGameStore.getState().connectOnline('ROOM6', 'p6', 'tok');
    const ws = MockWebSocket.instances[0];
    ws.emitRaw('{not json');
    ws.emitRaw('"just a string"');
    ws.emitRaw('12345');
    // No lanza, no cambia estado
    expect(useGameStore.getState().connectionMode).toBe('online');
    useGameStore.getState().disconnectOnline();
  });

  it('disconnectOnline cierra el socket y resetea el modo', () => {
    useGameStore.getState().connectOnline('ROOM7', 'p7', 'tok');
    const ws = MockWebSocket.instances[0];
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
      online: { roomId: 'R', playerId: 'p1', playerToken: 't', socket: null },
      gameState: {} as any,
      rng: {} as any,
      initialConfig: {} as any,
    });
    useGameStore.getState().saveGame('test');
    expect(useGameStore.getState().ui.message).toContain('online');
  });

  it('mensajes del servidor llegan al callback onMessage', () => {
    const received: any[] = [];
    const cleanup = useGameStore.getState().connectOnline('ROOM8', 'p8', 'tok', (msg) => received.push(msg));
    const ws = MockWebSocket.instances[0];
    ws.emitMessage({ type: 'chat.message', sender: 'p9', text: 'hola' });
    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('hola');
    cleanup();
  });
});
