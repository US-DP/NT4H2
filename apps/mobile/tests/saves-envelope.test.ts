/**
 * Regresión Fase-1 de la auditoría:
 *
 * - M-1: saveGame serializa el estado INICIAL (undoBase), no el final —
 *   el envelope + comandos deben reproducir la partida, no re-ejecutar
 *   comandos sobre el estado ya resuelto.
 * - M-3: newGame propaga result.errors de setupGame y no instala estado.
 * - M-4: partida local "oficial" con sets del Taller instalados → pools
 *   explícitos oficiales (sin contaminación custom).
 * - M-5: markDiscovered antes de hidratar no pisa el JSON persistido.
 * - M-10: la importación acepta customSets del contenedor .nt4hsave.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { useCustomContent } from '../lib/customContent';
import { useCollection } from '../store/collectionStore';
import { storageSet } from '../lib/storage';
import { stateHash } from '@nt4h/engine';
import type { CardDefinition, GameConfig } from '@nt4h/schema';
import type { SavedGame } from '../store/shared';

const config: GameConfig = {
  mode: 'SOLO',
  playerCount: 1,
  seed: 'env-test-001',
  heroes: [
    { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
  ],
  useScenarios: false,
};

const initialStore = useGameStore.getState();
const initialCustom = useCustomContent.getState();

/** Espera a que el async interno de loadGame termine (son microtareas de storage). */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (useGameStore.getState().gameState) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Saves — envelope y round-trip (M-1)', () => {
  beforeEach(() => {
    useGameStore.setState(initialStore, true);
    useCustomContent.setState(initialCustom, true);
  });

  it('initialState del envelope es el snapshot inicial (undoBase), no el estado final', async () => {
    useGameStore.getState().newGame(config);
    useGameStore.getState().endAttack(); // genera eventos + 1 comando
    const s = useGameStore.getState();
    const baseTurn = s.undoBase!.state.turnNumber;
    const liveEvents = s.gameState!.eventLog.length;

    const ok = await useGameStore.getState().saveGame('rt');
    expect(ok).toBe(true);
    const saved = useGameStore.getState().savedGames.at(-1)!;
    const snap = saved.envelope.initialState;

    expect(snap.state.turnNumber).toBe(baseTurn);
    expect(snap.state.eventLog.length).toBeLessThan(liveEvents);
    expect(snap.seq).toBe(s.undoBase!.seq);
    expect(saved.envelope.commands).toHaveLength(1);
  });

  it('loadGame reproduce el estado final bit a bit (hash estable)', async () => {
    useGameStore.getState().newGame(config);
    useGameStore.getState().endAttack();
    const s = useGameStore.getState();
    const liveHash = stateHash(s.gameState!, s.rng!.serialize().state);

    await useGameStore.getState().saveGame('rt');
    const saved = useGameStore.getState().savedGames.at(-1)!;
    // El hash guardado debe coincidir con el estado EN VIVO (final)
    expect(saved.meta!.stateHash).toBe(liveHash);

    // Simular reinicio: sin estado vivo
    useGameStore.setState({ gameState: null, rng: null, undoBase: null, initialCommands: [] });
    useGameStore.getState().loadGame(saved.id);
    await settle();

    const r = useGameStore.getState();
    expect(r.gameState).not.toBeNull();
    expect(stateHash(r.gameState!, r.rng!.serialize().state)).toBe(liveHash);
    expect(r.ui.message ?? '').not.toContain('rechazad');
  });
});

describe('newGame — errores y contenido custom (M-3/M-4/M-9)', () => {
  beforeEach(() => {
    useGameStore.setState(initialStore, true);
    useCustomContent.setState({ ...initialCustom, sets: [], loaded: true });
  });

  it('config inválida devuelve errores y no instala estado (M-3)', () => {
    const res = useGameStore.getState().newGame({
      ...config,
      heroes: [{ playerId: 'p1', heroId: 'hero.inexistente', heroFace: 'FEMALE', deckId: 'explorer.default' }],
    });
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(useGameStore.getState().gameState).toBeNull();
    expect(useGameStore.getState().ui.message).toBeTruthy();
  });

  it('config con mazo custom sin hidratar → error claro (M-9)', () => {
    useCustomContent.setState({ sets: [], loaded: false });
    const res = useGameStore.getState().newGame({
      ...config,
      heroes: [{ playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'x', customDeckId: 'custom.deck-1' }],
    });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('Taller');
    expect(useGameStore.getState().gameState).toBeNull();
  });

  it('partida oficial con set custom instalado no contamina los pools (M-4)', () => {
    const customMarket: CardDefinition = {
      id: 'custom.market-x',
      name: 'Infiltrada',
      type: 'MARKET',
      copies: 1,
      printedCost: 1,
      printedAttack: 0,
      effects: [],
      destinationAfterUse: 'WEAR_PILE',
      verificationStatus: 'CONFIRMED',
      author: 'test',
      version: '1.0.0',
      officialStatus: 'CUSTOM',
      setId: 'set.taller-local',
    } as CardDefinition;
    expect(useCustomContent.getState().upsertCard(customMarket)).toEqual([]);
    expect(useCustomContent.getState().sets.length).toBeGreaterThan(0);

    const res = useGameStore.getState().newGame(config);
    expect(res.ok).toBe(true);
    const st = useGameStore.getState().gameState!;
    // El mazo de mercado debe contener SOLO ids oficiales
    for (const c of st.marketDeck) {
      expect(c.definitionId.startsWith('custom.')).toBe(false);
    }
    for (const c of st.hordeDeck) {
      expect(c.definitionId.startsWith('custom.')).toBe(false);
    }
  });
});

describe('Colección — hidratación segura (M-5)', () => {
  it('markDiscovered antes de hidratar conserva lo persistido', async () => {
    // Estado persistido previo: favorito + ajuste no por defecto
    await storageSet('nt4h.collection.v1', JSON.stringify({
      favorites: ['hero.feldon'],
      discovered: ['hero.old'],
      sort: 'cost',
      spoilerMode: 'show',
      originFilter: 'official',
    }));
    // Simular store fresco (la hidratación real pasa en _layout, pero el
    // mutador no debe depender del orden de pantallas).
    useCollection.setState({ hydrated: false, favorites: [], discovered: [] });

    useCollection.getState().markDiscovered(['hero.aranel']);
    await useCollection.getState().hydrate();
    // La mutación diferida corre tras la hidratación
    await new Promise((r) => setTimeout(r, 20));

    const s = useCollection.getState();
    expect(s.favorites).toContain('hero.feldon');
    expect(s.sort).toBe('cost');
    expect(s.spoilerMode).toBe('show');
    expect(s.discovered).toContain('hero.old');
    expect(s.discovered).toContain('hero.aranel');
  });
});

describe('Importación — customSets (M-10)', () => {
  beforeEach(() => {
    useGameStore.setState(initialStore, true);
  });

  it('un contenedor .nt4hsave con customSets los conserva en el SavedGame', async () => {
    const env = {
      version: '1.0',
      gameType: 'NT4H',
      seed: 's1',
      engineVersion: '0.1.0',
      contentVersions: {},
      initialState: {
        version: 1,
        engineVersion: '0.1.0',
        seed: 's1',
        rngState: 1,
        state: { mode: 'STANDARD', phase: 'ATTACK', players: {}, playerOrder: [] },
        eventCount: 0,
        takenAt: 0,
      },
      commands: [],
    };
    const container = {
      format: 'nt4hsave',
      name: 'Con sets',
      envelope: env,
      customSets: [{ id: 'set.x', name: 'X', version: '1.0.0', author: 'a', status: 'PUBLISHED', cards: [], decks: [] }],
    };
    const err = await useGameStore.getState().importSavedGame(JSON.stringify(container));
    expect(err).toBeNull();
    const saved = useGameStore.getState().savedGames.find((g) => g.name === 'Con sets') as SavedGame | undefined;
    expect(saved?.customSets?.[0]?.id).toBe('set.x');
  });
});
