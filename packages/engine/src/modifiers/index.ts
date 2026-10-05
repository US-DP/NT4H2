/**
 * modifiers — pila de modificadores continuos con capas.
 *
 * Implementación del sistema de capas de modificadores (sección 51.10).
 *
 * Orden de aplicación:
 * 1. BASE_CHARACTERISTICS — Valores impresos
 * 2. FORTITUDE_MODIFIERS — Roghkiller (+1 orcos), Ruinas de Brunmar (-1 todos)
 * 3. DAMAGE_BONUS — Piedra de Amolar (+1 este turno), Flecha Corrosiva (+1 vs enemigo)
 * 4. PREVENTION — Escudo, Compañero Lobo, Carga con Escudo
 * 5. CANCELLATION — Aura Protectora (cancela todo)
 */

import type {
  GameState,
  PlayerState,
  EnemyState,
  Modifier,
  EffectDuration,
} from '@nt4h/schema';
import { nextSeq } from '../seq.js';

/**
 * Modificadores de entrada de un enemigo: auras continuas que se aplican a
 * cualquier enemigo que entre al campo, sea cual sea la via (reposicion,
 * swap de Supervivencia, trofeo del Portal de Ulthar, Montañas de Ur).
 *
 * - Ruinas de Brunmar activa → -1 Fortaleza.
 * - Roghkiller en el campo → +1 Fortaleza a orcos (excepto a si mismo).
 */
export function applyEntryAuras(enemy: EnemyState, state: GameState): EnemyState {
  const modifiers: Modifier[] = [];

  // Auras del escenario activo (ej. Ruinas de Brunmar: -1 Fortaleza a
  // todos). Genérico: los modificadores se materializaron en
  // applyScenarioEffects sobre state.scenario.auraModifiers. El reducer
  // de SCENARIO_REVEALED no tiene catálogo para reconstruirlos durante el
  // fold, así que se conserva el caso hardcodeado como fallback.
  const auras = state.scenario?.auraModifiers;
  if (auras && auras.length > 0) {
    for (const [i, aura] of auras.entries()) {
      modifiers.push({
        ...aura,
        id: `scenario-aura-${aura.sourceId}-${i}-${nextSeq()}`,
        timestamp: nextSeq(),
      });
    }
  } else if (state.scenario?.definitionId === 'scenario.brunmar-ruins') {
    modifiers.push({
      id: `scenario-brunmar-${nextSeq()}`,
      sourceId: state.scenario.instanceId,
      layer: 'FORTITUDE_MODIFIERS',
      timestamp: nextSeq(),
      duration: 'WHILE_SOURCE_ACTIVE',
      amount: -1,
    });
  }

  const roghkiller = state.battlefield.find(
    e => e.isWarlord && e.definitionId === 'warlord.roghkiller',
  );
  if (roghkiller && enemy.isOrc && enemy.instanceId !== roghkiller.instanceId) {
    modifiers.push({
      id: `roghkiller-${nextSeq()}`,
      sourceId: 'roghkiller',
      layer: 'FORTITUDE_MODIFIERS',
      timestamp: nextSeq(),
      duration: 'WHILE_SOURCE_ACTIVE',
      amount: 1,
    });
  }

  if (modifiers.length === 0) return enemy;
  return { ...enemy, modifiers: [...enemy.modifiers, ...modifiers] };
}

export const MODIFIER_LAYERS = [
  'BASE_CHARACTERISTICS',
  'FORTITUDE_MODIFIERS',
  'DAMAGE_BONUS',
  'ENEMY_OUTGOING_DAMAGE',
  'PREVENTION',
  'CANCELLATION',
  'MARKET_COST',
] as const;

export type ModifierLayer = typeof MODIFIER_LAYERS[number];

// (applyModifiers/applyLayer retirados: su única capa real materializaba
//  el campo efectivo `effectiveFortitude`, un caché stale — los lectores
//  canónicos usan getEffectiveFortitude, que calcula base+mods al vuelo)

/**
 * Obtener la fortaleza efectiva de un enemigo (base + modificadores).
 */
export function getEffectiveFortitude(enemy: EnemyState, _state: GameState): number {
  let fortitude = enemy.baseFortitude;
  for (const mod of enemy.modifiers) {
    if (mod.layer !== 'FORTITUDE_MODIFIERS') continue;
    fortitude += mod.amount;
  }
  // D373: Permitir fortaleza 0 (Ruinas de Brunmar puede reducir a 0)
  return Math.max(0, fortitude);
}

/**
 * Obtener el bonus de dano de un enemigo (Flecha Corrosiva, etc.).
 * Suma todos los modificadores DAMAGE_BONUS del enemigo.
 */
export function getEnemyDamageBonus(enemy: EnemyState): number {
  let bonus = 0;
  for (const mod of enemy.modifiers) {
    if (mod.layer === 'DAMAGE_BONUS') bonus += mod.amount;
  }
  return bonus;
}

/**
 * Obtener el bonus de dano saliente de un enemigo (Puerto de Eque, etc.).
 * Suma todos los modificadores ENEMY_OUTGOING_DAMAGE del enemigo.
 */
export function getEnemyOutgoingDamageBonus(enemy: EnemyState): number {
  let bonus = 0;
  for (const mod of enemy.modifiers) {
    if (mod.layer === 'ENEMY_OUTGOING_DAMAGE') bonus += mod.amount;
  }
  return bonus;
}

/**
 * Calcular el daño efectivo de una carta (base + modificadores de DAMAGE_BONUS).
 */
export function effectiveDamage(
  baseDamage: number,
  cardName: string,
  player: PlayerState,
  _targetEnemyId?: string,
): number {
  let damage = baseDamage;
  for (const mod of player.modifiers) {
    if (mod.layer !== 'DAMAGE_BONUS') continue;
    // Filtrar por nombre de carta si el modificador lo especifica
    if (mod.filter?.name && mod.filter.name !== cardName) continue;
    damage += mod.amount;
  }
  return Math.max(0, damage);
}

/**
 * Calcular el daño efectivo del ataque de la Horda después de prevención.
 */
export function effectiveHordeDamage(
  baseDamage: number,
  player: PlayerState,
): number {
  // Capa CANCELLATION: si hay cancelación activa, el daño es 0
  if (player.damageCancellation) {
    return 0;
  }

  // Capa PREVENTION: restar la prevención
  let damage = baseDamage - player.prevention;
  if (player.shields > 0) {
    damage -= player.shields;
  }

  return Math.max(0, damage);
}

/**
 * Calcular el daño de un enemigo específico después de prevención.
 */
export function effectiveEnemyDamage(
  enemy: EnemyState,
  baseDamage: number,
  player: PlayerState,
): number {
  // Si el enemigo tiene el daño deshabilitado, no causa daño
  if (enemy.damageDisabled) {
    return 0;
  }

  // Capa PREVENTION: si hay escudos, restar
  let damage = baseDamage;
  if (player.shields > 0) {
    const absorbed = Math.min(player.shields, damage);
    damage -= absorbed;
  }

  return Math.max(0, damage);
}

/**
 * Expirar modificadores que han terminado su duración.
 * Se llama al final del turno o después del ataque de la Horda.
 */
export function expireModifiers(
  state: GameState,
  trigger: 'END_OF_TURN' | 'HORDE_ATTACK_END',
): GameState {
  const players: Record<string, PlayerState> = {};
  for (const [id, player] of Object.entries(state.players)) {
    const p = player as PlayerState;
    const remainingModifiers = p.modifiers.filter(mod => {
      if (mod.duration === 'UNTIL_END_OF_TURN' && trigger === 'END_OF_TURN') {
        return false;
      }
      if (mod.duration === 'HORDE_ATTACK' && trigger === 'HORDE_ATTACK_END') {
        return false;
      }
      if (mod.duration === 'NEXT_HORDE_ATTACK' && trigger === 'HORDE_ATTACK_END') {
        return false;
      }
      return true;
    });

    // Reset prevención y escudos si termina el ataque de la Horda.
    // Las defensas con duración declarada más larga que el asalto
    // (UNTIL_END_OF_TURN/PERMANENT/WHILE_SOURCE_ACTIVE) sobreviven —
    // antes el campo duration del efecto era un no-op.
    const newPlayer: PlayerState = {
      ...p,
      modifiers: remainingModifiers,
    };
    if (trigger === 'HORDE_ATTACK_END') {
      const survivesHordeEnd = (d?: PlayerState['preventionExpiry']) =>
        d === 'UNTIL_END_OF_TURN' || d === 'PERMANENT' || d === 'WHILE_SOURCE_ACTIVE';
      if (!survivesHordeEnd(newPlayer.preventionExpiry)) {
        newPlayer.prevention = 0;
        newPlayer.preventionExpiry = undefined;
      }
      newPlayer.shields = 0;
      if (!survivesHordeEnd(newPlayer.cancelExpiry)) {
        newPlayer.damageCancellation = false;
        newPlayer.cancelExpiry = undefined;
      }
      // Armadura con duración de asalto (INSTANT/HORDE_ATTACK/
      // NEXT_HORDE_ATTACK) caduca aquí; la de turno/larga se conserva.
      const ae = newPlayer.armorExpiry;
      if (ae === 'INSTANT' || ae === 'HORDE_ATTACK' || ae === 'NEXT_HORDE_ATTACK') {
        newPlayer.armor = 0;
        newPlayer.armorExpiry = undefined;
      }
    }

    players[id] = newPlayer;
  }

  // Expirar modificadores de enemigos
  const battlefield = state.battlefield.map((enemy: EnemyState) => {
    const remainingModifiers = enemy.modifiers.filter(mod => {
      if (mod.duration === 'HORDE_ATTACK' && trigger === 'HORDE_ATTACK_END') {
        return false;
      }
      if (mod.duration === 'NEXT_HORDE_ATTACK' && trigger === 'HORDE_ATTACK_END') {
        return false;
      }
      // UNTIL_END_OF_TURN en enemigos (ej. Puerto de Eque) expira al final del turno
      if (mod.duration === 'UNTIL_END_OF_TURN' && trigger === 'END_OF_TURN') {
        return false;
      }
      // WHILE_SOURCE_ACTIVE: la limpieza se maneja manualmente cuando la fuente
      // es derrotada/descartada (resolver.ts, scenarios/index.ts, applyEvent.ts).
      // No eliminar automáticamente aquí porque sourceId puede ser un escenario,
      // un warlord, o un string fijo como 'roghkiller'.
      return true;
    });

    const newEnemy: EnemyState = {
      ...enemy,
      modifiers: remainingModifiers,
    };
    // damageDisabled: respetar la duración declarada del efecto. Eventos
    // antiguos sin duración = 'HORDE_ATTACK' (se limpiaban aquí).
    const disabledDur = newEnemy.damageDisabledDuration ?? 'HORDE_ATTACK';
    const clearsAtHordeEnd = disabledDur === 'HORDE_ATTACK' || disabledDur === 'NEXT_HORDE_ATTACK';
    if (trigger === 'HORDE_ATTACK_END' && clearsAtHordeEnd) {
      newEnemy.damageDisabled = false;
      newEnemy.damageDisabledDuration = undefined;
    }
    if (trigger === 'END_OF_TURN' && disabledDur === 'UNTIL_END_OF_TURN') {
      newEnemy.damageDisabled = false;
      newEnemy.damageDisabledDuration = undefined;
    }
    return newEnemy;
  });

  return {
    ...state,
    players,
    battlefield,
  };
}

// ============================================================================
// Limpiezas de ciclo de vida (event-sourced vía EFFECTS_EXPIRED)
//
// Estas transformaciones son deterministas dado el estado y el scope, así que
// el reducer de applyEvent puede reproducirlas exactamente en el fold del
// eventLog. El camino directo (phases/engine.ts) usa las MISMAS funciones para
// que no haya deriva entre ejecución y replay.
// ============================================================================

/** Limpieza al terminar el ataque de la Horda: defensas consumidas, daño de
 *  enemigos rehabilitado y ventanas de reacción cerradas. */
export function cleanupHordeAttackEnd(state: GameState): GameState {
  const expired = expireModifiers(state, 'HORDE_ATTACK_END');
  return {
    ...expired,
    pendingChoices: expired.pendingChoices.filter(c => c.type !== 'REACTION_WINDOW'),
  };
}

/** Limpieza del Restablecimiento: defensas del héroe activo, daño de enemigos
 *  rehabilitado, estados UNTIL_END_OF_TURN caducados, heridas temporales de
 *  enemigos descartadas y modificadores de ataque expirados (spec §3.6). */
export function cleanupRestoration(state: GameState): GameState {
  const player = state.players[state.activePlayerId];
  // Solo sobreviven al Restablecimiento las defensas declaradas
  // PERMANENT o WHILE_SOURCE_ACTIVE; el resto caduca al terminar el turno.
  const survivesRestoration = (d?: EffectDuration) =>
    d === 'PERMANENT' || d === 'WHILE_SOURCE_ACTIVE';
  const players = player
    ? {
        ...state.players,
        [state.activePlayerId]: {
          ...player,
          prevention: survivesRestoration(player.preventionExpiry) ? player.prevention : 0,
          preventionExpiry: survivesRestoration(player.preventionExpiry) ? player.preventionExpiry : undefined,
          damageCancellation: survivesRestoration(player.cancelExpiry) ? player.damageCancellation : false,
          cancelExpiry: survivesRestoration(player.cancelExpiry) ? player.cancelExpiry : undefined,
          interceptedBy: null,
          shields: 0,
          armor: survivesRestoration(player.armorExpiry) ? player.armor : 0,
          armorExpiry: survivesRestoration(player.armorExpiry) ? player.armorExpiry : undefined,
        },
      }
    : state.players;
  const battlefield = state.battlefield.map(e => ({
    ...e,
    // El Restablecimiento libera el disable salvo que sea permanente o
    // ligado a la fuente (contenido custom puede declarar esas duraciones).
    damageDisabled:
      e.damageDisabledDuration === 'PERMANENT' || e.damageDisabledDuration === 'WHILE_SOURCE_ACTIVE'
        ? e.damageDisabled
        : false,
    damageDisabledDuration:
      e.damageDisabledDuration === 'PERMANENT' || e.damageDisabledDuration === 'WHILE_SOURCE_ACTIVE'
        ? e.damageDisabledDuration
        : undefined,
    statuses: (e.statuses ?? []).filter(s => s.duration !== 'UNTIL_END_OF_TURN'),
    wounds: e.specialIcons?.includes('TEMPORARY_WOUNDS') ? 0 : e.wounds,
    modifiers: e.modifiers.filter(
      m => m.duration !== 'UNTIL_END_OF_TURN'
        && m.duration !== 'HORDE_ATTACK'
        && m.duration !== 'NEXT_HORDE_ATTACK',
    ),
  }));
  return { ...state, players, battlefield };
}

/** Limpieza de fin de turno: modificadores UNTIL_END_OF_TURN (Piedra de
 *  Amolar, Puerto de Eque, Flecha Corrosiva) y flags de cartas de Apoyo
 *  prestadas del jugador que termina. */
export function cleanupTurnEnd(state: GameState): GameState {
  const expired = expireModifiers(state, 'END_OF_TURN');
  const player = expired.players[expired.activePlayerId];
  if (!player) return expired;
  return {
    ...expired,
    players: {
      ...expired.players,
      [expired.activePlayerId]: {
        ...player,
        borrowedSupportCardIds: [],
        supportCardUsedThisTurn: false,
      },
    },
  };
}

/**
 * Revertir los efectos continuos de un escenario al descartarlo.
 *
 * No necesita el catálogo: el ledger ``marketCostSources`` y los
 * ``sourceId`` de modificadores/aura bastan. Es la MISMA transformación
 * que el reducer de SCENARIO_DISCARDED (fold) y la que usa
 * clearScenarioEffects (camino directo) → live y replay convergen.
 */
export function revertScenarioEffects(state: GameState, instanceId: string): GameState {
  const sources = { ...(state.marketCostSources ?? {}) };
  const delta = sources[instanceId] ?? 0;
  if (instanceId in sources) delete sources[instanceId];
  return {
    ...state,
    ignoreCoinRewards: false,
    ignoreGloryRewards: false,
    marketCostModifier: state.marketCostModifier - delta,
    marketCostSources: sources,
    battlefield: state.battlefield.map(e => ({
      ...e,
      modifiers: e.modifiers.filter(m => m.sourceId !== instanceId),
    })),
  };
}
