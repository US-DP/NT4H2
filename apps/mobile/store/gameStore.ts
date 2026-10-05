/**
 * gameStore — estado del juego en el cliente (Zustand + immer).
 *
 * Mantiene:
 * - El estado del motor (GameState)
 * - El catalogo cargado
 * - El RNG
 * - Acciones para ejecutar comandos
 * - Estado de UI (pantalla actual, carta seleccionada, etc.)
 * - Modo hot-seat: viewerId para proyección de información
 * - Persistencia básica en localStorage (web) para guardar/cargar partidas
 *
 * Las acciones viven en slices por dominio (store/slices/*): ui, gameplay,
 * online y saves. Tipos y helpers compartidos en store/shared.ts.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GameState } from '@nt4h/schema';
import { ENGINE_VERSION } from '@nt4h/engine';
import { useCollection } from './collectionStore.js';
import { HIDDEN_CARD } from './shared.js';
import { createUiSlice } from './slices/ui.js';
import { createGameplaySlice } from './slices/gameplay.js';
import { createOnlineSlice } from './slices/online.js';
import { createSavesSlice } from './slices/saves.js';
import type { GameStore } from './shared.js';

// Re-exportar la API publica (tipos, compatibilidad de saves, constantes)
export type { GameUIState, SavedGame, TrashedGame, SaveCompatibility, CommandWithoutCid, GameStore } from './shared.js';
export { classifySavedGame, sanitizeOnlineState, HIDDEN_CARD } from './shared.js';
export { TRASH_RETENTION_DAYS, MAX_IMPORT_BYTES } from './slices/saves.js';

export const useGameStore = create<GameStore>()(
  immer((set, get, api) => ({
    gameState: null,
    rng: null,
    registry: null,
    catalog: null,
    connectionMode: 'local',
    online: {
      roomId: null,
      playerId: null,
      playerToken: null,
      socket: null,
      lastRevision: null,
      lastMessageAt: null,
      hostId: null,
      turnStartedAt: null,
      lastCid: null,
    },
    viewerId: null,
    undoBase: null,
    initialCommands: [],
    initialConfig: null,
    savedGames: [],
    trashedGames: [],
    ui: {
      selectedCardInstanceId: null,
      selectedEnemyInstanceId: null,
      message: null,
      privacyScreen: false,
      evasionSelection: null,
      swapSelection: null,
    },
    mutedChatSenders: [],
    ...createUiSlice(set, get, api),
    ...createGameplaySlice(set, get, api),
    ...createOnlineSlice(set, get, api),
    ...createSavesSlice(set, get, api),
  }))
);

// Colección: las cartas que se revelan durante la partida quedan
// "descubiertas" — enemigos del campo, oferta del Mercado, escenario
// activo y cartas vistas en manos/desgaste/persistentes.
let lastDiscoveryState: GameState | null = null;
useGameStore.subscribe((s) => {
  const gs = s.gameState;
  if (!gs || gs === lastDiscoveryState) return;
  lastDiscoveryState = gs;
  const revealed = new Set<string>();
  for (const e of gs.battlefield ?? []) revealed.add(e.definitionId);
  for (const c of gs.market ?? []) revealed.add(c.definitionId);
  if (gs.scenario?.definitionId) revealed.add(gs.scenario.definitionId);
  for (const p of Object.values(gs.players ?? {})) {
    for (const c of p.hand ?? []) revealed.add(c.definitionId);
    for (const c of p.wearPile ?? []) revealed.add(c.definitionId);
    for (const c of p.persistentCards ?? []) revealed.add(c.definitionId);
  }
  // El centinela online nunca debe registrarse en la colección: no es una
  // carta real (sanitizeOnlineState lo usa para ocultar manos ajenas).
  revealed.delete(HIDDEN_CARD);
  if (revealed.size > 0) useCollection.getState().markDiscovered([...revealed]);
});

// Re-exportar para uso en componentes
export { ENGINE_VERSION };
