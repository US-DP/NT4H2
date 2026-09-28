/**
 * resolveRapidShot — cadena Disparo Rapido (DRAW_AND_CHECK encadenado).
 * Extraido de resolver.ts.
 */

import type {
  GameState,
  GameEvent,
  CardDefinition,
  ResolutionContext,
  CardInstance,
  Zone,
  PlayerState,
  PendingChoice,
} from '@nt4h/schema';
import type { DeterministicRng } from '../rng/index.js';
import type { EffectRegistry } from './registry.js';
import type { CatalogLoadResult } from '@nt4h/catalog';
import { MAX_CHAIN_DEPTH } from '../triggers/index.js';
import { getEnemyDamageBonus } from '../modifiers/index.js';
import { evalValue } from './registry.js';
import { nextSeq } from '../seq.js';
import {
  emitEnemyDefeated,
  applyDamageModifiers,
  applyEventInline,
  executeEffectChain,
} from './resolver.js';

// ============================================================================
// Disparo Rapido — cadena de cartas
// ============================================================================

interface ChainResult {
  events: GameEvent[];
  state: GameState;
  additionalCardsPlayed: string[];
  enemiesDefeated: string[];
  /** Eleccion pendiente (p.ej. opt-in de Beleth-Il en fallo de Disparo Rapido) */
  pendingChoice?: PendingChoice;
}

export function resolveRapidShot(
  state: GameState,
  _sourceCard: CardInstance,
  cardDef: CardDefinition,
  targetEnemyId: string | null,
  player: PlayerState,
  rng: DeterministicRng,
  registry: EffectRegistry,
  catalog: CatalogLoadResult,
  ctx: ResolutionContext,
  depth: number = 0,
  inheritedEnemiesDefeated: string[] = [],
): ChainResult {
  const events: GameEvent[] = [];
  let currentState = state;
  const additionalCardsPlayed: string[] = [];
  const enemiesDefeated: string[] = [...inheritedEnemiesDefeated];

  if (depth >= MAX_CHAIN_DEPTH) {
    return { events, state: currentState, additionalCardsPlayed, enemiesDefeated };
  }

  // Buscar el efecto DRAW_AND_CHECK
  const drawEffect = cardDef.effects.find(e => e.type === 'DRAW_AND_CHECK');
  if (!drawEffect || drawEffect.type !== 'DRAW_AND_CHECK') {
    return { events, state: currentState, additionalCardsPlayed, enemiesDefeated };
  }

  // Normalizar aliases snake_case (compatibilidad con formato MD)
  // D428: preferir expectedCard (definitionId estable) sobre expectedName (nombre localizado)
  const expectedCardId = (drawEffect as any).expectedCard ?? (drawEffect as any).expected_card;
  const expectedName = drawEffect.expectedName ?? (drawEffect as any).expected_name;
  const onMatchEffects = drawEffect.onMatch ?? (drawEffect as any).on_match ?? [];
  // Leer inheritTarget del onMatch (default: true)
  const playImmediatelyEffect = onMatchEffects.find((e: any) => e.type === 'PLAY_IMMEDIATELY');
  const inheritTarget = playImmediatelyEffect ? (playImmediatelyEffect as any).inheritTarget !== false : true;
  // El Taller permite efectos arbitrarios en onMatch (además de —o en lugar
  // de— PLAY_IMMEDIATELY) y una rama onMismatch para el fallo.
  const onMatchExtras = onMatchEffects.filter((e: any) => e.type !== 'PLAY_IMMEDIATELY');
  const onMismatchEffects = drawEffect.onMismatch ?? (drawEffect as any).on_mismatch ?? [];

  // Robos encadenados: DRAW_AND_CHECK.amount (Disparo Rápido = 1). Cada robo
  // se comprueba por separado; sin expectedCard/expectedName nada coincide.
  const drawCount = Math.max(1, Math.min(20, Math.floor(
    evalValue(drawEffect.amount, ctx, currentState)) || 1));

  for (let drawIdx = 0; drawIdx < drawCount; drawIdx++) {
  // Robar 1 carta del mazo
  let currentPlayer = currentState.players[player.playerId];
  // D434 (spec §4.4): Disparo Rápido jugado desde un mazo de Apoyo roba del
  // "propio mazo del explorador" = el mazo de Apoyo del que salio la carta,
  // no del mazo del jugador. El mazo de Apoyo agotado no causa Herida ni
  // reciclaje (no es el mazo-vida del jugador): la cadena simplemente acaba.
  const supportIdx = currentPlayer.supportDeckIndexUsedThisTurn;
  const drawsFromSupport =
    (currentPlayer.borrowedSupportCardIds?.includes(_sourceCard.instanceId) ?? false)
    && supportIdx !== null && supportIdx !== undefined;

  let drawnCard: CardInstance;
  if (drawsFromSupport) {
    const supportDeck = currentPlayer.supportDecks?.[supportIdx] ?? [];
    if (supportDeck.length === 0) {
      break;
    }
    drawnCard = supportDeck[0];
  } else {
    if (currentPlayer.abilityDeck.length === 0) {
      // Mazo agotado: recibir 1 Herida y barajar Desgaste (especificacion: mazo como vida)
      if (currentPlayer.wearPile.length > 0) {
        events.push({
          type: 'HERO_WOUNDED',
          playerId: player.playerId,
          woundCount: currentPlayer.wounds + 1,
          seq: nextSeq(),
        });
        const shuffledWear = rng.shuffle([...currentPlayer.wearPile]);
        const newOrder = shuffledWear.map(c => c.instanceId);
        events.push({
          type: 'DECK_RESHUFFLED',
          playerId: player.playerId,
          newDeckSize: shuffledWear.length,
          newOrder,
          seq: nextSeq(),
        });
        // Actualizar estado: barajar desgaste como nuevo mazo
        currentState = {
          ...currentState,
          players: {
            ...currentState.players,
            [player.playerId]: {
              ...currentPlayer,
              abilityDeck: shuffledWear.map(c => ({ ...c, zone: 'ABILITY_DECK' as Zone })),
              wearPile: [],
              wounds: currentPlayer.wounds + 1,
            },
          },
        };
        currentPlayer = currentState.players[player.playerId];
      } else {
        // No hay desgaste ni mazo: no se puede robar
        break;
      }
    }
    drawnCard = currentPlayer.abilityDeck[0];
  }
  const drawnDef = catalog.byId.get(drawnCard.definitionId);

  // Evento de robo: CARDS_DRAWN para el mazo propio; CARD_MOVED para el mazo
  // de Apoyo (CARDS_DRAWN solo busca en abilityDeck al re-aplicar el evento)
  if (drawsFromSupport) {
    events.push({
      type: 'CARD_MOVED',
      cardInstanceId: drawnCard.instanceId,
      from: 'ABILITY_DECK' as Zone,
      to: 'HAND' as Zone,
      playerId: player.playerId,
  seq: nextSeq(),
    });
  } else {
    events.push({
      type: 'CARDS_DRAWN',
      playerId: player.playerId,
      count: 1,
      cardInstanceIds: [drawnCard.instanceId],
      seq: nextSeq(),
    });
  }

  // Aplicar el robo al estado
  currentState = drawsFromSupport
    ? {
        ...currentState,
        players: {
          ...currentState.players,
          [player.playerId]: {
            ...currentState.players[player.playerId],
            supportDecks: (currentState.players[player.playerId].supportDecks ?? []).map(
              (d, i) => i === supportIdx ? d.slice(1) : d,
            ),
            hand: [...currentState.players[player.playerId].hand, { ...drawnCard, zone: 'HAND' as Zone }],
            // La carta robada del Apoyo tambien es prestada
            borrowedSupportCardIds: [
              ...(currentState.players[player.playerId].borrowedSupportCardIds ?? []),
              drawnCard.instanceId,
            ],
          },
        },
      }
    : {
        ...currentState,
        players: {
          ...currentState.players,
          [player.playerId]: {
            ...currentState.players[player.playerId],
            abilityDeck: currentState.players[player.playerId].abilityDeck.slice(1),
            hand: [...currentState.players[player.playerId].hand, { ...drawnCard, zone: 'HAND' as Zone }],
          },
        },
      };

  if (!drawnDef) {
    break;
  }

  // Comprobar si la carta robada es la esperada (ID estable, o nombre como fallback)
  const isMatch = expectedCardId
    ? drawnCard.definitionId === expectedCardId
    : (expectedName != null && drawnDef.name === expectedName);
  if (isMatch) {
    // Determinar el objetivo de la carta robada
    // Si inheritTarget === false, elegir un nuevo objetivo (primer enemigo del campo que no sea el original)
    let drawnTargetEnemyId: string | null;
    if (inheritTarget) {
      drawnTargetEnemyId = targetEnemyId;
    } else {
      // Buscar un enemigo diferente al original
      const differentEnemy = currentState.battlefield.find(e => e.instanceId !== targetEnemyId);
      drawnTargetEnemyId = differentEnemy
        ? differentEnemy.instanceId
        : (currentState.battlefield.length > 0 ? currentState.battlefield[0].instanceId : null);
    }

    if (playImmediatelyEffect) {
    // Coincidencia: ejecutar onMatch (PLAY_IMMEDIATELY)
    additionalCardsPlayed.push(drawnCard.instanceId);

    // Quitar la carta robada de la mano
    currentState = {
      ...currentState,
      players: {
        ...currentState.players,
        [player.playerId]: {
          ...currentState.players[player.playerId],
          hand: currentState.players[player.playerId].hand.filter(
            c => c.instanceId !== drawnCard.instanceId
          ),
        },
      },
    };

    // Evento: carta jugada
    events.push({
      type: 'CARD_PLAYED',
      playerId: player.playerId,
      cardInstanceId: drawnCard.instanceId,
      cardDefinitionId: drawnCard.definitionId,
      cardName: drawnDef.name,
      targetEnemyInstanceId: drawnTargetEnemyId ?? undefined,
      seq: nextSeq(),
    });

    // Dano impreso de la carta robada
    if (drawnDef.printedAttack && drawnDef.printedAttack > 0 && drawnTargetEnemyId) {
      let damage = drawnDef.printedAttack;
      damage = applyDamageModifiers(damage, drawnDef.name, currentState.players[player.playerId]);
      // Aplicar vulnerabilidad del enemigo (DAMAGE_BONUS)
      if (drawnTargetEnemyId) {
        const enemy = currentState.battlefield.find(e => e.instanceId === drawnTargetEnemyId);
        if (enemy) damage += getEnemyDamageBonus(enemy);
      }

      events.push({
        type: 'DAMAGE_DEALT',
        targetId: drawnTargetEnemyId,
        amount: damage,
        sourceCardInstanceId: drawnCard.instanceId,
        seq: nextSeq(),
      });

      // Aplicar el dano al estado intermedio para que la reevaluacion de derrota sea correcta
      currentState = applyEventInline(currentState, {
        type: 'DAMAGE_DEALT',
        targetId: drawnTargetEnemyId,
        amount: damage,
        sourceCardInstanceId: drawnCard.instanceId,
        seq: nextSeq(),
      });

      // Gloria del Señor de la Guerra: se otorga en el post-procesado de pericias
      // (no aquí, para evitar doble GLORY_GAINED)

      // Comprobar derrota (currentState ya tiene el daño aplicado)
      if (drawnTargetEnemyId) {
        currentState = emitEnemyDefeated(
          currentState, drawnTargetEnemyId, player.playerId, enemiesDefeated, events, catalog, ctx,
        );
      }
    }

    // Mover carta robada a desgaste
    events.push({
      type: 'CARD_MOVED',
      cardInstanceId: drawnCard.instanceId,
      from: 'HAND',
      to: 'WEAR_PILE',
      playerId: player.playerId,
  seq: nextSeq(),
    });

    // Recursion: la carta robada tambien tiene DRAW_AND_CHECK
    if (drawnDef.effects.some(e => e.type === 'DRAW_AND_CHECK')) {
      const newCtx: ResolutionContext = {
        ...ctx,
        currentCardId: drawnCard.definitionId,
        currentCardName: drawnDef.name,
        currentCardInstanceId: drawnCard.instanceId,
        depth: depth + 1,
      };
      const chainResult = resolveRapidShot(
        currentState,
        drawnCard,
        drawnDef,
        drawnTargetEnemyId,
        currentState.players[player.playerId],
        rng,
        registry,
        catalog,
        newCtx,
        depth + 1,
        enemiesDefeated, // heredar enemigos ya derrotados en la cadena
      );
      events.push(...chainResult.events);
      currentState = chainResult.state;
      additionalCardsPlayed.push(...chainResult.additionalCardsPlayed);
      enemiesDefeated.push(...chainResult.enemiesDefeated);
      // Propagar eleccion pendiente de la subcadena (Beleth-Il)
      if (chainResult.pendingChoice) {
        return { events, state: currentState, additionalCardsPlayed, enemiesDefeated, pendingChoice: chainResult.pendingChoice };
      }
    }
    }

    // Efectos onMatch adicionales (Taller): se ejecutan además de —o en
    // lugar de— jugar la carta robada. Si no hay PLAY_IMMEDIATELY la carta
    // simplemente queda en la mano.
    if (onMatchExtras.length > 0) {
      const extraCtx: ResolutionContext = {
        ...ctx,
        currentCardId: drawnCard.definitionId,
        currentCardName: drawnDef.name,
        currentCardInstanceId: drawnCard.instanceId,
        selectedEnemyId: drawnTargetEnemyId ?? ctx.selectedEnemyId,
        drawnCardInstanceId: drawnCard.instanceId,
        depth: depth + 1,
      };
      const extra = executeEffectChain(onMatchExtras, extraCtx, currentState, rng, registry, catalog, depth + 1);
      events.push(...extra.events);
      currentState = extra.state;
    }
  } else {
    // No coincidencia: la carta robada va al FONDO del mazo del que salio
    // (especificacion: Disparo Rapido - carta fallida al fondo del mazo).
    // D434: si salio del mazo de Apoyo, vuelve al mazo de Apoyo (spec §4.4).
    events.push({
      type: 'CARD_MOVED',
      cardInstanceId: drawnCard.instanceId,
      from: 'HAND',
      to: 'ABILITY_DECK',
      playerId: player.playerId,
  seq: nextSeq(),
    });
    // Actualizar estado: remover de mano, anadir al fondo del mazo origen
    const p = currentState.players[player.playerId];
    const backToSupport = drawsFromSupport && supportIdx !== null && supportIdx !== undefined;
    currentState = {
      ...currentState,
      players: {
        ...currentState.players,
        [player.playerId]: {
          ...p,
          hand: p.hand.filter(c => c.instanceId !== drawnCard.instanceId),
          ...(backToSupport
            ? {
                supportDecks: (p.supportDecks ?? []).map(
                  (d, i) => i === supportIdx ? [...d, { ...drawnCard, zone: 'ABILITY_DECK' as Zone }] : d,
                ),
              }
            : {
                abilityDeck: [...p.abilityDeck, { ...drawnCard, zone: 'ABILITY_DECK' as Zone }],
              }),
        },
      },
    };

    // Rama onMismatch del Taller: se ejecuta cuando la carta robada no
    // coincide (ya devuelta al fondo del mazo del que salió).
    if (onMismatchEffects.length > 0) {
      const missCtx: ResolutionContext = {
        ...ctx,
        drawnCardInstanceId: drawnCard.instanceId,
        depth: depth + 1,
      };
      const extra = executeEffectChain(onMismatchEffects, missCtx, currentState, rng, registry, catalog, depth + 1);
      events.push(...extra.events);
      currentState = extra.state;
    }

    // Beleth-Il (spec §6.8): "la primera carta fallida que robes PODRÁS
    // recuperarla y robar otra" — Pericia de uso discrecional (2 usos).
    // Se ofrece como eleccion pendiente; al aceptar, la carta va a la mano.
    // AMB-002 (spec): "recuperar" podria ser fondo del mazo por glosario,
    // pero como la carta fallida ya va al fondo por defecto, la lectura
    // "a la mano" es la unica que da efecto a la Pericia.
    const playerState = currentState.players[player.playerId];
    if (playerState.heroId === 'hero.beleth-il' && (playerState.heroUsesRemaining ?? 0) > 0) {
      return {
        events, state: currentState, additionalCardsPlayed, enemiesDefeated,
        pendingChoice: {
          choiceId: `beleth-recover-${player.playerId}-${nextSeq()}`,
          playerId: player.playerId,
          type: 'CONFIRM',
          prompt: 'Beleth-Il: ¿usar tu Pericia para recuperar la carta fallida a la mano y robar otra?',
          options: ['yes', 'no'],
          minSelections: 1,
          maxSelections: 1,
          relatedCardIds: [drawnCard.instanceId],
        },
      };
    }
  }
  }

  return { events, state: currentState, additionalCardsPlayed, enemiesDefeated };
}

