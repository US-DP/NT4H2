/** Slice ui del gameStore — extraido de gameStore.ts. */

import type { StateCreator } from 'zustand';
import type { GameStore } from '../shared.js';

import { sanitizeOnlineState } from '../shared.js';
import { loadCatalog } from '@nt4h/catalog';
import {
  EffectRegistry,
  registerCoreEffects,
} from '@nt4h/engine';
import type { GameState } from '@nt4h/schema';

type Actions = Pick<GameStore, 'selectCard'|'selectEnemy'|'setMessage'|'toggleMuteChatSender'|'setGameState'|'passPrivacy'|'handOverTo'>;

export const createUiSlice: StateCreator<GameStore, [['zustand/immer', never]], [], Actions> = (set, get) => ({
  selectCard: (cardInstanceId: string | null) => {
    set((state) => {
      state.ui.selectedCardInstanceId = cardInstanceId;
    });
  },

  selectEnemy: (enemyInstanceId: string | null) => {
    set((state) => {
      state.ui.selectedEnemyInstanceId = enemyInstanceId;
    });
  },

  setMessage: (msg: string | null) => {
    set((state) => {
      state.ui.message = msg;
    });
  },

  toggleMuteChatSender: (sender: string) => {
    set((state) => {
      const idx = state.mutedChatSenders.indexOf(sender);
      if (idx >= 0) state.mutedChatSenders.splice(idx, 1);
      else state.mutedChatSenders.push(sender);
    });
  },

  setGameState: (gameState: GameState) => {
    const catalog = get().catalog ?? loadCatalog();
    const registry = get().registry ?? new EffectRegistry();
    if (get().registry === null) {
      registerCoreEffects(registry);
    }
    const { connectionMode, online } = get();
    // D420: en online, el servidor envía el estado completo — sanitizar para
    // ocultar manos ajenas, mazos, RNG y eventos privados antes de guardar.
    const sanitized = connectionMode === 'online'
      ? sanitizeOnlineState(gameState, online.playerId)
      : gameState;
    const viewerId = connectionMode === 'online' && online.playerId
      ? online.playerId
      : gameState.activePlayerId;
    set((state) => {
      state.gameState = sanitized;
      state.catalog = catalog;
      state.registry = registry;
      state.viewerId = viewerId;
    });
  },

  passPrivacy: () => {
    set((state) => {
      state.ui.privacyScreen = false;
    });
  },

  handOverTo: (playerId: string) => {
    set((state) => {
      state.viewerId = playerId;
      state.ui.privacyScreen = true;
    });
  },
});
