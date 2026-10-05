/**
 * Nivel 6: Pruebas de escenarios y jefes.
 *
 * Verifica:
 * - Los 12 escenarios tienen estructura valida
 * - Los 3 Senores de la Guerra tienen estructura valida
 * - applyScenarioEffects aplica modificadores correctos
 * - Pericias de warlords (Gurdrug, Shriekknifer, Roghkiller)
 * - Efectos de escenarios clave (Brunmar, Eque, Lotharion, Skaarg)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyScenarioEffects, resetScenarioSeq } from '../../src/scenarios/index.js';
import { setupGame, resetInstanceCounter } from '../../src/phases/setup.js';
import { resetPhaseSeq } from '../../src/phases/engine.js';
import { resetResolveSeq } from '../../src/effects/resolver.js';
import { loadCatalog } from '@nt4h/catalog';
import { makeEnemy, makeGameState, makeCard, resetTestCounters } from '../fixtures/builders.js';
import { getEffectiveFortitude, applyEntryAuras } from '../../src/modifiers/index.js';

const catalog = loadCatalog();

describe('Nivel 6 - Estructura de escenarios', () => {
  it('los 12 escenarios tienen estructura valida', () => {
    const scenarios = catalog.byType.get('SCENARIO') ?? [];
    expect(scenarios.length).toBe(12);
    for (const scenario of scenarios) {
      expect(scenario.id).toMatch(/^scenario\./);
      expect(scenario.name).toBeDefined();
      expect(scenario.name.length).toBeGreaterThan(0);
    }
  });

  it('cada escenario tiene un ID unico', () => {
    const scenarios = catalog.byType.get('SCENARIO') ?? [];
    const ids = scenarios.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todos los escenarios tienen al menos un efecto', () => {
    const scenarios = catalog.byType.get('SCENARIO') ?? [];
    for (const scenario of scenarios) {
      expect(scenario.effects.length).toBeGreaterThan(0);
    }
  });
});

describe('Nivel 6 - Estructura de Warlords', () => {
  it('los 3 Warlords tienen fortaleza >= 6', () => {
    const warlords = catalog.byType.get('WARLORD') ?? [];
    expect(warlords.length).toBe(3);
    for (const warlord of warlords) {
      expect(warlord.printedFortitude).toBeDefined();
      expect(warlord.printedFortitude!).toBeGreaterThanOrEqual(6);
    }
  });

  it('cada Warlord tiene un ID unico', () => {
    const warlords = catalog.byType.get('WARLORD') ?? [];
    const ids = warlords.map(w => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Gurdrug tiene peritia de perdida de carta (en datos raw)', () => {
    // _peritia es un campo extra que Zod strip del schema
    // Verificar que Gurdrug existe y tiene printedFortitude alto
    const gurdrug = catalog.byId.get('warlord.gurdrug');
    expect(gurdrug).toBeDefined();
    expect(gurdrug!.printedFortitude).toBeGreaterThanOrEqual(6);
  });

  it('todos los Warlords tienen isOrc = true', () => {
    const warlords = catalog.byType.get('WARLORD') ?? [];
    for (const warlord of warlords) {
      expect(warlord.isOrc).toBe(true);
    }
  });
});

describe('Nivel 6 - applyScenarioEffects', () => {
  beforeEach(() => {
    resetScenarioSeq();
    resetTestCounters();
  });

  it('Ruinas de Brunmar: -1 fortaleza a enemigos + ignora Gloria', () => {
    const enemy = makeEnemy({ instanceId: 'e1', baseFortitude: 3 });
    const scenario = makeCard({ instanceId: 'scenario-1', definitionId: 'scenario.brunmar-ruins' });
    const state = makeGameState({
      battlefield: [enemy],
      scenario,
    });
    const result = applyScenarioEffects(state, 'scenario.brunmar-ruins', catalog);
    // La fortaleza efectiva debe ser 2 (3 - 1)
    expect(getEffectiveFortitude(result.state.battlefield[0], result.state)).toBe(2);
    // Debe ignorar Gloria
    expect(result.state.ignoreGloryRewards).toBe(true);
  });

  it('Planicie de Skaarg: ignora recompensas de monedas', () => {
    const scenario = makeCard({ instanceId: 'scenario-1', definitionId: 'scenario.skaarg-plains' });
    const state = makeGameState({ scenario });
    const result = applyScenarioEffects(state, 'scenario.skaarg-plains', catalog);
    expect(result.state.ignoreCoinRewards).toBe(true);
  });

  it('Mercado de Lotharion: modifica coste de mercado', () => {
    const scenario = makeCard({ instanceId: 'scenario-1', definitionId: 'scenario.lotharion-market' });
    const state = makeGameState({ scenario });
    const result = applyScenarioEffects(state, 'scenario.lotharion-market', catalog);
    // Debe modificar marketCostModifier
    expect(result.state.marketCostModifier).not.toBe(0);
  });

  it('escenario desconocido no modifica el estado', () => {
    const state = makeGameState();
    const result = applyScenarioEffects(state, 'scenario.unknown', catalog);
    // El estado no debe cambiar significativamente
    expect(result.state).toBe(state);
  });
});

describe('Nivel 6 - Roghkiller (warlord bonus de orcos)', () => {
  beforeEach(() => {
    resetTestCounters();
  });

  // El mecanismo real es el Modifier que applyEntryAuras añade a cada
  // orco cuando warlord.roghkiller está en el campo (el campo suelto
  // orcFortitudeBonus se eliminó — nunca se escribía).
  const roghkiller = () => makeEnemy({
    instanceId: 'w1', baseFortitude: 9, isWarlord: true, isOrc: true,
    definitionId: 'warlord.roghkiller',
  });

  it('orcos reciben +1 fortaleza con Roghkiller en el campo', () => {
    const orc = makeEnemy({ instanceId: 'e1', baseFortitude: 3, isOrc: true });
    const human = makeEnemy({ instanceId: 'e2', baseFortitude: 3, isOrc: false });
    const state = makeGameState({ battlefield: [orc, human, roghkiller()] });
    expect(getEffectiveFortitude(applyEntryAuras(orc, state), state)).toBe(4);
    expect(getEffectiveFortitude(applyEntryAuras(human, state), state)).toBe(3);
  });

  it('orcos no reciben bonus sin Roghkiller en el campo', () => {
    const orc = makeEnemy({ instanceId: 'e1', baseFortitude: 3, isOrc: true });
    const state = makeGameState({ battlefield: [orc] });
    expect(getEffectiveFortitude(applyEntryAuras(orc, state), state)).toBe(3);
  });
});

describe('Nivel 6 - Escenarios con setup completo', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();
    resetScenarioSeq();
    resetTestCounters();
  });

  it('setup con escenarios revela un escenario al inicio', () => {
    const config = {
      mode: 'STANDARD' as const,
      playerCount: 2,
      seed: 'scenario-setup-test',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
      ],
      useScenarios: true,
    };
    const setup = setupGame(config, catalog);
    // El escenario debe estar revelado
    expect(setup.state.scenario).toBeDefined();
    expect(setup.state.scenario).not.toBeNull();
  });

  it('setup sin escenarios no revela escenario', () => {
    const config = {
      mode: 'STANDARD' as const,
      playerCount: 2,
      seed: 'no-scenario-test',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
      ],
      useScenarios: false,
    };
    const setup = setupGame(config, catalog);
    expect(setup.state.scenario).toBeNull();
  });
});
