import { describe, it, expect } from 'vitest';
import { loadCatalog, getCard } from '../src/loader.js';

describe('Catalogo de cartas oficiales', () => {
  const catalog = loadCatalog();

  it('carga sin errores de validacion', () => {
    if (catalog.errors.length > 0) {
      console.error('Errores de validacion:', catalog.errors);
    }
    expect(catalog.errors).toEqual([]);
  });

  it('tiene 33 definiciones de habilidad (15 copias por clase, 4 clases)', () => {
    const abilities = catalog.byType.get('ABILITY') ?? [];
    // 33 definiciones unicas (7 explorer + 8 warrior + 9 mage + 9 rogue)
    // Algunas definiciones tienen multiples copias (ej: Disparo Rapido = 6)
    expect(abilities.length).toBe(33);
  });

  it('tiene 15 copias por clase de habilidad', () => {
    for (const cls of ['WARRIOR', 'EXPLORER', 'ROGUE', 'MAGE']) {
      const cards = catalog.byClass.get(cls) ?? [];
      const totalCopies = cards.reduce((sum, c) => sum + c.copies, 0);
      expect(totalCopies).toBe(15);
    }
  });

  it('tiene 27 Huestes', () => {
    const horde = catalog.byType.get('HORDE') ?? [];
    expect(horde.length).toBe(27);
  });

  it('tiene 3 Señores de la Guerra', () => {
    const warlords = catalog.byType.get('WARLORD') ?? [];
    expect(warlords.length).toBe(3);
  });

  it('tiene 14 cartas de Mercado (contando copias)', () => {
    const market = catalog.byType.get('MARKET') ?? [];
    const totalCopies = market.reduce((sum, c) => sum + c.copies, 0);
    expect(totalCopies).toBe(14);
  });

  it('tiene 8 Héroes (4 cartas x 2 caras)', () => {
    const heroes = catalog.byType.get('HERO') ?? [];
    expect(heroes.length).toBe(8);
  });

  it('tiene 12 Escenarios', () => {
    const scenarios = catalog.byType.get('SCENARIO') ?? [];
    expect(scenarios.length).toBe(12);
  });

  it('total de copias coincide con la suma real del catálogo', () => {
    // totalCopies debe ser exactamente la suma de `copies` por definición —
    // antes solo se asertaba totalCards >= 50 y el cálculo nunca se verificaba.
    const expected = catalog.cards.reduce((sum, c) => sum + c.copies, 0);
    expect(catalog.totalCopies).toBe(expected);
    expect(expected).toBeGreaterThan(100);
    expect(catalog.totalCards).toBe(catalog.cards.length);
  });

  it('todas las Huestes tienen fortaleza', () => {
    const horde = catalog.byType.get('HORDE') ?? [];
    for (const card of horde) {
      expect(card.printedFortitude).toBeDefined();
      expect(card.printedFortitude!).toBeGreaterThan(0);
    }
  });

  it('todas las Huestes tienen recompensa', () => {
    const horde = catalog.byType.get('HORDE') ?? [];
    for (const card of horde) {
      expect(card.reward).toBeDefined();
    }
  });

  it('todos los Señores tienen fortaleza >= 8', () => {
    const warlords = catalog.byType.get('WARLORD') ?? [];
    for (const card of warlords) {
      expect(card.printedFortitude).toBeDefined();
      expect(card.printedFortitude!).toBeGreaterThanOrEqual(8);
    }
  });

  it('todas las cartas de Mercado tienen coste', () => {
    const market = catalog.byType.get('MARKET') ?? [];
    for (const card of market) {
      expect(card.printedCost).toBeDefined();
      expect(card.printedCost!).toBeGreaterThan(0);
    }
  });

  it('getCard funciona para IDs conocidos', () => {
    expect(getCard(catalog, 'explorer.rapid-shot').name).toBe('Disparo Rápido');
    expect(getCard(catalog, 'warrior.sword-strike').name).toBe('Espadazo');
    expect(getCard(catalog, 'mage.fireball').name).toBe('Bola de Fuego');
    expect(getCard(catalog, 'rogue.trap').name).toBe('Trampa');
  });

  it('Disparo Rápido tiene 6 copias', () => {
    expect(getCard(catalog, 'explorer.rapid-shot').copies).toBe(6);
  });

  it('Espadazo tiene 4 copias', () => {
    expect(getCard(catalog, 'warrior.sword-strike').copies).toBe(4);
  });
});
