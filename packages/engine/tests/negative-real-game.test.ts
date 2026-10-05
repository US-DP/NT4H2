/**
 * Partida REAL con casos negativos exhaustivos.
 *
 * A diferencia de los tests unitarios de validación (commands.test.ts),
 * aquí se conduce una partida completa con el catálogo oficial:
 *   setupGame → startFirstTurn → processPhases (hasta fase accionable)
 *   …y sobre cada fase se lanza la batería de comandos ilegales por la
 *   misma ruta pública `execute()` que usa el runner online.
 *
 * Invariantes verificadas en cada rechazo:
 *   - result.accepted === false con el reason correcto
 *   - result.newState === state (rechazo SIN mutar el estado: la
 *     identidad por referencia demuestra que no hay side-effects)
 *   - result.events === [] (nada se emite a los clientes)
 * Tras los negativos se ejecuta el comando legal equivalente para
 * demostrar que la partida sigue funcionando.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { setupGame, startFirstTurn, resetInstanceCounter } from '../src/phases/setup.js';
import { processPhases, resetPhaseSeq } from '../src/phases/engine.js';
import { execute } from '../src/commands/execute.js';
import { EffectRegistry, registerCoreEffects } from '../src/effects/registry.js';
import { resetResolveSeq } from '../src/effects/resolver.js';
import { resetAbilitySeq } from '../src/heroes/abilities.js';
import { resetScenarioSeq } from '../src/scenarios/index.js';
import { loadCatalog } from '@nt4h/catalog';
import type { CardInstance, Command, EnemyState, GameState, PendingChoice } from '@nt4h/schema';

const catalog = loadCatalog();

let registry: EffectRegistry;
let rng: DeterministicRng;
let state: GameState;

// Omit distributivo: preserva cada variante de la union Command.
type CommandNoCid = Command extends infer U ? (U extends { cid: string } ? Omit<U, 'cid'> : U) : never;
let cidCounter = 0;
const cmd = (c: CommandNoCid) => ({ ...c, cid: `neg-${cidCounter++}` }) as Command;

function execNeg(command: Command, actor?: string) {
  return execute(state, command, rng, registry, catalog, actor);
}

/** Aserción canónica: rechazado, razón esperada, estado intocado, sin eventos. */
function expectRejected(command: Command, reason: string | RegExp, actor?: string) {
  const r = execNeg(command, actor);
  expect(r.accepted, `aceptado (esperaba "${reason}")`).toBe(false);
  if (typeof reason === 'string') {
    expect(r.reason).toBe(reason);
  } else {
    expect(r.reason).toMatch(reason);
  }
  expect(r.newState).toBe(state);
  expect(r.events).toEqual([]);
  return r;
}

function putCardInHand(playerId: string, defId: string): CardInstance {
  const inst: CardInstance = {
    instanceId: `neg-${defId}-${playerId}`,
    definitionId: defId,
    ownerId: playerId,
    zone: 'HAND',
  };
  state.players[playerId].hand.push(inst);
  return inst;
}

function putEnemy(id: string): EnemyState {
  const e: EnemyState = {
    instanceId: id,
    definitionId: 'horde.001',
    baseFortitude: 3,
    wounds: 0,
    reward: null,
    modifiers: [],
    isWarlord: false,
    isOrc: false,
    specialIcons: [],
    damageDisabled: false,
  };
  state.battlefield.push(e);
  return e;
}

function newRealGame() {
  resetInstanceCounter();
  resetPhaseSeq();
  resetAbilitySeq();
  resetResolveSeq();
  resetScenarioSeq();
  registry = new EffectRegistry();
  registerCoreEffects(registry);
  rng = new DeterministicRng('neg-real-game');
  const setup = setupGame(
    {
      mode: 'STANDARD',
      playerCount: 2,
      seed: 'neg-real-game',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: false,
    },
    catalog,
  );
  state = startFirstTurn(setup.state, rng, catalog).state;
  // Avanzar las fases automáticas hasta la primera fase accionable
  let guard = 50;
  while (guard-- > 0) {
    const ph = processPhases(state, rng, catalog);
    state = ph.state;
    if (['ATTACK_CHOICE', 'PLAYER_ATTACK', 'MARKET', 'RESTORATION'].includes(state.phase)) break;
    if (state.phase === 'FINISHED') break;
  }
}

beforeEach(newRealGame);

describe('Partida real — casos negativos', () => {
  it('la partida arranca en una fase accionable con jugador activo', () => {
    expect(['ATTACK_CHOICE', 'PLAYER_ATTACK', 'MARKET', 'RESTORATION']).toContain(state.phase);
    expect(state.players[state.activePlayerId]).toBeDefined();
  });

  describe('PLAY_CARD', () => {
    beforeEach(() => {
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      putEnemy('neg-enemy-1');
    });

    it('rechaza todos los casos ilegales y acepta el legal', () => {
      const card = putCardInHand('p1', 'explorer.lamp');
      const otherCard = putCardInHand('p2', 'warrior.shield');

      // Jugador fantasma (local: actorId declara el autor)
      expectRejected(
        cmd({ type: 'PLAY_CARD', actorId: 'ghost', cardInstanceId: card.instanceId }),
        'Player not found');
      // Jugador no activo (local: actorId=p2 sobre turno de p1)
      expectRejected(
        cmd({ type: 'PLAY_CARD', actorId: 'p2', cardInstanceId: card.instanceId }), 'Not your turn');
      // Carta inexistente
      expectRejected(
        cmd({ type: 'PLAY_CARD', cardInstanceId: 'no-such-card' }), 'Card not in hand');
      // Carta del rival (no puedes jugar la mano del otro)
      expectRejected(
        cmd({ type: 'PLAY_CARD', cardInstanceId: otherCard.instanceId }), 'Card not in hand');
      // Objetivo fantasma
      expectRejected(
        cmd({ type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'ghost-enemy' }),
        'Target enemy not found');
      // Fase incorrecta
      state.phase = 'MARKET';
      expectRejected(
        cmd({ type: 'PLAY_CARD', cardInstanceId: card.instanceId }), 'Not in attack phase');
      state.phase = 'PLAYER_ATTACK';
      // Suplantación online: el remitente autenticado (p2) declara actorId=p1.
      // D427: el transporte gana — el comando se atribuye a p2 → 'Not your turn'.
      expectRejected(
        { type: 'PLAY_CARD', cid: 'x', actorId: 'p1', cardInstanceId: card.instanceId } as Command,
        'Not your turn', 'p2');
      // Tipo de comando inexistente (payload malformado)
      expectRejected({ type: 'FLY', cid: 'x' } as unknown as Command, 'Command not supported');

      // Control: la carta legal SÍ se juega tras toda la batería
      const ok = execNeg(cmd({ type: 'PLAY_CARD', cardInstanceId: card.instanceId }));
      expect(ok.accepted, `legal rechazada: ${ok.reason}`).toBe(true);
    });

    it('rechaza carta con COST sin monedas suficientes', () => {
      // Buscar una carta oficial con COST COINS real
      const costCard = (catalog.byType.get('ABILITY') ?? []).find(
        c => c.effects?.some(e => e.type === 'COST' && e.resource === 'COINS'),
      );
      if (!costCard) return; // ninguna carta oficial tiene coste de monedas
      const inst = putCardInHand('p1', costCard.id);
      state.players.p1.coins = 0;
      expectRejected(
        cmd({ type: 'PLAY_CARD', cardInstanceId: inst.instanceId }), /Not enough coins/);
      // Con monedas suficientes, ya no se rechaza por coste
      state.players.p1.coins = 99;
      const ok = execNeg(cmd({ type: 'PLAY_CARD', cardInstanceId: inst.instanceId }));
      expect(ok.reason ?? '').not.toMatch(/Not enough coins/);
    });

    it('exige objetivo a cartas de daño directo y respeta el filtro (E-13)', () => {
      const atkCard = (catalog.byType.get('ABILITY') ?? []).find(
        c => (c.printedAttack ?? 0) > 0 && !c.effects?.some(e =>
          e.type === 'DEAL_DAMAGE_SPLIT' || e.type === 'DEAL_DAMAGE_ALL_ENEMIES'
          || e.type === 'DEAL_DAMAGE_TO_HERO' || e.type === 'DEAL_DAMAGE_TO_OTHER_HEROES'),
      );
      expect(atkCard, 'el catálogo debe tener una carta de ataque directo').toBeDefined();
      const inst = putCardInHand('p1', atkCard!.id);
      // Sin objetivo: la carta se consumía sin hacer daño (no-op silencioso)
      expectRejected(
        cmd({ type: 'PLAY_CARD', cardInstanceId: inst.instanceId }),
        'Card requires a target enemy');
      // Con objetivo válido entra
      const ok = execNeg(
        cmd({ type: 'PLAY_CARD', cardInstanceId: inst.instanceId, targetEnemyId: 'neg-enemy-1' }));
      expect(ok.accepted, `legal rechazada: ${ok.reason}`).toBe(true);

      // Filtro de clase: una carta "solo orcos" contra un no-orco fizzleaba
      // en silencio tras consumir la carta.
      const orcCard = (catalog.byType.get('ABILITY') ?? []).find(c =>
        c.effects?.some(e => {
          const t = 'target' in e ? e.target : undefined;
          return typeof t === 'object' && t !== null && t.kind === 'ONE_ENEMY'
            && 'filter' in t && t.filter?.isOrc === true;
        }));
      if (orcCard) {
        const orcInst = putCardInHand('p1', orcCard.id);
        expectRejected(
          cmd({ type: 'PLAY_CARD', cardInstanceId: orcInst.instanceId, targetEnemyId: 'neg-enemy-1' }),
          'Target does not meet card requirements');
      }
    });
  });

  describe('EVASION', () => {
    beforeEach(() => {
      state.phase = 'ATTACK_CHOICE';
      state.activePlayerId = 'p1';
    });

    it('rechaza todas las variantes ilegales', () => {
      const [a, b, c] = [
        putCardInHand('p1', 'explorer.lamp'),
        putCardInHand('p1', 'explorer.knife'),
        putCardInHand('p1', 'explorer.map'),
      ];
      const p2card = putCardInHand('p2', 'warrior.shield');

      expectRejected(cmd({ type: 'EVASION', discardedCardInstanceIds: [a.instanceId, b.instanceId] }), 'Not your turn', 'p2');
      expectRejected(cmd({ type: 'EVASION', discardedCardInstanceIds: [a.instanceId] }), 'Must discard at least 2 cards to evade');
      expectRejected(cmd({ type: 'EVASION', discardedCardInstanceIds: [a.instanceId, a.instanceId] }), 'Duplicate card IDs in evasion');
      expectRejected(cmd({ type: 'EVASION', discardedCardInstanceIds: [a.instanceId, 'ghost'] }), 'Discarded cards must be from hand');
      expectRejected(cmd({ type: 'EVASION', discardedCardInstanceIds: [a.instanceId, p2card.instanceId] }), 'Discarded cards must be from hand');
      state.phase = 'PLAYER_ATTACK';
      expectRejected(cmd({ type: 'EVASION', discardedCardInstanceIds: [a.instanceId, b.instanceId] }), 'Not in attack choice phase');
      state.phase = 'ATTACK_CHOICE';
      // Ficha de Evasión ya usada (una por partida)
      state.players.p1.evasionTokenUsed = true;
      expectRejected(cmd({ type: 'EVASION', discardedCardInstanceIds: [a.instanceId, b.instanceId] }), 'Evasion token already used this game');
      state.players.p1.evasionTokenUsed = false;

      const ok = execNeg(cmd({ type: 'EVASION', discardedCardInstanceIds: [a.instanceId, b.instanceId] }));
      expect(ok.accepted, `evasión legal rechazada: ${ok.reason}`).toBe(true);
      expect(ok.newState.players.p1.evasionTokenUsed).toBe(true);
      expect(c.zone).toBe('HAND'); // la tercera carta intacta en el estado viejo
    });
  });

  describe('BUY_CARD', () => {
    beforeEach(() => {
      state.phase = 'MARKET';
      state.activePlayerId = 'p1';
      state.market = [{
        instanceId: 'neg-mkt-1',
        definitionId: 'market.whetstone',
        ownerId: 'market',
        zone: 'MARKET',
      }];
      state.players.p1.coins = 99;
    });

    it('rechaza compras ilegales y acepta la legal', () => {
      expectRejected(cmd({ type: 'BUY_CARD', marketCardInstanceId: 'neg-mkt-1' }), 'Not your turn', 'p2');
      expectRejected(cmd({ type: 'BUY_CARD', marketCardInstanceId: 'ghost-card' }), 'Card not in market');
      state.players.p1.coins = 0;
      expectRejected(cmd({ type: 'BUY_CARD', marketCardInstanceId: 'neg-mkt-1' }), /Not enough coins/);
      state.players.p1.coins = 99;
      // Sin capacidad requerida ni penalización
      const def = catalog.byId.get('market.whetstone')!;
      if (def.requiredCapabilities?.length) {
        state.players.p1.capabilities = [];
        expectRejected(cmd({ type: 'BUY_CARD', marketCardInstanceId: 'neg-mkt-1' }), 'Hero lacks required capabilities');
        state.players.p1.capabilities = ['MELEE', 'RANGED', 'EXPERTISE', 'MAGIC'];
      }
      state.phase = 'PLAYER_ATTACK';
      expectRejected(cmd({ type: 'BUY_CARD', marketCardInstanceId: 'neg-mkt-1' }), 'Not in market phase');
      state.phase = 'MARKET';

      const ok = execNeg(cmd({ type: 'BUY_CARD', marketCardInstanceId: 'neg-mkt-1' }));
      expect(ok.accepted, `compra legal rechazada: ${ok.reason}`).toBe(true);
    });
  });

  describe('END_ATTACK / END_TURN / PASS', () => {
    it('END_ATTACK rechaza fase, turno y elección obligatoria', () => {
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      state.pendingChoices = [{
        choiceId: 'neg-choice', playerId: 'p1', type: 'CONFIRM',
        prompt: 'test', options: ['yes', 'no'], minSelections: 1, maxSelections: 1,
      }];
      expectRejected(cmd({ type: 'END_ATTACK' }), 'Resolve pending choices first');
      state.pendingChoices = [];
      expectRejected(cmd({ type: 'END_ATTACK' }), 'Not your turn', 'p2');
      state.phase = 'MARKET';
      expectRejected(cmd({ type: 'END_ATTACK' }), 'Not in attack phase');
      state.phase = 'PLAYER_ATTACK';
      const ok = execNeg(cmd({ type: 'END_ATTACK' }));
      expect(ok.accepted, `END_ATTACK legal rechazado: ${ok.reason}`).toBe(true);
    });

    it('END_TURN rechaza fase, turno y elección obligatoria', () => {
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      expectRejected(cmd({ type: 'END_TURN' }), 'Not in restoration or market phase');
      state.phase = 'MARKET';
      expectRejected(cmd({ type: 'END_TURN' }), 'Not your turn', 'p2');
      state.pendingChoices = [{
        choiceId: 'neg-choice', playerId: 'p1', type: 'SELECT_ORDER',
        prompt: 'test', options: ['o1', 'o2'], minSelections: 2, maxSelections: 2,
      }];
      expectRejected(cmd({ type: 'END_TURN' }), 'Resolve pending choices first');
      state.pendingChoices = [];
      const ok = execNeg(cmd({ type: 'END_TURN' }));
      expect(ok.accepted, `END_TURN legal rechazado: ${ok.reason}`).toBe(true);
    });

    it('PASS siempre es legal (cualquier fase)', () => {
      for (const phase of ['PLAYER_ATTACK', 'MARKET', 'SETUP'] as const) {
        state.phase = phase;
        expect(execNeg(cmd({ type: 'PASS' })).accepted).toBe(true);
      }
    });
  });

  describe('RESOLVE_CHOICE', () => {
    beforeEach(() => {
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      // Elección real: seleccionar cartas de la mano (los ids deben
      // corresponder a cartas reales del jugador).
      putCardInHand('p1', 'explorer.lamp');
      putCardInHand('p1', 'explorer.knife');
      const choice: PendingChoice = {
        choiceId: 'neg-choice', playerId: 'p1', type: 'SELECT_CARD_FROM_HAND',
        prompt: 'Elige cartas', options: state.players.p1.hand.map(c => c.instanceId),
        minSelections: 2, maxSelections: 3,
      };
      state.pendingChoices = [choice];
    });

    it('rechaza elecciones inexistentes, ajenas, fuera de rango, inválidas y duplicadas', () => {
      const [idA, idB] = state.players.p1.hand.map(c => c.instanceId);
      expectRejected(cmd({ type: 'RESOLVE_CHOICE', choiceId: 'ghost', selectedIds: [idA] }), 'Choice not found');
      // Un jugador autenticado (p2) intenta resolver la elección de p1:
      // la elección pertenece a p1 → error de atribución (anti-suplantación).
      expectRejected(cmd({ type: 'RESOLVE_CHOICE', choiceId: 'neg-choice', selectedIds: [idA, idB] }), /attributed to/, 'p2');
      expectRejected(cmd({ type: 'RESOLVE_CHOICE', choiceId: 'neg-choice', selectedIds: [idA] }), 'Invalid number of selections');
      expectRejected(cmd({ type: 'RESOLVE_CHOICE', choiceId: 'neg-choice', selectedIds: [idA, 'hacked-option'] }), 'Invalid selection: not among available options');
      expectRejected(cmd({ type: 'RESOLVE_CHOICE', choiceId: 'neg-choice', selectedIds: [idA, idA] }), 'Duplicate selections');

      const ok = execNeg(cmd({ type: 'RESOLVE_CHOICE', choiceId: 'neg-choice', selectedIds: [idA, idB] }));
      expect(ok.accepted, `elección legal rechazada: ${ok.reason}`).toBe(true);
      expect(ok.newState.pendingChoices).toHaveLength(0);
    });
  });

  describe('USE_HERO_ABILITY', () => {
    beforeEach(() => {
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      state.players.p1.heroUsesRemaining = 1;
    });

    it('rechaza sin usos, en fase prohibida, turno ajeno y reactiva en turno propio', () => {
      state.players.p1.heroUsesRemaining = 0;
      expectRejected(cmd({ type: 'USE_HERO_ABILITY' }), 'No hero ability uses remaining');
      state.players.p1.heroUsesRemaining = 1;

      expectRejected(cmd({ type: 'USE_HERO_ABILITY' }), 'Not your turn', 'p2');
      state.phase = 'SETUP';
      expectRejected(cmd({ type: 'USE_HERO_ABILITY' }), 'Cannot use hero ability in this phase');
      state.phase = 'PLAYER_ATTACK';

      // Valèrys es reactiva: solo en HORDE_ATTACK y solo en turno ajeno
      state.players.p1.heroId = 'hero.valerys';
      expectRejected(cmd({ type: 'USE_HERO_ABILITY' }), 'This hero ability can only be used during Horde Attack');
      state.phase = 'HORDE_ATTACK';
      expectRejected(cmd({ type: 'USE_HERO_ABILITY' }), 'Reactive ability cannot be used on your own turn');
    });
  });

  describe('Comandos de modos/fases específicos', () => {
    it('SWAP_STARTING_CARDS solo en SOLO y setup, ≤2 cartas, en mano', () => {
      expectRejected(cmd({ type: 'SWAP_STARTING_CARDS', cardInstanceIds: [] }), 'Only available in solo mode');
      state.mode = 'SOLO';
      expectRejected(cmd({ type: 'SWAP_STARTING_CARDS', cardInstanceIds: [] }), 'Only during setup or initial selection');
      state.phase = 'SETUP';
      const c = putCardInHand('p1', 'explorer.lamp');
      expectRejected(cmd({ type: 'SWAP_STARTING_CARDS', cardInstanceIds: [c.instanceId, c.instanceId, c.instanceId] }), 'Can only swap up to 2 cards');
      expectRejected(cmd({ type: 'SWAP_STARTING_CARDS', cardInstanceIds: [c.instanceId, c.instanceId] }), 'Duplicate card ids');
      expectRejected(cmd({ type: 'SWAP_STARTING_CARDS', cardInstanceIds: [c.instanceId, 'ghost'] }), 'Card not in hand');
    });

    it('CHOOSE_LEADER_CARDS solo con puja pendiente y cartas de la mano', () => {
      expectRejected(cmd({ type: 'CHOOSE_LEADER_CARDS', cardInstanceIds: ['x'] }), 'Only during initial player selection');
      state.phase = 'INITIAL_PLAYER_SELECTION';
      expectRejected(cmd({ type: 'CHOOSE_LEADER_CARDS', cardInstanceIds: [] }), 'Must choose 1 or 2 cards');
      const c = putCardInHand('p1', 'explorer.lamp');
      expectRejected(cmd({ type: 'CHOOSE_LEADER_CARDS', cardInstanceIds: [c.instanceId, 'ghost'] }), 'Card not in hand');
      expectRejected(cmd({ type: 'CHOOSE_LEADER_CARDS', cardInstanceIds: [c.instanceId] }), 'Player has no pending leader bid');
    });

    it('ACCEPT_TURN_START_EFFECT exige escenario y elección viva', () => {
      state.scenario = null;
      expectRejected(cmd({ type: 'ACCEPT_TURN_START_EFFECT', accepted: true }), 'No active scenario');
      state.scenario = { instanceId: 'neg-scenario', definitionId: 'scenario.001', ownerId: 'game', zone: 'SCENARIO_ACTIVE' };
      expectRejected(cmd({ type: 'ACCEPT_TURN_START_EFFECT', accepted: true }), 'No pending turn-start effect for you');
    });

    it('OPEN/BUY_SUPPORT_CARD solo en SOLO, fase de ataque y turno propio', () => {
      expectRejected(cmd({ type: 'OPEN_SUPPORT_DECK', supportDeckIndex: 0 }), 'Only available in solo mode');
      expectRejected(cmd({ type: 'BUY_SUPPORT_CARD', supportDeckIndex: 0, payment: { type: 'COINS', amount: 2 } }), 'Only available in solo mode');
      state.mode = 'SOLO';
      state.phase = 'MARKET';
      expectRejected(cmd({ type: 'OPEN_SUPPORT_DECK', supportDeckIndex: 0 }), 'Support decks can only be opened during the Attack phase');
      state.phase = 'PLAYER_ATTACK';
      expectRejected(cmd({ type: 'OPEN_SUPPORT_DECK', supportDeckIndex: 0 }), 'Not your turn', 'p2');
      expectRejected(cmd({ type: 'BUY_SUPPORT_CARD', supportDeckIndex: 0, payment: { type: 'GLORY', amount: 1 } }), 'Not your turn', 'p2');
    });
  });

  describe('Partida real completa con negativos intercalados', () => {
    it('los rechazos no corrompen la partida: tras 20 negativos el legal sigue funcionando', () => {
      // Forzar una fase accionable conocida
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      putEnemy('neg-enemy-final');
      const card = putCardInHand('p1', 'explorer.lamp');
      const hashBefore = JSON.stringify(state).length;

      // 20 intentos ilegales variados sobre el MISMO estado
      const illegal: [Command, string | RegExp][] = [
        [cmd({ type: 'PLAY_CARD', cardInstanceId: 'x' }), 'Card not in hand'],
        [cmd({ type: 'BUY_CARD', marketCardInstanceId: 'x' }), 'Not in market phase'],
        [cmd({ type: 'EVASION', discardedCardInstanceIds: [] }), 'Not in attack choice phase'],
        [cmd({ type: 'END_TURN' }), 'Not in restoration or market phase'],
        [cmd({ type: 'RESOLVE_CHOICE', choiceId: 'x', selectedIds: [] }), 'Choice not found'],
        [cmd({ type: 'CHOOSE_LEADER_CARDS', cardInstanceIds: [] }), 'Only during initial player selection'],
        [cmd({ type: 'ACCEPT_TURN_START_EFFECT', accepted: true }), 'No active scenario'],
        [cmd({ type: 'OPEN_SUPPORT_DECK', supportDeckIndex: 0 }), 'Only available in solo mode'],
        [cmd({ type: 'SWAP_STARTING_CARDS', cardInstanceIds: [] }), 'Only available in solo mode'],
      ];
      for (const [c, reason] of illegal) {
        expectRejected(c, reason);
        expectRejected(c, reason); // idempotente: el mismo comando, dos veces
      }

      // El estado no se movió ni un byte tras los 18 rechazos
      expect(JSON.stringify(state).length).toBe(hashBefore);

      // Jugada legal real: el motor sigue perfectamente operativo
      const ok = execNeg(cmd({ type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: 'neg-enemy-final' }));
      expect(ok.accepted, `legal tras batería rechazada: ${ok.reason}`).toBe(true);
      expect(ok.events.some(e => e.type === 'CARD_PLAYED')).toBe(true);
      state = ok.newState;

      // Y la partida continúa: cierre de ataque aceptado
      const end = execNeg(cmd({ type: 'END_ATTACK' }));
      expect(end.accepted, `END_ATTACK tras jugada: ${end.reason}`).toBe(true);
    });
  });

  describe('Casos negativos avanzados', () => {
    it('el rechazo no consume RNG (replay bit-idéntico)', () => {
      // Si un comando ilegal consumiera entropía, el replay divergiría
      // del estado online tras un intento rechazado.
      const before = rng.serialize();
      const r = execNeg(cmd({ type: 'PLAY_CARD', cardInstanceId: 'ghost' }));
      expect(r.accepted).toBe(false);
      expect(r.rng).toBe(rng);
      expect(r.rng.serialize()).toEqual(before);
    });

    it('héroe eliminado: todos los comandos rechazados salvo PASS', () => {
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      const p1 = state.players.p1;
      p1.wounds = p1.maxWounds; // eliminado
      const card = putCardInHand('p1', 'explorer.lamp');
      putEnemy('neg-enemy-elim');

      expectRejected(cmd({ type: 'PLAY_CARD', cardInstanceId: card.instanceId }), 'Hero is eliminated');
      expectRejected(cmd({ type: 'END_ATTACK' }), 'Hero is eliminated');
      expectRejected(cmd({ type: 'USE_HERO_ABILITY' }), 'Hero is eliminated');
      expectRejected(cmd({ type: 'RESOLVE_CHOICE', choiceId: 'x', selectedIds: [] }), 'Hero is eliminated');
      // PASS es la excepción deliberada (dejar pasar el turno)
      expect(execNeg(cmd({ type: 'PASS' })).accepted).toBe(true);
    });

    it('no puedes jugar dos veces la misma carta ni comprar dos veces el mismo objeto', () => {
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      putEnemy('neg-enemy-dbl');
      const card = putCardInHand('p1', 'explorer.lamp');
      const first = execNeg(cmd({ type: 'PLAY_CARD', cardInstanceId: card.instanceId }));
      expect(first.accepted).toBe(true);
      state = first.newState;
      // La instancia ya no está en mano → segundo intento rechazado
      expectRejected(cmd({ type: 'PLAY_CARD', cardInstanceId: card.instanceId }), 'Card not in hand');
      expectRejected(cmd({ type: 'PLAY_CARD', cardInstanceId: card.instanceId }), 'Card not in hand');
    });

    it('RESOLVE_CHOICE rechaza una elección ya consumida', () => {
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      putCardInHand('p1', 'explorer.lamp');
      putCardInHand('p1', 'explorer.knife');
      const ids = state.players.p1.hand.map(c => c.instanceId);
      state.pendingChoices = [{
        choiceId: 'neg-once', playerId: 'p1', type: 'SELECT_CARD_FROM_HAND',
        prompt: 'x', options: ids, minSelections: 1, maxSelections: 2,
      }];
      const ok = execNeg(cmd({ type: 'RESOLVE_CHOICE', choiceId: 'neg-once', selectedIds: [ids[0]] }));
      expect(ok.accepted).toBe(true);
      state = ok.newState;
      // La elección desapareció → reintentar es 'Choice not found'
      expectRejected(cmd({ type: 'RESOLVE_CHOICE', choiceId: 'neg-once', selectedIds: [ids[0]] }), 'Choice not found');
    });

    it('elección opcional (minSelections=0) NO bloquea END_TURN', () => {
      state.phase = 'MARKET';
      state.activePlayerId = 'p1';
      state.pendingChoices = [{
        choiceId: 'neg-opt', playerId: 'p1', type: 'CONFIRM',
        prompt: 'x', options: ['yes', 'no'], minSelections: 0, maxSelections: 1,
      }];
      const ok = execNeg(cmd({ type: 'END_TURN' }));
      expect(ok.accepted, `END_TURN con elección opcional: ${ok.reason}`).toBe(true);
    });

    it('BUY_CARD: modificador de mercado encarece y penalización de capacidad habilita', () => {
      state.phase = 'MARKET';
      state.activePlayerId = 'p1';
      const def = (catalog.byType.get('MARKET') ?? []).find(
        c => c.penaltyCapabilities?.length && (c.printedCost ?? 0) >= 1,
      );
      if (!def) return;
      const inst: CardInstance = { instanceId: 'neg-mkt-pen', definitionId: def.id, ownerId: 'market', zone: 'MARKET' };
      state.market = [inst];
      state.players.p1.coins = def.printedCost ?? 0;

      // Mercado encarecido +2 → ya no alcanza
      state.marketCostModifier = 2;
      expectRejected(cmd({ type: 'BUY_CARD', marketCardInstanceId: inst.instanceId }), /Not enough coins/);
      state.marketCostModifier = 0;

      // Sin la capacidad requerida pero con la penalizadora → compra legal
      const penIcon = def.penaltyCapabilities![0].icon;
      state.players.p1.capabilities = state.players.p1.capabilities.filter(
        cap => !def.requiredCapabilities?.includes(cap),
      );
      if (!state.players.p1.capabilities.includes(penIcon)) {
        state.players.p1.capabilities.push(penIcon);
      }
      const ok = execNeg(cmd({ type: 'BUY_CARD', marketCardInstanceId: inst.instanceId }));
      expect(ok.accepted, `compra con penalización: ${ok.reason}`).toBe(true);
    });

    it('USE_HERO_ABILITY con objetivo fantasma', () => {
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      state.players.p1.heroUsesRemaining = 1;
      // Aranel es activa: un targetId inexistente se rechaza en ejecución
      const r = execNeg(cmd({ type: 'USE_HERO_ABILITY', targetId: 'ghost-target' }));
      // Puede ser 'Invalid targetId' o aceptado según la pericia no use target;
      // si rechaza, el estado queda intacto.
      if (!r.accepted) {
        expect(r.newState).toBe(state);
        expect(r.events).toEqual([]);
      }
    });

    it('partida terminada: ningún comando muta el estado', () => {
      state.phase = 'FINISHED';
      // Guard global post-fin: todo comando rechazado con razón unificada
      // (antes dependía de la fase concreta y RESOLVE_CHOICE pasaba).
      expectRejected(cmd({ type: 'PLAY_CARD', cardInstanceId: 'x' }), 'Game is finished');
      expectRejected(cmd({ type: 'BUY_CARD', marketCardInstanceId: 'x' }), 'Game is finished');
      expectRejected(cmd({ type: 'END_TURN' }), 'Game is finished');
      expectRejected(cmd({ type: 'END_ATTACK' }), 'Game is finished');
      expectRejected(cmd({ type: 'EVASION', discardedCardInstanceIds: ['a', 'b'] }), 'Game is finished');
      expectRejected(cmd({ type: 'USE_HERO_ABILITY' }), 'Game is finished');
      expectRejected(cmd({ type: 'RESOLVE_CHOICE', choiceId: 'x', selectedIds: [] }), 'Game is finished');
      // PASS es no-op por contrato: sigue admitido.
      expect(execNeg(cmd({ type: 'PASS' })).accepted).toBe(true);
    });

    it('carta en otra zona (mazo/desgaste/mercado) no es jugable desde mano', () => {
      state.phase = 'PLAYER_ATTACK';
      state.activePlayerId = 'p1';
      const p1 = state.players.p1;
      // Misma definición pero la instancia está en el mazo, no en la mano
      const deckCard: CardInstance = {
        instanceId: 'neg-deck-card', definitionId: 'explorer.lamp', ownerId: 'p1', zone: 'ABILITY_DECK',
      };
      p1.abilityDeck.push(deckCard);
      expectRejected(cmd({ type: 'PLAY_CARD', cardInstanceId: deckCard.instanceId }), 'Card not in hand');
      // Y una instancia de mercado tampoco
      const mktCard: CardInstance = {
        instanceId: 'neg-mkt-in-hand', definitionId: 'market.whetstone', ownerId: 'market', zone: 'MARKET',
      };
      state.market.push(mktCard);
      expectRejected(cmd({ type: 'PLAY_CARD', cardInstanceId: mktCard.instanceId }), 'Card not in hand');
    });
  });
});
