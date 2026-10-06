/** Reposicion del campo de batalla (nuevos enemigos/Señores). */

import type {
  EnemyState,
  GameEvent,
  GameState,
} from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import type { DeterministicRng } from '../../rng/index.js';
import { applyEvent, checkFortitudeDefeats } from '../../events/applyEvent.js';
import { applyEntryAuras } from '../../modifiers/index.js';
import { applyScenarioEffects, clearScenarioEffects } from '../../scenarios/index.js';
import { nextSeq } from '../../seq.js';

export function processBattlefieldReplenishment(
  state: GameState,
  _rng: DeterministicRng,
  catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  // D354: Si el campo está vacío, primero hacer transición de escenario
  // (descartar el actual y revelar uno nuevo), y LUEGO reponer enemigos.
  // La spec dice: cuando el campo queda vacío, se descarta el escenario actual
  // y se revela uno nuevo antes de robar nuevos enemigos.
  if (state.battlefield.length === 0 && state.scenarioDeck.length > 0 && !state.warlordRevealed) {
    // Descartar escenario actual
    if (state.scenario) {
      // Solitario: transferir scenarioCoins al jugador antes de descartar (spec §4.1)
      if (state.mode === 'SOLO' && state.scenarioCoins > 0) {
        events.push({
          type: 'COINS_GAINED',
          playerId: state.activePlayerId,
          amount: state.scenarioCoins,
          seq: nextSeq(),
        });
      }
      events.push({
        type: 'SCENARIO_DISCARDED',
        scenarioInstanceId: state.scenario.instanceId,
        seq: nextSeq(),
      });
      // Limpiar efectos continuos del escenario descartado
      const clearResult = clearScenarioEffects(state, state.scenario.definitionId, catalog);
      state = clearResult.state;
      events.push(...clearResult.events);
    }

    // Revelar nuevo escenario
    const newScenario = state.scenarioDeck[0];
    events.push({
      type: 'SCENARIO_REVEALED',
      scenarioInstanceId: newScenario.instanceId,
      definitionId: newScenario.definitionId,
      seq: nextSeq(),
    });

    state = {
      ...state,
      scenario: {
        instanceId: newScenario.instanceId,
        definitionId: newScenario.definitionId,
        ownerId: newScenario.ownerId,
        zone: 'SCENARIO_ACTIVE' as const,
      } as any,
      scenarioDeck: state.scenarioDeck.slice(1),
      scenarioCoins: state.mode === 'SOLO' ? 1 : 0,
    };

    // Aplicar efectos del nuevo escenario a los enemigos actuales (campo vacío = no hay)
    const scenarioResult = applyScenarioEffects(state, newScenario.definitionId, catalog);
    state = scenarioResult.state;
    events.push(...scenarioResult.events);
  }

  // Reponer enemigos segun especificacion 3.6.2:
  // 0 enemigos → robar 3
  // 1-2 enemigos → robar 1
  // 3 enemigos → no robar
  // El Señor de la Guerra cuenta como un enemigo normal para la reposición
  const currentCount = state.battlefield.length;
  let needed: number;
  if (currentCount === 0) {
    needed = 3;
  } else if (currentCount <= 2) {
    needed = 1;
  } else {
    needed = 0;
  }

  let newHordeDeck = [...state.hordeDeck];
  let newBattlefield = [...state.battlefield];

  for (let i = 0; i < needed && newHordeDeck.length > 0; i++) {
    // Robar desde la parte inferior del mazo (especificacion 3.2.5)
    const enemyCard = newHordeDeck[newHordeDeck.length - 1];
    newHordeDeck = newHordeDeck.slice(0, -1);

    const enemyDef = catalog.byId.get(enemyCard.definitionId);
    if (!enemyDef) continue;

    const enemyBase: EnemyState = {
      instanceId: enemyCard.instanceId,
      definitionId: enemyCard.definitionId,
      baseFortitude: enemyDef.printedFortitude ?? 1,
      wounds: 0,
      reward: enemyDef.reward ?? null,
      trophyGlory: enemyDef.trophyGlory ?? 0,
      modifiers: [],
      isWarlord: enemyDef.type === 'WARLORD',
      isOrc: enemyDef.isOrc ?? false,
      specialIcons: enemyDef.specialIcons ?? [],
      damageDisabled: false,
    };

    // Auras de entrada: Ruinas de Brunmar (-1) y Roghkiller (+1 a orcos).
    // D402: el campo provisional incluye enemigos revelados en
    // iteraciones previas del bucle — por eso se pasa newBattlefield.
    const enemy = applyEntryAuras(enemyBase, { ...state, battlefield: newBattlefield });

    newBattlefield.push(enemy);

    events.push({
      type: 'ENEMY_REVEALED',
      enemyInstanceId: enemy.instanceId,
      definitionId: enemy.definitionId,
      fortitude: enemy.baseFortitude,
      // EnemyState completo: el reducer lo inserta en el campo durante el
      // fold del eventLog (auras de entrada ya incluidas en `enemy`).
      enemy,
      seq: nextSeq(),
    });

    // Si es un Señor de la Guerra, marcarlo como revelado
    if (enemy.isWarlord) {
      events.push({
        type: 'WARLORD_REVEALED',
        warlordInstanceId: enemy.instanceId,
        definitionId: enemy.definitionId,
        seq: nextSeq(),
      });
      // Especificacion 3.4: al entrar el Señor de la Guerra,
      // el Escenario activo se descarta y no se reemplaza
      if (state.scenario) {
        // D434 (spec §4.2): la moneda del ULTIMO escenario se recoge al
        // finalizar la partida, no ahora — scenarioCoins se conserva para
        // el recuento (applyEvent la preserva porque warlordRevealed=true)
        events.push({
          type: 'SCENARIO_DISCARDED',
          scenarioInstanceId: state.scenario.instanceId,
          seq: nextSeq(),
        });
        // Limpiar efectos continuos del escenario descartado
        const clearResult = clearScenarioEffects(state, state.scenario.definitionId, catalog);
        state = clearResult.state;
        // Marcar escenario como descartado para que el filtro de modificadores funcione
        state = { ...state, scenario: null };
      }
      // Pericia de Roghkiller: +1 fortaleza a cada orco ya en el campo
      // D374: Solo excluir al propio Roghkiller, no a todos los Warlords orcos
      // D428: identificar por definitionId estable
      if (enemy.definitionId === 'warlord.roghkiller') {
        newBattlefield = newBattlefield.map(e => {
          if (e.isOrc && e.instanceId !== enemy.instanceId) {
            return {
              ...e,
              modifiers: [
                ...e.modifiers,
                {
                  id: `roghkiller-${nextSeq()}`,
                  sourceId: 'roghkiller',
                  layer: 'FORTITUDE_MODIFIERS',
                  timestamp: nextSeq(),
                  duration: 'WHILE_SOURCE_ACTIVE' as const,
                  amount: 1,
                },
              ],
            };
          }
          return e;
        });
      }
    }
  }

  // D434 (spec §6.9 nota Brunmar + caso limite 9): un enemigo que entra bajo
  // Ruinas de Brunmar con Fortaleza efectiva 0 queda derrotado inmediatamente
  {
    let checkState: GameState = { ...state, hordeDeck: newHordeDeck, battlefield: newBattlefield };
    for (const ev of checkFortitudeDefeats(checkState, state.activePlayerId, nextSeq)) {
      events.push(ev);
      checkState = applyEvent(checkState, ev);
    }
    // Propagar TODOS los campos (players, warlordDefeated, warlordsDefeatedCount)
    state = checkState;
    newBattlefield = checkState.battlefield;
  }

  events.push({
    type: 'PHASE_CHANGED',
    phase: 'SCENARIO_TRANSITION',
    seq: nextSeq(),
  });

  return {
    state: {
      ...state,
      hordeDeck: newHordeDeck,
      battlefield: newBattlefield.map(e => ({
        ...e,
        // Limpiar modificadores de escenario (Brunmar) si el escenario fue descartado
        modifiers: state.scenario === null
          ? e.modifiers.filter(m => !m.id?.startsWith('scenario-'))
          : e.modifiers,
      })),
      phase: 'SCENARIO_TRANSITION',
    },
    events,
  };
}

// ============================================================================
