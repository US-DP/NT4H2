/**
 * effectDescriptions — descripción estructurada de efectos compilados.
 *
 * Extraído de CardZoom.tsx: funciones puras (sin hooks ni estado) que
 * convierten CardEffect/ValueExpr/Condition a texto i18n. Las usan el
 * zoom de carta (UI-113 "Cómo se resuelve"), la vista previa del Taller
 * (FxPreview) y el detalle de carta en partida.
 */

import type { CardDefinition, CardEffect } from '@nt4h/schema';
import i18n from './i18n';

/* === Helpers i18n para los descriptores (funciones puras, sin hooks) === */

/** Etiqueta del objetivo-enemigo de un efecto (cardui.enemy.*). */
const enemyT = (tgt: { kind?: string } | undefined): string =>
  i18n.t(`cardui.enemy.${tgt?.kind ?? ''}`, { defaultValue: i18n.t('cardui.enemy.fallback') });
/** Etiqueta del objetivo-héroe de un efecto (cardui.hero.*). */
const heroT = (tgt: { kind?: string } | undefined): string =>
  i18n.t(`cardui.hero.${tgt?.kind ?? ''}`, { defaultValue: i18n.t('cardui.hero.fallback') });
/** Duración de un efecto (cardui.duration.*). */
const durT = (d: unknown, fallback = ''): string =>
  i18n.t(`cardui.duration.${String(d ?? '')}`, { defaultValue: fallback });
/** Mazo de un efecto (cardui.deck.*). */
const deckT = (d: unknown, fallbackKey: 'yourDeck' | 'theDeck'): string =>
  i18n.t(`cardui.deck.${String(d ?? '')}`, { defaultValue: i18n.t(`cardui.deck.${fallbackKey}`) });
/** Estadística de héroe (cardui.stats.*). */
const statT = (s: unknown, fallback = ''): string =>
  i18n.t(`cardui.stats.${String(s ?? '')}`, { defaultValue: fallback });
/** Zona de MOVE_CARD (cardui.fx.zone*). */
const ZONE_KEYS: Record<string, string> = {
  HAND: 'zoneHand',
  WEAR_PILE: 'zoneWearPile',
  ABILITY_DECK: 'zoneAbilityDeck',
  REMOVED_FROM_GAME: 'zoneRemoved',
};
const zoneT = (z: unknown): string =>
  i18n.t(`cardui.fx.${ZONE_KEYS[String(z)] ?? ''}`, { defaultValue: '?' });
/** Destino al que vuelve una carta tras jugarse. */
const recoverDestT = (to: unknown, handKey: 'toHand' | 'toYourHand'): string =>
  i18n.t(to === 'HAND' ? `cardui.${handKey}` : 'cardui.toDeckBottom');
/** «{{name}}» o 'una carta' según haya filtro por nombre. */
const cardNameT = (name: string | undefined): string =>
  name ? i18n.t('cardui.fx.namedCard', { name }) : i18n.t('cardui.fx.aCard');
/** Sufijo ' (sin recompensa)' cuando el efecto anula el botín. */
const noLootT = (loot: unknown): string =>
  loot === false ? i18n.t('cardui.withoutLoot') : '';

/** Convierte los efectos a una descripción estructurada "Cómo se resuelve" (UI-113). */
export function describeResolution(card: CardDefinition): string[] {
  const steps: string[] = [];
  if (card.printedAttack !== undefined && card.printedAttack > 0) {
    steps.push(`1. ${i18n.t('cardui.resolution.dealDamage', { n: card.printedAttack })}`);
  }
  let stepNum = steps.length + 1;
  for (const eff of card.effects ?? []) {
    const desc = describeEffect(eff);
    if (desc) {
      steps.push(`${stepNum}. ${desc}`);
      stepNum++;
    }
  }
  // Pericia de héroe (heroAbility) — carta de personaje
  const heroFx = card.heroAbility?.effects;
  if (heroFx && heroFx.length > 0) {
    const uses = card.heroAbility!.uses;
    const freq = uses === 1
      ? i18n.t('cardui.resolution.periciaOnce')
      : i18n.t('cardui.resolution.periciaTimes', { count: uses });
    steps.push(i18n.t('cardui.resolution.periciaHeader', { freq }));
    for (const eff of heroFx) {
      const desc = describeEffect(eff);
      if (desc) steps.push(`· ${desc}`);
    }
  }
  // Pericia de Señor de la Guerra (declarativa)
  if (card.peritia) {
    const trigKey = card.peritia.trigger === 'DAMAGE_DEALT' ? 'trigDamageDealt'
      : card.peritia.trigger === 'CARD_PLAYED' ? 'trigCardPlayed' : 'trigContinuous';
    steps.push(i18n.t('cardui.resolution.peritiaHeader', { trigger: i18n.t(`cardui.resolution.${trigKey}`) }));
    if (card.peritia.text) steps.push(`· ${card.peritia.text}`);
    for (const eff of card.peritia.effects ?? []) {
      const desc = describeEffect(eff);
      if (desc) steps.push(`· ${desc}`);
    }
  }
  if (steps.length === 0) {
    steps.push(i18n.t('cardui.resolution.noEffects'));
  }
  return steps;
}

function describeValue(v: unknown): string {
  if (typeof v === 'number') return String(v);
  const e = v as { kind?: string; value?: number; of?: unknown[]; factors?: unknown[]; numerator?: unknown; denominator?: number };
  switch (e?.kind) {
    case 'CONSTANT': return String(e.value ?? 0);
    case 'COUNT_LIVING_ENEMIES': return i18n.t('cardui.value.countLivingEnemies');
    case 'COUNT_ENEMIES_IN_FIELD': return i18n.t('cardui.value.countEnemiesInField');
    case 'FORTITUDE_OF': return i18n.t('cardui.value.fortitudeOf');
    case 'EVASION_DISCARDED_COUNT': return i18n.t('cardui.value.evasionDiscarded');
    case 'SUM': return (e.of ?? []).map(describeValue).join(' + ') || '?';
    case 'MULTIPLY': return (e.factors ?? []).map(describeValue).join(' × ') || '?';
    case 'FLOOR_DIV': return `${describeValue(e.numerator)} ÷ ${e.denominator ?? '?'}`;
    case 'SUBTRACT': {
      const parts = (e.of ?? []).map(describeValue);
      return parts.join(' − ') || '?';
    }
    case 'MIN': return i18n.t('cardui.value.min', { of: (e.of ?? []).map(describeValue).join(', ') });
    case 'MAX': return i18n.t('cardui.value.max', { of: (e.of ?? []).map(describeValue).join(', ') });
    case 'ABS': return `|${describeValue((e.of ?? [])[0])}|`;
    case 'HERO_STAT': return i18n.t('cardui.value.heroStat', {
      stat: statT((e as { stat?: string }).stat, i18n.t('cardui.value.statsFallback')),
    });
    case 'ENEMY_DAMAGE_OF': return i18n.t('cardui.value.enemyDamage');
    case 'ENEMY_WOUNDS_OF': return i18n.t('cardui.value.enemyWounds');
    case 'STATUS_STACKS_OF': return i18n.t('cardui.value.statusStacks', {
      status: (e as { status?: string }).status ?? '?',
    });
    case 'DEFEATED_ENEMIES': return i18n.t('cardui.value.defeatedEnemies');
    case 'VARIABLE': return i18n.t('cardui.value.variable', {
      name: (e as { name?: string }).name ?? '?',
    });
    default: return '?';
  }
}

function describeCondition(cond: unknown): string {
  const cn = cond as { kind?: string; icon?: string; value?: number; name?: string };
  switch (cn?.kind) {
    case 'HAS_CAPABILITY': return i18n.t('cardui.condition.hasCapability', { icon: cn.icon ?? '' });
    case 'ENEMY_DEFEATED_BY_THIS_CARD': return i18n.t('cardui.condition.defeatedByCard');
    case 'ENEMY_FORTITUDE_GTE': return i18n.t('cardui.condition.enemyFortitudeGte', { value: cn.value ?? '?' });
    case 'ALREADY_USED_AGAINST_THIS_ENEMY': return i18n.t('cardui.condition.alreadyUsed', { name: cn.name ?? '?' });
    case 'FIRST_CARD_OF_NAME_THIS_TURN': return i18n.t('cardui.condition.firstOfName', { name: cn.name ?? '?' });
    case 'NOT': return i18n.t('cardui.condition.not', {
      cond: describeCondition((cn as { condition?: unknown }).condition),
    });
    case 'AND':
      return ((cn as { conditions?: unknown[] }).conditions ?? []).map(describeCondition)
        .join(i18n.t('cardui.condition.andJoin')) || i18n.t('cardui.condition.andFallback');
    case 'OR':
      return ((cn as { conditions?: unknown[] }).conditions ?? []).map(describeCondition)
        .join(i18n.t('cardui.condition.orJoin')) || i18n.t('cardui.condition.orFallback');
    case 'HERO_STAT_GTE': return i18n.t('cardui.condition.heroStatGte', {
      value: cn.value ?? '?', stat: statT((cn as { stat?: string }).stat),
    });
    case 'HERO_STAT_LTE': return i18n.t('cardui.condition.heroStatLte', {
      value: cn.value ?? '?', stat: statT((cn as { stat?: string }).stat),
    });
    case 'HAS_CARD_IN_HAND': return i18n.t('cardui.condition.hasCardInHand', { name: cn.name ?? '?' });
    case 'ENEMY_COUNT_GTE': return i18n.t('cardui.condition.enemyCountGte', { value: cn.value ?? '?' });
    case 'ENEMY_COUNT_LTE': return i18n.t('cardui.condition.enemyCountLte', { value: cn.value ?? '?' });
    case 'ENEMY_IS_ORC': return i18n.t('cardui.condition.enemyIsOrc');
    case 'ENEMY_IS_WARLORD': return i18n.t('cardui.condition.enemyIsWarlord');
    case 'ENEMY_IS_UNHARMED': return i18n.t('cardui.condition.enemyUnharmed');
    case 'ENEMY_HAS_STATUS': return i18n.t('cardui.condition.enemyHasStatus', {
      status: (cn as { status?: string }).status ?? '?',
    });
    case 'VARIABLE_GTE': return i18n.t('cardui.condition.variableGte', { name: cn.name ?? '?', value: cn.value ?? '?' });
    case 'VARIABLE_LTE': return i18n.t('cardui.condition.variableLte', { name: cn.name ?? '?', value: cn.value ?? '?' });
    case 'VARIABLE_EQ': return i18n.t('cardui.condition.variableEq', { name: cn.name ?? '?', value: cn.value ?? '?' });
    default: return i18n.t('cardui.condition.generic');
  }
}

function joinFx(list: unknown): string {
  const parts = (list as CardEffect[] ?? [])
    .map(e => describeEffect(e))
    .filter(Boolean);
  return parts.join(' ');
}

/** Describe un efecto en español, con sus parámetros y efectos anidados. */
export function describeEffect(eff: CardEffect): string {
  const e = eff as unknown as Record<string, unknown>;
  const amt = describeValue(e.amount);
  switch (eff.type) {
    case 'DEAL_DAMAGE':
      return i18n.t('cardui.fx.dealDamage', { amt, target: enemyT(e.target as { kind?: string }) });
    case 'DEAL_DAMAGE_ALL_ENEMIES':
      return i18n.t('cardui.fx.dealDamageAllEnemies', { amt });
    case 'DEAL_DAMAGE_SPLIT':
      return i18n.t('cardui.fx.dealDamageSplit', { amt, n: e.targetCount ?? '?' });
    case 'DEAL_DAMAGE_TO_HERO':
      return i18n.t('cardui.fx.dealDamageToHero', { target: heroT(e.target as { kind?: string }), amt });
    case 'DEAL_DAMAGE_TO_OTHER_HEROES':
      return i18n.t('cardui.fx.dealDamageToOtherHeroes', { amt });
    case 'PREVENT_DAMAGE':
      return i18n.t('cardui.fx.preventDamage', { amt, duration: durT(e.duration) });
    case 'PREVENT_ENEMY_DAMAGE':
      return i18n.t('cardui.fx.preventEnemyDamage', { duration: durT(e.duration) });
    case 'CANCEL_ALL_DAMAGE':
      return i18n.t('cardui.fx.cancelAllDamage', { duration: durT(e.duration) });
    case 'SHIELD':
      return i18n.t('cardui.fx.shield', { amt });
    case 'DRAW_CARDS':
      return i18n.t('cardui.fx.drawCards', { amt });
    case 'DRAW_AND_ADD_ATTACK':
      return i18n.t('cardui.fx.drawAndAddAttack', { amt });
    case 'LOSE_CARDS':
      return i18n.t('cardui.fx.loseCards', { amt });
    case 'RECOVER_CARDS':
      return i18n.t('cardui.fx.recoverCards', { amt, dest: recoverDestT(e.to, 'toHand') });
    case 'RECOVER_CARD_BY_NAME':
      return i18n.t('cardui.fx.recoverCardByName', { name: e.name, dest: recoverDestT(e.to, 'toHand') });
    case 'SEARCH_DECK': {
      const deck = deckT(e.deck, 'yourDeck');
      const name = (e.filter as { name?: string })?.name;
      const what = cardNameT(name);
      return e.action === 'SWAP_WITH_HAND'
        ? i18n.t('cardui.fx.searchDeckSwap', { what, deck })
        : i18n.t('cardui.fx.searchDeck', { what, deck });
    }
    case 'SHUFFLE_DECK':
      return i18n.t('cardui.fx.shuffleDeck', { deck: deckT(e.deck, 'theDeck') });
    case 'SEARCH_WEAR_PILE_PUT_IN_HAND':
      return i18n.t('cardui.fx.searchWearPile', { amt });
    case 'GAIN_GLORY':
      return i18n.t('cardui.fx.gainGlory', { amt });
    case 'GAIN_COINS':
      return e.target === 'DEFEATING_HERO'
        ? i18n.t('cardui.fx.gainCoinsDefeater', { amt })
        : i18n.t('cardui.fx.gainCoins', { amt });
    case 'STEAL_COINS':
      return i18n.t('cardui.fx.stealCoins', { amt, from: heroT(e.from as { kind?: string }) });
    case 'STEAL_COINS_MULTIPLE':
      return i18n.t('cardui.fx.stealCoinsMultiple', { max: describeValue(e.maxTotal) });
    case 'HEAL_WOUNDS':
      return i18n.t('cardui.fx.healWounds', { amt });
    case 'COST':
      return i18n.t('cardui.fx.cost', {
        amt,
        resource: i18n.t(e.resource === 'GLORY' ? 'cardui.fx.resourceGlory' : 'cardui.fx.resourceCoins'),
      });
    case 'CONDITIONAL': {
      const then = joinFx(e.then);
      const els = joinFx(e.else);
      return i18n.t('cardui.fx.conditional', { cond: describeCondition(e.condition), then })
        + (els ? i18n.t('cardui.fx.conditionalElse', { else: els }) : '');
    }
    case 'ON_DEFEAT':
      return i18n.t('cardui.fx.onDefeat', { fx: joinFx(e.effects) });
    case 'ON_ENEMY_DEFEATED': {
      const cond = (e.condition as { fortitudeGte?: number })?.fortitudeGte;
      return i18n.t('cardui.fx.onEnemyDefeated', {
        cond: cond ? i18n.t('cardui.fx.fortitudeCond', { n: cond }) : '',
        fx: joinFx(e.effects),
      });
    }
    case 'ON_HORDE_ATTACK':
      return i18n.t('cardui.fx.onHordeAttack', { fx: joinFx(e.effects) });
    case 'REPEAT':
      return i18n.t('cardui.fx.repeat', { max: e.max ?? '?', fx: joinFx(e.effects) });
    case 'CHOOSE_ONE': {
      const opts = (e.options as { label?: string; effects: CardEffect[] }[] ?? [])
        .map(o => `${o.label ? `${o.label}: ` : ''}${joinFx(o.effects)}`)
        .join(i18n.t('cardui.fx.optionSep'));
      return i18n.t('cardui.fx.chooseOne', {
        prefix: i18n.t(e.optional ? 'cardui.fx.chooseOptional' : 'cardui.fx.chooseMandatory'),
        opts,
      });
    }
    case 'IGNORE_COIN_REWARDS':
      return i18n.t('cardui.fx.ignoreCoinRewards');
    case 'IGNORE_GLORY_REWARDS':
      return i18n.t('cardui.fx.ignoreGloryRewards');
    case 'END_ATTACK':
      return i18n.t('cardui.fx.endAttack');
    case 'DISABLE_ENEMY_DAMAGE':
      return i18n.t('cardui.fx.disableEnemyDamage', { duration: durT(e.duration) });
    case 'APPLY_VULNERABILITY':
      return i18n.t('cardui.fx.applyVulnerability', { bonus: describeValue(e.bonus), duration: durT(e.duration) });
    case 'DEFEAT_ENEMY':
      return i18n.t('cardui.fx.defeatEnemy', {
        target: enemyT(e.target as { kind?: string }),
        loot: noLootT(e.loot),
      });
    case 'SWAP_ENEMY':
      return i18n.t('cardui.fx.swapEnemy');
    case 'RETURN_TO_HORDE':
      return i18n.t('cardui.fx.returnToHorde', { target: enemyT(e.target as { kind?: string }) });
    case 'MODIFY_DAMAGE':
      return i18n.t('cardui.fx.modifyDamage', {
        mod: describeValue(e.modifier),
        scope: i18n.t(e.scope === 'NEXT_CARD' ? 'cardui.fx.scopeNextCard' : 'cardui.fx.scopeThisTurn'),
      });
    case 'MODIFY_FORTITUDE':
      return i18n.t('cardui.fx.modifyFortitude', {
        mod: describeValue(e.modifier),
        target: enemyT(e.target as { kind?: string }),
        duration: durT(e.duration),
      });
    case 'MODIFY_MARKET_COST':
      return i18n.t('cardui.fx.modifyMarketCost', { mod: describeValue(e.modifier) });
    case 'DRAW_AND_CHECK': {
      const name = e.expectedName ?? e.expectedCard;
      const match = joinFx(e.onMatch);
      const miss = joinFx(e.onMismatch);
      return i18n.t('cardui.fx.drawAndCheck', {
        amt,
        what: name ? i18n.t('cardui.fx.namedCard', { name }) : i18n.t('cardui.fx.expectedCard'),
        match: match || '—',
        miss: miss ? i18n.t('cardui.fx.conditionalElse', { else: miss }) : '',
      });
    }
    case 'PLAY_IMMEDIATELY':
      return i18n.t('cardui.fx.playImmediately');
    case 'PLACE_PERSISTENT':
      return i18n.t('cardui.fx.placePersistent', { fx: joinFx(e.effects) });
    case 'RECOVER_THIS_CARD':
      return i18n.t('cardui.fx.recoverThisCard', { dest: recoverDestT(e.to, 'toYourHand') });
    case 'REMOVE_FROM_GAME':
      return i18n.t('cardui.fx.removeFromGame');
    case 'ALL_HEROES_RECOVER':
      return i18n.t('cardui.fx.allHeroesRecover', { amt });
    case 'OTHER_HEROES_RECOVER':
      return i18n.t('cardui.fx.otherHeroesRecover', { amt });
    case 'INTERCEPT_DAMAGE':
      return i18n.t('cardui.fx.interceptDamage', { from: heroT(e.from as { kind?: string }) });
    case 'LOOK_AT_CARDS':
      return i18n.t('cardui.fx.lookAtCards', { amt });
    case 'PLAY_RANDOM_CARD_FROM_OTHER_HERO':
      return i18n.t('cardui.fx.playRandomFromOther');
    case 'CUSTOM_SCENARIO':
      return i18n.t('cardui.fx.customScenario');
    // === Extensiones del Taller ===
    case 'DEAL_DAMAGE_HITS':
      return i18n.t('cardui.fx.dealDamageHits', {
        times: describeValue(e.times), amt, target: enemyT(e.target as { kind?: string }),
      });
    case 'EXECUTE_ENEMY':
      return i18n.t('cardui.fx.executeEnemy', {
        target: enemyT(e.target as { kind?: string }),
        threshold: describeValue(e.threshold),
        loot: noLootT(e.loot),
      });
    case 'OVERKILL_DAMAGE':
      return i18n.t('cardui.fx.overkillDamage', {
        amt,
        target: enemyT(e.target as { kind?: string }),
        spill: enemyT(e.spill as { kind?: string }),
      });
    case 'SPAWN_ENEMY':
      return i18n.t('cardui.fx.spawnEnemy', { n: e.count ?? '?' });
    case 'DISCARD_HORDE_CARD':
      return i18n.t('cardui.fx.discardHordeCard', {
        n: e.count ?? '?',
        where: i18n.t(e.from === 'TOP' ? 'cardui.fx.hordeTop' : 'cardui.fx.hordeBottom'),
      });
    case 'MOVE_HORDE_CARDS':
      return i18n.t('cardui.fx.moveHordeCards', {
        n: e.count ?? '?',
        to: i18n.t(e.to === 'TOP' ? 'cardui.fx.hordeToTop' : 'cardui.fx.hordeToBottom'),
      });
    case 'DRAW_FROM_BOTTOM':
      return i18n.t('cardui.fx.drawFromBottom', { amt });
    case 'DRAW_UP_TO':
      return i18n.t('cardui.fx.drawUpTo', { limit: e.limit ?? '?' });
    case 'TAKE_WOUNDS':
      return i18n.t('cardui.fx.takeWounds', { hero: heroT(e.hero as { kind?: string }), amt });
    case 'GRANT_ARMOR':
      return i18n.t('cardui.fx.grantArmor', {
        amt,
        duration: durT(e.duration, i18n.t('cardui.duration.UNTIL_END_OF_TURN')),
      });
    case 'MOVE_CARD': {
      return i18n.t('cardui.fx.moveCard', { amt, from: zoneT(e.from), to: zoneT(e.to) });
    }
    case 'FOR_EACH': {
      const colKey = e.collection === 'OTHER_HEROES' ? 'colOtherHero'
        : e.collection === 'ALL_HEROES' ? 'colHero' : 'colEnemy';
      return i18n.t('cardui.fx.forEach', { col: i18n.t(`cardui.fx.${colKey}`), fx: joinFx(e.effects) });
    }
    case 'APPLY_STATUS':
      return i18n.t('cardui.fx.applyStatus', {
        status: e.status, stacks: describeValue(e.stacks), target: enemyT(e.target as { kind?: string }),
      });
    case 'REMOVE_STATUS':
      return i18n.t('cardui.fx.removeStatus', {
        status: e.status, target: enemyT(e.target as { kind?: string }),
      });
    case 'INCREASE_STATUS':
      return i18n.t('cardui.fx.increaseStatus', {
        amt, status: e.status, target: enemyT(e.target as { kind?: string }),
      });
    // === Extensiones del Taller (fase 2): variables, bloqueo, oyentes ===
    case 'SET_VARIABLE':
      return i18n.t('cardui.fx.setVariable', {
        name: e.name,
        value: describeValue(e.value),
        scope: e.scope === 'GAME' ? i18n.t('cardui.fx.scopeGame') : '',
      });
    case 'BLOCK_NEXT_DAMAGE':
      return i18n.t('cardui.fx.blockNextDamage', { amt });
    case 'TRY_EFFECT': {
      const fallback = joinFx(e.onFailure);
      return i18n.t('cardui.fx.tryEffect', {
        fx: joinFx(e.effects),
        fallback: fallback ? i18n.t('cardui.fx.tryFallback', { fx: fallback }) : '',
      });
    }
    case 'REGISTER_LISTENER':
      return i18n.t('cardui.fx.registerListener', {
        event: e.event,
        once: e.once ? i18n.t('cardui.fx.onceSuffix') : '',
        fx: joinFx(e.effects),
      });
    case 'REMOVE_LISTENER':
      return i18n.t('cardui.fx.removeListener', { tag: e.tag });
    case 'DISCARD_FROM_HAND':
      return i18n.t('cardui.fx.discardFromHand', { count: describeValue(e.count) as unknown as number });
    default:
      return i18n.t('cardui.fx.generic');
  }
}
