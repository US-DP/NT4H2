/**
 * Nivel 9: Pruebas de componentes UI.
 *
 * Verifica que cada componente renderiza correctamente la información
 * requerida por los requisitos UI-*.
 *
 * Usa un renderizador ligero personalizado (no react-test-renderer).
 *
 * Componentes probados:
 * - CardView: UI-001, UI-002, UI-008, UI-106
 * - PlayerPanel: UI-070, UI-080, UI-085
 * - Battlefield: UI-090, UI-091, UI-093
 * - HandView: UI-100, UI-104
 * - MarketView: UI-140, UI-141, UI-350
 * - PrivacyScreen: UI-202, UI-203
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, expectText, press } from './renderer';

// Mock gameStore
const mockStoreState: Record<string, unknown> = {};

vi.mock('../store/gameStore', () => ({
  useGameStore: (selector: any) => selector(mockStoreState),
}));

// Importar componentes
import { CardView } from '../components/CardView';
import { PlayerPanel } from '../components/PlayerPanel';
import { Battlefield } from '../components/Battlefield';
import { HandView } from '../components/HandView';
import { MarketView } from '../components/MarketView';
import { PrivacyScreen } from '../components/PrivacyScreen';

import type { CardDefinition, GameState, EnemyState, CardInstance } from '@nt4h/schema';

// ============================================================================
// Helpers
// ============================================================================

function makeCardDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id: 'test-card',
    name: 'Test Card',
    type: 'ABILITY',
    copies: 1,
    effects: [],
    verificationStatus: 'verified',
    ...overrides,
  } as CardDefinition;
}

function makeEnemy(overrides: Partial<EnemyState> = {}): EnemyState {
  return {
    instanceId: 'enemy-1',
    definitionId: 'horde.001',
    baseFortitude: 3,
    wounds: 0,
    modifiers: [],
    isOrc: false,
    isWarlord: false,
    damageDisabled: false,
    ...overrides,
  } as EnemyState;
}

function makeCardInstance(overrides: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId: 'card-inst-1',
    definitionId: 'test-card',
    ownerId: 'p1',
    zone: 'HAND',
    ...overrides,
  } as CardInstance;
}

function setMockStore(state: Record<string, unknown>): void {
  Object.keys(mockStoreState).forEach(k => delete mockStoreState[k]);
  Object.assign(mockStoreState, state);
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'PLAYER_ATTACK',
    activePlayerId: 'p1',
    playerOrder: ['p1', 'p2'],
    turnNumber: 1,
    roundNumber: 1,
    mode: 'STANDARD',
    players: {
      p1: {
        heroId: 'hero.aranel', heroFace: 'FEMALE', wounds: 0, maxWounds: 3,
        glory: 5, coins: 10, shields: 0,
        hand: [makeCardInstance()], abilityDeck: [makeCardInstance({ instanceId: 'deck-1' })],
        wearPile: [], trophies: [], capabilities: ['RANGED'],
        heroUsesRemaining: 2, heroMaxUses: 2, modifiers: [],
        prevention: 0, damageCancellation: false, connected: true,
      },
      p2: {
        heroId: 'hero.feldon', heroFace: 'MALE', wounds: 1, maxWounds: 3,
        glory: 3, coins: 5, shields: 0,
        hand: [makeCardInstance({ instanceId: 'p2-card-1' })],
        abilityDeck: [], wearPile: [], trophies: [], capabilities: ['MELEE'],
        heroUsesRemaining: 1, heroMaxUses: 2, modifiers: [],
        prevention: 0, damageCancellation: false, connected: true,
      },
    },
    battlefield: [makeEnemy()], market: [], scenario: null, scenarioDeck: [],
    hordeDeck: [], rngState: '', ignoreGloryRewards: false, ignoreCoinRewards: false,
    marketCostModifier: 0, ...overrides,
  } as GameState;
}

function makeCatalog(cards: CardDefinition[] = []) {
  const byId = new Map<string, CardDefinition>();
  for (const c of cards) byId.set(c.id, c);
  return { byId, byType: new Map(), cards, totalCards: cards.length };
}

// ============================================================================
// CardView — UI-001, UI-002, UI-008, UI-106
// ============================================================================

describe('CardView — UI-001 (paleta colores)', () => {
  it('renderiza carta WARRIOR', () => {
    const card = makeCardDef({ heroClass: 'WARRIOR' });
    const { root } = render(<CardView card={card} />);
    expectText(root, 'Test Card');
  });

  it('renderiza carta EXPLORER', () => {
    const card = makeCardDef({ heroClass: 'EXPLORER', name: 'Explorer Card' });
    const { root } = render(<CardView card={card} />);
    expectText(root, 'Explorer Card');
  });

  it('renderiza carta ROGUE', () => {
    const card = makeCardDef({ heroClass: 'ROGUE', name: 'Rogue Card' });
    const { root } = render(<CardView card={card} />);
    expectText(root, 'Rogue Card');
  });

  it('renderiza carta MAGE', () => {
    const card = makeCardDef({ heroClass: 'MAGE', name: 'Mage Card' });
    const { root } = render(<CardView card={card} />);
    expectText(root, 'Mage Card');
  });
});

describe('CardView — UI-002 (no solo color)', () => {
  it('muestra el nombre de la carta como texto', () => {
    const card = makeCardDef({ name: 'Espada Legendaria' });
    const { root } = render(<CardView card={card} />);
    expectText(root, 'Espada Legendaria');
  });

  it('muestra la clase como texto adicional', () => {
    const card = makeCardDef({ heroClass: 'WARRIOR', name: 'Test' });
    const { root } = render(<CardView card={card} />);
    expectText(root, 'WARRIOR');
  });
});

describe('CardView — UI-008 (iconos coherentes)', () => {
  it('muestra icono de ataque cuando printedAttack > 0', () => {
    const card = makeCardDef({ printedAttack: 3 } as any);
    const { root } = render(<CardView card={card} />);
    expectText(root, /⚔.*3/);
  });

  it('muestra icono de fortaleza cuando está definida', () => {
    const card = makeCardDef({ printedFortitude: 5 } as any);
    const { root } = render(<CardView card={card} />);
    expectText(root, /🛡.*5/);
  });

  it('muestra icono de coste cuando está definido', () => {
    const card = makeCardDef({ printedCost: 4 } as any);
    const { root } = render(<CardView card={card} />);
    expectText(root, /💰.*4/);
  });
});

describe('CardView — UI-106 (carta seleccionada)', () => {
  it('renderiza con estilo seleccionado', () => {
    const card = makeCardDef({ name: 'Selected Card' });
    const { root } = render(<CardView card={card} selected={true} />);
    expectText(root, 'Selected Card');
  });

  it('llama onPress al pulsar', () => {
    const onPress = vi.fn();
    const card = makeCardDef({ name: 'Clickable Card' });
    const { root } = render(<CardView card={card} onPress={onPress} />);
    press(root);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// PlayerPanel — UI-070, UI-080, UI-085
// ============================================================================

describe('PlayerPanel — UI-080 (panel resumido)', () => {
  beforeEach(() => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel' })]),
    });
  });

  it('muestra el nombre del héroe', () => {
    const { root } = render(<PlayerPanel />);
    expectText(root, 'Aranel');
  });

  it('muestra la fase actual (UI-070)', () => {
    const { root } = render(<PlayerPanel />);
    expectText(root, /Fase.*PLAYER_ATTACK/);
  });

  it('muestra gloria del jugador', () => {
    const { root } = render(<PlayerPanel />);
    expectText(root, /Gloria.*5/);
  });

  it('muestra monedas del jugador', () => {
    const { root } = render(<PlayerPanel />);
    expectText(root, /Monedas.*10/);
  });

  it('muestra heridas del jugador (UI-093)', () => {
    const { root } = render(<PlayerPanel />);
    expectText(root, /Heridas.*0.*3/);
  });

  it('muestra tamaño del mazo', () => {
    const { root } = render(<PlayerPanel />);
    expectText(root, /Mazo.*1/);
  });

  it('muestra tamaño de la mano', () => {
    const { root } = render(<PlayerPanel />);
    expectText(root, /Mano.*1/);
  });

  it('muestra tamaño del desgaste', () => {
    const { root } = render(<PlayerPanel />);
    expectText(root, /Desgaste.*0/);
  });
});

describe('PlayerPanel — UI-085 (usos limitados)', () => {
  it('muestra pericias restantes / máximo', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel' })]),
    });
    const { root } = render(<PlayerPanel />);
    expectText(root, /Pericias.*2.*2/);
  });
});

// ============================================================================
// Battlefield — UI-090, UI-091, UI-093
// ============================================================================

describe('Battlefield — UI-090 (zona central)', () => {
  beforeEach(() => {
    setMockStore({
      gameState: makeGameState({
        battlefield: [
          makeEnemy({ instanceId: 'e1', baseFortitude: 3, wounds: 1 }),
          makeEnemy({ instanceId: 'e2', baseFortitude: 5, wounds: 0 }),
        ],
      }),
      catalog: makeCatalog([makeCardDef({ id: 'horde.001', name: 'Orco' })]),
      ui: { selectedEnemyInstanceId: null, selectedCardInstanceId: null },
      selectEnemy: vi.fn(),
      playCard: vi.fn(),
    });
  });

  it('muestra título "Campo de Batalla" con número de enemigos', () => {
    const { root } = render(<Battlefield />);
    expectText(root, /Campo de Batalla.*2/);
  });

  it('muestra el nombre de cada enemigo (UI-091)', () => {
    const { root } = render(<Battlefield />);
    expectText(root, 'Orco');
  });

  it('muestra fortaleza y heridas numéricamente (UI-093)', () => {
    const { root } = render(<Battlefield />);
    expectText(root, /🛡.*3.*Heridas: 1/);
  });

  it('muestra indicador de Señor de la Guerra para warlords', () => {
    setMockStore({
      gameState: makeGameState({ battlefield: [makeEnemy({ instanceId: 'e1', isWarlord: true })] }),
      catalog: makeCatalog([makeCardDef({ id: 'horde.001', name: 'Warlord' })]),
      ui: { selectedEnemyInstanceId: null, selectedCardInstanceId: null },
      selectEnemy: vi.fn(),
      playCard: vi.fn(),
    });
    const { root } = render(<Battlefield />);
    expectText(root, 'SEÑOR');
  });

  it('muestra indicador SIN DAÑO cuando damageDisabled', () => {
    setMockStore({
      gameState: makeGameState({ battlefield: [makeEnemy({ instanceId: 'e1', damageDisabled: true })] }),
      catalog: makeCatalog([makeCardDef({ id: 'horde.001', name: 'Enemy' })]),
      ui: { selectedEnemyInstanceId: null, selectedCardInstanceId: null },
      selectEnemy: vi.fn(),
      playCard: vi.fn(),
    });
    const { root } = render(<Battlefield />);
    expectText(root, 'SIN DAÑO');
  });
});

// ============================================================================
// HandView — UI-100, UI-104
// ============================================================================

describe('HandView — UI-100 (zona inferior)', () => {
  beforeEach(() => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'test-card', name: 'Hand Card' })]),
      ui: { selectedCardInstanceId: null, selectedEnemyInstanceId: null },
      selectCard: vi.fn(),
    });
  });

  it('muestra título "Mano" con número de cartas', () => {
    const { root } = render(<HandView />);
    expectText(root, /Mano.*1/);
  });

  it('muestra las cartas de la mano del jugador activo', () => {
    const { root } = render(<HandView />);
    expectText(root, 'Hand Card');
  });
});

describe('HandView — UI-104 (selección no auto-juega)', () => {
  it('llama a selectCard al pulsar, no a playCard', () => {
    const selectCard = vi.fn();
    const playCard = vi.fn();
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'test-card', name: 'My Card' })]),
      ui: { selectedCardInstanceId: null, selectedEnemyInstanceId: null },
      selectCard,
      playCard,
    });
    const { root } = render(<HandView />);
    press(root);
    expect(selectCard).toHaveBeenCalledTimes(1);
    expect(playCard).not.toHaveBeenCalled();
  });
});

// ============================================================================
// MarketView — UI-140, UI-141, UI-350
// ============================================================================

describe('MarketView — UI-140 (fila diferenciada)', () => {
  it('muestra título "Mercado" con número de cartas', () => {
    setMockStore({
      gameState: makeGameState({
        phase: 'MARKET',
        market: [makeCardInstance({ instanceId: 'm1', definitionId: 'market.dagger' })],
      }),
      catalog: makeCatalog([makeCardDef({ id: 'market.dagger', name: 'Daga', printedCost: 3 } as any)]),
      buyCard: vi.fn(),
    });
    const { root } = render(<MarketView />);
    expectText(root, /Mercado.*1/);
  });

  it('muestra monedas del jugador (UI-141)', () => {
    setMockStore({
      gameState: makeGameState({
        phase: 'MARKET',
        market: [makeCardInstance({ instanceId: 'm1', definitionId: 'market.dagger' })],
      }),
      catalog: makeCatalog([makeCardDef({ id: 'market.dagger', name: 'Daga', printedCost: 3 } as any)]),
      buyCard: vi.fn(),
    });
    const { root } = render(<MarketView />);
    expectText(root, /💰.*10/);
  });

  it('muestra el coste de cada artículo (UI-141)', () => {
    setMockStore({
      gameState: makeGameState({
        phase: 'MARKET',
        market: [makeCardInstance({ instanceId: 'm1', definitionId: 'market.dagger' })],
      }),
      catalog: makeCatalog([makeCardDef({ id: 'market.dagger', name: 'Daga', printedCost: 3 } as any)]),
      buyCard: vi.fn(),
    });
    const { root } = render(<MarketView />);
    expectText(root, /💰.*3/);
  });
});

describe('MarketView — UI-350 (estado vacío)', () => {
  it('muestra mensaje cuando el mercado está vacío', () => {
    setMockStore({
      gameState: makeGameState({ phase: 'MARKET', market: [] }),
      catalog: makeCatalog(),
      buyCard: vi.fn(),
    });
    const { root } = render(<MarketView />);
    expectText(root, /No hay cartas/);
  });

  it('muestra pista cuando no es fase de mercado', () => {
    setMockStore({
      gameState: makeGameState({ phase: 'PLAYER_ATTACK', market: [makeCardInstance({ instanceId: 'm1', definitionId: 'market.dagger' })] }),
      catalog: makeCatalog([makeCardDef({ id: 'market.dagger', name: 'Daga', printedCost: 3 } as any)]),
      buyCard: vi.fn(),
    });
    const { root } = render(<MarketView />);
    expectText(root, /solo está disponible/);
  });
});

describe('MarketView — UI-P04 (prevención errores)', () => {
  it('muestra el coste incluso sin monedas suficientes', () => {
    setMockStore({
      gameState: makeGameState({
        phase: 'MARKET',
        players: {
          p1: { ...makeGameState().players.p1, coins: 1 },
          p2: makeGameState().players.p2,
        },
        market: [makeCardInstance({ instanceId: 'm1', definitionId: 'market.expensive' })],
      }),
      catalog: makeCatalog([makeCardDef({ id: 'market.expensive', name: 'Caro', printedCost: 5 } as any)]),
      buyCard: vi.fn(),
    });
    const { root } = render(<MarketView />);
    expectText(root, /💰.*5/);
  });
});

// ============================================================================
// PrivacyScreen — UI-202, UI-203
// ============================================================================

describe('PrivacyScreen — UI-202 (pantalla privacidad hot-seat)', () => {
  it('muestra "Pasa el dispositivo"', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER' } as any)]),
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    expectText(root, 'Pasa el dispositivo');
  });

  it('muestra el nombre del héroe activo', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER' } as any)]),
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    expectText(root, 'Aranel');
  });

  it('muestra advertencia de privacidad', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER' } as any)]),
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    expectText(root, /nadie mas este mirando/);
  });

  it('llama a passPrivacy al pulsar "Estoy listo"', () => {
    const passPrivacy = vi.fn();
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER' } as any)]),
      passPrivacy,
    });
    const { root } = render(<PrivacyScreen />);
    press(root);
    expect(passPrivacy).toHaveBeenCalledTimes(1);
  });
});
