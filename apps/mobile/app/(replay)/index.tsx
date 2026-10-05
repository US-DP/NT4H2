/**
 * Pantalla Replay — visionado navegable de una partida guardada.
 *
 * El motor reconstruye el estado en cada paso (replay bit-idéntico con
 * comandos truncados). Vista de solo lectura: mini-tablero con jugadores,
 * campo de batalla y los últimos eventos del paso.
 *
 * No toca gameState del store — la partida activa queda intacta.
 */

import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  replayInit,
  replayStep,
  getEffectiveFortitude,
  setSeq,
  currentSeq,
  DeterministicRng,
  type ReplayEnvelope,
  type ReplayCursor,
} from '@nt4h/engine';
import { loadCatalog } from '@nt4h/catalog';
import type { GameState } from '@nt4h/schema';
import { useGameStore, type SavedGame } from '../../store/gameStore';
import { AppNav, useNavSidebarWidth } from '../../components/AppNav';
import { NtButton } from '../../components/ui/NtButton';
import { NtBadge } from '../../components/ui/NtBadge';
import { EmptyState } from '../../components/EmptyState';
import { PHASE_LABELS } from '../../lib/phaseLabels';
import { eventToHistoryEntry } from '../(game)/_shared/eventHistory';
import { useColors, useFs } from '../../lib/useTheme';
import { spacing, radius, fontSize } from '../../lib/theme';

export default function ReplayScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const fs = useFs();
  const navWidth = useNavSidebarWidth();
  const params = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();

  const savedGames = useGameStore((s) => s.savedGames);
  const loadSavedGames = useGameStore((s) => s.loadSavedGames);
  useEffect(() => { loadSavedGames(); }, [loadSavedGames]);

  const [selectedId, setSelectedId] = useState<string | null>(params.id ?? null);
  const saved: SavedGame | undefined = savedGames.find((g) => g.id === selectedId);

  const envelope: ReplayEnvelope | null = useMemo(() => {
    const env = saved?.envelope as ReplayEnvelope | undefined;
    if (!env?.commands || !env.initialState?.state) return null;
    return env;
  }, [saved]);

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  const total = envelope?.commands.length ?? 0;
  useEffect(() => { setStep(0); setPlaying(false); }, [selectedId]);

  // Reconstrucción incremental con checkpoints: replay desde cero por
  // cada paso era O(n²) en un visionado completo — aquí solo se calcula
  // el delta (rng + seq se restauran desde el checkpoint anterior).
  const catalog = useMemo(() => loadCatalog(), []);
  const replayCtx = useRef<{
    cursor: ReplayCursor;
    checkpoints: { state: GameState; rngState: number; seq: number }[];
    envelope: ReplayEnvelope;
  } | null>(null);
  const state: GameState | null = useMemo(() => {
    if (!envelope) return null;
    try {
      if (!replayCtx.current || replayCtx.current.envelope !== envelope) {
        const cursor = replayInit(envelope);
        replayCtx.current = {
          envelope,
          cursor,
          checkpoints: [{
            state: cursor.state,
            rngState: cursor.rng.serialize().state,
            seq: currentSeq(),
          }],
        };
      }
      const ctx = replayCtx.current;
      const ck = ctx.checkpoints;
      const j = Math.min(step, ck.length - 1);
      const base = ck[j];
      // Truncar lo que haya más allá del checkpoint base: re-ejecutar
      // desde él puede divergir si el RNG ya avanzó (ids/seq).
      ck.length = j + 1;
      ctx.cursor.state = base.state;
      ctx.cursor.rng = DeterministicRng.deserialize({
        seed: envelope.initialState.seed,
        state: base.rngState,
      });
      setSeq(base.seq);
      for (let i = j; i < step; i++) {
        const st = replayStep(ctx.cursor, envelope.commands[i], catalog);
        ck.push({
          state: st,
          rngState: ctx.cursor.rng.serialize().state,
          seq: currentSeq(),
        });
      }
      return ctx.cursor.state;
    } catch {
      return null;
    }
  }, [envelope, step, catalog]);

  // Auto-avance
  useEffect(() => {
    if (!playing || step >= total) { setPlaying(false); return; }
    const timer = setTimeout(() => setStep((s) => s + 1), 900);
    return () => clearTimeout(timer);
  }, [playing, step, total]);

  const players = state ? Object.values(state.players) : [];
  // Últimos eventos traducidos con el mismo mapeador que el historial
  // de la partida en vivo — el replay enseñaba `SCENARIO_EFFECTS_
  // APPLIED` en crudo (nombres internos SCREAMING_SNAKE del motor).
  const lastEventLines = useMemo(() => {
    const log = state?.eventLog ?? [];
    const defs = new Map<string, string>();
    for (const e of log) {
      const ev = e as { cardInstanceId?: string; cardDefinitionId?: string };
      if (ev.cardInstanceId && ev.cardDefinitionId) {
        defs.set(ev.cardInstanceId, ev.cardDefinitionId);
      }
    }
    return log.slice(-6).map((e) => {
      const h = eventToHistoryEntry(
        e, state?.turnNumber ?? 0, catalog, t, defs);
      return h
        ? `#${e.seq} ${h.actor} · ${[h.action, h.card, h.result]
            .filter(Boolean).join(' — ')}`
        : `#${e.seq} ${e.type}`;
    });
  }, [state, catalog, t]);

  return (
    <View style={{ flex: 1 }}>
      <AppNav />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[styles.content, { marginLeft: navWidth }]}
      >
        <Text style={[styles.title, { color: colors.accent, fontSize: fs(fontSize.title) }]}
          accessibilityRole="header">
          {t('replay.title')}
        </Text>

        {!selectedId ? (
          <View style={styles.section}>
            {savedGames.length === 0 && (
              <EmptyState
                title={t('replay.none')}
                description={t('replay.noneHint')}
                primaryAction={{ label: t('replay.ctaPlay'), onPress: () => router.push('/(play)') }}
              />
            )}
            {savedGames.map((g) => (
              <Pressable
                key={g.id}
                style={[styles.gameRow, { backgroundColor: colors.surface }]}
                onPress={() => setSelectedId(g.id)}
                accessibilityRole="button"
                accessibilityLabel={t('replay.openA11y', { name: g.name })}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>{g.name}</Text>
                <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.micro) }}>
                  {new Date(g.savedAt).toLocaleString()} · {(g.envelope as ReplayEnvelope)?.commands?.length ?? 0} {t('replay.commands')}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : !envelope ? (
          <View style={styles.section}>
            <Text style={{ color: colors.textMuted }}>{t('replay.noEnvelope')}</Text>
            <NtButton label={t('replay.back')} variant="secondary" size="sm" onPress={() => setSelectedId(null)} />
          </View>
        ) : (
          <View>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: fs(fontSize.body) }}>
              {saved?.name}
            </Text>

            {/* Controles: ‹ › slider · ▶ */}
            <View style={styles.controls}>
              <NtButton label="⏮" variant="secondary" size="sm" onPress={() => { setPlaying(false); setStep(0); }} />
              <NtButton label="◀" variant="secondary" size="sm" onPress={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} />
              <NtButton
                label={playing ? '⏸' : '▶'}
                variant="primary" size="sm"
                onPress={() => setPlaying((p) => !p)}
              />
              <NtButton label="▶" variant="secondary" size="sm" onPress={() => { setPlaying(false); setStep((s) => Math.min(total, s + 1)); }} />
              <NtButton label="⏭" variant="secondary" size="sm" onPress={() => { setPlaying(false); setStep(total); }} />
            </View>
            {/* Slider web nativo; en nativo quedan los botones de paso */}
            {Platform.OS === 'web' &&
              createElement('input', {
                type: 'range',
                min: 0,
                max: total,
                value: step,
                onChange: (e: { target: { value: string } }) => {
                  setPlaying(false);
                  setStep(Number(e.target.value));
                },
                style: { width: '100%', accentColor: colors.accent },
                'aria-label': t('replay.sliderA11y'),
              })}
            <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.detail), textAlign: 'center' }}>
              {t('replay.step', { n: step, total })}
            </Text>

            {state && (
              <View style={[styles.board, { borderColor: colors.border }]}>
                <View style={styles.boardHead}>
                  <NtBadge label={`${t('replay.turn', { n: state.turnNumber })} · ${PHASE_LABELS[state.phase] ?? state.phase}`} tone="accent" />
                </View>

                {players.map((p) => (
                  <View key={p.playerId} style={styles.playerRow}>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>
                      {catalog.byId.get(p.heroId)?.name ?? p.heroId}
                      {state.activePlayerId === p.playerId ? ' ▶' : ''}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.detail) }}>
                      {t('replay.playerLine', {
                        wounds: p.wounds, coins: p.coins, glory: p.glory,
                        hand: p.hand.length, deck: p.abilityDeck.length,
                      })}
                    </Text>
                  </View>
                ))}

                {state.battlefield.length > 0 && (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={{ color: colors.accent, fontWeight: '700', fontSize: fs(fontSize.detail) }}>
                      {t('replay.battlefield')}
                    </Text>
                    {state.battlefield.map((e) => (
                      <Text key={e.instanceId} style={{ color: colors.textMuted, fontSize: fs(fontSize.detail) }}>
                        • {catalog.byId.get(e.definitionId)?.name ?? e.definitionId} — {t('replay.enemyLine', {
                          wounds: e.wounds, fortitude: getEffectiveFortitude(e, state),
                        })}
                      </Text>
                    ))}
                  </View>
                )}

                {lastEventLines.length > 0 && (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={{ color: colors.accent, fontWeight: '700', fontSize: fs(fontSize.detail) }}>
                      {t('replay.lastEvents')}
                    </Text>
                    {lastEventLines.map((line, i) => (
                      <Text key={i} style={{ color: colors.textMuted, fontSize: fs(fontSize.micro) }}>
                        {line}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}

            <NtButton label={t('replay.back')} variant="secondary" size="sm" onPress={() => setSelectedId(null)} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, maxWidth: 900, width: '100%', alignSelf: 'center' },
  title: { fontWeight: '800', marginBottom: spacing.lg },
  section: { gap: spacing.sm },
  gameRow: { padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.xs, gap: 2 },
  controls: { flexDirection: 'row', gap: spacing.xs, marginVertical: spacing.sm, flexWrap: 'wrap' },
  board: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginVertical: spacing.md, gap: spacing.xs },
  boardHead: { marginBottom: spacing.xs },
  playerRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm },
});
