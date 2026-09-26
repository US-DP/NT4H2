/**
 * Pools personalizados del Taller: hordeCardIds, warlordIds, marketCardIds
 * permiten jugar con conjuntos propios sin tocar el catálogo oficial.
 */

import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/index.js';
import { resolveCard } from '../src/effects/resolver.js';
import { EffectRegistry, registerCoreEffects } from '../src/index.js';
import { loadCatalog, mergeCustomCards } from '@nt4h/catalog';
import { ContentSetSchema } from '@nt4h/schema';
import type { EnemyState, GameConfig } from '@nt4h/schema';

const catalog = loadCatalog();

const base: Omit<GameConfig, 'hordeCardIds' | 'warlordIds' | 'marketCardIds'> = {
  mode: 'STANDARD',
  playerCount: 2,
  seed: 'custom-pools-001',
  heroes: [
    { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
    { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
  ],
  useScenarios: false,
};

describe('Pools personalizados', () => {
  it('hordeCardIds limita las Huestes del mazo', () => {
    // Un pool de una sola definición con suficientes copias
    const horde = catalog.byType.get('HORDE') ?? [];
    const pick = horde[0];
    const result = setupGame({ ...base, hordeCardIds: [pick.id] }, catalog);
    const defIds = new Set(result.state.hordeDeck.map(c => c.definitionId));
    // Solo el tipo elegido + (posiblemente) un Señor
    const warlordIds = new Set((catalog.byType.get('WARLORD') ?? []).map(w => w.id));
    for (const id of defIds) {
      expect(id === pick.id || warlordIds.has(id)).toBe(true);
    }
  });

  it('warlordIds restringe qué Señor aparece', () => {
    const warlords = catalog.byType.get('WARLORD') ?? [];
    const chosen = warlords[0];
    const result = setupGame({ ...base, warlordIds: [chosen.id] }, catalog);
    const warlordInDeck = result.state.hordeDeck.find(
      c => (catalog.byId.get(c.definitionId)?.type === 'WARLORD'),
    );
    expect(warlordInDeck?.definitionId).toBe(chosen.id);
  });

  it('marketCardIds limita el mazo de Mercado', () => {
    const market = catalog.byType.get('MARKET') ?? [];
    const picks = market.slice(0, 3).map(c => c.id);
    const result = setupGame({ ...base, marketCardIds: picks }, catalog);
    const all = [...result.state.market, ...result.state.marketDeck];
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) expect(picks).toContain(c.definitionId);
  });

  it('pool de Horda vacío produce error de setup', () => {
    const result = setupGame({ ...base, hordeCardIds: ['inexistente'] }, catalog);
    expect(result.errors.some(e => e.includes('Horde'))).toBe(true);
  });

  it('customDeckId sin snapshot en config produce error (no juega a medias)', () => {
    const result = setupGame({
      ...base,
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default', customDeckId: 'deck.missing' },
        base.heroes[1],
      ],
    }, catalog);
    expect(result.errors.some(e => e.includes('deck.missing'))).toBe(true);
  });

  it('pericia declarativa de un Señor personalizado funciona sin código nuevo', () => {
    // Set del Taller con un Señor propio: "cada carta que lo dañe cuesta 1 carta"
    const set = ContentSetSchema.parse({
      id: 'custom.warlords',
      name: 'Señores de prueba',
      version: '1.0.0',
      author: 'test',
      cards: [{
        id: 'custom.warlord.test',
        name: 'Señor de Prueba',
        type: 'WARLORD',
        copies: 1,
        printedFortitude: 8,
        officialStatus: 'CUSTOM',
        peritia: {
          trigger: 'DAMAGE_DEALT',
          effects: [{ type: 'LOSE_CARDS', amount: { kind: 'CONSTANT', value: 1 } }],
        },
      }],
    });
    const merged = mergeCustomCards(catalog, [set]);
    const result = setupGame({ ...base, warlordIds: ['custom.warlord.test'] }, merged);
    const state = result.state;

    // Mover el Señor del mazo al campo (estado de juego sintético)
    const warlordCard = state.hordeDeck.find(c => c.definitionId === 'custom.warlord.test');
    expect(warlordCard).toBeDefined();
    const warlordEnemy: EnemyState = {
      instanceId: warlordCard!.instanceId,
      definitionId: 'custom.warlord.test',
      baseFortitude: 8,
      wounds: 0,
      reward: null,
      modifiers: [],
      isWarlord: true,
      isOrc: false,
      specialIcons: [],
      damageDisabled: false,
    };
    const player = state.players['p1'];
    // Determinístico: carta de la mano con daño impreso puro (sin efectos
    // DEAL_* que lo sustituyan ni repartan el daño a otros objetivos)
    const card = player.hand.find((c) => {
      const d = merged.byId.get(c.definitionId);
      return (d?.printedAttack ?? 0) >= 1
        && !(d?.effects ?? []).some(e => e.type.startsWith('DEAL_'));
    });
    expect(card).toBeDefined();
    const cardDef = merged.byId.get(card!.definitionId)!;
    const registry = new EffectRegistry();
    registerCoreEffects(registry);

    const handSize = player.hand.length;
    const deckSize = player.abilityDeck.length;
    const resolved = resolveCard(
      { ...state, battlefield: [...state.battlefield, warlordEnemy] },
      card!, cardDef, warlordEnemy.instanceId, player,
      result.rng, registry, merged,
    );
    const damaged = resolved.events.some(
      e => e.type === 'DAMAGE_DEALT' && 'targetId' in e && e.targetId === warlordEnemy.instanceId && e.amount >= 1,
    );
    expect(damaged).toBe(true);
    // La pericia hace perder 1 carta del mazo (además de la jugada al desgaste)
    const p = resolved.newState.players['p1'];
    expect(p.abilityDeck.length).toBeLessThanOrEqual(deckSize - 1);
    expect(p.hand.length).toBe(handSize - 1);
  });

  it('sin pools personalizados el comportamiento es el oficial', () => {
    const result = setupGame(base, catalog);
    // 19 Huestes + 1 Señor = 20 cartas, de las que 3 salen al campo inicial
    expect(result.state.hordeDeck.length + result.state.battlefield.length).toBe(20);
    expect(result.state.battlefield.length).toBe(3);
    expect(result.state.market.length).toBe(5);
  });
});
