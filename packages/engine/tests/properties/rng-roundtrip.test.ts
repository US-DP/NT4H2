/**
 * Propiedad: roundtrip de serialización del RNG.
 *
 * serialize() → deserialize() debe continuar la MISMA secuencia.
 * Protege contra el bug histórico donde el estado interno no se
 * restauraba correctamente y la partida cargada divergía.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DeterministicRng } from '../../src/rng/index.js';

describe('RNG serialize/deserialize roundtrip', () => {
  it('un RNG restaurado produce la misma secuencia que el original', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 0, max: 50 }),
        (seed, advances) => {
          const rng = new DeterministicRng(seed);
          for (let i = 0; i < advances; i++) rng.nextInt(0, 1_000_000);

          const restored = DeterministicRng.deserialize(rng.serialize());
          for (let i = 0; i < 10; i++) {
            expect(restored.nextInt(0, 1_000_000)).toBe(rng.nextInt(0, 1_000_000));
          }
        },
      ),
    );
  });

  it('serialize→deserialize es idempotente (estado canónico)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 20 }), (seed, advances) => {
        const rng = new DeterministicRng(seed);
        for (let i = 0; i < advances; i++) rng.nextInt(0, 100);
        const once = DeterministicRng.deserialize(rng.serialize());
        const twice = DeterministicRng.deserialize(once.serialize());
        expect(twice.serialize()).toEqual(once.serialize());
      }),
    );
  });
});
