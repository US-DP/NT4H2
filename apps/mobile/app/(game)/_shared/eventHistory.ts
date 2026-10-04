/**
 * Historial de partida: convierte GameEvents en entradas legibles.
 * Extraido de app/(game)/index.tsx.
 */

import type { TFunction } from 'i18next';
import type { GameEvent, GameState } from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import type { HistoryEntry } from '../../components/ActionHistory';

// ============================================================================
// Historial de acciones â€” mapea eventos del motor a HistoryEntry (UI-170..174)
// ============================================================================

const HISTORY_PHASE_KEYS: Record<string, string> = {
  SETUP: 'gm.histPhaseSetup',
  INITIAL_PLAYER_SELECTION: 'gm.histPhaseLeaderSelect',
  ATTACK_CHOICE: 'gm.histPhaseAttackChoice',
  PLAYER_ATTACK: 'gm.histPhasePlayerAttack',
  HORDE_ATTACK: 'gm.histPhaseHordeAttack',
  MARKET: 'gm.histPhaseMarket',
  RESTORATION: 'gm.histPhaseRestoration',
  FINISHED: 'gm.histPhaseFinished',
};

export function cardName(catalog: CatalogLoadResult | null, definitionId: string | undefined): string {
  if (!definitionId) return 'â€”';
  return catalog?.byId.get(definitionId)?.name ?? definitionId;
}

export function buildHistoryEntries(
  events: GameEvent[],
  catalog: CatalogLoadResult | null,
  t: TFunction,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let turn = 1;
  const turnStartIdx = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const entry = eventToHistoryEntry(e, turn, catalog, t);
    // Eventos sin actor (fases, sistema) se marcan como globales para que el
    // filtro por jugador no los oculte (UI-172)
    if (entry && entry.actor === 'â€”') entry.global = true;
    if (entry) entries.push(entry);
    if (e.type === 'TURN_STARTED') turn = e.turnNumber;
    void turnStartIdx;
  }
  return entries;
}

export function eventToHistoryEntry(
  e: GameEvent,
  turn: number,
  catalog: CatalogLoadResult | null,
  t: TFunction,
): HistoryEntry | null {
  const base = { id: `ev-${e.seq}`, turn, timestamp: e.seq };
  const actor = (pid: string | undefined) => pid ?? 'â€”';
  const card = (defId: string | undefined) => cardName(catalog, defId);
  const hero = (pid: string | undefined, state: GameState | null) =>
    pid ? (state?.players[pid]?.heroId ?? pid) : 'â€”';
  void hero;

  switch (e.type) {
    case 'TURN_STARTED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histTurnStarted'), result: t('gm.histTurnN', { n: e.turnNumber }) };
    case 'TURN_ENDED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histTurnEnded'), result: 'â€”' };
    case 'CARD_PLAYED':
      return {
        ...base,
        actor: actor(e.playerId),
        action: t('gm.histCardPlayed'),
        card: e.cardName ?? card(e.cardDefinitionId),
        target: e.targetEnemyInstanceId,
        result: e.cardName ?? card(e.cardDefinitionId),
      };
    case 'DAMAGE_DEALT':
      return { ...base, actor: 'â€”', action: t('gm.histDamageDealt'), target: e.targetId, result: t('gm.histDamageN', { n: e.amount }) };
    case 'ENEMY_DEFEATED':
      return {
        ...base,
        actor: actor(e.defeatingPlayerId),
        action: t('gm.histEnemyDefeated'),
        card: card(e.enemyDefinitionId),
        result: t('gm.histReward', { glory: e.reward.glory, coins: e.reward.coins }),
      };
    case 'HORDE_ATTACKED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histHordeAttack'), result: t('gm.histDamageN', { n: e.totalDamage }) };
    case 'EVASION_PERFORMED':
      return {
        ...base,
        actor: actor(e.playerId),
        action: t('gm.histEvasion'),
        result: t('gm.histDiscardedN', { count: e.discardedCardInstanceIds.length }),
      };
    case 'CARDS_DRAWN':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCardsDrawn'), result: t('gm.histCardsN', { count: e.count }) };
    case 'CARDS_LOST':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCardsLost'), result: t('gm.histCardsN', { count: e.count }) };
    case 'CARDS_RECOVERED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCardsRecovered'), result: t('gm.histCardsN', { count: e.count }) };
    case 'GLORY_GAINED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histGloryGained'), result: `+${e.amount}` };
    case 'GLORY_LOST':
      return { ...base, actor: actor(e.playerId), action: t('gm.histGloryLost'), result: `-${e.amount}` };
    case 'COINS_GAINED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCoins'), result: `${e.amount >= 0 ? '+' : ''}${e.amount}` };
    case 'COINS_STOLEN':
      return { ...base, actor: actor(e.fromPlayerId), action: t('gm.histCoinsStolen'), target: e.toPlayerId, result: `${e.amount}` };
    case 'WOUND_HEALED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histHealing'), result: t('gm.histWoundsHeal', { count: e.amount }) };
    case 'MARKET_PURCHASED':
      return {
        ...base,
        actor: actor(e.playerId),
        action: t('gm.histMarketPurchase'),
        card: card(e.cardInstanceId),
        result: t('gm.histCoinsCost', { cost: e.cost }),
      };
    case 'MARKET_REPLENISHED':
      return { ...base, actor: t('gm.histActorMarket'), action: t('gm.histReplenish'), result: 'â€”' };
    case 'ENEMY_REVEALED':
      return {
        ...base,
        actor: t('gm.histActorHorde'),
        action: t('gm.histEnemyRevealed'),
        card: card(e.definitionId),
        result: t('gm.histFortitudeN', { n: e.fortitude }),
      };
    case 'WARLORD_REVEALED':
      return {
        ...base,
        actor: t('gm.histActorHorde'),
        action: t('gm.histWarlordRevealed'),
        card: card(e.definitionId),
        result: t('gm.histFinalBoss'),
      };
    case 'SCENARIO_REVEALED':
      return { ...base, actor: t('gm.histActorScenario'), action: t('gm.histScenarioRevealed'), card: card(e.definitionId), result: 'â€”' };
    case 'SCENARIO_DISCARDED':
      return { ...base, actor: t('gm.histActorScenario'), action: t('gm.histScenarioDiscarded'), result: 'â€”' };
    case 'PHASE_CHANGED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histPhase'), result: HISTORY_PHASE_KEYS[e.phase] ? t(HISTORY_PHASE_KEYS[e.phase]) : e.phase };
    case 'HERO_ABILITY_USED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histAbilityUsed'), result: t('gm.histUsesLeft', { count: e.usesRemaining }) };
    case 'GAME_ENDED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histGameEnded'), result: e.winnerId ? t('gm.histWinner', { name: e.winnerId }) : t('gm.histCoopDefeat') };
    case 'LEADER_DETERMINED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histLeaderChosen'), result: 'â€”' };
    case 'DECK_EXHAUSTED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histDeckExhausted'), result: t('gm.histWoundRecycle') };
    case 'DECK_RESHUFFLED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histDeckReshuffled'), result: t('gm.histCardsN', { count: e.newDeckSize }) };
    case 'SHIELD_PLACED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histShield'), result: `+${e.amount}` };
    case 'PREVENTION_APPLIED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histPrevention'), result: t('gm.histDamagePrevented', { n: e.amount }) };
    case 'DAMAGE_INTERCEPTED':
      return {
        ...base,
        actor: actor(e.interceptorPlayerId),
        action: t('gm.histInterceptsDamage'),
        target: e.originalTargetPlayerId,
        result: t('gm.histDamageN', { n: e.amount }),
      };
    case 'ENEMY_RETURNED_TO_HORDE':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histEnemyReturned'), result: 'â€”' };
    case 'ENEMY_SWAPPED':
      return {
        ...base,
        actor: t('gm.histActorSystem'),
        action: t('gm.histEnemySwapped'),
        card: card(e.newEnemyDefinitionId),
        result: t('gm.histFortitudeN', { n: e.newEnemyFortitude }),
      };
    case 'VULNERABILITY_APPLIED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histVulnerability'), target: e.enemyInstanceId, result: t('gm.histBonusDamage', { n: e.bonus }) };
    case 'HERO_WOUNDED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histHeroWound'), result: t('gm.histWoundsN', { count: e.woundCount }) };
    case 'CANCELLATION_ACTIVATED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCancellation'), result: 'â€”' };
    case 'PERSISTENT_CARD_PLACED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histPersistentCard'), card: card(e.cardDefinitionId), result: e.trigger };
    case 'PERSISTENT_CARD_REMOVED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histPersistentRemoved'), result: 'â€”' };
    case 'ENEMY_DAMAGE_DISABLED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histEnemyDamageDisabled'), target: e.enemyInstanceId, result: 'â€”' };
    case 'MODIFIER_ADDED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histModifierAdded'), target: e.targetId, result: e.layer };
    case 'MODIFIER_EXPIRED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histModifierExpired'), result: e.modifierId };
    case 'CARD_MOVED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histCardMoved'), result: `${e.from} â†’ ${e.to}` };
    case 'CARD_REMOVED_FROM_GAME':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histCardRemoved'), result: '-' };
    case 'LEADER_TIE_BREAK':
      return { ...base, actor: actor(e.winnerId), action: t('gm.histLeaderTieBreak'), result: e.method === 'AGE' ? t('gm.histTieByAge') : t('gm.histTieRandom') };
    case 'DECK_SHUFFLED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histDeckShuffled'), result: e.deck };
    case 'HORDE_DECK_REORDERED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histHordeReordered'), result: '-' };
    case 'SUPPORT_DECK_OPENED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histSupportDeck'), result: `#${e.supportDeckIndex + 1}` };
    case 'WOUND_PLACED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histWoundPlaced'), target: e.enemyInstanceId, result: `${e.amount}` };
    case 'SHIELD_TRANSFERRED':
      return { ...base, actor: actor(e.fromPlayerId), action: t('gm.histShieldTransferred'), target: e.toPlayerId, result: `${e.amount}` };
    case 'CARDS_REVEALED_TO_PLAYER':
      return { ...base, actor: actor(e.playerId), action: t('gm.histCardsRevealed'), result: t('gm.histCardsN', { count: e.cardInstanceIds.length }) };
    case 'BLOCK_GRANTED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histBlock'), result: t('gm.histBlockNext', { n: e.amount }) };
    case 'BLOCK_CONSUMED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histBlock'), result: t('gm.histBlockConsumed') };
    case 'LISTENER_REGISTERED':
      return { ...base, actor: actor(e.listener.playerId), action: t('gm.histListener'), result: e.listener.trigger };
    case 'LISTENER_REMOVED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histListenerRemoved'), result: '-' };
    case 'VARIABLE_SET':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histVariable'), result: `${e.name} = ${e.value}` };
    case 'RESOLUTION_HALTED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histResolutionHalted'), result: e.reason };
    case 'STATUS_APPLIED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histStatusApplied'), target: e.enemyInstanceId, result: `${e.status} Ã—${e.stacks}` };
    case 'STATUS_REMOVED':
      return { ...base, actor: t('gm.histActorSystem'), action: t('gm.histStatusRemoved'), target: e.enemyInstanceId, result: e.status };
    case 'ARMOR_GRANTED':
      return { ...base, actor: actor(e.playerId), action: t('gm.histArmor'), result: `+${e.amount}` };
    case 'HORDE_CARD_DISCARDED':
      return { ...base, actor: t('gm.histActorHorde'), action: t('gm.histHordeDiscarded'), result: '-' };
    case 'ENEMY_SPAWNED':
      return { ...base, actor: t('gm.histActorHorde'), action: t('gm.histEnemySpawned'), card: card(e.enemyDefinitionId), result: t('gm.histFortitudeN', { n: e.enemyFortitude }) };
    default:
      return null;
  }
}


