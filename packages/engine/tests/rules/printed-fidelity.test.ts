/**
 * Fidelidad impresa — el catálogo contra lo que dicen las cartas de verdad.
 *
 * Las tablas de este archivo fueron transcritas auditando los PNG oficiales
 * (apps/mobile/public/assets/cards/*) y el manual oficial en español
 * (garesys.com — manual-no-time-for-heroes-es.pdf). No derivan del catálogo:
 * son la fuente de verdad — si el catálogo diverge de lo impreso, falla aquí.
 *
 * Cubre:
 *  - Ataque impreso (gota roja) de las 32 cartas de habilidad.
 *  - Fortaleza, laurel del frente (trophyGlory) y botín del dorso
 *    (monedas + Gloria adicional) de las 27 cartas de Horda.
 *  - Fortaleza de los 3 Señores de la Guerra.
 *  - Coste e iconos requeridos de las 9 cartas de Mercado.
 *  - Clase, capacidades, capacidades penalizadas («-1») y corazones
 *    de los 8 Héroes.
 *  - Semántica del manual: trofeo permanente vs botín suprimible (Brunmar),
 *    penalización -1 del icono impreso del héroe, Anti-Magia vs héroe real.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../../src/rng/index.js';
import { EffectRegistry, registerCoreEffects } from '../../src/effects/registry.js';
import { resolveCard, resetResolveSeq } from '../../src/effects/resolver.js';
import { setupGame, resetInstanceCounter } from '../../src/phases/setup.js';
import { processPhases, resetPhaseSeq } from '../../src/phases/engine.js';
import { isLegal } from '../../src/commands/execute.js';
import { checkFortitudeDefeats, applyEvent } from '../../src/events/applyEvent.js';
import { computeFinalScore } from '../../src/scoring.js';
import { loadCatalog } from '@nt4h/catalog';
import { makeCard, makeEnemy, makePlayer, makeGameState, resetTestCounters } from '../fixtures/builders.js';
import type { GameState, CardInstance, Zone } from '@nt4h/schema';

const catalog = loadCatalog();

function freshRng(): DeterministicRng {
  return new DeterministicRng('printed-fidelity-rng');
}
function makeRegistry(): EffectRegistry {
  const reg = new EffectRegistry();
  registerCoreEffects(reg);
  return reg;
}

// ============================================================================
// Tablas transcritas de los PNG (fuente de verdad impresa)
// ============================================================================

/** Ataque impreso en la gota roja (esquina superior izquierda). 0 = sin gota. */
const PRINTED_ATTACK: Record<string, number> = {
  'explorer.arrow-volley': 2, 'explorer.bullseye': 4, 'explorer.collect-arrows': 0,
  'explorer.companion-wolf': 2, 'explorer.precise-shot': 3, 'explorer.rapid-shot': 1,
  'explorer.survival': 0,
  'mage.corrosive-arrow': 1, 'mage.fire-bolt': 2, 'mage.fireball': 2,
  'mage.healing-orb': 0, 'mage.ice-shot': 1, 'mage.light-torrent': 2,
  'mage.protective-aura': 0, 'mage.reconstitution': 0, 'mage.staff-strike': 1,
  'rogue.deceive': 0, 'rogue.in-the-shadows': 1, 'rogue.pickpocket': 0,
  'rogue.plunder-a': 0, 'rogue.plunder-b': 0, 'rogue.precise-crossbow': 2,
  'rogue.sneak-attack': 2, 'rogue.to-the-heart': 4, 'rogue.trap': 0,
  'warrior.all-or-nothing': 1, 'warrior.brutal-attack': 3, 'warrior.double-slash': 2,
  'warrior.shield': 0, 'warrior.shield-charge': 2, 'warrior.step-back': 0,
  'warrior.sword-strike': 1, 'warrior.voice-of-encouragement': 0,
};

/**
 * Horda: fortaleza (escudo rojo del frente), laurel del frente (trophyGlory —
 * valor del trofeo al final de la partida) y botín del dorso (monedas y la
 * Gloria adicional que solo llevan 012/019/020/024).
 */
const PRINTED_HORDE: Record<string, { fort: number; trophy: number; coins: number; backGlory: number }> = {
  'horde.001': { fort: 2, trophy: 1, coins: 1, backGlory: 0 },
  'horde.002': { fort: 2, trophy: 1, coins: 1, backGlory: 0 },
  'horde.003': { fort: 2, trophy: 1, coins: 0, backGlory: 0 },
  'horde.004': { fort: 2, trophy: 1, coins: 0, backGlory: 0 },
  'horde.005': { fort: 2, trophy: 1, coins: 0, backGlory: 0 },
  'horde.006': { fort: 3, trophy: 2, coins: 1, backGlory: 0 },
  'horde.007': { fort: 3, trophy: 2, coins: 1, backGlory: 0 },
  'horde.008': { fort: 3, trophy: 2, coins: 0, backGlory: 0 },
  'horde.009': { fort: 3, trophy: 2, coins: 0, backGlory: 0 },
  'horde.010': { fort: 3, trophy: 2, coins: 0, backGlory: 0 },
  'horde.011': { fort: 3, trophy: 1, coins: 2, backGlory: 0 },
  'horde.012': { fort: 3, trophy: 1, coins: 1, backGlory: 1 },
  'horde.013': { fort: 4, trophy: 2, coins: 1, backGlory: 0 },
  'horde.014': { fort: 4, trophy: 2, coins: 0, backGlory: 0 },
  'horde.015': { fort: 4, trophy: 2, coins: 0, backGlory: 0 },
  'horde.016': { fort: 4, trophy: 2, coins: 1, backGlory: 0 },
  'horde.017': { fort: 4, trophy: 2, coins: 1, backGlory: 0 },
  'horde.018': { fort: 4, trophy: 2, coins: 2, backGlory: 0 },
  'horde.019': { fort: 4, trophy: 2, coins: 2, backGlory: 1 },
  'horde.020': { fort: 4, trophy: 2, coins: 2, backGlory: 1 },
  'horde.021': { fort: 5, trophy: 3, coins: 0, backGlory: 0 },
  'horde.022': { fort: 5, trophy: 3, coins: 2, backGlory: 0 },
  'horde.023': { fort: 5, trophy: 3, coins: 2, backGlory: 0 },
  'horde.024': { fort: 5, trophy: 3, coins: 2, backGlory: 1 },
  'horde.025': { fort: 6, trophy: 4, coins: 1, backGlory: 0 },
  'horde.026': { fort: 6, trophy: 4, coins: 1, backGlory: 0 },
  'horde.027': { fort: 6, trophy: 4, coins: 0, backGlory: 0 },
};

const PRINTED_WARLORDS: Record<string, number> = {
  'warlord.gurdrug': 8,
  'warlord.roghkiller': 9,
  'warlord.shriekknifer': 10,
};

/** Iconos impresos esquina inferior derecha + moneda de coste. */
const PRINTED_MARKET: Record<string, { cost: number; req: string[] }> = {
  'market.elven-dagger': { cost: 3, req: [] },
  'market.healing-potion': { cost: 8, req: [] },
  'market.whetstone': { cost: 4, req: ['RANGED', 'EXPERTISE', 'MELEE'] },
  'market.conjuration-vial': { cost: 5, req: [] },
  'market.concentration-elixir': { cost: 3, req: [] },
  'market.elven-cloak': { cost: 3, req: ['RANGED', 'MAGIC'] },
  'market.plate-armor': { cost: 4, req: ['MELEE'] },
  'market.orc-halberd': { cost: 5, req: ['MELEE'] },
  'market.composite-bow': { cost: 5, req: ['RANGED'] },
};

/**
 * Héroes: banner de clase (verde=Explorador, azul=Guerrero, morado=Mago,
 * rojo=Pícaro), iconos de capacidad impresos (los que llevan «-1» adosado
 * van a penaltyCapabilities) y corazones (maxWounds).
 */
const PRINTED_HEROES: Record<string, {
  heroClass: string; caps: string[]; penalties: { icon: string; damagePenalty: number }[]; maxWounds: number;
}> = {
  'hero.aranel':    { heroClass: 'MAGE',     caps: ['MAGIC'],     penalties: [],                                      maxWounds: 2 },
  'hero.taheral':   { heroClass: 'MAGE',     caps: ['MAGIC'],     penalties: [],                                      maxWounds: 2 },
  'hero.beleth-il': { heroClass: 'EXPLORER', caps: ['RANGED'],    penalties: [{ icon: 'MELEE', damagePenalty: 1 }],   maxWounds: 3 },
  'hero.idril':     { heroClass: 'EXPLORER', caps: ['RANGED'],    penalties: [{ icon: 'MELEE', damagePenalty: 1 }],   maxWounds: 3 },
  'hero.feldon':    { heroClass: 'ROGUE',    caps: ['EXPERTISE'], penalties: [{ icon: 'RANGED', damagePenalty: 1 }],  maxWounds: 2 },
  'hero.neddia':    { heroClass: 'ROGUE',    caps: ['EXPERTISE'], penalties: [{ icon: 'RANGED', damagePenalty: 1 }],  maxWounds: 2 },
  'hero.lisavette': { heroClass: 'WARRIOR',  caps: ['MELEE'],     penalties: [],                                      maxWounds: 3 },
  'hero.valerys':   { heroClass: 'WARRIOR',  caps: ['MELEE'],     penalties: [],                                      maxWounds: 3 },
};

// ============================================================================
// Fidelidad del catálogo contra las tablas impresas
// ============================================================================

describe('Fidelidad impresa — catálogo vs PNG', () => {
  it('las 32 habilidades tienen el ataque impreso en la gota roja', () => {
    const abilities = catalog.byType.get('ABILITY') ?? [];
    expect(abilities.length).toBe(Object.keys(PRINTED_ATTACK).length);
    for (const def of abilities) {
      const printed = PRINTED_ATTACK[def.id];
      expect(printed, `${def.id} no está en la tabla impresa`).toBeDefined();
      expect(def.printedAttack ?? 0, `${def.id}: ataque ${def.printedAttack} ≠ impreso ${printed}`).toBe(printed);
    }
  });

  it('las 27 Huestes tienen fortaleza, laurel y botín impresos', () => {
    const horde = catalog.byType.get('HORDE') ?? [];
    expect(horde.length).toBe(Object.keys(PRINTED_HORDE).length);
    for (const def of horde) {
      const p = PRINTED_HORDE[def.id];
      expect(p, `${def.id} no está en la tabla impresa`).toBeDefined();
      expect(def.printedFortitude, `${def.id}: fortaleza ${def.printedFortitude} ≠ ${p.fort}`).toBe(p.fort);
      expect(def.trophyGlory ?? 0, `${def.id}: laurel ${def.trophyGlory} ≠ ${p.trophy}`).toBe(p.trophy);
      expect(def.reward?.coins ?? 0, `${def.id}: botín monedas ${def.reward?.coins} ≠ ${p.coins}`).toBe(p.coins);
      expect(def.reward?.glory ?? 0, `${def.id}: botín gloria ${def.reward?.glory} ≠ ${p.backGlory}`).toBe(p.backGlory);
    }
  });

  it('los 3 Señores de la Guerra tienen la fortaleza impresa', () => {
    const warlords = catalog.byType.get('WARLORD') ?? [];
    expect(warlords.length).toBe(Object.keys(PRINTED_WARLORDS).length);
    for (const def of warlords) {
      expect(def.printedFortitude, `${def.id}: fortaleza ${def.printedFortitude} ≠ ${PRINTED_WARLORDS[def.id]}`)
        .toBe(PRINTED_WARLORDS[def.id]);
      // Los Señores no llevan laurel numérico ni botín: su Gloria es +1 por
      // cada carta que los dañe (regla §3.7 del manual).
      expect(def.trophyGlory ?? 0).toBe(0);
      expect(def.reward ?? null).toBeNull();
    }
  });

  it('las 9 cartas de Mercado tienen coste e iconos impresos', () => {
    const market = catalog.byType.get('MARKET') ?? [];
    expect(market.length).toBe(Object.keys(PRINTED_MARKET).length);
    for (const def of market) {
      const p = PRINTED_MARKET[def.id];
      expect(p, `${def.id} no está en la tabla impresa`).toBeDefined();
      expect(def.printedCost, `${def.id}: coste ${def.printedCost} ≠ ${p.cost}`).toBe(p.cost);
      expect([...(def.requiredCapabilities ?? [])].sort(),
        `${def.id}: iconos ${JSON.stringify(def.requiredCapabilities)} ≠ ${JSON.stringify(p.req)}`)
        .toEqual([...p.req].sort());
    }
  });

  it('los 8 Héroes tienen clase, capacidades y corazones impresos', () => {
    const heroes = catalog.byType.get('HERO') ?? [];
    expect(heroes.length).toBe(Object.keys(PRINTED_HEROES).length);
    for (const def of heroes) {
      const p = PRINTED_HEROES[def.id];
      expect(p, `${def.id} no está en la tabla impresa`).toBeDefined();
      expect(def.heroClass, `${def.id}: clase ${def.heroClass} ≠ ${p.heroClass}`).toBe(p.heroClass);
      expect([...(def.capabilities ?? [])].sort(),
        `${def.id}: capacidades ${JSON.stringify(def.capabilities)} ≠ ${JSON.stringify(p.caps)}`)
        .toEqual([...p.caps].sort());
      expect(def.penaltyCapabilities ?? [], `${def.id}: penalizaciones impresas`)
        .toEqual(p.penalties);
      expect(def.maxWounds, `${def.id}: corazones ${def.maxWounds} ≠ ${p.maxWounds}`).toBe(p.maxWounds);
    }
  });
});

// ============================================================================
// Semántica del manual — trofeo vs botín (Brunmar), penalización del héroe,
// Anti-Magia con héroe real, propagación de capacidades en setupGame
// ============================================================================

function enemyFromDef(defId: string, instanceId: string, wounds = 0) {
  const def = catalog.byId.get(defId)!;
  return makeEnemy({
    instanceId,
    definitionId: def.id,
    baseFortitude: def.printedFortitude ?? 1,
    wounds,
    reward: def.reward ?? null,
    trophyGlory: def.trophyGlory ?? 0,
    isWarlord: def.type === 'WARLORD',
    isOrc: def.isOrc ?? false,
    specialIcons: def.specialIcons ?? [],
  });
}

describe('Manual — gloria del trofeo (frente) vs botín (dorso)', () => {
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
  });

  it('derrotar una Hueste paga laurel del frente + Gloria del dorso', () => {
    // horde.012: laurel 1 + dorso +1 Gloria → 2 en total
    const state = makeGameState({ activePlayerId: 'p1' });
    state.battlefield = [enemyFromDef('horde.012', 'h012', 3)]; // fort 3, ya herida
    const seq = (() => { let n = 1; return () => n++; })();
    const events = checkFortitudeDefeats(state, 'p1', seq);
    const defeated = events.find(e => e.type === 'ENEMY_DEFEATED');
    expect(defeated).toBeDefined();
    expect((defeated as any).reward.glory).toBe(2);
    expect((defeated as any).reward.coins).toBe(1);
  });

  it('Ruinas de Brunmar suprime el botín del dorso pero NO el laurel del frente', () => {
    // Manual §Brunmar: «ignora las recompensas de Gloria» = las del dorso.
    // El laurel del frente es el valor del trofeo — se cobra igualmente.
    const state = makeGameState({ activePlayerId: 'p1', ignoreGloryRewards: true });
    state.battlefield = [enemyFromDef('horde.012', 'h012b', 3)];
    const seq = (() => { let n = 1; return () => n++; })();
    const events = checkFortitudeDefeats(state, 'p1', seq);
    const defeated = events.find(e => e.type === 'ENEMY_DEFEATED') as any;
    expect(defeated.reward.glory).toBe(1); // solo el laurel
    // Aplicado al jugador: +1 de gloria aunque Brunmar esté activo
    const after = events.reduce(applyEvent, state);
    expect(after.players.p1.glory).toBe(state.players.p1.glory + 1);
  });

  it('una Hueste sin Gloria en el dorso paga solo el laurel bajo Brunmar', () => {
    // horde.021: laurel 3, dorso sin Gloria → bajo Brunmar sigue pagando 3
    const state = makeGameState({ activePlayerId: 'p1', ignoreGloryRewards: true, ignoreCoinRewards: true });
    state.battlefield = [enemyFromDef('horde.021', 'h021', 5)];
    const seq = (() => { let n = 1; return () => n++; })();
    const defeated = checkFortitudeDefeats(state, 'p1', seq).find(e => e.type === 'ENEMY_DEFEATED') as any;
    expect(defeated.reward.glory).toBe(3);
    expect(defeated.reward.coins).toBe(0);
  });

  it('la Gloria del trofeo no se descuenta dos veces en la puntuación final', () => {
    const state = makeGameState({ activePlayerId: 'p1' });
    state.battlefield = [enemyFromDef('horde.025', 'h025', 6)]; // laurel 4
    const seq = (() => { let n = 1; return () => n++; })();
    const after = checkFortitudeDefeats(state, 'p1', seq).reduce(applyEvent, state);
    const score = computeFinalScore(after.players);
    const p1 = score.players.find(p => p.playerId === 'p1')!;
    // glory ya incluye el laurel — el total no puede volver a sumarlo por trofeo
    expect(p1.glory).toBe(state.players.p1.glory + 4);
    expect(p1.total).toBe(p1.glory + p1.coinGlory + p1.tenaz);
  });
});

describe('Manual — penalización «-1» del icono impreso del héroe', () => {
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
  });

  function marketStateWith(cardDefId: string, player: ReturnType<typeof makePlayer>): { state: GameState; inst: CardInstance } {
    const inst: CardInstance = {
      instanceId: 'mkt-pen', definitionId: cardDefId, ownerId: 'market', zone: 'MARKET' as Zone,
    };
    const state = makeGameState({ phase: 'MARKET', activePlayerId: 'p1' });
    state.players.p1 = player;
    state.market = [inst];
    return { state, inst };
  }

  it('el Pícaro (icono diana -1) puede comprar el Arco compuesto y hace daño -1', () => {
    const feldon = catalog.byId.get('hero.feldon')!;
    const player = makePlayer({
      playerId: 'p1', coins: 10,
      capabilities: feldon.capabilities as any,
      penaltyCapabilities: feldon.penaltyCapabilities as any,
    });
    const { state } = marketStateWith('market.composite-bow', player);
    expect(isLegal(state, 'p1', {
      type: 'BUY_CARD', cid: 'buy-bow', marketCardInstanceId: 'mkt-pen',
    }, catalog).ok).toBe(true);

    // Daño con penalización: Arco impreso 4 → 3
    const atk = makeGameState({ activePlayerId: 'p1' });
    atk.players.p1 = player;
    atk.battlefield = [enemyFromDef('horde.001', 'e-bow')];
    const bow = makeCard({ definitionId: 'market.composite-bow', ownerId: 'p1' });
    const bowDef = catalog.byId.get('market.composite-bow')!;
    const res = resolveCard(atk, bow, bowDef, 'e-bow', player, freshRng(), makeRegistry(), catalog);
    const dmg = res.events.find(e => e.type === 'DAMAGE_DEALT') as any;
    expect(dmg?.amount).toBe(3);
  });

  it('el Explorador (icono puño -1) puede comprar la Alabarda de orco y hace daño -1', () => {
    const beleth = catalog.byId.get('hero.beleth-il')!;
    const player = makePlayer({
      playerId: 'p1', coins: 10,
      capabilities: beleth.capabilities as any,
      penaltyCapabilities: beleth.penaltyCapabilities as any,
    });
    const { state } = marketStateWith('market.orc-halberd', player);
    expect(isLegal(state, 'p1', {
      type: 'BUY_CARD', cid: 'buy-halb', marketCardInstanceId: 'mkt-pen',
    }, catalog).ok).toBe(true);

    const atk = makeGameState({ activePlayerId: 'p1' });
    atk.players.p1 = player;
    atk.battlefield = [enemyFromDef('horde.001', 'e-halb')];
    const halberd = makeCard({ definitionId: 'market.orc-halberd', ownerId: 'p1' });
    const halberdDef = catalog.byId.get('market.orc-halberd')!;
    const res = resolveCard(atk, halberd, halberdDef, 'e-halb', player, freshRng(), makeRegistry(), catalog);
    const dmg = res.events.find(e => e.type === 'DAMAGE_DEALT') as any;
    expect(dmg?.amount).toBe(3); // 4 - 1
  });

  it('la penalización no aplica si el héroe tiene el icono requerido sin penalizar', () => {
    // Lisavette (MELEE pleno) con la Alabarda: daño completo 4
    const lisavette = catalog.byId.get('hero.lisavette')!;
    const player = makePlayer({
      playerId: 'p1', capabilities: lisavette.capabilities as any,
    });
    const atk = makeGameState({ activePlayerId: 'p1' });
    atk.players.p1 = player;
    atk.battlefield = [enemyFromDef('horde.001', 'e-full')];
    const halberd = makeCard({ definitionId: 'market.orc-halberd', ownerId: 'p1' });
    const halberdDef = catalog.byId.get('market.orc-halberd')!;
    const res = resolveCard(atk, halberd, halberdDef, 'e-full', player, freshRng(), makeRegistry(), catalog);
    const dmg = res.events.find(e => e.type === 'DAMAGE_DEALT') as any;
    expect(dmg?.amount).toBe(4);
  });

  it('la penalización no se duplica cuando carta y héroe penalizan a la vez', () => {
    // Arco compuesto: icono alternativo Pericia -1 en la CARTA, y el Pícaro
    // tiene diana -1 en el HÉROE → una sola resta (4-1=3, no 2).
    const feldon = catalog.byId.get('hero.feldon')!;
    const player = makePlayer({
      playerId: 'p1',
      capabilities: feldon.capabilities as any,
      penaltyCapabilities: feldon.penaltyCapabilities as any,
    });
    const atk = makeGameState({ activePlayerId: 'p1' });
    atk.players.p1 = player;
    atk.battlefield = [enemyFromDef('horde.001', 'e-nodup')];
    const bow = makeCard({ definitionId: 'market.composite-bow', ownerId: 'p1' });
    const bowDef = catalog.byId.get('market.composite-bow')!;
    const res = resolveCard(atk, bow, bowDef, 'e-nodup', player, freshRng(), makeRegistry(), catalog);
    const dmg = res.events.find(e => e.type === 'DAMAGE_DEALT') as any;
    expect(dmg?.amount).toBe(3);
  });
});

describe('Manual — capacidades impresas propagadas por setupGame', () => {
  beforeEach(() => {
    resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetTestCounters();
  });

  const CLASS_DECK: Record<string, string> = {
    MAGE: 'mage.default', EXPLORER: 'explorer.default',
    WARRIOR: 'warrior.default', ROGUE: 'rogue.default',
  };

  for (const [heroId, p] of Object.entries(PRINTED_HEROES)) {
    it(`${heroId}: capacidades y penalizaciones impresas en el estado`, () => {
      const setup = setupGame({
        mode: 'STANDARD', playerCount: 2, seed: `fid-${heroId}`,
        heroes: [
          { playerId: 'p1', heroId, heroFace: 'FEMALE', deckId: CLASS_DECK[p.heroClass] },
          { playerId: 'p2', heroId: 'hero.neddia', heroFace: 'FEMALE', deckId: 'rogue.default' },
        ],
        useScenarios: false,
      } as any, catalog);
      const player = setup.state.players.p1;
      expect(player.capabilities).toEqual(p.caps);
      expect(player.penaltyCapabilities ?? []).toEqual(p.penalties);
      expect(player.maxWounds).toBe(p.maxWounds);
    });
  }

  it('Anti-Magia reduce el daño de la Horda a un Mago real (Aranel)', () => {
    // horde.011: fortaleza 3, icono Anti-Magia → 3-1=2 cartas perdidas
    const setup = setupGame({
      mode: 'STANDARD', playerCount: 2, seed: 'fid-antimagic',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'mage.default' },
        { playerId: 'p2', heroId: 'hero.neddia', heroFace: 'FEMALE', deckId: 'rogue.default' },
      ],
      useScenarios: false,
    } as any, catalog);
    const state = setup.state;
    expect(state.players.p1.capabilities).toContain('MAGIC');
    state.phase = 'HORDE_ATTACK';
    state.activePlayerId = 'p1';
    state.battlefield = [enemyFromDef('horde.011', 'am-real')];
    const result = processPhases(state, freshRng(), catalog);
    const lost = result.events.find(
      e => e.type === 'CARDS_LOST' && (e as any).playerId === 'p1') as any;
    expect(lost).toBeDefined();
    expect(lost.count).toBe(2); // 3 fortaleza - 1 Anti-Magia
  });
});
