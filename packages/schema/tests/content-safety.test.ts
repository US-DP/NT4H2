/**
 * Validadores de contenido del Taller (schema/content.ts) — la barrera
 * que impide publicar cartas/mazos malformados o patológicos.
 *
 * validateCardEffects: límites anti-DoS (nivel superior, profundidad,
 * presupuesto de nodos), formas de control obligatorias (REPEAT con
 * max y efectos, CHOOSE_ONE ≥2 opciones sin elecciones anidadas) y
 * patrones patológicos de bucle (recuperarse + rejugarse).
 *
 * validateDeck: tamaño, tipos, clases, tope de copias agregado por
 * definición y mínimo multiclase.
 */

import { describe, it, expect } from 'vitest';
import {
  validateCardEffects, validateDeck, resolveDeckEntries,
  MAX_TOP_LEVEL_EFFECTS, MAX_EFFECT_DEPTH, MAX_EFFECT_NODES,
} from '../src/content.js';
import type { CardDefinition, CardEffect, DeckDefinition } from '../src/card.js';

const GAIN1: CardEffect = { type: 'GAIN_GLORY', amount: { kind: 'CONSTANT', value: 1 } };
const DMG: CardEffect = { type: 'DEAL_DAMAGE', amount: { kind: 'CONSTANT', value: 1 }, target: { kind: 'SELECTED_ENEMY' } };

function cond(effects: CardEffect[]): CardEffect {
  return { type: 'CONDITIONAL', condition: { kind: 'ALWAYS' }, then: effects } as CardEffect;
}

describe('validateCardEffects — límites de seguridad', () => {
  it('acepta efectos normales', () => {
    expect(validateCardEffects([GAIN1, DMG])).toEqual([]);
  });

  it(`rechaza más de ${MAX_TOP_LEVEL_EFFECTS} efectos de nivel superior`, () => {
    const fx = Array(MAX_TOP_LEVEL_EFFECTS + 1).fill(GAIN1);
    expect(validateCardEffects(fx).join(' ')).toContain('Demasiados efectos');
  });

  it(`rechaza anidado > ${MAX_EFFECT_DEPTH}`, () => {
    let inner: CardEffect[] = [GAIN1];
    for (let i = 0; i < MAX_EFFECT_DEPTH + 1; i++) inner = [cond(inner)];
    expect(validateCardEffects(inner).join(' ')).toContain('Anidado');
  });

  it(`acepta anidado en el límite (${MAX_EFFECT_DEPTH})`, () => {
    let inner: CardEffect[] = [GAIN1];
    for (let i = 0; i < MAX_EFFECT_DEPTH - 1; i++) inner = [cond(inner)];
    expect(validateCardEffects(inner)).toEqual([]);
  });

  it(`rechaza más de ${MAX_EFFECT_NODES} nodos totales`, () => {
    const fx = Array(MAX_EFFECT_NODES + 1).fill(GAIN1);
    // Nota: top-level máx es 32, así que repartimos entre dos cartas no
    // sirve — debe exceder por nodes, no por top-level. Usamos REPEAT
    // anidados con muchos hijos dentro del límite de profundidad.
    const deep = cond(Array(40).fill(GAIN1));
    const wide = [cond([deep, deep]), cond([deep, deep])]; // 2 + 4 + 160 = 166 nodos
    const errors = validateCardEffects(wide.length <= MAX_TOP_LEVEL_EFFECTS ? wide : fx);
    expect(errors.join(' ')).toContain('compleja');
  });

  it('rechaza REPEAT sin max o con max < 1', () => {
    const noMax = [{ type: 'REPEAT', times: { kind: 'CONSTANT', value: 3 }, effects: [GAIN1] } as unknown as CardEffect];
    expect(validateCardEffects(noMax).join(' ')).toContain('limite maximo');

    const badMax = [{ type: 'REPEAT', times: { kind: 'CONSTANT', value: 3 }, max: 0, effects: [GAIN1] } as unknown as CardEffect];
    expect(validateCardEffects(badMax).join(' ')).toContain('limite maximo');
  });

  it('rechaza REPEAT sin efectos internos', () => {
    const empty = [{ type: 'REPEAT', times: { kind: 'CONSTANT', value: 2 }, max: 5, effects: [] } as unknown as CardEffect];
    expect(validateCardEffects(empty).join(' ')).toContain('sin efectos internos');
  });

  it('acepta REPEAT bien formado', () => {
    const ok = [{ type: 'REPEAT', times: { kind: 'CONSTANT', value: 2 }, max: 5, effects: [GAIN1] } as unknown as CardEffect];
    expect(validateCardEffects(ok)).toEqual([]);
  });

  it('rechaza CHOOSE_ONE con menos de 2 opciones', () => {
    const one = [{ type: 'CHOOSE_ONE', options: [{ effects: [GAIN1] }] } as unknown as CardEffect];
    expect(validateCardEffects(one).join(' ')).toContain('al menos 2 opciones');

    const none = [{ type: 'CHOOSE_ONE', options: [] } as unknown as CardEffect];
    expect(validateCardEffects(none).join(' ')).toContain('al menos 2 opciones');
  });

  it('rechaza CHOOSE_ONE con otra elección dentro de una rama', () => {
    const nested = [{
      type: 'CHOOSE_ONE',
      options: [
        { effects: [{ type: 'CHOOSE_ONE', options: [{ effects: [GAIN1] }, { effects: [DMG] }] }] },
        { effects: [GAIN1] },
      ],
    } as unknown as CardEffect[]];
    expect(validateCardEffects(nested).join(' ')).toContain('no puede contener otra eleccion');
  });

  it('rechaza RECOVER_THIS_CARD + PLAY_IMMEDIATELY (bucle potencial)', () => {
    const loop = [
      { type: 'RECOVER_THIS_CARD' },
      { type: 'PLAY_IMMEDIATELY' },
    ] as unknown as CardEffect[];
    expect(validateCardEffects(loop).join(' ')).toContain('bucle potencial');
  });

  it('rechaza más de 3 REPEAT (complejidad combinatoria)', () => {
    const r = () => ({ type: 'REPEAT', times: { kind: 'CONSTANT', value: 1 }, max: 1, effects: [GAIN1] });
    const fx = [r(), r(), r(), r()] as unknown as CardEffect[];
    expect(validateCardEffects(fx).join(' ')).toContain('repeticiones');
  });
});

// === validateDeck ===

function ability(id: string, cls: string, copies = 2): CardDefinition {
  return {
    id, name: id, type: 'ABILITY', heroClass: cls as CardDefinition['heroClass'],
    copies, effects: [GAIN1],
  } as CardDefinition;
}

function deck(cardEntries: { cardDefinitionId: string; copies: number }[], heroClassIds: string[], deckSize = 15): DeckDefinition {
  return { id: 'd1', name: 'Test', cardEntries, heroClassIds, deckSize } as DeckDefinition;
}

describe('validateDeck — reglas de mazo', () => {
  const byId = new Map<string, CardDefinition>([
    ['a1', ability('a1', 'EXPLORER', 4)],
    ['a2', ability('a2', 'EXPLORER', 4)],
    ['a3', ability('a3', 'EXPLORER', 3)],
    ['a4', ability('a4', 'EXPLORER', 4)],
    ['w1', ability('w1', 'WARRIOR', 4)],
    ['w2', ability('w2', 'WARRIOR', 4)],
    ['w3', ability('w3', 'WARRIOR', 4)],
    ['item', { id: 'item', name: 'Item', type: 'MARKET', copies: 1 } as CardDefinition],
  ]);

  it('acepta un mazo monoclase válido de 15', () => {
    const d = deck([
      { cardDefinitionId: 'a1', copies: 4 },
      { cardDefinitionId: 'a2', copies: 4 },
      { cardDefinitionId: 'a3', copies: 3 },
      { cardDefinitionId: 'a4', copies: 4 },
    ], ['EXPLORER']);
    const r = validateDeck(d, byId);
    expect(r.ok, r.errors.join('; ')).toBe(true);
  });

  it('rechaza tamaño incorrecto', () => {
    const d = deck([{ cardDefinitionId: 'a1', copies: 2 }], ['EXPLORER']);
    expect(validateDeck(d, byId).errors.join(' ')).toContain('deben ser 15');
  });

  it('rechaza carta desconocida y no-ABILITY', () => {
    const d = deck([
      { cardDefinitionId: 'ghost', copies: 5 },
      { cardDefinitionId: 'item', copies: 1 },
    ], ['EXPLORER']);
    const errs = validateDeck(d, byId).errors.join(' | ');
    expect(errs).toContain('Carta desconocida');
    expect(errs).toContain('no es una carta de Habilidad');
  });

  it('rechaza clase incompatible en monoclase', () => {
    const d = deck([
      { cardDefinitionId: 'a1', copies: 4 },
      { cardDefinitionId: 'w1', copies: 4 }, // guerrera en mazo explorador
      { cardDefinitionId: 'a2', copies: 4 },
      { cardDefinitionId: 'a3', copies: 3 },
    ], ['EXPLORER']);
    const errs = validateDeck(d, byId).errors.join(' | ');
    expect(errs).toContain('incompatible');
  });

  it('el tope de copias agrega entre entradas duplicadas', () => {
    // a1 permite 4 copias; dos entradas de 3 = 6 > 4
    const d = deck([
      { cardDefinitionId: 'a1', copies: 3 },
      { cardDefinitionId: 'a1', copies: 3 },
      { cardDefinitionId: 'a2', copies: 4 },
      { cardDefinitionId: 'a3', copies: 3 },
      { cardDefinitionId: 'a4', copies: 2 },
    ], ['EXPLORER']);
    expect(validateDeck(d, byId).errors.join(' | ')).toContain('max 4');
  });

  it('multiclase exige ≥5 cartas de cada clase', () => {
    const d = deck([
      { cardDefinitionId: 'a1', copies: 4 },
      { cardDefinitionId: 'a2', copies: 4 },
      { cardDefinitionId: 'a3', copies: 3 }, // EXPLORER: 11
      { cardDefinitionId: 'w1', copies: 4 }, // WARRIOR: solo 4 < 5
    ], ['EXPLORER', 'WARRIOR']);
    const errs = validateDeck(d, byId).errors.join(' | ');
    expect(errs).toContain('Multiclase');
    expect(errs).toContain('WARRIOR');
  });

  it('resolveDeckEntries expande copias', () => {
    const d = deck([
      { cardDefinitionId: 'a1', copies: 2 },
      { cardDefinitionId: 'a2', copies: 3 },
    ], ['EXPLORER'], 5);
    expect(resolveDeckEntries(d)).toEqual(['a1', 'a1', 'a2', 'a2', 'a2']);
  });
});
