/**
 * HeroAbilities — Pericias de héroes.
 *
 * Cada heroe tiene una Pericia especial con un numero limitado de usos.
 * Las Pericias se activan con el comando USE_HERO_ABILITY.
 *
 * Pericias implementadas:
 * - Aranel: buscar carta en mazo y cambiar por mano
 * - Neddia: buscar en mazo de Mercado y cambiar
 * - Taheral: ganar 2 monedas por carta descartada en Evasion
 * - Idril: mirar 3 cartas inferiores de la Horda y reordenar
 * - Feldon: perder mitad de cartas en ataque de Horda (pasiva)
 * - Valerys: interceptar dano de otro heroe y ganar Gloria
 * - Beleth-Il: recuperar primera carta fallida de Disparo Rapido (pasiva)
 * - Lisavette: usar Escudo durante ataque de Horda a otro heroe (pasiva)
 */

import type {
  GameState,
  GameEvent,
  PendingChoice,
  ResolutionContext,
  CardEffect,
} from '@nt4h/schema';
import type { DeterministicRng } from '../rng/index.js';
import { nextSeq, resetSeq } from '../seq.js';
import type { CatalogLoadResult } from '@nt4h/catalog';
import { EffectRegistry, registerCoreEffects } from '../effects/registry.js';
import { executeEffectChain } from '../effects/resolver.js';
import { getEffectiveFortitude } from '../modifiers/index.js';

// D426: alias por compatibilidad — resetSeq ahora es global (§51.12)
export function resetAbilitySeq(): void {
  resetSeq();
}

export interface AbilityResult {
  events: GameEvent[];
  state: GameState;
  /** Obsoleto: las elecciones se guardan en state.pendingChoices */
  pendingChoice: null;
}

/**
 * Activar la Pericia de un heroe.
 */
export function useHeroAbility(
  state: GameState,
  playerId: string,
  _rng: DeterministicRng,
  catalog: CatalogLoadResult,
  targetId?: string,
  targetEnemyId?: string,
): AbilityResult {
  const player = state.players[playerId];
  if (!player) {
    return { events: [], state, pendingChoice: null };
  }

  if (player.heroUsesRemaining <= 0) {
    return { events: [], state, pendingChoice: null };
  }

  const heroDef = catalog.byId.get(player.heroId);
  if (!heroDef) {
    return { events: [], state, pendingChoice: null };
  }

  const events: GameEvent[] = [];
  // D428: identificar al héroe por heroId estable, no por nombre localizado
  const heroId = heroDef.id;

  // Verificaciones previas segun el heroe (antes de consumir el uso)
  // D370: Lisavette requiere carta "Escudo" (warrior.shield) en mano
  if (heroId === 'hero.lisavette' && !player.hand.find(c => c.definitionId === 'warrior.shield')) {
    return { events: [], state, pendingChoice: null };
  }

  // Para Valèrys/Lisavette sin target, NO consumir el uso aún (se consume al resolver)
  // D370: Lisavette necesita además elegir un enemigo cuyo daño prevenir
  const needsTargetFirst = (heroId === 'hero.valerys' || heroId === 'hero.lisavette') && !targetId;
  if (needsTargetFirst) {
    // Crear el pendingChoice sin consumir el uso
    switch (heroId) {
      case 'hero.valerys':
        return valerysAbility(state, playerId, undefined, events);
      case 'hero.lisavette':
        return lisavetteAbility(state, playerId, undefined, undefined, events);
    }
  }

  // D370: Lisavette con héroe objetivo pero sin enemigo objetivo → pedir SELECT_ENEMY
  if (heroId === 'hero.lisavette' && targetId && !targetEnemyId) {
    return lisavetteAbility(state, playerId, targetId, undefined, events);
  }

  // Héroes con pericias pasivas: NO consumir uso ni emitir HERO_ABILITY_USED
  // (se activan automáticamente durante la fase correspondiente)
  const passiveHeroes = ['hero.taheral', 'hero.feldon', 'hero.beleth-il'];
  if (passiveHeroes.includes(heroId)) {
    return { events: [], state, pendingChoice: null };
  }

  // D374: Pre-validacion — no consumir uso si no hay cartas disponibles para la pericia
  // D434: Aranel tambien requiere una carta de mano para sustituir (spec §6.8)
  if (heroId === 'hero.aranel' && (player.abilityDeck.length === 0 || player.hand.length === 0)) {
    return { events: [], state, pendingChoice: null };
  }
  // D434: Neddia necesita cartas en el mazo Y visibles en el Mercado para el intercambio
  if (heroId === 'hero.neddia' && (state.marketDeck.length === 0 || state.market.length === 0)) {
    return { events: [], state, pendingChoice: null };
  }
  if (heroId === 'hero.idril' && state.hordeDeck.length < 1) {
    return { events: [], state, pendingChoice: null };
  }

  // Héroes sin implementación hardcodeada solo ejecutan los efectos
  // declarativos de `heroAbility.effects` del catálogo (Taller). Si no hay
  // ninguno, la pericia no existe → no consumir el uso ni emitir el evento.
  const HARDCODED_HEROES = new Set([
    'hero.aranel', 'hero.neddia', 'hero.idril',
    'hero.valerys', 'hero.lisavette',
  ]);
  const declarativeEffects: CardEffect[] = heroDef.heroAbility?.effects ?? [];
  if (!HARDCODED_HEROES.has(heroId) && declarativeEffects.length === 0) {
    return { events: [], state, pendingChoice: null };
  }

  // Evento: pericia usada
  events.push({
    type: 'HERO_ABILITY_USED',
    playerId,
    usesRemaining: player.heroUsesRemaining - 1,
    seq: nextSeq(),
  });

  // Ejecutar efecto segun el heroe
  const newState: GameState = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        heroUsesRemaining: player.heroUsesRemaining - 1,
      },
    },
  };

  // D428: dispatch por heroId estable
  switch (heroId) {
    case 'hero.aranel':
      return aranelAbility(newState, playerId, events);

    case 'hero.neddia':
      return neddiaAbility(newState, playerId, events, catalog);

    case 'hero.idril':
      return idrilAbility(newState, playerId, events);

    case 'hero.valerys':
      return valerysAbility(newState, playerId, targetId, events);

    case 'hero.lisavette':
      // Lisavette: pasiva — durante ataque de Horda a otro heroe,
      // puede usar una carta de Escudo para prevenir el daño de un enemigo específico
      // y robar hasta 2 Monedas de ese Héroe.
      // (la verificacion de escudos se hace antes de consumir el uso)
      return lisavetteAbility(newState, playerId, targetId, targetEnemyId, events);

    default: {
      // Taller: ejecutar los efectos declarativos del catálogo a través
      // del registry genérico (pre-check arriba garantiza que existen).
      const reg = new EffectRegistry();
      registerCoreEffects(reg);
      const ctx: ResolutionContext = {
        activePlayerId: playerId,
        currentCardId: heroDef.id,
        currentCardName: heroDef.name,
        currentCardInstanceId: `ability-${playerId}`,
        selectedEnemyId: targetEnemyId ?? null,
        cardsPlayedThisTurn: player.cardsPlayedThisTurn,
        cardsPlayedAgainstEnemy: player.cardsPlayedAgainstEnemy,
        drawnCardInstanceId: null,
        sourceZone: 'HAND',
        enemiesDefeatedThisResolution: [],
        depth: 0,
      };
      const chain = executeEffectChain(
        declarativeEffects, ctx, newState, _rng, reg, catalog, 0,
      );
      return {
        events: [...events, ...chain.events],
        state: chain.state,
        pendingChoice: null,
      };
    }
  }
}

// ============================================================================
// Aranel — buscar carta en mazo y cambiar por mano
// ============================================================================

function aranelAbility(
  state: GameState,
  playerId: string,
  events: GameEvent[],
): AbilityResult {
  const player = state.players[playerId];
  // Crear PendingChoice con SEARCH_DECK y las cartas del mazo como opciones
  const choice: PendingChoice = {
    choiceId: `aranel-${playerId}-${nextSeq()}`,
    playerId,
    type: 'SEARCH_DECK',
    prompt: 'Aranel: Selecciona una carta de tu mazo para intercambiar con una de tu mano',
    options: player.abilityDeck.map(c => c.instanceId),
    minSelections: 1,
    maxSelections: 1,
  };
  return {
    events,
    state: { ...state, pendingChoices: [...state.pendingChoices, choice] },
    pendingChoice: null,
  };
}

// ============================================================================
// Neddia — buscar en mazo de Mercado y cambiar
// ============================================================================

function neddiaAbility(
  state: GameState,
  playerId: string,
  events: GameEvent[],
  catalog?: CatalogLoadResult,
): AbilityResult {
  // D434: leer el máximo de cartas del catálogo (Neddia: hasta 2)
  const heroDef = catalog?.byId.get('hero.neddia');
  const searchEffect = heroDef?.heroAbility?.effects.find(e => e.type === 'SEARCH_DECK');
  const maxCards = (searchEffect && searchEffect.type === 'SEARCH_DECK' ? searchEffect.amount : undefined) ?? 2;
  // Crear PendingChoice con SEARCH_MARKET_DECK y las cartas del marketDeck como opciones
  const choice: PendingChoice = {
    choiceId: `neddia-${playerId}-${nextSeq()}`,
    playerId,
    type: 'SEARCH_MARKET_DECK',
    prompt: `Neddia: Selecciona hasta ${maxCards} cartas del mazo de Mercado para intercambiar`,
    options: state.marketDeck.map(c => c.instanceId),
    minSelections: 1,
    maxSelections: Math.min(maxCards, state.market.length),
  };
  return {
    events,
    state: { ...state, pendingChoices: [...state.pendingChoices, choice] },
    pendingChoice: null,
  };
}

// ============================================================================
// Idril — mirar 3 cartas inferiores de la Horda y reordenar
// ============================================================================

function idrilAbility(
  state: GameState,
  playerId: string,
  events: GameEvent[],
): AbilityResult {
  // Mirar las 3 cartas inferiores del mazo de la Horda
  const bottom3 = state.hordeDeck.slice(-3);
  if (bottom3.length === 0) {
    return { events, state, pendingChoice: null };
  }
  // Crear pendingChoice con SELECT_ORDER
  const choice: PendingChoice = {
    choiceId: `idril-${playerId}-${nextSeq()}`,
    playerId,
    type: 'SELECT_ORDER',
    prompt: 'Idril: Reordena las 3 cartas inferiores del mazo de la Horda',
    options: bottom3.map(c => c.instanceId),
    minSelections: bottom3.length,
    maxSelections: bottom3.length,
  };
  return {
    events,
    state: { ...state, pendingChoices: [...state.pendingChoices, choice] },
    pendingChoice: null,
  };
}

// ============================================================================
// Valerys — interceptar dano de otro heroe y ganar Gloria
// ============================================================================

function valerysAbility(
  state: GameState,
  playerId: string,
  targetHeroId: string | undefined,
  events: GameEvent[],
): AbilityResult {
  // Spec §6.8: "Al resolver el ataque de la Horda sobre otro Héroe, tú recibes
  // el daño". Solo puede interceptarse el daño del héroe que se enfrenta a la
  // Horda (el jugador activo), y Valèrys no puede interceptar su propio daño.
  if (playerId === state.activePlayerId) {
    return { events, state, pendingChoice: null };
  }
  if (!targetHeroId) {
    const confronted = state.activePlayerId;
    const choice: PendingChoice = {
      choiceId: `valerys-${playerId}-${nextSeq()}`,
      playerId,
      type: 'SELECT_HERO',
      prompt: 'Valèrys: Selecciona el heroe cuyo dano vas a interceptar',
      options: confronted && confronted !== playerId ? [confronted] : [],
      minSelections: 1,
      maxSelections: 1,
      fromReactionWindow: true,
    };
    return {
      events,
      state: { ...state, pendingChoices: [...state.pendingChoices, choice] },
      pendingChoice: null,
    };
  }
  // Solo el heroe enfrentado es un objetivo valido
  if (targetHeroId !== state.activePlayerId) {
    return { events, state, pendingChoice: null };
  }

  // Emitir DAMAGE_INTERCEPTED para registrar la intercepcion
  // El dano real se redirige en processHordeAttack; la Gloria se otorga alli,
  // ligada a recibir el daño (spec §6.8: "tú recibes el daño y ganas 1 Gloria")
  events.push({
    type: 'DAMAGE_INTERCEPTED',
    interceptorPlayerId: playerId,
    originalTargetPlayerId: targetHeroId,
    amount: 0, // El dano real se determina en el motor de fases
    seq: nextSeq(),
  });

  return { events, state, pendingChoice: null };
}

// ============================================================================
// Lisavette — usar Escudo para otro heroe + robar hasta 2 Monedas (pasiva)
// ============================================================================

function lisavetteAbility(
  state: GameState,
  playerId: string,
  targetHeroId: string | undefined,
  targetEnemyId: string | undefined,
  events: GameEvent[],
): AbilityResult {
  // Spec §6.8: solo puede usarse "mientras OTRO Héroe se enfrenta a la Horda"
  // — no durante el propio turno de Lisavette.
  if (playerId === state.activePlayerId) {
    return { events, state, pendingChoice: null };
  }
  // El objetivo debe ser el héroe que se enfrenta a la Horda
  if (targetHeroId && targetHeroId !== state.activePlayerId) {
    return { events, state, pendingChoice: null };
  }
  // Paso 1: Sin héroe objetivo → pedir SELECT_HERO
  // Spec §6.8: "Mientras otro Héroe se enfrenta a la Horda… Roba hasta 2
  // Monedas de ese Héroe" — el héroe protegido y del que se roba es el que se
  // enfrenta a la Horda (el jugador activo), no uno cualquiera.
  if (!targetHeroId) {
    const confronted = state.activePlayerId;
    const choice: PendingChoice = {
      choiceId: `lisavette-${playerId}-${nextSeq()}`,
      playerId,
      type: 'SELECT_HERO',
      prompt: 'Lisavette: Selecciona el heroe al que vas a proteger con un Escudo',
      options: confronted && confronted !== playerId ? [confronted] : [],
      minSelections: 1,
      maxSelections: 1,
      fromReactionWindow: true,
    };
    return {
      events,
      state: { ...state, pendingChoices: [...state.pendingChoices, choice] },
      pendingChoice: null,
    };
  }

  // Paso 2: Con héroe objetivo pero sin enemigo objetivo → pedir SELECT_ENEMY
  if (!targetEnemyId) {
    const enemies = state.battlefield
      // getEffectiveFortitude (base+mods): el campo materializado no se
      // actualiza durante la partida real — leerlo ignoraba modificadores.
      .filter(e => e.wounds < getEffectiveFortitude(e, state))
      .map(e => e.instanceId);
    const choice: PendingChoice = {
      choiceId: `lisavette-enemy-${playerId}-${nextSeq()}`,
      playerId,
      type: 'SELECT_ENEMY',
      prompt: 'Lisavette: Selecciona el enemigo cuyo daño vas a prevenir al héroe',
      options: enemies,
      minSelections: 1,
      maxSelections: 1,
      fromReactionWindow: true,
      resolutionContext: {
        activePlayerId: playerId,
        currentCardId: '',
        currentCardName: 'Lisavette',
        currentCardInstanceId: '',
        selectedEnemyId: null,
        cardsPlayedThisTurn: {},
        cardsPlayedAgainstEnemy: {},
        drawnCardInstanceId: null,
        sourceZone: 'HAND',
        enemiesDefeatedThisResolution: [],
        depth: 0,
        chosenHeroTarget: targetHeroId,
      },
    };
    return {
      events,
      state: { ...state, pendingChoices: [...state.pendingChoices, choice] },
      pendingChoice: null,
    };
  }

  // Paso 3: Con ambos objetivos → ejecutar la pericia
  // D370: Verificar que el jugador tiene una carta de "Escudo" (warrior.shield) en mano
  const player = state.players[playerId];
  const shieldCard = player.hand.find(c => c.definitionId === 'warrior.shield');
  if (!shieldCard) {
    return { events, state, pendingChoice: null };
  }

  // D370: Jugar la carta de Escudo — mover de mano a Desgaste
  events.push({
    type: 'CARD_PLAYED',
    playerId,
    cardInstanceId: shieldCard.instanceId,
    cardDefinitionId: 'warrior.shield',
    cardName: 'Escudo',
    seq: nextSeq(),
  });
  events.push({
    type: 'CARD_MOVED',
    cardInstanceId: shieldCard.instanceId,
    playerId,
    from: 'HAND',
    to: 'WEAR_PILE',
    seq: nextSeq(),
  });

  // D370: Prevenir el daño del enemigo específico al héroe objetivo
  // Usar ENEMY_DAMAGE_DISABLED para que el enemigo seleccionado no cause daño
  // en el Ataque de la Horda (processHordeAttack salta enemigos con damageDisabled)
  events.push({
    type: 'ENEMY_DAMAGE_DISABLED',
    enemyInstanceId: targetEnemyId,
    seq: nextSeq(),
  });

  // D370: Robar hasta 2 Monedas del heroe objetivo
  const targetPlayer = state.players[targetHeroId];
  const coinsToSteal = Math.min(2, targetPlayer?.coins ?? 0);
  if (coinsToSteal > 0) {
    events.push({
      type: 'COINS_STOLEN',
      fromPlayerId: targetHeroId,
      toPlayerId: playerId,
      amount: coinsToSteal,
      seq: nextSeq(),
    });
  }

  return { events, state, pendingChoice: null };
}
