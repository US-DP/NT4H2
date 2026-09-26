/**
 * achievements — motor de logros derivados del historial de partidas.
 *
 * Las DEFINICIONES viven en `achievements.defs.ts` (datos puros:
 * añadir un logro no exige tocar este archivo — ver
 * docs/logros-y-estadisticas.md §7 para la taxonomía).
 *
 * Función pura sobre GameHistoryEntry[]: nada sale del dispositivo.
 * Las entradas antiguas sin los campos nuevos cuentan como 0.
 */

import type { GameHistoryEntry } from './gameHistory';
import { DEFS, type AchievementDef } from './achievements.defs';

export type { AchievementDef };
export { DEFS };

export type AchievementCategory = 'progreso' | 'heroes' | 'reto' | 'modos' | 'taller';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  category: AchievementCategory;
  target: number;
  progress: number;
  unlocked: boolean;
}

// ============================================================================
// Estadísticas computables — cada `stat` es una clave estable: cambiarla
// rompe el progreso acumulado (lección BGA: IDs estables para siempre).
// ============================================================================

const won = (g: GameHistoryEntry) =>
  g.won === true ||
  // Fallback para entradas antiguas sin `won`: victoria si el héroe del
  // jugador está entre los ganadores.
  (g.myHeroId != null && g.winners.includes(g.myHeroId));

const streakWins = (e: GameHistoryEntry[]) => {
  let n = 0;
  const sorted = [...e].sort((a, b) => b.endedAt - a.endedAt);
  for (const g of sorted) {
    if (!won(g)) break;
    n += 1;
  }
  return n;
};

const distinctHeroesWon = (e: GameHistoryEntry[]) => {
  const s = new Set<string>();
  for (const g of e) {
    if (!won(g)) continue;
    if (g.myHeroId) s.add(g.myHeroId);
    else for (const h of g.winners) s.add(h);
  }
  return s.size;
};

const heroesTried = (e: GameHistoryEntry[]) => {
  const s = new Set<string>();
  for (const g of e) for (const h of g.heroesPlayed ?? []) s.add(h);
  return s.size;
};

const mostPlayedHero = (e: GameHistoryEntry[]) => {
  const count = new Map<string, number>();
  for (const g of e) for (const h of g.heroesPlayed ?? [])
    count.set(h, (count.get(h) ?? 0) + 1);
  return Math.max(0, ...count.values());
};

const count = (e: GameHistoryEntry[], f: (g: GameHistoryEntry) => boolean) =>
  e.filter(f).length;

export const STATS: Record<string, (e: GameHistoryEntry[]) => number> = {
  games: (e) => e.length,
  wins: (e) => count(e, won),
  winStreak: streakWins,
  bestScore: (e) => Math.max(0, ...e.map((g) => g.topScore)),
  bestPersonalScore: (e) => Math.max(0, ...e.map((g) => g.yourScore ?? g.topScore)),
  heroesTried,
  heroesWon: distinctHeroesWon,
  mostPlayedHero,
  warlordsDefeated: (e) => e.reduce((a, g) => a + (g.warlordsDefeated ?? 0), 0),
  warlordsByMe: (e) => count(e, (g) => (g.warlordsByMe ?? 0) > 0),
  enemiesTotal: (e) => e.reduce((a, g) => a + (g.enemiesDefeated ?? 0), 0),
  marketBuysMax: (e) => Math.max(0, ...e.map((g) => g.marketBuys ?? 0)),
  soloGames: (e) => count(e, (g) => g.mode === 'SOLO'),
  soloWins: (e) => count(e, (g) => g.mode === 'SOLO' && won(g)),
  multiclassGames: (e) => count(e, (g) => g.mode === 'MULTICLASS'),
  customGames: (e) => count(e, (g) => g.contentScope === 'custom'),
  scenarioGames: (e) => count(e, (g) => (g.scenariosCount ?? 0) > 0),
  flawlessWins: (e) => count(e, (g) => g.flawless === true && won(g)),
  fastWins: (e) => count(e, (g) => won(g) && (g.turnsTaken ?? Infinity) <= 40),
  onlineWins: (e) => count(e, (g) => g.online === true && won(g) && g.playerCount >= 3),
  onlineGames: (e) => count(e, (g) => g.online === true && g.playerCount >= 3),
  coinsMax: (e) => Math.max(0, ...e.map((g) => g.coinsEnd ?? 0)),
  woundedWins: (e) => count(e, (g) => won(g) && (g.woundsEnd ?? 0) >= 3),
  warlordGamesWon: (e) => count(e, (g) => won(g) && (g.warlordsDefeated ?? 0) > 0),
  /** Victorias tras 3+ derrotas seguidas ("I'll be back") */
  comebackWins: (e) => {
    const sorted = [...e].sort((a, b) => a.endedAt - b.endedAt);
    let losses = 0;
    let n = 0;
    for (const g of sorted) {
      if (won(g)) {
        if (losses >= 3) n += 1;
        losses = 0;
      } else {
        losses += 1;
      }
    }
    return n;
  },
};

// ============================================================================
// Evaluación — el meta-logro (`_meta`) se resuelve tras evaluar el resto
// ============================================================================

/** Evalúa todos los logros contra el historial. Orden: desbloqueados
 *  primero, luego por porcentaje de progreso descendente. */
export function evaluateAchievements(entries: GameHistoryEntry[]): Achievement[] {
  const memo = new Map<string, number>();
  const statOf = (key: string) => {
    if (!memo.has(key)) memo.set(key, STATS[key]?.(entries) ?? 0);
    return memo.get(key) ?? 0;
  };
  const out: Achievement[] = DEFS.map((d) => {
    const v = d.stat === '_meta' ? 0 : statOf(d.stat);
    return {
      id: d.id,
      name: d.name,
      desc: d.desc,
      category: d.category,
      target: d.target,
      progress: Math.min(v, d.target),
      unlocked: v >= d.target,
    };
  });
  // Meta: desbloqueado cuando todos los demás lo están
  const meta = out.find((a) => a.id === 'completista');
  if (meta) {
    const others = out.filter((a) => a.id !== meta.id);
    const done = others.filter((a) => a.unlocked).length;
    meta.progress = Math.min(done / Math.max(1, others.length), 1) >= 1 ? 1 : 0;
    meta.unlocked = others.every((a) => a.unlocked);
  }
  return out.sort((a, b) =>
    Number(b.unlocked) - Number(a.unlocked) || b.progress / b.target - a.progress / a.target,
  );
}

/** Diff entre dos evaluaciones: los logros que se desbloquearon entre
 *  `before` y `after` (para el toast al terminar la partida). */
export function newlyUnlocked(before: Achievement[], after: Achievement[]): Achievement[] {
  const was = new Set(before.filter((a) => a.unlocked).map((a) => a.id));
  return after.filter((a) => a.unlocked && !was.has(a.id));
}

/** "Próximos a desbloquear": bloqueados con ≥60% de progreso. */
export function almostThere(achs: Achievement[]): Achievement[] {
  return achs.filter((a) => !a.unlocked && a.progress / a.target >= 0.6);
}
