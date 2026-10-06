import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { useHeroAbility, resetAbilitySeq } from '../src/heroes/abilities.js';
import { applyScenarioEffects, clearScenarioEffects, onEnemyDefeated, onTurnStart, executeTurnStartEffect, resetScenarioSeq } from '../src/scenarios/index.js';
import { setupGame, resetInstanceCounter } from '../src/phases/setup.js';
import { processPhases, resetPhaseSeq } from '../src/phases/engine.js';
import { execute } from '../src/commands/execute.js';
import { resolveCard } from '../src/effects/resolver.js';
import { EffectRegistry, registerCoreEffects } from '../src/effects/registry.js';
import { loadCatalog } from '@nt4h/catalog';
import { makeCard, makeEnemy } from './fixtures/builders.js';
import { computeHordeAttackBreakdown } from '../src/analysis/hordeBreakdown.js';
import type { GameState, Zone } from '@nt4h/schema';

describe('HeroAbilities — Pericias de heroes', () => {
  let catalog: ReturnType<typeof loadCatalog>;
  let rng: DeterministicRng;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetAbilitySeq();
    catalog = loadCatalog();
    rng = new DeterministicRng('test-abilities-001');
  });

  function makeState(heroId: string = 'hero.aranel'): GameState {
    const config = {
      mode: 'STANDARD' as const,
      playerCount: 2,
      seed: 'test-abilities-001',
      heroes: [
        { playerId: 'p1', heroId, heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
      ],
      useScenarios: false,
    };
    return setupGame(config, catalog).state;
  }

  it('usa la Pericia de Aranel (busca en mazo)', () => {
    const state = makeState('hero.aranel');
    const result = useHeroAbility(state, 'p1', rng, catalog);

    // Debe generar evento HERO_ABILITY_USED
    expect(result.events.some(e => e.type === 'HERO_ABILITY_USED')).toBe(true);
    // Debe guardar eleccion pendiente en state.pendingChoices
    expect(result.state.pendingChoices.length).toBeGreaterThan(0);
    const choice = result.state.pendingChoices.find(c => c.type === 'SEARCH_DECK');
    expect(choice).toBeDefined();
    // Debe reducir los usos restantes
    expect(result.state.players.p1.heroUsesRemaining).toBe(0);
  });

  it('usa la Pericia de Idril (reordenar Horda)', () => {
    const state = makeState('hero.idril');
    const result = useHeroAbility(state, 'p1', rng, catalog);

    expect(result.events.some(e => e.type === 'HERO_ABILITY_USED')).toBe(true);
    // Debe crear una eleccion pendiente en el estado con SELECT_ORDER
    expect(result.state.pendingChoices.length).toBeGreaterThan(0);
    const choice = result.state.pendingChoices.find(c => c.type === 'SELECT_ORDER');
    expect(choice).toBeDefined();
    expect(choice?.options.length).toBe(3); // 3 cartas inferiores
  });

  it('usa la Pericia de Valerys (interceptar dano)', () => {
    const state = makeState('hero.valerys');
    // D434: Valérys solo intercepta el daño del héroe que se enfrenta a la
    // Horda — el jugador activo debe ser el objetivo 'p2'
    state.activePlayerId = 'p2';
    const result = useHeroAbility(state, 'p1', rng, catalog, 'p2');

    expect(result.events.some(e => e.type === 'HERO_ABILITY_USED')).toBe(true);
    // Debe emitir DAMAGE_INTERCEPTED para redirigir el dano
    expect(result.events.some(e => e.type === 'DAMAGE_INTERCEPTED')).toBe(true);
    // La Gloria se otorga al aplicar el evento en applyEvent
  });

  it('Valerys sin objetivo genera eleccion pendiente', () => {
    const state = makeState('hero.valerys');
    const result = useHeroAbility(state, 'p1', rng, catalog);

    expect(result.state.pendingChoices.length).toBeGreaterThan(0);
    const choice = result.state.pendingChoices.find(c => c.type === 'SELECT_HERO');
    expect(choice).toBeDefined();
  });

  it('no permite usar pericia sin usos restantes', () => {
    const state = makeState('hero.aranel');
    // Usar la pericia 1 vez (Aranel tiene 1 uso)
    let result = useHeroAbility(state, 'p1', rng, catalog);
    expect(result.state.players.p1.heroUsesRemaining).toBe(0);

    // Intentar usar de nuevo
    result = useHeroAbility(result.state, 'p1', rng, catalog);
    expect(result.events).toEqual([]);
  });

  it('Taheral gana 2 monedas por carta descartada en Evasion (opt-in)', () => {
    const state = makeState('hero.taheral');
    state.phase = 'ATTACK_CHOICE';
    state.activePlayerId = 'p1';
    // Las pujas de líder del setup ya estarían resueltas en flujo real
    state.pendingChoices = [];
    const reg = new EffectRegistry();
    registerCoreEffects(reg);
    const discarded = state.players.p1.hand.slice(0, 2).map(c => c.instanceId);
    const evade = execute(
      state,
      { type: 'EVASION', cid: 'e1', discardedCardInstanceIds: discarded },
      rng, reg, catalog,
    );
    expect(evade.accepted).toBe(true);
    const choice = evade.newState.pendingChoices.find(c => c.choiceId.startsWith('taheral-evasion-'));
    expect(choice).toBeDefined();
    const res = execute(
      evade.newState,
      { type: 'RESOLVE_CHOICE', cid: 'r1', choiceId: choice!.choiceId, selectedIds: ['yes'] },
      rng, reg, catalog,
    );
    expect(res.events.some(e => e.type === 'COINS_GAINED' && e.amount === 4)).toBe(true);
    expect(res.events.some(e => e.type === 'HERO_ABILITY_USED')).toBe(true);
  });

  it('Taheral opt-in: rechazar no otorga monedas ni consume uso', () => {
    const state = makeState('hero.taheral');
    state.phase = 'ATTACK_CHOICE';
    state.activePlayerId = 'p1';
    state.pendingChoices = [];
    const reg = new EffectRegistry();
    registerCoreEffects(reg);
    const discarded = state.players.p1.hand.slice(0, 2).map(c => c.instanceId);
    const evade = execute(
      state,
      { type: 'EVASION', cid: 'e1', discardedCardInstanceIds: discarded },
      rng, reg, catalog,
    );
    const choice = evade.newState.pendingChoices.find(c => c.choiceId.startsWith('taheral-evasion-'));
    const res = execute(
      evade.newState,
      { type: 'RESOLVE_CHOICE', cid: 'r1', choiceId: choice!.choiceId, selectedIds: ['no'] },
      rng, reg, catalog,
    );
    expect(res.events.some(e => e.type === 'COINS_GAINED' && e.amount > 0)).toBe(false);
    expect(res.events.some(e => e.type === 'HERO_ABILITY_USED')).toBe(false);
  });

  it('Taheral no se activa para otros heroes', () => {
    const state = makeState('hero.aranel');
    state.phase = 'ATTACK_CHOICE';
    state.activePlayerId = 'p1';
    const reg = new EffectRegistry();
    registerCoreEffects(reg);
    const discarded = state.players.p1.hand.slice(0, 2).map(c => c.instanceId);
    const evade = execute(
      state,
      { type: 'EVASION', cid: 'e1', discardedCardInstanceIds: discarded },
      rng, reg, catalog,
    );
    expect(evade.newState.pendingChoices.some(c => c.choiceId.startsWith('taheral-evasion-'))).toBe(false);
  });

  it('Feldon reduce dano a la mitad (opt-in)', () => {
    const state = makeState('hero.feldon');
    state.phase = 'HORDE_ATTACK';
    state.activePlayerId = 'p1';
    state.battlefield = [makeEnemy({ baseFortitude: 4 })];
    const reg = new EffectRegistry();
    registerCoreEffects(reg);
    const phased = processPhases(state, rng, catalog);
    const choice = phased.state.pendingChoices.find(c => c.choiceId.startsWith('feldon-reduce-'));
    expect(choice).toBeDefined();
    const res = execute(
      phased.state,
      { type: 'RESOLVE_CHOICE', cid: 'r1', choiceId: choice!.choiceId, selectedIds: ['yes'] },
      rng, reg, catalog,
    );
    expect(res.events.some(e => e.type === 'HERO_ABILITY_USED')).toBe(true);
    const after = processPhases(res.newState, rng, catalog);
    // 4 de daño → mitad = 2 cartas perdidas
    const lost = after.events.find(e => e.type === 'CARDS_LOST');
    expect(lost && lost.type === 'CARDS_LOST' ? lost.cardInstanceIds.length : 0).toBe(2);
  });

  it('Feldon opt-in: rechazar aplica dano completo', () => {
    const state = makeState('hero.feldon');
    state.phase = 'HORDE_ATTACK';
    state.activePlayerId = 'p1';
    state.battlefield = [makeEnemy({ baseFortitude: 4 })];
    const reg = new EffectRegistry();
    registerCoreEffects(reg);
    const phased = processPhases(state, rng, catalog);
    const choice = phased.state.pendingChoices.find(c => c.choiceId.startsWith('feldon-reduce-'));
    const res = execute(
      phased.state,
      { type: 'RESOLVE_CHOICE', cid: 'r1', choiceId: choice!.choiceId, selectedIds: ['no'] },
      rng, reg, catalog,
    );
    const after = processPhases(res.newState, rng, catalog);
    const lost = after.events.find(e => e.type === 'CARDS_LOST');
    expect(lost && lost.type === 'CARDS_LOST' ? lost.cardInstanceIds.length : 0).toBe(4);
  });

  it('Beleth-Il recupera carta fallida de Disparo Rapido (opt-in)', () => {
    const state = makeState('hero.beleth-il');
    const reg = new EffectRegistry();
    registerCoreEffects(reg);
    const rapid = makeCard({ definitionId: 'explorer.rapid-shot', ownerId: 'p1' });
    const failed = makeCard({ definitionId: 'explorer.precise-shot', ownerId: 'p1', zone: 'ABILITY_DECK' as Zone });
    state.players.p1 = {
      ...state.players.p1,
      hand: [rapid],
      abilityDeck: [failed, ...state.players.p1.abilityDeck],
    };
    const rapidDef = catalog.byId.get('explorer.rapid-shot')!;
    const result = resolveCard(state, rapid, rapidDef, null, state.players.p1, rng, reg, catalog);
    // El fallo crea eleccion opt-in, no recuperacion automatica
    expect(result.pendingChoice?.choiceId.startsWith('beleth-recover-')).toBe(true);
    // Regresion: el opt-in es incidental — la carta JUGADA ya resolvio y
    // debe ir al Desgaste (antes el early-return la dejaba en la mano).
    expect(
      result.events.some(e => e.type === 'CARD_MOVED' && e.cardInstanceId === rapid.instanceId && e.to === 'WEAR_PILE')
    ).toBe(true);
    expect(result.newState.players.p1.wearPile.some(c => c.instanceId === rapid.instanceId)).toBe(true);
    expect(result.newState.players.p1.hand.some(c => c.instanceId === rapid.instanceId)).toBe(false);
    const stateWithChoice: GameState = {
      ...result.newState,
      pendingChoices: [...result.newState.pendingChoices, result.pendingChoice!],
    };
    const res = execute(
      stateWithChoice,
      { type: 'RESOLVE_CHOICE', cid: 'r1', choiceId: result.pendingChoice!.choiceId, selectedIds: ['yes'] },
      rng, reg, catalog,
    );
    const moved = res.events.find(e => e.type === 'CARD_MOVED' && e.to === 'HAND');
    expect(moved && moved.type === 'CARD_MOVED' ? moved.cardInstanceId : null).toBe(failed.instanceId);
    expect(res.events.some(e => e.type === 'CARDS_DRAWN')).toBe(true);
    expect(res.events.some(e => e.type === 'HERO_ABILITY_USED')).toBe(true);
  });

  it('Beleth-Il opt-in: rechazar deja la carta al fondo del mazo', () => {
    const state = makeState('hero.beleth-il');
    const reg = new EffectRegistry();
    registerCoreEffects(reg);
    const rapid = makeCard({ definitionId: 'explorer.rapid-shot', ownerId: 'p1' });
    const failed = makeCard({ definitionId: 'explorer.precise-shot', ownerId: 'p1', zone: 'ABILITY_DECK' as Zone });
    state.players.p1 = {
      ...state.players.p1,
      hand: [rapid],
      abilityDeck: [failed, ...state.players.p1.abilityDeck],
    };
    const rapidDef = catalog.byId.get('explorer.rapid-shot')!;
    const result = resolveCard(state, rapid, rapidDef, null, state.players.p1, rng, reg, catalog);
    const stateWithChoice: GameState = {
      ...result.newState,
      pendingChoices: [...result.newState.pendingChoices, result.pendingChoice!],
    };
    const res = execute(
      stateWithChoice,
      { type: 'RESOLVE_CHOICE', cid: 'r1', choiceId: result.pendingChoice!.choiceId, selectedIds: ['no'] },
      rng, reg, catalog,
    );
    // Sin recuperacion ni robo extra ni consumo de uso
    expect(res.events.some(e => e.type === 'CARD_MOVED' && e.to === 'HAND')).toBe(false);
    expect(res.events.some(e => e.type === 'HERO_ABILITY_USED')).toBe(false);
    // La carta fallida permanece al fondo del mazo
    expect(res.newState.players.p1.abilityDeck.some(c => c.instanceId === failed.instanceId)).toBe(true);
    expect(res.newState.players.p1.hand.some(c => c.instanceId === failed.instanceId)).toBe(false);
  });
});

describe('Scenarios — efectos de escenario', () => {
  let catalog: ReturnType<typeof loadCatalog>;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetScenarioSeq();
    catalog = loadCatalog();
  });

  function makeState(): GameState {
    const config = {
      mode: 'STANDARD' as const,
      playerCount: 2,
      seed: 'test-scenarios-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
      ],
      useScenarios: false,
    };
    return setupGame(config, catalog).state;
  }

  it('Ruinas de Brunmar reduce fortaleza de enemigos', () => {
    const state = makeState();
    const originalFortitude = state.battlefield[0].baseFortitude;
    const result = applyScenarioEffects(state, 'scenario.brunmar-ruins', catalog);
    // baseFortitude NO se muta; el modificador -1 se aplica via getEffectiveFortitude
    expect(result.state.battlefield[0].baseFortitude).toBe(originalFortitude);
    const fortMod = result.state.battlefield[0].modifiers.find(m => m.layer === 'FORTITUDE_MODIFIERS');
    expect(fortMod?.amount).toBe(-1);
    expect(result.state.ignoreGloryRewards).toBe(true);
  });

  it('Mercado de Lotharion reduce coste de mercado', () => {
    const state = makeState();
    const result = applyScenarioEffects(state, 'scenario.lotharion-market', catalog);
    expect(result.state.marketCostModifier).toBe(-1);
  });

  it('Planicie de Skaarg ignora recompensas de monedas', () => {
    const state = makeState();
    const result = applyScenarioEffects(state, 'scenario.skaarg-plains', catalog);
    expect(result.state.ignoreCoinRewards).toBe(true);
  });

  it('limpiar efectos de Ruinas de Brunmar restaura fortaleza', () => {
    const state = makeState();
    const applied = applyScenarioEffects(state, 'scenario.brunmar-ruins', catalog);
    const cleared = clearScenarioEffects(applied.state, 'scenario.brunmar-ruins', catalog);
    expect(cleared.state.ignoreGloryRewards).toBe(false);
  });

  it('Campo de Batalla da 1 moneda al derrotar enemigo', () => {
    const state = makeState();
    const events = onEnemyDefeated(state, 'scenario.battlefield', 'p1', 2);
    expect(events).toHaveLength(1);
    if (events[0] && events[0].type === 'COINS_GAINED') {
      expect(events[0].amount).toBe(1);
    }
  });

  it('Pantano Umbrío da 1 moneda extra si fortaleza >= 3', () => {
    const state = makeState();
    const events = onEnemyDefeated(state, 'scenario.umbrous-swamp', 'p1', 3);
    expect(events).toHaveLength(1);
    if (events[0] && events[0].type === 'COINS_GAINED') {
      expect(events[0].amount).toBe(1);
    }
  });

  it('Pantano Umbrío no da moneda extra si fortaleza < 3', () => {
    const state = makeState();
    const events = onEnemyDefeated(state, 'scenario.umbrous-swamp', 'p1', 2);
    expect(events).toEqual([]);
  });

  it('Montañas de Ur tiene efecto opcional de inicio de turno', () => {
    const state = makeState();
    const effect = onTurnStart(state, 'scenario.ur-mountains');
    expect(effect).not.toBeNull();
    expect(effect?.optional).toBe(true);
  });

  it('Puerto de Eque tiene efecto opcional de inicio de turno', () => {
    const state = makeState();
    const effect = onTurnStart(state, 'scenario.eque-port');
    expect(effect).not.toBeNull();
  });

  it('Yacimientos de Jade tiene efecto opcional de inicio de turno', () => {
    const state = makeState();
    const effect = onTurnStart(state, 'scenario.jade-deposits');
    expect(effect).not.toBeNull();
  });

  it('ejecutar efecto de Yacimientos de Jade (descartar todo, robar 4, ganar 3 monedas)', () => {
    const state = makeState();
    const result = executeTurnStartEffect(state, 'scenario.jade-deposits', 'p1', true);

    // Debe generar eventos de movimiento de cartas (descartar mano)
    const moveEvents = result.events.filter(e => e.type === 'CARD_MOVED');
    expect(moveEvents.length).toBe(4); // 4 cartas en mano

    // Debe robar 4 cartas
    const drawEvent = result.events.find(e => e.type === 'CARDS_DRAWN');
    if (drawEvent && drawEvent.type === 'CARDS_DRAWN') {
      expect(drawEvent.count).toBe(4);
    }

    // Debe ganar 3 monedas
    const coinsEvent = result.events.find(e => e.type === 'COINS_GAINED');
    if (coinsEvent && coinsEvent.type === 'COINS_GAINED') {
      expect(coinsEvent.amount).toBe(3);
    }
  });

  it('rechazar efecto opcional no genera eventos', () => {
    const state = makeState();
    const result = executeTurnStartEffect(state, 'scenario.jade-deposits', 'p1', false);
    expect(result.events).toEqual([]);
  });
});


describe('computeHordeAttackBreakdown → paridad con el motor (UI-160..164)', () => {
  let catalog: ReturnType<typeof loadCatalog>;
  let rng: DeterministicRng;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    catalog = loadCatalog();
    rng = new DeterministicRng('test-breakdown-001');
  });

  function baseState(): GameState {
    const s = setupGame({
      mode: 'STANDARD', playerCount: 2, seed: 'test-breakdown-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
      ],
      useScenarios: false,
    }, catalog).state;
    s.phase = 'HORDE_ATTACK';
    s.activePlayerId = 'p1';
    return s;
  }

  it('finalExhaustion coincide con el daño real aplicado', () => {
    const state = baseState();
    state.battlefield = [
      makeEnemy({ baseFortitude: 4 }),
      makeEnemy({ baseFortitude: 3, wounds: 1 }),
    ];
    const breakdown = computeHordeAttackBreakdown(state, catalog);
    const after = processPhases(state, rng, catalog);
    const attacked = after.events.find(e => e.type === 'HORDE_ATTACKED');
    expect(attacked && attacked.type === 'HORDE_ATTACKED' ? attacked.totalDamage : -1)
      .toBe(breakdown.finalExhaustion);
    expect(breakdown.enemyLines.length).toBe(2);
    expect(breakdown.enemyLines[0].baseDamage).toBe(4);
    expect(breakdown.enemyLines[1].baseDamage).toBe(2); // 3 fort - 1 herida
  });

  it('escudos y prevención reducen el desgaste final', () => {
    const state = baseState();
    state.battlefield = [makeEnemy({ baseFortitude: 5 })];
    state.players.p1 = { ...state.players.p1, shields: 2, prevention: 1 };
    const breakdown = computeHordeAttackBreakdown(state, catalog);
    expect(breakdown.shieldsApplied).toBe(2);
    expect(breakdown.preventionApplied).toBe(1);
    expect(breakdown.finalExhaustion).toBe(2);
    const after = processPhases(state, rng, catalog);
    const attacked = after.events.find(e => e.type === 'HORDE_ATTACKED');
    expect(attacked && attacked.type === 'HORDE_ATTACKED' ? attacked.totalDamage : -1).toBe(2);
  });

  it('damageCancellation anula el asalto completo', () => {
    const state = baseState();
    state.battlefield = [makeEnemy({ baseFortitude: 5 })];
    state.players.p1 = { ...state.players.p1, damageCancellation: true };
    const breakdown = computeHordeAttackBreakdown(state, catalog);
    expect(breakdown.cancelled).toBe(true);
    expect(breakdown.finalExhaustion).toBe(0);
  });

  it('enemigos con daño desactivado no aportan', () => {
    const state = baseState();
    state.battlefield = [
      makeEnemy({ baseFortitude: 4, damageDisabled: true }),
      makeEnemy({ baseFortitude: 3 }),
    ];
    const breakdown = computeHordeAttackBreakdown(state, catalog);
    expect(breakdown.enemyLines[0].damageDisabled).toBe(true);
    expect(breakdown.enemyLines[0].finalDamage).toBe(0);
    expect(breakdown.finalExhaustion).toBe(3);
  });
});
