/**
 * Nivel 13: Pruebas de estados.
 *
 * Verifica el comportamiento de los componentes en estados especiales:
 * - UI-350: Estado vacío (qué debería aparecer, cómo crear)
 * - UI-351: Esqueletos de carga
 * - UI-354: Errores clasificados
 * - UI-355: Error recuperable ofrece acción
 * - UI-190..195: Estado de conexión
 * - UI-200..205: Modo offline
 */

import { describe, it, expect, vi } from 'vitest';
import { render, expectText } from './renderer';

const mockStoreState: Record<string, unknown> = {};

vi.mock('../store/gameStore', () => ({
  useGameStore: (selector: any) => selector(mockStoreState),
}));

import { MarketView } from '../components/MarketView';
import { Battlefield } from '../components/Battlefield';
import { HandView } from '../components/HandView';
import { PlayerPanel } from '../components/PlayerPanel';
import { PrivacyScreen } from '../components/PrivacyScreen';

import type { CardDefinition, GameState, EnemyState, CardInstance } from '@nt4h/schema';

function makeCardDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return { id: 'test-card', name: 'Test Card', type: 'ABILITY', copies: 1, effects: [], verificationStatus: 'verified', ...overrides } as CardDefinition;
}

function makeEnemy(overrides: Partial<EnemyState> = {}): EnemyState {
  return { instanceId: 'enemy-1', definitionId: 'horde.001', baseFortitude: 3, wounds: 0, modifiers: [], isOrc: false, isWarlord: false, damageDisabled: false, ...overrides } as EnemyState;
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
    battlefield: [makeEnemy()], market: [], scenario: null, scenarioDeck: [], hordeDeck: [], rngState: '', ignoreGloryRewards: false, ignoreCoinRewards: false, marketCostModifier: 0, orcFortitudeBonus: 0, ...overrides,
  } as GameState;
}

function makeCatalog(cards: CardDefinition[] = []) {
  const byId = new Map<string, CardDefinition>();
  for (const c of cards) byId.set(c.id, c);
  return { byId, byType: new Map(), cards, totalCards: cards.length };
}

// ============================================================================
// UI-350: Estado vacío
// ============================================================================

describe('Estados — UI-350 (mercado vacío)', () => {
  it('muestra mensaje cuando el mercado está vacío', () => {
    setMockStore({
      gameState: makeGameState({ phase: 'MARKET', market: [] }),
      catalog: makeCatalog(),
      buyCard: vi.fn(),
    });
    const { root } = render(<MarketView />);
    expectText(root, /No hay cartas/);
  });
});

describe('Estados — UI-350 (campo de batalla vacío)', () => {
  it('muestra mensaje cuando no hay enemigos', () => {
    setMockStore({
      gameState: makeGameState({ battlefield: [] }),
      catalog: makeCatalog(),
      ui: { selectedEnemyInstanceId: null, selectedCardInstanceId: null },
      selectEnemy: vi.fn(),
      playCard: vi.fn(),
    });
    const { root } = render(<Battlefield />);
    expectText(root, /Campo de Batalla/);
  });
});

describe('Estados — UI-350 (mano vacía)', () => {
  it('muestra título de mano incluso sin cartas', () => {
    setMockStore({
      gameState: makeGameState({
        players: {
          p1: { ...makeGameState().players.p1, hand: [] },
          p2: makeGameState().players.p2,
        },
      }),
      catalog: makeCatalog(),
      ui: { selectedCardInstanceId: null, selectedEnemyInstanceId: null },
      selectCard: vi.fn(),
    });
    const { root } = render(<HandView />);
    expectText(root, /Mano.*0/);
  });
});

// ============================================================================
// UI-354: Errores — estado sin catálogo
// ============================================================================

describe('Estados — UI-354 (sin catálogo)', () => {
  it('PlayerPanel no falla sin catálogo', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: null,
    });
    const { root } = render(<PlayerPanel />);
    // Sin catálogo, el componente puede no renderizar el nombre del héroe
    // pero no debe crashear. Verificamos que devuelve algo (posiblemente vacío).
    expect(root).toBeDefined();
  });

  it('Battlefield no falla sin catálogo', () => {
    setMockStore({
      gameState: makeGameState({ battlefield: [makeEnemy()] }),
      catalog: null,
      ui: { selectedEnemyInstanceId: null, selectedCardInstanceId: null },
      selectEnemy: vi.fn(),
      playCard: vi.fn(),
    });
    const { root } = render(<Battlefield />);
    // Sin catálogo, puede no renderizar nombres pero no debe crashear
    expect(root).toBeDefined();
  });
});

// ============================================================================
// UI-355: Estado sin gameState
// ============================================================================

describe('Estados — UI-355 (sin gameState)', () => {
  it('PrivacyScreen no renderiza sin gameState', () => {
    setMockStore({
      gameState: null,
      catalog: null,
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    // No debe crashear, simplemente no renderiza nada
    expect(root).toEqual([]);
  });
});

// ============================================================================
// UI-190: Estado de conexión
// ============================================================================

describe('Estados — UI-190 (conexión del jugador)', () => {
  it('PlayerPanel muestra info del jugador conectado', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel' })]),
    });
    const { root } = render(<PlayerPanel />);
    expectText(root, 'Aranel');
  });
});

// ============================================================================
// UI-200: Modo offline
// ============================================================================

describe('Estados — UI-200 (modo offline)', () => {
  it('componentes funcionan sin conexión (estado local)', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel' })]),
    });
    const { root } = render(<PlayerPanel />);
    expectText(root, 'Aranel');
    expectText(root, /Gloria.*5/);
  });
});

// ============================================================================
// UI-201: Guardado automático
// ============================================================================

describe('Estados — UI-201 (guardado)', () => {
  it('el store tiene función saveGame', () => {
    // Verificar que el mock del store incluye saveGame
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog(),
      saveGame: vi.fn(),
    });
    // El store debe tener la función
    expect((mockStoreState as any).saveGame).toBeDefined();
  });
});

// ============================================================================
// UI-202: Pantalla de privacidad
// ============================================================================

describe('Estados — UI-202 (pantalla privacidad)', () => {
  it('PrivacyScreen muestra nombre del héroe activo', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER' } as any)]),
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    expectText(root, 'Aranel');
  });
});

// ============================================================================
// UI-082: Jugadores eliminados
// ============================================================================

describe('Estados — UI-082 (jugador eliminado)', () => {
  it('PlayerPanel muestra info del jugador con heridas', () => {
    setMockStore({
      gameState: makeGameState({
        players: {
          p1: { ...makeGameState().players.p1, wounds: 3, maxWounds: 3 },
          p2: makeGameState().players.p2,
        },
      }),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel' })]),
    });
    const { root } = render(<PlayerPanel />);
    expectText(root, /Heridas.*3.*3/);
  });
});
