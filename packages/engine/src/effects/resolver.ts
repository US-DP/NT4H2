/**
 * CardResolver — motor de resolucion de cartas que integra EffectRegistry
 * con EventBus y maneja efectos especiales que requieren logica de cadena.
 *
 * Efectos especiales:
 * - DRAW_AND_CHECK: Disparo Rapido encadenado (robar y comprobar si es la misma carta)
 * - PLAY_IMMEDIATELY: jugar la carta robada inmediatamente
 * - PLACE_PERSISTENT: Trampa (carta permanente con disparador)
 * - ON_DEFEAT: efectos al derrotar un enemigo
 * - ON_HORDE_ATTACK: efectos reactivos al ataque de la Horda
 * - MODIFY_DAMAGE: Piedra de Amolar (modificador de dano del turno)
 * - MODIFY_FORTITUDE: Ruinas de Brunmar, Roghkiller (modificadores continuos)
 */

import type {
  GameState,
  GameEvent,
  CardEffect,
  CardDefinition,
  ResolutionContext,
  CardInstance,
  Zone,
  PlayerState,
  PendingChoice,
} from '@nt4h/schema';
import type { DeterministicRng } from '../rng/index.js';
import type { EffectRegistry} from '../effects/registry.js';
import { ResolutionBudgetError } from '../effects/registry.js';
import { evalValue, resolveTarget, applyHeroDamage, drawCardsWithReshuffle, heroStatValue } from '../effects/registry.js';
import { EventBus, MAX_EFFECT_RECURSION } from '../triggers/index.js';
import { applyEvent, checkFortitudeDefeats } from '../events/applyEvent.js';
import { getEffectiveFortitude } from '../modifiers/index.js';
import { onEnemyDefeated as scenarioOnEnemyDefeated } from '../scenarios/index.js';
import { dispatchListeners } from './listeners.js';
import { resolveRapidShot } from './rapidShot.js';
export { processHordeAttackTriggers } from './hordeTriggers.js';
import { nextSeq, resetSeq } from '../seq.js';
import type { CatalogLoadResult } from '@nt4h/catalog';

// D426: alias por compatibilidad — resetSeq ahora es global (§51.12)
export function resetResolveSeq(): void {
  resetSeq();
}

/**
 * Helper: emitir ENEMY_DEFEATED + invocar efectos del escenario.
 * Usa enemiesDefeated como Set para evitar dobles.
 * Devuelve el estado actualizado y añade eventos a allEvents.
 */
export function emitEnemyDefeated(
  currentState: GameState,
  enemyInstanceId: string,
  defeatingPlayerId: string,
  enemiesDefeated: string[],
  allEvents: GameEvent[],
  catalog: CatalogLoadResult,
  ctx?: ResolutionContext,
): GameState {
  if (enemiesDefeated.includes(enemyInstanceId)) return currentState;
  const enemy = currentState.battlefield.find(e => e.instanceId === enemyInstanceId);
  if (!enemy) return currentState;

  enemiesDefeated.push(enemyInstanceId);
  const finalReward = { ...(enemy.reward ?? { coins: 0, glory: 0 }) };
  if (currentState.ignoreCoinRewards) finalReward.coins = 0;
  if (currentState.ignoreGloryRewards) finalReward.glory = 0;

  allEvents.push({
    type: 'ENEMY_DEFEATED',
    enemyInstanceId,
    enemyDefinitionId: enemy.definitionId,
    defeatingPlayerId,
    reward: finalReward,
    seq: nextSeq(),
  });

  // Establecer lastDefeatedEnemyFortitude y defeatingPlayerId en el contexto para ON_ENEMY_DEFEATED
  const enemyFortitude = getEffectiveFortitude(enemy, currentState);
  if (ctx) {
    (ctx as any).lastDefeatedEnemyFortitude = enemyFortitude;
    (ctx as any).defeatingPlayerId = defeatingPlayerId;
  }

  // Ejecutar efectos ON_ENEMY_DEFEATED del escenario activo
  const scenarioDefId = currentState.scenario?.definitionId;
  if (scenarioDefId) {
    const scenarioEvents = scenarioOnEnemyDefeated(
      currentState,
      scenarioDefId,
      defeatingPlayerId,
      enemyFortitude,
      catalog,
    );
    allEvents.push(...scenarioEvents);
    for (const ev of scenarioEvents) {
      currentState = applyEventInline(currentState, ev);
    }
  }

  // Pericia de Roghkiller: al ser derrotado, eliminar su modificador de +1 a orcos
  // D428: identificar por definitionId estable, no por nombre localizado
  if (enemy.definitionId === 'warlord.roghkiller') {
    currentState = {
      ...currentState,
      battlefield: currentState.battlefield.map(e => ({
        ...e,
        modifiers: e.modifiers.filter(m => m.sourceId !== 'roghkiller'),
      })),
    };
  }

  return currentState;
}

/** Wrappers cuyos `effects` NO se ejecutan al resolver la carta sino en
 *  un disparador posterior (PLACE_PERSISTENT, listeners, ON_*): un empate
 *  dentro no debe generar elección al jugar la carta. */
const DEFERRED_EFFECT_WRAPPERS = new Set([
  'PLACE_PERSISTENT',
  'REGISTER_LISTENER',
  'ON_DEFEAT',
  'ON_ENEMY_DEFEATED',
  'ON_HORDE_ATTACK',
]);

/** Itera los efectos que se ejecutan SINCRÓNICAMENTE al resolver una
 *  lista: el nivel raíz y las ramas internas de CONDITIONAL (then/else),
 *  REPEAT/FOR_EACH/TRY_EFFECT (effects/onFailure) y DRAW_AND_CHECK
 *  (onMatch/onMismatch). Las ramas diferidas (persistentes, listeners,
 *  CHOOSE_ONE.options — que ya genera su propia elección) se ignoran. */
function* walkEffects(effects: readonly unknown[]): Generator<CardEffect> {
  for (const raw of effects) {
    if (!raw || typeof raw !== 'object') continue;
    const eff = raw as CardEffect & Record<string, unknown>;
    yield eff;
    for (const key of ['then', 'else', 'onMatch', 'onMismatch', 'onFailure'] as const) {
      const nested = eff[key];
      if (Array.isArray(nested)) yield* walkEffects(nested);
    }
    const nested = eff.effects;
    if (!DEFERRED_EFFECT_WRAPPERS.has(eff.type) && Array.isArray(nested)) {
      yield* walkEffects(nested);
    }
  }
}

/**
 * Detectar empates en selectores que requieren eleccion del jugador.
 * Si hay empate, devuelve un PendingChoice para que el jugador decida.
 */
/** Selectores de héroe cuyo empate requiere decisión del jugador (E-7):
 *  antes solo DEAL_DAMAGE_TO_HERO+HERO_WITH_FEWEST_WOUNDS creaba una
 *  pendingChoice; GAIN_COINS/STEAL_COINS/INTERCEPT_DAMAGE/TAKE_WOUNDS
 *  con los mismos selectores caían al fallback determinista silencioso. */
const HERO_TIE_STATS = {
  HERO_WITH_FEWEST_WOUNDS: 'WOUNDS',
  HERO_WITH_MOST_WOUNDS: 'WOUNDS',
  HERO_WITH_MOST_GLORY: 'GLORY',
  HERO_WITH_MOST_COINS: 'COINS',
} as const;

function heroTieCandidates(
  kind: keyof typeof HERO_TIE_STATS,
  state: GameState,
  ctx: Pick<ResolutionContext, 'activePlayerId' | 'cardsPlayedThisTurn'>,
): string[] {
  const all = state.playerOrder;
  if (all.length === 0) return [];
  const stat = HERO_TIE_STATS[kind];
  const statCtx = { ...ctx, cardsPlayedThisTurn: ctx.cardsPlayedThisTurn } as ResolutionContext;
  const values = all.map(id => heroStatValue(stat, state.players[id], statCtx));
  const extreme = kind === 'HERO_WITH_FEWEST_WOUNDS'
    ? Math.min(...values)
    : Math.max(...values);
  return all.filter((_, i) => values[i] === extreme);
}

function detectTieForChoice(
  state: GameState,
  cardDef: CardDefinition,
  player: PlayerState,
): PendingChoice | null {
  const effects = cardDef.effects ?? [];
  const tieCtx = {
    activePlayerId: player.playerId,
    cardsPlayedThisTurn: player.cardsPlayedThisTurn,
  };
  for (const eff of walkEffects(effects)) {
    // E-7: cualquier campo hero-typed (target/from/hero) con selector
    // estadístico en empate → SELECT_HERO, sea cual sea el tipo de efecto.
    for (const field of ['target', 'from', 'hero'] as const) {
      const sel = field in eff ? (eff as Record<string, unknown>)[field] : undefined;
      if (typeof sel !== 'object' || sel === null || !('kind' in sel)) continue;
      const kind = (sel as { kind: string }).kind;
      // INTERCEPT_DAMAGE from:OTHER_HERO consume UN solo héroe (el handler
      // toma el primero) — es una elección libre, no un empate: ofrecerla
      // al jugador en vez de interceptar al primero de playerOrder.
      if (eff.type === 'INTERCEPT_DAMAGE' && field === 'from' && kind === 'OTHER_HERO') {
        const options = state.playerOrder.filter(id => id !== player.playerId);
        if (options.length > 1) {
          return {
            choiceId: `intercept-hero-${cardDef.id}-${nextSeq()}`,
            playerId: player.playerId,
            type: 'SELECT_HERO',
            prompt: `${cardDef.name}: Elige el héroe cuyo daño interceptas`,
            options,
            minSelections: 1,
            maxSelections: 1,
          };
        }
        continue;
      }
      if (!(kind in HERO_TIE_STATS)) continue;
      const candidates = heroTieCandidates(kind as keyof typeof HERO_TIE_STATS, state, tieCtx);
      if (candidates.length > 1) {
        const statLabel = kind === 'HERO_WITH_FEWEST_WOUNDS' ? 'menos Heridas'
          : kind === 'HERO_WITH_MOST_WOUNDS' ? 'más Heridas'
          : kind === 'HERO_WITH_MOST_GLORY' ? 'más Gloria' : 'más Monedas';
        return {
          choiceId: `tie-hero-${cardDef.id}-${nextSeq()}`,
          playerId: player.playerId,
          type: 'SELECT_HERO',
          prompt: `${cardDef.name}: Elige el héroe con ${statLabel} (empate)`,
          options: candidates,
          minSelections: 1,
          maxSelections: 1,
        };
      }
    }
    // ENEMY_WITH_MAX_FORTITUDE: empate en fortaleza
    if ('target' in eff && eff.target && typeof eff.target === 'object' && eff.target.kind === 'ENEMY_WITH_MAX_FORTITUDE') {
      if (state.battlefield.length === 0) continue;
      const maxFort = Math.max(...state.battlefield.map(e => getEffectiveFortitude(e, state)));
      const candidates = state.battlefield.filter(e => getEffectiveFortitude(e, state) === maxFort);
      if (candidates.length > 1) {
        return {
          choiceId: `tie-enemy-${cardDef.id}-${nextSeq()}`,
          playerId: player.playerId,
          type: 'SELECT_ENEMY',
          prompt: `${cardDef.name}: Elige el enemigo con más Fortaleza (empate)`,
          options: candidates.map(e => e.instanceId),
          minSelections: 1,
          maxSelections: 1,
        };
      }
    }
  }
  return null;
}

export interface ResolveResult {
  events: GameEvent[];
  newState: GameState;
  /** Enemigos derrotados durante esta resolucion */
  enemiesDefeated: string[];
  /** Cartas adicionales jugadas (para Disparo Rapido) */
  additionalCardsPlayed: string[];
  /** Eleccion pendiente si se detecto un empate que requiere decision del jugador */
  pendingChoice?: PendingChoice;
}

/**
 * Resolver una carta jugada: ejecutar todos sus efectos en orden,
 * procesar disparadores reactivos, y aplicar los eventos al estado.
 */
export function resolveCard(
  state: GameState,
  card: CardInstance,
  cardDef: CardDefinition,
  targetEnemyId: string | null,
  player: PlayerState,
  rng: DeterministicRng,
  registry: EffectRegistry,
  catalog: CatalogLoadResult,
  chosenHeroTarget?: string | null,
  chosenEnemyTarget?: string | null,
  chosenWearCardId?: string | null,
): ResolveResult {
  const allEvents: GameEvent[] = [];
  const enemiesDefeated: string[] = [];
  const additionalCardsPlayed: string[] = [];
  let currentState = state;

  // Contexto de resolucion (construido temprano para pendingChoice)
  const ctx: ResolutionContext = {
    activePlayerId: player.playerId,
    currentCardId: card.definitionId,
    currentCardName: cardDef.name,
    currentCardInstanceId: card.instanceId,
    selectedEnemyId: targetEnemyId,
    cardsPlayedThisTurn: { ...player.cardsPlayedThisTurn },
    cardsPlayedAgainstEnemy: { ...player.cardsPlayedAgainstEnemy },
    drawnCardInstanceId: null,
    sourceZone: 'HAND',
    enemiesDefeatedThisResolution: enemiesDefeated,
    depth: 0,
    chosenHeroTarget: chosenHeroTarget ?? null,
    chosenEnemyTarget: chosenEnemyTarget ?? null,
    opsUsed: 0,
    destinationAfterUse: cardDef.destinationAfterUse,
  };

  // Pre-escanear empates en selectores que requieren eleccion del jugador
  if (chosenHeroTarget === undefined && chosenEnemyTarget === undefined) {
    const tieChoice = detectTieForChoice(state, cardDef, player);
    if (tieChoice) {
      tieChoice.resolutionContext = ctx;
      return {
        events: [],
        newState: state,
        enemiesDefeated,
        additionalCardsPlayed,
        pendingChoice: tieChoice,
      };
    }
  }

  // Pre-escanear SEARCH_WEAR_PILE_PUT_IN_HAND: si hay mas de 1 carta en desgaste,
  // el jugador debe elegir (spec: "Busca una carta en tu pila de Desgaste")
  if (chosenWearCardId === undefined) {
    const hasSearchWear = cardDef.effects?.some(e => e.type === 'SEARCH_WEAR_PILE_PUT_IN_HAND');
    if (hasSearchWear) {
      const wearPile = player.wearPile;
      if (wearPile.length > 1) {
        const wearChoice: PendingChoice = {
          choiceId: `wear-${nextSeq()}`,
          playerId: player.playerId,
          type: 'SELECT_CARD_FROM_WEAR',
          prompt: `Elige una carta de tu pila de Desgaste para ${cardDef.name}`,
          options: wearPile.map(c => c.instanceId),
          minSelections: 1,
          maxSelections: 1,
          resolutionContext: ctx,
        };
        return {
          events: [],
          newState: state,
          enemiesDefeated,
          additionalCardsPlayed,
          pendingChoice: wearChoice,
        };
      }
    }
  } else {
    ctx.chosenWearCardId = chosenWearCardId;
  }

  // Evento: carta jugada
  allEvents.push({
    type: 'CARD_PLAYED',
    playerId: player.playerId,
    cardInstanceId: card.instanceId,
    cardDefinitionId: card.definitionId,
    cardName: cardDef.name,
    targetEnemyInstanceId: targetEnemyId ?? undefined,
    seq: nextSeq(),
  });

  // Bus: configurar con el estado actual
  const bus = new EventBus(registry, rng);
  bus.setState(currentState);

  // 1. Dano impreso de la carta (si tiene printedAttack > 0)
  // Excepcion: si la carta define su dano mediante efectos (SPLIT, ALL, TO_HERO),
  // no aplicar printedAttack al target unico (se aplicaria dos veces)
  const hasSpecialDamageEffect = cardDef.effects.some(
    e => e.type === 'DEAL_DAMAGE_SPLIT' || e.type === 'DEAL_DAMAGE_ALL_ENEMIES' || e.type === 'DEAL_DAMAGE_TO_HERO' || e.type === 'DEAL_DAMAGE_TO_OTHER_HEROES'
  );
  if (cardDef.printedAttack && cardDef.printedAttack > 0 && targetEnemyId && !hasSpecialDamageEffect) {
    let damage = cardDef.printedAttack;

    // Golpe de Baston: si ya se uso contra este enemigo, dano base = 2
    // D428: identificar por definitionId estable (cardsPlayedAgainstEnemy indexa por definitionId)
    if (cardDef.id === 'mage.staff-strike' && targetEnemyId) {
      const usedAgainst = ctx.cardsPlayedAgainstEnemy[targetEnemyId]?.['mage.staff-strike']
        ?? ctx.cardsPlayedAgainstEnemy[targetEnemyId]?.['Golpe de Bastón'] ?? 0;
      if (usedAgainst > 0) {
        damage = 2;
      }
    }

    // Ballesta Precisa: si ya se uso contra este enemigo, dano base = 3
    if (cardDef.id === 'rogue.precise-crossbow' && targetEnemyId) {
      const usedAgainst = ctx.cardsPlayedAgainstEnemy[targetEnemyId]?.['rogue.precise-crossbow']
        ?? ctx.cardsPlayedAgainstEnemy[targetEnemyId]?.['Ballesta Precisa'] ?? 0;
      if (usedAgainst > 0) {
        damage = 3;
      }
    }

    // Aplicar modificadores de dano del turno (Piedra de Amolar)
    damage = applyDamageModifiers(damage, cardDef.name, player);

    // scope NEXT_CARD: el bonus se consume tras beneficiar a la primera
    // carta que casa el filtro — MODIFIER_EXPIRED hace el consumo visible
    // en el eventLog (replay fiel: el fold lo reproduce igual).
    for (const mod of player.modifiers) {
      if (mod.layer !== 'DAMAGE_BONUS' || mod.scope !== 'NEXT_CARD') continue;
      if (mod.filter?.name && mod.filter.name !== cardDef.name) continue;
      const expiry: GameEvent = {
        type: 'MODIFIER_EXPIRED',
        modifierId: mod.id,
        seq: nextSeq(),
      };
      allEvents.push(expiry);
      currentState = applyEventInline(currentState, expiry);
    }

    // Aplicar penalizacion de capacidad (especificacion 3.5)
    // Si el heroe tiene un icono con penalizacion, restar del dano
    // Ej: Picaro con armas a distancia resta 1
    // No se aplica la penalizacion si el heroe posee otro icono requerido sin penalizacion
    if (cardDef.penaltyCapabilities && cardDef.penaltyCapabilities.length > 0) {
      for (const penalty of cardDef.penaltyCapabilities) {
        if (player.capabilities.includes(penalty.icon)) {
          // Verificar si el heroe tiene algun capability requerido que NO este en penaltyCapabilities
          const hasNonPenaltyMatch = player.capabilities.some(cap =>
            cardDef.requiredCapabilities?.includes(cap) &&
            !cardDef.penaltyCapabilities?.some(p => p.icon === cap)
          );
          if (!hasNonPenaltyMatch) {
            damage = Math.max(0, damage - penalty.damagePenalty);
          }
        }
      }
    }

    // Aplicar vulnerabilidad del enemigo
    const enemy = currentState.battlefield.find(e => e.instanceId === targetEnemyId);
    if (enemy) {
      const vulnMods = enemy.modifiers.filter(m => m.layer === 'DAMAGE_BONUS');
      for (const mod of vulnMods) {
        damage += mod.amount;
      }
    }

    allEvents.push({
      type: 'DAMAGE_DEALT',
      targetId: targetEnemyId,
      amount: damage,
      sourceCardInstanceId: card.instanceId,
      seq: nextSeq(),
    });

    // Aplicar el dano al estado intermedio para que los efectos posteriores
    // (como Todo o Nada) vean las heridas actualizadas al reevaluar derrota
    currentState = applyEventInline(currentState, {
      type: 'DAMAGE_DEALT',
      targetId: targetEnemyId,
      amount: damage,
      sourceCardInstanceId: card.instanceId,
      seq: nextSeq(),
    });

    // (La Gloria especial del Señor y las pericias de Gurdrug/Shriekknifer
    // se procesan tras todos los efectos en el bloque post-efectos)

    // Comprobar si el enemigo es derrotado (currentState ya tiene el daño aplicado)
    const enemyAfter = currentState.battlefield.find(e => e.instanceId === targetEnemyId);
    if (enemyAfter && enemyAfter.wounds >= getEffectiveFortitude(enemyAfter, currentState)) {
      // Emitir ENEMY_DEFEATED + invocar escenario
      currentState = emitEnemyDefeated(
        currentState, targetEnemyId, player.playerId, enemiesDefeated, allEvents, catalog, ctx,
      );

      // Ejecutar efectos ON_DEFEAT de la carta
      for (const effect of cardDef.effects) {
        if (effect.type === 'ON_DEFEAT') {
          const onDefeatEvents = executeEffectChain(
            effect.effects,
            ctx,
            currentState,
            rng,
            registry,
            catalog,
            0,
          );
          allEvents.push(...onDefeatEvents.events);
          currentState = onDefeatEvents.state;
        }
      }
    }
  }

  // 2. Ejecutar efectos de la carta (excluyendo ON_DEFEAT que ya se procesaron)
  for (let ei = 0; ei < cardDef.effects.length; ei++) {
    const effect = cardDef.effects[ei];
    if (effect.type === 'ON_DEFEAT' || effect.type === 'ON_HORDE_ATTACK') continue;

    // CHOOSE_ONE (Taller §9.11): pausar la resolucion y pedir la eleccion.
    // Las ramas y los efectos restantes viajan en resolutionContext para que
    // RESOLVE_CHOICE continúe de forma determinista.
    if (effect.type === 'CHOOSE_ONE') {
      ctx.pendingEffects = cardDef.effects.slice(ei + 1);
      ctx.choiceEffects = effect.options.map(o => o.effects);
      const labels = effect.options.map((o, i) => o.label ?? `Opción ${i + 1}`);
      if (effect.optional) {
        ctx.choiceEffects.push([]);
        labels.push('No hacer nada');
      }
      return {
        events: allEvents,
        newState: currentState,
        enemiesDefeated,
        additionalCardsPlayed,
        pendingChoice: {
          choiceId: `choose-${card.instanceId}-${nextSeq()}`,
          playerId: player.playerId,
          type: 'CHOOSE_EFFECT',
          prompt: effect.prompt ?? `${cardDef.name}: elige un efecto`,
          options: labels,
          minSelections: 1,
          maxSelections: 1,
          resolutionContext: ctx,
        },
      };
    }

    if (effect.type === 'DISCARD_FROM_HAND') {
      // Descarte con elección del jugador: pausar la resolución y pedir
      // qué cartas de la mano descartar (Taller). RESOLVE_CHOICE las mueve
      // al Desgaste y continúa con los efectos restantes.
      const count = Math.max(0, evalValue(effect.count, ctx, currentState));
      const eligible = currentState.players[player.playerId].hand
        .filter(c => c.instanceId !== card.instanceId)
        .map(c => c.instanceId);
      if (count <= 0 || eligible.length === 0) continue;
      ctx.pendingEffects = cardDef.effects.slice(ei + 1);
      return {
        events: allEvents,
        newState: currentState,
        enemiesDefeated,
        additionalCardsPlayed,
        pendingChoice: {
          choiceId: `fx-discard-${card.instanceId}-${nextSeq()}`,
          playerId: player.playerId,
          type: 'SELECT_CARD_FROM_HAND',
          prompt: `${cardDef.name}: descarta ${count} carta(s)`,
          options: eligible,
          minSelections: Math.min(count, eligible.length),
          maxSelections: Math.min(count, eligible.length),
          resolutionContext: ctx,
        },
      };
    }

    if (effect.type === 'PLAY_RANDOM_CARD_FROM_OTHER_HERO') {
      // La carta robada se JUEGA de verdad (misma mecánica que la ruta
      // tears-hero-* de resolveChoice): antes el handler solo la movía a
      // la mano del lanzador y la dejaba allí sin resolver sus efectos.
      // Ahora se resuelve recursivamente como si la hubiera jugado el
      // jugador activo, y el destino (Desgaste del propietario real,
      // REMOVED_FROM_GAME, etc.) lo decide el resolveCard anidado.
      const costGlory = evalValue(
        effect.costGlory ?? effect.cost_glory ?? { kind: 'CONSTANT', value: 0 },
        ctx, currentState);
      const actor = currentState.players[player.playerId];
      if (!actor || actor.glory < costGlory) continue;
      const others = currentState.playerOrder
        .filter(pid => pid !== player.playerId)
        .map(pid => currentState.players[pid])
        .filter(p => p && p.hand.length > 0);
      if (others.length === 0) continue;
      // Solo se paga la Gloria si realmente hay una carta que tomar.
      if (costGlory > 0) {
        const costEvent: GameEvent = {
          type: 'GLORY_LOST',
          playerId: player.playerId,
          amount: costGlory,
          seq: nextSeq(),
        };
        allEvents.push(costEvent);
        currentState = applyEventInline(currentState, costEvent);
      }
      const owner = rng.pick(others);
      const stolen = rng.pick(owner.hand);
      const stolenDef = catalog.byId.get(stolen.definitionId);
      if (!stolenDef) continue;
      // La carta NO sale de la mano del propietario: resolveCard la
      // "juega" en su sitio y el CARD_MOVED de destino la retira de la
      // mano del dueño a SU Desgaste (moveCard busca la zona real).
      const sub = resolveCard(
        currentState,
        stolen,
        stolenDef,
        null,
        currentState.players[player.playerId],
        rng, registry, catalog,
      );
      allEvents.push(...sub.events);
      currentState = sub.newState;
      enemiesDefeated.push(...sub.enemiesDefeated);
      additionalCardsPlayed.push(...sub.additionalCardsPlayed);
      if (sub.pendingChoice) {
        return {
          events: allEvents,
          newState: currentState,
          enemiesDefeated,
          additionalCardsPlayed,
          pendingChoice: sub.pendingChoice,
        };
      }
      continue;
    }

    if (effect.type === 'LOOK_AT_CARDS' && effect.action === 'REORDER') {
      // Mira y reordena la Horda (Taller): el handler del registry solo
      // revelaba las cartas y el reorden nunca se pedía — sin el
      // pendingChoice el jugador las veía pero no podía ordenarlas.
      const count = Math.max(0, evalValue(effect.amount, ctx, currentState));
      const bottom = currentState.hordeDeck.slice(-count);
      if (bottom.length === 0) continue;
      allEvents.push({
        type: 'CARDS_REVEALED_TO_PLAYER',
        playerId: player.playerId,
        cardInstanceIds: bottom.map(c => c.instanceId),
        deck: 'HORDE',
        seq: nextSeq(),
      });
      ctx.pendingEffects = cardDef.effects.slice(ei + 1);
      return {
        events: allEvents,
        newState: currentState,
        enemiesDefeated,
        additionalCardsPlayed,
        pendingChoice: {
          choiceId: `look-${card.instanceId}-${nextSeq()}`,
          playerId: player.playerId,
          type: 'SELECT_ORDER',
          prompt: `${cardDef.name}: reordena las ${bottom.length} cartas inferiores de la Horda`,
          options: bottom.map(c => c.instanceId),
          minSelections: bottom.length,
          maxSelections: bottom.length,
          resolutionContext: ctx,
        },
      };
    }

    if (effect.type === 'DRAW_AND_ADD_ATTACK') {
      // Todo o Nada: robar 1 carta, sumar su dano al ataque, recuperar al fondo
      // D434: si el mazo se agota, Herida + reciclaje de Desgaste (spec §3.10)
      const drawCount = evalValue(effect.amount, ctx, currentState);
      const drawResult = drawCardsWithReshuffle(player.playerId, drawCount, currentState, rng, nextSeq);
      allEvents.push(...drawResult.events);
      // Aplicar el robo (y posible reciclaje) al estado intermedio
      for (const ev of drawResult.events) {
        currentState = applyEventInline(currentState, ev);
      }
      for (const drawnCard of drawResult.drawn) {
        const drawnDef = catalog.byId.get(drawnCard.definitionId);
        const extraDamage = drawnDef?.printedAttack ?? 0;
        // Sumar dano al objetivo actual
        if (extraDamage > 0 && targetEnemyId) {
          allEvents.push({
            type: 'DAMAGE_DEALT',
            targetId: targetEnemyId,
            amount: extraDamage,
            sourceCardInstanceId: drawnCard.instanceId,
            seq: nextSeq(),
          });
          // NOTA: La carta robada por Todo o Nada NO se juega, solo suma su ataque.
          // Por tanto NO genera Gloria del Señor de la Guerra (§3.7: 1 Gloria por carta jugada).
          // Aplicar al estado intermedio
          currentState = applyEventInline(currentState, {
            type: 'DAMAGE_DEALT',
            targetId: targetEnemyId,
            amount: extraDamage,
            sourceCardInstanceId: drawnCard.instanceId,
            seq: nextSeq(),
          });
          // Comprobar derrota (applyEventInline ya sumó extraDamage a wounds)
          currentState = emitEnemyDefeated(
            currentState, targetEnemyId, player.playerId, enemiesDefeated, allEvents, catalog, ctx,
          );
        }
        // Recuperar la carta robada al fondo del mazo
        allEvents.push({
          type: 'CARD_MOVED',
          cardInstanceId: drawnCard.instanceId,
          from: 'HAND',
          to: 'ABILITY_DECK',
          playerId: player.playerId,
  seq: nextSeq(),
        });
        currentState = {
          ...currentState,
          players: {
            ...currentState.players,
            [player.playerId]: {
              ...currentState.players[player.playerId],
              // Quitar de la mano además de añadir al mazo — si no, la
              // carta existe en ambas zonas hasta que se aplique el
              // CARD_MOVED (DISCARD_FROM_HAND la ofrecería, etc.).
              hand: currentState.players[player.playerId].hand
                .filter(c => c.instanceId !== drawnCard.instanceId),
              abilityDeck: [
                ...currentState.players[player.playerId].abilityDeck,
                { ...drawnCard, zone: 'ABILITY_DECK' as Zone },
              ],
            },
          },
        };
      }
      continue;
    }

    if (effect.type === 'DRAW_AND_CHECK') {
      // Disparo Rapido: logica especial de cadena
      const chainResult = resolveRapidShot(
        currentState,
        card,
        cardDef,
        targetEnemyId,
        player,
        rng,
        registry,
        catalog,
        ctx,
        0,
        enemiesDefeated, // heredar enemigos ya derrotados
      );
      allEvents.push(...chainResult.events);
      currentState = chainResult.state;
      additionalCardsPlayed.push(...chainResult.additionalCardsPlayed);
      enemiesDefeated.push(...chainResult.enemiesDefeated);
      // D434: propagar eleccion pendiente (opt-in de Beleth-Il)
      if (chainResult.pendingChoice) {
        return {
          events: allEvents,
          newState: currentState,
          enemiesDefeated,
          additionalCardsPlayed,
          pendingChoice: chainResult.pendingChoice,
        };
      }
      continue;
    }

    if (effect.type === 'PLACE_PERSISTENT') {
      // Trampa: colocar carta persistente
      allEvents.push({
        type: 'PERSISTENT_CARD_PLACED',
        playerId: player.playerId,
        cardInstanceId: card.instanceId,
        cardDefinitionId: card.definitionId,
        trigger: effect.trigger,
        seq: nextSeq(),
      });
      // No mover a desgaste; queda frente al jugador
      continue;
    }

    if (effect.type === 'SWAP_ENEMY') {
      // Supervivencia: intercambiar enemigo en campo por el del fondo del mazo de la Horda.
      // El Taller permite otros selectores (antes caían a `null` y el
      // efecto se descartaba entero sin aviso).
      const targetId = effect.target.kind === 'SELECTED_ENEMY'
        ? targetEnemyId
        : resolveTarget(effect.target, ctx, currentState);
      if (!targetId || currentState.hordeDeck.length === 0) continue;
      const newEnemyCard = currentState.hordeDeck[currentState.hordeDeck.length - 1];
      const newEnemyDef = catalog.byId.get(newEnemyCard.definitionId);
      if (!newEnemyDef) continue;
      allEvents.push({
        type: 'ENEMY_SWAPPED',
        oldEnemyInstanceId: targetId,
        newEnemyInstanceId: newEnemyCard.instanceId,
        newEnemyDefinitionId: newEnemyCard.definitionId,
        newEnemyFortitude: newEnemyDef.printedFortitude ?? 1,
        // La recompensa impresa se persiste como en ENEMY_SPAWNED —
        // la proyección la redacta en el campo de batalla; con null el
        // sustituto pagaba {0,0} al ser derrotado.
        newEnemyReward: newEnemyDef.reward ?? null,
        newEnemyIsOrc: newEnemyDef.isOrc ?? false,
        newEnemyIsWarlord: newEnemyDef.type === 'WARLORD',
        newEnemySpecialIcons: newEnemyDef.specialIcons ?? [],
        seq: nextSeq(),
      });
      continue;
    }

    if (effect.type === 'SPAWN_ENEMY') {
      // Invocar enemigos del mazo de la Horda (se roba desde el FONDO).
      // El resolver lo intercepta porque necesita el catálogo para los stats.
      const spawned = currentState.hordeDeck.slice(-effect.count);
      for (const spawnCard of spawned) {
        const spawnDef = catalog.byId.get(spawnCard.definitionId);
        if (!spawnDef) continue;
        allEvents.push({
          type: 'ENEMY_SPAWNED',
          enemyInstanceId: spawnCard.instanceId,
          enemyDefinitionId: spawnCard.definitionId,
          enemyFortitude: spawnDef.printedFortitude ?? 1,
          enemyReward: spawnDef.reward ?? null,
          enemyIsOrc: spawnDef.isOrc ?? false,
          enemyIsWarlord: spawnDef.type === 'WARLORD',
          enemySpecialIcons: spawnDef.specialIcons ?? [],
          seq: nextSeq(),
        });
        if (spawnDef.type === 'WARLORD') {
          allEvents.push({
            type: 'WARLORD_REVEALED',
            warlordInstanceId: spawnCard.instanceId,
            definitionId: spawnCard.definitionId,
            seq: nextSeq(),
          });
        }
      }
      continue;
    }

    if (effect.type === 'MODIFY_DAMAGE') {
      // Piedra de Amolar: anadir modificador de dano al jugador
      const modifierAmount = evalValue(effect.modifier, ctx, currentState);
      // El modificador se aplica via PlayerState.modifiers
      // Lo manejamos anadiendolo al estado del jugador
      const modId = `mod-${nextSeq()}`;
      allEvents.push({
        type: 'MODIFIER_ADDED',
        modifierId: modId,
        targetId: player.playerId,
        layer: 'DAMAGE_BONUS',
        amount: modifierAmount,
        sourceId: card.instanceId,
        duration: 'UNTIL_END_OF_TURN',
        filter: effect.filter,
        scope: effect.scope,
        seq: nextSeq(),
      });
      // Actualizar estado: anadir modificador al jugador
      currentState = {
        ...currentState,
        players: {
          ...currentState.players,
          [player.playerId]: {
            ...currentState.players[player.playerId],
            modifiers: [
              ...currentState.players[player.playerId].modifiers,
              {
                id: modId,
                sourceId: card.instanceId,
                layer: 'DAMAGE_BONUS',
                timestamp: nextSeq(),
                duration: 'UNTIL_END_OF_TURN',
                amount: modifierAmount,
                filter: effect.filter,
                scope: effect.scope,
              },
            ],
          },
        },
      };
      continue;
    }

    if (effect.type === 'MODIFY_FORTITUDE') {
      // Ruinas de Brunmar / Roghkiller: modificar fortaleza de enemigos
      const modifierAmount = evalValue(effect.modifier, ctx, currentState);
      // Manejar ALL_ENEMIES: aplicar a todos los enemigos del campo,
      // respetando el filtro si el target lo lleva (p.ej. Roghkiller: solo orcos)
      let targetIds: string[];
      if (effect.target.kind === 'ALL_ENEMIES') {
        const filter = (effect.target as { filter?: { isOrc?: boolean; isWarlord?: boolean } }).filter;
        targetIds = currentState.battlefield
          .filter(e => {
            if (!filter) return true;
            if (filter.isOrc !== undefined && e.isOrc !== filter.isOrc) return false;
            if (filter.isWarlord !== undefined && e.isWarlord !== filter.isWarlord) return false;
            return true;
          })
          .map(e => e.instanceId);
      } else {
        targetIds = [resolveTarget(effect.target, ctx, currentState)].filter((id): id is string => id !== null);
      }
      for (const targetId of targetIds) {
        const modId = `fort-mod-${nextSeq()}`;
        allEvents.push({
          type: 'MODIFIER_ADDED',
          modifierId: modId,
          targetId,
          layer: 'FORTITUDE_MODIFIERS',
          amount: modifierAmount,
          sourceId: card.instanceId,
          duration: effect.duration,
          seq: nextSeq(),
        });
        // Aplicar al estado intermedio: solo añadir el modificador, NO mutar baseFortitude
        currentState = {
          ...currentState,
          battlefield: currentState.battlefield.map(e =>
            e.instanceId === targetId
              ? {
                  ...e,
                  modifiers: [
                    ...e.modifiers,
                    {
                      id: modId,
                      sourceId: card.instanceId,
                      layer: 'FORTITUDE_MODIFIERS',
                      timestamp: nextSeq(),
                      duration: effect.duration,
                      amount: modifierAmount,
                      targetId,
                    },
                  ],
                }
              : e
          ),
        };
      }
      continue;
    }

    if (effect.type === 'MODIFY_MARKET_COST') {
      // Mercado de Lotharion: reducir coste de mercado
      const modifierAmount = evalValue(effect.modifier, ctx, currentState);
      const modId = `market-cost-${nextSeq()}`;
      allEvents.push({
        type: 'MODIFIER_ADDED',
        modifierId: modId,
        targetId: 'market',
        layer: 'MARKET_COST',
        amount: modifierAmount,
        sourceId: card.instanceId,
        duration: 'WHILE_SOURCE_ACTIVE',
        seq: nextSeq(),
      });
      currentState = {
        ...currentState,
        marketCostModifier: currentState.marketCostModifier + modifierAmount,
      };
      continue;
    }

    if (effect.type === 'END_ATTACK') {
      // Escudo: terminar el enfrentamiento y pasar al ataque de la Horda
      allEvents.push({
        type: 'PHASE_CHANGED',
        phase: 'HORDE_ATTACK',
        seq: nextSeq(),
      });
      continue;
    }

    // Efecto normal: delegar al registry (con presupuesto de operaciones)
    let effectEvents: GameEvent[];
    try {
      effectEvents = registry.execute(effect, ctx, currentState, rng, bus);
    } catch (err) {
      if (err instanceof ResolutionBudgetError) {
        allEvents.push({
          type: 'RESOLUTION_HALTED',
          cardInstanceId: card.instanceId,
          reason: err.message,
          seq: nextSeq(),
        });
        break;
      }
      throw err;
    }
    allEvents.push(...effectEvents);

    // Aplicar eventos al estado
    for (const ev of effectEvents) {
      // Si el registry emitió ENEMY_DEFEATED (ej: DEFEAT_ENEMY), capturar enemigo ANTES de aplicar
      const enemyBeforeApply = ev.type === 'ENEMY_DEFEATED'
        ? currentState.battlefield.find(e => e.instanceId === ev.enemyInstanceId)
        : null;
      currentState = applyEventInline(currentState, ev);
      // Oyentes del Taller (REGISTER_LISTENER): disparan sus efectos cuando
      // coincide el tipo de evento. Los eventos que emiten NO vuelven a
      // disparar oyentes (sin cascada — protege de bucles).
      const dispatched = dispatchListeners(currentState, ev, {
        registry, rng, nextSeq,
      });
      if (dispatched.events.length > 0) {
        allEvents.push(...dispatched.events);
        currentState = dispatched.state;
      }
      if (ev.type === 'ENEMY_DEFEATED' && enemyBeforeApply && !enemiesDefeated.includes(ev.enemyInstanceId)) {
        enemiesDefeated.push(ev.enemyInstanceId);
        const scenarioDefId = currentState.scenario?.definitionId;
        if (scenarioDefId) {
          const enemyFortitude = getEffectiveFortitude(enemyBeforeApply, currentState);
          (ctx as any).lastDefeatedEnemyFortitude = enemyFortitude;
          const scenarioEvents = scenarioOnEnemyDefeated(
            currentState, scenarioDefId, ev.defeatingPlayerId, enemyFortitude, catalog,
          );
          allEvents.push(...scenarioEvents);
          for (const sev of scenarioEvents) {
            currentState = applyEventInline(currentState, sev);
          }
        }
      }
    }
  }

  // Tras ejecutar todos los efectos, comprobar si los daños genéricos
  // (DEAL_DAMAGE_SPLIT, DEAL_DAMAGE_ALL, etc.) han derrotado algún enemigo
  for (const enemy of currentState.battlefield) {
    if (enemy.wounds >= getEffectiveFortitude(enemy, currentState)) {
      currentState = emitEnemyDefeated(
        currentState, enemy.instanceId, player.playerId, enemiesDefeated, allEvents, catalog, ctx,
      );
    }
  }

  // Pericias de Señores de la Guerra: procesar tras todos los efectos
  // Buscar DAMAGE_DEALT emitidos contra Señores por esta carta o sus copias (Disparo Rápido)
  const allSourceCardIds = new Set([card.instanceId, ...additionalCardsPlayed]);
  const damageEventsVsWarlord = allEvents.filter(
    (e): e is { type: 'DAMAGE_DEALT'; targetId: string; amount: number; sourceCardInstanceId: string; seq: number } =>
      e.type === 'DAMAGE_DEALT' &&
      allSourceCardIds.has(e.sourceCardInstanceId) &&
      e.amount >= 1
  );
  // Agrupar por Señor (pericias se activan una vez por Señor por carta)
  const warlordsHit = new Set<string>();
  // Gloria: 1 por carta que dañe a cualquier Señor (no por Señor)
  const gloryCards = new Set<string>();
  for (const dmgEv of damageEventsVsWarlord) {
    // Buscar el enemigo en el estado actual O en el original (puede haber sido derrotado)
    let warlord = currentState.battlefield.find(e => e.instanceId === dmgEv.targetId);
    if (!warlord) {
      // Buscar en el estado original (antes de aplicar eventos)
      warlord = state.battlefield.find(e => e.instanceId === dmgEv.targetId);
    }
    if (!warlord?.isWarlord) continue;
    // Gloria: 1 por carta (no por Señor ni por impacto)
    gloryCards.add(dmgEv.sourceCardInstanceId);
    // Pericias: una vez por Señor por carta
    const periciaKey = `${dmgEv.sourceCardInstanceId}-${warlord.instanceId}`;
    if (warlordsHit.has(periciaKey)) continue;
    warlordsHit.add(periciaKey);
    const warlordDef = catalog.byId.get(warlord.definitionId);
    if (!warlordDef) continue;

    // Pericia declarativa del Señor (genérica — los Señores del Taller
    // no necesitan código nuevo). Soportada:
    //   trigger DAMAGE_DEALT → LOSE_CARDS (el dañador pierde N cartas)
    //   trigger CARD_PLAYED  + condición 'printedAttack == N' sobre la
    //     carta origen → RECOVER_CARDS desde la base del desgaste
    //   trigger CONTINUOUS   → aura persistente (Roghkiller, ver setup)
    const peritia = warlordDef.peritia;
    // D435: evaluar la carta ORIGEN de cada DAMAGE_DEALT (en cadenas de
    // Disparo Rapido la carta que daña no es la que se jugó originalmente)
    const playedDefIds = new Map<string, string>();
    for (const ev of allEvents) {
      if (ev.type === 'CARD_PLAYED') {
        playedDefIds.set(ev.cardInstanceId, ev.cardDefinitionId);
      }
    }
    const sourceDefId = playedDefIds.get(dmgEv.sourceCardInstanceId) ?? cardDef.id;
    const sourceDef = catalog.byId.get(sourceDefId);
    // Condición 'printedAttack == N' sobre la carta origen. Si la
    // condición existe pero no casa la gramática soportada, se falla
    // cerrado (condición NO cumplida): antes `condAttack` quedaba
    // undefined y la pericia disparaba siempre, sin aviso.
    const condAttack = peritia?.condition
      ? /^printedAttack\s*==\s*(\d+)$/.exec(peritia.condition)?.[1]
      : undefined;
    const condOk = peritia?.condition
      ? condAttack !== undefined
        && (sourceDef?.printedAttack ?? 0) === Number(condAttack)
      : true;

    if (peritia?.trigger === 'DAMAGE_DEALT' && condOk) {
      for (const eff of peritia.effects) {
        if (eff.type !== 'LOSE_CARDS') continue;
        const n = evalValue(eff.amount, ctx, currentState);
        if (n <= 0) continue;
        // applyHeroDamage maneja mazo vacío (reciclaje + herida)
        const peritiaEvents = applyHeroDamage(player.playerId, n, currentState, rng, nextSeq);
        allEvents.push(...peritiaEvents);
        for (const ev of peritiaEvents) {
          currentState = applyEventInline(currentState, ev);
        }
      }
    }

    if (peritia?.trigger === 'CARD_PLAYED' && condOk) {
      for (const eff of peritia.effects) {
        if (eff.type !== 'RECOVER_CARDS') continue;
        const playerState = currentState.players[player.playerId];
        const n = evalValue(eff.amount, ctx, currentState);
        if (playerState.wearPile.length === 0 || n <= 0) continue;
        // Recuperar de la parte INFERIOR del desgaste (cartas más antiguas)
        const recovered = playerState.wearPile.slice(0, n);
        const recoverEvent = {
          type: 'CARDS_RECOVERED' as const,
          playerId: player.playerId,
          count: recovered.length,
          cardInstanceIds: recovered.map((c) => c.instanceId),
          toZone: 'ABILITY_DECK' as const,
          seq: nextSeq(),
        };
        allEvents.push(recoverEvent);
        currentState = applyEventInline(currentState, recoverEvent);
      }
    }
  }

  // Gloria especial del Señor: 1 Gloria por carta que dañe al Señor (§3.7, DIG-008)
  for (const _cardId of gloryCards) {
    allEvents.push({
      type: 'GLORY_GAINED',
      playerId: player.playerId,
      amount: 1,
      seq: nextSeq(),
    });
  }

  // 3. Mover carta a desgaste (o destino especial)
  // Excepción: si la carta tiene RECOVER_THIS_CARD y se emitió CARDS_RECOVERED para ella,
  // no mover a WEAR_PILE (la carta se recuperó a mano o mazo)
  const wasRecovered = allEvents.some(
    e => e.type === 'CARDS_RECOVERED' && (e as { cardInstanceIds?: string[] }).cardInstanceIds?.includes(card.instanceId)
  );
  if (wasRecovered) {
    // La carta ya fue recuperada por RECOVER_THIS_CARD; no mover a WEAR_PILE
  } else if (cardDef.destinationAfterUse === 'WEAR_PILE') {
    allEvents.push({
      type: 'CARD_MOVED',
      cardInstanceId: card.instanceId,
      from: 'HAND',
      to: 'WEAR_PILE',
      playerId: player.playerId,
  seq: nextSeq(),
    });
  } else if (cardDef.destinationAfterUse === 'REMOVED_FROM_GAME') {
    allEvents.push({
      type: 'CARD_REMOVED_FROM_GAME',
      cardInstanceId: card.instanceId,
      seq: nextSeq(),
    });
  } else if (cardDef.destinationAfterUse === 'IN_FRONT_OF_PLAYER') {
    // Ya se manejo en PLACE_PERSISTENT
  }

  // 4. Aplicar todos los eventos al estado final
  // Nota: empezamos desde el estado original (no currentState) porque
  // los eventos ya se aplicaron incrementalmente a currentState durante
  // la resolucion. Aplicarlos de nuevo desde state asegura consistencia
  // del event sourcing sin doblar efectos.
  let finalState = state;
  for (const ev of allEvents) {
    finalState = applyEventInline(finalState, ev);
  }

  // D434 (spec §6.9 nota Brunmar + caso limite 9): un enemigo que entra en
  // juego durante la resolucion (p.ej. SWAP_ENEMY/Supervivencia) con Heridas
  // >= Fortaleza efectiva queda derrotado inmediatamente.
  const auraDefeats = checkFortitudeDefeats(finalState, player.playerId, nextSeq);
  for (const ev of auraDefeats) {
    allEvents.push(ev);
    if (ev.type === 'ENEMY_DEFEATED') enemiesDefeated.push(ev.enemyInstanceId);
    finalState = applyEventInline(finalState, ev);
  }

  return {
    events: allEvents,
    newState: finalState,
    enemiesDefeated,
    additionalCardsPlayed,
  };
}

// ============================================================================
// Helpers
// ============================================================================

export function applyDamageModifiers(baseDamage: number, cardName: string, player: PlayerState): number {
  let damage = baseDamage;
  for (const mod of player.modifiers) {
    if (mod.layer !== 'DAMAGE_BONUS') continue;
    if (mod.filter?.name && mod.filter.name !== cardName) continue;
    damage += mod.amount;
  }
  return Math.max(0, damage);
}

export function applyEventInline(state: GameState, event: GameEvent): GameState {
  return applyEvent(state, event);
}

// ============================================================================
// Ejecutar cadena de efectos con limite de recursion
// ============================================================================

export function executeEffectChain(
  effects: CardEffect[],
  ctx: ResolutionContext,
  state: GameState,
  rng: DeterministicRng,
  registry: EffectRegistry,
  _catalog: CatalogLoadResult,
  depth: number,
): { events: GameEvent[]; state: GameState } {
  if (depth >= MAX_EFFECT_RECURSION) {
    return { events: [], state };
  }

  const allEvents: GameEvent[] = [];
  let currentState = state;
  const bus = new EventBus(registry, rng);
  bus.setState(currentState);

  for (const effect of effects) {
    let events: GameEvent[];
    try {
      events = registry.execute(effect, ctx, currentState, rng, bus);
    } catch (err) {
      if (err instanceof ResolutionBudgetError) {
        allEvents.push({
          type: 'RESOLUTION_HALTED',
          cardInstanceId: ctx.currentCardInstanceId,
          reason: err.message,
          seq: nextSeq(),
        });
        break;
      }
      throw err;
    }
    allEvents.push(...events);
    for (const ev of events) {
      currentState = applyEventInline(currentState, ev);
    }
  }

  return { events: allEvents, state: currentState };
}
