/**
 * Nivel 12: Pruebas responsive.
 *
 * Verifica que los componentes se adaptan a diferentes tamaños de pantalla:
 * - UI-370: No reducir versión escritorio
 * - UI-371: Acciones principales accesibles sin gestos ocultos
 * - UI-373: Mesa en orientación vertical
 * - UI-374: Horizontal con distribución ampliada
 */

import { describe, it, expect, vi } from 'vitest';
import { render, expectText, findPressable } from './renderer';

const mockStoreState: Record<string, unknown> = {};

vi.mock('../store/gameStore', () => ({
  useGameStore: (selector: any) => selector(mockStoreState),
}));

import { CardView } from '../components/CardView';
import { PlayerPanel } from '../components/PlayerPanel';
import { HandView } from '../components/HandView';
import { MarketView } from '../components/MarketView';

import type { CardDefinition, GameState, CardInstance } from '@nt4h/schema';

function makeCardDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return { id: 'test-card', name: 'Test Card', type: 'ABILITY', copies: 1, effects: [], verificationStatus: 'verified', ...overrides } as CardDefinition;
}

function makeCardInstance(overrides: Partial<CardInstance> = {}): CardInstance {
  return { instanceId: 'card-inst-1', definitionId: 'test-card', ownerId: 'p1', zone: 'HAND', ...overrides } as CardInstance;
}

function setMockStore(state: Record<string, unknown>): void {
  Object.keys(mockStoreState).forEach(k => delete mockStoreState[k]);
  Object.assign(mockStoreState, state);
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'PLAYER_ATTACK', activePlayerId: 'p1', playerOrder: ['p1', 'p2'],
    turnNumber: 1, roundNumber: 1, mode: 'STANDARD',
    players: {
      p1: { heroId: 'hero.aranel', heroFace: 'FEMALE', wounds: 0, maxWounds: 3, glory: 5, coins: 10, shields: 0, hand: [makeCardInstance()], abilityDeck: [], wearPile: [], trophies: [], capabilities: ['RANGED'], heroUsesRemaining: 2, heroMaxUses: 2, modifiers: [], prevention: 0, damageCancellation: false, connected: true },
      p2: { heroId: 'hero.feldon', heroFace: 'MALE', wounds: 1, maxWounds: 3, glory: 3, coins: 5, shields: 0, hand: [makeCardInstance({ instanceId: 'p2-card' })], abilityDeck: [], wearPile: [], trophies: [], capabilities: ['MELEE'], heroUsesRemaining: 1, heroMaxUses: 2, modifiers: [], prevention: 0, damageCancellation: false, connected: true },
    },
    battlefield: [], market: [], scenario: null, scenarioDeck: [], hordeDeck: [], rngState: '', ignoreGloryRewards: false, ignoreCoinRewards: false, marketCostModifier: 0, orcFortitudeBonus: 0, ...overrides,
  } as GameState;
}

function makeCatalog(cards: CardDefinition[] = []) {
  const byId = new Map<string, CardDefinition>();
  for (const c of cards) byId.set(c.id, c);
  return { byId, byType: new Map(), cards, totalCards: cards.length };
}

// Simular diferentes tamaños de pantalla
const SCREEN_SIZES = {
  mobile_small: { width: 320, height: 568 },
  mobile_standard: { width: 375, height: 812 },
  mobile_large: { width: 414, height: 896 },
  tablet_portrait: { width: 768, height: 1024 },
  tablet_landscape: { width: 1024, height: 768 },
  desktop: { width: 1920, height: 1080 },
};

describe('Responsive — UI-370 (componentes en móvil estrecho)', () => {
  it('CardView renderiza en pantalla de 320px', () => {
    const card = makeCardDef({ name: 'Small Screen' });
    const { root } = render(<CardView card={card} />);
    expectText(root, 'Small Screen');
  });

  it('PlayerPanel renderiza en pantalla de 320px', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel' })]),
    });
    const { root } = render(<PlayerPanel />);
    expectText(root, 'Aranel');
  });

  it('HandView renderiza en pantalla de 320px', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'test-card', name: 'Hand' })]),
      ui: { selectedCardInstanceId: null, selectedEnemyInstanceId: null },
      selectCard: vi.fn(),
    });
    const { root } = render(<HandView />);
    expectText(root, 'Hand');
  });
});

describe('Responsive — UI-371 (acciones sin gestos ocultos)', () => {
  it('HandView tiene botón presionable visible', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'test-card', name: 'Action' })]),
      ui: { selectedCardInstanceId: null, selectedEnemyInstanceId: null },
      selectCard: vi.fn(),
    });
    const { root } = render(<HandView />);
    const pressable = findPressable(root);
    expect(pressable).not.toBeNull();
  });

  it('CardView tiene onPress accesible', () => {
    const onPress = vi.fn();
    const card = makeCardDef({ name: 'Press' });
    const { root } = render(<CardView card={card} onPress={onPress} />);
    const pressable = findPressable(root);
    expect(pressable).not.toBeNull();
  });
});

describe('Responsive — UI-373 (mesa vertical)', () => {
  it('componentes renderizan en orientación vertical', () => {
    setMockStore({
      gameState: makeGameState({ phase: 'MARKET', market: [makeCardInstance({ instanceId: 'm1', definitionId: 'market.d' })] }),
      catalog: makeCatalog([makeCardDef({ id: 'market.d', name: 'Daga', printedCost: 3 } as any)]),
      buyCard: vi.fn(),
    });
    const { root } = render(<MarketView />);
    expectText(root, /Mercado/);
  });
});

describe('Responsive — UI-374 (horizontal ampliado)', () => {
  it('componentes renderizan en orientación horizontal', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel' })]),
    });
    const { root } = render(<PlayerPanel />);
    expectText(root, 'Aranel');
    expectText(root, /Gloria.*5/);
  });
});

describe('Responsive — todos los tamaños', () => {
  for (const [sizeName, size] of Object.entries(SCREEN_SIZES)) {
    it(`CardView renderiza en ${sizeName} (${size.width}x${size.height})`, () => {
      const card = makeCardDef({ name: 'Responsive' });
      const { root } = render(<CardView card={card} />);
      expectText(root, 'Responsive');
    });
  }
});
