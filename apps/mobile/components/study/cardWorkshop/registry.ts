/**
 * cardWorkshop/registry — catálogo declarativo del editor.
 *
 * Extraído de CreateCardTab.tsx (refactor Taller Fase 2). ACTION_DEFS dice
 * qué parámetros pide el editor por cada CardEffect y cómo compilarlo;
 * CONDITIONS/AMOUNT_MODES/selectores definen el vocabulario del editor.
 * Sin React: registro puro.
 */

import type {
  CardEffect,
  Condition,
  TargetSelector,
  ValueExpr,
} from '@nt4h/schema';
import { ValueExprSchema } from '@nt4h/schema';
import { C, num, nextNodeKey, type EffectNode } from './model';

// ============================================================================
// Catalogo de acciones (tipo de efecto -> parametros que pide el editor)
// ============================================================================

export interface ActionDef {
  type: CardEffect['type'];
  /** Clave i18n dentro del namespace workshop. */
  labelKey: string;
  amount?: boolean;      // ValueExpr
  enemyTarget?: boolean; // TargetSelector
  heroTarget?: boolean;  // HeroSelector
  duration?: boolean;
  scope?: boolean;
  to?: boolean;
  resource?: boolean;
  count?: boolean;       // targetCount (DEAL_DAMAGE_SPLIT)
  cardName?: boolean;    // nombre de carta (SEARCH_DECK, RECOVER_CARD_BY_NAME)
  searchAction?: boolean;
  searchDeck?: boolean;
  inherit?: boolean;     // PLAY_IMMEDIATELY hereda objetivo
  handler?: boolean;     // CUSTOM_SCENARIO
  coinTarget?: boolean;  // GAIN_COINS: quien recibe las Monedas
  loot?: boolean;        // DEFEAT_ENEMY: toggle "botín se pierde"
  countLabelKey?: string;// clave i18n de la etiqueta del campo count/targetCount
  times?: boolean;       // Nº de golpes (DEAL_DAMAGE_HITS)
  spillTarget?: boolean; // OVERKILL_DAMAGE: enemigo que recibe el exceso
  statusId?: boolean;    // selector de estado (APPLY/REMOVE/INCREASE_STATUS)
  statusDur?: boolean;   // duración de estado (PERMANENT / fin de turno)
  moveFromTo?: boolean;  // MOVE_CARD: origen + destino
  hordeDir?: boolean;    // extremo de la Horda (TOP/BOTTOM)
  varName?: boolean;     // nombre de variable / etiqueta (SET_VARIABLE, REMOVE_LISTENER)
  varScope?: boolean;    // ámbito RESOLUTION | GAME (SET_VARIABLE)
  build: (n: EffectNode) => CardEffect;
}

/** amountMode 'raw' (decompilador): reemite el ValueExpr conservado. */
export const rawValueExpr = (raw: string | undefined): ValueExpr | null => {
  if (!raw) return null;
  try {
    const parsed = ValueExprSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
};

export const valueExpr = (n: EffectNode): ValueExpr => {
  if (n.amountMode === 'raw') {
    // Passthrough lossless: expresión cargada de una carta del catálogo que
    // el editor no sabe editar. rawValueExpr ya validó con el schema.
    return rawValueExpr(n.rawExpr) ?? C(num(n.amount ?? '1', 1));
  }
  const base = (
    kind: 'COUNT_LIVING_ENEMIES' | 'COUNT_ENEMIES_IN_FIELD' | 'EVASION_DISCARDED_COUNT',
  ): ValueExpr => ({ kind });
  switch (n.amountMode) {
    case 'enemies': return base('COUNT_LIVING_ENEMIES');
    case 'fieldEnemies': return base('COUNT_ENEMIES_IN_FIELD');
    case 'fortitude': return { kind: 'FORTITUDE_OF', target: { kind: 'SELECTED_ENEMY' } };
    case 'evasion': return base('EVASION_DISCARDED_COUNT');
    case 'enemiesMult':
      return { kind: 'MULTIPLY', factors: [C(num(n.amount ?? '2', 2)), base('COUNT_LIVING_ENEMIES')] };
    case 'fieldMult':
      return { kind: 'MULTIPLY', factors: [C(num(n.amount ?? '2', 2)), base('COUNT_ENEMIES_IN_FIELD')] };
    case 'evasionMult':
      return { kind: 'MULTIPLY', factors: [C(num(n.amount ?? '2', 2)), base('EVASION_DISCARDED_COUNT')] };
    // --- Estadísticas de héroe (Taller §12) ---
    case 'heroWounds': return { kind: 'HERO_STAT', stat: 'WOUNDS' };
    case 'heroCoins': return { kind: 'HERO_STAT', stat: 'COINS' };
    case 'heroGlory': return { kind: 'HERO_STAT', stat: 'GLORY' };
    case 'handCards': return { kind: 'HERO_STAT', stat: 'CARDS_IN_HAND' };
    case 'wearCards': return { kind: 'HERO_STAT', stat: 'CARDS_IN_WEAR' };
    case 'playedCards': return { kind: 'HERO_STAT', stat: 'CARDS_PLAYED' };
    case 'trophies': return { kind: 'HERO_STAT', stat: 'TROPHIES' };
    // --- Estadísticas de enemigo seleccionado ---
    case 'enemyDamage': return { kind: 'ENEMY_DAMAGE_OF', target: { kind: 'SELECTED_ENEMY' } };
    case 'enemyWounds': return { kind: 'ENEMY_WOUNDS_OF', target: { kind: 'SELECTED_ENEMY' } };
    case 'defeatedEnemies': return { kind: 'DEFEATED_ENEMIES' };
    case 'statusStacks':
      return { kind: 'STATUS_STACKS_OF', status: n.statusId ?? 'mark', target: { kind: 'SELECTED_ENEMY' } };
    // --- Multiplicadores sobre stats de héroe ---
    case 'heroWoundsMult':
      return { kind: 'MULTIPLY', factors: [C(num(n.amount ?? '2', 2)), { kind: 'HERO_STAT', stat: 'WOUNDS' }] };
    case 'heroCoinsMult':
      return { kind: 'MULTIPLY', factors: [C(num(n.amount ?? '2', 2)), { kind: 'HERO_STAT', stat: 'COINS' }] };
    case 'handCardsMult':
      return { kind: 'MULTIPLY', factors: [C(num(n.amount ?? '2', 2)), { kind: 'HERO_STAT', stat: 'CARDS_IN_HAND' }] };
    // --- Variables del Taller (fase 2) ---
    case 'variable':
      return { kind: 'VARIABLE', name: n.varName?.trim() || 'mi_variable' };
    default: return C(num(n.amount ?? '1', 1));
  }
};
export const enemySel = (n: EffectNode): TargetSelector => {
  const kind = (n.target ?? 'SELECTED_ENEMY') as TargetSelector['kind'];
  if (n.orcOnly && (kind === 'ALL_ENEMIES' || kind === 'ONE_ENEMY')) {Math.max(1, )
    return { kind, filter: { isOrc: true } } as TargetSelector;
  }
  return { kind } as TargetSelector;
};
export const heroSel = (n: EffectNode) => ({ kind: (n.heroTarget ?? 'SELF') as 'SELF' });
export const dur = (n: EffectNode) => (n.duration ?? 'HORDE_ATTACK') as 'HORDE_ATTACK';

export const ACTION_DEFS: ActionDef[] = [
  { type: 'DEAL_DAMAGE', labelKey: 'actionDealDamage', amount: true, enemyTarget: true,
    build: n => ({ type: 'DEAL_DAMAGE', amount: valueExpr(n), target: enemySel(n) }) },
  { type: 'DEAL_DAMAGE_ALL_ENEMIES', labelKey: 'actionDealDamageAllEnemies', amount: true,
    build: n => ({ type: 'DEAL_DAMAGE_ALL_ENEMIES', amount: valueExpr(n) }) },
  { type: 'DEAL_DAMAGE_SPLIT', labelKey: 'actionDealDamageSplit', amount: true, count: true, enemyTarget: true,
    build: n => ({ type: 'DEAL_DAMAGE_SPLIT', amount: valueExpr(n), targetCount: num(n.targetCount ?? '2', 2), target: enemySel(n) }) },
  { type: 'DEAL_DAMAGE_TO_HERO', labelKey: 'actionDealDamageToHero', amount: true, heroTarget: true,
    build: n => ({ type: 'DEAL_DAMAGE_TO_HERO', amount: valueExpr(n), target: heroSel(n) }) },
  { type: 'DEAL_DAMAGE_TO_OTHER_HEROES', labelKey: 'actionDealDamageToOtherHeroes', amount: true,
    build: n => ({ type: 'DEAL_DAMAGE_TO_OTHER_HEROES', amount: valueExpr(n) }) },
  { type: 'PREVENT_DAMAGE', labelKey: 'actionPreventDamage', amount: true, duration: true,
    build: n => ({ type: 'PREVENT_DAMAGE', amount: valueExpr(n), duration: dur(n) }) },
  { type: 'PREVENT_ENEMY_DAMAGE', labelKey: 'actionPreventEnemyDamage', enemyTarget: true, duration: true,
    build: n => ({ type: 'PREVENT_ENEMY_DAMAGE', target: enemySel(n), duration: dur(n) }) },
  { type: 'CANCEL_ALL_DAMAGE', labelKey: 'actionCancelAllDamage', duration: true,
    build: n => ({ type: 'CANCEL_ALL_DAMAGE', duration: dur(n) }) },
  { type: 'SHIELD', labelKey: 'actionShield', amount: true,
    build: n => ({ type: 'SHIELD', amount: valueExpr(n) }) },
  { type: 'DRAW_CARDS', labelKey: 'actionDrawCards', amount: true,
    build: n => ({ type: 'DRAW_CARDS', amount: valueExpr(n), source: 'ABILITY_DECK' }) },
  { type: 'LOSE_CARDS', labelKey: 'actionLoseCards', amount: true,
    build: n => ({ type: 'LOSE_CARDS', amount: valueExpr(n) }) },
  { type: 'RECOVER_CARDS', labelKey: 'actionRecoverCards', amount: true, to: true,
    build: n => ({ type: 'RECOVER_CARDS', amount: valueExpr(n), from: 'WEAR_PILE', to: n.to === 'HAND' ? 'HAND' as const : 'BOTTOM_OF_DECK' as const }) },
  { type: 'SEARCH_WEAR_PILE_PUT_IN_HAND', labelKey: 'actionSearchWearPilePutInHand', amount: true,
    build: n => ({ type: 'SEARCH_WEAR_PILE_PUT_IN_HAND', amount: valueExpr(n) }) },
  { type: 'GAIN_COINS', labelKey: 'actionGainCoins', amount: true, coinTarget: true,
    build: n => ({
      type: 'GAIN_COINS', amount: valueExpr(n),
      ...(n.heroTarget === 'DEFEATING_HERO' ? { target: 'DEFEATING_HERO' as const }
        : n.heroTarget === 'SELF' ? { target: 'SELF' as const } : {}),
    }) },
  { type: 'GAIN_GLORY', labelKey: 'actionGainGlory', amount: true,
    build: n => ({ type: 'GAIN_GLORY', amount: valueExpr(n) }) },
  { type: 'STEAL_COINS', labelKey: 'actionStealCoins', amount: true, heroTarget: true,
    build: n => ({ type: 'STEAL_COINS', amount: valueExpr(n), from: heroSel(n) }) },
  { type: 'HEAL_WOUNDS', labelKey: 'actionHealWounds', amount: true,
    build: n => ({ type: 'HEAL_WOUNDS', amount: valueExpr(n) }) },
  { type: 'COST', labelKey: 'actionCost', amount: true, resource: true,
    build: n => ({ type: 'COST', resource: (n.resource ?? 'COINS') as 'COINS', amount: valueExpr(n) }) },
  { type: 'MODIFY_DAMAGE', labelKey: 'actionModifyDamage', amount: true, scope: true,
    build: n => ({ type: 'MODIFY_DAMAGE', modifier: valueExpr(n), scope: (n.scope ?? 'THIS_TURN') as 'THIS_TURN' }) },
  { type: 'MODIFY_FORTITUDE', labelKey: 'actionModifyFortitude', amount: true, enemyTarget: true, duration: true,
    build: n => ({ type: 'MODIFY_FORTITUDE', modifier: valueExpr(n), target: enemySel(n), duration: dur(n) }) },
  { type: 'MODIFY_MARKET_COST', labelKey: 'actionModifyMarketCost', amount: true,
    build: n => ({ type: 'MODIFY_MARKET_COST', modifier: valueExpr(n) }) },
  { type: 'DISABLE_ENEMY_DAMAGE', labelKey: 'actionDisableEnemyDamage', enemyTarget: true, duration: true,
    build: n => ({ type: 'DISABLE_ENEMY_DAMAGE', target: enemySel(n), duration: dur(n) }) },
  { type: 'APPLY_VULNERABILITY', labelKey: 'actionApplyVulnerability', amount: true, enemyTarget: true, duration: true,
    build: n => ({ type: 'APPLY_VULNERABILITY', target: enemySel(n), bonus: valueExpr(n), duration: dur(n) }) },
  { type: 'DEFEAT_ENEMY', labelKey: 'actionDefeatEnemy', enemyTarget: true, loot: true,
    build: n => ({ type: 'DEFEAT_ENEMY', target: enemySel(n), loot: n.loot !== 'lost' }) },
  { type: 'RETURN_TO_HORDE', labelKey: 'actionReturnToHorde', enemyTarget: true,
    build: n => ({ type: 'RETURN_TO_HORDE', target: enemySel(n), position: 'BOTTOM' }) },
  { type: 'ALL_HEROES_RECOVER', labelKey: 'actionAllHeroesRecover', amount: true,
    build: n => ({ type: 'ALL_HEROES_RECOVER', amount: valueExpr(n) }) },
  { type: 'OTHER_HEROES_RECOVER', labelKey: 'actionOtherHeroesRecover', amount: true,
    build: n => ({ type: 'OTHER_HEROES_RECOVER', amount: valueExpr(n) }) },
  { type: 'RECOVER_THIS_CARD', labelKey: 'actionRecoverThisCard', to: true,
    build: n => ({ type: 'RECOVER_THIS_CARD', to: n.to === 'BOTTOM_OF_DECK' ? 'BOTTOM_OF_DECK' as const : 'HAND' as const }) },
  { type: 'REMOVE_FROM_GAME', labelKey: 'actionRemoveFromGame',
    build: () => ({ type: 'REMOVE_FROM_GAME' }) },
  { type: 'END_ATTACK', labelKey: 'actionEndAttack',
    build: () => ({ type: 'END_ATTACK' }) },
  { type: 'IGNORE_COIN_REWARDS', labelKey: 'actionIgnoreCoinRewards',
    build: () => ({ type: 'IGNORE_COIN_REWARDS' }) },
  { type: 'IGNORE_GLORY_REWARDS', labelKey: 'actionIgnoreGloryRewards',
    build: () => ({ type: 'IGNORE_GLORY_REWARDS' }) },
  { type: 'LOOK_AT_CARDS', labelKey: 'actionLookAtCards', amount: true,
    build: n => ({ type: 'LOOK_AT_CARDS', deck: 'HORDE', amount: valueExpr(n), action: 'REORDER' }) },
  { type: 'DRAW_AND_ADD_ATTACK', labelKey: 'actionDrawAndAddAttack', amount: true,
    build: n => ({ type: 'DRAW_AND_ADD_ATTACK', amount: valueExpr(n), source: 'ABILITY_DECK' }) },
  { type: 'SHUFFLE_DECK', labelKey: 'actionShuffleDeck', searchDeck: true,
    build: n => ({ type: 'SHUFFLE_DECK', deck: (n.searchDeck ?? 'ABILITY') as 'ABILITY' }) },
  { type: 'SEARCH_DECK', labelKey: 'actionSearchDeck', cardName: true, searchAction: true, searchDeck: true,
    count: true, countLabelKey: 'actionSearchDeckCount',
    build: n => ({
      type: 'SEARCH_DECK',
      filter: n.cardName?.trim() ? { name: n.cardName.trim() } : {},
      action: (n.searchAction ?? 'PUT_IN_HAND') as 'PUT_IN_HAND',
      deck: (n.searchDeck ?? 'ABILITY') as 'ABILITY',
      ...(num(n.targetCount ?? '1', 1) > 1 ? { amount: num(n.targetCount ?? '1', 1) } : {}),
    }) },
  { type: 'RECOVER_CARD_BY_NAME', labelKey: 'actionRecoverCardByName', cardName: true, to: true,
    build: n => ({ type: 'RECOVER_CARD_BY_NAME', name: n.cardName?.trim() ?? '', from: 'WEAR_PILE', to: n.to === 'HAND' ? 'HAND' : 'BOTTOM_OF_DECK' }) },
  { type: 'SWAP_ENEMY', labelKey: 'actionSwapEnemy', enemyTarget: true,
    build: n => ({ type: 'SWAP_ENEMY', target: enemySel(n), newFrom: 'BOTTOM_OF_HORDE' as const }) },
  { type: 'INTERCEPT_DAMAGE', labelKey: 'actionInterceptDamage', heroTarget: true,
    build: n => ({ type: 'INTERCEPT_DAMAGE', from: heroSel(n) }) },
  { type: 'PLAY_IMMEDIATELY', labelKey: 'actionPlayImmediately', inherit: true,
    build: n => ({ type: 'PLAY_IMMEDIATELY', inheritTarget: !!n.inheritTarget }) },
  { type: 'CUSTOM_SCENARIO', labelKey: 'actionCustomScenario', handler: true,
    build: n => ({ type: 'CUSTOM_SCENARIO', handler: n.cardName?.trim() || 'CUSTOM' }) },
  { type: 'STEAL_COINS_MULTIPLE', labelKey: 'actionStealCoinsMultiple', amount: true,
    build: n => ({ type: 'STEAL_COINS_MULTIPLE', maxTotal: valueExpr(n) }) },
  { type: 'PLAY_RANDOM_CARD_FROM_OTHER_HERO', labelKey: 'actionPlayRandomCardFromOtherHero',
    build: () => ({ type: 'PLAY_RANDOM_CARD_FROM_OTHER_HERO' }) },
  // === Extensiones del Taller (fase 1+) ===
  { type: 'DEAL_DAMAGE_HITS', labelKey: 'actionDealDamageHits', amount: true, times: true, enemyTarget: true,
    build: n => ({ type: 'DEAL_DAMAGE_HITS', amount: valueExpr(n), times: C(num(n.times ?? '2', 2)), target: enemySel(n) }) },
  { type: 'OVERKILL_DAMAGE', labelKey: 'actionOverkillDamage', amount: true, enemyTarget: true, spillTarget: true,
    build: n => ({ type: 'OVERKILL_DAMAGE', amount: valueExpr(n), target: enemySel(n), spill: { kind: (n.spillTarget ?? 'OTHER_ENEMY') as 'OTHER_ENEMY' } }) },
  { type: 'EXECUTE_ENEMY', labelKey: 'actionExecuteEnemy', amount: true, enemyTarget: true, loot: true,
    build: n => ({ type: 'EXECUTE_ENEMY', target: enemySel(n), threshold: valueExpr(n), loot: n.loot !== 'lost' }) },
  { type: 'SPAWN_ENEMY', labelKey: 'actionSpawnEnemy', amount: true,
    // Cotas del schema (min 1, max 10): sin clamp el valor 0/11+ rompía el
    // safeParse final con un error Zod crudo.
    build: n => ({ type: 'SPAWN_ENEMY', count: Math.min(10, Math.max(1, num(n.amount ?? '1', 1))) }) },
  { type: 'DISCARD_HORDE_CARD', labelKey: 'actionDiscardHordeCard', amount: true, hordeDir: true,
    build: n => ({ type: 'DISCARD_HORDE_CARD', count: Math.min(10, Math.max(1, num(n.amount ?? '1', 1))), from: (n.hordeDir === 'TOP' ? 'TOP' : 'BOTTOM') as 'BOTTOM' }) },
  { type: 'MOVE_HORDE_CARDS', labelKey: 'actionMoveHordeCards', amount: true, hordeDir: true,
    build: n => ({ type: 'MOVE_HORDE_CARDS', count: Math.min(10, Math.max(1, num(n.amount ?? '1', 1))), to: (n.hordeDir === 'TOP' ? 'TOP' : 'BOTTOM') as 'TOP' }) },
  { type: 'DRAW_FROM_BOTTOM', labelKey: 'actionDrawFromBottom', amount: true,
    build: n => ({ type: 'DRAW_FROM_BOTTOM', amount: valueExpr(n) }) },
  { type: 'DRAW_UP_TO', labelKey: 'actionDrawUpTo', amount: true,
    build: n => ({ type: 'DRAW_UP_TO', limit: Math.min(15, Math.max(1, num(n.amount ?? '4', 4))) }) },
  { type: 'TAKE_WOUNDS', labelKey: 'actionTakeWounds', amount: true, heroTarget: true,
    build: n => ({ type: 'TAKE_WOUNDS', amount: valueExpr(n), hero: heroSel(n) }) },
  { type: 'GRANT_ARMOR', labelKey: 'actionGrantArmor', amount: true,
    build: n => ({ type: 'GRANT_ARMOR', amount: valueExpr(n), duration: 'UNTIL_END_OF_TURN' }) },
  { type: 'MOVE_CARD', labelKey: 'actionMoveCard', amount: true, moveFromTo: true,
    build: n => ({
      type: 'MOVE_CARD', count: valueExpr(n),
      from: (n.moveFrom ?? 'WEAR_PILE') as 'WEAR_PILE',
      to: (n.moveTo ?? 'HAND') as 'HAND',
    }) },
  { type: 'APPLY_STATUS', labelKey: 'actionApplyStatus', statusId: true, statusDur: true, amount: true, enemyTarget: true,
    build: n => ({
      type: 'APPLY_STATUS',
      status: n.statusId === 'custom' ? (n.cardName?.trim() || 'mi_estado') : (n.statusId ?? 'mark'),
      stacks: valueExpr(n),
      duration: (n.duration === 'UNTIL_END_OF_TURN' ? 'UNTIL_END_OF_TURN' : 'PERMANENT') as 'PERMANENT',
      target: enemySel(n),
    }) },
  { type: 'INCREASE_STATUS', labelKey: 'actionIncreaseStatus', statusId: true, amount: true, enemyTarget: true,
    build: n => ({
      type: 'INCREASE_STATUS',
      status: n.statusId === 'custom' ? (n.cardName?.trim() || 'mi_estado') : (n.statusId ?? 'mark'),
      amount: valueExpr(n),
      target: enemySel(n),
    }) },
  { type: 'REMOVE_STATUS', labelKey: 'actionRemoveStatus', statusId: true, enemyTarget: true,
    build: n => ({
      type: 'REMOVE_STATUS',
      status: n.statusId === 'custom' ? (n.cardName?.trim() || 'mi_estado') : (n.statusId ?? 'mark'),
      target: enemySel(n),
    }) },
  // === Extensiones del Taller (fase 2): variables, bloqueo, oyentes ===
  { type: 'SET_VARIABLE', labelKey: 'actionSetVariable', varName: true, varScope: true, amount: true,
    build: n => ({
      type: 'SET_VARIABLE',
      name: n.varName?.trim() || 'mi_variable',
      value: valueExpr(n),
      scope: (n.varScope === 'GAME' ? 'GAME' : 'RESOLUTION') as 'RESOLUTION',
    }) },
  { type: 'BLOCK_NEXT_DAMAGE', labelKey: 'actionBlockNextDamage', amount: true,
    build: n => ({ type: 'BLOCK_NEXT_DAMAGE', amount: valueExpr(n) }) },
  { type: 'REMOVE_LISTENER', labelKey: 'actionRemoveListener', varName: true,
    build: n => ({ type: 'REMOVE_LISTENER', tag: n.varName?.trim() || 'mi_etiqueta' }) },
  { type: 'DISCARD_FROM_HAND', labelKey: 'actionDiscardFromHand', amount: true,
    build: n => ({ type: 'DISCARD_FROM_HAND', count: valueExpr(n) }) },
];

export const ENEMY_TARGETS = [
  { kind: 'SELECTED_ENEMY', labelKey: 'targetSelected' },
  { kind: 'ONE_ENEMY', labelKey: 'targetOneFiltered' },
  { kind: 'ALL_ENEMIES', labelKey: 'targetAll' },
  { kind: 'ENEMY_WITH_MAX_FORTITUDE', labelKey: 'targetMaxFortitude' },
  { kind: 'ENEMY_WITH_FEWEST_WOUNDS', labelKey: 'targetFewestWounds' },
] as const;

export const HERO_TARGETS = [
  { kind: 'SELF', labelKey: 'heroSelf' },
  { kind: 'OTHER_HERO', labelKey: 'heroOther' },
  { kind: 'ALL_OTHERS', labelKey: 'heroAllOthers' },
  { kind: 'EACH_OTHER', labelKey: 'heroEachOther' },
  { kind: 'HERO_WITH_FEWEST_WOUNDS', labelKey: 'heroFewestWounds' },
] as const;

export const AMOUNT_MODES = [
  { id: 'fixed', labelKey: 'amountFixed' },
  { id: 'enemies', labelKey: 'amountEnemies' },
  { id: 'fieldEnemies', labelKey: 'amountFieldEnemies' },
  { id: 'fortitude', labelKey: 'amountFortitude' },
  { id: 'evasion', labelKey: 'amountEvasion' },
  { id: 'enemiesMult', labelKey: 'amountEnemiesMult' },
  { id: 'fieldMult', labelKey: 'amountFieldMult' },
  { id: 'evasionMult', labelKey: 'amountEvasionMult' },
  { id: 'variable', labelKey: 'amountVariable', advanced: true },
  // --- Modos avanzados (ValueExpr ya soportado por el compilador): solo
  //     visibles en modo avanzado del editor (§15.4). ---
  { id: 'heroWounds', labelKey: 'amountHeroWounds', advanced: true },
  { id: 'heroCoins', labelKey: 'amountHeroCoins', advanced: true },
  { id: 'heroGlory', labelKey: 'amountHeroGlory', advanced: true },
  { id: 'handCards', labelKey: 'amountHandCards', advanced: true },
  { id: 'enemyWounds', labelKey: 'amountEnemyWounds', advanced: true },
  { id: 'statusStacks', labelKey: 'amountStatusStacks', advanced: true },
  { id: 'defeatedEnemies', labelKey: 'amountDefeatedEnemies', advanced: true },
  { id: 'heroWoundsMult', labelKey: 'amountHeroWoundsMult', advanced: true },
  { id: 'handCardsMult', labelKey: 'amountHandCardsMult', advanced: true },
  { id: 'raw', labelKey: 'amountRaw', advanced: true },
] as const;

export const DURATIONS = [
  { id: 'HORDE_ATTACK', labelKey: 'durThisAttack' },
  { id: 'NEXT_HORDE_ATTACK', labelKey: 'durNextHordeAttack' },
  { id: 'UNTIL_END_OF_TURN', labelKey: 'durEndOfTurn' },
  { id: 'WHILE_SOURCE_ACTIVE', labelKey: 'durWhileActive' },
] as const;

export const SCOPES = [
  { id: 'THIS_TURN', labelKey: 'scopeThisTurn' },
  { id: 'NEXT_CARD', labelKey: 'scopeNextCard' },
] as const;

/** Estados de enemigo con semántica en el motor (schema §statuses):
 *  mark = +N daño y se consume; stun = salta el próximo ataque de la
 *  Horda; poison = tick de daño en la Horda. */
export const STATUS_IDS = [
  { id: 'mark', labelKey: 'statusMark' },
  { id: 'stun', labelKey: 'statusStun' },
  { id: 'poison', labelKey: 'statusPoison' },
] as const;

export const CONDITIONS: { id: string; labelKey: string; param?: 'cap' | 'int' | 'name' | 'stat' | 'status' | 'var' | 'raw'; build: (p: string, v?: string) => Condition }[] = [
  { id: 'HAS_CAPABILITY', labelKey: 'condHasCapability', param: 'cap',
    build: p => ({ kind: 'HAS_CAPABILITY', icon: (p || 'EXPERTISE') as 'EXPERTISE' }) },
  { id: 'ENEMY_DEFEATED_BY_THIS_CARD', labelKey: 'condEnemyDefeatedByThisCard',
    build: () => ({ kind: 'ENEMY_DEFEATED_BY_THIS_CARD' }) },
  { id: 'ENEMY_FORTITUDE_GTE', labelKey: 'condEnemyFortitudeGte', param: 'int',
    build: p => ({ kind: 'ENEMY_FORTITUDE_GTE', value: num(p, 2) }) },
  { id: 'FIRST_CARD_OF_NAME_THIS_TURN', labelKey: 'condFirstCardOfNameThisTurn', param: 'name',
    build: p => ({ kind: 'FIRST_CARD_OF_NAME_THIS_TURN', name: p || '' }) },
  { id: 'ALREADY_USED_AGAINST_THIS_ENEMY', labelKey: 'condAlreadyUsedAgainstThisEnemy', param: 'name',
    build: p => ({ kind: 'ALREADY_USED_AGAINST_THIS_ENEMY', name: p || '' }) },
  // --- Predicados de héroe (Taller §10) ---
  { id: 'HERO_WOUNDS_GTE', labelKey: 'condHeroWoundsGte', param: 'int',
    build: p => ({ kind: 'HERO_STAT_GTE', stat: 'WOUNDS', value: num(p, 1) }) },
  { id: 'HERO_WOUNDS_LTE', labelKey: 'condHeroWoundsLte', param: 'int',
    build: p => ({ kind: 'HERO_STAT_LTE', stat: 'WOUNDS', value: num(p, 1) }) },
  { id: 'HERO_COINS_GTE', labelKey: 'condHeroCoinsGte', param: 'int',
    build: p => ({ kind: 'HERO_STAT_GTE', stat: 'COINS', value: num(p, 1) }) },
  { id: 'HERO_GLORY_GTE', labelKey: 'condHeroGloryGte', param: 'int',
    build: p => ({ kind: 'HERO_STAT_GTE', stat: 'GLORY', value: num(p, 1) }) },
  { id: 'HAND_GTE', labelKey: 'condHandGte', param: 'int',
    build: p => ({ kind: 'HERO_STAT_GTE', stat: 'CARDS_IN_HAND', value: num(p, 1) }) },
  { id: 'HAS_CARD_IN_HAND', labelKey: 'condHasCardInHand', param: 'name',
    build: p => ({ kind: 'HAS_CARD_IN_HAND', name: p || '' }) },
  // --- Predicados de enemigo y campo ---
  { id: 'ENEMY_COUNT_GTE', labelKey: 'condEnemyCountGte', param: 'int',
    build: p => ({ kind: 'ENEMY_COUNT_GTE', value: num(p, 1) }) },
  { id: 'ENEMY_COUNT_LTE', labelKey: 'condEnemyCountLte', param: 'int',
    build: p => ({ kind: 'ENEMY_COUNT_LTE', value: num(p, 3) }) },
  { id: 'ENEMY_IS_ORC', labelKey: 'condEnemyIsOrc',
    build: () => ({ kind: 'ENEMY_IS_ORC' }) },
  { id: 'ENEMY_IS_WARLORD', labelKey: 'condEnemyIsWarlord',
    build: () => ({ kind: 'ENEMY_IS_WARLORD' }) },
  { id: 'ENEMY_IS_UNHARMED', labelKey: 'condEnemyIsUnharmed',
    build: () => ({ kind: 'ENEMY_IS_UNHARMED' }) },
  { id: 'ENEMY_HAS_STATUS', labelKey: 'condEnemyHasStatus', param: 'status',
    build: p => ({ kind: 'ENEMY_HAS_STATUS', status: p || 'mark' }) },
  // --- Variables del Taller (fase 2): nombre + valor ---
  { id: 'VARIABLE_GTE', labelKey: 'condVarGte', param: 'var',
    build: (p, v) => ({ kind: 'VARIABLE_GTE', name: p || 'mi_variable', value: num(v ?? '1', 1) }) },
  { id: 'VARIABLE_LTE', labelKey: 'condVarLte', param: 'var',
    build: (p, v) => ({ kind: 'VARIABLE_LTE', name: p || 'mi_variable', value: num(v ?? '1', 1) }) },
  { id: 'VARIABLE_EQ', labelKey: 'condVarEq', param: 'var',
    build: (p, v) => ({ kind: 'VARIABLE_EQ', name: p || 'mi_variable', value: num(v ?? '1', 1) }) },
  // Passthrough del decompilador: el compilador usa condRaw, nunca build.
  { id: 'RAW', labelKey: 'condRaw', param: 'raw',
    build: () => ({ kind: 'ENEMY_IS_ORC' }) },
];

/** Eventos de partida a los que puede suscribirse un oyente (LISTEN). */
export const LISTEN_EVENTS = [
  { id: 'DAMAGE_DEALT', labelKey: 'evtDamageDealt' },
  { id: 'ENEMY_DEFEATED', labelKey: 'evtEnemyDefeated' },
  { id: 'CARDS_DRAWN', labelKey: 'evtCardsDrawn' },
  { id: 'CARDS_LOST', labelKey: 'evtCardsLost' },
  { id: 'COINS_GAINED', labelKey: 'evtCoinsGained' },
  { id: 'GLORY_GAINED', labelKey: 'evtGloryGained' },
  { id: 'HERO_WOUNDED', labelKey: 'evtHeroWounded' },
  { id: 'CARD_PLAYED', labelKey: 'evtCardPlayed' },
  { id: 'TURN_STARTED', labelKey: 'evtTurnStarted' },
  { id: 'HORDE_ATTACKED', labelKey: 'evtHordeAttacked' },
] as const;

// ============================================================================
// Plantillas de efectos (P2): inserción rápida de combos habituales.
// Cada build() crea nodos nuevos con claves frescas — nunca compartidos.
// ============================================================================

const act = (type: string, extra: Partial<EffectNode> = {}): EffectNode =>
  ({ key: nextNodeKey(), kind: 'ACTION', actionType: type, amountMode: 'fixed', amount: '1', ...extra });

export interface EffectTemplate {
  id: string;
  labelKey: string;
  build: () => EffectNode[];
}

export const EFFECT_TEMPLATES: EffectTemplate[] = [
  {
    id: 'damage-draw',
    labelKey: 'tplDamageDraw',
    build: () => [act('DEAL_DAMAGE', { amount: '2' }), act('DRAW_CARDS')],
  },
  {
    id: 'defeat-glory',
    labelKey: 'tplDefeatGlory',
    build: () => [{
      key: nextNodeKey(), kind: 'ON_DEFEAT',
      children: [act('GAIN_GLORY')],
    }],
  },
  {
    id: 'cap-gate',
    labelKey: 'tplCapGate',
    build: () => [{
      key: nextNodeKey(), kind: 'COND',
      condKind: 'HAS_CAPABILITY', condParam: 'EXPERTISE',
      thenN: [act('GAIN_COINS')], elseN: [],
    }],
  },
  {
    id: 'repeat-3',
    labelKey: 'tplRepeat3',
    build: () => [{
      key: nextNodeKey(), kind: 'REPEAT',
      timesMode: 'fixed', times: '3', max: '5',
      children: [act('DEAL_DAMAGE')],
    }],
  },
  {
    id: 'for-each-enemy',
    labelKey: 'tplForEach',
    build: () => [{
      key: nextNodeKey(), kind: 'FOR_EACH',
      collection: 'ENEMIES',
      children: [act('DEAL_DAMAGE')], // SELECTED_ENEMY = enemigo iterado
    }],
  },
  {
    id: 'pay-draw',
    labelKey: 'tplPayDraw',
    build: () => [act('COST', { resource: 'COINS', amount: '2' }), act('DRAW_CARDS', { amount: '2' })],
  },
  {
    id: 'shield-heal',
    labelKey: 'tplShieldHeal',
    build: () => [act('SHIELD', { amount: '2' }), act('HEAL_WOUNDS')],
  },
  {
    id: 'choose-coins-cards',
    labelKey: 'tplChooseCoinsCards',
    build: () => [{
      key: nextNodeKey(), kind: 'CHOOSE',
      options: [
        { label: 'Monedas', children: [act('GAIN_COINS', { amount: '2' })] },
        { label: 'Cartas', children: [act('DRAW_CARDS', { amount: '2' })] },
      ],
    }],
  },
  {
    id: 'listen-damage',
    labelKey: 'tplListenDamage',
    build: () => [{
      key: nextNodeKey(), kind: 'LISTEN',
      listenEvent: 'ENEMY_DEFEATED', duration: 'THIS_TURN', listenTag: 'botin',
      children: [act('GAIN_GLORY')],
    }],
  },
];
