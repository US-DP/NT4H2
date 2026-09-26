/**
 * Taller — verificación en partida (no solo engine).
 *
 * Comprueba que los efectos de fase 2 del Taller son visibles y
 * accionables en la interfaz durante una partida real:
 *
 * - DISCARD_FROM_HAND → el resolver emite pendingChoice
 *   SELECT_CARD_FROM_HAND → PendingChoiceView la renderiza con
 *   las cartas de la mano y RESOLVE_CHOICE sale por el store.
 * - BLOCK_NEXT_DAMAGE → el desglose de la Horda descuenta el
 *   bloqueo, el banner previo lo muestra y GameStatusPanel/HeroStatusBar
 *   lo reflejan junto a escudos/prevención.
 * - REGISTER_LISTENER → los oyentes del jugador activo son visibles
 *   en GameStatusPanel.
 *
 * El estado se inyecta igual que en flow.test.tsx (store mockeado),
 * pero los objetos replican literalmente lo que emite el motor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ReactModule from 'react';
import { render, expectText } from './renderer';

// Hooks funcionales sin React fiber (mismo patrón que study.test.tsx)
const hookState: { values: any[]; index: number } = { values: [], index: 0 };

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof ReactModule>('react');
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)): [T, (v: T) => void] => {
      const idx = hookState.index++;
      if (hookState.values[idx] === undefined) {
        hookState.values[idx] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setter = (v: T | ((prev: T) => T)) => {
        hookState.values[idx] = typeof v === 'function'
          ? (v as (prev: T) => T)(hookState.values[idx])
          : v;
      };
      return [hookState.values[idx], setter];
    },
    useMemo: <T,>(factory: () => T, _deps: any[]): T => factory(),
    useCallback: <T,>(cb: T, _deps: any[]): T => cb,
    useEffect: (_fn: any, _deps?: any[]) => {},
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});

function pressByLabel(nodes: any[], label: string | RegExp): void {
  const match = (l: unknown) =>
    typeof label === 'string' ? l === label : typeof l === 'string' && label.test(l);
  function walk(node: any): boolean {
    if (node.props?.onPress && match(node.props?.accessibilityLabel)) {
      node.props.onPress();
      return true;
    }
    return (node.children ?? []).some(walk);
  }
  if (!nodes.some(walk)) throw new Error(`No pressable with label: ${String(label)}`);
}

const mockStoreState: Record<string, unknown> = {};

vi.mock('../store/gameStore', () => ({
  useGameStore: (selector: any) => selector(mockStoreState),
}));

import { PendingChoiceView } from '../components/PendingChoiceView';
import { GameStatusPanel } from '../components/GameStatusPanel';
import { ContextBanner } from '../components/game/ContextBanner';
import { Battlefield } from '../components/Battlefield';
import { PlayerPanel } from '../components/PlayerPanel';

import type { CardDefinition, GameState, CardInstance } from '@nt4h/schema';

function makeCardDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id: 'test-card', name: 'Carta', type: 'ABILITY', copies: 1, effects: [],
    verificationStatus: 'verified', ...overrides,
  } as CardDefinition;
}

function makeCardInstance(overrides: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId: 'hand-1', definitionId: 'test-card', ownerId: 'p1', zone: 'HAND',
    ...overrides,
  } as CardInstance;
}

function makePlayer(overrides: Record<string, unknown> = {}) {
  return {
    playerId: 'p1',
    heroId: 'hero.aranel', heroFace: 'FEMALE' as const, wounds: 0, maxWounds: 3,
    glory: 5, coins: 10, shields: 0, armor: 0, hand: [makeCardInstance()],
    abilityDeck: [], wearPile: [], trophies: [], capabilities: ['RANGED' as const],
    heroUsesRemaining: 2, heroMaxUses: 2, modifiers: [], prevention: 0,
    damageCancellation: false, connected: true, interceptedBy: null,
    cardsPlayedThisTurn: {}, cardsPlayedAgainstEnemy: {},
    persistentCards: [], supportDecks: [], ...overrides,
  };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'PLAYER_ATTACK', activePlayerId: 'p1', playerOrder: ['p1'],
    turnNumber: 1, roundNumber: 1, mode: 'STANDARD',
    players: { p1: makePlayer() },
    battlefield: [], market: [], scenario: null, scenarioDeck: [], hordeDeck: [],
    rngState: '', pendingChoices: [], ignoreGloryRewards: false,
    ignoreCoinRewards: false, marketCostModifier: 0, orcFortitudeBonus: 0,
    ...overrides,
  } as GameState;
}

function makeCatalog(cards: CardDefinition[] = []) {
  const byId = new Map<string, CardDefinition>();
  for (const c of cards) byId.set(c.id, c);
  return { byId, byType: new Map(), cards, totalCards: cards.length };
}

function setMockStore(state: Record<string, unknown>): void {
  Object.keys(mockStoreState).forEach(k => delete mockStoreState[k]);
  Object.assign(mockStoreState, state);
}

beforeEach(() => {
  hookState.values = [];
  hookState.index = 0;
});

// ============================================================================
// DISCARD_FROM_HAND — elección real del jugador en mesa
// ============================================================================

describe('Mid-game — DISCARD_FROM_HAND (elección de descarte)', () => {
  const hand = [
    makeCardInstance({ instanceId: 'h1', definitionId: 'c.a' }),
    makeCardInstance({ instanceId: 'h2', definitionId: 'c.b' }),
  ];

  it('la pendingChoice del resolver se renderiza con las cartas de la mano', () => {
    // Réplica de la PendingChoice que emite resolver.ts para DISCARD_FROM_HAND
    setMockStore({
      gameState: makeGameState({
        players: { p1: makePlayer({ hand }) },
        pendingChoices: [{
          choiceId: 'fx-discard-cardA-99',
          playerId: 'p1',
          type: 'SELECT_CARD_FROM_HAND',
          prompt: 'Maldición: descarta 1 carta(s)',
          options: ['h1', 'h2'],
          minSelections: 1,
          maxSelections: 1,
          resolutionContext: {
            activePlayerId: 'p1', currentCardId: 'c.x', currentCardName: 'Maldición',
            currentCardInstanceId: 'inst-x', selectedEnemyId: null,
            cardsPlayedThisTurn: {}, cardsPlayedAgainstEnemy: {},
            drawnCardInstanceId: null, sourceZone: 'HAND',
            enemiesDefeatedThisResolution: [], depth: 1,
          },
        }],
      }),
      catalog: makeCatalog([
        makeCardDef({ id: 'c.a', name: 'Daga' }),
        makeCardDef({ id: 'c.b', name: 'Escudo' }),
      ]),
      viewerId: 'p1',
      resolvePendingChoice: vi.fn(),
      chooseLeaderCards: vi.fn(),
    });
    const { root } = render(<PendingChoiceView />);
    expectText(root, 'Maldición: descarta 1 carta(s)');
    expectText(root, 'Elige 1');
    expectText(root, /Daga/);
    expectText(root, /Escudo/);
  });

  it('seleccionar una carta y confirmar envía RESOLVE_CHOICE al store', () => {
    const resolvePendingChoice = vi.fn();
    setMockStore({
      gameState: makeGameState({
        players: { p1: makePlayer({ hand }) },
        pendingChoices: [{
          choiceId: 'fx-discard-cardA-99',
          playerId: 'p1',
          type: 'SELECT_CARD_FROM_HAND',
          prompt: 'Maldición: descarta 1 carta(s)',
          options: ['h1', 'h2'],
          minSelections: 1,
          maxSelections: 1,
        }],
      }),
      catalog: makeCatalog([
        makeCardDef({ id: 'c.a', name: 'Daga' }),
        makeCardDef({ id: 'c.b', name: 'Escudo' }),
      ]),
      viewerId: 'p1',
      resolvePendingChoice,
      chooseLeaderCards: vi.fn(),
    });
    const { root } = render(<PendingChoiceView />);
    pressByLabel(root, /Daga/);
    // El setter no re-renderiza: se reinicia el índice de hooks y se
    // vuelve a invocar el componente con selected=['h1']
    hookState.index = 0;
    const { root: root2 } = render(<PendingChoiceView />);
    pressByLabel(root2, 'Confirmar selección');
    expect(resolvePendingChoice).toHaveBeenCalledWith('fx-discard-cardA-99', ['h1']);
  });
});

// ============================================================================
// CHOOSE_ONE → CHOOSE_EFFECT — ramas como opciones textuales
// ============================================================================

describe('Mid-game — CHOOSE_ONE (elección de rama)', () => {
  const chooseState = () => makeGameState({
    players: { p1: makePlayer() },
    pendingChoices: [{
      choiceId: 'choose-c1-77',
      playerId: 'p1',
      type: 'CHOOSE_EFFECT',
      prompt: 'Versátil: elige un efecto',
      options: ['Ganar 2 Monedas', 'Robar 1 carta', 'No hacer nada'],
      minSelections: 1,
      maxSelections: 1,
    }],
  } as any);

  it('las ramas del CHOOSE_ONE se muestran como opciones legibles', () => {
    setMockStore({
      gameState: chooseState(),
      catalog: makeCatalog(),
      viewerId: 'p1',
      resolvePendingChoice: vi.fn(),
      chooseLeaderCards: vi.fn(),
    });
    const { root } = render(<PendingChoiceView />);
    expectText(root, 'Versátil: elige un efecto');
    expectText(root, 'Ganar 2 Monedas');
    expectText(root, 'Robar 1 carta');
    expectText(root, 'No hacer nada');
  });

  it('confirmar devuelve la etiqueta elegida al motor (indexOf sobre options)', () => {
    const resolvePendingChoice = vi.fn();
    setMockStore({
      gameState: chooseState(),
      catalog: makeCatalog(),
      viewerId: 'p1',
      resolvePendingChoice,
      chooseLeaderCards: vi.fn(),
    });
    const { root } = render(<PendingChoiceView />);
    pressByLabel(root, 'Robar 1 carta');
    hookState.index = 0;
    const { root: root2 } = render(<PendingChoiceView />);
    pressByLabel(root2, 'Confirmar selección');
    // El motor busca options.indexOf('Robar 1 carta') → rama 1
    expect(resolvePendingChoice).toHaveBeenCalledWith('choose-c1-77', ['Robar 1 carta']);
  });
});

// ============================================================================
// Etiquetas de opciones — cada zona del tablero se resuelve a nombres
// ============================================================================

describe('Mid-game — etiquetas de opciones en PendingChoiceView', () => {
  const baseChoice = (over: Record<string, unknown>) => ({
    choiceId: 'c-1', playerId: 'p1', type: 'SELECT_CARD_FROM_WEAR',
    prompt: 'Elige', options: [], minSelections: 1, maxSelections: 1, ...over,
  });

  const catalog = () => makeCatalog([
    makeCardDef({ id: 'hero.aranel', name: 'Aranel' }),
    makeCardDef({ id: 'hero.feldon', name: 'Feldon' }),
    makeCardDef({ id: 'c.wear', name: 'Poción' }),
    makeCardDef({ id: 'c.horde', name: 'Trasgo' }),
    makeCardDef({ id: 'c.market', name: 'Lanza' }),
    makeCardDef({ id: 'c.trophy', name: 'Gnoll' }),
  ]);

  function renderChoice(choice: Record<string, unknown>, stateOver: Record<string, unknown> = {}) {
    setMockStore({
      gameState: makeGameState({ pendingChoices: [choice], ...stateOver } as any),
      catalog: catalog(),
      viewerId: 'p1',
      resolvePendingChoice: vi.fn(),
      chooseLeaderCards: vi.fn(),
    });
    return render(<PendingChoiceView />);
  }

  it('SELECT_CARD_FROM_WEAR resuelve el nombre de la carta del Desgaste', () => {
    const { root } = renderChoice(baseChoice({ options: ['w1'] }), {
      players: { p1: makePlayer({ hand: [], wearPile: [makeCardInstance({ instanceId: 'w1', definitionId: 'c.wear' })] }) },
    });
    expectText(root, 'Poción');
  });

  it('SELECT_ORDER (Idril) resuelve nombres del mazo de la Horda', () => {
    const { root } = renderChoice(baseChoice({
      type: 'SELECT_ORDER', options: ['hd1'], minSelections: 1, maxSelections: 1,
    }), {
      hordeDeck: [makeCardInstance({ instanceId: 'hd1', definitionId: 'c.horde' })],
    });
    expectText(root, 'Trasgo');
  });

  it('SEARCH_MARKET_DECK resuelve nombres del mazo de Mercado', () => {
    const { root } = renderChoice(baseChoice({
      type: 'SEARCH_MARKET_DECK', options: ['md1'],
    }), {
      marketDeck: [makeCardInstance({ instanceId: 'md1', definitionId: 'c.market' })],
    });
    expectText(root, 'Lanza');
  });

  it('SELECT_HERO (empate) muestra el nombre del héroe, no su id', () => {
    const { root } = renderChoice(baseChoice({
      type: 'SELECT_HERO', options: ['p1', 'p2'],
    }), {
      players: {
        p1: makePlayer(),
        p2: { ...makePlayer(), playerId: 'p2', heroId: 'hero.feldon' },
      },
    });
    expectText(root, 'Héroe: Aranel');
    expectText(root, 'Héroe: Feldon');
  });

  it('CONFIRM yes/no muestra etiquetas localizadas', () => {
    const { root } = renderChoice(baseChoice({
      type: 'CONFIRM', options: ['yes', 'no'],
    }));
    expectText(root, 'Sí');
    expectText(root, 'No');
  });

  it('SELECT_COINS_TO_STEAL (p2#coin0) nombra al héroe origen', () => {
    const { root } = renderChoice(baseChoice({
      type: 'SELECT_COINS_TO_STEAL', options: ['p2#coin0', 'p2#coin1'],
    }), {
      players: {
        p1: makePlayer(),
        p2: { ...makePlayer(), playerId: 'p2', heroId: 'hero.feldon' },
      },
    });
    expectText(root, 'Héroe: Feldon');
  });

  it('CONFIRM de trofeo (Ulthar) resuelve el nombre del enemigo derrotado', () => {
    const { root } = renderChoice(baseChoice({
      type: 'CONFIRM', options: ['trophy-1'],
    }), {
      eventLog: [{ type: 'ENEMY_DEFEATED', enemyInstanceId: 'trophy-1', enemyDefinitionId: 'c.trophy', seq: 1 }],
    });
    expectText(root, 'Gnoll');
  });
});

// ============================================================================
// BLOCK_NEXT_DAMAGE — visible en la previa de la Horda y el panel de estado
// ============================================================================

describe('Mid-game — BLOCK_NEXT_DAMAGE (bloqueo visible)', () => {
  it('el banner de previa de la Horda muestra el bloqueo armado', () => {
    const { root } = render(
      <ContextBanner
        horde={{
          incoming: 8,
          shields: 2,
          block: 3,
          afterDefense: 3,
          willExhaust: false,
        }}
      />,
    );
    expectText(root, /8/);
    expectText(root, /2 escudos/);
    expectText(root, /3 bloqueo/);
    expectText(root, /= 3 cartas de desgaste/);
  });

  it('GameStatusPanel muestra bloqueo, armadura y oyentes del héroe', () => {
    setMockStore({
      gameState: makeGameState({
        players: { p1: makePlayer({ blockNext: 4, armor: 1 }) },
        listeners: [
          { id: 'lis-1', playerId: 'p1', trigger: 'ENEMY_DEFEATED', once: false, duration: 'THIS_TURN', effects: [] },
          { id: 'lis-2', playerId: 'p2', trigger: 'HERO_WOUNDED', once: true, duration: 'GAME', effects: [] },
        ],
      } as any),
      catalog: makeCatalog([makeCardDef({ id: 'hero.aranel', name: 'Aranel' })]),
    });
    const { root } = render(<GameStatusPanel />);
    expectText(root, /Bloqueo 4/);
    expectText(root, /Armadura 1/);
    // Solo se listan los oyentes del jugador activo (lis-1, no lis-2)
    expectText(root, /Oyentes \(1\): ENEMY_DEFEATED/);
  });
});

// ============================================================================
// PlayerPanel — defensas y cartas persistentes visibles para todos
// ============================================================================

describe('Mid-game — PlayerPanel (defensas y persistentes)', () => {
  it('muestra bloqueo, armadura y cartas persistentes del héroe', () => {
    setMockStore({
      gameState: makeGameState({
        players: {
          p1: makePlayer({
            blockNext: 4, armor: 1,
            persistentCards: [makeCardInstance({ instanceId: 'pc1', definitionId: 'c.trap' })],
          }),
        },
      } as any),
      catalog: makeCatalog([
        makeCardDef({ id: 'hero.aranel', name: 'Aranel' }),
        makeCardDef({ id: 'c.trap', name: 'Trampa de Fuego' }),
      ]),
      viewerId: 'p1',
    });
    const { root } = render(<PlayerPanel />);
    expectText(root, /⛨ 4/);
    expectText(root, /⛉ 1/);
    expectText(root, /Trampa de Fuego/);
  });
});

// ============================================================================
// APPLY_STATUS — estados del Taller visibles en el campo de batalla
// ============================================================================

describe('Mid-game — APPLY_STATUS (estados en el campo)', () => {
  it('el enemigo muestra sus estados (stun, mark…) junto a sus iconos', () => {
    setMockStore({
      gameState: makeGameState({
        battlefield: [{
          instanceId: 'e1', definitionId: 'horde.001', baseFortitude: 4,
          wounds: 0, modifiers: [], isOrc: false, isWarlord: false,
          damageDisabled: false,
          statuses: [
            { id: 'stun', stacks: 1, duration: 'PERMANENT' },
            { id: 'vulnerable', stacks: 2, duration: 'PERMANENT' },
          ],
        }],
      } as any),
      catalog: makeCatalog([makeCardDef({ id: 'horde.001', name: 'Orco' })]),
      ui: { selectedEnemyInstanceId: null, selectedCardInstanceId: null },
      selectEnemy: vi.fn(),
      playCard: vi.fn(),
    });
    const { root } = render(<Battlefield />);
    expectText(root, 'Orco');
    expectText(root, /Estados: stun, vulnerable ×2/);
  });
});
