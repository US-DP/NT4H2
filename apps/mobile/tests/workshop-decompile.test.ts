/**
 * Decompilador del Taller — CardEffect → EffectNode → CardEffect.
 *
 * Garantiza que CUALQUIER carta del catálogo (oficial o importada) se abre
 * en el editor con su árbol de efectos real y que recompilarla produce
 * exactamente los efectos originales: la cobertura es lossless salvo los
 * campos que el editor deliberadamente no modela, y esos emiten
 * diagnóstico DECOMPILE_* en vez de perderse en silencio.
 *
 * Cubre las 3 zonas: effects, heroAbility.effects y peritia.effects.
 */

import { describe, it, expect } from 'vitest';
import { loadCatalog } from '@nt4h/catalog';
import { CardEffectSchema, type CardEffect } from '@nt4h/schema';
import {
  decompileCard, decompileEffects,
} from '../components/study/cardWorkshop/decompile';
import { buildEffects } from '../components/study/cardWorkshop/compiler';

/** Misma canonicalización que workshop-cards.test (MULTIPLY×2 ≡ SUM×2,
 *  expectedCard/text narrativos fuera, deck por defecto ABILITY). */
const canon = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(canon);
  if (obj && typeof obj === 'object') {
    const src = obj as Record<string, unknown>;
    if (src.kind === 'MULTIPLY' && Array.isArray(src.factors) && src.factors.length === 2) {
      const [a, b] = src.factors as Record<string, unknown>[];
      if (a?.kind === 'CONSTANT' && a.value === 2) return { kind: 'SUM', of: [canon(b), canon(b)] };
    }
    const out: Record<string, unknown> = {};
    for (const [k2, v] of Object.entries(src)) {
      if (k2 === 'expectedCard' || k2 === 'text') continue;
      out[k2] = canon(v);
    }
    if (src.type === 'SEARCH_DECK' && out.deck === 'ABILITY') delete out.deck;
    return out;
  }
  return obj;
};

const catalog = loadCatalog();

describe('Taller → decompilador de cartas del catálogo', () => {
  it('ninguna carta oficial produce diagnósticos de error al cargarla', () => {
    const bad: string[] = [];
    for (const card of catalog.byId.values()) {
      const dec = decompileCard(card);
      const errors = dec.diagnostics.filter(d => d.severity === 'error');
      if (errors.length > 0) {
        bad.push(`${card.id}: ${errors.map(d => `${d.code}@${d.path}`).join(', ')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('cada carta: recompilar la zona principal reproduce los efectos', () => {
    for (const card of catalog.byId.values()) {
      if ((card.effects?.length ?? 0) === 0) continue;
      // CUSTOM_SCENARIO no es editable: su handler es un dispatch nativo
      // del motor — el nodo existe solo como documentación del mapeo.
      if (card.effects!.every(e => e.type === 'CUSTOM_SCENARIO')) continue;
      const dec = decompileCard(card);
      const rebuilt = buildEffects(dec.nodes);
      expect(canon(rebuilt), `${card.id} (${card.name})`).toEqual(canon(card.effects));
    }
  });

  it('cada héroe: pericia recompilada reproduce efectos y usos', () => {
    for (const card of catalog.byId.values()) {
      if (!card.heroAbility) continue;
      const dec = decompileCard(card);
      expect(canon(buildEffects(dec.abilityNodes)), card.id)
        .toEqual(canon(card.heroAbility.effects));
      expect(dec.abilityUses).toBe(String(card.heroAbility.uses));
    }
  });

  it('cada Señor: peritia recompilada reproduce trigger/condición/efectos', () => {
    for (const card of catalog.byId.values()) {
      if (!card.peritia) continue;
      const dec = decompileCard(card);
      expect(dec.peritiaTrigger).toBe(card.peritia.trigger);
      expect(dec.peritiaCondition).toBe(card.peritia.condition ?? '');
      expect(canon(buildEffects(dec.peritiaNodes)), card.id)
        .toEqual(canon(card.peritia.effects));
    }
  });

  it('todo efecto decompilado recompila a un CardEffect válido (Zod)', () => {
    for (const card of catalog.byId.values()) {
      const dec = decompileCard(card);
      for (const e of [
        ...buildEffects(dec.nodes),
        ...buildEffects(dec.abilityNodes),
        ...buildEffects(dec.peritiaNodes),
      ]) {
        const parsed = CardEffectSchema.safeParse(e);
        expect(parsed.success, `${card.id}: ${JSON.stringify(e)}`).toBe(true);
      }
    }
  });

  it('el round-trip es estable: decompilar lo recompilado da lo mismo', () => {
    for (const card of catalog.byId.values()) {
      if ((card.effects?.length ?? 0) === 0) continue;
      const once = buildEffects(decompileEffects(card.effects).nodes);
      const twice = buildEffects(decompileEffects(once as CardEffect[]).nodes);
      expect(canon(twice), card.id).toEqual(canon(once));
    }
  });
});
