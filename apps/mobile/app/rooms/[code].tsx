/**
 * /rooms/[code] — pantalla intermedia de invitación.
 *
 * Deep link semántico: muestra sala, participantes, modo y compatibilidad
 * antes de unirse. NUNCA une automáticamente al abrir el enlace.
 */

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { API_BASE, fetchWithTimeout } from '../../lib/config';
import { checkCompatibility } from '../../lib/compat';
import { useCustomContent } from '../../lib/customContent';
import { toast } from '../../lib/toast';
import type { ContentSet } from '@nt4h/schema';
import { NtButton } from '../../components/ui/NtButton';
import { AppNav, useNavSidebarWidth } from '../../components/AppNav';
import { useColors, useFs } from '../../lib/useTheme';
import { fontSize, type Colors } from '../../lib/theme';

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
  const styles = createStyles(colors, fs);
  const navWidth = useNavSidebarWidth();
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
    <View style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: colors.background, marginLeft: navWidth }]}>
      <Text style={[styles.title, { color: colors.text, fontSize: fs(fontSize.title) }]}>
        {t('invite.title')}
      </Text>

      {loading && <ActivityIndicator color={colors.primary} />}

      {error === 'not-found' && (
        <Text style={[styles.detail, { color: colors.warning }]} accessibilityRole="alert">
          {t('invite.notFound')}
        </Text>
      )}

      {room && (
        <>
          <Text style={[styles.detail, { color: colors.text, fontSize: fs(fontSize.body) }]}>
            {t('invite.summary', {
              code: room.roomId,
              // el modo llega como enum crudo (STANDARD…) — room.mode.*
              // lo traduce con fallback al valor original
              mode: t(`room.mode.${room.mode}`) !== `room.mode.${room.mode}`
                ? t(`room.mode.${room.mode}`) : room.mode,
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
            <Text style={[styles.detail, { color: colors.textFaint, fontSize: fs(fontSize.micro) }]}>
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
              <Text style={[styles.detail, { color: colors.warning }]} accessibilityRole="alert">
                {t('room.missingSets', { sets: missingSets.map((s) => `${s.name} v${s.version}`).join(', ') })}
              </Text>
              {missingSets.map((s) => (
                <NtButton
                  key={s.id}
                  label={t('invite.importSet', { name: s.name })}
                  variant="secondary"
                  onPress={() => importSet(s.id)}
                  accessibilityLabel={t('invite.importSet', { name: s.name })}
                />
              ))}
            </>
          )}
          {room.status !== 'WAITING' && (
            <Text style={[styles.detail, { color: colors.warning }]}>
              {room.status === 'PLAYING' ? t('invite.started') : t('invite.closed')}
            </Text>
          )}
          {(room.players.length >= room.maxPlayers) && room.status === 'WAITING' && (
            <Text style={[styles.detail, { color: colors.warning }]}>{t('invite.full')}</Text>
          )}
          <NtButton
            label={t('invite.join')}
            variant="primary"
            disabled={!joinable}
            onPress={() => router.push({ pathname: '/(room)', params: { roomId: room.roomId } })}
            accessibilityLabel={t('invite.join')}
            accessibilityState={{ disabled: !joinable }}
          />
        </>
      )}

      <NtButton
        label={t('invite.back')}
        variant="secondary"
        onPress={() => router.push('/')}
      />
      </View>
      <AppNav />
    </View>
  );
}

const createStyles = (_c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    paddingBottom: 84, // barra inferior de AppNav en móvil
  },
  title: { fontWeight: 'bold', marginBottom: 8 },
  detail: { textAlign: 'center', marginVertical: 4, fontSize: fs(fontSize.detail) },
});
