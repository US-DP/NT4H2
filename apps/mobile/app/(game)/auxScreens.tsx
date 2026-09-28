/**
 * Pantallas auxiliares de la partida: fin de partida, limite de zona y
 * fallback de error. Extraidas de app/(game)/index.tsx.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import ConfettiCannon from 'react-native-confetti-cannon';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react-native';
import { computeFinalScore } from '@nt4h/engine';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { captureError } from '../../lib/monitoring';
import { useColors } from '../../lib/useTheme';
import { ErrorBoundary } from 'react-error-boundary';
import * as Clipboard from 'expo-clipboard';
import { createStyles } from './gameStyles';
import { colors } from '../../lib/theme';
import type { Achievement } from '../../lib/achievements';

export function FinishedScreen({ newAchievements = [] }: { newAchievements?: Achievement[] }) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const gameState = useGameStore((s) => s.gameState);
  const noFlashes = useSettings((s) => s.noFlashes || s.reduceMotion);
  const initialConfig = useGameStore((s) => s.initialConfig);
  const newGame = useGameStore((s) => s.newGame);
  const router = useRouter();

  if (!gameState) return null;

  const catalog = useGameStore.getState().catalog;
  const heroName = (id: string) => catalog?.byId.get(id)?.name ?? id;
  // PuntuaciÃ³n final calculada por el motor (spec 3.8): Gloria + 1/3 monedas
  // + 1 Tenaz sin heridas. Desempate: mÃ¡s trofeos.
  const { ranking: sorted, isTie } = computeFinalScore(gameState.players);
  const winner = sorted[0];

  return (
    <ScrollView style={styles.finishedContainer} contentContainerStyle={styles.finishedContent}>
      {/* CelebraciÃ³n de victoria â€” se omite si el usuario pidiÃ³ evitar destellos */}
      {!noFlashes && (
        <ConfettiCannon count={120} origin={{ x: 200, y: -20 }} fadeOut autoStart />
      )}
      <Text style={styles.finishedTitle}>{t('gm.finishedTitle')}</Text>

      {/* Toast de logros desbloqueados en esta partida */}
      {newAchievements.map((a) => (
        <View
          key={a.id}
          accessibilityRole="alert"
          style={{
            backgroundColor: colors.accent,
            borderRadius: 10,
            paddingVertical: 8,
            paddingHorizontal: 14,
            marginVertical: 3,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Trophy size={18} color="#1a1a2e" />
          <Text style={{ color: '#1a1a2e', fontWeight: '700' }}>
            {t('ach.toast', { name: t(`ach.${a.id}.name`, { defaultValue: a.name }) })}
          </Text>
        </View>
      ))}

      {isTie ? (
        <Text style={styles.tieText}>
          {t('gm.finishedTie', {
            total: winner.total,
            players: sorted
              .filter((p) => p.total === winner.total && p.trophies === winner.trophies)
              .map((p) => heroName(p.heroId))
              .join(t('gm.listAnd')),
          })}
        </Text>
      ) : (
        <Text style={styles.winnerText}>
          {t('gm.finishedWinner', { name: heroName(winner?.heroId ?? ''), total: winner?.total ?? '' })}
        </Text>
      )}

      <View style={styles.rankings}>
        {sorted.map((p, i) => (
          <View key={p.playerId} style={styles.rankingRow}>
            <Text style={styles.rankPosition}>{i + 1}.</Text>
            <View style={styles.rankMain}>
              <Text style={styles.rankName}>{heroName(p.heroId)}</Text>
              <Text style={styles.rankBreakdown}>
                {p.breakdown.filter((b) => b.value > 0).map((b) => `${b.label} ${b.value}`).join(' + ')}
                {' '}Â· {t('gm.finishedTrophies', { count: p.trophies })}
              </Text>
            </View>
            <Text style={styles.rankGlory}>{p.total}</Text>
          </View>
        ))}
      </View>

      <View style={styles.finishedActions}>
        <Pressable style={styles.finishedButton} onPress={() => router.push('/')}>
          <Text style={styles.finishedButtonText}>{t('gm.backHome')}</Text>
        </Pressable>
        <Pressable
          style={styles.finishedButtonSecondary}
          onPress={() => {
            if (initialConfig) {
              // Revancha real: misma configuraciÃ³n, semilla nueva
              newGame({ ...initialConfig, seed: `rematch-${Date.now()}` });
            } else {
              router.push({ pathname: '/(create)' } as never);
            }
          }}
        >
          <Text style={styles.finishedButtonText}>
            {initialConfig ? t('gm.rematch') : t('gm.playAgain')}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}


export function ZoneBoundary({ zone, children }: { zone: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <View style={{ padding: 12 }}>
          <Text style={[errorStyles.detail, { textAlign: 'left' }]}>
            {t('gm.zoneUnavailable', { zone, error: String(error?.message ?? error) })}
          </Text>
          <Pressable
            onPress={resetErrorBoundary}
            accessibilityRole="button"
            accessibilityLabel={t('gm.retryZone', { zone })}
            style={{ paddingVertical: 8, minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('gm.retry')}</Text>
          </Pressable>
        </View>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

export function GameErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [diagCopied, setDiagCopied] = useState(false);
  const saveRecovery = useGameStore((s) => s.saveGame);
  const hasGame = useGameStore((s) => s.gameState !== null);
  captureError(error, { screen: 'game' });
  return (
    <View style={errorStyles.container}>
      <Text style={errorStyles.title}>{t('gm.errorTitle')}</Text>
      <Text style={errorStyles.detail}>
        {t('gm.errorSaveIntact')}{"\n\n"}{String(error?.message ?? error)}
      </Text>
      {hasGame && (
        <Pressable
          style={errorStyles.button}
          onPress={() => saveRecovery(t('gm.recoverySaveName', { date: new Date().toLocaleString() }))}
          accessibilityRole="button"
        >
          <Text style={errorStyles.buttonText}>{t('gm.errorSaveRecovery')}</Text>
        </Pressable>
      )}
      <Pressable
        style={[errorStyles.button, errorStyles.secondary]}
        onPress={() => {
          void Clipboard.setStringAsync("NT4H error: " + String(error?.stack ?? error))
            .then(() => setDiagCopied(true));
        }}
        accessibilityRole="button"
      >
        <Text style={errorStyles.buttonText}>{diagCopied ? t('gm.diagCopied') : t('gm.diagCopy')}</Text>
      </Pressable>
      <Pressable style={[errorStyles.button, errorStyles.secondary]} onPress={reset} accessibilityRole="button">
        <Text style={errorStyles.buttonText}>{t('gm.retry')}</Text>
      </Pressable>
      <Pressable style={[errorStyles.button, errorStyles.secondary]} onPress={() => router.push('/')} accessibilityRole="button">
        <Text style={errorStyles.buttonText}>{t('gm.backHome')}</Text>
      </Pressable>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  detail: { color: colors.textMuted, fontSize: 12, marginBottom: 16, textAlign: 'center' },
  button: { backgroundColor: colors.primary, padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 8, minWidth: 200 },
  secondary: { backgroundColor: colors.surfaceRaised },
  buttonText: { color: colors.text, fontWeight: 'bold' },
});

