/**
 * Setup — preparacion de una partida.
 *
 * Pasos:
 * 1. Construir la Horda (27 Huestes + 1 Señor al final).
 * 2. Construir el mazo de Mercado (14 cartas).
 * 3. Construir el mazo de Escenarios (12 cartas, si useScenarios).
 * 4. Para cada jugador: construir mazo de Habilidad (15 cartas), barajar, robar 4.
 * 5. Colocar 3 Huestes en el campo de batalla.
 * 6. Colocar 5 cartas de Mercado.
 * 7. Revelar el primer Escenario.
 * 8. Determinar el Líder (puja con 1-2 cartas: mayor daño sumado).
 * 9. Dar monedas iniciales (2 por jugador, 6 en solitario).
 *
 * Todo el azar pasa por el RNG sembrado para determinismo.
 */

import type {
  GameState,
  GameEvent,
  GameConfig,
  CardInstance,
  CardDefinition,
  PlayerState,
  EnemyState,
  Zone,
} from '@nt4h/schema';
import { DeterministicRng } from '../rng/index.js';
import { applyScenarioEffects } from '../scenarios/index.js';
import { resetPhaseSeq } from './engine.js';
import { validateMulticlassDeck } from '../modes/multiclass.js';
import { nextSeq } from '../seq.js';
import type { CatalogLoadResult } from '@nt4h/catalog';

let instanceCounter = 0;

function nextInstanceId(prefix: string): string {
  return `${prefix}-${++instanceCounter}`;
}

export interface SetupResult {
  state: GameState;
  events: GameEvent[];
  rng: DeterministicRng;
  errors: string[];
}

export function setupGame(
  config: GameConfig,
  catalog: CatalogLoadResult,
): SetupResult {
  // D386/D387: Reiniciar contadores globales para determinismo de replay
  resetInstanceCounter();
  resetPhaseSeq();
  const errors: string[] = [];
  const rng = new DeterministicRng(config.seed);
  const events: GameEvent[] = [];
  
  // Estado inicial vacio
  let state: GameState = {
    phase: 'SETUP',
    mode: config.mode,
    activePlayerId: '',
    turnNumber: 0,
    players: {},
    playerOrder: config.heroes.map(h => h.playerId),
    battlefield: [],
    hordeDeck: [],
    market: [],
    marketDeck: [],
    scenario: null,
    scenarioDeck: [],
    scenarioCoins: 0,
    warlordRevealed: false,
    warlordDefeated: false,
    warlordsDefeatedCount: 0,
    pendingChoices: [],
    eventLog: [],
    monotonicCounter: 0,
    rngState: rng.serialize(),
    marketCostModifier: 0,
    ignoreCoinRewards: false,
    ignoreGloryRewards: false,
    orcFortitudeBonus: 0,
  };

  // === 1. Construir la Horda ===
  const hordeCardsAll = catalog.byType.get('HORDE') ?? [];
  const warlordCardsAll = catalog.byType.get('WARLORD') ?? [];

  // Pools personalizados del Taller: si la config indica ids, sustituyen
  // al pool oficial. Los Señores también pueden restringirse.
  const hordeCards = config.hordeCardIds?.length
    ? hordeCardsAll.filter(c => config.hordeCardIds!.includes(c.id))
    : hordeCardsAll;
  const warlordCards = config.warlordIds?.length
    ? warlordCardsAll.filter(c => config.warlordIds!.includes(c.id))
    : warlordCardsAll;

  // D406: comparar instancias totales (suma de copies), no definiciones.
  // El mínimo de 27 solo aplica al pool oficial: un pool personalizado
  // puede ser más pequeño (la partida usa lo disponible).
  const totalHordeInstances = hordeCards.reduce((sum, c) => sum + c.copies, 0);
  if (!config.hordeCardIds?.length && totalHordeInstances < 27) {
    errors.push(`Expected 27 Horde card instances, got ${totalHordeInstances}`);
  }
  if (config.hordeCardIds?.length && totalHordeInstances === 0) {
    errors.push('Custom Horde pool is empty or has no valid HORDE cards');
  }
  if (config.warlordIds?.length && warlordCards.length === 0) {
    errors.push('Custom Warlord pool has no valid WARLORD cards');
  }

  // Tamano de la Horda segun numero de jugadores (especificacion 3.2.1):
  // 4 jugadores → 27, 3 jugadores → 23, 2 jugadores → 19
  // Solitario → 22 (retirar Huestes de Fortaleza 2)
  // Multiclase: 2 jugadores → 23, 3 jugadores → 27, 4 jugadores → 27 (spec §5.2)
  const playerCount = config.heroes.length;
  let hordeSize: number;
  if (config.mode === 'SOLO') {
    // D379: En solitario se retiran las Huestes de Fortaleza 2 (quedan 22)
    // Calcular el tamano real basado en instancias (copies), no definiciones
    const soloHordeInstances = hordeCards
      .filter(c => (c.printedFortitude ?? 0) !== 2)
      .reduce((sum, c) => sum + c.copies, 0);
    hordeSize = Math.min(soloHordeInstances, 22);
  } else if (config.mode === 'MULTICLASS') {
    // Multiclase: Horda más grande (spec §5.2)
    if (playerCount >= 4) {
      hordeSize = 27;
    } else if (playerCount === 3) {
      hordeSize = 27;
    } else {
      hordeSize = 23;
    }
  } else if (playerCount >= 4) {
    hordeSize = 27;
  } else if (playerCount === 3) {
    hordeSize = 23;
  } else {
    hordeSize = 19;
  }

  const hordeInstances: CardInstance[] = [];
  if (config.mode === 'SOLO') {
    // Solo Huestes con Fortaleza != 2
    for (const card of hordeCards.filter(c => (c.printedFortitude ?? 0) !== 2)) {
      for (let i = 0; i < card.copies; i++) {
        hordeInstances.push({
          instanceId: nextInstanceId('horde'),
          definitionId: card.id,
          ownerId: 'horde',
          zone: 'HORDE_DECK' as Zone,
        });
      }
    }
  } else {
    for (const card of hordeCards) {
      for (let i = 0; i < card.copies; i++) {
        hordeInstances.push({
          instanceId: nextInstanceId('horde'),
          definitionId: card.id,
          ownerId: 'horde',
          zone: 'HORDE_DECK' as Zone,
        });
      }
    }
  }

  // Barajar la Horda y recortar al tamano adecuado
  const shuffledHorde = rng.shuffle(hordeInstances).slice(0, hordeSize);
  state.hordeDeck = shuffledHorde;

  // Señores de la Guerra (especificacion 3.2.1 y 5.2):
  // - Estandar/Solitario: 1 Señor al final del mazo.
  // - Multiclase 2-3 jugadores: 1 Señor al final.
  // - Multiclase 4 jugadores: 1 Señor barajado entre las Huestes + 1 al final.
  const warlordCount = (config.mode === 'MULTICLASS' && playerCount >= 4) ? 2 : 1;
  // Especificacion 3.2.1: escoger al azar el Señor de entre los disponibles
  const shuffledWarlords = rng.shuffle([...warlordCards]);
  const selectedWarlords = shuffledWarlords.slice(0, warlordCount);
  // Especificacion 3.2.5: el mazo se roba desde la parte inferior (final del array).
  // El Señor va "encima" del mazo = debe ser la última carta en salir = al PRINCIPIO del array.
  if (config.mode === 'MULTICLASS' && playerCount >= 4 && selectedWarlords.length >= 2) {
    // El primer Señor se baraja con la Horda
    state.hordeDeck.push({
      instanceId: nextInstanceId('warlord'),
      definitionId: selectedWarlords[0].id,
      ownerId: 'horde',
      zone: 'HORDE_DECK' as Zone,
    });
    state.hordeDeck = rng.shuffle(state.hordeDeck);
    // El segundo Señor va al principio (último en salir)
    state.hordeDeck.unshift({
      instanceId: nextInstanceId('warlord'),
      definitionId: selectedWarlords[1].id,
      ownerId: 'horde',
      zone: 'HORDE_DECK' as Zone,
    });
  } else {
    for (const warlord of selectedWarlords) {
      state.hordeDeck.unshift({
        instanceId: nextInstanceId('warlord'),
        definitionId: warlord.id,
        ownerId: 'horde',
        zone: 'HORDE_DECK' as Zone,
      });
    }
  }

  // === 2. Construir el mazo de Mercado ===
  const marketCardsAll = catalog.byType.get('MARKET') ?? [];
  // D364: En multiclase, filtrar mercado por capabilities de los jugadores
  let marketCards = marketCardsAll;
  if (config.mode === 'MULTICLASS') {
    const playerCapabilities = new Set<string>();
    for (const heroConfig of config.heroes) {
      const heroDef = catalog.byId.get(heroConfig.heroId);
      if (heroDef?.capabilities) {
        for (const cap of heroDef.capabilities) playerCapabilities.add(cap);
      }
      // Incluir capabilities de la segunda clase
      const secondDeckIdParts = heroConfig.secondDeckId?.split('.');
      const secondClass = secondDeckIdParts?.[0]?.toUpperCase();
      if (secondClass === 'EXPLORER') { playerCapabilities.add('RANGED'); playerCapabilities.add('EXPERTISE'); }
      if (secondClass === 'WARRIOR') { playerCapabilities.add('MELEE'); playerCapabilities.add('EXPERTISE'); }
      if (secondClass === 'MAGE') { playerCapabilities.add('MAGIC'); }
      if (secondClass === 'ROGUE') { playerCapabilities.add('EXPERTISE'); }
    }
    // D377: Filtrar mercado considerando tambien penaltyCapabilities
    // (un hero multiclase puede comprar cartas con penalizacion si tiene el icono penalizado).
    // Misma semantica que isLegal en execute.ts: basta UN icono requerido
    // (los iconos impresos son alternativas), o un icono penalizado.
    marketCards = marketCardsAll.filter(card => {
      if (!card.requiredCapabilities || card.requiredCapabilities.length === 0) return true;
      return card.requiredCapabilities.some(cap =>
        playerCapabilities.has(cap) ||
        (card.penaltyCapabilities?.some(p => playerCapabilities.has(p.icon)) ?? false)
      );
    });
  }
  // Pool de Mercado personalizado (Taller): sustituye al pool oficial
  if (config.marketCardIds?.length) {
    const wanted = new Set(config.marketCardIds);
    marketCards = marketCards.filter(c => wanted.has(c.id));
  }
  const marketInstances: CardInstance[] = [];
  if (config.mode === 'SOLO') {
    // Solitario: máx 1 copia de cada carta (spec §4.1)
    for (const card of marketCards) {
      marketInstances.push({
        instanceId: nextInstanceId('market'),
        definitionId: card.id,
        ownerId: 'market',
        zone: 'MARKET_DECK' as Zone,
      });
    }
  } else {
    for (const card of marketCards) {
      for (let i = 0; i < card.copies; i++) {
        marketInstances.push({
          instanceId: nextInstanceId('market'),
          definitionId: card.id,
          ownerId: 'market',
          zone: 'MARKET_DECK' as Zone,
        });
      }
    }
  }
  state.marketDeck = rng.shuffle(marketInstances);

  // === 3. Construir el mazo de Escenarios ===
  if (config.useScenarios) {
    let scenarioCards = catalog.byType.get('SCENARIO') ?? [];
    // Solitario: retirar escenarios no válidos (spec §4.1)
    if (config.mode === 'SOLO') {
      scenarioCards = scenarioCards.filter(s => s.id !== 'scenario.tears-of-aradiel' && s.id !== 'scenario.cemenmar-wastes');
    }
    // scenarioIds: el jugador puede limitar qué escenarios entran en el mazo
    if (config.scenarioIds && config.scenarioIds.length > 0) {
      const wanted = new Set(config.scenarioIds);
      scenarioCards = scenarioCards.filter(s => wanted.has(s.id));
    }
    const scenarioInstances: CardInstance[] = scenarioCards.map(card => ({
      instanceId: nextInstanceId('scenario'),
      definitionId: card.id,
      ownerId: 'scenario',
      zone: 'SCENARIO_DECK' as Zone,
    }));
    state.scenarioDeck = rng.shuffle(scenarioInstances);
  }

  // === 4. Para cada jugador: construir mazo, barajar, robar 4 ===
  for (const heroConfig of config.heroes) {
    const heroDef = catalog.byId.get(heroConfig.heroId);
    if (!heroDef) {
      errors.push(`Hero not found: ${heroConfig.heroId}`);
      continue;
    }

    // Construir mazo de habilidad desde el deckId
    // deckId formato: "explorer.default" → clase explorer
    // Usar deckId del config (respeta la elección de clase del jugador)
    const deckIdParts = heroConfig.deckId.split('.');
    const deckClass = deckIdParts[0]?.toUpperCase() as 'EXPLORER' | 'WARRIOR' | 'MAGE' | 'ROGUE' | undefined;
    // Fallback: si deckId no tiene clase válida, inferir de capabilities del héroe
    const heroClass = deckClass && catalog.byClass.has(deckClass)
      ? deckClass
      : heroDef.capabilities?.includes('RANGED') ? 'EXPLORER'
        : heroDef.capabilities?.includes('MELEE') ? 'WARRIOR'
        : heroDef.capabilities?.includes('MAGIC') ? 'MAGE'
        : 'ROGUE';

    const classCards = catalog.byClass.get(heroClass) ?? [];

    const deckInstances: CardInstance[] = [];

    // Taller: mazo personalizado — la config lleva el snapshot de ids (15 cartas)
    const customDeck = heroConfig.customDeckId
      ? config.customDecks?.find(d => d.id === heroConfig.customDeckId)
      : undefined;
    if (heroConfig.customDeckId && !customDeck) {
      errors.push(`Custom deck not found in config: ${heroConfig.customDeckId}`);
      continue;
    }

    // D365-D366: Multiclase — construir mazo con 2 clases si secondDeckId está presente
    const secondDeckIdParts = heroConfig.secondDeckId?.split('.');
    const secondClass = secondDeckIdParts?.[0]?.toUpperCase() as 'EXPLORER' | 'WARRIOR' | 'MAGE' | 'ROGUE' | undefined;
    const secondClassCards = (secondClass && catalog.byClass.has(secondClass))
      ? (catalog.byClass.get(secondClass) ?? [])
      : [];

    if (customDeck) {
      for (const defId of customDeck.cardDefinitionIds) {
        const def = catalog.byId.get(defId);
        if (!def || def.type !== 'ABILITY') {
          errors.push(`Custom deck ${customDeck.id}: unknown/non-ability card ${defId}`);
          continue;
        }
        deckInstances.push({
          instanceId: nextInstanceId('ability'),
          definitionId: def.id,
          ownerId: heroConfig.playerId,
          zone: 'ABILITY_DECK' as Zone,
          name: def.name,
        });
      }
      if (deckInstances.length !== 15) {
        errors.push(`Custom deck ${customDeck.id}: ${deckInstances.length} cards (must be 15)`);
      }
    } else if (secondClassCards.length > 0 && config.mode === 'MULTICLASS') {
      // Multiclase: mínimo 5 de cada clase, 15 total
      // Tracker de copias usadas por definitionId para evitar duplicar copias
      const usedCopies = new Map<string, number>();
      const addCard = (card: CardDefinition): CardInstance => {
        usedCopies.set(card.id, (usedCopies.get(card.id) ?? 0) + 1);
        return {
          instanceId: nextInstanceId('ability'),
          definitionId: card.id,
          ownerId: heroConfig.playerId,
          zone: 'ABILITY_DECK' as Zone,
          name: card.name,
        };
      };
      const remainingCopies = (card: CardDefinition): number =>
        card.copies - (usedCopies.get(card.id) ?? 0);

      // Paso 1: tomar exactamente 5 de la 1ª clase
      let firstAdded = 0;
      const firstMin = 5;
      for (const card of classCards) {
        if (firstAdded >= firstMin) break;
        for (let i = 0; i < card.copies && firstAdded < firstMin; i++) {
          deckInstances.push(addCard(card));
          firstAdded++;
        }
      }
      // Paso 2: tomar exactamente 5 de la 2ª clase
      let secondAdded = 0;
      const secondMin = 5;
      for (const card of secondClassCards) {
        if (secondAdded >= secondMin) break;
        for (let i = 0; i < card.copies && secondAdded < secondMin; i++) {
          deckInstances.push(addCard(card));
          secondAdded++;
        }
      }
      // Paso 3: completar hasta 15 con copias restantes de cualquiera de las 2 clases
      const remaining = 15 - firstAdded - secondAdded;
      if (remaining > 0) {
        // Alternar entre ambas clases para equilibrar, respetando el límite de copias
        let firstIdx = 0;
        let secondIdx = 0;
        for (let r = 0; r < remaining; r++) {
          // Buscar la siguiente carta de la 1ª clase con copias disponibles
          while (firstIdx < classCards.length && remainingCopies(classCards[firstIdx]) <= 0) {
            firstIdx++;
          }
          // Buscar la siguiente carta de la 2ª clase con copias disponibles
          while (secondIdx < secondClassCards.length && remainingCopies(secondClassCards[secondIdx]) <= 0) {
            secondIdx++;
          }
          // Intentar añadir de la 1ª clase; si no hay, de la 2ª
          if (firstIdx < classCards.length) {
            deckInstances.push(addCard(classCards[firstIdx]));
          } else if (secondIdx < secondClassCards.length) {
            deckInstances.push(addCard(secondClassCards[secondIdx]));
          } else {
            break; // No hay más cartas disponibles
          }
        }
      }
      // D364: Validar que el mazo cumple las reglas multiclase
      const validation = validateMulticlassDeck(
        deckInstances.map(c => c.definitionId),
        catalog,
      );
      if (!validation.ok) {
        errors.push(`Multiclass deck validation failed for ${heroConfig.playerId}: ${validation.errors.join(', ')}`);
      }
    } else {
      // Una sola clase: usar todas las cartas de la clase
      for (const card of classCards) {
        for (let i = 0; i < card.copies; i++) {
          deckInstances.push({
            instanceId: nextInstanceId('ability'),
            definitionId: card.id,
            ownerId: heroConfig.playerId,
            zone: 'ABILITY_DECK' as Zone,
            name: card.name,
          });
        }
      }
    }

    const shuffledDeck = rng.shuffle(deckInstances);

    // Robar 4 cartas (mano inicial)
    const hand = shuffledDeck.slice(0, 4).map(c => ({ ...c, zone: 'HAND' as Zone }));
    const remainingDeck = shuffledDeck.slice(4);

    // Monedas iniciales
    const initialCoins = config.mode === 'SOLO' ? 6 : 2;

    // Solitario: sin pericia de héroe (spec §4.1)
    const heroUses = config.mode === 'SOLO' ? 0 : (heroDef.heroAbility?.uses ?? 0);

    // D366: En multiclase, las capabilities son la unión de ambas clases
    // Especificacion §7.1: Guerrero=Melee+Pericia, Explorador=Ranged+Pericia,
    // Picaro=Pericia (puede usar Ranged con penalizacion -1), Mago=Magia
    const classToCaps: Record<string, ('MELEE' | 'RANGED' | 'EXPERTISE' | 'MAGIC')[]> = {
      EXPLORER: ['RANGED', 'EXPERTISE'],
      WARRIOR: ['MELEE', 'EXPERTISE'],
      MAGE: ['MAGIC'],
      ROGUE: ['EXPERTISE'],
    };
    const playerCaps = new Set<'MELEE' | 'RANGED' | 'EXPERTISE' | 'MAGIC'>(heroDef.capabilities ?? []);
    if (secondClass && config.mode === 'MULTICLASS') {
      for (const cap of classToCaps[secondClass] ?? []) {
        playerCaps.add(cap);
      }
    }
    const playerCapabilities = Array.from(playerCaps);

    const player: PlayerState = {
      playerId: heroConfig.playerId,
      heroId: heroConfig.heroId,
      heroFace: heroConfig.heroFace,
      heroUsesRemaining: heroUses,
      heroMaxUses: heroUses,
      glory: 0,
      coins: initialCoins,
      wounds: 0,
      maxWounds: heroDef.maxWounds ?? 3,
      capabilities: playerCapabilities,
      abilityDeck: remainingDeck,
      hand,
      wearPile: [],
      trophies: [],
      shields: 0,
      prevention: 0,
      armor: 0,
      damageCancellation: false,
      interceptedBy: null,
      modifiers: [],
      cardsPlayedThisTurn: {},
      cardsPlayedAgainstEnemy: {},
      persistentCards: [],
      supportDecks: [],
      playerAge: heroConfig.playerAge,
      evasionTokenUsed: false,
    };

    // Solitario: rellenar mazos de Apoyo (spec §4.2)
    if (config.mode === 'SOLO' && config.soloSupportHeroIds) {
      for (const supportHeroId of config.soloSupportHeroIds) {
        const supportHeroDef = catalog.byId.get(supportHeroId);
        if (!supportHeroDef) continue;
        const supportClass = supportHeroDef.capabilities?.includes('RANGED') ? 'EXPLORER'
          : supportHeroDef.capabilities?.includes('MELEE') ? 'WARRIOR'
          : supportHeroDef.capabilities?.includes('MAGIC') ? 'MAGE'
          : 'ROGUE';
        const supportClassCards = catalog.byClass.get(supportClass) ?? [];
        const supportDeck: CardInstance[] = [];
        for (const card of supportClassCards) {
          for (let i = 0; i < card.copies; i++) {
            supportDeck.push({
              instanceId: `solo-support-${supportHeroId}-${card.id}-${i}`,
              definitionId: card.id,
              ownerId: heroConfig.playerId,
              zone: 'ABILITY_DECK' as Zone,
            });
          }
        }
        player.supportDecks.push(rng.shuffle(supportDeck));
      }
    }

    state.players[heroConfig.playerId] = player;

    // Evento: cartas robadas
    events.push({
      type: 'CARDS_DRAWN',
      playerId: heroConfig.playerId,
      count: hand.length,
      cardInstanceIds: hand.map(c => c.instanceId),
      seq: nextSeq(),
    });
  }

  // === 5. Colocar 3 Huestes en el campo de batalla ===
  // Especificacion 3.2.5: el mazo de Horda se roba desde la parte inferior
  const enemiesInField = state.hordeDeck.slice(-3);
  state.hordeDeck = state.hordeDeck.slice(0, -3);

  for (const enemyCard of enemiesInField) {
    const enemyDef = catalog.byId.get(enemyCard.definitionId);
    if (!enemyDef) continue;

    const enemy: EnemyState = {
      instanceId: enemyCard.instanceId,
      definitionId: enemyCard.definitionId,
      baseFortitude: enemyDef.printedFortitude ?? 1,
      wounds: 0,
      // Recompensa oculta: se carga del catálogo pero no se revela al jugador
      // hasta derrotar al enemigo. El motor la usa internamente.
      reward: enemyDef.reward ?? null,
      modifiers: [],
      isWarlord: enemyDef.type === 'WARLORD',
      isOrc: enemyDef.isOrc ?? false,
      specialIcons: enemyDef.specialIcons ?? [],
      damageDisabled: false,
      statuses: [],
    };

    state.battlefield.push(enemy);

    // ENEMY_REVEALED con el EnemyState completo: en un fold del eventLog el
    // reducer lo inserta en el campo (idempotente — aquí ya está insertado).
    events.push({
      type: 'ENEMY_REVEALED',
      enemyInstanceId: enemy.instanceId,
      definitionId: enemy.definitionId,
      fortitude: enemy.baseFortitude,
      enemy,
      seq: nextSeq(),
    });
    // D401: Si el enemigo es Warlord, emitir WARLORD_REVEALED y marcarlo
    if (enemy.isWarlord) {
      events.push({
        type: 'WARLORD_REVEALED',
        warlordInstanceId: enemy.instanceId,
        definitionId: enemy.definitionId,
        seq: nextSeq(),
      });
      state.warlordRevealed = true;
    }
  }

  // D375: Aplicar bonus de Roghkiller a los 3 enemigos iniciales si está en el campo
  // D428: identificar por definitionId estable
  const roghkillerInField = state.battlefield.some(e =>
    e.isWarlord && e.definitionId === 'warlord.roghkiller'
  );
  if (roghkillerInField) {
    const roghkillerInstanceId = state.battlefield.find(e =>
      e.isWarlord && e.definitionId === 'warlord.roghkiller'
    )?.instanceId;
    state.battlefield = state.battlefield.map(e => {
      if (e.isOrc && e.instanceId !== roghkillerInstanceId) {
        const mod = {
          id: `roghkiller-setup-${nextSeq()}`,
          sourceId: 'roghkiller',
          layer: 'FORTITUDE_MODIFIERS' as const,
          timestamp: nextSeq(),
          duration: 'WHILE_SOURCE_ACTIVE' as const,
          amount: 1,
        };
        // Event-sourced: el aura también debe existir en el fold del eventLog
        events.push({
          type: 'MODIFIER_ADDED',
          modifierId: mod.id,
          targetId: e.instanceId,
          layer: mod.layer,
          amount: mod.amount,
          sourceId: mod.sourceId,
          duration: mod.duration,
          seq: nextSeq(),
        });
        return {
          ...e,
          modifiers: [...e.modifiers, mod],
        };
      }
      return e;
    });
  }

  // === 6. Colocar 5 cartas de Mercado ===
  if (config.mode === 'SOLO') {
    // Spec §4.1: el jugador "escoge 5 cartas de Mercado (máximo 1 copia de
    // cada)" y no se reponen. Si la config trae soloMarketCardIds, usar esa
    // selección; si no, las 5 primeras del mazo barajado.
    let marketInField: CardInstance[];
    if (config.soloMarketCardIds && config.soloMarketCardIds.length > 0) {
      const picked: CardInstance[] = [];
      const pool = [...state.marketDeck];
      for (const defId of config.soloMarketCardIds.slice(0, 5)) {
        const idx = pool.findIndex(c => c.definitionId === defId);
        if (idx >= 0) picked.push(pool.splice(idx, 1)[0]);
      }
      marketInField = picked;
    } else {
      marketInField = state.marketDeck.slice(0, 5);
    }
    state.marketDeck = [];
    state.market = marketInField.map(c => ({ ...c, zone: 'MARKET' as Zone }));
  } else {
    const marketInField = state.marketDeck.slice(0, 5);
    state.marketDeck = state.marketDeck.slice(5);
    state.market = marketInField.map(c => ({ ...c, zone: 'MARKET' as Zone }));
  }

  // === 7. Revelar el primer Escenario ===
  // D401: Si un Warlord ya está en el campo inicial, no se revela escenario (spec: "Cuando entre el Señor de la Guerra, el escenario activo se descarta")
  if (config.useScenarios && state.scenarioDeck.length > 0 && !state.warlordRevealed) {
    const scenarioCard = state.scenarioDeck[0];
    state.scenarioDeck = state.scenarioDeck.slice(1);
    state.scenario = { ...scenarioCard, zone: 'SCENARIO_ACTIVE' as Zone };

    events.push({
      type: 'SCENARIO_REVEALED',
      scenarioInstanceId: state.scenario.instanceId,
      definitionId: state.scenario.definitionId,
      seq: nextSeq(),
    });

    // Aplicar efectos continuos del escenario (Lötharion, Skaàrg, Brunmar, etc.)
    const scenarioResult = applyScenarioEffects(state, state.scenario.definitionId, catalog);
    state = scenarioResult.state;

    // Solitario: 1 moneda sobre el escenario activo (spec §4.1)
    if (config.mode === 'SOLO') {
      state.scenarioCoins = 1;
    }
  }

  // D407: Validar que al menos 1 héroe fue creado correctamente
  const validPlayers = state.playerOrder.filter(pid => state.players[pid]);
  if (validPlayers.length === 0) {
    errors.push('No valid heroes: cannot start game without players');
    return { state, events, rng, errors };
  }

  // === 8. Determinar el Líder (puja con 1-2 cartas boca abajo) ===
  // Especificacion 3.2.6: cada jugador escoge 1 o 2 cartas de su mano,
  // se revelan simultaneamente y se comparan los valores de Dano (sumados).
  // El mayor es el Líder. Empate: jugador de mas edad (orden de turnos).
  // Las cartas usadas se colocan al FONDO del mazo. Luego roban hasta 4.
  //
  // D427: Puja interactiva. En multijugador se crea una pendingChoice
  // SELECT_CARDS_FOR_LEADER por jugador; la puja se resuelve cuando todos
  // envian CHOOSE_LEADER_CARDS (ver execute.ts). Si startFirstTurn se invoca
  // con pujas pendientes (tests, IA), auto-resuelve con la heuristica de
  // mayor daño como fallback determinista.
  if (validPlayers.length === 1) {
    state.activePlayerId = validPlayers[0];
    events.push({
      type: 'LEADER_DETERMINED',
      playerId: validPlayers[0],
      seq: nextSeq(),
    });
  } else {
    for (const playerId of validPlayers) {
      const player = state.players[playerId];
      if (!player) continue;
      state.pendingChoices.push({
        choiceId: `leader-bid-${playerId}`,
        playerId,
        type: 'SELECT_CARDS_FOR_LEADER',
        prompt: 'Puja de Líder: elige 1 o 2 cartas de tu mano',
        options: player.hand.map(c => c.instanceId),
        minSelections: 1,
        maxSelections: 2,
      });
    }
  }

  // === 9. Pasar a fase de seleccion inicial / primer turno ===
  state.phase = 'INITIAL_PLAYER_SELECTION';
  events.push({
    type: 'PHASE_CHANGED',
    phase: 'INITIAL_PLAYER_SELECTION',
    seq: nextSeq(),
  });

  // Actualizar rngState en el estado
  state.rngState = rng.serialize();

  return { state, events, rng, errors };
}

/**
 * Resolver la puja de Líder cuando todos los jugadores han elegido sus cartas.
 * Se llama desde execute.ts al recibir CHOOSE_LEADER_CARDS.
 */
export function resolveLeaderBid(
  state: GameState,
  catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  
  // Recoger las cartas pujadas por cada jugador desde las pendingChoices resueltas
  // Las cartas elegidas se guardan en state.pendingChoices como relatedCardIds
  // tras ser resueltas. Aquí leemos el estado actual.
  // Calcular el daño pujado por cada jugador y mover las cartas al fondo
  const damageByPlayer = new Map<string, number>();
  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    if (!player) continue;

    // Buscar las cartas pujadas: están marcadas en player.leaderBidCards
    const bidCardIds = player.leaderBidCards;
    if (!bidCardIds || bidCardIds.length === 0) continue;

    const bidCards = player.hand.filter(c => bidCardIds.includes(c.instanceId));
    let bidDamage = 0;
    for (const card of bidCards) {
      const cardDef = catalog.byId.get(card.definitionId);
      bidDamage += cardDef?.printedAttack ?? 0;
    }
    damageByPlayer.set(playerId, bidDamage);

    // Retirar las cartas pujadas de la mano y ponerlas al fondo del mazo
    // (con eventos para que el replay reconstruya el estado)
    const bidIds = new Set(bidCards.map(c => c.instanceId));
    for (const card of bidCards) {
      events.push({
        type: 'CARD_MOVED',
        cardInstanceId: card.instanceId,
        from: 'HAND',
        to: 'ABILITY_DECK',
        playerId,
        seq: nextSeq(),
      });
    }
    state = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...state.players[playerId],
          hand: state.players[playerId].hand.filter(c => !bidIds.has(c.instanceId)),
          abilityDeck: [...state.players[playerId].abilityDeck, ...bidCards.map(c => ({ ...c, zone: 'ABILITY_DECK' as Zone }))],
        },
      },
    };
  }

  // Determinar el Líder: mayor daño sumado. En empate (spec §3.2.6):
  // - Si todos los empatados declararon edad, gana el mayor (regla de mesa).
  // - Si no (la app no pide datos personales), sorteo determinista con el
  //   RNG sembrado — reproducible en replay, sin datos privados.
  const maxDamage = Math.max(0, ...damageByPlayer.values());
  const tied = state.playerOrder.filter(pid => damageByPlayer.get(pid) === maxDamage);
  let leaderId = tied[0] ?? state.playerOrder[0];
  if (tied.length > 1) {
    const ages = tied.map(pid => state.players[pid]?.playerAge);
    const allHaveAge = ages.every(a => typeof a === 'number');
    if (allHaveAge) {
      const maxAge = Math.max(...(ages as number[]));
      leaderId = tied.find(pid => state.players[pid].playerAge === maxAge) ?? tied[0];
      events.push({
        type: 'LEADER_TIE_BREAK',
        tiedPlayerIds: tied,
        winnerId: leaderId,
        method: 'AGE',
        seq: nextSeq(),
      });
    } else {
      const rng = DeterministicRng.deserialize(state.rngState);
      leaderId = rng.pick(tied);
      state = { ...state, rngState: rng.serialize() };
      events.push({
        type: 'LEADER_TIE_BREAK',
        tiedPlayerIds: tied,
        winnerId: leaderId,
        method: 'RANDOM_SEEDED',
        seq: nextSeq(),
      });
    }
  }

  // Robar hasta tener 4 cartas en mano
  for (const playerId of state.playerOrder) {
    // D429: leer state.players[playerId] dentro del bucle — la referencia
    // capturada queda obsoleta tras cada actualizacion (bucle infinito)
    const drawnIds: string[] = [];
    while (state.players[playerId]
           && state.players[playerId].hand.length < 4
           && state.players[playerId].abilityDeck.length > 0) {
      const drawn = state.players[playerId].abilityDeck[0];
      drawnIds.push(drawn.instanceId);
      state = {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...state.players[playerId],
            abilityDeck: state.players[playerId].abilityDeck.slice(1),
            hand: [...state.players[playerId].hand, { ...drawn, zone: 'HAND' as Zone }],
          },
        },
      };
    }
    if (drawnIds.length > 0) {
      events.push({
        type: 'CARDS_DRAWN',
        playerId,
        count: drawnIds.length,
        cardInstanceIds: drawnIds,
        seq: nextSeq(),
      });
    }
  }

  state = { ...state, activePlayerId: leaderId };
  events.push({
    type: 'LEADER_DETERMINED',
    playerId: leaderId,
    seq: nextSeq(),
  });

  // Limpiar pendingChoices de líder
  state = {
    ...state,
    pendingChoices: state.pendingChoices.filter(c => !c.choiceId.startsWith('leader-bid-')),
  };

  return { state, events };
}

/**
 * D427: Auto-resolver pujas de Líder pendientes con la heurística determinista
 * (cada jugador puja sus 2 cartas de mayor daño). Fallback para cuando
 * startFirstTurn se invoca sin que los jugadores hayan enviado
 * CHOOSE_LEADER_CARDS (tests, IA, flujos headless).
 */
export function autoResolveLeaderBid(
  state: GameState,
  catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const pendingBids = state.pendingChoices.filter(c => c.choiceId.startsWith('leader-bid-'));
  if (pendingBids.length === 0) return { state, events: [] };

  // Simular pujas: cada jugador elige sus 2 cartas de mayor daño
  const players = { ...state.players };
  for (const choice of pendingBids) {
    const player = players[choice.playerId];
    if (!player) continue;
    const sortedHand = [...player.hand].sort((a, b) => {
      const defA = catalog.byId.get(a.definitionId);
      const defB = catalog.byId.get(b.definitionId);
      return (defB?.printedAttack ?? 0) - (defA?.printedAttack ?? 0);
    });
    const bidCards = sortedHand.slice(0, Math.min(2, sortedHand.length));
    players[choice.playerId] = {
      ...player,
      leaderBidCards: bidCards.map(c => c.instanceId),
    } as PlayerState;
  }

  return resolveLeaderBid({ ...state, players }, catalog);
}

/**
 * Iniciar el primer turno despues de la seleccion inicial.
 * Si quedan pujas de Líder pendientes y se pasa el catálogo,
 * las auto-resuelve primero (D427 fallback determinista).
 */
export function startFirstTurn(
  state: GameState,
  _rng: DeterministicRng,
  catalog?: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let workingState = state;

  if (catalog && workingState.pendingChoices.some(c => c.choiceId.startsWith('leader-bid-'))) {
    const bidResult = autoResolveLeaderBid(workingState, catalog);
    workingState = bidResult.state;
    events.push(...bidResult.events);
  }

  const newState: GameState = {
    ...workingState,
    phase: 'TURN_START',
    turnNumber: 1,
  };

  events.push({
    type: 'TURN_STARTED',
    playerId: newState.activePlayerId,
    turnNumber: 1,
    seq: nextSeq(),
  });

  events.push({
    type: 'PHASE_CHANGED',
    phase: 'ATTACK_CHOICE',
    seq: nextSeq(),
  });

  newState.phase = 'ATTACK_CHOICE';

  return { state: newState, events };
}

/** Reset del contador de instancias (para tests) */
export function resetInstanceCounter(): void {
  instanceCounter = 0;
}
