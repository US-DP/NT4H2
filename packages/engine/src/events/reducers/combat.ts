import type {
  CardInstance,
  GameEvent,
  GameState,
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

export function applyEnemyDefeated(
  state: GameState,
  event: Extract<GameEvent, { type: 'ENEMY_DEFEATED' }>,
): GameState {
  const enemy = state.battlefield.find(e => e.instanceId === event.enemyInstanceId);
  if (!enemy) return state;

  const player = state.players[event.defeatingPlayerId];
  if (!player) return state;
  // Si se derrot├│ a Roghkiller, eliminar sus modificadores de +1 fortaleza de los orcos
  let newBattlefield = state.battlefield.filter(e => e.instanceId !== event.enemyInstanceId);
  if (enemy.isWarlord && enemy.definitionId.includes('roghkiller')) {
    newBattlefield = newBattlefield.map(e => ({
      ...e,
      modifiers: e.modifiers.filter(m => m.sourceId !== 'roghkiller'),
    }));
  }
  return {
    ...state,
    battlefield: newBattlefield,
    warlordDefeated: state.warlordDefeated || enemy.isWarlord,
    warlordsDefeatedCount: state.warlordsDefeatedCount + (enemy.isWarlord ? 1 : 0),
    players: {
      ...state.players,
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
    modifiers: [],
    isWarlord: event.newEnemyIsWarlord,
    isOrc: event.newEnemyIsOrc,
    specialIcons: event.newEnemySpecialIcons,
    damageDisabled: false,
  }, state);
  return {
    ...state,
    battlefield: state.battlefield.map(e =>
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
  return {
    ...state,
    battlefield: state.battlefield.filter(e => e.instanceId !== event.enemyInstanceId),
    hordeDeck: event.position === 'BOTTOM'
      ? [...state.hordeDeck, enemyCard]
      : [enemyCard, ...state.hordeDeck],
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

export function applyShieldTransferred(
  state: GameState,
  event: Extract<GameEvent, { type: 'SHIELD_TRANSFERRED' }>,
): GameState {
  const fromPlayer = state.players[event.fromPlayerId];
  const toPlayer = state.players[event.toPlayerId];
  if (!fromPlayer || !toPlayer) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [event.fromPlayerId]: { ...fromPlayer, shields: Math.max(0, fromPlayer.shields - event.amount) },
      [event.toPlayerId]: { ...toPlayer, shields: toPlayer.shields + event.amount },
    },
  };
}

export function applyCancellationActivated(
  state: GameState,
  event: Extract<GameEvent, { type: 'CANCELLATION_ACTIVATED' }>,
): GameState {

  return mapPlayerState(state, event.playerId, p => ({
    ...p,
    damageCancellation: true,
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
        ? { ...e, damageDisabled: true }
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
                duration: 'UNTIL_END_OF_TURN',
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
