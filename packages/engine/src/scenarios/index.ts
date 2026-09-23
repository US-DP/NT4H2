/**
 * Scenarios — efectos de las 12 cartas de Escenario.
 *
 * Los escenarios modifican las reglas mientras estan activos.
 * Algunos tienen efectos continuos (Ruinas de Brunmar, Mercado de Lotharion)
 * y otros tienen efectos disparados (Campo de Batalla, Pantano Umbrío).
 *
 * Cuando el campo de batalla queda vacio, se descarta el escenario actual
 * y se revela uno nuevo del mazo de Escenarios.
 */

import type {
  GameState,
  GameEvent,
  ResolutionContext,
  EnemyState,
  PendingChoice,
} from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import { evalValue, drawCardsWithReshuffle } from '../effects/registry.js';
import { applyEntryAuras } from '../modifiers/index.js';
import { applyEvent, checkFortitudeDefeats } from '../events/applyEvent.js';
import { DeterministicRng } from '../rng/index.js';
import { nextSeq, resetSeq } from '../seq.js';

// D426: alias por compatibilidad — resetSeq ahora es global (§51.12)
export function resetScenarioSeq(): void {
  resetSeq();
}

/**
 * Aplicar los efectos continuos de un escenario al estado.
 * Se llama cuando un escenario se revela.
 */
export function applyScenarioEffects(
  state: GameState,
  scenarioDefId: string,
  _catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let newState = state;

  switch (scenarioDefId) {
    case 'scenario.brunmar-ruins':
      // Ruinas de Brunmar: -1 fortaleza a todos los enemigos (via modificador), ignora Gloria
      newState = {
        ...newState,
        ignoreGloryRewards: true,
        battlefield: newState.battlefield.map(e => ({
          ...e,
          // NO mutar baseFortitude; el modificador se aplica via getEffectiveFortitude
          modifiers: [
            ...e.modifiers,
            {
              id: `scenario-brunmar-${nextSeq()}`,
              sourceId: newState.scenario?.instanceId ?? 'scenario',
              layer: 'FORTITUDE_MODIFIERS',
              timestamp: nextSeq(),
              duration: 'WHILE_SOURCE_ACTIVE',
              amount: -1,
            },
          ],
        })),
      };
      // D434 (spec §6.9 nota Brunmar): la reduccion de Fortaleza puede
      // derrotar inmediatamente a enemigos ya heridos
      for (const ev of checkFortitudeDefeats(newState, newState.activePlayerId, nextSeq)) {
        events.push(ev);
        newState = applyEvent(newState, ev);
      }
      break;

    case 'scenario.lotharion-market':
      // Mercado de Lotharion: -1 al coste de mercado
      newState = {
        ...newState,
        marketCostModifier: newState.marketCostModifier - 1,
      };
      break;

    case 'scenario.skaarg-plains':
      // Planicie de Skaarg: ignora recompensas de monedas
      newState = {
        ...newState,
        ignoreCoinRewards: true,
      };
      break;

    default:
      // Escenarios con efectos disparados no modifican el estado continuamente
      break;
  }

  return { state: newState, events };
}

/**
 * Limpiar los efectos de un escenario al descartarlo.
 */
export function clearScenarioEffects(
  state: GameState,
  scenarioDefId: string,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let newState = state;

  switch (scenarioDefId) {
    case 'scenario.brunmar-ruins':
      newState = {
        ...newState,
        ignoreGloryRewards: false,
        // Solo quitar modificadores del escenario (baseFortitude no fue mutado)
        battlefield: newState.battlefield.map(e => ({
          ...e,
          modifiers: e.modifiers.filter(m => !m.id.startsWith('scenario-brunmar')),
        })),
      };
      break;

    case 'scenario.lotharion-market':
      newState = {
        ...newState,
        marketCostModifier: newState.marketCostModifier + 1,
      };
      break;

    case 'scenario.skaarg-plains':
      newState = {
        ...newState,
        ignoreCoinRewards: false,
      };
      break;

    default:
      break;
  }

  return { state: newState, events };
}

/**
 * Procesar el efecto disparado ON_ENEMY_DEFEATED de un escenario.
 * Lee condition.fortitudeGte del JSON del escenario en lugar de hardcodear.
 */
export function onEnemyDefeated(
  state: GameState,
  scenarioDefId: string,
  defeatingPlayerId: string,
  enemyFortitude: number,
  catalog?: CatalogLoadResult,
): GameEvent[] {
  const events: GameEvent[] = [];

  // Intentar leer los efectos del escenario desde el catálogo
  const scenarioDef = catalog?.byId.get(scenarioDefId);
  const onDefeatEffect = scenarioDef?.effects?.find(
    (e: any) => e.type === 'ON_ENEMY_DEFEATED'
  ) as any;

  if (onDefeatEffect) {
    // Evaluar condition.fortitudeGte si existe
    const fortitudeGte = onDefeatEffect.condition?.fortitudeGte;
    if (fortitudeGte !== undefined && enemyFortitude < fortitudeGte) {
      return events; // No cumple la condición
    }
    // Contexto mínimo para evalValue
    const ctx: ResolutionContext = {
      activePlayerId: defeatingPlayerId,
      currentCardId: '',
      currentCardName: '',
      currentCardInstanceId: '',
      selectedEnemyId: null,
      cardsPlayedThisTurn: {},
      cardsPlayedAgainstEnemy: {},
      drawnCardInstanceId: null,
      sourceZone: 'HAND',
      enemiesDefeatedThisResolution: [],
      depth: 0,
      lastDefeatedEnemyFortitude: enemyFortitude,
    };
    // Ejecutar los efectos internos declarativamente con evalValue
    for (const innerEffect of onDefeatEffect.effects ?? []) {
      if (innerEffect.type === 'GAIN_COINS') {
        const amount = innerEffect.amount
          ? evalValue(innerEffect.amount, ctx, state)
          : 1;
        events.push({
          type: 'COINS_GAINED',
          playerId: defeatingPlayerId,
          amount,
          seq: nextSeq(),
        });
      } else if (innerEffect.type === 'GAIN_GLORY') {
        const amount = innerEffect.amount
          ? evalValue(innerEffect.amount, ctx, state)
          : 1;
        events.push({
          type: 'GLORY_GAINED',
          playerId: defeatingPlayerId,
          amount,
          seq: nextSeq(),
        });
      } else if (innerEffect.type === 'DRAW_CARDS') {
        const amount = innerEffect.amount
          ? evalValue(innerEffect.amount, ctx, state)
          : 1;
        const player = state.players[defeatingPlayerId];
        const drawn = player
          ? player.abilityDeck.slice(0, amount).map(c => c.instanceId)
          : [];
        if (drawn.length > 0) {
          events.push({
            type: 'CARDS_DRAWN',
            playerId: defeatingPlayerId,
            count: drawn.length,
            cardInstanceIds: drawn,
            seq: nextSeq(),
          });
        }
      } else if (innerEffect.type === 'LOSE_CARDS') {
        const amount = innerEffect.amount
          ? evalValue(innerEffect.amount, ctx, state)
          : 1;
        const player = state.players[defeatingPlayerId];
        const lost = player
          ? player.abilityDeck.slice(0, amount).map(c => c.instanceId)
          : [];
        if (lost.length > 0) {
          events.push({
            type: 'CARDS_LOST',
            playerId: defeatingPlayerId,
            count: lost.length,
            cardInstanceIds: lost,
            seq: nextSeq(),
          });
        }
      }
    }
    return events;
  }

  // Fallback: comportamiento hardcodeado si no hay catálogo
  switch (scenarioDefId) {
    case 'scenario.battlefield':
      events.push({
        type: 'COINS_GAINED',
        playerId: defeatingPlayerId,
        amount: 1,
        seq: nextSeq(),
      });
      break;

    case 'scenario.umbrous-swamp':
      if (enemyFortitude >= 3) {
        events.push({
          type: 'COINS_GAINED',
          playerId: defeatingPlayerId,
          amount: 1,
          seq: nextSeq(),
        });
      }
      break;

    default:
      break;
  }

  return events;
}

/**
 * Procesar el efecto opcional ON_TURN_START de un escenario.
 * Devuelve null si el escenario no tiene efecto de inicio de turno,
 * o una descripcion del efecto para que el jugador decida.
 */
export function onTurnStart(
  _state: GameState,
  scenarioDefId: string,
): { optional: boolean; prompt: string } | null {
  switch (scenarioDefId) {
    case 'scenario.ur-mountains':
      return {
        optional: true,
        prompt: 'Montañas de Ur: ¿Robar 1 carta y revelar un enemigo de la Horda?',
      };

    case 'scenario.eque-port':
      return {
        optional: true,
        prompt: 'Puerto de Eque: ¿Descartar 1 carta, robar 1 y +1 al dano del enemigo?',
      };

    case 'scenario.kalern-mud':
      // Lodazal de Kalern: el jugador a la izquierda elige un enemigo y lo devuelve al fondo de la Horda
      return {
        optional: false,
        prompt: 'Lodazal de Kalern: El jugador a tu izquierda elige un enemigo para devolverlo al fondo del mazo de la Horda',
      };

    case 'scenario.ulthar-portal':
      // Portal de Ulthar: opcional, pagar 1 Gloria o 2 Monedas para devolver Hueste y colocar trofeo
      return {
        optional: true,
        prompt: 'Portal de Ulthar: ¿Pagar 1 Gloria (o 2 Monedas) para devolver una Hueste al mazo y colocar un trofeo en el campo?',
      };

    case 'scenario.tears-of-aradiel':
      // Lágrimas de Aradiel: una vez por turno, pagar 1 Gloria a otro héroe y jugar carta aleatoria suya
      // Solo multijugador (_notValidInSolo)
      if (_state.playerOrder.length <= 1) return null;
      return {
        optional: true,
        prompt: 'Lágrimas de Aradiel: ¿Pagar 1 Gloria a otro héroe y jugar una carta aleatoria suya?',
      };

    case 'scenario.jade-deposits':
      return {
        optional: true,
        prompt: 'Yacimientos de Jade: ¿Descartar toda la mano, robar 4 y ganar 3 monedas?',
      };

    default:
      return null;
  }
}

/**
 * Ejecutar el efecto opcional de un escenario de inicio de turno.
 */
export function executeTurnStartEffect(
  state: GameState,
  scenarioDefId: string,
  playerId: string,
  accepted: boolean,
  catalog?: CatalogLoadResult,
  rng?: DeterministicRng,
): { state: GameState; events: GameEvent[]; pendingChoice?: PendingChoice } {
  const events: GameEvent[] = [];
  let newState = state;

  if (!accepted) return { state: newState, events };

  const player = newState.players[playerId];

  switch (scenarioDefId) {
    case 'scenario.ur-mountains': {
      // Intercambio (spec §6.9): robar 1 carta A CAMBIO de poner 1 enemigo en
      // juego. Si no quedan cartas de Horda no hay intercambio posible.
      if (newState.hordeDeck.length === 0 || !catalog) break;
      // Robar 1 carta (D434: con Herida + reciclaje si el mazo se agota)
      const urDraw = drawCardsWithReshuffle(playerId, 1, newState, rng ?? new DeterministicRng('ur'), nextSeq);
      events.push(...urDraw.events);
      {
        const enemyCard = newState.hordeDeck[newState.hordeDeck.length - 1];
        const enemyDef = catalog.byId.get(enemyCard.definitionId);
        if (enemyDef) {
          // Crear EnemyState y anadirlo al battlefield
          // D433: aplicar auras de entrada (Brunmar -1, Roghkiller +1 orco)
          const newEnemy: EnemyState = applyEntryAuras({
            instanceId: enemyCard.instanceId,
            definitionId: enemyCard.definitionId,
            baseFortitude: enemyDef.printedFortitude ?? 1,
            wounds: 0,
            reward: enemyDef.reward ?? null,
            modifiers: [],
            isWarlord: enemyDef.type === 'WARLORD',
            isOrc: enemyDef.isOrc ?? false,
            specialIcons: enemyDef.specialIcons ?? [],
            damageDisabled: false,
          }, newState);
          newState = {
            ...newState,
            battlefield: [...newState.battlefield, newEnemy],
            hordeDeck: newState.hordeDeck.slice(0, -1),
          };
          events.push({
            type: 'ENEMY_REVEALED',
            enemyInstanceId: enemyCard.instanceId,
            definitionId: enemyCard.definitionId,
            fortitude: enemyDef.printedFortitude ?? 1,
            seq: nextSeq(),
          });
          // Si el enemigo revelado es el Señor de la Guerra, emitir WARLORD_REVEALED
          // y descartar el escenario (spec: termina al revelar Warlord)
          if (newEnemy.isWarlord) {
            events.push({
              type: 'WARLORD_REVEALED',
              warlordInstanceId: enemyCard.instanceId,
              definitionId: enemyCard.definitionId,
              seq: nextSeq(),
            });
            // D434 (spec §4.2): la moneda del ULTIMO escenario se recoge al
            // finalizar la partida — scenarioCoins se conserva para el
            // recuento (applyEvent la preserva porque warlordRevealed=true)
            events.push({
              type: 'SCENARIO_DISCARDED',
              scenarioInstanceId: newState.scenario!.instanceId,
              seq: nextSeq(),
            });
            newState = {
              ...newState,
              scenario: null,
            };
          }
          // D434 (spec §6.9 nota Brunmar): el enemigo recien puesto puede
          // quedar derrotado si su Fortaleza efectiva es 0
          for (const ev of checkFortitudeDefeats(newState, playerId, nextSeq)) {
            events.push(ev);
            newState = applyEvent(newState, ev);
          }
        }
      }
      break;
    }

    case 'scenario.eque-port': {
      // Puerto de Eque: el jugador elige qué carta descartar, luego roba 1 y +1 daño
      if (player.hand.length === 0) break;
      // Crear eleccion pendiente para que el jugador elija la carta a descartar
      const choice: PendingChoice = {
        choiceId: `eque-port-card-${nextSeq()}`,
        playerId,
        type: 'SELECT_CARD_FROM_HAND',
        prompt: 'Puerto de Eque: Elige una carta de tu mano para descartar',
        options: player.hand.map(c => c.instanceId),
        minSelections: 1,
        maxSelections: 1,
      };
      return { state: newState, events, pendingChoice: choice };
    }

    case 'scenario.jade-deposits': {
      // Spec §6.9: "descarta toda su mano y roba 4 nuevas cartas, consigue 3
      // monedas". Con mano vacía el descarte es vacuo: robar 4 + 3 monedas
      // sigue siendo válido (no es un coste, es una accion condicional).
      // Descartar toda la mano
      for (const card of player.hand) {
        events.push({
          type: 'CARD_MOVED',
          cardInstanceId: card.instanceId,
          from: 'HAND',
          to: 'WEAR_PILE',
          seq: nextSeq(),
        });
      }
      // Robar 4 cartas (D434: Herida + reciclaje si el mazo se agota)
      const jadeDraw = drawCardsWithReshuffle(playerId, 4, newState, rng ?? new DeterministicRng('jade'), nextSeq);
      events.push(...jadeDraw.events);
      // Ganar 3 monedas
      events.push({
        type: 'COINS_GAINED',
        playerId,
        amount: 3,
        seq: nextSeq(),
      });
      break;
    }

    case 'scenario.kalern-mud': {
      // Lodazal de Kalern: el jugador a la IZQUIERDA del heroe activo elige un
      // enemigo y lo devuelve al fondo de la Horda (spec §6.9). En solitario lo
      // resuelve el propio jugador (spec §4.4). Turnos en sentido horario → el
      // jugador a la izquierda es el siguiente en playerOrder.
      if (newState.battlefield.length === 0) break;
      const order = newState.playerOrder;
      const activeIdx = order.indexOf(playerId);
      const leftPlayerId = order.length > 0
        ? order[(activeIdx + 1) % order.length]
        : playerId;
      const choice: PendingChoice = {
        choiceId: `kalern-mud-enemy-${nextSeq()}`,
        playerId: leftPlayerId,
        type: 'SELECT_ENEMY',
        prompt: 'Lodazal de Kalern: Elige un enemigo para devolverlo al fondo del mazo de la Horda',
        options: newState.battlefield.map(e => e.instanceId),
        minSelections: 1,
        maxSelections: 1,
      };
      return { state: newState, events, pendingChoice: choice };
    }

    case 'scenario.tears-of-aradiel': {
      // Lágrimas de Aradiel: pagar 1 Gloria a otro héroe, jugar carta suya, devolverla, el dueño roba 1
      // El héroe objetivo se elige aleatoriamente (spec: "otro héroe elegido al azar")
      if (!accepted) break;
      if (player.glory < 1) break;
      const others = newState.playerOrder.filter(id => id !== playerId);
      if (others.length === 0) break;
      // D434: el héroe objetivo lo elige el jugador activo; solo la CARTA es
      // aleatoria (spec §6.9: "una carta de otro héroe (elegida al azar)").
      // La eleccion se resuelve en execute.ts (RESOLVE_CHOICE 'tears-hero-').
      const heroesWithCards = others.filter(id => (newState.players[id]?.hand.length ?? 0) > 0);
      if (heroesWithCards.length === 0) break;
      const heroChoice: PendingChoice = {
        choiceId: `tears-hero-${nextSeq()}`,
        playerId,
        type: 'SELECT_HERO',
        prompt: 'Lágrimas de Aradiel: elige el héroe cuya carta usarás (entregándole 1 Gloria)',
        options: heroesWithCards,
        minSelections: 1,
        maxSelections: 1,
      };
      return { state: newState, events, pendingChoice: heroChoice };
    }

    case 'scenario.ulthar-portal': {
      // Portal de Ulthar: pagar 1 Gloria o 2 Monedas, devolver Hueste al mazo y colocar trofeo
      // Verificar primero que hay trofeos disponibles
      if (player.trophies.length === 0) {
        return { state: newState, events };
      }
      // D434: no cobrar el coste si no hay Hueste valida que devolver
      const nonWarlordEnemies = newState.battlefield.filter(e => !e.isWarlord);
      if (nonWarlordEnemies.length === 0) {
        return { state: newState, events };
      }
      // D381: Permitir al jugador elegir entre Gloria o Monedas (spec: "1 ficha de Gloria o 2 Monedas")
      const canPayGlory = player.glory >= 1;
      const canPayCoins = player.coins >= 2;
      if (canPayGlory && canPayCoins) {
        // Crear eleccion pendiente para que el jugador decida el pago
        const choice: PendingChoice = {
          choiceId: `ulthar-pay-${nextSeq()}`,
          playerId,
          type: 'CONFIRM',
          prompt: 'Portal de Ulthar: paga 1 Gloria o 2 Monedas',
          options: ['glory', 'coins'],
          minSelections: 1,
          maxSelections: 1,
        };
        return { state: newState, events, pendingChoice: choice };
      } else if (canPayGlory) {
        events.push({ type: 'GLORY_LOST', playerId, amount: 1, seq: nextSeq() });
      } else if (canPayCoins) {
        events.push({ type: 'COINS_GAINED', playerId, amount: -2, seq: nextSeq() });
      } else {
        return { state: newState, events };
      }
      // Tras el pago automático, crear eleccion para elegir Hueste a devolver
      const enemyChoice: PendingChoice = {
        choiceId: `ulthar-enemy-${nextSeq()}`,
        playerId,
        type: 'SELECT_ENEMY',
        prompt: 'Portal de Ulthar: Elige una Hueste para devolverla al mazo',
        options: nonWarlordEnemies.map(e => e.instanceId),
        minSelections: 1,
        maxSelections: 1,
      };
      return { state: newState, events, pendingChoice: enemyChoice };
    }

    default:
      break;
  }

  return { state: newState, events };
}
