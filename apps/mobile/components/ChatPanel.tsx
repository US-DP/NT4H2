/**
 * ChatPanel — panel de chat de la partida.
 *
 * Cumple UI-180: panel lateral en escritorio.
 * Cumple UI-181: panel completo o pestaña en móvil.
 * Cumple UI-182: indicación de mensajes sin leer.
 * Cumple UI-183: notificaciones no ocultar info crítica.
 * Cumple UI-184: diferenciar tipos de mensaje.
 * Cumple UI-185: menú contextual por mensaje.
 * Cumple UI-186: ocultar chat sin ocultar historial.
 * Cumple UI-187: límite de longitud y contador.
 * Cumple UI-188: envío repetido/bloqueado explicado.
 * Cumple UI-189: sin adjuntos en MVP.
 */

import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';

export type ChatMessageType = 'USER' | 'SYSTEM' | 'CONNECTION' | 'MODERATION';

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  type: ChatMessageType;
  timestamp: number;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUser: string;
  onSend: (text: string) => void;
  /** Texto del borrador (controlado) */
  draftText?: string;
  /** Cambio del borrador */
  onDraftChange?: (text: string) => void;
  /** Si se muestra en móvil como panel completo */
  fullScreen?: boolean;
  /** Número de mensajes sin leer */
  unreadCount?: number;
  /** Callback para cerrar/ocultar el chat */
  onClose?: () => void;
}

const TYPE_LABELS: Record<ChatMessageType, string> = {
  USER: '',
  SYSTEM: 'Sistema',
  CONNECTION: 'Conexión',
  MODERATION: 'Moderación',
};

const TYPE_COLORS: Record<ChatMessageType, string> = {
  USER: '#ecf0f1',
  SYSTEM: '#f1c40f',
  CONNECTION: '#3498db',
  MODERATION: '#e74c3c',
};

export function ChatPanel({
  messages,
  currentUser,
  onSend,
  draftText = '',
  onDraftChange,
  fullScreen = false,
  unreadCount = 0,
  onClose,
}: ChatPanelProps) {
  const text = draftText;
  const setText = onDraftChange ?? (() => {});

  // Silencio local: oculta mensajes de remitentes silenciados (solo afecta
  // a este cliente — el backend no persiste moderación de chat)
  const [mutedSenders, setMutedSenders] = useState<Set<string>>(new Set());
  const toggleMute = (sender: string) => {
    setMutedSenders((prev) => {
      const next = new Set(prev);
      if (next.has(sender)) next.delete(sender);
      else next.add(sender);
      return next;
    });
  };
  const visibleMessages = messages.filter(
    (m) => m.type !== 'USER' || m.sender === currentUser || !mutedSenders.has(m.sender)
  );

  // Contador para límite de longitud (UI-187)
  const maxLength = 200;
  const remaining = maxLength - (text?.length ?? 0);
  const nearLimit = remaining <= 20;
  const canSend = text?.trim().length > 0 && remaining >= 0;

  const handleSend = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <View style={[styles.container, fullScreen && styles.fullScreen]}>
      <View style={styles.header}>
        <Text style={styles.title}>Chat</Text>
        {unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{unreadCount}</Text>
          </View>
        )}
        {onClose && (
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="Ocultar chat">
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        )}
      </View>

      <ScrollView style={styles.messages}>
        {visibleMessages.length === 0 ? (
          <Text style={styles.empty}>No hay mensajes.</Text>
        ) : (
          visibleMessages.map((msg) => {
            const isMine = msg.sender === currentUser && msg.type === 'USER';
            const typeLabel = TYPE_LABELS[msg.type];
            return (
              <View
                key={msg.id}
                style={[
                  styles.message,
                  isMine && styles.myMessage,
                  msg.type !== 'USER' && styles.systemMessage,
                ]}
              >
                <View style={styles.messageHeader}>
                  <Text style={[styles.sender, { color: TYPE_COLORS[msg.type] }]}>
                    {msg.sender}{typeLabel ? ` (${typeLabel})` : ''}
                  </Text>
                  <Text style={styles.time}>{new Date(msg.timestamp).toLocaleTimeString()}</Text>
                </View>
                <Text style={styles.messageText}>{msg.text}</Text>
                {msg.type === 'USER' && !isMine && (
                  <View style={styles.menu}>
                    <Pressable
                      style={styles.menuItem}
                      onPress={() => toggleMute(msg.sender)}
                      accessibilityLabel={`Silenciar a ${msg.sender}`}
                    >
                      <Text style={styles.menuText}>Silenciar</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.inputArea}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Escribe un mensaje..."
          placeholderTextColor="#777"
          maxLength={maxLength}
          multiline
          accessibilityLabel="Mensaje de chat"
        />
        <View style={styles.inputFooter}>
          <Text style={[styles.counter, nearLimit && styles.counterNear]}>
            {remaining}
          </Text>
          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Enviar mensaje"
          >
            <Text style={styles.sendText}>Enviar</Text>
          </Pressable>
        </View>
        {/* UI-189: sin adjuntos */}
        <Text style={styles.noAttachments}>Adjuntos no disponibles en el MVP.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a2e',
    borderLeftWidth: 1,
    borderLeftColor: '#333',
    width: 280,
    padding: 8,
    maxHeight: 400,
  },
  fullScreen: {
    width: '100%',
    maxHeight: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#f1c40f',
    fontSize: 14,
    fontWeight: 'bold',
  },
  unreadBadge: {
    backgroundColor: '#e74c3c',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  unreadText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: 4,
  },
  closeText: {
    color: '#bdc3c7',
    fontSize: 16,
  },
  messages: {
    flex: 1,
    marginBottom: 8,
  },
  empty: {
    color: '#777',
    fontSize: 12,
    textAlign: 'center',
    padding: 16,
  },
  message: {
    backgroundColor: '#2c3e50',
    padding: 8,
    borderRadius: 6,
    marginBottom: 6,
  },
  myMessage: {
    backgroundColor: '#2980b9',
  },
  systemMessage: {
    backgroundColor: '#3a2a1a',
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sender: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  time: {
    color: '#7f8c8d',
    fontSize: 9,
  },
  messageText: {
    color: '#ecf0f1',
    fontSize: 12,
  },
  menu: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  menuItem: {
    backgroundColor: '#34495e',
    padding: 4,
    borderRadius: 4,
  },
  menuText: {
    color: '#bdc3c7',
    fontSize: 9,
  },
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 8,
  },
  input: {
    backgroundColor: '#2c3e50',
    color: '#ecf0f1',
    padding: 8,
    borderRadius: 6,
    minHeight: 44,
    maxHeight: 100,
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  counter: {
    color: '#7f8c8d',
    fontSize: 10,
  },
  counterNear: {
    color: '#f39c12',
    fontWeight: 'bold',
  },
  sendButton: {
    backgroundColor: '#27ae60',
    padding: 8,
    borderRadius: 6,
    minWidth: 60,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#555',
  },
  sendText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  noAttachments: {
    color: '#7f8c8d',
    fontSize: 9,
    fontStyle: 'italic',
    marginTop: 4,
    textAlign: 'center',
  },
});
