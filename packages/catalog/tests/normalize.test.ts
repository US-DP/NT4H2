/** normalizeEffects: alias snake_case → camelCase, incluidas ramas
 *  anidadas (onFailure, CHOOSE_ONE.options[].effects, then/else…).
 *  Antes solo se normalizaba el nivel raíz y DRAW_AND_CHECK interno —
 *  los alias anidados llegaban al motor sin traducir y se ignoraban. */
import { describe, it, expect } from 'vitest';
import { normalizeEffects } from '../src/loader.js';

describe('normalizeEffects', () => {
  it('normaliza aliases en el nivel raíz', () => {
    const effects = [
      {
        type: 'DRAW_AND_CHECK',
        expected_name: 'Ballesta',
        on_match: [{ type: 'GAIN_COINS', amount: { kind: 'CONSTANT', value: 1 } }],
      },
    ];
    normalizeEffects(effects);
    expect(effects[0].expectedName).toBe('Ballesta');
    expect(effects[0].expected_name).toBeUndefined();
    expect(effects[0].onMatch).toHaveLength(1);
    expect(effects[0].on_match).toBeUndefined();
  });

  it('normaliza aliases dentro de TRY_EFFECT.onFailure', () => {
    const effects = [
      {
        type: 'TRY_EFFECT',
        effects: [{ type: 'PASS' }],
        onFailure: [
          {
            type: 'STEAL_COINS_MULTIPLE',
            max_total: { kind: 'CONSTANT', value: 3 },
            max_per_hero: { kind: 'CONSTANT', value: 2 },
          },
        ],
      },
    ];
    normalizeEffects(effects);
    const onFail = effects[0].onFailure[0];
    expect(onFail.maxTotal).toEqual({ kind: 'CONSTANT', value: 3 });
    expect(onFail.maxPerHero).toEqual({ kind: 'CONSTANT', value: 2 });
    expect(onFail.max_total).toBeUndefined();
  });

  it('normaliza aliases dentro de CHOOSE_ONE.options[].effects', () => {
    const effects = [
      {
        type: 'CHOOSE_ONE',
        options: [
          {
            label: 'a',
            effects: [
              {
                type: 'DRAW_AND_CHECK',
                expected_name: 'X',
                on_match: [],
              },
            ],
          },
        ],
      },
    ];
    normalizeEffects(effects);
    const inner = effects[0].options[0].effects[0];
    expect(inner.expectedName).toBe('X');
    expect(inner.expected_name).toBeUndefined();
  });

  it('normaliza aliases dentro de then/else de CONDITIONAL', () => {
    const effects = [
      {
        type: 'CONDITIONAL',
        condition: { kind: 'HAS_CAPABILITY', icon: 'RANGED' },
        then: [
          { type: 'SWAP_ENEMY', new_from: 'BOTTOM' },
        ],
        else: [
          { type: 'PLAY_RANDOM_CARD_FROM_OTHER_HERO', cost_glory: { kind: 'CONSTANT', value: 1 } },
        ],
      },
    ];
    normalizeEffects(effects);
    // new_from/newFrom se eliminaron del schema (el resolver nunca los
    // leía): el normalizador los limpia, no los traduce.
    expect(effects[0].then[0].newFrom).toBeUndefined();
    expect(effects[0].then[0].new_from).toBeUndefined();
    expect(effects[0].else[0].costGlory).toEqual({ kind: 'CONSTANT', value: 1 });
  });
});
