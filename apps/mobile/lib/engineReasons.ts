/**
 * engineReasons — traduce los reasonCode del motor a texto localizado.
 *
 * El motor devuelve `reason` en inglés libre + `reasonCode` estable
 * (evaluation.ts). La UI debe pintar el código traducido; el texto libre
 * solo se usa como fallback cuando el código es UNKNOWN/undefined.
 */

import type { TFunction } from 'i18next';
import { reasonToCode } from '@nt4h/engine';
import type { CommandReasonCode, CommandCostPreview } from '@nt4h/engine';

const CODE_KEY: Record<CommandReasonCode, string> = {
  WRONG_PHASE: 'hud.reasons.wrongPhase',
  NOT_YOUR_TURN: 'hud.reasons.notYourTurn',
  CARD_NOT_IN_HAND: 'hud.reasons.cardNotInHand',
  TARGET_NOT_FOUND: 'hud.reasons.targetNotFound',
  INSUFFICIENT_COINS: 'hud.reasons.insufficientCoins',
  SUPPORT_CARD_LIMIT: 'hud.reasons.supportCardLimit',
  EVASION_TOKEN_USED: 'hud.reasons.evasionUsed',
  EVASION_MIN_CARDS: 'hud.reasons.evasionMinCards',
  DUPLICATE_CARD_IDS: 'hud.reasons.duplicateCards',
  CARDS_NOT_IN_HAND: 'hud.reasons.cardsNotInHand',
  CARD_NOT_IN_MARKET: 'hud.reasons.cardNotInMarket',
  MISSING_CATALOG: 'hud.reasons.missingCatalog',
  CARD_DEF_NOT_FOUND: 'hud.reasons.cardDefNotFound',
  MISSING_CAPABILITIES: 'hud.reasons.missingCapabilities',
  CHOICE_NOT_FOUND: 'hud.reasons.choiceNotFound',
  TARGET_REQUIRED: 'hud.reasons.targetRequired',
  TARGET_INVALID: 'hud.reasons.targetInvalid',
  HERO_ELIMINATED: 'hud.reasons.heroEliminated',
  GAME_FINISHED: 'hud.reasons.gameFinished',
  NO_ABILITY_USES: 'hud.reasons.noAbilityUses',
  PENDING_CHOICE: 'hud.reasons.pendingChoice',
  INVALID_SELECTION: 'hud.reasons.invalidSelection',
  SOLO_ONLY: 'hud.reasons.soloOnly',
  SWAP_USED: 'hud.reasons.swapUsed',
  UNKNOWN: 'hud.reasons.unknown',
};

/** Texto localizado del motivo; `reason` libre solo como fallback. */
export function engineReasonText(
  t: TFunction,
  code: CommandReasonCode | undefined,
  reason: string | undefined,
  costs?: CommandCostPreview,
): string | undefined {
  if (!code) return reason;
  const params =
    code === 'INSUFFICIENT_COINS' && costs
      ? { need: costs.coinsRequired ?? '?', have: costs.coinsAvailable ?? '?' }
      : undefined;
  const translated = t(CODE_KEY[code], params);
  // UNKNOWN devuelve el reason crudo si existe (suele ser más informativo)
  if (code === 'UNKNOWN' && reason) return reason;
  return translated || reason;
}

/** Variante para llamadores que solo tienen el `reason` libre del motor. */
export function engineReasonFromText(
  t: TFunction,
  reason: string | undefined,
  costs?: CommandCostPreview,
): string | undefined {
  return engineReasonText(t, reasonToCode(reason), reason, costs);
}
