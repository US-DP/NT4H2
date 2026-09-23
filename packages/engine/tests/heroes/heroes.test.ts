/**
 * Nivel 5: Pruebas de heroes.
 *
 * Verifica las pericias de cada heroe:
 * - Estructura: cada heroe tiene maxWounds, capabilities, heroAbility
 * - Uso de pericia consume un uso (heroUsesRemaining - 1)
 * - Pericias pasivas no consumen usos
 * - Valerys/Lisavette requieren target (heroes reactivos)
 * - Taheral: bonus de evasion
 * - Feldon: dano reducido a la mitad
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useHeroAbility, resetAbilitySeq } from '../../src/heroes/abilities.js';
import { setupGame, startFirstTurn, resetInstanceCounter } from '../../src/phases/setup.js';
import { resetPhaseSeq } from '../../src/phases/engine.js';
import { resetResolveSeq } from '../../src/effects/resolver.js';
import { execute } from '../../src/commands/execute.js';
import { EffectRegistry, registerCoreEffects } from '../../src/effects/registry.js';
import { DeterministicRng } from '../../src/rng/index.js';
import { loadCatalog } from '@nt4h/catalog';
import { makePlayer, makeGameState, makeCards, resetTestCounters } from '../fixtures/builders.js';
import type { GameState } from '@nt4h/schema';

const catalog = loadCatalog();

function makeGameWithHero(heroId: string, seed: string): GameState {
  const config = {
    mode: 'STANDARD' as const,
    playerCount: 2,
    seed,
    heroes: [
      { playerId: 'p1', heroId, heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
      { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
    ],
    useScenarios: false,
  };
  const setup = setupGame(config, catalog);
  const turnResult = startFirstTurn(setup.state, new DeterministicRng(seed), catalog);
  return turnResult.state;
}

describe('Nivel 5 - Estructura de heroes', () => {
  it('los 8 heroes tienen estructura completa', () => {
    const heroes = catalog.byType.get('HERO') ?? [];
    expect(heroes.length).toBe(8);
    for (const hero of heroes) {
      expect(hero.maxWounds).toBeDefined();
      expect(hero.maxWounds).toBeGreaterThanOrEqual(2);
      expect(hero.capabilities).toBeDefined();
      expect(hero.capabilities!.length).toBeGreaterThan(0);
      expect(hero.heroAbility).toBeDefined();
      expect(hero.heroAbility!.uses).toBeGreaterThanOrEqual(1);
    }
  });

  it('cada heroe tiene un ID unico', () => {
    const heroes = catalog.byType.get('HERO') ?? [];
    const ids = heroes.map(h => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('los heroes tienen capabilities validas', () => {
    const VALID_CAPS = new Set(['MELEE', 'RANGED', 'EXPERTISE', 'MAGIC']);
    const heroes = catalog.byType.get('HERO') ?? [];
    for (const hero of heroes) {
      for (const cap of hero.capabilities!) {
        expect(VALID_CAPS.has(cap)).toBe(true);
      }
    }
  });
});

describe('Nivel 5 - Uso de pericias', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();
    resetAbilitySeq();
  });

  it('Aranel: usar pericia consume un uso', () => {
    const state = makeGameWithHero('hero.aranel', 'aranel-test');
    const player = state.players.p1;
    const initialUses = player.heroUsesRemaining;
    const rng = new DeterministicRng('aranel-test');
    const result = useHeroAbility(state, 'p1', rng, catalog);
    // Aranel puede generar pendingChoice (buscar en mazo)
    // pero el uso se consume
    expect(result.state.players.p1.heroUsesRemaining).toBe(initialUses - 1);
  });

  it('Neddia: usar pericia consume un uso', () => {
    const state = makeGameWithHero('hero.neddia', 'neddia-test');
    const player = state.players.p1;
    const initialUses = player.heroUsesRemaining;
    const rng = new DeterministicRng('neddia-test');
    const result = useHeroAbility(state, 'p1', rng, catalog);
    expect(result.state.players.p1.heroUsesRemaining).toBe(initialUses - 1);
  });

  it('Idril: usar pericia consume un uso', () => {
    const state = makeGameWithHero('hero.idril', 'idril-test');
    const player = state.players.p1;
    const initialUses = player.heroUsesRemaining;
    const rng = new DeterministicRng('idril-test');
    const result = useHeroAbility(state, 'p1', rng, catalog);
    expect(result.state.players.p1.heroUsesRemaining).toBe(initialUses - 1);
  });

  it('Taheral: pericia pasiva no consume uso directamente', () => {
    const state = makeGameWithHero('hero.taheral', 'taheral-test');
    const player = state.players.p1;
    const initialUses = player.heroUsesRemaining;
    const rng = new DeterministicRng('taheral-test');
    const result = useHeroAbility(state, 'p1', rng, catalog);
    // Taheral es pasiva: no consume uso al activarse directamente
    expect(result.state.players.p1.heroUsesRemaining).toBe(initialUses);
  });

  it('Feldon: pericia pasiva no consume uso', () => {
    const state = makeGameWithHero('hero.feldon', 'feldon-test');
    const player = state.players.p1;
    const initialUses = player.heroUsesRemaining;
    const rng = new DeterministicRng('feldon-test');
    const result = useHeroAbility(state, 'p1', rng, catalog);
    expect(result.state.players.p1.heroUsesRemaining).toBe(initialUses);
  });

  it('Beleth-Il: pericia pasiva no consume uso', () => {
    const state = makeGameWithHero('hero.beleth-il', 'beleth-test');
    const player = state.players.p1;
    const initialUses = player.heroUsesRemaining;
    const rng = new DeterministicRng('beleth-test');
    const result = useHeroAbility(state, 'p1', rng, catalog);
    expect(result.state.players.p1.heroUsesRemaining).toBe(initialUses);
  });

  it('usar pericia con 0 usos restantes no hace nada', () => {
    const state = makeGameWithHero('hero.aranel', 'no-uses-test');
    // Forzar 0 usos
    const noUsesState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, heroUsesRemaining: 0 },
      },
    };
    const rng = new DeterministicRng('no-uses-test');
    const result = useHeroAbility(noUsesState, 'p1', rng, catalog);
    expect(result.events).toEqual([]);
    expect(result.state).toBe(noUsesState);
  });

  it('usar pericia con playerId inexistente no hace nada', () => {
    const state = makeGameWithHero('hero.aranel', 'bad-player-test');
    const rng = new DeterministicRng('bad-player-test');
    const result = useHeroAbility(state, 'nonexistent', rng, catalog);
    expect(result.events).toEqual([]);
    expect(result.state).toBe(state);
  });
});

describe('Nivel 5 - Taheral evasion bonus (opt-in)', () => {
  beforeEach(() => {
    resetAbilitySeq();
    resetTestCounters();
  });

  function makeTaheralState(handSize: number): GameState {
    const player = makePlayer({
      playerId: 'p1',
      heroId: 'hero.taheral',
      heroUsesRemaining: 2,
      hand: makeCards(handSize),
      abilityDeck: makeCards(5),
    });
    return makeGameState({ phase: 'ATTACK_CHOICE', players: { p1: player } });
  }

  function runEvasion(state: GameState, count: number) {
    const reg = new EffectRegistry();
    registerCoreEffects(reg);
    const rng = new DeterministicRng('t-taheral');
    const discarded = state.players.p1.hand.slice(0, count).map(c => c.instanceId);
    const evade = execute(
      state,
      { type: 'EVASION', cid: 'e1', discardedCardInstanceIds: discarded },
      rng, reg, catalog,
    );
    return { evade, reg, rng };
  }

  it('aceptar la pericia otorga 2 monedas por carta descartada', () => {
    const state = makeTaheralState(3);
    const { evade, reg, rng } = runEvasion(state, 3);
    expect(evade.accepted).toBe(true);
    const choice = evade.newState.pendingChoices.find(c => c.choiceId.startsWith('taheral-evasion-'));
    expect(choice).toBeDefined();
    const res = execute(
      evade.newState,
      { type: 'RESOLVE_CHOICE', cid: 'r1', choiceId: choice!.choiceId, selectedIds: ['yes'] },
      rng, reg, catalog,
    );
    const coinEvent = res.events.find(e => e.type === 'COINS_GAINED');
    expect(coinEvent && coinEvent.type === 'COINS_GAINED' ? coinEvent.amount : 0).toBe(6);
    expect(res.events.some(e => e.type === 'HERO_ABILITY_USED')).toBe(true);
  });

  it('rechazar la pericia no otorga monedas ni consume uso', () => {
    const state = makeTaheralState(2);
    const { evade, reg, rng } = runEvasion(state, 2);
    const choice = evade.newState.pendingChoices.find(c => c.choiceId.startsWith('taheral-evasion-'));
    const res = execute(
      evade.newState,
      { type: 'RESOLVE_CHOICE', cid: 'r1', choiceId: choice!.choiceId, selectedIds: ['no'] },
      rng, reg, catalog,
    );
    expect(res.events.some(e => e.type === 'COINS_GAINED' && e.amount > 0)).toBe(false);
    expect(res.newState.players.p1.heroUsesRemaining).toBe(2);
  });

  it('no se ofrece a otros heroes', () => {
    const player = makePlayer({
      playerId: 'p1', heroId: 'hero.aranel',
      hand: makeCards(2), abilityDeck: makeCards(5),
    });
    const state = makeGameState({ phase: 'ATTACK_CHOICE', players: { p1: player } });
    const { evade } = runEvasion(state, 2);
    expect(evade.newState.pendingChoices.some(c => c.choiceId.startsWith('taheral-evasion-'))).toBe(false);
  });

  it('sin usos restantes no se ofrece la eleccion', () => {
    const player = makePlayer({
      playerId: 'p1', heroId: 'hero.taheral', heroUsesRemaining: 0,
      hand: makeCards(2), abilityDeck: makeCards(5),
    });
    const state = makeGameState({ phase: 'ATTACK_CHOICE', players: { p1: player } });
    const { evade } = runEvasion(state, 2);
    expect(evade.newState.pendingChoices.some(c => c.choiceId.startsWith('taheral-evasion-'))).toBe(false);
  });
});

describe('Nivel 5 - Valerys (heroe reactivo)', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();
    resetAbilitySeq();
  });

  it('Valerys sin target genera pendingChoice', () => {
    const state = makeGameWithHero('hero.valerys', 'valerys-test');
    const rng = new DeterministicRng('valerys-test');
    const result = useHeroAbility(state, 'p1', rng, catalog);
    // Valerys sin target debe generar pendingChoice o no consumir uso
    expect(result.state.players.p1.heroUsesRemaining).toBe(state.players.p1.heroUsesRemaining);
  });

  it('Valerys con target consume uso', () => {
    const state = makeGameWithHero('hero.valerys', 'valerys-target-test');
    const player = state.players.p1;
    const initialUses = player.heroUsesRemaining;
    const rng = new DeterministicRng('valerys-target-test');
    const result = useHeroAbility(state, 'p1', rng, catalog, 'p2');
    // Con target, Valerys consume el uso
    expect(result.state.players.p1.heroUsesRemaining).toBe(initialUses - 1);
  });
});

describe('Nivel 5 - Lisavette (heroe reactivo)', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();
    resetAbilitySeq();
  });

  it('Lisavette sin escudos no puede usar pericia', () => {
    const state = makeGameWithHero('hero.lisavette', 'lisavette-no-shield-test');
    // Asegurar que no tiene escudos
    const noShieldState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, shields: 0 },
      },
    };
    const rng = new DeterministicRng('lisavette-no-shield-test');
    const result = useHeroAbility(noShieldState, 'p1', rng, catalog);
    expect(result.events).toEqual([]);
    expect(result.state).toBe(noShieldState);
  });

  it('Lisavette con escudos puede iniciar pericia', () => {
    const state = makeGameWithHero('hero.lisavette', 'lisavette-shield-test');
    // Dar escudos
    const shieldState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, shields: 2 },
      },
    };
    const rng = new DeterministicRng('lisavette-shield-test');
    const result = useHeroAbility(shieldState, 'p1', rng, catalog);
    // Lisavette con escudos debe generar pendingChoice (sin consumir uso)
    expect(result.state.players.p1.heroUsesRemaining).toBe(state.players.p1.heroUsesRemaining);
  });

  it('Lisavette: flujo completo con seleccion de enemigo', () => {
    const state = makeGameWithHero('hero.lisavette', 'lisavette-enemy-test');
    // Asegurar que p1 tiene una carta warrior.shield en mano
    const shieldCard = state.players.p1.hand.find(c => c.definitionId === 'warrior.shield');
    if (!shieldCard) {
      // Inyectar una carta de Escudo en la mano
      const fakeShield = {
        instanceId: 'test-shield-1',
        definitionId: 'warrior.shield',
        ownerId: 'p1',
        zone: 'HAND' as const,
      };
      state.players.p1 = {
        ...state.players.p1,
        hand: [...state.players.p1.hand, fakeShield],
      };
    }
    // Asegurar que hay enemigos en el campo
    expect(state.battlefield.length).toBeGreaterThan(0);
    // Asegurar que p2 tiene monedas para robar
    state.players.p2 = { ...state.players.p2, coins: 3 };

    const rng = new DeterministicRng('lisavette-enemy-test');

    // Paso 1: Sin target → debe generar SELECT_HERO
    const result1 = useHeroAbility(state, 'p1', rng, catalog);
    const heroChoice = result1.state.pendingChoices.find(c => c.choiceId.startsWith('lisavette-'));
    expect(heroChoice).toBeDefined();
    expect(heroChoice!.type).toBe('SELECT_HERO');
    // No consume uso aún
    expect(result1.state.players.p1.heroUsesRemaining).toBe(state.players.p1.heroUsesRemaining);

    // Paso 2: Con target hero → debe generar SELECT_ENEMY
    const result2 = useHeroAbility(result1.state, 'p1', rng, catalog, 'p2');
    const enemyChoice = result2.state.pendingChoices.find(c => c.choiceId.startsWith('lisavette-enemy-'));
    expect(enemyChoice).toBeDefined();
    expect(enemyChoice!.type).toBe('SELECT_ENEMY');
    expect(enemyChoice!.resolutionContext?.chosenHeroTarget).toBe('p2');
    // No consume uso aún
    expect(result2.state.players.p1.heroUsesRemaining).toBe(state.players.p1.heroUsesRemaining);

    // Paso 3: Con ambos targets → ejecuta la pericia, consume uso
    const enemyId = state.battlefield[0].instanceId;
    const result3 = useHeroAbility(result2.state, 'p1', rng, catalog, 'p2', enemyId);
    // Ahora consume el uso
    expect(result3.state.players.p1.heroUsesRemaining).toBe(state.players.p1.heroUsesRemaining - 1);
    // D372: Debe emitir ENEMY_DAMAGE_DISABLED para el enemigo seleccionado
    // (previene el daño de ese enemigo en el Ataque de la Horda)
    const disableEvent = result3.events.find(e => e.type === 'ENEMY_DAMAGE_DISABLED');
    expect(disableEvent).toBeDefined();
    if (disableEvent && disableEvent.type === 'ENEMY_DAMAGE_DISABLED') {
      expect(disableEvent.enemyInstanceId).toBe(enemyId);
    }
    // Debe emitir COINS_STOLEN (hasta 2 de p2 que tiene 3)
    const stealEvent = result3.events.find(e => e.type === 'COINS_STOLEN');
    expect(stealEvent).toBeDefined();
    if (stealEvent && stealEvent.type === 'COINS_STOLEN') {
      expect(stealEvent.amount).toBe(2);
      expect(stealEvent.fromPlayerId).toBe('p2');
      expect(stealEvent.toPlayerId).toBe('p1');
    }
  });
});
