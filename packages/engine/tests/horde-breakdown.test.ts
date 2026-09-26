/**
 * Paridad del desglose de la Horda: computeHordeAttackBreakdown debe
 * coincidir exactamente con lo que processPhases aplica al resolver
 * HORDE_ATTACK (la UI muestra este desglose — si diverge, mentimos).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { processPhases, resetPhaseSeq } from '../src/phases/engine.js';
import { computeHordeAttackBreakdown } from '../src/analysis/hordeBreakdown.js';
import { loadCatalog } from '@nt4h/catalog';

type Catalog = ReturnType<typeof loadCatalog>;
import { makeCards, makeEnemy, makePlayer, makeGameState, resetTestCounters } from './fixtures/builders.js';
import type { GameState } from '@nt4h/schema';

function freshRng(seed = 'horde-bd'): DeterministicRng {
  return new DeterministicRng(seed);
}

function hordeState(overrides: {
  capabilities?: Array<'MELEE' | 'RANGED' | 'EXPERTISE' | 'MAGIC'>;
  deck?: number;
  shields?: number;
  prevention?: number;
  cancellation?: boolean;
  enemies?: Parameters<typeof makeEnemy>[0][];
} = {}): GameState {
  const state = makeGameState({ phase: 'HORDE_ATTACK', activePlayerId: 'p1' });
  state.players.p1 = makePlayer({
    playerId: 'p1',
    capabilities: overrides.capabilities ?? [],
    abilityDeck: makeCards(overrides.deck ?? 12, { ownerId: 'p1' }),
    shields: overrides.shields ?? 0,
    prevention: overrides.prevention ?? 0,
    damageCancellation: overrides.cancellation ?? false,
  });
  state.battlefield = (overrides.enemies ?? [{}]).map((o, i) =>
    makeEnemy({ instanceId: `e${i}`, ...o }),
  );
  return state;
}

/** Cartas realmente perdidas por el evento CARDS_LOST del asalto */
function lostCards(events: { type: string; count?: number }[]): number {
  return events
    .filter((e) => e.type === 'CARDS_LOST')
    .reduce((s, e) => s + (e.count ?? 0), 0);
}

describe('Desglose de la Horda (paridad motor↔UI)', () => {
  let catalog: Catalog;
  beforeEach(() => {
    resetPhaseSeq();
    resetTestCounters();
    catalog = loadCatalog();
  });

  it('daño simple coincide con el desgaste aplicado', () => {
    const state = hordeState({ enemies: [{ baseFortitude: 3 }, { baseFortitude: 2 }] });
    const bd = computeHordeAttackBreakdown(state, catalog);
    expect(bd.subtotal).toBe(5);
    expect(bd.finalExhaustion).toBe(5);
    const r = processPhases(state, freshRng(), catalog);
    expect(lostCards(r.events)).toBe(5);
  });

  it('Anti-Magia: desglose refleja la reducción por enemigo', () => {
    const state = hordeState({
      capabilities: ['MAGIC'],
      enemies: [
        { baseFortitude: 4, specialIcons: ['ANTI_MAGIC'] },
        { baseFortitude: 2 },
      ],
    });
    const bd = computeHordeAttackBreakdown(state, catalog);
    const am = bd.enemyLines.find((l) => l.antiMagicReduction > 0);
    expect(am).toBeTruthy();
    expect(bd.finalExhaustion).toBe(4 + 2 - (am!.antiMagicReduction));
    const r = processPhases(state, freshRng(), catalog);
    expect(lostCards(r.events)).toBe(bd.finalExhaustion);
  });

  it('escudos y prevención: aplicados en el orden correcto', () => {
    const state = hordeState({
      shields: 2,
      prevention: 1,
      enemies: [{ baseFortitude: 6 }],
    });
    const bd = computeHordeAttackBreakdown(state, catalog);
    expect(bd.preventionApplied).toBe(1);
    expect(bd.shieldsApplied).toBe(2);
    expect(bd.finalExhaustion).toBe(3);
    const r = processPhases(state, freshRng(), catalog);
    expect(lostCards(r.events)).toBe(3);
  });

  it('damageCancellation anula todo el daño', () => {
    const state = hordeState({ cancellation: true, enemies: [{ baseFortitude: 9 }] });
    const bd = computeHordeAttackBreakdown(state, catalog);
    expect(bd.cancelled).toBe(true);
    expect(bd.finalExhaustion).toBe(0);
    const r = processPhases(state, freshRng(), catalog);
    expect(lostCards(r.events)).toBe(0);
  });

  it('enemigo con daño anulado no aporta', () => {
    const state = hordeState({
      enemies: [{ baseFortitude: 4, damageDisabled: true }, { baseFortitude: 1 }],
    });
    const bd = computeHordeAttackBreakdown(state, catalog);
    expect(bd.enemyLines[0].damageDisabled).toBe(true);
    expect(bd.enemyLines[0].finalDamage).toBe(0);
    expect(bd.finalExhaustion).toBe(1);
    const r = processPhases(state, freshRng(), catalog);
    expect(lostCards(r.events)).toBe(1);
  });
});
