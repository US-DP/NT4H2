/**
 * Rewind local (undo del último comando, estilo Tabletop Playground).
 *
 * undoLastCommand re-ejecuta initialCommands menos el último sobre el
 * snapshot capturado al crear/cargar la partida (undoBase). Solo local.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { GameConfig } from '@nt4h/schema';

// Solitario: sin puja de Líder (D427) — el turno 1 arranca directamente
// y END_TURN siempre es legal, ideal para el test de rewind.
const config: GameConfig = {
  mode: 'SOLO',
  playerCount: 1,
  seed: 'undo-test-001',
  heroes: [
    { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
  ],
  useScenarios: false,
};

const initialState = useGameStore.getState();

describe('undo local (rewind)', () => {
  beforeEach(() => {
    useGameStore.setState(initialState, true);
  });

  it('registra la base al crear la partida', () => {
    useGameStore.getState().newGame(config);
    const s = useGameStore.getState();
    expect(s.gameState).not.toBeNull();
    expect(s.undoBase).not.toBeNull();
    expect(s.initialCommands).toHaveLength(0);
  });

  it('deshace el último comando y devuelve al estado base', () => {
    useGameStore.getState().newGame(config);
    const s0 = useGameStore.getState();
    const base = s0.undoBase!;
    const events0 = s0.gameState!.eventLog.length;
    const phase0 = s0.gameState!.phase;

    useGameStore.getState().endAttack(); // ATTACK_CHOICE → fase siguiente
    const s1 = useGameStore.getState();
    expect(s1.initialCommands).toHaveLength(1);
    expect(s1.gameState!.eventLog.length).toBeGreaterThan(events0);

    useGameStore.getState().undoLastCommand();
    const s2 = useGameStore.getState();
    expect(s2.initialCommands).toHaveLength(0);
    expect(s2.gameState!.phase).toBe(phase0);
    expect(s2.gameState!.eventLog.length).toBe(events0);
    expect(s2.gameState!.activePlayerId).toBe(base.state.activePlayerId);
  });

  it('sin comandos muestra aviso y no toca el estado', () => {
    useGameStore.getState().newGame(config);
    const before = useGameStore.getState().gameState;
    useGameStore.getState().undoLastCommand();
    expect(useGameStore.getState().gameState).toBe(before);
    expect(useGameStore.getState().ui.message).toBeTruthy();
  });

  it('es no-op en modo online', () => {
    useGameStore.getState().newGame(config);
    useGameStore.getState().endAttack();
    useGameStore.setState({ connectionMode: 'online' });
    const cmds = useGameStore.getState().initialCommands.length;
    useGameStore.getState().undoLastCommand();
    expect(useGameStore.getState().initialCommands).toHaveLength(cmds);
  });
});
