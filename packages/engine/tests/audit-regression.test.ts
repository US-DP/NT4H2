/**
 * Tests de regresión de la auditoría profunda (ronda final).
 *
 * Cubre los defectos encontrados y corregidos en esta tanda:
 * - ENEMY_SPAWNED.enemyReward filtrado en la proyección online
 * - MOVE_HORDE_CARDS â†’ BOTTOM no emite evento no-op
 * - detectTieForChoice recursivo solo en ramas síncronas (no diferidas)
 * - useHeroAbility: héroe sin efectos declarativos no consume uso;
 *   heroAbility.effects del catálogo se ejecuta genéricamente
 * - VULNERABILITY_APPLIED.transporta duration
 * - peritia.condition irreconocible â†’ fail-closed
 * - marketCostSources: el delta de coste se revierte al morir la fuente
 * - ENEMY_DAMAGE_DISABLED honra la duración declarada
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { EffectRegistry, registerCoreEffects } from '../src/effects/registry.js';
import { resolveCard, executeEffectChain, resetResolveSeq } from '../src/effects/resolver.js';
import { projectEventsForPlayer } from '../src/projection/index.js';
import { applyEvent } from '../src/events/applyEvent.js';
import { expireModifiers, cleanupRestoration } from '../src/modifiers/index.js';
import { useHeroAbility } from '../src/heroes/abilities.js';
import { processHordeAttackTriggers } from '../src/effects/hordeTriggers.js';
import { execute } from '../src/commands/execute.js';
import { EventBus } from '../src/triggers/index.js';
import { CardDefinitionSchema } from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import type {
  CardDefinition,
  CardEffect,
  GameEvent,
  GameState,
  ResolutionContext,
} from '@nt4h/schema';
import { makeGameState, makePlayer, makeEnemy, makeCard, resetTestCounters } from './fixtures/builders.js';

function makeDef(raw: Record<string, unknown>): CardDefinition {
  const parsed = CardDefinitionSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`def inválida en test: ${parsed.error.message}`);
  return parsed.data;
}

function catalogWith(...defs: CardDefinition[]): CatalogLoadResult {
  const byId = new Map(defs.map(d => [d.id, d] as const));
  return {
    cards: defs,
    byId,
    byClass: new Map(),
    byType: new Map(),
    errors: [],
    totalCards: defs.length,
    totalCopies: defs.length,
  };
}

function makeCtx(state: GameState, playerId = 'p1'): ResolutionContext {
  return {
    activePlayerId: playerId,
    currentCardId: 'test.card',
    currentCardName: 'Test',
    currentCardInstanceId: 'test-card-inst',
    selectedEnemyId: state.battlefield[0]?.instanceId ?? null,
    cardsPlayedThisTurn: {},
    cardsPlayedAgainstEnemy: {},
    drawnCardInstanceId: null,
    sourceZone: 'HAND',
    enemiesDefeatedThisResolution: [],
    depth: 0,
  };
}

describe('Regresiones de auditoría', () => {
  let registry: EffectRegistry;
  let rng: DeterministicRng;

  beforeEach(() => {
    resetTestCounters();
    resetResolveSeq();
    registry = new EffectRegistry();
    registerCoreEffects(registry);
    rng = new DeterministicRng('audit-regression');
  });

  // --- Proyección: ENEMY_SPAWNED no revela el botín -------------------------
  it('ENEMY_SPAWNED redacta enemyReward en la proyección', () => {
    const event: GameEvent = {
      type: 'ENEMY_SPAWNED',
      enemyInstanceId: 'e1',
      enemyDefinitionId: 'horde.goblin',
      enemyFortitude: 2,
      enemyReward: { coins: 3, glory: 1 },
      enemyIsOrc: false,
      enemyIsWarlord: false,
      enemySpecialIcons: [],
      seq: 1,
    };
    const projected = projectEventsForPlayer([event], 'p1')[0];
    expect(projected.type).toBe('ENEMY_SPAWNED');
    if (projected.type === 'ENEMY_SPAWNED') {
      expect(projected.enemyReward).toBeNull();
    }
    // El original no se muta
    expect(event.enemyReward).toEqual({ coins: 3, glory: 1 });
  });

  // --- MOVE_HORDE_CARDS â†’ BOTTOM es identidad ------------------------------
  it('MOVE_HORDE_CARDS hacia BOTTOM no emite HORDE_DECK_REORDERED', () => {
    const state = makeGameState({
      hordeDeck: [makeCard(), makeCard(), makeCard()],
    });
    const eff = {
      type: 'MOVE_HORDE_CARDS',
      count: 2,
      to: 'BOTTOM',
    } as unknown as CardEffect;
    const chain = executeEffectChain([eff], makeCtx(state), state, rng, registry, catalogWith(), 0);
    expect(chain.events.filter(e => e.type === 'HORDE_DECK_REORDERED')).toHaveLength(0);
  });

  it('MOVE_HORDE_CARDS hacia TOP sí reordena', () => {
    const cards = [makeCard(), makeCard(), makeCard(), makeCard()];
    const state = makeGameState({ hordeDeck: cards });
    const eff = {
      type: 'MOVE_HORDE_CARDS',
      count: 2,
      to: 'TOP',
    } as unknown as CardEffect;
    const chain = executeEffectChain([eff], makeCtx(state), state, rng, registry, catalogWith(), 0);
    const reorder = chain.events.find(e => e.type === 'HORDE_DECK_REORDERED');
    expect(reorder).toBeTruthy();
    // Las 2 del fondo pasan al frente conservando su orden interno
    if (reorder?.type === 'HORDE_DECK_REORDERED') {
      expect(reorder.newOrder[0]).toBe(cards[2].instanceId);
      expect(reorder.newOrder[1]).toBe(cards[3].instanceId);
    }
  });

  // --- detectTieForChoice: ramas síncronas sí, diferidas no -----------------
  it('detecta empate dentro de una rama síncrona (FOR_EACH)', () => {
    const cardDef = makeDef({
      id: 'test.tie',
      name: 'Tie',
      type: 'ABILITY',
      effects: [
        {
          type: 'FOR_EACH',
          collection: 'ENEMIES',
          effects: [
            {
              type: 'DEAL_DAMAGE_TO_HERO',
              amount: { kind: 'CONSTANT', value: 1 },
              target: { kind: 'HERO_WITH_FEWEST_WOUNDS' },
            },
          ],
        },
      ],
    });
    const state = makeGameState({
      players: {
        p1: makePlayer({ playerId: 'p1', wounds: 1 }),
        p2: makePlayer({ playerId: 'p2', wounds: 1 }),
      },
      playerOrder: ['p1', 'p2'],
      battlefield: [makeEnemy()],
    });
    const result = resolveCard(
      state, makeCard({ ownerId: 'p1' }), cardDef, null,
      state.players.p1, rng, registry, catalogWith(cardDef),
    );
    expect(result.pendingChoice?.type).toBe('SELECT_HERO');
    expect(result.pendingChoice?.options).toEqual(['p1', 'p2']);
  });

  it('NO detecta empate dentro de PLACE_PERSISTENT (efecto diferido)', () => {
    // rogue.trap usa este patrón: el ENEMY_WITH_MAX_FORTITUDE se evalúa
    // durante el ataque de la Horda, no al jugar la carta.
    const cardDef = makeDef({
      id: 'test.trap',
      name: 'Trampa',
      type: 'ABILITY',
      effects: [
        {
          type: 'PLACE_PERSISTENT',
          trigger: 'HORDE_ATTACK',
          effects: [
            {
              type: 'DEAL_DAMAGE',
              amount: { kind: 'CONSTANT', value: 2 },
              target: { kind: 'ENEMY_WITH_MAX_FORTITUDE' },
            },
          ],
        },
      ],
    });
    const state = makeGameState({
      battlefield: [
        makeEnemy({ baseFortitude: 3 }),
        makeEnemy({ baseFortitude: 3 }), // empate — pero es diferido
      ],
    });
    const result = resolveCard(
      state, makeCard({ ownerId: 'p1' }), cardDef, null,
      state.players.p1, rng, registry, catalogWith(cardDef),
    );
    expect(result.pendingChoice?.type ?? null).not.toBe('SELECT_ENEMY');
  });

  // --- Habilidades de héroe -------------------------------------------------
  it('héroe sin efectos declarativos ni implementación no consume uso', () => {
    const heroDef = makeDef({
      id: 'hero.test-vacio',
      name: 'Vacio',
      type: 'HERO',
      heroAbility: { uses: 1, effects: [] },
    });
    const catalog = catalogWith(heroDef);
    const state = makeGameState({
      players: { p1: makePlayer({ playerId: 'p1', heroId: 'hero.test-vacio', heroUsesRemaining: 1 }) },
    });
    const result = useHeroAbility(state, 'p1', rng, catalog);
    expect(result.events.filter(e => e.type === 'HERO_ABILITY_USED')).toHaveLength(0);
    expect(result.state.players.p1.heroUsesRemaining).toBe(1);
  });

  it('heroAbility.effects del catálogo se ejecuta genéricamente', () => {
    const heroDef = makeDef({
      id: 'hero.test-custom',
      name: 'Custom',
      type: 'HERO',
      heroAbility: {
        uses: 1,
        effects: [{ type: 'GAIN_COINS', amount: { kind: 'CONSTANT', value: 5 } }],
      },
    });
    const catalog = catalogWith(heroDef);
    const state = makeGameState({
      players: {
        p1: makePlayer({ playerId: 'p1', heroId: 'hero.test-custom', heroUsesRemaining: 1, coins: 0 }),
      },
    });
    const result = useHeroAbility(state, 'p1', rng, catalog);
    expect(result.events.some(e => e.type === 'HERO_ABILITY_USED')).toBe(true);
    expect(result.state.players.p1.heroUsesRemaining).toBe(0);
    expect(result.events.some(e => e.type === 'COINS_GAINED' && e.amount === 5)).toBe(true);
  });

  // --- VULNERABILITY_APPLIED transporta duration -----------------------------
  it('VULNERABILITY_APPLIED respeta la duration del evento', () => {
    const enemy = makeEnemy({ instanceId: 'e1' });
    const state = makeGameState({ battlefield: [enemy] });
    const next = applyEvent(state, {
      type: 'VULNERABILITY_APPLIED',
      enemyInstanceId: 'e1',
      bonus: 2,
      duration: 'PERMANENT',
      seq: 1,
    });
    const mod = next.battlefield[0].modifiers.find(m => m.layer === 'DAMAGE_BONUS');
    expect(mod?.duration).toBe('PERMANENT');
  });

  // --- peritia.condition fail-closed ----------------------------------------
  it('peritia con condition irreconocible NO dispara sus efectos', () => {
    const warlordDef = makeDef({
      id: 'warlord.test-mal',
      name: 'Mal',
      type: 'WARLORD',
      peritia: {
        trigger: 'DAMAGE_DEALT',
        condition: 'syntax error no parseable',
        effects: [{ type: 'LOSE_CARDS', amount: { kind: 'CONSTANT', value: 2 } }],
      },
    });
    const attackDef = makeDef({
      id: 'test.stab',
      name: 'Puñalada',
      type: 'ABILITY',
      printedAttack: 1,
      effects: [
        {
          type: 'DEAL_DAMAGE',
          amount: { kind: 'CONSTANT', value: 1 },
          target: { kind: 'SELECTED_ENEMY' },
        },
      ],
    });
    const catalog = catalogWith(warlordDef, attackDef);
    const warlord = makeEnemy({
      instanceId: 'w1', isWarlord: true, definitionId: 'warlord.test-mal', baseFortitude: 9,
    });
    const player = makePlayer({
      playerId: 'p1',
      abilityDeck: [makeCard({ ownerId: 'p1', zone: 'ABILITY_DECK' }), makeCard({ ownerId: 'p1', zone: 'ABILITY_DECK' })],
    });
    const state = makeGameState({ battlefield: [warlord], players: { p1: player } });
    const result = resolveCard(
      state, makeCard({ definitionId: 'test.stab', ownerId: 'p1' }), attackDef,
      warlord.instanceId, player, rng, registry, catalog,
    );
    // La condición no parseable debe fallar cerrado â†’ nada de CARDS_LOST
    expect(result.events.some(e => e.type === 'CARDS_LOST')).toBe(false);
  });

  it('peritia con condition válida y cierta sí dispara', () => {
    const warlordDef = makeDef({
      id: 'warlord.test-ok',
      name: 'Ok',
      type: 'WARLORD',
      peritia: {
        trigger: 'DAMAGE_DEALT',
        condition: 'printedAttack == 1',
        effects: [{ type: 'LOSE_CARDS', amount: { kind: 'CONSTANT', value: 1 } }],
      },
    });
    const attackDef = makeDef({
      id: 'test.stab',
      name: 'Puñalada',
      type: 'ABILITY',
      printedAttack: 1,
      effects: [
        {
          type: 'DEAL_DAMAGE',
          amount: { kind: 'CONSTANT', value: 1 },
          target: { kind: 'SELECTED_ENEMY' },
        },
      ],
    });
    const catalog = catalogWith(warlordDef, attackDef);
    const warlord = makeEnemy({
      instanceId: 'w1', isWarlord: true, definitionId: 'warlord.test-ok', baseFortitude: 9,
    });
    const player = makePlayer({
      playerId: 'p1',
      abilityDeck: [makeCard({ ownerId: 'p1', zone: 'ABILITY_DECK' }), makeCard({ ownerId: 'p1', zone: 'ABILITY_DECK' })],
    });
    const state = makeGameState({ battlefield: [warlord], players: { p1: player } });
    const result = resolveCard(
      state, makeCard({ definitionId: 'test.stab', ownerId: 'p1' }), attackDef,
      warlord.instanceId, player, rng, registry, catalog,
    );
    expect(result.events.some(e => e.type === 'CARDS_LOST')).toBe(true);
  });

  // --- Ledger de coste de mercado -------------------------------------------
  it('MODIFIER_ADDED a market registra la fuente y ENEMY_DEFEATED la revierte', () => {
    const enemy = makeEnemy({ instanceId: 'src-enemy' });
    let state = makeGameState({ battlefield: [enemy], marketCostModifier: 0 });
    state = applyEvent(state, {
      type: 'MODIFIER_ADDED',
      modifierId: 'm1',
      targetId: 'market',
      layer: 'MARKET_COST',
      amount: -2,
      sourceId: 'src-enemy',
      seq: 1,
    });
    expect(state.marketCostModifier).toBe(-2);
    expect(state.marketCostSources?.['src-enemy']).toBe(-2);

    state = applyEvent(state, {
      type: 'ENEMY_DEFEATED',
      enemyInstanceId: 'src-enemy',
      enemyDefinitionId: enemy.definitionId,
      defeatingPlayerId: 'p1',
      reward: { coins: 0, glory: 0 },
      seq: 2,
    });
    expect(state.marketCostModifier).toBe(0);
    expect(state.marketCostSources?.['src-enemy']).toBeUndefined();
  });

  it('ENEMY_RETURNED_TO_HORDE honra position y conserva la reversión de mercado', () => {
    const enemy = makeEnemy({ instanceId: 'ret-enemy' });
    const filler = { instanceId: 'deck-card', definitionId: 'd', ownerId: 'horde', zone: 'HORDE_DECK' } as const;
    let state = makeGameState({ battlefield: [enemy], hordeDeck: [filler], marketCostModifier: 0 });
    state = applyEvent(state, {
      type: 'MODIFIER_ADDED',
      modifierId: 'm1',
      targetId: 'market',
      layer: 'MARKET_COST',
      amount: -1,
      sourceId: 'ret-enemy',
      seq: 1,
    });
    // BOTTOM: el enemigo va al final del mazo (de donde se roba)
    let s = applyEvent(state, {
      type: 'ENEMY_RETURNED_TO_HORDE',
      enemyInstanceId: 'ret-enemy',
      position: 'BOTTOM',
      seq: 2,
    });
    expect(s.hordeDeck.map(c => c.instanceId)).toEqual(['deck-card', 'ret-enemy']);
    expect(s.battlefield).toHaveLength(0);
    // El estado devuelto por revertMarketCostSource no se descartaba
    expect(s.marketCostModifier).toBe(0);
    expect(s.marketCostSources?.['ret-enemy']).toBeUndefined();
    // TOP: se prepone al índice 0 (el robo va por el final)
    s = applyEvent(state, {
      type: 'ENEMY_RETURNED_TO_HORDE',
      enemyInstanceId: 'ret-enemy',
      position: 'TOP',
      seq: 2,
    });
    expect(s.hordeDeck.map(c => c.instanceId)).toEqual(['ret-enemy', 'deck-card']);
    expect(s.marketCostModifier).toBe(0);
  });

  // --- ENEMY_DAMAGE_DISABLED honra la duración --------------------------------
  it('disable con PERMANENT sobrevive al fin del ataque de la Horda', () => {
    const state = makeGameState({
      battlefield: [makeEnemy({ instanceId: 'e1' })],
    });
    let s = applyEvent(state, {
      type: 'ENEMY_DAMAGE_DISABLED',
      enemyInstanceId: 'e1',
      duration: 'PERMANENT',
      seq: 1,
    });
    expect(s.battlefield[0].damageDisabled).toBe(true);
    s = expireModifiers(s, 'HORDE_ATTACK_END');
    expect(s.battlefield[0].damageDisabled).toBe(true);
    // …pero el Restablecimiento sí lo limpia si no es PERMANENT/WHILE_SOURCE_ACTIVE
    const s2 = applyEvent(state, {
      type: 'ENEMY_DAMAGE_DISABLED',
      enemyInstanceId: 'e1',
      duration: 'PERMANENT',
      seq: 1,
    });
    const restored = cleanupRestoration(s2);
    expect(restored.battlefield[0].damageDisabled).toBe(true); // PERMANENT sobrevive
  });

  it('disable UNTIL_END_OF_TURN se limpia en END_OF_TURN y en Restablecimiento', () => {
    const state = makeGameState({ battlefield: [makeEnemy({ instanceId: 'e1' })] });
    let s = applyEvent(state, {
      type: 'ENEMY_DAMAGE_DISABLED',
      enemyInstanceId: 'e1',
      duration: 'UNTIL_END_OF_TURN',
      seq: 1,
    });
    // Sobrevive al fin del ataque (a diferencia del HORDE_ATTACK legacy)
    s = expireModifiers(s, 'HORDE_ATTACK_END');
    expect(s.battlefield[0].damageDisabled).toBe(true);
    s = expireModifiers(s, 'END_OF_TURN');
    expect(s.battlefield[0].damageDisabled).toBe(false);
    // Y también en el Restablecimiento (backstop)
    const s3 = applyEvent(state, {
      type: 'ENEMY_DAMAGE_DISABLED',
      enemyInstanceId: 'e1',
      duration: 'UNTIL_END_OF_TURN',
      seq: 1,
    });
    expect(cleanupRestoration(s3).battlefield[0].damageDisabled).toBe(false);
  });

  it('disable legacy sin duration se limpia en HORDE_ATTACK_END', () => {
    const state = makeGameState({ battlefield: [makeEnemy({ instanceId: 'e1' })] });
    const s = applyEvent(state, {
      type: 'ENEMY_DAMAGE_DISABLED',
      enemyInstanceId: 'e1',
      seq: 1,
    });
    expect(s.battlefield[0].damageDisabledDuration).toBe('HORDE_ATTACK');
    const s2 = expireModifiers(s, 'HORDE_ATTACK_END');
    expect(s2.battlefield[0].damageDisabled).toBe(false);
  });
});

describe('Trampa � consumo tras empate de Fortaleza', () => {
  let registry: EffectRegistry;
  let rng: DeterministicRng;

  const trapDef = makeDef({
    id: 'rogue.trap',
    name: 'Trampa',
    type: 'ABILITY',
    heroClass: 'ROGUE',
    copies: 1,
    printedAttack: 0,
    effects: [{
      type: 'PLACE_PERSISTENT',
      trigger: 'HORDE_ATTACK',
      effects: [{ type: 'DEFEAT_ENEMY', target: { kind: 'ENEMY_WITH_MAX_FORTITUDE' }, loot: false }],
    }],
  });
  const trapCatalog = catalogWith(trapDef);

  function stateWithTrap(): GameState {
    const trap = makeCard({
      instanceId: 'trap-1',
      definitionId: 'rogue.trap',
      ownerId: 'p1',
      zone: 'IN_FRONT_OF_PLAYER',
    });
    // makeCard solo copia 4 campos del override
    trap.persistentTrigger = 'HORDE_ATTACK';
    return makeGameState({
      players: { p1: makePlayer({ playerId: 'p1', persistentCards: [trap] }) },
      battlefield: [
        makeEnemy({ instanceId: 'e-tie-1', baseFortitude: 5 }),
        makeEnemy({ instanceId: 'e-tie-2', baseFortitude: 5 }),
      ],
    });
  }

  beforeEach(() => {
    resetTestCounters();
    resetResolveSeq();
    registry = new EffectRegistry();
    registerCoreEffects(registry);
    rng = new DeterministicRng('trap-tie');
  });

  it('el empate crea la elecci�n; al resolverla la trampa se consume', () => {
    const state = stateWithTrap();
    const first = processHordeAttackTriggers(state, rng, registry, trapCatalog);
    expect(first.pendingChoice?.type).toBe('SELECT_ENEMY');
    // A�n no se ha consumido: la elecci�n sigue pendiente
    expect(first.state.players.p1.persistentCards).toHaveLength(1);

    const chosen = first.pendingChoice!.options[0];
    const second = processHordeAttackTriggers(first.state, rng, registry, trapCatalog, chosen);
    // La trampa derrota al enemigo elegido y sale del juego � antes del
    // fix quedaba en persistentCards y re-disparaba en cada Horda.
    expect(second.state.players.p1.persistentCards).toHaveLength(0);
    expect(second.events.map(e => e.type)).toContain('PERSISTENT_CARD_REMOVED');
    expect(second.events.map(e => e.type)).toContain('CARD_REMOVED_FROM_GAME');
    expect(second.state.battlefield.some(e => e.instanceId === chosen)).toBe(false);
  });
});

describe('Comandos � validaciones reforzadas', () => {
  let registry: EffectRegistry;
  let rng: DeterministicRng;

  beforeEach(() => {
    resetTestCounters();
    resetResolveSeq();
    registry = new EffectRegistry();
    registerCoreEffects(registry);
    rng = new DeterministicRng('cmd-validation');
  });

  it('RESOLVE_CHOICE no puede consumir la puja de lider ni el turn-start', () => {
    // La puja se resuelve con CHOOSE_LEADER_CARDS; si RESOLVE_CHOICE la
    // aceptaba, el fallthrough la borraba sin registrar la puja y la
    // partida quedaba bloqueada en INITIAL_PLAYER_SELECTION.
    const state = makeGameState({
      pendingChoices: [{
        choiceId: 'leader-bid-p1',
        type: 'SELECT_CARDS_FOR_LEADER',
        playerId: 'p1',
        options: ['c1'],
        minSelections: 1,
        maxSelections: 2,
        prompt: 'bid',
      }],
    });
    const res = execute(state, {
      type: 'RESOLVE_CHOICE', cid: 'rc-bid', actorId: 'p1', choiceId: 'leader-bid-p1', selectedIds: ['c1'],
    }, rng);
    expect(res.accepted).toBe(false);
    expect(state.pendingChoices).toHaveLength(1); // rechazada, no consumida
    // Igual para la confirmacion de turno (va por ACCEPT_TURN_START_EFFECT)
    const state2 = makeGameState({
      pendingChoices: [{
        choiceId: 'turn-start-3',
        type: 'CONFIRM',
        playerId: 'p1',
        options: ['yes'],
        minSelections: 1,
        maxSelections: 1,
        prompt: 'confirm',
      }],
    });
    const res2 = execute(state2, {
      type: 'RESOLVE_CHOICE', cid: 'rc-ts', actorId: 'p1', choiceId: 'turn-start-3', selectedIds: ['yes'],
    }, rng);
    expect(res2.accepted).toBe(false);
    expect(state2.pendingChoices).toHaveLength(1);
  });

  it('EVASION queda bloqueada por una elecci�n obligatoria pendiente', () => {
    const hand = [makeCard({ ownerId: 'p1' }), makeCard({ ownerId: 'p1' })];
    const state = makeGameState({
      phase: 'ATTACK_CHOICE',
      players: { p1: makePlayer({ playerId: 'p1', hand }) },
      pendingChoices: [{
        choiceId: 'c-block',
        playerId: 'p1',
        type: 'SELECT_CARD_FROM_HAND',
        prompt: 'descarta',
        options: [hand[0].instanceId],
        minSelections: 1,
        maxSelections: 1,
      }],
    });
    const result = execute(state, {
      type: 'EVASION',
      cid: 'e-blocked',
      discardedCardInstanceIds: hand.map(c => c.instanceId),
    }, rng, registry, catalogWith());
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('Resolve pending choices first');
  });

  it('EVASION aceptada sin elecciones obligatorias pendientes', () => {
    const hand = [makeCard({ ownerId: 'p1' }), makeCard({ ownerId: 'p1' })];
    const state = makeGameState({
      phase: 'ATTACK_CHOICE',
      players: { p1: makePlayer({ playerId: 'p1', hand }) },
    });
    const result = execute(state, {
      type: 'EVASION',
      cid: 'e-ok',
      discardedCardInstanceIds: hand.map(c => c.instanceId),
    }, rng, registry, catalogWith());
    expect(result.accepted).toBe(true);
  });
});

describe('EventBus - recuperacion tras excepcion', () => {
  it('un throw (MAX_EVENT_DEPTH) no envenena el bus: los emits posteriores se procesan', () => {
    const state = makeGameState();
    const rng = new DeterministicRng('bus-recovery');
    const registry = new EffectRegistry();
    registerCoreEffects(registry);
    const bus = new EventBus(registry, rng);
    bus.setState(state);

    // Listener auto-realimentado: COINS_GAINED -> GAIN_COINS emite otro
    // COINS_GAINED -> la cola nunca se vacia hasta MAX_EVENT_DEPTH.
    bus.subscribe({
      eventType: 'COINS_GAINED',
      predicate: () => true,
      effects: [{ type: 'GAIN_COINS', amount: { kind: 'CONSTANT', value: 1 } } as CardEffect],
      ownerId: 'loop',
      timestamp: 0,
      priority: 10,
    });

    expect(() =>
      bus.emit({ type: 'COINS_GAINED', playerId: 'p1', amount: 1, seq: 1 } as GameEvent)
    ).toThrow(/MAX_EVENT_DEPTH/);

    // Sin el try/finally, `processing` quedaba en true y este emit solo
    // encolaba - el listener nunca se evaluaba.
    bus.unsubscribe('loop');
    let hits = 0;
    bus.subscribe({
      eventType: 'PHASE_CHANGED',
      predicate: () => { hits++; return false; },
      effects: [],
      ownerId: 'probe',
      timestamp: 1,
      priority: 10,
    });
    bus.emit({ type: 'PHASE_CHANGED', phase: 'ATTACK_CHOICE', seq: 9999 } as GameEvent);
    expect(hits).toBe(1);
  });
});

describe('Ronda: carta ajena, reorder y oyentes', () => {
  let registry: EffectRegistry;
  let rng: DeterministicRng;

  beforeEach(() => {
    resetTestCounters();
    resetResolveSeq();
    registry = new EffectRegistry();
    registerCoreEffects(registry);
    rng = new DeterministicRng('audit-2');
  });

  it('PLAY_RANDOM_CARD_FROM_OTHER_HERO resuelve los efectos de la carta y va al Desgaste del dueno', () => {
    const stolenDef = makeDef({
      id: 'test.stolen-coins',
      name: 'Monedero ajeno',
      type: 'ABILITY',
      destinationAfterUse: 'WEAR_PILE',
      effects: [{ type: 'GAIN_COINS', amount: { kind: 'CONSTANT', value: 3 }, target: { kind: 'SELF' } }],
    });
    const playedDef = makeDef({
      id: 'test.borrow',
      name: 'Prestamo',
      type: 'ABILITY',
      effects: [{ type: 'PLAY_RANDOM_CARD_FROM_OTHER_HERO', costGlory: { kind: 'CONSTANT', value: 0 } }],
    });
    const stolenCard = makeCard({ instanceId: 'stolen-1', definitionId: 'test.stolen-coins', ownerId: 'p2' });
    const state = makeGameState({
      players: {
        p1: makePlayer({ playerId: 'p1', coins: 0, glory: 5 }),
        p2: makePlayer({ playerId: 'p2', hand: [stolenCard] }),
      },
      playerOrder: ['p1', 'p2'],
    });
    const result = resolveCard(
      state,
      makeCard({ instanceId: 'played-1', definitionId: 'test.borrow', ownerId: 'p1' }),
      playedDef, null, state.players.p1, rng, registry,
      catalogWith(playedDef, stolenDef),
    );
    // La carta robada SE JUEGA: sus efectos se ejecutan (COINS_GAINED
    // para el activo) y acaba en el Desgaste de su dueño, no en la mano
    // del lanzador como antes (quedaba robada para siempre).
    expect(result.events.some(e => e.type === 'CARD_PLAYED' && e.cardInstanceId === 'stolen-1')).toBe(true);
    expect(result.events.some(e => e.type === 'COINS_GAINED')).toBe(true);
    const next = result.newState;
    expect(next.players.p2.hand).toHaveLength(0);
    expect(next.players.p2.wearPile.map(c => c.instanceId)).toContain('stolen-1');
    expect(next.players.p1.hand.map(c => c.instanceId)).not.toContain('stolen-1');
    expect(next.players.p1.coins).toBe(3);
  });

  it('LOOK_AT_CARDS con REORDER crea pendingChoice SELECT_ORDER sobre el fondo de la Horda', () => {
    const lookDef = makeDef({
      id: 'test.look',
      name: 'Vista del horizonte',
      type: 'ABILITY',
      effects: [{ type: 'LOOK_AT_CARDS', deck: 'HORDE', amount: { kind: 'CONSTANT', value: 3 }, action: 'REORDER' }],
    });
    const state = makeGameState({
      players: { p1: makePlayer({ playerId: 'p1' }) },
      playerOrder: ['p1'],
      hordeDeck: ['h1', 'h2', 'h3', 'h4', 'h5'].map(id =>
        makeCard({ instanceId: id, definitionId: 'horde.x', ownerId: 'horde', zone: 'HORDE_DECK' as const })),
    });
    const result = resolveCard(
      state,
      makeCard({ instanceId: 'look-1', definitionId: 'test.look', ownerId: 'p1' }),
      lookDef, null, state.players.p1, rng, registry, catalogWith(lookDef),
    );
    expect(result.pendingChoice?.type).toBe('SELECT_ORDER');
    expect(result.pendingChoice?.options).toEqual(['h3', 'h4', 'h5']);
    expect(result.events.some(e => e.type === 'CARDS_REVEALED_TO_PLAYER')).toBe(true);
  });

  it('un oyente que derrota al enemigo emite ENEMY_DEFEATED (sin zombis)', async () => {
    const { dispatchListeners } = await import('../src/effects/listeners.js');
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 2, wounds: 1 });
    const state = makeGameState({
      players: { p1: makePlayer({ playerId: 'p1' }) },
      playerOrder: ['p1'],
      battlefield: [enemy],
      listeners: [{
        id: 'L1',
        playerId: 'p1',
        trigger: 'COINS_GAINED',
        effects: [{
          type: 'DEAL_DAMAGE',
          amount: { kind: 'CONSTANT', value: 5 },
          target: { kind: 'SELECTED_ENEMY' },
        } as CardEffect],
      }],
    });
    // El evento disparador lleva el targetId del enemigo (inferido como objetivo)
    const out = dispatchListeners(
      state,
      { type: 'COINS_GAINED', playerId: 'p1', amount: 1, targetId: 'e1', seq: 1 } as unknown as GameEvent,
      { registry, rng, nextSeq: (() => { let n = 100; return () => ++n; })() },
    );
    expect(out.events.some(e => e.type === 'ENEMY_DEFEATED' && e.enemyInstanceId === 'e1')).toBe(true);
    expect(out.state.battlefield.find(e => e.instanceId === 'e1')).toBeUndefined();
  });
});
