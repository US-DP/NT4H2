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

import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useColors } from '../lib/useTheme';
import type { Colors } from '../lib/theme';

export type ChatMessageType = 'USER' | 'SYSTEM' | 'CONNECTION' | 'MODERATION';

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  type: ChatMessageType;
  timestamp: number;
  /** Estado de entrega de mensajes propios (online): sending → sent / failed */
  status?: 'sending' | 'sent' | 'failed';
  /** ID de cliente estable entre reintentos (dedupe en el servidor) */
  clientMessageId?: string;
  /** Ping estructurado (emote con objetivo) — el servidor solo reenvía
   *  campos blanqueados (kind + target). */
  meta?: { kind: 'ping'; target?: string };
}

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUser: string;
  onSend: (text: string, meta?: ChatMessage['meta']) => void;
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
  /** Remitentes silenciados localmente (los controla el padre) */
  mutedSenders?: string[];
  /** Silenciar/dejar de silenciar un remitente */
  onToggleMute?: (sender: string) => void;
  /** Reintentar un mensaje propio fallido */
  onRetry?: (msg: ChatMessage) => void;
  /** Descartar un mensaje pendiente/fallido */
  onDiscard?: (msg: ChatMessage) => void;
}

const TYPE_LABEL_KEYS: Record<ChatMessageType, string> = {
  USER: '',
  SYSTEM: 'typeSystem',
  CONNECTION: 'typeConnection',
  MODERATION: 'typeModeration',
};

/** Mensajes rápidos tácticos — cubren la mayoría de la coordinación
 *  sin escribir texto libre (limita exposición del chat abierto).
 *  Claves de lobby.chat.qm* resueltas con t() en el render. */
const QUICK_MESSAGE_KEYS = [
  'qmGoodLuck',
  'qmOnIt',
  'qmWaitTurn',
  'qmNeedHeal',
  'qmHitLeader',
  'qmSaveForWarlord',
  'qmWatchEnemy',
  'qmMarket',
  'qmNicePlay',
  'qmHelpMe',
] as const;

/** Claves que viajan como ping estructurado (meta.kind='ping') — el
 *  servidor las reenvía con metadata y la UI las destaca. */
const PING_KEYS = new Set(['qmWatchEnemy', 'qmMarket', 'qmNeedHeal', 'qmHelpMe', 'qmHitLeader']);

export function ChatPanel({
  messages,
  currentUser,
  onSend,
  draftText = '',
  onDraftChange,
  fullScreen = false,
  unreadCount = 0,
  onClose,
  mutedSenders = [],
  onToggleMute,
  onRetry,
  onDiscard,
}: ChatPanelProps) {
  const c = useColors();
  const { t } = useTranslation();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(c);
  const typeColors: Record<ChatMessageType, string> = {
    USER: c.text,
    SYSTEM: c.accent,
    CONNECTION: c.info,
    MODERATION: c.danger,
  };

  const text = draftText;
  const setText = onDraftChange ?? (() => {});

  // Silencio local: oculta mensajes de remitentes silenciados (solo afecta
  // a este cliente — el backend no persiste moderación de chat)
  const visibleMessages = messages.filter(
    (m) => m.type !== 'USER' || m.sender === currentUser || !mutedSenders.includes(m.sender)
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
        <Text style={styles.title}>{t('lobby.chat.title')}</Text>
        {unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{unreadCount}</Text>
          </View>
        )}
        {onClose && (
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t('lobby.chat.hideChat')}
            hitSlop={4}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        )}
      </View>

      <ScrollView style={styles.messages}>
        {visibleMessages.length === 0 ? (
          <Text style={styles.empty}>{t('lobby.chat.empty')}</Text>
        ) : (
          visibleMessages.map((msg) => {
            const isMine = msg.sender === currentUser && msg.type === 'USER';
            const typeKey = TYPE_LABEL_KEYS[msg.type];
            const typeLabel = typeKey ? t(`lobby.chat.${typeKey}`) : '';
            return (
              <View
                key={msg.id}
                style={[
                  styles.message,
                  isMine && styles.myMessage,
                  msg.type !== 'USER' && styles.systemMessage,
                  msg.meta?.kind === 'ping' && styles.pingMessage,
                ]}
              >
                <View style={styles.messageHeader}>
                  <Text style={[styles.sender, { color: typeColors[msg.type] }]}>
                    {msg.sender}{typeLabel ? ` (${typeLabel})` : ''}
                  </Text>
                  <Text style={styles.time}>{format(new Date(msg.timestamp), 'HH:mm')}</Text>
                </View>
                <Text style={styles.messageText}>
                  {msg.meta?.kind === 'ping' ? '🎯 ' : ''}{msg.text}
                  {msg.meta?.target ? ` — ${msg.meta.target}` : ''}
                </Text>
                {isMine && msg.status === 'sending' && (
                  <Text style={styles.sendStatus}>{t('lobby.chat.sending')}</Text>
                )}
                {isMine && msg.status === 'failed' && (
                  <View style={styles.retryRow}>
                    <Pressable
                      onPress={() => onRetry?.(msg)}
                      disabled={!onRetry}
                      accessibilityRole="button"
                      accessibilityLabel={t('lobby.chat.retryA11y', { text: msg.text })}
                    >
                      <Text style={[styles.sendStatus, styles.sendFailed]}>{t('lobby.chat.notSentRetry')}</Text>
                    </Pressable>
                    {onDiscard && (
                      <Pressable
                        onPress={() => onDiscard(msg)}
                        accessibilityRole="button"
                        accessibilityLabel={t('lobby.chat.discardA11y', { text: msg.text })}
                      >
                        <Text style={styles.sendStatus}>{t('lobby.chat.discard')}</Text>
                      </Pressable>
                    )}
                  </View>
                )}
                {msg.type === 'USER' && !isMine && onToggleMute && (
                  <View style={styles.menu}>
                    <Pressable
                      style={styles.menuItem}
                      onPress={() => onToggleMute(msg.sender)}
                      accessibilityRole="button"
                      accessibilityLabel={t('lobby.chat.muteA11y', { sender: msg.sender })}
                      hitSlop={6}
                    >
                      <Text style={styles.menuText}>{t('lobby.chat.mute')}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.inputArea}>
        {/* Mensajes rápidos: un toque, sin teclado */}
        <View style={styles.quickRow} accessibilityLabel={t('lobby.chat.quickRow')}>
          {QUICK_MESSAGE_KEYS.map((key) => {
            const qm = t(`lobby.chat.${key}`);
            return (
              <Pressable
                key={key}
                style={styles.quickChip}
                onPress={() => onSend(qm, PING_KEYS.has(key) ? { kind: 'ping' } : undefined)}
                accessibilityRole="button"
                accessibilityLabel={t('lobby.chat.sendQuickA11y', { text: qm })}
                hitSlop={6}
              >
                <Text style={styles.quickChipText}>{qm}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={t('lobby.chat.placeholder')}
          placeholderTextColor={c.textFaint}
          maxLength={maxLength}
          multiline
          accessibilityLabel={t('lobby.chat.inputA11y')}
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
            accessibilityLabel={t('lobby.chat.sendA11y')}
          >
            <Text style={styles.sendText}>{t('lobby.chat.send')}</Text>
          </Pressable>
        </View>
        {/* UI-189: sin adjuntos */}
        <Text style={styles.noAttachments}>{t('lobby.chat.noAttachments')}</Text>
      </View>
    </View>
  );
}

const createStyles = (c: Colors) => StyleSheet.create({
  container: {
    backgroundColor: c.surface,
    borderLeftWidth: 1,
    borderLeftColor: c.border,
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
    color: c.accent,
    fontSize: 14,
    fontWeight: 'bold',
  },
  unreadBadge: {
    backgroundColor: c.danger,
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
    padding: 12,
  },
  closeText: {
    color: c.textMuted,
    fontSize: 16,
  },
  messages: {
    flex: 1,
    marginBottom: 8,
  },
  empty: {
    color: c.textMuted,
    fontSize: 12,
    textAlign: 'center',
    padding: 16,
  },
  message: {
    backgroundColor: c.surfaceRaised,
    padding: 8,
    borderRadius: 6,
    marginBottom: 6,
  },
  myMessage: {
    backgroundColor: c.infoSurface,
  },
  systemMessage: {
    backgroundColor: c.dangerSurface,
  },
  pingMessage: {
    borderLeftWidth: 3,
    borderLeftColor: c.accent,
    backgroundColor: c.infoSurface,
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
    color: c.textFaint,
    fontSize: 9,
  },
  messageText: {
    color: c.text,
    fontSize: 12,
  },
  sendStatus: {
    color: c.textFaint,
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  retryRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  sendFailed: {
    color: c.danger,
    fontWeight: '700',
  },
  menu: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  menuItem: {
    backgroundColor: c.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  menuText: {
    color: c.textMuted,
    fontSize: 9,
  },
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: 8,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  quickChip: {
    backgroundColor: c.surfaceRaised,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 36,
    justifyContent: 'center',
  },
  quickChipText: {
    color: c.textMuted,
    fontSize: 11,
  },
  input: {
    backgroundColor: c.surfaceRaised,
    color: c.text,
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
    color: c.textFaint,
    fontSize: 10,
  },
  counterNear: {
    color: c.warning,
    fontWeight: 'bold',
  },
  sendButton: {
    backgroundColor: c.primary,
    padding: 8,
    borderRadius: 6,
    minWidth: 60,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: c.border,
  },
  sendText: {
    color: c.textOnAccent,
    fontSize: 12,
    fontWeight: 'bold',
  },
  noAttachments: {
    color: c.textFaint,
    fontSize: 9,
    fontStyle: 'italic',
    marginTop: 4,
    textAlign: 'center',
  },
});
