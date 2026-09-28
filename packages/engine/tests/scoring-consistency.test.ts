/**
 * Consistencia de puntuación final (spec §3.8).
 *
 * La fórmula está implementada DOS veces:
 *   - inline en phases/engine.ts → evento GAME_ENDED (scores + winnerId)
 *   - src/scoring.ts → computeFinalScore (usada por la UI de resultados)
 *
 * Si divergen, la UI muestra un ganador distinto al del motor. Este test
 * fija que ambas producen exactamente el mismo recuento y desempate en
 * estados de fin de partida variados.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { processPhases, resetPhaseSeq } from '../src/phases/engine.js';
import { resetInstanceCounter } from '../src/phases/setup.js';
import { computeFinalScore } from '../src/scoring.js';
import { loadCatalog } from '@nt4h/catalog';
import { makePlayer, makeGameState, resetTestCounters } from './fixtures/builders.js';
import type { GameState, PlayerState } from '@nt4h/schema';

const catalog = loadCatalog();

beforeEach(() => {
  resetInstanceCounter();
  resetPhaseSeq();
  resetTestCounters();
});

function endState(players: Record<string, PlayerState>): GameState {
  const state = makeGameState({
    phase: 'GAME_END_CHECK',
    activePlayerId: 'p1',
    battlefield: [],
    warlordRevealed: true,
    warlordDefeated: true,
    warlordsDefeatedCount: 1,
    players,
    playerOrder: Object.keys(players),
    eventLog: [{ type: 'WARLORD_REVEALED', warlordInstanceId: 'w', definitionId: 'warlord.gurdrug', seq: 0 }],
  });
  state.hordeDeck = [];
  return state;
}

function endGame(st: GameState) {
  const result = processPhases(st, new DeterministicRng('scoring-consistency'), catalog);
  const ev = result.events.find(e => e.type === 'GAME_ENDED');
  expect(ev, 'debe emitir GAME_ENDED').toBeDefined();
  return ev as { type: 'GAME_ENDED'; winnerId: string | null; scores: Record<string, number> };
}

describe('Consistencia §3.8 — computeFinalScore vs GAME_ENDED', () => {
  it('recuento idéntico con valores variados', () => {
    const players = {
      p1: makePlayer({ playerId: 'p1', glory: 5, coins: 7, wounds: 0, trophies: ['t1', 't2'] }),
      p2: makePlayer({ playerId: 'p2', glory: 4, coins: 3, wounds: 1, trophies: ['t3'] }),
      p3: makePlayer({ playerId: 'p3', glory: 0, coins: 0, wounds: 6, trophies: [] }),
    };
    const ev = endGame(endState(players));
    const computed = computeFinalScore(players);

    for (const s of computed.players) {
      expect(ev.scores[s.playerId], `score de ${s.playerId}`).toBe(s.total);
    }
    expect(ev.winnerId).toBe(computed.ranking[0].playerId);
    expect(computed.isTie).toBe(false);
    expect(computed.winners[0].playerId).toBe('p1');
  });

  it('desempate por trofeos: mismo ganador en ambas implementaciones', () => {
    const players = {
      p1: makePlayer({ playerId: 'p1', glory: 5, coins: 6, wounds: 1, trophies: ['t1'] }),
      p2: makePlayer({ playerId: 'p2', glory: 6, coins: 0, wounds: 0, trophies: ['t2', 't3'] }),
    };
    // Ambos = 7 (p1: 5+2+0; p2: 6+0+1) → gana el de más trofeos
    const ev = endGame(endState(players));
    const computed = computeFinalScore(players);
    expect(ev.scores.p1).toBe(7);
    expect(ev.scores.p2).toBe(7);
    expect(ev.winnerId).toBe(computed.ranking[0].playerId);
    expect(ev.winnerId).toBe('p2');
    expect(computed.isTie).toBe(false);
  });

  it('empate real (total y trofeos iguales): isTie lo refleja', () => {
    const players = {
      p1: makePlayer({ playerId: 'p1', glory: 4, coins: 0, wounds: 1, trophies: ['t1'] }),
      p2: makePlayer({ playerId: 'p2', glory: 4, coins: 0, wounds: 1, trophies: ['t2'] }),
    };
    const ev = endGame(endState(players));
    const computed = computeFinalScore(players);
    expect(computed.isTie).toBe(true);
    // El motor siempre nombra un winnerId (orden de jugadores); la UI
    // debe presentar empate — computeFinalScore lo expone con isTie.
    expect(ev.scores.p1).toBe(4);
    expect(ev.scores.p2).toBe(4);
    expect(computed.winners.map(w => w.playerId).sort()).toEqual(['p1', 'p2']);
  });

  it('propiedad: para cualquier reparto, los dos recuentos coinciden', () => {
    // Propiedad simple (sin fast-check): estados pseudo-aleatorios fijos
    // generados con RNG determinista del motor.
    const gen = new DeterministicRng('scoring-prop');
    for (let i = 0; i < 25; i++) {
      const players: Record<string, PlayerState> = {};
      const n = gen.nextInt(2, 4);
      for (let j = 0; j < n; j++) {
        const trophies = Array.from(
          { length: gen.nextInt(0, 4) },
          (_, k) => `t${j}-${k}`,
        ) as unknown as PlayerState['trophies'];
        players[`p${j}`] = makePlayer({
          playerId: `p${j}`,
          glory: gen.nextInt(0, 15),
          coins: gen.nextInt(0, 20),
          wounds: gen.nextInt(0, 4),
          trophies,
        });
      }
      const ev = endGame(endState(players));
      const computed = computeFinalScore(players);
      for (const s of computed.players) {
        expect(ev.scores[s.playerId], `iter ${i} score ${s.playerId}`).toBe(s.total);
      }
      // Desempate por trofeos: primer ranking = winnerId cuando no hay
      // empate total entre los dos primeros.
      if (!computed.isTie) {
        expect(ev.winnerId, `iter ${i} winner`).toBe(computed.ranking[0].playerId);
      }
    }
  });
});
