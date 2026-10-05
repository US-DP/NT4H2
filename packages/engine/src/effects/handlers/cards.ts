/**
 * Handlers de robo, descarte, recuperacion, busqueda y movimiento de cartas.
 * Extraido de registry.ts (split por dominio).
 */

import type {
  GameEvent,
  Zone,
} from '@nt4h/schema';
import {
  evalValue,
  applyHeroDamage,
  drawCardsWithReshuffle,
  type EffectRegistry,
} from '../registry.js';

export function registerCardsEffects(registry: EffectRegistry): void {
  registry.register('DRAW_CARDS', (eff, ctx, state, rng) => {
    const count = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    const source = eff.source ?? 'ABILITY_DECK';
    if (source === 'SUPPORT_DECK') {
      // Robar del mazo de Apoyo usado este turno (spec §4.2: solo 1 mazo/turno);
      // si ninguno se ha usado aun, del primer mazo disponible
      const decks = player.supportDecks ?? [];
      const usedIdx = player.supportDeckIndexUsedThisTurn;
      const deckIdx = usedIdx !== null && usedIdx !== undefined
        ? usedIdx
        : decks.findIndex(d => d.length > 0);
      const supportDeck = deckIdx >= 0 ? decks[deckIdx] : undefined;
      const drawn = supportDeck ? supportDeck.slice(0, count).map(c => c.instanceId) : [];
      if (drawn.length === 0) return [];
      return [{
        type: 'CARDS_DRAWN',
        playerId: ctx.activePlayerId,
        count: drawn.length,
        cardInstanceIds: drawn,
        seq: registry.nextSeq(),
      }];
    }

    // D434: robo del mazo de Habilidad con Herida + reciclaje de Desgaste
    // si el mazo se agota (spec §3.10 Heridas, §9.7)
    return drawCardsWithReshuffle(ctx.activePlayerId, count, state, rng, () => registry.nextSeq()).events;
  });
  registry.register('LOSE_CARDS', (eff, ctx, state, rng) => {
    const count = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];

    // Si el mazo tiene suficientes cartas, perder normalmente
    if (player.abilityDeck.length >= count) {
      const lost = player.abilityDeck.slice(0, count).map(c => c.instanceId);
      return [{
        type: 'CARDS_LOST',
        playerId: ctx.activePlayerId,
        count: lost.length,
        cardInstanceIds: lost,
        seq: registry.nextSeq(),
      }];
    }

    // Mazo agotado o insuficiente: usar applyHeroDamage para reciclaje + herida
    if (count > 0) {
      return applyHeroDamage(ctx.activePlayerId, count, state, rng, () => registry.nextSeq());
    }
    return [];
  });
  registry.register('RECOVER_CARDS', (eff, ctx, state) => {
    const count = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    // Recuperar de la parte INFERIOR del desgaste (las cartas mas antiguas)
    const recovered = player.wearPile.slice(0, count).map(c => c.instanceId);

    if (recovered.length === 0) return [];

    return [{
      type: 'CARDS_RECOVERED',
      playerId: ctx.activePlayerId,
      count: recovered.length,
      cardInstanceIds: recovered,
      toZone: eff.to === 'BOTTOM_OF_DECK' ? 'ABILITY_DECK' : 'HAND',
      seq: registry.nextSeq(),
    }];
  });
  registry.register('ALL_HEROES_RECOVER', (eff, ctx, state) => {
    const count = evalValue(eff.amount, ctx, state);
    return state.playerOrder.flatMap(playerId => {
      const player = state.players[playerId];
      const recovered = player.wearPile.slice(0, count).map(c => c.instanceId);
      if (recovered.length === 0) return [];
      return [{
        type: 'CARDS_RECOVERED' as const,
        playerId,
        count: recovered.length,
        cardInstanceIds: recovered,
        toZone: 'ABILITY_DECK' as const,
        seq: registry.nextSeq(),
      }];
    });
  });
  registry.register('OTHER_HEROES_RECOVER', (eff, ctx, state) => {
    const count = evalValue(eff.amount, ctx, state);
    const others = state.playerOrder.filter(id => id !== ctx.activePlayerId);
    // D434 (spec §4.4): en solitario, una carta de Apoyo que haga recuperar a
    // "otros heroes" se aplica al propio jugador (la carta es de otro heroe)
    const active = state.players[ctx.activePlayerId];
    const isBorrowed = active?.borrowedSupportCardIds?.includes(ctx.currentCardInstanceId ?? '') ?? false;
    const targets = others.length > 0
      ? others
      : (state.mode === 'SOLO' && isBorrowed ? [ctx.activePlayerId] : []);
    return targets.flatMap(playerId => {
      const player = state.players[playerId];
      const recovered = player.wearPile.slice(0, count).map(c => c.instanceId);
      if (recovered.length === 0) return [];
      return [{
        type: 'CARDS_RECOVERED' as const,
        playerId,
        count: recovered.length,
        cardInstanceIds: recovered,
        toZone: 'ABILITY_DECK' as const,
        seq: registry.nextSeq(),
      }];
    });
  });
  registry.register('END_ATTACK', (_eff, _ctx, _state) => {
    // Senala fin del enfrentamiento; el motor de fases lo procesara
    return [];
  });
  registry.register('REMOVE_FROM_GAME', (_eff, ctx, _state) => {
    return [{
      type: 'CARD_REMOVED_FROM_GAME',
      cardInstanceId: ctx.currentCardInstanceId,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('PLACE_PERSISTENT', (eff, ctx, _state) => {
    return [{
      type: 'PERSISTENT_CARD_PLACED',
      playerId: ctx.activePlayerId,
      cardInstanceId: ctx.currentCardInstanceId,
      cardDefinitionId: ctx.currentCardId,
      trigger: eff.trigger,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('COST', (eff, ctx, state) => {
    const amount = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    if (eff.resource === 'COINS') {
      // Validar que hay monedas suficientes
      if (player.coins < amount) return [];
      return [{
        type: 'COINS_LOST',
        playerId: ctx.activePlayerId,
        amount,
        seq: registry.nextSeq(),
      }];
    } else {
      // GLORY: usar GLORY_LOST (no GLORY_GAINED negativo)
      if (player.glory < amount) return [];
      return [{
        type: 'GLORY_LOST',
        playerId: ctx.activePlayerId,
        amount,
        seq: registry.nextSeq(),
      }];
    }
  });
  registry.register('DRAW_AND_CHECK', (_eff, _ctx, _state) => {
    // Manejado por el motor de resolucion (necesita logica de cadena)
    return [];
  });
  registry.register('DRAW_AND_ADD_ATTACK', (_eff, _ctx, _state) => {
    // Manejado por el motor de resolucion (logica especial en resolver.ts)
    return [];
  });
  registry.register('PLAY_IMMEDIATELY', (_eff, _ctx, _state) => {
    // Manejado por el motor de resolucion
    return [];
  });
  registry.register('RECOVER_THIS_CARD', (eff, ctx, _state) => {
    return [{
      type: 'CARDS_RECOVERED',
      playerId: ctx.activePlayerId,
      count: 1,
      cardInstanceIds: [ctx.currentCardInstanceId],
      toZone: eff.to === 'HAND' ? 'HAND' : 'ABILITY_DECK',
      seq: registry.nextSeq(),
    }];
  });
  registry.register('SHUFFLE_DECK', (eff, ctx, state, rng) => {
    const player = state.players[ctx.activePlayerId];
    if (eff.deck === 'ABILITY') {
      const shuffled = rng.shuffle(player.abilityDeck);
      return [{
        type: 'DECK_SHUFFLED',
        playerId: ctx.activePlayerId,
        deck: 'ABILITY',
        newOrder: shuffled.map(c => c.instanceId),
        seq: registry.nextSeq(),
      }];
    }
    if (eff.deck === 'MARKET') {
      // Barajar el mazo de Mercado (Pericia de Neddia)
      const shuffled = rng.shuffle(state.marketDeck);
      return [{
        type: 'DECK_SHUFFLED',
        playerId: ctx.activePlayerId,
        deck: 'MARKET',
        newOrder: shuffled.map(c => c.instanceId),
        seq: registry.nextSeq(),
      }];
    }
    if (eff.deck === 'HORDE') {
      const shuffled = rng.shuffle(state.hordeDeck);
      return [{
        type: 'DECK_SHUFFLED',
        playerId: ctx.activePlayerId,
        deck: 'HORDE',
        newOrder: shuffled.map(c => c.instanceId),
        seq: registry.nextSeq(),
      }];
    }
    return [];
  });
  registry.register('SEARCH_DECK', (eff, ctx, state) => {
    const player = state.players[ctx.activePlayerId];
    // Determinar el mazo objetivo (ABILITY por defecto; MARKET/HORDE se piden
    // explícitos — antes HORDE caía silenciosamente al mazo de Habilidad).
    const deck = eff.deck === 'MARKET' ? state.marketDeck
      : eff.deck === 'HORDE' ? state.hordeDeck
      : player.abilityDeck;
    const filter = eff.filter as { name?: string; definitionId?: string };
    const limit = Math.max(1, Math.min(Math.floor(eff.amount ?? 1), deck.length));
    const found = deck.filter(c => {
      if (filter.name) {
        const cName = (c as { name?: string }).name ?? '';
        if (cName !== filter.name && c.definitionId !== filter.name) return false;
      }
      if (filter.definitionId && c.definitionId !== filter.definitionId) return false;
      return true;
    }).slice(0, limit);
    if (found.length === 0) return [];

    const fromZone: Zone = eff.deck === 'MARKET' ? 'MARKET_DECK'
      : eff.deck === 'HORDE' ? 'HORDE_DECK' : 'ABILITY_DECK';
    if (eff.action === 'PUT_IN_HAND') {
      return found.map(card => ({
        type: 'CARD_MOVED' as const,
        cardInstanceId: card.instanceId,
        from: fromZone,
        to: 'HAND' as const,
        playerId: ctx.activePlayerId,
        seq: registry.nextSeq(),
      }));
    }
    // SWAP_WITH_HAND: emparejar cada carta encontrada con una carta de mano
    // (amount>1 → hasta N intercambios, por orden).
    const events: GameEvent[] = [];
    for (let i = 0; i < found.length; i++) {
      const handCard = player.hand[i];
      if (!handCard) break;
      events.push(
        { type: 'CARD_MOVED', cardInstanceId: handCard.instanceId, from: 'HAND', to: fromZone, playerId: ctx.activePlayerId, seq: registry.nextSeq() },
        { type: 'CARD_MOVED', cardInstanceId: found[i].instanceId, from: fromZone, to: 'HAND', playerId: ctx.activePlayerId, seq: registry.nextSeq() },
      );
    }
    return events;
  });
  registry.register('SEARCH_WEAR_PILE_PUT_IN_HAND', (_eff, ctx, state) => {
    const player = state.players[ctx.activePlayerId];
    if (player.wearPile.length === 0) return [];
    // Si el jugador eligió una carta concreta, usarla; si no, tomar la mas reciente
    const card = ctx.chosenWearCardId
      ? player.wearPile.find(c => c.instanceId === ctx.chosenWearCardId)
      : player.wearPile[player.wearPile.length - 1];
    if (!card) return [];
    return [{
      type: 'CARD_MOVED',
      cardInstanceId: card.instanceId,
      from: 'WEAR_PILE',
      to: 'HAND',
      playerId: ctx.activePlayerId,

      seq: registry.nextSeq(),
    }];
  });
  registry.register('RECOVER_CARD_BY_NAME', (eff, ctx, state) => {
    const player = state.players[ctx.activePlayerId];
    // Normalizar: minúsculas, sin tildes
    const normalize = (s: string) => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const targetName = normalize(eff.name);
    // El destino lo decide la carta (BOTTOM_OF_DECK por defecto): 'ABILITY_DECK'
    // anade al final del array = fondo del mazo (indice 0 = cima).
    const toZone: Zone = eff.to === 'HAND' ? 'HAND' : 'ABILITY_DECK';
    // Buscar desde el INICIO del desgaste (cartas más antiguas = parte inferior)
    for (let i = 0; i < player.wearPile.length; i++) {
      const c = player.wearPile[i];
      if (c.name ? normalize(c.name) === targetName : normalize(c.definitionId).includes(targetName)) {
        return [{
          type: 'CARD_MOVED',
          cardInstanceId: c.instanceId,
          from: 'WEAR_PILE',
          to: toZone,
          seq: registry.nextSeq(),
        }];
      }
    }
    return [];
  });
  registry.register('LOOK_AT_CARDS', (eff, ctx, state) => {
    const count = evalValue(eff.amount, ctx, state);
    if (eff.deck !== 'HORDE') return [];
    // No genera eventos que cambien el estado directamente;
    // el reordenamiento se maneja como un evento especial
    const bottomCards = state.hordeDeck.slice(-count).map(c => c.instanceId);
    return [{
      type: 'CARDS_REVEALED_TO_PLAYER',
      playerId: ctx.activePlayerId,
      cardInstanceIds: bottomCards,
      deck: 'HORDE',
      seq: registry.nextSeq(),
    }];
  });
  registry.register('PLAY_RANDOM_CARD_FROM_OTHER_HERO', (eff, ctx, state, rng) => {
    const costGlory = evalValue(eff.costGlory ?? eff.cost_glory ?? { kind: 'CONSTANT', value: 0 }, ctx, state);
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    if (player.glory < costGlory) return []; // No hay gloria suficiente

    const events: GameEvent[] = [];
    // Elegir un héroe aleatorio y robar una carta aleatoria de su MANO
    // (spec: la carta se "juega" de otro héroe — coincide con la ruta
    // tears-hero-* de execute.ts que también usa la mano).
    // Verificar objetivos ANTES de cobrar: resolveCard comprueba primero
    // y sin candidatos no cobra la gloria — el handler cobraba y no robaba.
    const otherPlayers = state.playerOrder
      .filter(pid => pid !== ctx.activePlayerId)
      .map(pid => state.players[pid])
      .filter(p => p.hand.length > 0);
    if (otherPlayers.length === 0) return events;
    // Pagar el coste de Gloria
    if (costGlory > 0) {
      events.push({
        type: 'GLORY_LOST',
        playerId: ctx.activePlayerId,
        amount: costGlory,
        seq: registry.nextSeq(),
      });
    }
    const targetPlayer = rng.pick(otherPlayers);
    const drawnCard = rng.pick(targetPlayer.hand);
    // Mover la carta de la mano del otro héroe a la mano del jugador activo
    events.push({
      type: 'CARD_MOVED',
      cardInstanceId: drawnCard.instanceId,
      from: 'HAND',
      to: 'HAND',
      toPlayerId: ctx.activePlayerId,
      playerId: targetPlayer.playerId,
      seq: registry.nextSeq(),
    });
    events.push({
      type: 'CARD_PLAYED',
      playerId: ctx.activePlayerId,
      cardInstanceId: drawnCard.instanceId,
      cardDefinitionId: drawnCard.definitionId,
      cardName: drawnCard.name,
      seq: registry.nextSeq(),
    });
    return events;
  });
  registry.register('DRAW_FROM_BOTTOM', (eff, ctx, state, rng) => {
    const count = evalValue(eff.amount, ctx, state);
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    const deck = player.abilityDeck;
    // Caso simple: el mazo alcanza — sacar del fondo
    if (deck.length >= count) {
      const drawn = deck.slice(deck.length - count).map(c => c.instanceId);
      if (drawn.length === 0) return [];
      return [{
        type: 'CARDS_DRAWN' as const,
        playerId: ctx.activePlayerId,
        count: drawn.length,
        cardInstanceIds: drawn,
        seq: registry.nextSeq(),
      }];
    }
    // Mazo insuficiente: robar lo que queda por el fondo y el resto con
    // la regla normal de agotamiento (herida + reciclaje, spec §3.10)
    const events: GameEvent[] = [];
    if (deck.length > 0) {
      const drawn = deck.map(c => c.instanceId);
      events.push({
        type: 'CARDS_DRAWN' as const,
        playerId: ctx.activePlayerId,
        count: drawn.length,
        cardInstanceIds: drawn,
        seq: registry.nextSeq(),
      });
    }
    const depleted = {
      ...state,
      players: {
        ...state.players,
        [ctx.activePlayerId]: { ...player, abilityDeck: [] },
      },
    };
    events.push(...drawCardsWithReshuffle(
      ctx.activePlayerId, count - deck.length, depleted, rng, () => registry.nextSeq(),
    ).events);
    return events;
  });
  registry.register('DRAW_UP_TO', (eff, ctx, state, rng) => {
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    const count = Math.max(0, eff.limit - player.hand.length);
    if (count === 0) return [];
    return drawCardsWithReshuffle(
      ctx.activePlayerId, count, state, rng, () => registry.nextSeq(),
    ).events;
  });
  registry.register('MOVE_CARD', (eff, ctx, state) => {
    const count = Math.max(0, evalValue(eff.count, ctx, state));
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    const zone = eff.from === 'HAND' ? player.hand
      : eff.from === 'WEAR_PILE' ? player.wearPile : player.abilityDeck;
    const cards = zone.slice(-count); // las más recientes
    if (cards.length === 0) return [];
    const fromZone: Zone = eff.from === 'ABILITY_DECK' ? 'ABILITY_DECK' : eff.from;
    return cards.map(c => eff.to === 'REMOVED_FROM_GAME'
      ? {
          type: 'CARD_REMOVED_FROM_GAME' as const,
          cardInstanceId: c.instanceId,
          seq: registry.nextSeq(),
        }
      : {
          type: 'CARD_MOVED' as const,
          cardInstanceId: c.instanceId,
          from: fromZone,
          to: eff.to as Zone,
          playerId: ctx.activePlayerId,
          seq: registry.nextSeq(),
        });
  });
  registry.register('DISCARD_FROM_HAND', (eff, ctx, state) => {
    const player = state.players[ctx.activePlayerId];
    if (!player) return [];
    const count = Math.max(0, evalValue(eff.count, ctx, state));
    const discards = player.hand
      .filter(c => c.instanceId !== ctx.currentCardInstanceId)
      .slice(-count);
    return discards.map(c => ({
      type: 'CARD_MOVED' as const,
      cardInstanceId: c.instanceId,
      from: 'HAND' as const,
      to: 'WEAR_PILE' as const,
      playerId: ctx.activePlayerId,
      seq: registry.nextSeq(),
    }));
  });
}
