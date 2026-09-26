/**
 * /(stats) — Estadísticas y logros.
 *
 * Resumen del historial local de partidas (oficial vs personalizado
 * separados), uso por héroe y logros desbloqueables. Todo derivado de
 * `nt4h-game-history` — nada sale del dispositivo.
 */

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Trophy, Lock, BarChart3 } from 'lucide-react-native';
import { loadHistory, computeStats, type GameHistoryEntry } from '../../lib/gameHistory';
import { evaluateAchievements, almostThere, type AchievementCategory } from '../../lib/achievements';
import { fetchCommunity, fetchLeaderboard, type CommunityStats, type LeaderboardEntryData } from '../../lib/communityStats';
import { useSettings } from '../../store/settingsStore';
import { loadCatalog } from '@nt4h/catalog';
import { useColors } from '../../lib/useTheme';
import { fontSize, type Colors } from '../../lib/theme';

const CATEGORY_IDS: (AchievementCategory | 'todas')[] = [
  'todas', 'progreso', 'heroes', 'reto', 'modos', 'taller',
];

const MODE_IDS = ['STANDARD', 'SOLO', 'MULTICLASS'] as const;

export default function StatsScreen() {
  const c = useColors();
  const styles = makeStyles(c);
  const router = useRouter();
  const { t } = useTranslation();
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [community, setCommunity] = useState<CommunityStats | null>(null);
  const shareStats = useSettings((s) => s.shareStats);
  // Clasificación pública opt-in (displayName → victorias)
  const [board, setBoard] = useState<LeaderboardEntryData[] | null>(null);
  const publicLeaderboard = useSettings((s) => s.publicLeaderboard);
  const setSetting = useSettings((s) => s.set);
  const displayName = useSettings((s) => s.displayName);

  useEffect(() => {
    void loadHistory().then(setHistory);
    void fetchCommunity().then(setCommunity);
    void fetchLeaderboard().then(setBoard);
  }, []);

  const stats = computeStats(history);
  const achievements = evaluateAchievements(history);
  const unlocked = achievements.filter((a) => a.unlocked).length;
  const [catFilter, setCatFilter] = useState<AchievementCategory | 'todas'>('todas');
  const almost = almostThere(achievements);
  const shownAch = catFilter === 'todas'
    ? achievements
    : achievements.filter((a) => a.category === catFilter);
  const catalog = loadCatalog();
  const heroName = (id: string) => catalog.byId.get(id)?.name ?? id;

  // Partidas por héroe
  const heroCounts = new Map<string, number>();
  for (const g of history) {
    for (const h of g.heroesPlayed ?? []) heroCounts.set(h, (heroCounts.get(h) ?? 0) + 1);
  }
  const heroRows = [...heroCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <ScrollView style={[styles.container, { backgroundColor: c.background }]} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('stats.back')}
          style={styles.backBtn}>
          <ChevronLeft size={20} color={c.text} />
        </Pressable>
        <Text style={styles.title}>{t('stats.title')}</Text>
      </View>

      {history.length === 0 ? (
        <View style={[styles.card, { borderColor: c.border }]}>
          <BarChart3 size={24} color={c.textMuted} />
          <Text style={[styles.cardTitle, { color: c.text }]}>{t('stats.emptyTitle')}</Text>
          <Text style={styles.meta}>{t('stats.emptyHint')}</Text>
        </View>
      ) : (
        <>
          {/* Resumen — oficial y personalizado siempre separados */}
          <View style={styles.summaryRow}>
            {[
              [t('stats.games'), String(stats.total)],
              [t('stats.wins'), String(history.filter((g) => g.won === true).length)],
              [t('stats.official'), String(stats.official)],
              [t('stats.custom'), String(stats.custom)],
              [t('stats.bestScore'), String(stats.bestScore)],
            ].map(([label, value]) => (
              <View key={label} style={[styles.statCard, { borderColor: c.border }]}>
                <Text style={[styles.statValue, { color: c.accent }]}>{value}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.meta}>
            {t('stats.byMode', { list: Object.entries(stats.byMode)
              .map(([m, count]) => `${MODE_IDS.includes(m as typeof MODE_IDS[number]) ? t(`stats.modes.${m}`) : m} ${count}`)
              .join(' · ') })}
          </Text>

          {/* Por héroe */}
          {heroRows.length > 0 && (
            <View style={[styles.card, { borderColor: c.border }]}>
              <Text style={[styles.cardTitle, { color: c.text }]}>{t('stats.heroesTitle')}</Text>
              {heroRows.slice(0, 8).map(([hero, count]) => {
                const pct = Math.round((count / heroRows[0][1]) * 100);
                return (
                  <View key={hero} style={styles.heroRow}>
                    <Text style={[styles.heroName, { color: c.text }]}>{heroName(hero)}</Text>
                    <View style={[styles.heroBarBg, { backgroundColor: c.surfaceRaised }]}>
                      <View style={[styles.heroBarFill, { backgroundColor: c.accent, width: `${pct}%` }]} />
                    </View>
                    <Text style={[styles.heroCount, { color: c.textMuted }]}>{count}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Próximos a desbloquear (≥60% de progreso) */}
          {almost.length > 0 && (
            <View style={[styles.card, { borderColor: c.info }]}>
              <Text style={[styles.cardTitle, { color: c.info }]}>
                {t('stats.almostTitle')}
              </Text>
              {almost.map((a) => (
                <Text key={a.id} style={{ color: c.text, fontSize: fontSize.micro }}>
                  {t(`ach.${a.id}.name`, { defaultValue: a.name })} — {a.progress}/{a.target} ({t(`ach.${a.id}.desc`, { defaultValue: a.desc })})
                </Text>
              ))}
            </View>
          )}

          {/* Logros */}
          <Text style={styles.sectionLabel} accessibilityRole="header">
            {t('stats.achievements', { unlocked, total: achievements.length })}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {CATEGORY_IDS.map((cat) => (
              <Pressable
                key={cat}
                onPress={() => setCatFilter(cat)}
                accessibilityRole="button"
                accessibilityState={{ selected: catFilter === cat }}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: catFilter === cat ? c.accent : c.border,
                  backgroundColor: catFilter === cat ? c.accent : c.surface,
                  minHeight: 36,
                }}
              >
                <Text style={{
                  color: catFilter === cat ? '#1a1a2e' : c.textMuted,
                  fontSize: fontSize.micro,
                  fontWeight: '700',
                }}>
                  {t(`stats.categories.${cat}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.achGrid}>
            {shownAch.map((a) => {
              const name = t(`ach.${a.id}.name`, { defaultValue: a.name });
              return (
              <View
                key={a.id}
                style={[
                  styles.achCard,
                  { borderColor: a.unlocked ? c.accent : c.border, opacity: a.unlocked ? 1 : 0.65 },
                ]}
                accessibilityLabel={`${name}: ${a.unlocked ? t('stats.unlocked') : `${a.progress} / ${a.target}`}`}
              >
                {a.unlocked
                  ? <Trophy size={20} color={c.accent} />
                  : <Lock size={18} color={c.textMuted} />}
                <Text style={[styles.achName, { color: c.text }]}>{name}</Text>
                <Text style={styles.achDesc}>{t(`ach.${a.id}.desc`, { defaultValue: a.desc })}</Text>
                <Text style={[styles.achProgress, { color: a.unlocked ? c.success : c.textMuted }]}>
                  {a.unlocked
                    ? t('stats.unlocked')
                    : t('stats.progress', { p: a.progress, t: a.target })
                      + (a.target - a.progress === 1 ? ` — ${t('stats.missingOne')}` : '')}
                </Text>
                {/* Rareza global (opt-in): % de informantes que lo tiene */}
                {a.unlocked && community && community.rarity[a.id] != null && (
                  <Text style={{ color: c.textMuted, fontSize: fontSize.micro }}>
                    {t('stats.rarity', { pct: Math.round(community.rarity[a.id] * 100) })}
                  </Text>
                )}
              </View>
            );})}
          </View>

          {community && community.reports > 0 && (
            <Text style={styles.meta}>
              {t('stats.communityReports', {
                n: community.reports,
                suffix: shareStats ? '' : t('stats.communityOptIn'),
              })}
            </Text>
          )}

          {/* Clasificación pública (opt-in): victorias por nombre visible */}
          <View style={[styles.headerRow, { marginTop: 8 }]}>
            <Text style={[styles.sectionLabel, { flex: 1 }]} accessibilityRole="header">
              {t('stats.leaderboard')}
            </Text>
            <Switch
              value={publicLeaderboard}
              onValueChange={(v) => setSetting({ publicLeaderboard: v })}
              accessibilityLabel={t('stats.leaderboardOptIn')}
            />
          </View>
          <Text style={styles.meta}>
            {publicLeaderboard
              ? t('stats.leaderboardOn', { name: displayName || t('stats.leaderboardNoName') })
              : t('stats.leaderboardOff')}
          </Text>
          {board && board.length > 0 && board.map((e, i) => (
            <View key={e.name} style={[styles.gameRow, { borderColor: c.border, flexDirection: 'row', gap: 8 }]}>
              <Text style={[styles.gameName, { color: c.textMuted, width: 26 }]}>#{i + 1}</Text>
              <Text style={[styles.gameName, { color: c.text, flex: 1 }]} numberOfLines={1}>{e.name}</Text>
              <Text style={[styles.meta, { color: c.accent }]}>
                {t('stats.leaderboardLine', { wins: e.wins, games: e.games })}
              </Text>
            </View>
          ))}

          {/* Últimas partidas */}
          <Text style={styles.sectionLabel} accessibilityRole="header">{t('stats.recent')}</Text>
          {history.slice(0, 10).map((g) => (
            <View key={g.id} style={[styles.gameRow, { borderColor: c.border }]}>
              <Text style={[styles.gameName, { color: c.text }]}>
                {g.winners.map(heroName).join(', ')} — {g.topScore} pts
              </Text>
              <Text style={styles.meta}>
                {new Date(g.endedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                {' · '}{MODE_IDS.includes(g.mode as typeof MODE_IDS[number]) ? t(`stats.modes.${g.mode}`) : g.mode}{' · '}{g.playerCount}P
                {g.contentScope === 'custom' ? ` · ${t('stats.customTag')}` : ''}
                {g.flawless ? ` · ${t('stats.flawlessTag')}` : ''}
              </Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  backBtn: { padding: 6, minHeight: 44, justifyContent: 'center' },
  title: { color: c.accent, fontSize: fontSize.section, fontWeight: 'bold' },
  summaryRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statCard: {
    flex: 1,
    minWidth: 70,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: fontSize.section, fontWeight: '800' },
  statLabel: { color: c.textMuted, fontSize: fontSize.micro },
  card: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  cardTitle: { fontSize: fontSize.detail, fontWeight: '700' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroName: { fontSize: fontSize.micro, width: 110 },
  heroBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  heroBarFill: { height: 8, borderRadius: 4 },
  heroCount: { fontSize: fontSize.micro, width: 26, textAlign: 'right' },
  sectionLabel: {
    color: c.textMuted,
    fontSize: fontSize.detail,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 8,
  },
  achGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  achCard: {
    flexBasis: '31%',
    flexGrow: 1,
    minWidth: 130,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 3,
  },
  achName: { fontSize: fontSize.micro, fontWeight: '700' },
  achDesc: { color: c.textMuted, fontSize: fontSize.micro },
  achProgress: { fontSize: fontSize.micro, fontWeight: '700' },
  gameRow: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
  gameName: { fontSize: fontSize.detail, fontWeight: '600' },
  meta: { color: c.textMuted, fontSize: fontSize.micro },
});
