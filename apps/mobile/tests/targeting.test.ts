/**
 * getCardTargeting — regresión de la auditoría: el walker de efectos
 * debe recorrer TODOS los contenedores anidados del esquema (then/else,
 * effects, onMatch/onMismatch, onFailure, options[].effects). Un objetivo
 * dentro de una rama no escaneada no pedía targetEnemyId y el motor lo
 * resolvía como no-op silencioso.
 */

import { describe, it, expect } from 'vitest';
import { getCardTargeting } from '../lib/targeting';
import type { CardDefinition } from '@nt4h/schema';

const mk = (effects: unknown[]) =>
  ({ id: 't.card', name: 'Prueba', type: 'ABILITY', effects }) as unknown as CardDefinition;

const oneEnemy = { type: 'DEAL_DAMAGE', amount: 1, target: { kind: 'ONE_ENEMY' } };

describe('getCardTargeting — efectos anidados', () => {
  it('detecta objetivo dentro de CHOOSE_ONE.options[].effects', () => {
    const card = mk([{ type: 'CHOOSE_ONE', options: [{ label: 'A', effects: [oneEnemy] }] }]);
    expect(getCardTargeting(card).mode).toBe('enemy');
  });

  it('detecta objetivo dentro de TRY_EFFECT.onFailure', () => {
    const card = mk([{
      type: 'TRY_EFFECT',
      effects: [{ type: 'GAIN_COINS', amount: 1 }],
      onFailure: [oneEnemy],
    }]);
    expect(getCardTargeting(card).mode).toBe('enemy');
  });

  it('detecta objetivo dentro de CONDITIONAL.then', () => {
    const card = mk([{ type: 'CONDITIONAL', condition: {}, then: [oneEnemy] }]);
    expect(getCardTargeting(card).mode).toBe('enemy');
  });

  it('detecta objetivo dentro de DRAW_AND_CHECK.onMismatch', () => {
    const card = mk([{ type: 'DRAW_AND_CHECK', amount: 1, onMismatch: [oneEnemy] }]);
    expect(getCardTargeting(card).mode).toBe('enemy');
  });

  it('detecta objetivo dentro de REPEAT.effects', () => {
    const card = mk([{ type: 'REPEAT', times: 2, max: 3, effects: [oneEnemy] }]);
    expect(getCardTargeting(card).mode).toBe('enemy');
  });

  it('sin objetivos anidados sigue en none', () => {
    const card = mk([
      { type: 'TRY_EFFECT', effects: [{ type: 'GAIN_COINS', amount: 1 }] },
      { type: 'CHOOSE_ONE', options: [{ effects: [{ type: 'HEAL_WOUNDS', amount: 1 }] }] },
    ]);
    expect(getCardTargeting(card).mode).toBe('none');
  });

  it('propaga los filtros del objetivo anidado (isOrc)', () => {
    const filtered = {
      ...oneEnemy,
      target: { kind: 'ONE_ENEMY', filter: { isOrc: true } },
    };
    const card = mk([{ type: 'ON_DEFEAT', effects: [filtered] }]);
    const t = getCardTargeting(card);
    expect(t.mode).toBe('enemy');
    expect(t.filters).toEqual([{ isOrc: true }]);
  });
});
