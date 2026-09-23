/**
 * RNG determinista sembrado.
 *
 * Reglas:
 * - Misma semilla → misma secuencia de numeros.
 * - Estado serializable para snapshots y replay.
 * - Sin dependencias de Math.random() ni Date.now().
 * - Algoritmo: LCG (Linear Congruential Generator) con parametros de Numerical Recipes.
 */

import seedrandom from 'seedrandom';

export class DeterministicRng {
  private state: number;
  readonly seed: string;

  constructor(seed: string) {
    this.seed = seed;
    // Usar seedrandom solo para inicializar el estado inicial
    const sr = seedrandom(seed);
    this.state = Math.floor(sr() * 0x7fffffff) || 1;
  }

  private next(): number {
    // LCG con parametros de Numerical Recipes
    // X_{n+1} = (a * X_n + c) mod m
    const a = 1664525;
    const c = 1013904223;
    const m = 0x100000000; // 2^32
    this.state = (a * this.state + c) % m;
    return this.state / m;
  }

  /** Entero entre min y max inclusive */
  nextInt(min: number, max: number): number {
    if (min > max) throw new Error(`nextInt: min (${min}) > max (${max})`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float entre 0 (inclusive) y 1 (exclusive) */
  nextFloat(): number {
    return this.next();
  }

  /** Barajar array (Fisher-Yates) sin mutar el original */
  shuffle<T>(array: readonly T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /** Elegir un elemento aleatorio */
  pick<T>(array: readonly T[]): T {
    if (array.length === 0) throw new Error('pick: empty array');
    return array[this.nextInt(0, array.length - 1)];
  }

  /** Serializar estado para snapshots */
  serialize(): { seed: string; state: number } {
    return { seed: this.seed, state: this.state };
  }

  /** Restaurar desde snapshot */
  static deserialize(data: { seed: string; state: number }): DeterministicRng {
    // Validar el estado: un snapshot corrupto (NaN, fracción, negativo,
    // fuera de rango) produciría una secuencia rota en silencio
    if (
      typeof data.seed !== 'string'
      || !Number.isInteger(data.state)
      || data.state < 0
      || data.state >= 0x100000000
    ) {
      throw new Error('DeterministicRng.deserialize: invalid serialized state');
    }
    const rng = new DeterministicRng(data.seed);
    rng.state = data.state || 1;
    return rng;
  }
}
