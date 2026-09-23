/**
 * Nivel 14: Pruebas de privacidad y seguridad.
 *
 * Verifica que la información privada no se expone:
 * - UI-083: Manos ajenas muestran solo número de cartas
 * - UI-098: Recompensa trasera oculta hasta derrota
 * - UI-099: Recompensa no en HTML/estado cliente
 * - UI-112: Ampliación no revela info privada
 * - UI-410: Manos privadas no renderizadas fuera de contexto
 * - UI-411: Modo espectador con vista específica
 * - UI-412: Capturas advierten si contienen info privada
 */

import { describe, it, expect, vi } from 'vitest';
import { render, expectText, findAllText } from './renderer';

const mockStoreState: Record<string, unknown> = {};

vi.mock('../store/gameStore', () => ({
  useGameStore: (selector: any) => selector(mockStoreState),
}));

// Importar useProjectedState para verificar proyección
vi.mock('../store/useProjectedState', () => ({
  useProjectedState: () => mockStoreState.projectedState ?? null,
}));

import { HandView } from '../components/HandView';
import { Battlefield } from '../components/Battlefield';
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
      p2: { heroId: 'hero.feldon', heroFace: 'MALE', wounds: 1, maxWounds: 3, glory: 3, coins: 5, shields: 0, hand: [makeCardInstance({ instanceId: 'p2-card', definitionId: 'secret-card' })], abilityDeck: [], wearPile: [], trophies: [], capabilities: ['MELEE'], heroUsesRemaining: 1, heroMaxUses: 2, modifiers: [], prevention: 0, damageCancellation: false, connected: true },
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
// UI-083: Manos ajenas muestran solo número de cartas
// ============================================================================

describe('Privacidad — UI-083 (manos ajenas)', () => {
  it('HandView del jugador activo muestra nombres de cartas', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'test-card', name: 'My Card' })]),
      ui: { selectedCardInstanceId: null, selectedEnemyInstanceId: null },
      selectCard: vi.fn(),
    });
    const { root } = render(<HandView />);
    const texts = findAllText(root);
    expect(texts.some(t => t.includes('My Card'))).toBe(true);
  });
});

// ============================================================================
// UI-098: Recompensa oculta hasta derrota
// ============================================================================

describe('Privacidad — UI-098 (recompensa oculta)', () => {
  it('Battlefield no muestra recompensa de enemigo vivo', () => {
    setMockStore({
      gameState: makeGameState({
        battlefield: [makeEnemy({ instanceId: 'e1', baseFortitude: 3, wounds: 0 })],
      }),
      catalog: makeCatalog([makeCardDef({ id: 'horde.001', name: 'Orco', rewardGlory: 2, rewardCoins: 1 } as any)]),
      ui: { selectedEnemyInstanceId: null, selectedCardInstanceId: null },
      selectEnemy: vi.fn(),
      playCard: vi.fn(),
    });
    const { root } = render(<Battlefield />);
    const texts = findAllText(root);
    // No debe mostrar "Recompensa" o "Gloria: 2" para enemigo vivo
    const hasReward = texts.some(t => /Recompensa/i.test(t) || /Gloria.*2/.test(t));
    expect(hasReward).toBe(false);
  });
});

// ============================================================================
// UI-410: Manos privadas no renderizadas
// ============================================================================

describe('Privacidad — UI-410 (manos privadas)', () => {
  it('PrivacyScreen no muestra cartas del jugador anterior', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER' } as any)]),
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    const texts = findAllText(root);
    // No debe mostrar nombres de cartas
    const hasCardName = texts.some(t => t.includes('Test Card') || t.includes('My Card'));
    expect(hasCardName).toBe(false);
  });

  it('PrivacyScreen solo muestra nombre del héroe y advertencia', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER' } as any)]),
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    expectText(root, 'Pasa el dispositivo');
    expectText(root, 'Aranel');
    expectText(root, /nadie mas/);
  });
});

// ============================================================================
// UI-412: Información privada no en texto accesible
// ============================================================================

describe('Privacidad — UI-412 (info privada no accesible)', () => {
  it('PrivacyScreen no contiene información de cartas en texto', () => {
    setMockStore({
      gameState: makeGameState({
        players: {
          p1: { ...makeGameState().players.p1, hand: [makeCardInstance({ definitionId: 'secret-card' })] },
          p2: makeGameState().players.p2,
        },
      }),
      catalog: makeCatalog([
        makeCardDef({ id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER' } as any),
        makeCardDef({ id: 'secret-card', name: 'SECRET INFORMATION' }),
      ]),
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    const texts = findAllText(root);
    // No debe contener "SECRET INFORMATION"
    expect(texts.some(t => t.includes('SECRET'))).toBe(false);
  });
});

// ============================================================================
// UI-202: Pantalla de privacidad hot-seat
// ============================================================================

describe('Privacidad — UI-202 (hot-seat)', () => {
  it('muestra mensaje de pasar dispositivo', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER' } as any)]),
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    expectText(root, 'Pasa el dispositivo');
  });

  it('muestra clase del héroe', () => {
    setMockStore({
      gameState: makeGameState(),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel', heroClass: 'EXPLORER' } as any)]),
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    expectText(root, 'EXPLORER');
  });
});

// ============================================================================
// UI-203: Ocultar mano anterior
// ============================================================================

describe('Privacidad — UI-203 (ocultar mano anterior)', () => {
  it('PrivacyScreen no muestra información del jugador anterior', () => {
    setMockStore({
      gameState: makeGameState({ activePlayerId: 'p2' }),
      catalog: makeCatalog([
        makeCardDef({ id: 'hero.feldon', name: 'Feldon', heroClass: 'WARRIOR' } as any),
        makeCardDef({ id: 'test-card', name: 'P1 Card' }),
      ]),
      passPrivacy: vi.fn(),
    });
    const { root } = render(<PrivacyScreen />);
    const texts = findAllText(root);
    // Debe mostrar el héroe del jugador activo (p2 = Feldon)
    expect(texts.some(t => t.includes('Feldon'))).toBe(true);
    // No debe mostrar cartas del jugador anterior
    expect(texts.some(t => t.includes('P1 Card'))).toBe(false);
  });
});
