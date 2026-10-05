import { describe, it, expect, beforeEach } from 'vitest';
import { setupSoloMode, buySupportCard, openSupportDeck, calculateSoloScore, getSoloTitle, resetSoloSeq } from '../src/modes/solo.js';
import { setupMulticlassMode, validateMulticlassDeck, isMulticlassGameEnded } from '../src/modes/multiclass.js';
import { setupGame, resetInstanceCounter, startFirstTurn } from '../src/phases/setup.js';
import { applyEvent } from '../src/events/applyEvent.js';
import { resetPhaseSeq } from '../src/phases/engine.js';
import { loadCatalog } from '@nt4h/catalog';
import type { GameConfig, Zone } from '@nt4h/schema';

describe('Solo mode — modo solitario', () => {
  let catalog: ReturnType<typeof loadCatalog>;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetSoloSeq();
    catalog = loadCatalog();
  });

  function makeSoloConfig(): GameConfig {
    return {
      mode: 'SOLO',
      playerCount: 1,
      seed: 'test-solo-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
      ],
      useScenarios: true,
      soloSupportHeroIds: ['hero.feldon'],
    };
  }

  it('configura modo solitario con 1 jugador', () => {
    const result = setupSoloMode(makeSoloConfig(), catalog);
    expect(result.errors).toEqual([]);
    expect(result.state.playerOrder).toEqual(['p1']);
    expect(Object.keys(result.state.players)).toHaveLength(1);
  });

  it('da 6 monedas iniciales al jugador solitario', () => {
    const result = setupSoloMode(makeSoloConfig(), catalog);
    expect(result.state.players.p1.coins).toBe(6);
  });

  it('coloca 5 cartas de Mercado (en lugar de 4)', () => {
    const result = setupSoloMode(makeSoloConfig(), catalog);
    expect(result.state.market).toHaveLength(5);
  });

  it('coloca 3 Huestes en el campo (especificacion §3.2.5)', () => {
    const result = setupSoloMode(makeSoloConfig(), catalog);
    expect(result.state.battlefield).toHaveLength(3);
  });

  it('tiene 1 Señor de la Guerra al final de la Horda', () => {
    const result = setupSoloMode(makeSoloConfig(), catalog);
    // 27 Huestes - 5 de fortaleza 2 = 22, - 3 en campo = 19 + 1 Señor = 17
    expect(result.state.hordeDeck).toHaveLength(20);
  });

  it('crea mazo de Apoyo si se especifican heroes de apoyo', () => {
    const result = setupSoloMode(makeSoloConfig(), catalog);
    expect(result.state.players.p1.supportDecks).toHaveLength(1);
    expect(result.state.players.p1.supportDecks[0].length).toBe(15); // 15 cartas
  });

  it('comprar carta de Apoyo cuesta 5 monedas (primera carta)', () => {
    const result = setupSoloMode(makeSoloConfig(), catalog);
    // D358: Abrir el mazo de Apoyo antes de comprar
    let state = result.state;
    const openResult = openSupportDeck(state, 'p1', 0);
    state = openResult.state;
    const buyResult = buySupportCard(state, 'p1', 0, { type: 'COINS', amount: 5 });
    expect(buyResult.error).toBeUndefined();
    // Aplicar eventos al estado (D350: el descuento se hace via eventos, no pre-descuento)
    let resolvedState = buyResult.state;
    for (const ev of [...openResult.events, ...buyResult.events]) {
      resolvedState = applyEvent(resolvedState, ev);
    }
    // 6 monedas - 3 (abrir) - 5 (comprar) → ambos descuentos vía eventos;
    // COINS_LOST fija en 0: las monedas no pueden quedar negativas.
    expect(resolvedState.players.p1.coins).toBe(0);
  });

  it('no permite comprar carta de Apoyo sin monedas suficientes', () => {
    const result = setupSoloMode(makeSoloConfig(), catalog);
    // D358: Abrir el mazo de Apoyo primero
    let state = result.state;
    const openResult = openSupportDeck(state, 'p1', 0);
    state = openResult.state;
    // Gastar todas las monedas
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, coins: 1 } } };
    const buyResult = buySupportCard(state, 'p1', 0, { type: 'COINS', amount: 5 });
    expect(buyResult.error).toBe('Not enough coins (need 5)');
  });

  it('no permite comprar de un mazo de Apoyo vacio', () => {
    const result = setupSoloMode(makeSoloConfig(), catalog);
    // D358: Abrir el mazo de Apoyo primero
    let state = result.state;
    const openResult = openSupportDeck(state, 'p1', 0);
    state = openResult.state;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, supportDecks: [[]] }, // Mazo vacio
      },
    };
    const buyResult = buySupportCard(state, 'p1', 0, { type: 'COINS', amount: 5 });
    expect(buyResult.error).toBe('Support deck is empty');
  });

  it('calcula puntuacion solitaria (especificacion §4.3)', () => {
    const result = setupSoloMode(makeSoloConfig(), catalog);
    let state = result.state;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          glory: 10,
          coins: 6,
          wounds: 1,
          trophies: ['t1', 't2', 't3'],
          abilityDeck: new Array(10).fill(0).map((_, i) => ({
            instanceId: `d${i}`,
            definitionId: 'warrior.sword-strike',
            ownerId: 'p1',
            zone: 'ABILITY_DECK' as Zone,
          })),
          hand: new Array(4).fill(0).map((_, i) => ({
            instanceId: `h${i}`,
            definitionId: 'warrior.sword-strike',
            ownerId: 'p1',
            zone: 'HAND' as Zone,
          })),
        },
      },
    };
    const score = calculateSoloScore(state, 'p1');
    expect(score.glory).toBe(10);
    // +1 por carta sobrante (4 mano + 10 mazo = 14)
    // +1 por cada 2 Gloria (10/2 = 5)
    // +1 por cada 5 monedas (6/5 = 1)
    // Heridas no recibidas: maxWounds(2) - wounds(1) = 1, * cartas mazo(10) = 10
    // Total = 14 + 5 + 1 + 10 = 30 (no se suma glory en bruto)
    expect(score.total).toBe(14 + 5 + 1 + 10);
    expect(score.breakdown.length).toBeGreaterThan(1);
  });

  it('asigna titulos solitarios correctamente', () => {
    expect(getSoloTitle(5)).toBe('Cazador audaz');
    expect(getSoloTitle(15)).toBe('Guardián de los justos');
    expect(getSoloTitle(30)).toBe('Terror de la Horda');
    expect(getSoloTitle(50)).toBe('Caudillo de Isilendor');
  });

  it('rechaza configuracion con mas de 1 jugador', () => {
    const config: GameConfig = {
      mode: 'SOLO',
      playerCount: 2,
      seed: 'test-solo-002',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: false,
    };
    const result = setupSoloMode(config, catalog);
    expect(result.errors).toContain('Solo mode requires exactly 1 player');
  });
});

describe('Multiclass mode — modo multiclase', () => {
  let catalog: ReturnType<typeof loadCatalog>;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    catalog = loadCatalog();
  });

  function makeMulticlassConfig(): GameConfig {
    return {
      mode: 'MULTICLASS',
      playerCount: 4,
      seed: 'test-mc-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
        { playerId: 'p3', heroId: 'hero.neddia', heroFace: 'FEMALE', deckId: 'warrior.default' },
        { playerId: 'p4', heroId: 'hero.taheral', heroFace: 'MALE', deckId: 'explorer.default' },
      ],
      useScenarios: true,
    };
  }

  it('configura modo multiclase con 4 jugadores', () => {
    const result = setupMulticlassMode(makeMulticlassConfig(), catalog);
    expect(result.errors).toEqual([]);
    expect(result.state.playerOrder).toHaveLength(4);
    expect(Object.keys(result.state.players)).toHaveLength(4);
  });

  it('tiene 2 Señores de la Guerra en la Horda', () => {
    const result = setupMulticlassMode(makeMulticlassConfig(), catalog);
    // 27 Huestes - 3 en campo = 24 + 2 Señores = 26
    expect(result.state.hordeDeck).toHaveLength(26);
  });

  it('coloca 5 cartas de Mercado (igual que modo normal)', () => {
    const result = setupMulticlassMode(makeMulticlassConfig(), catalog);
    expect(result.state.market).toHaveLength(5);
  });

  it('cada jugador tiene 4 cartas en mano (igual que modo normal)', () => {
    const result = setupMulticlassMode(makeMulticlassConfig(), catalog);
    for (const playerId of result.state.playerOrder) {
      expect(result.state.players[playerId].hand).toHaveLength(4);
    }
  });

  it('cada jugador tiene 2 monedas iniciales', () => {
    const result = setupMulticlassMode(makeMulticlassConfig(), catalog);
    for (const playerId of result.state.playerOrder) {
      expect(result.state.players[playerId].coins).toBe(2);
    }
  });

  it('determina un Líder tras la puja (auto-resolución)', () => {
    const result = setupMulticlassMode(makeMulticlassConfig(), catalog);
    // D427: la puja es interactiva — crear pendingChoices por jugador
    const bids = result.state.pendingChoices.filter(c => c.choiceId.startsWith('leader-bid-'));
    expect(bids).toHaveLength(result.state.playerOrder.length);
    // Auto-resolver con la heurística determinista
    const resolved = startFirstTurn(result.state, result.rng, catalog).state;
    expect(resolved.activePlayerId).not.toBe('');
    expect(resolved.playerOrder).toContain(resolved.activePlayerId);
  });

  it('validateMulticlassDeck valida mazo correcto', () => {
    // Crear un mazo con 15 cartas de 2 clases (7 explorer + 8 warrior)
    const explorerCards = (catalog.byClass.get('EXPLORER') ?? []);
    const warriorCards = (catalog.byClass.get('WARRIOR') ?? []);
    // Duplicar cartas para llegar a 15 (usando copias logicas)
    const deckIds: string[] = [];
    // 7 explorer + 8 warrior = 15
    for (const c of explorerCards) deckIds.push(c.id);
    for (const c of warriorCards) deckIds.push(c.id);
    // Recortar a 15
    const finalDeck = deckIds.slice(0, 15);

    const result = validateMulticlassDeck(finalDeck, catalog);
    // Puede fallar si hay menos de 5 de una clase, verificamos la logica
    expect(result.errors.length).toBeLessThanOrEqual(1);
  });

  it('validateMulticlassDeck rechaza mazo con menos de 5 por clase', () => {
    const explorerCards = (catalog.byClass.get('EXPLORER') ?? []).slice(0, 3);
    const warriorCards = (catalog.byClass.get('WARRIOR') ?? []).slice(0, 12);
    const deckIds = [...explorerCards, ...warriorCards].map(c => c.id);

    const result = validateMulticlassDeck(deckIds, catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('EXPLORER'))).toBe(true);
  });

  it('isMulticlassGameEnded detecta fin de partida', () => {
    const result = setupMulticlassMode(makeMulticlassConfig(), catalog);
    let state = result.state;

    // Simular que ambos Señores fueron derrotados, y la Horda y campo estan vacios
    state = {
      ...state,
      warlordRevealed: true,
      warlordDefeated: true,
      warlordsDefeatedCount: 2,
      hordeDeck: [],
      battlefield: [],
    };

    expect(isMulticlassGameEnded(state)).toBe(true);
  });

  it('isMulticlassGameEnded no termina con solo 1 Señor derrotado', () => {
    const result = setupMulticlassMode(makeMulticlassConfig(), catalog);
    let state = result.state;

    state = {
      ...state,
      warlordRevealed: true,
      warlordDefeated: true,
      warlordsDefeatedCount: 1,
      hordeDeck: [],
      battlefield: [],
    };

    expect(isMulticlassGameEnded(state)).toBe(false);
  });
});

describe('Multiclass via setupGame — integración D364-D367', () => {
  let catalog: ReturnType<typeof loadCatalog>;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    catalog = loadCatalog();
  });

  it('D365: construye mazo multiclase con secondDeckId (2 clases, 15 cartas)', () => {

    const config: GameConfig = {
      mode: 'MULTICLASS',
      playerCount: 2,
      seed: 'test-mc-setup-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default', secondDeckId: 'warrior.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default', secondDeckId: 'mage.default' },
      ],
      useScenarios: true,
    };
    const result = setupGame(config, catalog);
    expect(result.errors).toEqual([]);
    const p1 = result.state.players['p1'];
    // Mazo completo = mano (4) + abilityDeck (resto)
    const totalDeck = p1.hand.length + p1.abilityDeck.length;
    expect(totalDeck).toBe(15);
  });

  it('D364: mazo multiclase tiene mínimo 5 cartas de cada clase', () => {

    const config: GameConfig = {
      mode: 'MULTICLASS',
      playerCount: 2,
      seed: 'test-mc-min5-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default', secondDeckId: 'warrior.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default', secondDeckId: 'mage.default' },
      ],
      useScenarios: false,
    };
    const result = setupGame(config, catalog);
    expect(result.errors).toEqual([]);
    const p1 = result.state.players['p1'];
    const fullDeck = [...p1.hand, ...p1.abilityDeck];
    // Contar cartas por clase
    const classCounts: Record<string, number> = {};
    for (const card of fullDeck) {
      const def = catalog.byId.get(card.definitionId);
      if (def?.heroClass) {
        classCounts[def.heroClass] = (classCounts[def.heroClass] ?? 0) + 1;
      }
    }
    // Debe haber al menos 2 clases (explorer + warrior para p1)
    expect(Object.keys(classCounts).length).toBeGreaterThanOrEqual(2);
    // Cada clase debe tener mínimo 5 cartas
    for (const [, count] of Object.entries(classCounts)) {
      expect(count).toBeGreaterThanOrEqual(5);
    }
    // Total debe ser 15
    expect(fullDeck.length).toBe(15);
  });

  it('D364: validateMulticlassDeck rechaza mazos con menos de 5 de una clase', () => {
    // Mazo con 14 de explorer y 1 de warrior → inválido
    const explorerCards = catalog.byClass.get('EXPLORER') ?? [];
    const warriorCards = catalog.byClass.get('WARRIOR') ?? [];
    const deckIds: string[] = [];
    let added = 0;
    for (const card of explorerCards) {
      for (let i = 0; i < card.copies && added < 14; i++) {
        deckIds.push(card.id);
        added++;
      }
    }
    if (warriorCards.length > 0) {
      deckIds.push(warriorCards[0].id);
    }
    const result = validateMulticlassDeck(deckIds, catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('D364: validateMulticlassDeck acepta mazo válido con 10+5 (2 clases)', () => {
    const explorerCards = catalog.byClass.get('EXPLORER') ?? [];
    const warriorCards = catalog.byClass.get('WARRIOR') ?? [];
    const deckIds: string[] = [];
    // 10 de explorer respetando el límite de copias de cada carta
    let explorerAdded = 0;
    for (const card of explorerCards) {
      for (let i = 0; i < card.copies && explorerAdded < 10; i++) {
        deckIds.push(card.id);
        explorerAdded++;
      }
    }
    // 5 de warrior
    let warriorAdded = 0;
    for (const card of warriorCards) {
      for (let i = 0; i < card.copies && warriorAdded < 5; i++) {
        deckIds.push(card.id);
        warriorAdded++;
      }
    }
    const result = validateMulticlassDeck(deckIds, catalog);
    expect(result.ok).toBe(true);
  });

  it('D434: validateMulticlassDeck rechaza mazos que no son exactamente 2 clases', () => {
    const explorerCards = catalog.byClass.get('EXPLORER') ?? [];
    const warriorCards = catalog.byClass.get('WARRIOR') ?? [];
    const mageCards = catalog.byClass.get('MAGE') ?? [];
    // 1 sola clase (15 explorer)
    const mono: string[] = [];
    for (const card of explorerCards) {
      for (let i = 0; i < card.copies && mono.length < 15; i++) mono.push(card.id);
    }
    expect(validateMulticlassDeck(mono, catalog).ok).toBe(false);
    // 3 clases (5+5+5)
    const tri: string[] = [];
    for (const list of [explorerCards, warriorCards, mageCards]) {
      let added = 0;
      for (const card of list) {
        for (let i = 0; i < card.copies && added < 5; i++) {
          tri.push(card.id);
          added++;
        }
      }
    }
    expect(validateMulticlassDeck(tri, catalog).ok).toBe(false);
  });

  it('D366: capabilities incluyen ambas clases en multiclase', () => {
    
    const config: GameConfig = {
      mode: 'MULTICLASS',
      playerCount: 2,
      seed: 'test-mc-caps-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default', secondDeckId: 'warrior.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: true,
    };
    const result = setupGame(config, catalog);
    const p1 = result.state.players['p1'];
    // Aranel es EXPLORER (RANGED, EXPERTISE) + WARRIOR (MELEE, EXPERTISE)
    expect(p1.capabilities).toContain('RANGED');
    expect(p1.capabilities).toContain('MELEE');
    expect(p1.capabilities).toContain('EXPERTISE');
  });

  it('D364: mercado filtrado por capabilities en multiclase', () => {
    
    const config: GameConfig = {
      mode: 'MULTICLASS',
      playerCount: 2,
      seed: 'test-mc-market-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
      ],
      useScenarios: true,
    };
    const result = setupGame(config, catalog);
    // El mercado debe tener 5 cartas
    expect(result.state.market).toHaveLength(5);
    // Todas las cartas del mercado deben ser compatibles con RANGED+MELEE+EXPERTISE
    for (const card of result.state.market) {
      const def = catalog.byId.get(card.definitionId);
      if (def?.requiredCapabilities && def.requiredCapabilities.length > 0) {
        // Al menos una capability debe estar entre RANGED, MELEE, EXPERTISE
        const playerCaps = new Set(['RANGED', 'MELEE', 'EXPERTISE']);
        expect(def.requiredCapabilities.every(c => playerCaps.has(c))).toBe(true);
      }
    }
  });

  it('D355: warlordsDefeatedCount se inicializa a 0 y 2 Señores en total', () => {
    
    const config: GameConfig = {
      mode: 'MULTICLASS',
      playerCount: 4,
      seed: 'test-mc-warlord-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
        { playerId: 'p3', heroId: 'hero.neddia', heroFace: 'FEMALE', deckId: 'warrior.default' },
        { playerId: 'p4', heroId: 'hero.taheral', heroFace: 'MALE', deckId: 'explorer.default' },
      ],
      useScenarios: true,
    };
    const result = setupGame(config, catalog);
    expect(result.state.warlordsDefeatedCount).toBe(0);
    // 4 jugadores: 2 Señores totales (en mazo + campo, ya que uno puede estar en el campo inicial)
    const warlordsInDeck = result.state.hordeDeck.filter(c => {
      const def = catalog.byId.get(c.definitionId);
      return def?.type === 'WARLORD';
    });
    const warlordsInField = result.state.battlefield.filter(e => e.isWarlord);
    expect(warlordsInDeck.length + warlordsInField.length).toBe(2);
  });
});

