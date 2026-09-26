/**
 * /rooms/[code] — pantalla intermedia de invitación.
 *
 * Deep link semántico: muestra sala, participantes, modo y compatibilidad
 * antes de unirse. NUNCA une automáticamente al abrir el enlace.
 */

import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { API_BASE, fetchWithTimeout } from '../../lib/config';
import { checkCompatibility } from '../../lib/compat';
import { useCustomContent } from '../../lib/customContent';
import { toast } from '../../lib/toast';
import type { ContentSet } from '@nt4h/schema';
import { useColors, useFs } from '../../lib/useTheme';
import { fontSize } from '../../lib/theme';

interface InviteRoom {
  roomId: string;
  mode: string;
  status: string;
  maxPlayers: number;
  hostId?: string;
  createdAt?: string;
  players: { playerId: string; name: string; isHost?: boolean; connected?: boolean }[];
  config?: {
    catalogVersion?: string;
    engineVersion?: string;
    contentManifest?: { id: string; name: string; version: string }[];
    /** Snapshot de los sets del host — permite al invitado importarlos. */
    customSets?: ContentSet[];
  };
}

export default function RoomInviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const colors = useColors();
  const fs = useFs();
  const { t } = useTranslation();
  const [room, setRoom] = useState<InviteRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetchWithTimeout(`${API_BASE}/rooms/${encodeURIComponent(code)}/`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'not-found');
        if (!cancelled) setRoom(data);
      })
      .catch(() => { if (!cancelled) setError('not-found'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code]);

  const compat = room ? checkCompatibility(room.config) : null;
  // Manifiesto: sets del Taller que el host usa y el invitado no tiene
  const missingSets = room?.config?.contentManifest?.filter(
    (s) => !useCustomContent.getState().sets.some(
      (local) => local.id === s.id && local.version === s.version,
    ),
  ) ?? [];

  // Importar el set del host (el snapshot viaja en config.customSets;
  // la validación corre en importSet: solo se importa si es válido).
  const importSet = (id: string) => {
    const set = room?.config?.customSets?.find((s) => s.id === id);
    if (!set) return;
    const errs = useCustomContent.getState().importSet(set);
    if (errs.length === 0) {
      toast.show(t('invite.setImported'));
      // Forzar re-render para reevaluar missingSets
      setRoom((prev) => (prev ? { ...prev } : prev));
    } else {
      toast.show(errs[0]);
    }
  };
  const joinable = room?.status === 'WAITING' && (room?.players.length ?? 0) < (room?.maxPlayers ?? 0) && (compat?.compatible ?? false);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text, fontSize: fs(fontSize.title) }]}>
        {t('invite.title')}
      </Text>

      {loading && <ActivityIndicator color={colors.primary} />}

      {error === 'not-found' && (
        <Text style={[styles.detail, { color: colors.warning ?? '#f39c12' }]} accessibilityRole="alert">
          {t('invite.notFound')}
        </Text>
      )}

      {room && (
        <>
          <Text style={[styles.detail, { color: colors.text, fontSize: fs(fontSize.body) }]}>
            {t('invite.summary', {
              code: room.roomId, mode: room.mode,
              n: room.players.length, max: room.maxPlayers,
            })}
          </Text>
          {(() => {
            const host = room.players.find((p) => p.isHost || p.playerId === room.hostId);
            return host ? (
              <Text style={[styles.detail, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}>
                {t('invite.host', { name: host.name })}
              </Text>
            ) : null;
          })()}
          {(room.config?.contentManifest?.length ?? room.config?.customSets?.length ?? 0) > 0 && (
            <Text style={[styles.detail, { color: colors.warning, fontSize: fs(fontSize.detail) }]}>
              {t('invite.customContent', {
                names: (room.config?.contentManifest ?? room.config?.customSets ?? [])
                  .map((cs) => cs.name)
                  .join(', '),
              })}
            </Text>
          )}
          <Text style={[styles.detail, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}>
            {t('invite.players', { names: room.players.map((p) => p.name).join(', ') })}
          </Text>
          {room.createdAt && (
            <Text style={[styles.detail, { color: colors.textFaint ?? colors.textMuted, fontSize: fs(fontSize.micro) }]}>
              {t('invite.created', { date: new Date(room.createdAt).toLocaleString() })}
            </Text>
          )}
          {compat && !compat.compatible && (
            <Text style={[styles.detail, { color: colors.danger }]} accessibilityRole="alert">
              {t(`room.incompat.${compat.reason}`, {
                host: compat.reason === 'ENGINE_MISMATCH' ? compat.hostVersion.engine : compat.hostVersion.catalog,
                local: compat.reason === 'ENGINE_MISMATCH' ? compat.clientVersion.engine : compat.clientVersion.catalog,
              })}
            </Text>
          )}
          {missingSets.length > 0 && (
            <>
              <Text style={[styles.detail, { color: colors.warning ?? '#f39c12' }]} accessibilityRole="alert">
                {t('room.missingSets', { sets: missingSets.map((s) => `${s.name} v${s.version}`).join(', ') })}
              </Text>
              {missingSets.map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.button, styles.secondary]}
                  onPress={() => importSet(s.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('invite.importSet', { name: s.name })}
                >
                  <Text style={styles.buttonText}>{t('invite.importSet', { name: s.name })}</Text>
                </Pressable>
              ))}
            </>
          )}
          {room.status !== 'WAITING' && (
            <Text style={[styles.detail, { color: colors.warning ?? '#f39c12' }]}>
              {room.status === 'PLAYING' ? t('invite.started') : t('invite.closed')}
            </Text>
          )}
          {(room.players.length >= room.maxPlayers) && room.status === 'WAITING' && (
            <Text style={[styles.detail, { color: colors.warning ?? '#f39c12' }]}>{t('invite.full')}</Text>
          )}
          <Pressable
            style={[styles.button, !joinable && styles.buttonDisabled]}
            disabled={!joinable}
            onPress={() => router.push({ pathname: '/(room)', params: { roomId: room.roomId } })}
            accessibilityRole="button"
            accessibilityLabel={t('invite.join')}
          >
            <Text style={styles.buttonText}>{t('invite.join')}</Text>
          </Pressable>
        </>
      )}

      <Pressable
        style={[styles.button, styles.secondary]}
        onPress={() => router.push('/')}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>{t('invite.back')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontWeight: 'bold', marginBottom: 8 },
  detail: { textAlign: 'center', marginVertical: 4 },
  button: { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 8, backgroundColor: '#c9a227', marginTop: 8 },
  buttonDisabled: { opacity: 0.4 },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#555' },
  buttonText: { color: '#1a1a2e', fontWeight: 'bold' },
});
