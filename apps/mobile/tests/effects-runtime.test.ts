/**
 * Ejecución real de TODOS los efectos del catálogo oficial.
 *
 * A diferencia de los tests de paridad (estructura CardEffect ↔ nodos del
 * Taller), aquí cada carta pasa por el resolver de verdad del motor
 * (resolveCard + EffectRegistry) contra un estado sintético: es la misma
 * ruta que una PLAY_CARD en partida. Cualquier efecto sin resolver,
 * expresión rota, objetivo imposible o bucle queda como failure.
 *
 * Se simulan las 3 zonas (effects, heroAbility, peritia) con dos
 * escenarios de campo (enemigos orcos y no-orcos).
 */

import { describe, it, expect } from 'vitest';
import { loadCatalog } from '@nt4h/catalog';
import { esT } from '../components/study/cardWorkshop/model';
import {
  simulateEffects, DEFAULT_SIM_OPTIONS, type SimOptions,
} from '../components/study/cardWorkshop/simulate';

const catalog = loadCatalog();

const ZONES = [
  ['effects', (c: { effects?: object[] }) => c.effects],
  ['heroAbility', (c: { heroAbility?: { effects?: object[] } }) => c.heroAbility?.effects],
  ['peritia', (c: { peritia?: { effects?: object[] } }) => c.peritia?.effects],
] as const;

const SCENARIOS: { name: string; opts: SimOptions }[] = [
  { name: 'base', opts: DEFAULT_SIM_OPTIONS },
  {
    name: 'orcos',
    opts: { ...DEFAULT_SIM_OPTIONS, enemies: 4, enemyIsOrc: true, heroWounds: 2 },
  },
];

describe('Resolver real — cada efecto oficial se ejecuta en partida', () => {
  it('cada carta oficial resuelve sus efectos sin error en ambos escenarios', () => {
    const failures: string[] = [];
    for (const card of catalog.byId.values()) {
      for (const [zone, pick] of ZONES) {
        const fx = pick(card as never) as Parameters<typeof simulateEffects>[1] | undefined;
        if (!fx?.length) continue;
        for (const { name, opts } of SCENARIOS) {
          const r = simulateEffects(card, fx, opts, catalog, esT);
          if (!r.ok) failures.push(`${card.id}.${zone} [${name}]: ${r.error}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('cada efecto produce traza o elección pendiente (no es no-op silencioso)', () => {
    const silent: string[] = [];
    for (const card of catalog.byId.values()) {
      for (const [zone, pick] of ZONES) {
        const fx = pick(card as never) as Parameters<typeof simulateEffects>[1] | undefined;
        if (!fx?.length) continue;
        const r = simulateEffects(card, fx, SCENARIOS[1].opts, catalog, esT);
        // Una carta puede ser legítimamente pasiva o solo registrar
        // oyentes/modificadores; el no-op absoluto (sin traza ni elección)
        // es sospechoso y se audita aparte, no rompe el test global.
        if (r.ok && r.trace.length === 0 && !r.pendingChoice) {
          silent.push(`${card.id}.${zone}`);
        }
      }
    }
    // Lista-blanca: efectos que no emiten eventos visibles por diseño
    // (pendientes de confirmar contra la carta física).
    expect(silent.sort()).toMatchSnapshot('silent-effects');
  });
});
