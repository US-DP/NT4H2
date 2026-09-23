/**
 * Nivel 1: Pruebas unitarias de calculos, movimientos, desgaste y objetivos.
 *
 * Verifica las funciones puras del motor:
 * - Calculo de fortaleza efectiva (modificadores, orcos, min 0)
 * - Calculo de dano efectivo (modificadores DAMAGE_BONUS, prevencion, escudos)
 * - Movimiento de cartas entre zonas (HAND, WEAR_PILE, REMOVED_FROM_GAME)
 * - Seleccion de objetivos (enemigo con max fortaleza, heroe con menos heridas)
 * - RNG determinista (misma semilla = misma secuencia)
 * - Expiracion de modificadores (END_OF_TURN, HORDE_ATTACK_END)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getEffectiveFortitude,
  effectiveFortitude,
  effectiveDamage,
  effectiveHordeDamage,
  effectiveEnemyDamage,
  expireModifiers,
  applyModifiers,
} from '../../src/modifiers/index.js';
import { DeterministicRng } from '../../src/rng/index.js';
import { makeEnemy, makePlayer, makeGameState, makeCard, makeCards, resetTestCounters } from '../fixtures/builders.js';
import type { Modifier } from '@nt4h/schema';

let modSeq = 0;
function makeMod(overrides: Partial<Modifier> = {}): Modifier {
  return {
    id: overrides.id ?? `test-mod-${++modSeq}`,
    sourceId: overrides.sourceId ?? 'test',
    layer: overrides.layer ?? 'DAMAGE_BONUS',
    timestamp: overrides.timestamp ?? 0,
    duration: overrides.duration ?? 'UNTIL_END_OF_TURN',
    amount: overrides.amount ?? 0,
    ...(overrides.filter ? { filter: overrides.filter } : {}),
    ...(overrides.targetId ? { targetId: overrides.targetId } : {}),
  };
}

describe('Nivel 1 - Calculos de fortaleza efectiva', () => {
  beforeEach(() => resetTestCounters());

  it('fortaleza base sin modificadores = baseFortitude', () => {
    const enemy = makeEnemy({ baseFortitude: 5 });
    const state = makeGameState({ battlefield: [enemy] });
    expect(getEffectiveFortitude(enemy, state)).toBe(5);
  });

  it('FORTITUDE_MODIFIERS se suman a la fortaleza base', () => {
    const mod = makeMod({ layer: 'FORTITUDE_MODIFIERS', amount: 2, duration: 'PERMANENT' });
    const enemy = makeEnemy({ baseFortitude: 3, modifiers: [mod] });
    const state = makeGameState({ battlefield: [enemy] });
    expect(getEffectiveFortitude(enemy, state)).toBe(5);
  });

  it('modificadores negativos reducen fortaleza', () => {
    const mod = makeMod({ layer: 'FORTITUDE_MODIFIERS', amount: -2, duration: 'PERMANENT' });
    const enemy = makeEnemy({ baseFortitude: 5, modifiers: [mod] });
    const state = makeGameState({ battlefield: [enemy] });
    expect(getEffectiveFortitude(enemy, state)).toBe(3);
  });

  it('D373: fortaleza nunca baja de 0 (Ruinas de Brunmar)', () => {
    const mod = makeMod({ layer: 'FORTITUDE_MODIFIERS', amount: -10, duration: 'PERMANENT' });
    const enemy = makeEnemy({ baseFortitude: 3, modifiers: [mod] });
    const state = makeGameState({ battlefield: [enemy] });
    expect(getEffectiveFortitude(enemy, state)).toBe(0);
  });

  it('Roghkiller: orcos reciben +1 fortaleza si orcFortitudeBonus > 0', () => {
    const enemy = makeEnemy({ baseFortitude: 3, isOrc: true });
    const state = makeGameState({ battlefield: [enemy], orcFortitudeBonus: 1 });
    expect(getEffectiveFortitude(enemy, state)).toBe(4);
  });

  it('Roghkiller: orcos no reciben bonus si orcFortitudeBonus = 0', () => {
    const enemy = makeEnemy({ baseFortitude: 3, isOrc: true });
    const state = makeGameState({ battlefield: [enemy], orcFortitudeBonus: 0 });
    expect(getEffectiveFortitude(enemy, state)).toBe(3);
  });

  it('Roghkiller: enemigos no-orcos no reciben bonus', () => {
    const enemy = makeEnemy({ baseFortitude: 3, isOrc: false });
    const state = makeGameState({ battlefield: [enemy], orcFortitudeBonus: 1 });
    expect(getEffectiveFortitude(enemy, state)).toBe(3);
  });

  it('effectiveFortitude (alias) y getEffectiveFortitude devuelven lo mismo', () => {
    const mod = makeMod({ layer: 'FORTITUDE_MODIFIERS', amount: 1, duration: 'PERMANENT' });
    const enemy = makeEnemy({ baseFortitude: 4, modifiers: [mod], isOrc: true });
    const state = makeGameState({ battlefield: [enemy], orcFortitudeBonus: 2 });
    expect(effectiveFortitude(enemy, state)).toBe(getEffectiveFortitude(enemy, state));
  });

  it('applyModifiers calcula effectiveFortitude para todos los enemigos', () => {
    const mod = makeMod({ layer: 'FORTITUDE_MODIFIERS', amount: 1, duration: 'PERMANENT' });
    const e1 = makeEnemy({ instanceId: 'e1', baseFortitude: 3, modifiers: [mod] });
    const e2 = makeEnemy({ instanceId: 'e2', baseFortitude: 5 });
    const state = makeGameState({ battlefield: [e1, e2] });
    const result = applyModifiers(state);
    expect(result.battlefield[0].effectiveFortitude).toBe(4);
    expect(result.battlefield[1].effectiveFortitude).toBe(5);
  });
});

describe('Nivel 1 - Calculos de dano efectivo', () => {
  beforeEach(() => resetTestCounters());

  it('dano base sin modificadores = baseDamage', () => {
    const player = makePlayer();
    expect(effectiveDamage(3, 'TestCard', player)).toBe(3);
  });

  it('DAMAGE_BONUS se suma al dano base', () => {
    const mod = makeMod({ layer: 'DAMAGE_BONUS', amount: 2, duration: 'UNTIL_END_OF_TURN' });
    const player = makePlayer({ modifiers: [mod] });
    expect(effectiveDamage(3, 'TestCard', player)).toBe(5);
  });

  it('DAMAGE_BONUS con filter.name solo aplica a esa carta', () => {
    const mod = makeMod({ layer: 'DAMAGE_BONUS', amount: 2, duration: 'UNTIL_END_OF_TURN', filter: { name: 'Espadazo' } });
    const player = makePlayer({ modifiers: [mod] });
    expect(effectiveDamage(3, 'Espadazo', player)).toBe(5);
    expect(effectiveDamage(3, 'OtraCarta', player)).toBe(3);
  });

  it('dano nunca baja de 0', () => {
    const mod = makeMod({ layer: 'DAMAGE_BONUS', amount: -10, duration: 'UNTIL_END_OF_TURN' });
    const player = makePlayer({ modifiers: [mod] });
    expect(effectiveDamage(3, 'TestCard', player)).toBe(0);
  });

  it('effectiveHordeDamage: prevencion reduce dano', () => {
    const player = makePlayer({ prevention: 2 });
    expect(effectiveHordeDamage(5, player)).toBe(3);
  });

  it('effectiveHordeDamage: escudos reducen dano', () => {
    const player = makePlayer({ shields: 3 });
    expect(effectiveHordeDamage(5, player)).toBe(2);
  });

  it('effectiveHordeDamage: prevencion + escudos se acumulan', () => {
    const player = makePlayer({ prevention: 2, shields: 2 });
    expect(effectiveHordeDamage(5, player)).toBe(1);
  });

  it('effectiveHordeDamage: damageCancellation anula todo el dano', () => {
    const player = makePlayer({ damageCancellation: true, prevention: 2, shields: 2 });
    expect(effectiveHordeDamage(5, player)).toBe(0);
  });

  it('effectiveHordeDamage: nunca baja de 0', () => {
    const player = makePlayer({ prevention: 10, shields: 10 });
    expect(effectiveHordeDamage(5, player)).toBe(0);
  });

  it('effectiveEnemyDamage: escudos absorben dano', () => {
    const enemy = makeEnemy();
    const player = makePlayer({ shields: 3 });
    expect(effectiveEnemyDamage(enemy, 5, player)).toBe(2);
  });

  it('effectiveEnemyDamage: damageDisabled del enemigo = 0', () => {
    const enemy = makeEnemy({ damageDisabled: true });
    const player = makePlayer();
    expect(effectiveEnemyDamage(enemy, 5, player)).toBe(0);
  });

  it('effectiveEnemyDamage: sin escudos = dano base', () => {
    const enemy = makeEnemy();
    const player = makePlayer({ shields: 0 });
    expect(effectiveEnemyDamage(enemy, 5, player)).toBe(5);
  });
});

describe('Nivel 1 - RNG determinista', () => {
  it('misma semilla produce misma secuencia', () => {
    const rng1 = new DeterministicRng('test-seed-1');
    const rng2 = new DeterministicRng('test-seed-1');
    const seq1 = [rng1.nextInt(0, 100), rng1.nextInt(0, 100), rng1.nextInt(0, 100)];
    const seq2 = [rng2.nextInt(0, 100), rng2.nextInt(0, 100), rng2.nextInt(0, 100)];
    expect(seq1).toEqual(seq2);
  });

  it('semillas diferentes producen secuencias diferentes', () => {
    const rng1 = new DeterministicRng('seed-a');
    const rng2 = new DeterministicRng('seed-b');
    const seq1 = [rng1.nextInt(0, 1000), rng1.nextInt(0, 1000)];
    const seq2 = [rng2.nextInt(0, 1000), rng2.nextInt(0, 1000)];
    expect(seq1).not.toEqual(seq2);
  });

  it('nextInt respeta rango [min, max] inclusive', () => {
    const rng = new DeterministicRng('range-test');
    for (let i = 0; i < 100; i++) {
      const n = rng.nextInt(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });

  it('nextInt lanza error si min > max', () => {
    const rng = new DeterministicRng('error-test');
    expect(() => rng.nextInt(10, 5)).toThrow();
  });

  it('shuffle preserva los elementos (permutacion)', () => {
    const rng = new DeterministicRng('shuffle-test');
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = rng.shuffle(arr);
    expect(shuffled.sort((a, b) => a - b)).toEqual(arr);
  });

  it('shuffle no muta el array original', () => {
    const rng = new DeterministicRng('shuffle-immut');
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    rng.shuffle(arr);
    expect(arr).toEqual(original);
  });

  it('shuffle con misma semilla es determinista', () => {
    const rng1 = new DeterministicRng('shuffle-det');
    const rng2 = new DeterministicRng('shuffle-det');
    const arr = [1, 2, 3, 4, 5, 6, 7];
    expect(rng1.shuffle(arr)).toEqual(rng2.shuffle(arr));
  });

  it('nextFloat esta en [0, 1)', () => {
    const rng = new DeterministicRng('float-test');
    for (let i = 0; i < 100; i++) {
      const f = rng.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('pick devuelve un elemento del array', () => {
    const rng = new DeterministicRng('pick-test');
    const arr = [10, 20, 30, 40, 50];
    const picked = rng.pick(arr);
    expect(arr).toContain(picked);
  });

  it('pick lanza error con array vacio', () => {
    const rng = new DeterministicRng('pick-empty');
    expect(() => rng.pick([])).toThrow();
  });

  it('serialize/deserialize restaura el estado exacto', () => {
    const rng1 = new DeterministicRng('serialize-test');
    // Avanzar el estado
    rng1.nextInt(0, 100);
    rng1.nextInt(0, 100);
    const serialized = rng1.serialize();
    const rng2 = DeterministicRng.deserialize(serialized);
    expect(rng1.nextInt(0, 1000)).toBe(rng2.nextInt(0, 1000));
  });
});

describe('Nivel 1 - Expiracion de modificadores', () => {
  beforeEach(() => resetTestCounters());

  it('UNTIL_END_OF_TURN expira al final del turno', () => {
    const mod = makeMod({ layer: 'DAMAGE_BONUS', amount: 2, duration: 'UNTIL_END_OF_TURN' });
    const player = makePlayer({ playerId: 'p1', modifiers: [mod] });
    const state = makeGameState({ players: { p1: player } });
    const result = expireModifiers(state, 'END_OF_TURN');
    expect(result.players.p1.modifiers).toHaveLength(0);
  });

  it('HORDE_ATTACK expira al final del ataque de la Horda', () => {
    const mod = makeMod({ layer: 'PREVENTION', amount: 2, duration: 'HORDE_ATTACK' });
    const player = makePlayer({ playerId: 'p1', modifiers: [mod] });
    const state = makeGameState({ players: { p1: player } });
    const result = expireModifiers(state, 'HORDE_ATTACK_END');
    expect(result.players.p1.modifiers).toHaveLength(0);
  });

  it('NEXT_HORDE_ATTACK expira al final del ataque de la Horda', () => {
    const mod = makeMod({ layer: 'DAMAGE_BONUS', amount: 1, duration: 'NEXT_HORDE_ATTACK' });
    const player = makePlayer({ playerId: 'p1', modifiers: [mod] });
    const state = makeGameState({ players: { p1: player } });
    const result = expireModifiers(state, 'HORDE_ATTACK_END');
    expect(result.players.p1.modifiers).toHaveLength(0);
  });

  it('PERMANENT no expira ni al final del turno ni del ataque', () => {
    const mod = makeMod({ layer: 'FORTITUDE_MODIFIERS', amount: 1, duration: 'PERMANENT' });
    const player = makePlayer({ playerId: 'p1', modifiers: [mod] });
    const state = makeGameState({ players: { p1: player } });
    let result = expireModifiers(state, 'END_OF_TURN');
    result = expireModifiers(result, 'HORDE_ATTACK_END');
    expect(result.players.p1.modifiers).toHaveLength(1);
  });

  it('HORDE_ATTACK_END resetea prevention, shields y damageCancellation', () => {
    const player = makePlayer({ playerId: 'p1', prevention: 3, shields: 2, damageCancellation: true });
    const state = makeGameState({ players: { p1: player } });
    const result = expireModifiers(state, 'HORDE_ATTACK_END');
    expect(result.players.p1.prevention).toBe(0);
    expect(result.players.p1.shields).toBe(0);
    expect(result.players.p1.damageCancellation).toBe(false);
  });

  it('HORDE_ATTACK_END resetea damageDisabled de enemigos', () => {
    const enemy = makeEnemy({ damageDisabled: true });
    const state = makeGameState({ battlefield: [enemy] });
    const result = expireModifiers(state, 'HORDE_ATTACK_END');
    expect(result.battlefield[0].damageDisabled).toBe(false);
  });

  it('WHILE_SOURCE_ACTIVE no se elimina automaticamente', () => {
    const mod = makeMod({ layer: 'FORTITUDE_MODIFIERS', amount: 1, duration: 'WHILE_SOURCE_ACTIVE', sourceId: 'roghkiller' });
    const enemy = makeEnemy({ modifiers: [mod] });
    const state = makeGameState({ battlefield: [enemy] });
    let result = expireModifiers(state, 'END_OF_TURN');
    result = expireModifiers(result, 'HORDE_ATTACK_END');
    expect(result.battlefield[0].modifiers).toHaveLength(1);
  });

  it('UNTIL_END_OF_TURN en enemigos expira al final del turno (Puerto de Eque)', () => {
    const mod = makeMod({ layer: 'ENEMY_OUTGOING_DAMAGE', amount: 1, duration: 'UNTIL_END_OF_TURN', sourceId: 'scenario.eque' });
    const enemy = makeEnemy({ modifiers: [mod] });
    const state = makeGameState({ battlefield: [enemy] });
    const result = expireModifiers(state, 'END_OF_TURN');
    expect(result.battlefield[0].modifiers).toHaveLength(0);
  });
});

describe('Nivel 1 - Movimiento de cartas entre zonas', () => {
  beforeEach(() => resetTestCounters());

  it('makeCard por defecto esta en HAND', () => {
    const card = makeCard();
    expect(card.zone).toBe('HAND');
  });

  it('makeCard con zone=WEAR_PILE', () => {
    const card = makeCard({ zone: 'WEAR_PILE' });
    expect(card.zone).toBe('WEAR_PILE');
  });

  it('makeCards genera N cartas con instanceIds unicos', () => {
    const cards = makeCards(5);
    const ids = cards.map(c => c.instanceId);
    expect(new Set(ids).size).toBe(5);
  });

  it('makeCard respeta definitionId y ownerId', () => {
    const card = makeCard({ definitionId: 'warrior.sword-strike', ownerId: 'p2' });
    expect(card.definitionId).toBe('warrior.sword-strike');
    expect(card.ownerId).toBe('p2');
  });
});

describe('Nivel 1 - Seleccion de objetivos (estados)', () => {
  beforeEach(() => resetTestCounters());

  it('battlefield vacio no tiene objetivos', () => {
    const state = makeGameState({ battlefield: [] });
    expect(state.battlefield).toHaveLength(0);
  });

  it('enemy con max fortitude es identificable', () => {
    const e1 = makeEnemy({ instanceId: 'e1', baseFortitude: 3 });
    const e2 = makeEnemy({ instanceId: 'e2', baseFortitude: 5 });
    const e3 = makeEnemy({ instanceId: 'e3', baseFortitude: 2 });
    const state = makeGameState({ battlefield: [e1, e2, e3] });
    const maxFort = Math.max(...state.battlefield.map(e => getEffectiveFortitude(e, state)));
    const candidates = state.battlefield.filter(e => getEffectiveFortitude(e, state) === maxFort);
    expect(maxFort).toBe(5);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].instanceId).toBe('e2');
  });

  it('empate en max fortitude produce multiples candidatos', () => {
    const e1 = makeEnemy({ instanceId: 'e1', baseFortitude: 5 });
    const e2 = makeEnemy({ instanceId: 'e2', baseFortitude: 5 });
    const state = makeGameState({ battlefield: [e1, e2] });
    const maxFort = Math.max(...state.battlefield.map(e => getEffectiveFortitude(e, state)));
    const candidates = state.battlefield.filter(e => getEffectiveFortitude(e, state) === maxFort);
    expect(candidates).toHaveLength(2);
  });

  it('heroe con menos heridas es identificable', () => {
    const p1 = makePlayer({ playerId: 'p1', wounds: 2 });
    const p2 = makePlayer({ playerId: 'p2', wounds: 0 });
    const p3 = makePlayer({ playerId: 'p3', wounds: 3 });
    const state = makeGameState({
      players: { p1, p2, p3 },
      playerOrder: ['p1', 'p2', 'p3'],
    });
    const players = Object.values(state.players);
    const minWounds = Math.min(...players.map(p => p.wounds));
    const candidates = players.filter(p => p.wounds === minWounds);
    expect(minWounds).toBe(0);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].playerId).toBe('p2');
  });

  it('empate en menos heridas produce multiples candidatos', () => {
    const p1 = makePlayer({ playerId: 'p1', wounds: 1 });
    const p2 = makePlayer({ playerId: 'p2', wounds: 1 });
    const state = makeGameState({
      players: { p1, p2 },
      playerOrder: ['p1', 'p2'],
    });
    const players = Object.values(state.players);
    const minWounds = Math.min(...players.map(p => p.wounds));
    const candidates = players.filter(p => p.wounds === minWounds);
    expect(candidates).toHaveLength(2);
  });
});
