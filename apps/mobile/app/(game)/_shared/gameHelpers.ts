/**
 * Helpers de la pantalla de partida: acciones contextuales e instrucción de fase.
 * Extraído de app/(game)/index.tsx.
 */

import type { TFunction } from 'i18next';
import type { ContextualAction } from '../../../components/ContextualActions';

export function buildContextualActions(
  phase: string,
  handlers: {
    endAttack: () => void;
    endTurn: () => void;
    useHeroAbility: () => void;
    canUseAbility: boolean;
    startEvasion: () => void;
    handSize: number;
    evasionTokenUsed: boolean;
  },
  t: TFunction,
): ContextualAction[] {
  switch (phase) {
    case 'ATTACK_CHOICE':
      return [
        { id: 'end-attack', label: t('gm.actionToHorde'), icon: '⚔️', onPress: handlers.endAttack, primary: true },
        {
          id: 'evasion',
          label: t('gm.actionEvade'),
          icon: '🏃',
          onPress: handlers.startEvasion,
          disabled: handlers.handSize < 2 || handlers.evasionTokenUsed,
          disabledReason: handlers.evasionTokenUsed
            ? t('gm.evasionUsed')
            : handlers.handSize < 2 ? t('gm.evasionNeedCards') : undefined,
        },
      ];
    case 'PLAYER_ATTACK':
      return [
        { id: 'end-attack', label: t('gm.actionEndAttack'), icon: '⚔️', onPress: handlers.endAttack, primary: true },
        {
          id: 'use-ability',
          label: t('gm.actionUsePower'),
          icon: '✨',
          onPress: handlers.useHeroAbility,
          disabled: !handlers.canUseAbility,
          disabledReason: handlers.canUseAbility ? undefined : t('gm.abilityExhausted'),
        },
      ];
    case 'MARKET':
      return [
        { id: 'end-market', label: t('gm.actionEndMarket'), icon: '💰', onPress: handlers.endTurn, primary: true },
      ];
    case 'RESTORATION':
      return [
        { id: 'confirm-restore', label: t('gm.actionConfirm'), icon: '✓', onPress: handlers.endTurn, primary: true },
      ];
    default:
      return [];
  }
}

/** Construye la instrucción concreta según la fase (UI-073). */
export function buildInstruction(phase: string, t: TFunction): string | null {
  switch (phase) {
    case 'PLAYER_ATTACK':
      return t('gm.instrPlayerAttack');
    case 'MARKET':
      return t('gm.instrMarket');
    case 'RESTORATION':
      return t('gm.instrRestoration');
    case 'ATTACK_CHOICE':
      return t('gm.instrAttackChoice');
    case 'HORDE_ATTACK':
      return t('gm.instrHordeAttack');
    // La puja de líder vive en INITIAL_PLAYER_SELECTION como pendingChoice
    // (no hay fase LEADER_CHOICE) — instrucción la da PendingChoiceView.
    default:
      return null;
  }
}

/** Pantalla final (UI-210..212). */
