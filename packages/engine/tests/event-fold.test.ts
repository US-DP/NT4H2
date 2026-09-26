/**
 * Fidelidad del event sourcing (§51.12): el fold del eventLog debe reproducir
 * el mismo estado que la ejecución directa.
 *
 * Regresión D440: varias mutaciones no tenían representación en eventos —
 * ENEMY_REVEALED era un no-op, SCENARIO_REVEALED no extraía la carta del
 * mazo, expireModifiers/limpiezas de fase mutaban sin emitir, las podas de
 * pendingChoices y la retirada de trofeos eran silenciosas. Además los
 * triggers de HORDE_ATTACK se aplicaban dos veces (inline + applyBatch),
 * duplicando recompensas de escenario en directo respecto al replay.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { EffectRegistry, registerCoreEffects } from '../src/effects/registry.js';
import { setupGame, startFirstTurn, resetInstanceCounter } from '../src/phases/setup.js';
import { processPhases, resetPhaseSeq } from '../src/phases/engine.js';
import { resetResolveSeq } from '../src/effects/resolver.js';
import { execute } from '../src/commands/execute.js';
import { applyEvent, replayEvents } from '../src/events/applyEvent.js';
import { loadCatalog } from '@nt4h/catalog';
import { makeGameState } from './fixtures/builders.js';
import type { Command, GameEvent, GameState } from '@nt4h/schema';

const catalog = loadCatalog();

/** Normaliza los campos que por diseño no viajan por eventos:
 *  - rngState: lo fija execute() desde el RNG, no es event-sourced.
 *  - pendingChoices: se regeneran re-ejecutando comandos; los eventos solo
 *    documentan su retirada (PENDING_CHOICES_REMOVED). */
function normalize(state: GameState): string {
  const s = structuredClone(state);
  s.rngState = { seed: '', state: 0 };
  s.pendingChoices = [];
  return JSON.stringify(s);
}

function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      `${path}.${k}`,
    );
    if (d) return d;
  }
  return null;
}

describe('Fold del eventLog — fidelidad respecto a ejecución directa', () => {
  let registry: EffectRegistry;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();
    registry = new EffectRegistry();
    registerCoreEffects(registry);
  });

  function freshGame(seed: string, useScenarios = false) {
    const setup = setupGame({
      mode: 'STANDARD',
      playerCount: 2,
      seed,
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios,
    }, catalog);
    const turn = startFirstTurn(setup.state, new DeterministicRng(seed), catalog);
    return { base: turn.state, rng: new DeterministicRng(seed) };
  }

  /** Ejecuta un comando + fases acumulando eventos; devuelve el estado final
   *  directo y todos los eventos emitidos desde el estado base. */
  function runCommands(
    base: GameState,
    rng: DeterministicRng,
    cmds: Command[],
  ): { final: GameState; events: GameEvent[] } {
    let state = base;
    const events: GameEvent[] = [];
    for (const cmd of cmds) {
      const r = execute(state, cmd, rng, registry, catalog);
      if (!r.accepted) continue;
      events.push(...r.events);
      const phased = processPhases(r.newState, rng, catalog);
      events.push(...phased.events);
      state = phased.state;
    }
    return { final: state, events };
  }

  it('END_TURN completo: el fold reproduce el estado (ataque Horda, restablecimiento, reposición)', () => {
    const { base, rng } = freshGame('fold-end-turn');
    const { final, events } = runCommands(base, rng, [
      { type: 'END_ATTACK', cid: 'c1' },
      { type: 'END_TURN', cid: 'c2' },
    ]);

    const folded = replayEvents(base, events);
    const d = firstDiff(
      JSON.parse(normalize(folded)),
      JSON.parse(normalize(final)),
    );
    expect(d).toBeNull();
  });

  it('ciclo de varios turnos con escenarios: convergencia del fold', () => {
    const { base, rng } = freshGame('fold-multi', true);
    const { final, events } = runCommands(base, rng, [
      { type: 'END_ATTACK', cid: 'c1' },
      { type: 'END_TURN', cid: 'c2' },
      { type: 'END_ATTACK', cid: 'c3' },
      { type: 'END_TURN', cid: 'c4' },
    ]);

    const folded = replayEvents(base, events);
    const d = firstDiff(
      JSON.parse(normalize(folded)),
      JSON.parse(normalize(final)),
    );
    expect(d).toBeNull();
  });

  it('el ciclo emite EFFECTS_EXPIRED para cada limpieza de fase', () => {
    const { base, rng } = freshGame('fold-cleanup-emit');
    const { events } = runCommands(base, rng, [
      { type: 'END_ATTACK', cid: 'c1' },  // → HORDE_ATTACK (cleanup HORDE_ATTACK_END)
      { type: 'END_TURN', cid: 'c2' },    // → RESTORATION + TURN_END
    ]);
    const scopes = events
      .filter(e => e.type === 'EFFECTS_EXPIRED')
      .map(e => (e as { scope: string }).scope);
    expect(scopes).toContain('HORDE_ATTACK_END');
    expect(scopes).toContain('RESTORATION');
    expect(scopes).toContain('TURN_END');
  });
});

describe('Reducers de los nuevos eventos', () => {
  it('ENEMY_REVEALED con payload mueve la carta de la Horda al campo', () => {
    const hordeCard = { instanceId: 'horde-1', definitionId: 'horde.orc', ownerId: 'horde', zone: 'HORDE_DECK' as const };
    const state = makeGameState({ hordeDeck: [hordeCard] });
    const enemy = {
      instanceId: hordeCard.instanceId,
      definitionId: hordeCard.definitionId,
      baseFortitude: 3,
      wounds: 0,
      reward: { coins: 1, glory: 1 },
      modifiers: [],
      isWarlord: false,
      isOrc: true,
      specialIcons: [],
      damageDisabled: false,
    };
    const next = applyEvent(state, {
      type: 'ENEMY_REVEALED',
      enemyInstanceId: hordeCard.instanceId,
      definitionId: hordeCard.definitionId,
      fortitude: 3,
      enemy,
      seq: 999,
    });
    expect(next.battlefield.some(e => e.instanceId === hordeCard.instanceId)).toBe(true);
    expect(next.hordeDeck.some(c => c.instanceId === hordeCard.instanceId)).toBe(false);
    // Idempotente: re-aplicar no duplica
    const twice = applyEvent(next, {
      type: 'ENEMY_REVEALED',
      enemyInstanceId: hordeCard.instanceId,
      definitionId: hordeCard.definitionId,
      fortitude: 3,
      enemy,
      seq: 1000,
    });
    expect(twice.battlefield.filter(e => e.instanceId === hordeCard.instanceId).length).toBe(1);
  });

  it('SCENARIO_REVEALED extrae la carta del mazo de escenarios', () => {
    const top = { instanceId: 'sc-1', definitionId: 'scenario.x', ownerId: 'scenario', zone: 'SCENARIO_DECK' as const };
    const rest = { instanceId: 'sc-2', definitionId: 'scenario.y', ownerId: 'scenario', zone: 'SCENARIO_DECK' as const };
    const state = makeGameState({ scenarioDeck: [top, rest] });
    const next = applyEvent(state, {
      type: 'SCENARIO_REVEALED',
      scenarioInstanceId: top.instanceId,
      definitionId: top.definitionId,
      seq: 999,
    });
    expect(next.scenario?.instanceId).toBe(top.instanceId);
    expect(next.scenarioDeck.some(c => c.instanceId === top.instanceId)).toBe(false);
  });

  it('EFFECTS_EXPIRED(HORDE_ATTACK_END) resetea defensas y rehabilita enemigos', () => {
    const state = makeGameState({
      players: {
        p1: {
          ...makeGameState().players.p1,
          playerId: 'p1',
          prevention: 3,
          shields: 2,
          damageCancellation: true,
        },
      },
      battlefield: [{
        instanceId: 'e1', definitionId: 'horde.x', baseFortitude: 2, wounds: 0,
        reward: null, modifiers: [], isWarlord: false, isOrc: false,
        specialIcons: [], damageDisabled: true,
      }],
      pendingChoices: [{
        choiceId: 'rw-1', playerId: 'p1', type: 'REACTION_WINDOW',
        prompt: 'x', options: [], minSelections: 0, maxSelections: 0,
      }],
    });
    const next = applyEvent(state, { type: 'EFFECTS_EXPIRED', scope: 'HORDE_ATTACK_END', seq: 1 });
    expect(next.players.p1.prevention).toBe(0);
    expect(next.players.p1.shields).toBe(0);
    expect(next.players.p1.damageCancellation).toBe(false);
    expect(next.battlefield[0].damageDisabled).toBe(false);
    expect(next.pendingChoices).toHaveLength(0);
  });

  it('PENDING_CHOICES_REMOVED retira elecciones por id', () => {
    const state = makeGameState({
      pendingChoices: [
        { choiceId: 'a', playerId: 'p1', type: 'CONFIRM', prompt: 'x', options: [], minSelections: 0, maxSelections: 0 },
        { choiceId: 'b', playerId: 'p1', type: 'CONFIRM', prompt: 'y', options: [], minSelections: 0, maxSelections: 0 },
      ],
    });
    const next = applyEvent(state, { type: 'PENDING_CHOICES_REMOVED', choiceIds: ['a'], seq: 1 });
    expect(next.pendingChoices.map(c => c.choiceId)).toEqual(['b']);
  });

  it('TROPHY_REMOVED retira el trofeo del jugador', () => {
    const state = makeGameState({
      players: {
        p1: { ...makeGameState().players.p1, playerId: 'p1', trophies: ['t1', 't2'] },
      },
    });
    const next = applyEvent(state, { type: 'TROPHY_REMOVED', playerId: 'p1', trophyInstanceId: 't1', seq: 1 });
    expect(next.players.p1.trophies).toEqual(['t2']);
  });
});
