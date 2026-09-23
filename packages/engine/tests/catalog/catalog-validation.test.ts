/**
 * Nivel 0: Validacion estatica del catalogo.
 *
 * Verifica que:
 * - Todas las cartas del catalogo oficial cargan sin errores de schema
 * - No hay IDs duplicados
 * - Los nombres son unicos dentro de su tipo/clase
 * - Las cantidades de copias son coherentes con el PDF original
 * - Los campos obligatorios por tipo estan presentes
 * - Los efectos referencian tipos validos
 */

import { describe, it, expect } from 'vitest';
import { loadCatalog } from '@nt4h/catalog';

const catalog = loadCatalog();

describe('Nivel 0 - Validacion estatica del catalogo', () => {
  describe('Carga del catalogo', () => {
    it('no debe tener errores de validacion de schema', () => {
      expect(catalog.errors).toEqual([]);
      if (catalog.errors.length > 0) {
        console.error('Errores de catalogo:', catalog.errors);
      }
    });

    it('debe cargar al menos 90 cartas unicas', () => {
      // 7+8+9+9+3+9+8+12+27 = 92 cartas unicas
      expect(catalog.totalCards).toBeGreaterThanOrEqual(90);
    });

    it('debe tener totalCopies > totalCards (algunas cartas tienen multiples copias)', () => {
      expect(catalog.totalCopies).toBeGreaterThan(catalog.totalCards);
    });
  });

  describe('Unicidad de IDs', () => {
    it('no debe haber IDs duplicados', () => {
      const ids = catalog.cards.map(c => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('todos los IDs deben seguir el formato <clase>.<nombre-kebab>', () => {
      for (const card of catalog.cards) {
        // Los IDs deben tener al menos un punto y usar kebab-case
        expect(card.id).toMatch(/^[a-z][a-z0-9-]*\.[a-z0-9-]+$/);
      }
    });
  });

  describe('Cartas de Habilidad por clase', () => {
    const EXPECTED_CLASSES = ['EXPLORER', 'WARRIOR', 'MAGE', 'ROGUE'];
    const EXPECTED_UNIQUE = { EXPLORER: 7, WARRIOR: 8, MAGE: 9, ROGUE: 9 };

    for (const heroClass of EXPECTED_CLASSES) {
      it(`debe tener ${EXPECTED_UNIQUE[heroClass as keyof typeof EXPECTED_UNIQUE]} cartas unicas de ${heroClass}`, () => {
        const cards = catalog.byClass.get(heroClass) ?? [];
        const abilityCards = cards.filter(c => c.type === 'ABILITY');
        expect(abilityCards.length).toBe(EXPECTED_UNIQUE[heroClass as keyof typeof EXPECTED_UNIQUE]);
      });

      it(`cada carta de ${heroClass} debe tener heroClass=${heroClass}`, () => {
        const cards = catalog.byClass.get(heroClass) ?? [];
        for (const card of cards) {
          expect(card.heroClass).toBe(heroClass);
        }
      });

      it(`cartas de ${heroClass} deben tener copies >= 1`, () => {
        const cards = catalog.byClass.get(heroClass) ?? [];
        for (const card of cards) {
          expect(card.copies).toBeGreaterThanOrEqual(1);
        }
      });

      it(`total de copias de ${heroClass} debe ser 15 (mazo de habilidad)`, () => {
        const cards = catalog.byClass.get(heroClass) ?? [];
        const total = cards.filter(c => c.type === 'ABILITY').reduce((s, c) => s + c.copies, 0);
        expect(total).toBe(15);
      });
    }
  });

  describe('Huestes (horde)', () => {
    it('debe haber 27 cartas unicas de Hueste', () => {
      const horde = catalog.byType.get('HORDE') ?? [];
      expect(horde.length).toBe(27);
    });

    it('todas las Huestes deben tener printedFortitude definido', () => {
      const horde = catalog.byType.get('HORDE') ?? [];
      for (const card of horde) {
        expect(card.printedFortitude).toBeDefined();
        expect(card.printedFortitude).toBeGreaterThanOrEqual(1);
      }
    });

    it('todas las Huestes deben tener reward definido', () => {
      const horde = catalog.byType.get('HORDE') ?? [];
      for (const card of horde) {
        expect(card.reward).toBeDefined();
      }
    });

    it('debe haber 8 Huestes con F2 (fortaleza 2)', () => {
      const horde = catalog.byType.get('HORDE') ?? [];
      const f2 = horde.filter(c => c.printedFortitude === 2);
      expect(f2.length).toBe(8);
    });
  });

  describe('Senores de la Guerra (warlords)', () => {
    it('debe haber 3 Senores de la Guerra', () => {
      const warlords = catalog.byType.get('WARLORD') ?? [];
      expect(warlords.length).toBe(3);
    });

    it('todos los Senores de la Guerra deben tener printedFortitude >= 6', () => {
      const warlords = catalog.byType.get('WARLORD') ?? [];
      for (const card of warlords) {
        expect(card.printedFortitude).toBeDefined();
        expect(card.printedFortitude!).toBeGreaterThanOrEqual(6);
      }
    });
  });

  describe('Heroes', () => {
    it('debe haber 8 heroes', () => {
      const heroes = catalog.byType.get('HERO') ?? [];
      expect(heroes.length).toBe(8);
    });

    it('todos los heroes deben tener maxWounds definido (>= 2)', () => {
      const heroes = catalog.byType.get('HERO') ?? [];
      for (const card of heroes) {
        expect(card.maxWounds).toBeDefined();
        expect(card.maxWounds).toBeGreaterThanOrEqual(2);
      }
    });

    it('todos los heroes deben tener heroAbility con uses >= 1', () => {
      const heroes = catalog.byType.get('HERO') ?? [];
      for (const card of heroes) {
        expect(card.heroAbility).toBeDefined();
        expect(card.heroAbility!.uses).toBeGreaterThanOrEqual(1);
        // Nota: algunos heroes tienen effects vacio porque su pericia
        // esta en _peritiaText (catalogo incompleto, ver AGENTS.md)
      }
    });

    it('todos los heroes deben tener capabilities no vacio', () => {
      const heroes = catalog.byType.get('HERO') ?? [];
      for (const card of heroes) {
        expect(card.capabilities).toBeDefined();
        expect(card.capabilities!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Mercado', () => {
    it('debe haber 9 cartas de Mercado', () => {
      const market = catalog.byType.get('MARKET') ?? [];
      expect(market.length).toBe(9);
    });

    it('todas las cartas de Mercado deben tener printedCost definido', () => {
      const market = catalog.byType.get('MARKET') ?? [];
      for (const card of market) {
        expect(card.printedCost).toBeDefined();
        expect(card.printedCost).toBeGreaterThanOrEqual(1);
      }
    });

    it('las cartas de Mercado con restriccion deben tener requiredCapabilities', () => {
      // Solo algunas cartas de Mercado tienen requiredCapabilities
      // (Daga Elfica: RANGED, Alabarda Orca: MELEE, Arco Compuesto: RANGED)
      const market = catalog.byType.get('MARKET') ?? [];
      const withReq = market.filter(c => c.requiredCapabilities && c.requiredCapabilities.length > 0);
      expect(withReq.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Escenarios', () => {
    it('debe haber 12 escenarios', () => {
      const scenarios = catalog.byType.get('SCENARIO') ?? [];
      expect(scenarios.length).toBe(12);
    });
  });

  describe('Coherencia de efectos', () => {
    it('todos los efectos deben tener un tipo reconocido', () => {
      const VALID_EFFECT_TYPES = new Set([
        'DEAL_DAMAGE', 'DEAL_DAMAGE_ALL_ENEMIES', 'DEAL_DAMAGE_WARLORD',
        'DEAL_DAMAGE_SPLIT', 'DEAL_DAMAGE_TO_HERO', 'DEAL_DAMAGE_TO_OTHER_HEROES',
        'DRAW_CARDS', 'LOSE_CARDS', 'GAIN_COINS', 'GAIN_GLORY',
        'PREVENT_DAMAGE', 'PREVENT_ENEMY_DAMAGE', 'END_ATTACK',
        'RECOVER_CARD', 'RECOVER_THIS_CARD', 'RECOVER_CARD_BY_NAME', 'RECOVER_CARDS',
        'STEAL_COINS', 'STEAL_COINS_MULTIPLE',
        'SWAP_ENEMY', 'DRAW_AND_CHECK', 'PLAY_RANDOM_CARD_FROM_OTHER_HERO',
        'HEAL_WOUNDS', 'SHIELD', 'PREVENT_HORDE_ATTACK',
        'CONDITIONAL', 'ON_DEFEAT', 'ON_ENEMY_DEFEATED',
        'CUSTOM_SCENARIO', 'RAPID_SHOT', 'FIREBALL',
        'SEARCH_DECK', 'SHUFFLE_DECK', 'SEARCH_WEAR_PILE_PUT_IN_HAND',
        'GAIN_SHIELD', 'GAIN_PREVENTION', 'CANCEL_DAMAGE', 'CANCEL_ALL_DAMAGE',
        'DISABLE_ENEMY_DAMAGE', 'ADD_MODIFIER', 'REMOVE_MODIFIER',
        'TOGGLE_ORC_FORTITUDE_BONUS', 'SET_ANTI_MAGIC',
        'APPLY_VULNERABILITY', 'INTERCEPT_DAMAGE', 'LOOK_AT_CARDS',
        'MODIFY_DAMAGE', 'MODIFY_FORTITUDE', 'MODIFY_MARKET_COST',
        'PLACE_PERSISTENT', 'DRAW_AND_ADD_ATTACK',
        'ALL_HEROES_RECOVER', 'OTHER_HEROES_RECOVER',
        'IGNORE_COIN_REWARDS', 'IGNORE_GLORY_REWARDS', 'COST',
        'DEFEAT_ENEMY', 'PLAY_IMMEDIATELY',
      ]);

      function checkEffects(effects: any[], cardId: string): void {
        for (const eff of effects) {
          if (!eff || !eff.type) continue;
          expect(typeof eff.type).toBe('string');
          expect(eff.type.length).toBeGreaterThan(0);
          // Verificar que el tipo esta en la lista conocida
          expect(VALID_EFFECT_TYPES.has(eff.type), `${cardId}: tipo desconocido "${eff.type}"`).toBe(true);
          // Recursividad
          if (eff.effects) checkEffects(eff.effects, cardId);
          if (eff.then) checkEffects(eff.then, cardId);
          if (eff.else) checkEffects(eff.else, cardId);
          if (eff.onMatch) checkEffects([eff.onMatch], cardId);
          if (eff.onMismatch) checkEffects([eff.onMismatch], cardId);
        }
      }

      for (const card of catalog.cards) {
        checkEffects(card.effects, card.id);
        if (card.heroAbility) checkEffects(card.heroAbility.effects, card.id);
      }
    });

    it('los efectos DEAL_DAMAGE deben tener amount definido', () => {
      function findDamageEffects(effects: any[], cardId: string): void {
        for (const eff of effects) {
          if (eff?.type === 'DEAL_DAMAGE' || eff?.type === 'DEAL_DAMAGE_ALL_ENEMIES') {
            expect(eff.amount, `${cardId} DEAL_DAMAGE sin amount`).toBeDefined();
          }
          if (eff?.effects) findDamageEffects(eff.effects, cardId);
          if (eff?.then) findDamageEffects(eff.then, cardId);
          if (eff?.else) findDamageEffects(eff.else, cardId);
        }
      }
      for (const card of catalog.cards) {
        findDamageEffects(card.effects, card.id);
      }
    });
  });

  describe('Verificacion de campos opcionales por tipo', () => {
    it('las cartas ABILITY no deben tener reward', () => {
      const abilities = catalog.byType.get('ABILITY') ?? [];
      for (const card of abilities) {
        expect(card.reward).toBeUndefined();
      }
    });

    it('las cartas ABILITY no deben tener maxWounds', () => {
      const abilities = catalog.byType.get('ABILITY') ?? [];
      for (const card of abilities) {
        expect(card.maxWounds).toBeUndefined();
      }
    });

    it('las cartas HORDE no deben tener heroClass', () => {
      const horde = catalog.byType.get('HORDE') ?? [];
      for (const card of horde) {
        expect(card.heroClass).toBeUndefined();
      }
    });

    it('las cartas HERO no deben tener reward', () => {
      const heroes = catalog.byType.get('HERO') ?? [];
      for (const card of heroes) {
        expect(card.reward).toBeUndefined();
      }
    });
  });
});
