/**
 * Regresión de la auditoría del Taller — bugs del motor corregidos:
 *
 * - DEAL_DAMAGE no aplicaba MODIFY_DAMAGE (los +N de "para la próxima
 *   carta" solo se sumaban al daño impreso).
 * - RECOVER_CARD_BY_NAME ignoraba `to` (siempre mandaba al mazo).
 * - SEARCH_DECK ignoraba deck='HORDE' (caía al mazo de Habilidad) y
 *   amount (siempre 1 carta).
 * - dispatchListeners es idempotente por seq: execute() puede re-despachar
 *   eventos del resolver sin disparar oyentes dos veces.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import {
  EffectRegistry, registerCoreEffects,
} from '../src/effects/registry.js';
import { EventBus } from '../src/triggers/index.js';
import { applyEvent } from '../src/events/applyEvent.js';
import { setupGame, resetInstanceCounter } from '../src/phases/setup.js';
import { resetPhaseSeq } from '../src/phases/engine.js';
import { resetResolveSeq } from '../src/effects/resolver.js';
import { dispatchListeners } from '../src/effects/listeners.js';
import { nextSeq } from '../src/seq.js';
import { loadCatalog, EFFECT_REGISTRY, type CatalogLoadResult } from '@nt4h/catalog';
import type {
  GameState, ResolutionContext, CardEffect, CardListener,
} from '@nt4h/schema';

const C = (v: number) => ({ kind: 'CONSTANT', value: v }) as const;

let catalog: CatalogLoadResult;
let state: GameState;
let rng: DeterministicRng;
let reg: EffectRegistry;
let ctx: ResolutionContext;

function run(eff: CardEffect) {
  return reg.execute(eff, ctx, state, rng, new EventBus(reg, rng));
}

beforeEach(() => {
  resetInstanceCounter();
  resetPhaseSeq();
  resetResolveSeq();
  catalog = loadCatalog();
  const res = setupGame({
    mode: 'STANDARD',
    playerCount: 2,
    seed: 'ws-audit',
    heroes: [
      { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
      { playerId: 'p2', heroId: 'hero.neddia', heroFace: 'FEMALE', deckId: 'explorer.default' },
    ],
    useScenarios: false,
  }, catalog);
  expect(res.errors).toEqual([]);
  state = res.state;
  rng = new DeterministicRng('ws-audit');
  reg = new EffectRegistry();
  registerCoreEffects(reg);
  ctx = {
    activePlayerId: 'p1',
    currentCardId: 'custom.test',
    currentCardName: 'Carta de Prueba',
    currentCardInstanceId: 'inst-test-1',
    selectedEnemyId: state.battlefield[0]?.instanceId ?? null,
    cardsPlayedThisTurn: {},
    cardsPlayedAgainstEnemy: {},
    drawnCardInstanceId: null,
    sourceZone: 'HAND',
    enemiesDefeatedThisResolution: [],
    depth: 0,
  };
});

describe('DEAL_DAMAGE aplica MODIFY_DAMAGE', () => {
  it('sume el bonus de daño del jugador como el daño impreso', () => {
    const target = state.battlefield[0];
    // +2 de daño para la próxima carta (p.ej. Enfocar)
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          modifiers: [{
            id: 'mod-1', sourceId: 'test', layer: 'DAMAGE_BONUS',
            timestamp: 0, duration: 'UNTIL_END_OF_TURN', amount: 2,
          }],
        },
      },
    };
    const evs = run({
      type: 'DEAL_DAMAGE', target: { kind: 'SELECTED_ENEMY' }, amount: C(1),
    } as CardEffect);
    const dmg = evs.find(e => e.type === 'DAMAGE_DEALT');
    expect(dmg).toBeDefined();
    expect((dmg as { amount: number }).amount).toBe(3);
    expect((dmg as { targetId: string }).targetId).toBe(target.instanceId);
  });
});

describe('RECOVER_CARD_BY_NAME respeta `to`', () => {
  const seedWear = () => {
    const card = state.players.p1.abilityDeck[0];
    state = applyEvent(state, {
      type: 'CARD_MOVED', cardInstanceId: card.instanceId,
      from: 'ABILITY_DECK', to: 'WEAR_PILE', playerId: 'p1', seq: nextSeq(),
    });
    return card;
  };

  it('to=HAND mueve la carta a la mano', () => {
    const card = seedWear();
    const evs = run({
      type: 'RECOVER_CARD_BY_NAME', name: card.name,
      from: 'WEAR_PILE', to: 'HAND',
    } as CardEffect);
    const mv = evs.find(e => e.type === 'CARD_MOVED');
    expect(mv).toBeDefined();
    expect((mv as { to: string }).to).toBe('HAND');
  });

  it('to=BOTTOM_OF_DECK mueve la carta al fondo del mazo', () => {
    const card = seedWear();
    const evs = run({
      type: 'RECOVER_CARD_BY_NAME', name: card.name,
      from: 'WEAR_PILE', to: 'BOTTOM_OF_DECK',
    } as CardEffect);
    const mv = evs.find(e => e.type === 'CARD_MOVED');
    expect((mv as { to: string }).to).toBe('ABILITY_DECK');
    const next = applyEvent(state, mv!);
    expect(next.players.p1.abilityDeck.at(-1)?.instanceId).toBe(card.instanceId);
  });
});

describe('SEARCH_DECK con deck=HORDE y amount', () => {
  it('PUT_IN_HAND toma N cartas del mazo de la Horda', () => {
    const evs = run({
      type: 'SEARCH_DECK', deck: 'HORDE', filter: {}, action: 'PUT_IN_HAND', amount: 2,
    } as CardEffect);
    const moves = evs.filter(e => e.type === 'CARD_MOVED' && (e as { from: string }).from === 'HORDE_DECK');
    expect(moves).toHaveLength(2);
    // La aplicación real: las cartas salen del mazo de la Horda a la mano.
    let s = state;
    for (const e of moves) s = applyEvent(s, e);
    expect(s.hordeDeck.length).toBe(state.hordeDeck.length - 2);
    expect(s.players.p1.hand.length).toBe(state.players.p1.hand.length + 2);
  });

  it('SWAP_WITH_HAND en HORDE intercambia hasta N cartas', () => {
    const evs = run({
      type: 'SEARCH_DECK', deck: 'HORDE', filter: {}, action: 'SWAP_WITH_HAND', amount: 2,
    } as CardEffect);
    const toHorde = evs.filter(e => e.type === 'CARD_MOVED' && (e as { to: string }).to === 'HORDE_DECK');
    const fromHorde = evs.filter(e => e.type === 'CARD_MOVED' && (e as { from: string }).from === 'HORDE_DECK');
    expect(toHorde).toHaveLength(2);
    expect(fromHorde).toHaveLength(2);
    // Y al aplicarlo el mazo de la Horda conserva su tamaño.
    let s = state;
    for (const e of evs) s = applyEvent(s, e);
    expect(s.hordeDeck.length).toBe(state.hordeDeck.length);
  });
});

describe('dispatchListeners es idempotente por evento', () => {
  it('el mismo seq no dispara oyentes dos veces', () => {
    const listener: CardListener = {
      id: 'lis-1',
      playerId: 'p1',
      trigger: 'DAMAGE_DEALT',
      effects: [{ type: 'GAIN_COINS', amount: C(1) } as CardEffect],
    };
    state = { ...state, listeners: [listener] };
    const ev = {
      type: 'DAMAGE_DEALT', targetId: state.battlefield[0].instanceId,
      amount: 1, seq: nextSeq(),
    } as const;
    const deps = { registry: reg, rng, nextSeq };
    const first = dispatchListeners(state, ev as never, deps);
    expect(first.events.some(e => e.type === 'COINS_GAINED')).toBe(true);
    // Segundo pase sobre el mismo evento (p.ej. resolver + wrapper de
    // execute): no vuelve a disparar el oyente.
    const second = dispatchListeners(first.state, ev as never, deps);
    expect(second.events).toHaveLength(0);
    expect(second.state).toBe(first.state);
  });
});

describe('cobertura EFFECT_REGISTRY ↔ handlers del motor', () => {
  // El EFFECT_REGISTRY del catálogo es lo que el Taller ofrece en el
  // editor: un tipo declarado sin register() en el motor sería un no-op
  // silencioso en partida (execute lanza 'Unknown effect type'). Este
  // test impide que ambos registros deriven por separado.
  it('todo tipo declarado en el catálogo tiene handler en el motor', () => {
    const missing = EFFECT_REGISTRY
      .map(m => m.type)
      .filter(t => !reg.has(t));
    expect(missing).toEqual([]);
  });
});
