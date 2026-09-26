/**
 * scoring — puntuación final de la partida multijugador (spec §3.8).
 *
 * Única fuente de verdad del cálculo: la UI no debe reimplementar la fórmula.
 *
 * Total = fichas de Gloria + 1 por cada 3 Monedas + 1 "Tenaz" si se termina
 * sin heridas. Desempate: más trofeos (enemigos derrotados).
 */

import type { PlayerState } from '@nt4h/schema';

export interface PlayerScore {
  playerId: string;
  heroId: string;
  /** Fichas de Gloria acumuladas durante la partida */
  glory: number;
  /** +1 por cada 3 Monedas (redondeo a la baja) */
  coinGlory: number;
  /** +1 Tenaz por terminar sin heridas */
  tenaz: number;
  total: number;
  trophies: number;
  breakdown: { label: string; value: number }[];
}

export interface FinalScore {
  players: PlayerScore[];
  /** Ranking de mayor a menor; empate resuelto por trofeos */
  ranking: PlayerScore[];
  /** Empate real si los primeros tienen total Y trofeos iguales */
  isTie: boolean;
  winners: PlayerScore[];
}

export function computeFinalScore(players: Record<string, PlayerState>): FinalScore {
  const scored: PlayerScore[] = Object.values(players).map((p) => {
    const coinGlory = Math.floor(p.coins / 3);
    const tenaz = p.wounds === 0 ? 1 : 0;
    const total = p.glory + coinGlory + tenaz;
    const breakdown = [
      { label: 'Gloria', value: p.glory },
      { label: `Monedas (${p.coins} ÷ 3)`, value: coinGlory },
      { label: 'Tenaz (sin heridas)', value: tenaz },
    ];
    return {
      playerId: p.playerId,
      heroId: p.heroId,
      glory: p.glory,
      coinGlory,
      tenaz,
      total,
      trophies: p.trophies.length,
      breakdown,
    };
  });

  const ranking = [...scored].sort(
    (a, b) => b.total - a.total || b.trophies - a.trophies,
  );
  const isTie =
    ranking.length > 1 &&
    ranking[0].total === ranking[1].total &&
    ranking[0].trophies === ranking[1].trophies;
  const winners = isTie
    ? ranking.filter((p) => p.total === ranking[0].total)
    : ranking.slice(0, 1);

  return { players: scored, ranking, isTie, winners };
}
