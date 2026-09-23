/**
 * Nivel 7: Pruebas basadas en propiedades (fast-check).
 *
 * Verifica invariantes del motor con entradas aleatorias:
 * - RNG: misma semilla siempre produce la misma secuencia
 * - Fortaleza efectiva: nunca es negativa (min 0)
 * - Dano efectivo: nunca es negativo (min 0)
 * - Dano de Horda: nunca es negativo despues de prevencion
 * - Shuffle: preserva elementos (permutacion)
 * - Modificadores: la suma de modificadores es consistente
 * - Estados: el estado del juego es serializable
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { DeterministicRng } from '../../src/rng/index.js';
import {
  getEffectiveFortitude,
  effectiveDamage,
  effectiveHordeDamage,
  effectiveEnemyDamage,
} from '../../src/modifiers/index.js';
import { makeEnemy, makePlayer, makeGameState, resetTestCounters } from '../fixtures/builders.js';
import type { Modifier } from '@nt4h/schema';

let modSeq = 0;
function makeMod(layer: Modifier['layer'], amount: number, duration: Modifier['duration'] = 'PERMANENT'): Modifier {
  return {
    id: `pmod-${++modSeq}`,
    sourceId: 'test',
    layer,
    timestamp: modSeq,
    duration,
    amount,
  };
}

describe('Nivel 7 - Propiedades del RNG', () => {
  it('misma semilla produce misma secuencia (para cualquier semilla)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const rng1 = new DeterministicRng(seed);
        const rng2 = new DeterministicRng(seed);
        const seq1 = Array.from({ length: 10 }, () => rng1.nextInt(0, 1000));
        const seq2 = Array.from({ length: 10 }, () => rng2.nextInt(0, 1000));
        expect(seq1).toEqual(seq2);
      }),
    );
  });

  it('nextInt siempre esta en [min, max] para cualquier rango valido', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 101, max: 1000 }),
        (seed, min, max) => {
          const rng = new DeterministicRng(seed);
          for (let i = 0; i < 50; i++) {
            const n = rng.nextInt(min, max);
            expect(n).toBeGreaterThanOrEqual(min);
            expect(n).toBeLessThanOrEqual(max);
          }
        },
      ),
    );
  });

  it('nextFloat siempre esta en [0, 1)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const rng = new DeterministicRng(seed);
        for (let i = 0; i < 100; i++) {
          const f = rng.nextFloat();
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(1);
        }
      }),
    );
  });

  it('shuffle preserva elementos (permutacion) para cualquier array', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(fc.integer(), { minLength: 1, maxLength: 50 }),
        (seed, arr) => {
          const rng = new DeterministicRng(seed);
          const shuffled = rng.shuffle(arr);
          expect(shuffled.sort((a, b) => a - b)).toEqual(arr.sort((a, b) => a - b));
        },
      ),
    );
  });

  it('shuffle no muta el array original', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(fc.integer(), { minLength: 1, maxLength: 20 }),
        (seed, arr) => {
          const rng = new DeterministicRng(seed);
          const original = [...arr];
          rng.shuffle(arr);
          expect(arr).toEqual(original);
        },
      ),
    );
  });

  it('serialize/deserialize restaura el estado exacto', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const rng1 = new DeterministicRng(seed);
        // Avanzar estado
        rng1.nextInt(0, 100);
        rng1.nextInt(0, 100);
        const serialized = rng1.serialize();
        const rng2 = DeterministicRng.deserialize(serialized);
        expect(rng1.nextInt(0, 10000)).toBe(rng2.nextInt(0, 10000));
      }),
    );
  });
});

describe('Nivel 7 - Propiedades de fortaleza efectiva', () => {
  beforeEach(() => resetTestCounters());

  it('fortaleza efectiva nunca es negativa (para cualquier combinacion de modificadores)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.array(
          fc.record({
            amount: fc.integer({ min: -50, max: 50 }),
          }),
          { maxLength: 10 },
        ),
        (baseFortitude, mods) => {
          const modifiers = mods.map(m => makeMod('FORTITUDE_MODIFIERS', m.amount));
          const enemy = makeEnemy({ baseFortitude, modifiers });
          const state = makeGameState({ battlefield: [enemy] });
          const eff = getEffectiveFortitude(enemy, state);
          expect(eff).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('fortaleza efectiva con bonus de orco nunca es negativa', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 5 }),
        fc.boolean(),
        (baseFortitude, orcBonus, isOrc) => {
          const enemy = makeEnemy({ baseFortitude, isOrc });
          const state = makeGameState({ battlefield: [enemy], orcFortitudeBonus: orcBonus });
          const eff = getEffectiveFortitude(enemy, state);
          expect(eff).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('fortaleza efectiva = base + modificadores + bonus de orco (si >= 0)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: -5, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        (baseFortitude, modAmount, orcBonus, isOrc) => {
          const mod = makeMod('FORTITUDE_MODIFIERS', modAmount);
          const enemy = makeEnemy({ baseFortitude, modifiers: [mod], isOrc });
          const state = makeGameState({ battlefield: [enemy], orcFortitudeBonus: orcBonus });
          const eff = getEffectiveFortitude(enemy, state);
          const expected = Math.max(0, baseFortitude + modAmount + (isOrc ? orcBonus : 0));
          expect(eff).toBe(expected);
        },
      ),
    );
  });
});

describe('Nivel 7 - Propiedades de dano efectivo', () => {
  beforeEach(() => resetTestCounters());

  it('dano efectivo nunca es negativo (para cualquier base + modificadores)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.array(
          fc.record({
            amount: fc.integer({ min: -50, max: 50 }),
          }),
          { maxLength: 10 },
        ),
        (baseDamage, mods) => {
          const modifiers = mods.map(m => makeMod('DAMAGE_BONUS', m.amount));
          const player = makePlayer({ modifiers });
          const dmg = effectiveDamage(baseDamage, 'TestCard', player);
          expect(dmg).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('dano de Horda nunca es negativo despues de prevencion', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        fc.boolean(),
        (baseDamage, prevention, shields, cancellation) => {
          const player = makePlayer({ prevention, shields, damageCancellation: cancellation });
          const dmg = effectiveHordeDamage(baseDamage, player);
          expect(dmg).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('dano de enemigo nunca es negativo despues de escudos', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 10 }),
        fc.boolean(),
        (baseDamage, shields, damageDisabled) => {
          const enemy = makeEnemy({ damageDisabled });
          const player = makePlayer({ shields });
          const dmg = effectiveEnemyDamage(enemy, baseDamage, player);
          expect(dmg).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('damageCancellation = true siempre produce dano 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (baseDamage, prevention, shields) => {
          const player = makePlayer({ damageCancellation: true, prevention, shields });
          expect(effectiveHordeDamage(baseDamage, player)).toBe(0);
        },
      ),
    );
  });

  it('damageDisabled = true siempre produce dano 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (baseDamage) => {
        const enemy = makeEnemy({ damageDisabled: true });
        const player = makePlayer();
        expect(effectiveEnemyDamage(enemy, baseDamage, player)).toBe(0);
      }),
    );
  });
});

describe('Nivel 7 - Propiedades de estados', () => {
  it('makeGameState produce estados con campos obligatorios validos', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 10 }), { maxLength: 5 }),
        (fortitudes) => {
          resetTestCounters();
          const enemies = fortitudes.map((f, i) => makeEnemy({ instanceId: `e${i}`, baseFortitude: f }));
          const state = makeGameState({ battlefield: enemies });
          expect(state.phase).toBeDefined();
          expect(state.players).toBeDefined();
          expect(state.playerOrder).toBeDefined();
          expect(state.battlefield.length).toBe(enemies.length);
          expect(state.rngState).toBeDefined();
        },
      ),
    );
  });

  it('el numero de enemigos en battlefield es consistente', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (n) => {
        resetTestCounters();
        const enemies = Array.from({ length: n }, (_, i) => makeEnemy({ instanceId: `e${i}` }));
        const state = makeGameState({ battlefield: enemies });
        expect(state.battlefield.length).toBe(n);
      }),
    );
  });
});
