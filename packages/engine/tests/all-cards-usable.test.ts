/**
 * Test exhaustivo de usabilidad: TODA carta del catálogo oficial debe
 * poder usarse a través de su comando correspondiente sin errores.
 *
 * - ABILITY: PLAY_CARD con objetivo disponible y monedas suficientes.
 * - MARKET:  BUY_CARD con monedas y capacidades suficientes.
 * - HERO:    USE_HERO_ABILITY (reactivos en fase HORDE_ATTACK).
 *
 * Escenarios/Huestes/Señores no son cartas jugables: se valida que
 * el motor las procesa (los handlers de escenario existen).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { setupGame, resetInstanceCounter } from '../src/phases/setup.js';
import { resetPhaseSeq } from '../src/phases/engine.js';
import { execute } from '../src/commands/execute.js';
import { EffectRegistry, registerCoreEffects } from '../src/effects/registry.js';
import { useHeroAbility, resetAbilitySeq } from '../src/heroes/abilities.js';
import { applyScenarioEffects, onTurnStart, executeTurnStartEffect } from '../src/scenarios/index.js';
import { loadCatalog } from '@nt4h/catalog';
import type { CardInstance, EnemyState, GameState } from '@nt4h/schema';

const catalog = loadCatalog();

function makeGame(): { state: GameState; rng: DeterministicRng } {
  const { state, rng } = setupGame(
    {
      mode: 'STANDARD',
      playerCount: 2,
      seed: 'all-cards-test',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: false,
    },
    catalog,
  );
  return { state, rng };
}

function makeEnemy(id = 'enemy-test-1'): EnemyState {
  return {
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
}

let registry: EffectRegistry;

beforeEach(() => {
  resetInstanceCounter();
  resetPhaseSeq();
  resetAbilitySeq();
  registry = new EffectRegistry();
  registerCoreEffects(registry);
});

describe('Usabilidad exhaustiva — TODAS las cartas', () => {
  const abilityCards = catalog.byType.get('ABILITY') ?? [];
  const marketCards = catalog.byType.get('MARKET') ?? [];
  const heroCards = catalog.byType.get('HERO') ?? [];
  const scenarioCards = catalog.byType.get('SCENARIO') ?? [];

  it(`el catálogo contiene cartas (habilidades=${abilityCards.length}, mercado=${marketCards.length}, héroes=${heroCards.length}, escenarios=${scenarioCards.length})`, () => {
    expect(abilityCards.length).toBeGreaterThan(0);
    expect(marketCards.length).toBeGreaterThan(0);
    expect(heroCards.length).toBeGreaterThan(0);
    expect(scenarioCards.length).toBeGreaterThan(0);
  });

  describe('ABILITY — cada carta de habilidad es jugable', () => {
    for (const card of abilityCards) {
      it(`${card.id} (${card.name}) se puede jugar`, () => {
        const { state, rng } = makeGame();
        state.phase = 'PLAYER_ATTACK';
        state.activePlayerId = 'p1';
        // El test salta directo a PLAYER_ATTACK: las pendingChoices del
        // setup (puja de líder) no existirían en este punto de una partida
        // real y bloquean PLAY_CARD desde E-13.
        state.pendingChoices = [];
        const p1 = state.players.p1;

        // Inyectar la carta en la mano y recursos suficientes
        const instance: CardInstance = {
          instanceId: `test-${card.id}`,
          definitionId: card.id,
          ownerId: 'p1',
          zone: 'HAND',
          name: card.name,
        };
        p1.hand = [instance];
        p1.coins = 99;
        p1.wounds = 1; // HEAL_WOUNDS debe tener efecto
        state.battlefield = [makeEnemy(), makeEnemy('enemy-test-2')];

        // E-13: cartas con filtro de objetivo (solo orcos, solo Señores,
        // fortaleza mínima) necesitan un enemigo que cumpla el filtro —
        // el enemigo genérico las haría ilegales por diseño.
        for (const eff of card.effects ?? []) {
          const tgt = 'target' in eff ? eff.target : undefined;
          if (typeof tgt !== 'object' || tgt === null || tgt.kind !== 'ONE_ENEMY' || !('filter' in tgt) || !tgt.filter) continue;
          const f = tgt.filter;
          const en = state.battlefield[0];
          if (f.isOrc !== undefined) en.isOrc = f.isOrc;
          if (f.isWarlord !== undefined) en.isWarlord = f.isWarlord;
          if (f.minFortitude !== undefined) en.baseFortitude = Math.max(en.baseFortitude, f.minFortitude);
        }
        const result = execute(
          state,
          { type: 'PLAY_CARD', cid: 'test-cid', cardInstanceId: instance.instanceId, targetEnemyId: 'enemy-test-1' },
          rng,
          registry,
          catalog,
        );

        expect(result.accepted, `rechazada: ${result.reason ?? ''}`).toBe(true);
        // La carta debe producir al menos el evento de jugada
        expect(
          result.events.some(e => e.type === 'CARD_PLAYED' || e.type === 'CARD_MOVED'),
          `${card.id} no emitió evento de jugada`,
        ).toBe(true);
      });
    }
  });

  describe('MARKET — cada objeto del mercado es comprable', () => {
    for (const card of marketCards) {
      it(`${card.id} (${card.name}) se puede comprar`, () => {
        const { state, rng } = makeGame();
        state.phase = 'MARKET';
        state.activePlayerId = 'p1';
        const p1 = state.players.p1;

        const instance: CardInstance = {
          instanceId: `test-${card.id}`,
          definitionId: card.id,
          ownerId: 'market',
          zone: 'MARKET',
          name: card.name,
        };
        state.market = [instance];
        p1.coins = 99;
        // Capacidades: conceder todas las requeridas + penalizadas
        const needed = new Set([
          ...(card.requiredCapabilities ?? []),
          ...(card.penaltyCapabilities?.map(p => p.icon) ?? []),
        ]);
        p1.capabilities = [...new Set([...p1.capabilities, ...needed])];

        const result = execute(
          state,
          { type: 'BUY_CARD', cid: 'test-cid', marketCardInstanceId: instance.instanceId },
          rng,
          registry,
          catalog,
        );

        expect(result.accepted, `rechazada: ${result.reason ?? ''}`).toBe(true);
      });
    }
  });

  describe('HERO — cada pericia de héroe es usable', () => {
    const REACTIVE_HEROES = new Set(['hero.valerys', 'hero.lisavette']);
    // Pericias pasivas: no se invocan directamente; se activan durante
    // Evasion (taheral) o Ataque de la Horda (feldon, beleth-il)
    const PASSIVE_HEROES = new Set(['hero.taheral', 'hero.feldon', 'hero.beleth-il']);

    for (const hero of heroCards) {
      if (PASSIVE_HEROES.has(hero.id)) continue;
      it(`${hero.id} (${hero.name}) puede usar su pericia`, () => {
        const { state, rng } = makeGame();
        const p1 = state.players.p1;
        p1.heroId = hero.id;
        p1.heroUsesRemaining = hero.heroAbility?.uses ?? 1;
        p1.heroMaxUses = p1.heroUsesRemaining;
        state.activePlayerId = 'p1';
        state.phase = REACTIVE_HEROES.has(hero.id) ? 'HORDE_ATTACK' : 'PLAYER_ATTACK';
        state.battlefield = [makeEnemy()];
        // Lisavette exige la carta Escudo en mano (D370)
        if (hero.id === 'hero.lisavette') {
          p1.hand = [{
            instanceId: 'shield-1',
            definitionId: 'warrior.shield',
            ownerId: 'p1',
            zone: 'HAND',
          }];
        }

        const result = useHeroAbility(state, 'p1', rng, catalog, 'p1', 'enemy-test-1');
        expect(result.events.length).toBeGreaterThan(0);
        expect(
          result.events.some(e => e.type === 'HERO_ABILITY_USED'),
          `${hero.id} no emitió HERO_ABILITY_USED`,
        ).toBe(true);
      });
    }

    for (const heroId of PASSIVE_HEROES) {
      it(`${heroId} tiene pericia pasiva (no consume uso directo)`, () => {
        const { state, rng } = makeGame();
        const p1 = state.players.p1;
        p1.heroId = heroId;
        p1.heroUsesRemaining = 1;
        state.activePlayerId = 'p1';
        state.phase = 'PLAYER_ATTACK';
        const usesBefore = p1.heroUsesRemaining;
        const result = useHeroAbility(state, 'p1', rng, catalog);
        // Pasiva: no gasta usos ni emite HERO_ABILITY_USED por invocación directa
        expect(result.state.players.p1.heroUsesRemaining).toBe(usesBefore);
      });
    }
  });

  describe('SCENARIO — cada escenario tiene handlers del motor', () => {
    for (const sc of scenarioCards) {
      it(`${sc.id} (${sc.name}) procesa sus efectos`, () => {
        const { state } = makeGame();
        // applyScenarioEffects no debe lanzar y debe ser estable
        expect(() => applyScenarioEffects(state, sc.id, catalog)).not.toThrow();
        expect(() => onTurnStart(state, sc.id)).not.toThrow();
        expect(() => executeTurnStartEffect(state, sc.id, 'p1', true, catalog)).not.toThrow();
      });
    }
  });
});
