/** Restablecimiento: robo hasta la mano objetivo y limpiezas. */

import type {
  GameEvent,
  GameState,
  Zone,
} from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import type { DeterministicRng } from '../../rng/index.js';
import { cleanupRestoration } from '../../modifiers/index.js';
import { nextSeq } from '../../seq.js';

export function processRestoration(
  state: GameState,
  rng: DeterministicRng,
  _catalog: CatalogLoadResult,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const player = state.players[state.activePlayerId];

  // Descarte por encima de 4: el JUGADOR elige qué cartas descartar
  // (spec §3.6.1 — no es decisión del motor). Se pausa la fase hasta que
  // resuelva la elección 'restoration-discard-*' vía RESOLVE_CHOICE.
  if (player.hand.length > 4) {
    const choiceId = `restoration-discard-${state.activePlayerId}`;
    const already = state.pendingChoices.some(c => c.choiceId === choiceId);
    if (!already) {
      const excess = player.hand.length - 4;
      return {
        state: {
          ...state,
          pendingChoices: [...state.pendingChoices, {
            choiceId,
            playerId: state.activePlayerId,
            type: 'SELECT_CARD_FROM_HAND' as const,
            prompt: `Restablecimiento: descarta ${excess} carta(s) para quedarte con 4`,
            options: player.hand.map(c => c.instanceId),
            minSelections: excess,
            maxSelections: excess,
          }],
        },
        events,
      };
    }
  }

  // Guardar valores iniciales para el estado retornado
  // (los eventos transformaran estos valores al estado final)
  const initialHand = [...player.hand];
  const initialDeck = [...player.abilityDeck];
  const initialWearPile = [...player.wearPile];

  // Ajustar mano a 4 cartas (especificacion 3.6.1)
  // Si tiene menos de 4, robar hasta 4
  // Si tiene mas de 4, descartar las extras
  const newHand = [...player.hand];
  let newDeck = [...player.abilityDeck];
  let newWearPile = [...player.wearPile];

  // Descartar extras a Desgaste
  while (newHand.length > 4) {
    const card = newHand.pop()!;
    newWearPile.push({ ...card, zone: 'WEAR_PILE' as Zone });
    events.push({
      type: 'CARD_MOVED',
      cardInstanceId: card.instanceId,
      from: 'HAND' as Zone,
      to: 'WEAR_PILE' as Zone,
      playerId: player.playerId,
      seq: nextSeq(),
    });
  }

  while (newHand.length < 4 && newDeck.length > 0) {
    const card = newDeck[0];
    newDeck = newDeck.slice(1);
    newHand.push({ ...card, zone: 'HAND' as Zone });
    events.push({
      type: 'CARDS_DRAWN',
      playerId: state.activePlayerId,
      count: 1,
      cardInstanceIds: [card.instanceId],
      seq: nextSeq(),
    });
  }

  // Si el mazo se agota al robar, reciclar desgaste barajando y herir
  if (newHand.length < 4 && newDeck.length === 0 && newWearPile.length > 0) {
    events.push({
      type: 'DECK_EXHAUSTED',
      playerId: state.activePlayerId,
      seq: nextSeq(),
    });
    events.push({
      type: 'HERO_WOUNDED',
      playerId: state.activePlayerId,
      woundCount: player.wounds + 1,
      seq: nextSeq(),
    });
    // Barajar el desgaste antes de reciclar (especificacion: mazo como vida)
    const shuffledWear = rng.shuffle(newWearPile);
    const newOrder = shuffledWear.map(c => c.instanceId);
    events.push({
      type: 'DECK_RESHUFFLED',
      playerId: state.activePlayerId,
      newDeckSize: shuffledWear.length,
      newOrder,
      seq: nextSeq(),
    });
    newDeck = shuffledWear.map(c => ({ ...c, zone: 'ABILITY_DECK' as Zone }));
    newWearPile = [];
    while (newHand.length < 4 && newDeck.length > 0) {
      const card = newDeck[0];
      newDeck = newDeck.slice(1);
      newHand.push({ ...card, zone: 'HAND' as Zone });
      events.push({
        type: 'CARDS_DRAWN',
        playerId: state.activePlayerId,
        count: 1,
        cardInstanceIds: [card.instanceId],
        seq: nextSeq(),
      });
    }
  }

  // Limpiar modificadores de fin de turno
  // Nota: hand/abilityDeck/wearPile se retornan con valores iniciales
  // para que applyEvent(CARDS_MOVED/CARDS_DRAWN/DECK_RESHUFFLED) los transforme correctamente
  const newPlayers = {
    ...state.players,
    [state.activePlayerId]: {
      ...player,
      hand: initialHand,
      abilityDeck: initialDeck,
      wearPile: initialWearPile,
    },
  };

  // Limpiezas del Restablecimiento — defensas del héroe activo, daño de
  // enemigos rehabilitado, estados UNTIL_END_OF_TURN caducados y heridas de
  // TEMPORARY_WOUNDS descartadas (spec §3.6). Mismo helper que el reducer de
  // EFFECTS_EXPIRED: el fold del eventLog reproduce exactamente este estado.
  const cleaned = cleanupRestoration({
    ...state,
    players: newPlayers,
    phase: 'BATTLEFIELD_REPLENISHMENT',
  });

  events.push({ type: 'EFFECTS_EXPIRED', scope: 'RESTORATION', seq: nextSeq() });
  events.push({
    type: 'PHASE_CHANGED',
    phase: 'BATTLEFIELD_REPLENISHMENT',
    seq: nextSeq(),
  });

  return {
    state: cleaned,
    events,
  };
}

// ============================================================================
