import { describe, it, expect } from 'vitest';
import { CardDefinitionSchema, ZoneSchema, CardTypeSchema } from '../src/index.js';

describe('Schema validation', () => {
  it('ZoneSchema valida zonas validas', () => {
    expect(ZoneSchema.parse('HAND')).toBe('HAND');
    expect(ZoneSchema.parse('WEAR_PILE')).toBe('WEAR_PILE');
  });

  it('CardTypeSchema valida tipos validos', () => {
    expect(CardTypeSchema.parse('ABILITY')).toBe('ABILITY');
    expect(CardTypeSchema.parse('HORDE')).toBe('HORDE');
  });

  it('CardDefinitionSchema valida una carta simple', () => {
    const card = {
      id: 'test.card',
      name: 'Test Card',
      type: 'ABILITY',
      heroClass: 'WARRIOR',
      copies: 1,
      printedAttack: 2,
      effects: [
        { type: 'GAIN_GLORY', amount: { kind: 'CONSTANT', value: 1 } },
      ],
    };
    const result = CardDefinitionSchema.parse(card);
    expect(result.id).toBe('test.card');
    expect(result.effects).toHaveLength(1);
  });

  it('CardDefinitionSchema rechaza carta sin id', () => {
    const card = {
      name: 'Bad Card',
      type: 'ABILITY',
    };
    expect(() => CardDefinitionSchema.parse(card)).toThrow();
  });
});
