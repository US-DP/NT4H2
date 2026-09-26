/**
 * Tests del motor de logros y estadísticas del historial.
 */

import { describe, it, expect } from 'vitest';
import { evaluateAchievements } from '../lib/achievements';
import { computeStats, type GameHistoryEntry } from '../lib/gameHistory';

const g = (partial: Partial<GameHistoryEntry>): GameHistoryEntry => ({
  id: `h-${Math.random()}`,
  endedAt: Date.now(),
  mode: 'STANDARD',
  playerCount: 2,
  winners: ['hero.myrwen'],
  won: true,
  topScore: 10,
  contentScope: 'official',
  ...partial,
});

describe('computeStats — resumen oficial/custom', () => {
  it('separa partidas oficiales de las que usan contenido del Taller', () => {
    const entries = [g({}), g({ contentScope: 'custom' }), g({ topScore: 22, mode: 'SOLO' })];
    const s = computeStats(entries);
    expect(s.total).toBe(3);
    expect(s.official).toBe(2);
    expect(s.custom).toBe(1);
    expect(s.bestScore).toBe(22);
    expect(s.byMode.SOLO).toBe(1);
    expect(s.byMode.STANDARD).toBe(2);
  });
});

describe('evaluateAchievements', () => {
  it('historial vacío → todo bloqueado con progreso 0', () => {
    const achs = evaluateAchievements([]);
    expect(achs.every((a) => !a.unlocked && a.progress === 0)).toBe(true);
  });

  it('desbloquea logros por umbrales de recuento y puntuación', () => {
    const entries = Array.from({ length: 10 }, () => g({ topScore: 12 }));
    const achs = evaluateAchievements(entries);
    const byId = Object.fromEntries(achs.map((a) => [a.id, a]));
    expect(byId.first_game.unlocked).toBe(true);
    expect(byId.games_10.unlocked).toBe(true);
    expect(byId.games_25.progress).toBe(10);
    expect(byId.score_15.progress).toBe(12);
    expect(byId.score_30.progress).toBe(12); // 12 de 30 → en progreso
  });

  it('recuenta héroes distintos y favorito', () => {
    const entries = [
      g({ heroesPlayed: ['hero.myrwen', 'hero.rohk'] }),
      g({ heroesPlayed: ['hero.myrwen', 'hero.brigg'] }),
      g({ heroesPlayed: ['hero.myrwen'] }),
    ];
    const byId = Object.fromEntries(evaluateAchievements(entries).map((a) => [a.id, a]));
    expect(byId.hero_8.progress).toBe(3);
    expect(byId.hero_5.progress).toBe(3);
  });

  it('distinque solitario, multiclase, custom, escenarios e impecable', () => {
    const entries = [
      g({ mode: 'SOLO' }),
      g({ mode: 'SOLO' }),
      g({ mode: 'SOLO' }),
      g({ mode: 'MULTICLASS', contentScope: 'custom', scenariosCount: 2, flawless: true, won: true }),
    ];
    const byId = Object.fromEntries(evaluateAchievements(entries).map((a) => [a.id, a]));
    expect(byId.solo_3.unlocked).toBe(true);
    expect(byId.multiclass.unlocked).toBe(true);
    expect(byId.custom_1.unlocked).toBe(true);
    expect(byId.flawless.unlocked).toBe(true);
    expect(byId.scenarios_3.progress).toBe(1);
  });

  it('remontada: victoria tras 3+ derrotas seguidas (Terminator)', () => {
    let t = 0;
    const entries = [
      g({ won: false, endedAt: ++t }),
      g({ won: false, endedAt: ++t }),
      g({ won: false, endedAt: ++t }),
      g({ won: true, endedAt: ++t }),
    ];
    const byId = Object.fromEntries(evaluateAchievements(entries).map((a) => [a.id, a]));
    expect(byId.terminator.unlocked).toBe(true);
    // Solo 2 derrotas antes → no cuenta
    const short = [
      g({ won: false, endedAt: 1 }),
      g({ won: false, endedAt: 2 }),
      g({ won: true, endedAt: 3 }),
    ];
    const byId2 = Object.fromEntries(evaluateAchievements(short).map((a) => [a.id, a]));
    expect(byId2.terminator.unlocked).toBe(false);
  });

  it('monedas, heridas y escenario online (Witcher, Monty Python, LOTR)', () => {
    const entries = [
      g({ coinsEnd: 20, woundsEnd: 3 }),
      g({ online: true, playerCount: 3 }),
      g({ online: true, playerCount: 3 }),
      g({ online: true, playerCount: 3 }),
      g({ online: true, playerCount: 3 }),
      g({ online: true, playerCount: 3 }),
      g({ warlordsDefeated: 1 }),
      g({ yourScore: 35 }),
    ];
    const byId = Object.fromEntries(evaluateAchievements(entries).map((a) => [a.id, a]));
    expect(byId.witcher_coin.unlocked).toBe(true);
    expect(byId.flesh_wound.unlocked).toBe(true);
    expect(byId.fellowship.unlocked).toBe(true);
    expect(byId.no_pass.unlocked).toBe(true);
    expect(byId.plus_ultra.unlocked).toBe(true);
  });
});
