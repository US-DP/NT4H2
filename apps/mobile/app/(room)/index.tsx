/**
 * Pantalla de sala multijugador.
 *
 * Cumple UI-060: copiar código de sala.
 * Cumple UI-061: estado de jugadores.
 * Cumple UI-062: anfitrión distinguible.
 * Cumple UI-063: botón iniciar explicado.
 * Cumple UI-064: cambios en tiempo real (WebSocket).
 * Cumple UI-066: chat contraíble.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Switch, Clipboard } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import { ChatPanel, type ChatMessage } from '../../components/ChatPanel';
import { API_BASE, WS_BASE, fetchWithTimeout } from '../../lib/config';

interface PlayerInfo {
  playerId: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  heroId: string;
}

interface RoomInfo {
  roomId: string;
  mode: string;
  status: string;
  hostId: string;
  maxPlayers: number;
  players: PlayerInfo[];
}

export default function RoomScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ roomId?: string; playerId?: string; playerToken?: string }>();
  const roomId = params.roomId;
  const setGameState = useGameStore((s) => s.setGameState);
  const setConnectionMode = useGameStore((s) => s.setConnectionMode);
  const connectOnline = useGameStore((s) => s.connectOnline);
  const [localRoomId, setLocalRoomId] = useState(roomId ?? '');
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [playerName, setPlayerName] = useState('Jugador');
  // D431: si venimos de crear la sala, ya somos miembros (host) con token
  const [playerId] = useState(params.playerId || `p-${Date.now()}`);
  const isCreator = Boolean(params.playerToken ?? useGameStore.getState().online.playerToken);
  const [error, setError] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [socket, setSocket] = useState<WebSocket | null>(null);
  // D431: token emitido por el backend al unirse — necesario para
  // autenticar el WebSocket y las acciones (start, estado proyectado)
  const [playerToken, setPlayerToken] = useState(
    params.playerToken ?? useGameStore.getState().online.playerToken ?? ''
  );
  // Socket del lobby: se cierra al desmontar o antes de abrir otro
  const lobbySocketRef = useRef<WebSocket | null>(null);
  // Cleanup de connectOnline (heartbeat + reconnect + socket del juego)
  const onlineCleanupRef = useRef<(() => void) | null>(null);

  const connect = useCallback((token: string) => {
    lobbySocketRef.current?.close();
    const query = `?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(`${WS_BASE}/game/${localRoomId}/${query}`);
    lobbySocketRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'ping' }));
    };
    ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // frame malformado — ignorar
      }
      if (msg.type === 'chat.message') {
        const chat: ChatMessage = {
          id: `chat-${Date.now()}`,
          sender: msg.sender,
          text: msg.text,
          type: 'USER',
          timestamp: msg.timestamp,
        };
        setChatMessages((prev) => [...prev, chat]);
      } else if (msg.type === 'game.command') {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            sender: 'Sistema',
            text: `Comando ${msg.command} de ${msg.playerId}`,
            type: 'SYSTEM',
            timestamp: Date.now(),
          },
        ]);
      }
    };
    ws.onerror = () => setError('Error de conexión WebSocket');
    setSocket(ws);
    return ws;
  }, [localRoomId, playerId]);

  // D431: el creador ya es miembro (host) — cargar la sala y conectar sin join
  useEffect(() => {
    if (!isCreator || !localRoomId || !playerToken) return;
    void (async () => {
      try {
        const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/`);
        const data = await res.json();
        if (res.ok) setRoom(data);
        connect(playerToken);
      } catch {
        setError('No se pudo cargar la sala');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al salir de la sala: cerrar el socket del lobby y la conexión del juego
  useEffect(() => {
    return () => {
      lobbySocketRef.current?.close();
      lobbySocketRef.current = null;
      onlineCleanupRef.current?.();
      onlineCleanupRef.current = null;
    };
  }, []);

  const joinRoom = async () => {
    if (!localRoomId) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/join/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: playerName, playerToken: playerToken || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo unir');
      setRoom(data.room);
      // D431: guardar el token devuelto por el backend
      const token = data.authToken ?? '';
      setPlayerToken(token);
      connect(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  };

  const startGame = async () => {
    if (!localRoomId) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/${localRoomId}/start/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, playerToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar');
      setRoom(data.room);

      // Load engine state — vista proyectada para este jugador (RF-J095).
      // Token por header, nunca por query param.
      const stateRes = await fetchWithTimeout(
        `${API_BASE}/rooms/${localRoomId}/engine/?playerId=${encodeURIComponent(playerId)}`,
        { headers: { 'X-Player-Token': playerToken } },
      );
      const stateData = await stateRes.json();
      if (stateData.state) {
        setGameState(stateData.state);
        setConnectionMode('online', localRoomId, playerId, playerToken);
        // D422: connectOnline espera playerId (para firmar comandos), no el nombre.
        // Guardar el cleanup para cerrar heartbeat/reconnect al salir.
        onlineCleanupRef.current = connectOnline(localRoomId, playerId, playerToken);
        router.push('/(game)');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  };

  const copyRoomCode = () => {
    Clipboard.setString(localRoomId);
  };

  const sendChat = (text: string) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'chat.message', sender: playerName, text, timestamp: Date.now() }));
    }
    setChatDraft('');
  };

  const isHost = room?.hostId === playerId;
  const canStart = isHost && room && room.players.length >= 1 && room.status === 'WAITING';

  if (!room) {
    return (
      <ScrollView style={styles.container}>
        <Text style={styles.title}>Unirse a sala</Text>
        <TextInput
          style={styles.input}
          value={localRoomId}
          onChangeText={setLocalRoomId}
          placeholder="Código de sala"
          placeholderTextColor="#777"
          autoCapitalize="characters"
        />
        <TextInput
          style={styles.input}
          value={playerName}
          onChangeText={setPlayerName}
          placeholder="Tu nombre"
          placeholderTextColor="#777"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={joinRoom}>
          <Text style={styles.buttonText}>Unirse</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => router.push('/')}>
          <Text style={styles.buttonText}>Volver</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sala {room.roomId}</Text>
      <Text style={styles.meta}>Modo: {room.mode} • Estado: {room.status}</Text>

      <Pressable style={styles.copyButton} onPress={copyRoomCode}>
        <Text style={styles.buttonText}>Copiar código</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Jugadores ({room.players.length}/{room.maxPlayers})</Text>
      <ScrollView style={styles.playerList}>
        {room.players.map((p) => (
          <View key={p.playerId} style={styles.playerRow}>
            <Text style={styles.playerName}>
              {p.name} {p.isHost ? '(Anfitrión)' : ''}
            </Text>
            <Text style={[styles.playerStatus, p.connected ? styles.connected : styles.disconnected]}>
              {p.connected ? 'Conectado' : 'Desconectado'}
            </Text>
          </View>
        ))}
      </ScrollView>

      {canStart && (
        <Pressable style={styles.startButton} onPress={startGame}>
          <Text style={styles.buttonText}>Iniciar partida</Text>
        </Pressable>
      )}

      <View style={styles.chatToggleRow}>
        <Text style={styles.sectionTitle}>Chat</Text>
        <Switch value={showChat} onValueChange={setShowChat} />
      </View>

      {showChat && (
        <ChatPanel
          messages={chatMessages}
          currentUser={playerName}
          onSend={sendChat}
          draftText={chatDraft}
          onDraftChange={setChatDraft}
          onClose={() => setShowChat(false)}
        />
      )}

      <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => router.push('/')}>
        <Text style={styles.buttonText}>Volver</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    color: '#f1c40f',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  meta: {
    color: '#7f8c8d',
    fontSize: 12,
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#2c3e50',
    color: '#ecf0f1',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#27ae60',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  secondaryButton: {
    backgroundColor: '#555',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  error: {
    color: '#e74c3c',
    marginBottom: 8,
  },
  copyButton: {
    backgroundColor: '#2980b9',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#3498db',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 8,
  },
  playerList: {
    maxHeight: 200,
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a2e',
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  playerName: {
    color: '#ecf0f1',
    fontSize: 13,
  },
  playerStatus: {
    fontSize: 12,
  },
  connected: {
    color: '#27ae60',
  },
  disconnected: {
    color: '#e74c3c',
  },
  startButton: {
    backgroundColor: '#f1c40f',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  chatToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
});
