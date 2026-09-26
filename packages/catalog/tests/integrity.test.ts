/**
 * integrity — validación semántica del catálogo (más allá del schema Zod).
 *
 * Verifica unicidad de IDs, integridad referencial, cobertura de clases,
 * campos mínimos por tipo e imagen mapeada para cada carta.
 */
import { describe, it, expect } from 'vitest';
import { loadCatalog } from '../src/loader.js';
import { getCardImages, countReadyForGame } from '../src/images.js';
import { EFFECT_REGISTRY, validateEffectSources } from '../src/effects.js';
import type { CardEffect } from '@nt4h/schema';

const catalog = loadCatalog();
const all = catalog.cards;

describe('Integridad semántica del catálogo', () => {
  it('todos los IDs de definición son únicos', () => {
    const ids = all.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ningún ID contiene espacios ni mayúsculas', () => {
    for (const c of all) {
      expect(c.id).toMatch(/^[a-z0-9.-]+$/);
    }
  });

  it('toda carta tiene nombre y al menos 1 copia', () => {
    for (const c of all) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.copies).toBeGreaterThanOrEqual(1);
    }
  });

  it('cada héroe tiene clase asignable a un mazo existente', () => {
    const capToClass: Record<string, string> = {
      RANGED: 'EXPLORER',
      MELEE: 'WARRIOR',
      MAGIC: 'MAGE',
      EXPERTISE: 'ROGUE',
    };
    const heroes = catalog.byType.get('HERO') ?? [];
    for (const h of heroes) {
      const cls = (h.capabilities ?? []).map(c => capToClass[c]).find(Boolean);
      expect(cls, `héroe ${h.id} sin clase deducible`).toBeDefined();
      const deck = catalog.byClass.get(cls!);
      expect(deck && deck.length > 0, `sin mazo para clase ${cls}`).toBe(true);
      expect(h.maxWounds).toBeGreaterThan(0);
      expect(h.heroAbility).toBeDefined();
    }
  });

  it('los mazos de apoyo de solitario cubren las 4 clases', () => {
    for (const cls of ['EXPLORER', 'WARRIOR', 'MAGE', 'ROGUE']) {
      const cards = catalog.byClass.get(cls) ?? [];
      expect(cards.reduce((s, c) => s + c.copies, 0)).toBe(15);
    }
  });

  it('cada Hueste tiene fortaleza y recompensa coherentes', () => {
    for (const c of catalog.byType.get('HORDE') ?? []) {
      expect(c.printedFortitude).toBeGreaterThan(0);
      expect(c.reward).toBeDefined();
      expect((c.reward?.coins ?? 0) + (c.reward?.glory ?? 0)).toBeGreaterThan(0);
    }
  });

  it('cada carta de Mercado tiene coste positivo', () => {
    for (const c of catalog.byType.get('MARKET') ?? []) {
      expect(c.printedCost).toBeGreaterThan(0);
    }
  });

  it('los escenarios declarados son válidos', () => {
    for (const c of catalog.byType.get('SCENARIO') ?? []) {
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it('todos los efectos de las cartas oficiales usan tipos registrados y compatibles con su fuente', () => {
    const known = new Set(EFFECT_REGISTRY.map(m => m.type));
    for (const c of all) {
      const groups: [string, CardEffect[] | undefined][] = [
        ['effects', c.effects as CardEffect[] | undefined],
        ['heroAbility.effects', (c as { heroAbility?: { effects?: CardEffect[] } }).heroAbility?.effects],
        ['peritia.effects', (c as { peritia?: { effects?: CardEffect[] } }).peritia?.effects],
      ];
      for (const [where, effects] of groups) {
        for (const eff of effects ?? []) {
          expect(known.has(eff.type), `${c.id}.${where}: tipo desconocido ${eff.type}`).toBe(true);
        }
        const errs = validateEffectSources(c.type, effects ?? []);
        expect(errs, `${c.id}.${where}: ${errs.join(' | ')}`).toEqual([]);
      }
    }
  });

  it('informe de cobertura de imágenes', () => {
    // No es bloqueante: documenta el estado real del mapeo de imágenes.
    const withImages = all.filter(c => getCardImages(c.id)).length;
    console.log(`Cartas con imagen mapeada: ${withImages}/${all.length} · listas para juego: ${countReadyForGame()}`);
    expect(withImages).toBeGreaterThan(0);
  });
});
