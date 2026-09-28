/** Fin de turno: desgaste, prestamos de Apoyo, limpiezas. */

import type {
  GameEvent,
  GameState,
  Zone,
} from '@nt4h/schema';
import type { DeterministicRng } from '../../rng/index.js';
import { mapPlayerState } from '../../events/applyEvent.js';
import { cleanupTurnEnd } from '../../modifiers/index.js';
import { nextSeq } from '../../seq.js';

export function processTurnEnd(
  state: GameState,
  _rng: DeterministicRng,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  events.push({
    type: 'TURN_ENDED',
    playerId: state.activePlayerId,
    seq: nextSeq(),
  });

  // La expiración de modificadores UNTIL_END_OF_TURN (Piedra de Amolar,
  // Puerto de Eque, Flecha Corrosiva) y el reseteo de flags de Apoyo se hacen
  // via cleanupTurnEnd al final — mismo helper que el reducer de EFFECTS_EXPIRED.
  const player = state.players[state.activePlayerId];
  if (player) {
    // D349/D363: Devolver cartas robadas de Apoyo según spec §4.2:
    // - Carta USADA → devolver al fondo de su mazo de origen (sea cual sea
    //   su zona: Desgaste, frente al jugador, etc.)
    // - Carta NO USADA (sigue en mano) → se descarta. Es carta del mazo de
    //   Apoyo: NO va al Desgaste del jugador (contaminaría su mazo al
    //   reciclar). Sale del juego hacia el Desgaste del héroe de Apoyo.
    const borrowedIds = player.borrowedSupportCardIds ?? [];
    if (borrowedIds.length > 0) {
      const usedDeckIndex = player.supportDeckIndexUsedThisTurn ?? null;
      // Cartas USADAS: en Desgaste o frente al jugador (Trampa) → al fondo
      // de su mazo de Apoyo de origen
      const usedBorrowed = usedDeckIndex !== null
        ? [
            ...player.wearPile.filter(c => borrowedIds.includes(c.instanceId)),
            ...(player.persistentCards ?? []).filter(c => borrowedIds.includes(c.instanceId)),
          ]
        : [];
      const cleanedWearPile = player.wearPile.filter(c => !borrowedIds.includes(c.instanceId));
      const cleanedPersistent = (player.persistentCards ?? []).filter(c => !borrowedIds.includes(c.instanceId));
      // Cartas NO USADAS: siguen en la mano → descartar fuera del juego.
      // Defensivo: si no hay mazo de Apoyo registrado, las prestadas en
      // cualquier zona salen del juego (no contaminan el mazo del jugador).
      const unusedBorrowed = usedDeckIndex !== null
        ? player.hand.filter(c => borrowedIds.includes(c.instanceId))
        : [
            ...player.hand.filter(c => borrowedIds.includes(c.instanceId)),
            ...player.wearPile.filter(c => borrowedIds.includes(c.instanceId)),
            ...(player.persistentCards ?? []).filter(c => borrowedIds.includes(c.instanceId)),
          ];
      const cleanedHand = player.hand.filter(c => !borrowedIds.includes(c.instanceId));
      for (const c of unusedBorrowed) {
        events.push({
          type: 'CARD_REMOVED_FROM_GAME',
          cardInstanceId: c.instanceId,
          seq: nextSeq(),
        });
      }
      // D434: emitir CARD_MOVED para las usadas devueltas al mazo de Apoyo —
      // en replay, applyEvent las redirige al mazo de origen via
      // borrowedSupportCardIds + supportDeckIndexUsedThisTurn
      for (const c of usedBorrowed) {
        const fromZone = player.wearPile.some(w => w.instanceId === c.instanceId)
          ? 'WEAR_PILE' as const
          : 'IN_FRONT_OF_PLAYER' as const;
        events.push({
          type: 'CARD_MOVED',
          cardInstanceId: c.instanceId,
          from: fromZone,
          to: 'ABILITY_DECK',
          seq: nextSeq(),
        });
      }
      state = mapPlayerState(state, state.activePlayerId, p => ({
        ...p,
        hand: cleanedHand,
        wearPile: cleanedWearPile,
        persistentCards: cleanedPersistent,
        supportDecks: usedDeckIndex !== null
          ? p.supportDecks.map((d, i) =>
              i === usedDeckIndex ? [...d, ...usedBorrowed.map(c => ({ ...c, zone: 'ABILITY_DECK' as Zone }))] : d
            )
          : p.supportDecks,
        borrowedSupportCardIds: [],
        supportCardUsedThisTurn: false,
      }));
    }
  }

  // Expirar modificadores UNTIL_END_OF_TURN (jugadores y enemigos) y resetear
  // flags de Apoyo — event-sourced para que el fold del eventLog converja.
  // Va DESPUÉS de los CARD_MOVED/CARD_REMOVED de cartas prestadas: su
  // redirección al mazo de Apoyo depende de borrowedSupportCardIds.
  state = cleanupTurnEnd(state);
  events.push({ type: 'EFFECTS_EXPIRED', scope: 'TURN_END', seq: nextSeq() });

  // Pas al siguiente jugador (saltando jugadores eliminados)
  const currentIndex = state.playerOrder.indexOf(state.activePlayerId);
  // Filtrar jugadores no eliminados (wounds < maxWounds)
  const alivePlayers = state.playerOrder.filter(id => {
    const p = state.players[id];
    return p && p.wounds < (p.maxWounds ?? 3);
  });
  // Si no quedan jugadores vivos, el GAME_END_CHECK detectará derrota colectiva
  const playerList = alivePlayers.length > 0 ? alivePlayers : state.playerOrder;
  const aliveIndex = playerList.indexOf(state.activePlayerId);
  // Si el jugador actual ya no está vivo, buscar el siguiente desde el inicio
  const searchStart = aliveIndex >= 0 ? aliveIndex + 1 : 0;
  let nextIndex = searchStart % playerList.length;
  // Avanzar hasta encontrar un jugador distinto o volver al inicio
  if (playerList[nextIndex] === state.activePlayerId && playerList.length > 1) {
    nextIndex = (nextIndex + 1) % playerList.length;
  }
  const nextPlayerId = playerList[nextIndex];
  // Determinar si el turno incrementa: si el siguiente jugador está antes en el orden original
  const nextOriginalIndex = state.playerOrder.indexOf(nextPlayerId);
  const newTurnNumber = state.turnNumber + (nextOriginalIndex <= currentIndex ? 1 : 0);

  events.push({
    type: 'PHASE_CHANGED',
    phase: 'GAME_END_CHECK',
    seq: nextSeq(),
  });

  return {
    state: {
      ...state,
      phase: 'GAME_END_CHECK',
      activePlayerId: nextPlayerId,
      turnNumber: newTurnNumber,
    },
    events,
  };
}

// ============================================================================
