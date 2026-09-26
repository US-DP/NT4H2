/**
 * evaluation — evaluación estructurada de comandos para la interfaz.
 *
 * `isLegal` responde si un comando puede ejecutarse; `evaluateCommand` añade
 * el contexto que la UI necesita para explicar el resultado sin reimplementar
 * reglas: código de motivo, objetivos válidos, costes y datos de previsión.
 *
 * Uso: la UI consume `evaluateCommand` en lugar de parsear `reason` libre.
 */

import type { Command, GameState } from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import { isLegal } from './commands/execute.js';

export type CommandReasonCode =
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'CARD_NOT_IN_HAND'
  | 'TARGET_NOT_FOUND'
  | 'INSUFFICIENT_COINS'
  | 'SUPPORT_CARD_LIMIT'
  | 'EVASION_TOKEN_USED'
  | 'EVASION_MIN_CARDS'
  | 'DUPLICATE_CARD_IDS'
  | 'CARDS_NOT_IN_HAND'
  | 'CARD_NOT_IN_MARKET'
  | 'MISSING_CATALOG'
  | 'CARD_DEF_NOT_FOUND'
  | 'MISSING_CAPABILITIES'
  | 'CHOICE_NOT_FOUND'
  | 'UNKNOWN';

export interface CommandCostPreview {
  coinsRequired?: number;
  coinsAvailable?: number;
  cardsRequired?: number;
  cardsAvailable?: number;
}

export interface CommandEvaluation {
  legal: boolean;
  reason?: string;
  reasonCode?: CommandReasonCode;
  /** Objetivos válidos (instanceIds de enemigos) para comandos dirigidos */
  validTargets?: string[];
  /** Desglose de costes/recursos relevantes para la decisión */
  costs?: CommandCostPreview;
}

/** Mapea los motivos libres de isLegal a códigos estables. */
function reasonToCode(reason: string | undefined): CommandReasonCode | undefined {
  if (!reason) return undefined;
  if (/not in (attack|market|restoration|attack choice)/i.test(reason)) return 'WRONG_PHASE';
  if (reason === 'Not your turn') return 'NOT_YOUR_TURN';
  if (reason === 'Card not in hand') return 'CARD_NOT_IN_HAND';
  if (reason === 'Target enemy not found') return 'TARGET_NOT_FOUND';
  if (reason.startsWith('Not enough coins')) return 'INSUFFICIENT_COINS';
  if (reason === 'Only 1 support card can be used per turn') return 'SUPPORT_CARD_LIMIT';
  if (reason === 'Evasion token already used this game') return 'EVASION_TOKEN_USED';
  if (reason === 'Must discard at least 2 cards to evade') return 'EVASION_MIN_CARDS';
  if (reason === 'Duplicate card IDs in evasion') return 'DUPLICATE_CARD_IDS';
  if (reason === 'Discarded cards must be from hand') return 'CARDS_NOT_IN_HAND';
  if (reason === 'Card not in market') return 'CARD_NOT_IN_MARKET';
  if (reason === 'Catalog required to validate purchase') return 'MISSING_CATALOG';
  if (reason === 'Card definition not found') return 'CARD_DEF_NOT_FOUND';
  if (reason === 'Hero lacks required capabilities') return 'MISSING_CAPABILITIES';
  return 'UNKNOWN';
}

export function evaluateCommand(
  state: GameState,
  playerId: string,
  command: Command,
  catalog?: CatalogLoadResult,
): CommandEvaluation {
  const result = isLegal(state, playerId, command, catalog);
  const evaluation: CommandEvaluation = {
    legal: result.ok,
    reason: result.reason,
    reasonCode: reasonToCode(result.reason),
  };
  const player = state.players[playerId];

  switch (command.type) {
    case 'PLAY_CARD': {
      evaluation.validTargets = state.battlefield.map(e => e.instanceId);
      break;
    }
    case 'BUY_CARD': {
      const card = state.market.find(c => c.instanceId === command.marketCardInstanceId);
      const def = card && catalog ? catalog.byId.get(card.definitionId) : undefined;
      if (def) {
        evaluation.costs = {
          coinsRequired: Math.max(0, (def.printedCost ?? 0) + state.marketCostModifier),
          coinsAvailable: player?.coins ?? 0,
        };
      }
      break;
    }
    case 'EVASION': {
      evaluation.costs = {
        cardsRequired: 2,
        cardsAvailable: player?.hand.length ?? 0,
      };
      break;
    }
    default:
      break;
  }

  return evaluation;
}
