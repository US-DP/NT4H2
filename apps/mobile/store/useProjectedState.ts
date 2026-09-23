/**
 * useProjectedState — hook que devuelve el estado proyectado para el viewer actual.
 *
 * En modo hot-seat, oculta la mano de otros jugadores.
 * En modo online (futuro), el backend enviaria ya el estado proyectado.
 */

import { useMemo } from 'react';
import { useGameStore } from './gameStore';
import { projectForPlayer, type PlayerGameState } from '@nt4h/engine';

export function useProjectedState(): PlayerGameState | null {
  const gameState = useGameStore((s) => s.gameState);
  const viewerId = useGameStore((s) => s.viewerId);

  return useMemo(() => {
    if (!gameState) return null;
    return projectForPlayer(gameState, viewerId);
  }, [gameState, viewerId]);
}
