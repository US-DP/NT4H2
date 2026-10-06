import type {
  CardInstance,
  GameEvent,
  GameState,
  Modifier,
  Zone,
} from '@nt4h/schema';

import { applyEntryAuras } from '../../modifiers/index.js';

import { mapPlayerState } from '../applyEvent.js';



export function applyDamageDealt(
  state: GameState,
  event: Extract<GameEvent, { type: 'DAMAGE_DEALT' }>,
): GameState {

  return {
    ...state,
    battlefield: state.battlefield.map(e =>
      e.instanceId === event.targetId
        ? { ...e, wounds: e.wounds + event.amount }
        : e
    ),
  };
}

export function applyWoundPlaced(
  state: GameState,
  event: Extract<GameEvent, { type: 'WOUND_PLACED' }>,
): GameState {

  return {
    ...state,
    battlefield: state.battlefield.map(e =>
      e.instanceId === event.enemyInstanceId
        ? { ...e, wounds: e.wounds + event.amount }
        : e
    ),
  };
}

export function applyWoundHealed(
  state: GameState,
  event: Extract<GameEvent, { type: 'WOUND_HEALED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    wounds: Math.max(0, p.wounds - event.amount),
  }));
}

/** Revertir el delta de coste de mercado aportado por una fuente que
 *  abandona el campo (enemigo derrotado/intercambiado/devuelto). Los
 *  MODIFY_MARKET_COST de cartas de la Horda son WHILE_SOURCE_ACTIVE:
 *  sin esto, el precio quedaba alterado para siempre. */
function revertMarketCostSource(state: GameState, sourceId: string): GameState {
  const delta = state.marketCostSources?.[sourceId];
  if (!delta) return state;
  const sources = { ...(state.marketCostSources ?? {}) };
  delete sources[sourceId];
  return {
    ...state,
    marketCostModifier: state.marketCostModifier - delta,
    marketCostSources: sources,
  };
}

/** Un enemigo abandona el campo (derrotado/devuelto/intercambiado):
 *  sus modificadores WHILE_SOURCE_ACTIVE sobre otros enemigos y sobre
 *  jugadores deben morir con él — antes solo se limpiaba el caso
 *  especial 'roghkiller'; un aura de carta custom quedaba huérfana y
 *  eterna. Genérico: purgar por sourceId + duración WHILE_SOURCE_ACTIVE. */
function purgeWhileSourceActive(state: GameState, sourceId: string): GameState {
  const strip = (mods: Modifier[]) =>
    mods.filter(m => !(m.duration === 'WHILE_SOURCE_ACTIVE' && m.sourceId === sourceId));
  const players: GameState['players'] = {};
  for (const [id, p] of Object.entries(state.players)) {
    players[id] = { ...p, modifiers: strip(p.modifiers) };
  }
  return {
    ...state,
    players,
    battlefield: state.battlefield.map(e => ({ ...e, modifiers: strip(e.modifiers) })),
  };
}

export function applyEnemyDefeated(
  state: GameState,
  event: Extract<GameEvent, { type: 'ENEMY_DEFEATED' }>,
): GameState {
  const enemy = state.battlefield.find(e => e.instanceId === event.enemyInstanceId);
  if (!enemy) return state;

  // La fuente que abandona arrastra sus auras WHILE_SOURCE_ACTIVE
  const purged = purgeWhileSourceActive(state, event.enemyInstanceId);
  const player = purged.players[event.defeatingPlayerId];
  if (!player) return state;
  // Si se derrot├│ a Roghkiller, eliminar sus modificadores de +1 fortaleza de los orcos
  let newBattlefield = purged.battlefield.filter(e => e.instanceId !== event.enemyInstanceId);
  if (enemy.isWarlord && enemy.definitionId.includes('roghkiller')) {
    newBattlefield = newBattlefield.map(e => ({
      ...e,
      modifiers: e.modifiers.filter(m => m.sourceId !== 'roghkiller'),
    }));
  }
  const reverted = revertMarketCostSource(purged, event.enemyInstanceId);
  return {
    ...reverted,
    battlefield: newBattlefield,
    warlordDefeated: state.warlordDefeated || enemy.isWarlord,
    warlordsDefeatedCount: state.warlordsDefeatedCount + (enemy.isWarlord ? 1 : 0),
    players: {
      ...purged.players,
      [event.defeatingPlayerId]: {
        ...player,
        // D397: Guardar instanceId (no definitionId) seg├║n el schema
        trophies: [...player.trophies, event.enemyInstanceId],
        coins: player.coins + event.reward.coins,
        glory: player.glory + event.reward.glory,
      },
    },
  };
}

export function applyHordeAttacked(
  state: GameState,
  _event: Extract<GameEvent, { type: 'HORDE_ATTACKED' }>,
): GameState {
  // El dano ya fue procesado como CARDS_LOST por el motor.
  // La intercepci├│n de Val├¿rys queda consumida al resolver el ataque
  // (processHordeAttack la limpia en el camino directo ÔÇö idempotente).
  const target = state.players[state.activePlayerId];
  if (!target || target.interceptedBy == null) return state;
  return mapPlayerState(state, state.activePlayerId, p => ({
    ...p,
    interceptedBy: null,
  }));
}

export function applyEnemySwapped(
  state: GameState,
  event: Extract<GameEvent, { type: 'ENEMY_SWAPPED' }>,
): GameState {
  // El enemigo viejo vuelve al FONDO del mazo de la Horda, el nuevo entra al campo
  const oldEnemy = state.battlefield.find(e => e.instanceId === event.oldEnemyInstanceId);
  if (!oldEnemy) return state;
  // El enemigo que sale pierde sus auras WHILE_SOURCE_ACTIVE
  const purged = purgeWhileSourceActive(state, event.oldEnemyInstanceId);
  const oldEnemyCard: CardInstance = {
    instanceId: oldEnemy.instanceId,
    definitionId: oldEnemy.definitionId,
    ownerId: 'horde',
    zone: 'HORDE_DECK',
  };
  const newEnemy = applyEntryAuras({
    instanceId: event.newEnemyInstanceId,
    definitionId: event.newEnemyDefinitionId,
    baseFortitude: event.newEnemyFortitude,
    wounds: 0,
    reward: event.newEnemyReward,
    trophyGlory: event.newEnemyTrophyGlory ?? 0,
    modifiers: [],
    isWarlord: event.newEnemyIsWarlord,
    isOrc: event.newEnemyIsOrc,
    specialIcons: event.newEnemySpecialIcons,
    damageDisabled: false,
  }, purged);
  const reverted = revertMarketCostSource(purged, event.oldEnemyInstanceId);
  return {
    ...reverted,
    battlefield: purged.battlefield.map(e =>
      e.instanceId === event.oldEnemyInstanceId ? newEnemy : e
    ),
    hordeDeck: [
      ...state.hordeDeck.filter(c => c.instanceId !== event.newEnemyInstanceId),
      oldEnemyCard,
    ],
  };
}

export function applyEnemyReturnedToHorde(
  state: GameState,
  event: Extract<GameEvent, { type: 'ENEMY_RETURNED_TO_HORDE' }>,
): GameState {
  const enemy = state.battlefield.find(e => e.instanceId === event.enemyInstanceId);
  if (!enemy) return state;
  const enemyCard: CardInstance = {
    instanceId: enemy.instanceId,
    definitionId: enemy.definitionId,
    ownerId: 'horde',
    zone: 'HORDE_DECK',
  };
  // El enemigo devuelto pierde sus auras WHILE_SOURCE_ACTIVE
  const purged = purgeWhileSourceActive(state, event.enemyInstanceId);
  const reverted = revertMarketCostSource(purged, event.enemyInstanceId);
  return {
    ...reverted,
    battlefield: purged.battlefield.filter(e => e.instanceId !== event.enemyInstanceId),
    // TOP = encima del mazo (robo inmediato); BOTTOM = fondo. Antes se
    // ignoraba event.position y siempre iba al fondo.
    hordeDeck: event.position === 'TOP'
      ? [enemyCard, ...reverted.hordeDeck]
      : [...reverted.hordeDeck, enemyCard],
  };
}

export function applyDamageIntercepted(
  state: GameState,
  event: Extract<GameEvent, { type: 'DAMAGE_INTERCEPTED' }>,
): GameState {
  // Valerys: interceptar dano de otro heroe
  // El interceptor recibe el dano como perdida de cartas y gana 1 Gloria
  const interceptor = state.players[event.interceptorPlayerId];
  if (!interceptor) return state;
  if (event.amount <= 0) {
    // Registrar intercepcion: el dano real se aplicara en processHordeAttack
    return mapPlayerState(state, event.originalTargetPlayerId, p => ({
      ...p,
      interceptedBy: event.interceptorPlayerId,
      glory: p.glory,
    }));
  }
  // Aplicar dano como perdida de cartas (la Gloria ya se otorgo en valerysAbility)
  const lost = interceptor.abilityDeck.slice(0, event.amount).map(c => c.instanceId);
  return mapPlayerState(state, event.interceptorPlayerId, p => ({
    ...p,
    abilityDeck: p.abilityDeck.slice(lost.length),
    wearPile: [...p.wearPile, ...p.abilityDeck.slice(0, lost.length).map(c => ({ ...c, zone: 'WEAR_PILE' as Zone }))],
  }));
}

export function applyPreventionApplied(
  state: GameState,
  event: Extract<GameEvent, { type: 'PREVENTION_APPLIED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    prevention: p.prevention + event.amount,
    // Eventos antiguos sin duration = 'HORDE_ATTACK' (comportamiento
    // previo: la prevención moría al terminar el ataque de la Horda).
    preventionExpiry: event.duration ?? 'HORDE_ATTACK',
  }));
}

export function applyShieldPlaced(
  state: GameState,
  event: Extract<GameEvent, { type: 'SHIELD_PLACED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    shields: p.shields + event.amount,
  }));
}

export function applyCancellationActivated(
  state: GameState,
  event: Extract<GameEvent, { type: 'CANCELLATION_ACTIVATED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    damageCancellation: true,
    cancelExpiry: event.duration ?? 'HORDE_ATTACK',
  }));
}

export function applyEnemyDamageDisabled(
  state: GameState,
  event: Extract<GameEvent, { type: 'ENEMY_DAMAGE_DISABLED' }>,
): GameState {

  return {
    ...state,
    battlefield: state.battlefield.map(e =>
      e.instanceId === event.enemyInstanceId
        // Eventos antiguos sin duration = 'HORDE_ATTACK' (limpieza al
        // final del ataque de la Horda — comportamiento previo).
        ? {
            ...e,
            damageDisabled: true,
            damageDisabledDuration: event.duration ?? 'HORDE_ATTACK',
          }
        : e
    ),
  };
}

export function applyVulnerabilityApplied(
  state: GameState,
  event: Extract<GameEvent, { type: 'VULNERABILITY_APPLIED' }>,
): GameState {

  return {
    ...state,
    battlefield: state.battlefield.map(e =>
      e.instanceId === event.enemyInstanceId
        ? {
            ...e,
            modifiers: [
              ...e.modifiers,
              {
                id: `vuln-${event.seq}`,
                sourceId: event.enemyInstanceId,
                layer: 'DAMAGE_BONUS',
                timestamp: event.seq,
                // El efecto schema exige `duration`; `INSTANT` no tiene
                // sentido en un modificador persistente → cae al default.
                duration: event.duration === 'INSTANT' || event.duration == null
                  ? 'UNTIL_END_OF_TURN'
                  : event.duration,
                amount: event.bonus,
                targetId: event.enemyInstanceId,
              },
            ],
          }
        : e
    ),
  };
}

export function applyArmorGranted(
  state: GameState,
  event: Extract<GameEvent, { type: 'ARMOR_GRANTED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    armor: (p.armor ?? 0) + event.amount,
    // La armadura es un pool escalar con un solo expiry: si ya había
    // armadura PERMANENT no debe caducar por un grant temporal, y un grant
    // PERMANENT nuevo tampoco — PERMANENT domina; si no, gana la última.
    armorExpiry: (p.armorExpiry === 'PERMANENT' || event.duration === 'PERMANENT')
      ? 'PERMANENT'
      : event.duration ?? p.armorExpiry ?? 'UNTIL_END_OF_TURN',
  }));
}

export function applyBlockGranted(
  state: GameState,
  event: Extract<GameEvent, { type: 'BLOCK_GRANTED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    blockNext: (p.blockNext ?? 0) + event.amount,
  }));
}

export function applyBlockConsumed(
  state: GameState,
  event: Extract<GameEvent, { type: 'BLOCK_CONSUMED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    blockNext: 0,
  }));
}

export function applyHeroWounded(
  state: GameState,
  event: Extract<GameEvent, { type: 'HERO_WOUNDED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    wounds: event.woundCount,
  }));
}

export function applyEnemySpawned(
  state: GameState,
  event: Extract<GameEvent, { type: 'ENEMY_SPAWNED' }>,
): GameState {
  // La carta sale del mazo de la Horda y entra al campo (con auras de
  // entrada, igual que ENEMY_SWAPPED ÔÇö p.ej. Ruinas de Brunmar)
  const spawned = applyEntryAuras({
    instanceId: event.enemyInstanceId,
    definitionId: event.enemyDefinitionId,
    baseFortitude: event.enemyFortitude,
    wounds: 0,
    reward: event.enemyReward,
    trophyGlory: event.enemyTrophyGlory ?? 0,
    modifiers: [],
    isWarlord: event.enemyIsWarlord,
    isOrc: event.enemyIsOrc,
    specialIcons: event.enemySpecialIcons,
    damageDisabled: false,
    statuses: [],
  }, state);
  return {
    ...state,
    battlefield: [...state.battlefield, spawned],
    hordeDeck: state.hordeDeck.filter(c => c.instanceId !== event.enemyInstanceId),
  };
}

export function applyEnemyRevealed(
  state: GameState,
  event: Extract<GameEvent, { type: 'ENEMY_REVEALED' }>,
): GameState {
  // El enemigo entra al campo y sale del mazo de la Horda. El evento
  // transporta el EnemyState completo (recompensa, auras de entradaÔÇª) para
  // que el fold del eventLog sea bit-id├®ntico (sin catalogo ni seq).
  // Idempotente: el camino directo ya lo insert├│ antes de emitir.
  const hordeDeck = state.hordeDeck.filter(c => c.instanceId !== event.enemyInstanceId);
  const alreadyInField = state.battlefield.some(e => e.instanceId === event.enemyInstanceId);
  if (alreadyInField || !event.enemy) {
    return hordeDeck.length === state.hordeDeck.length ? state : { ...state, hordeDeck };
  }
  return {
    ...state,
    battlefield: [...state.battlefield, { ...event.enemy }],
    hordeDeck,
  };
}

export function applyWarlordRevealed(
  state: GameState,
  _event: Extract<GameEvent, { type: 'WARLORD_REVEALED' }>,
): GameState {

  return { ...state, warlordRevealed: true };
}

export function applyTrophyRemoved(
  state: GameState,
  event: Extract<GameEvent, { type: 'TROPHY_REMOVED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    trophies: p.trophies.filter(t => t !== event.trophyInstanceId),
  }));
}
