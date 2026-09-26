/**
 * Partidas guardadas: clasificación de compatibilidad e importación.
 *
 * - classifySavedGame distingue compatible / version-mismatch / incompatible
 * - importSavedGame valida el JSON, reconstruye el SavedGame y clasifica
 * - importSavedGame rechaza ficheros corruptos o incompatibles
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore, classifySavedGame, type SavedGame } from '../store/gameStore';
import { SNAPSHOT_VERSION, ENGINE_VERSION } from '@nt4h/engine';

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0',
    gameType: 'NT4H',
    seed: 'seed-1',
    engineVersion: ENGINE_VERSION,
    contentVersions: {},
    initialState: {
      version: SNAPSHOT_VERSION,
      engineVersion: ENGINE_VERSION,
      seed: 'seed-1',
      rngState: 1,
      state: { mode: 'STANDARD', phase: 'ATTACK', players: {}, playerOrder: [] },
      eventCount: 0,
      takenAt: 0,
    },
    commands: [],
    ...overrides,
  };
}

function makeSaved(overrides: Partial<SavedGame> = {}): SavedGame {
  return {
    id: 's1',
    name: 'Partida de prueba',
    savedAt: Date.now(),
    envelope: makeEnvelope() as unknown as SavedGame['envelope'],
    meta: {
      engineVersion: ENGINE_VERSION,
      catalogVersion: '0.1.0',
      snapshotVersion: SNAPSHOT_VERSION,
      stateHash: 'abc123',
    },
    ...overrides,
  };
}

const initialState = useGameStore.getState();

describe('Saves — clasificación e importación', () => {
  beforeEach(() => {
    useGameStore.setState(initialState, true);
  });

  it('classifySavedGame: compatible con versiones actuales', () => {
    expect(classifySavedGame(makeSaved())).toBe('compatible');
  });

  it('classifySavedGame: version-mismatch con motor distinto', () => {
    const saved = makeSaved({ meta: { engineVersion: '9.9.9', catalogVersion: '0.1.0', snapshotVersion: SNAPSHOT_VERSION, stateHash: 'x' } });
    expect(classifySavedGame(saved)).toBe('version-mismatch');
  });

  it('classifySavedGame: incompatible con snapshot distinto', () => {
    const saved = makeSaved();
    (saved.envelope.initialState as { version: number }).version = SNAPSHOT_VERSION + 99;
    expect(classifySavedGame(saved)).toBe('incompatible');
  });

  it('importSavedGame: rechaza JSON corrupto', async () => {
    const err = await useGameStore.getState().importSavedGame('{no-json');
    expect(err).toBe('El fichero no es JSON válido');
  });

  it('importSavedGame: rechaza JSON sin envelope válido', async () => {
    const err = await useGameStore.getState().importSavedGame(JSON.stringify({ foo: 1 }));
    expect(err).toBe('El fichero no contiene una partida NT4H válida');
  });

  it('importSavedGame: rechaza snapshot incompatible', async () => {
    const env = makeEnvelope();
    (env.initialState as { version: number }).version = SNAPSHOT_VERSION + 99;
    const err = await useGameStore.getState().importSavedGame(JSON.stringify(env));
    expect(err).toBe('La partida fue creada con una versión incompatible del motor');
  });

  it('importSavedGame: añade la partida y avisa en ui.message', async () => {
    const err = await useGameStore.getState().importSavedGame(JSON.stringify(makeEnvelope()));
    expect(err).toBeNull();
    const games = useGameStore.getState().savedGames;
    expect(games.some((g) => g.id.startsWith('imported-'))).toBe(true);
    expect(useGameStore.getState().ui.message).toContain('Partida importada');
  });

  it('importSavedGame: admite version-mismatch con aviso', async () => {
    const env = makeEnvelope({ engineVersion: '9.9.9' });
    const err = await useGameStore.getState().importSavedGame(JSON.stringify(env));
    expect(err).toBeNull();
    expect(useGameStore.getState().ui.message).toContain('versión distinta');
  });
});


describe('Saves — importación hostil', () => {
  beforeEach(() => {
    useGameStore.setState(initialState, true);
  });

  it('rechaza ficheros que superan el límite de tamaño', async () => {
    const huge = 'x'.repeat(9 * 1024 * 1024);
    const err = await useGameStore.getState().importSavedGame(huge);
    expect(err).toBe('El fichero es demasiado grande para importarse');
  });

  it('rechaza JSON con profundidad extrema', async () => {
    // 60 niveles de anidamiento > MAX_IMPORT_DEPTH (40)
    const deep = '['.repeat(60) + '1' + ']'.repeat(60);
    const err = await useGameStore.getState().importSavedGame(deep);
    expect(err).toBe('El fichero no es JSON válido');
  });

  it('elimina claves de prototipo y sensibles del contenido importado', async () => {
    const env = makeEnvelope();
    const state = env.initialState.state as Record<string, unknown>;
    state['__proto__'] = { polluted: true };
    state['authToken'] = 'stolen-token';
    const err = await useGameStore.getState().importSavedGame(JSON.stringify(env));
    expect(err).toBeNull();
    const saved = useGameStore.getState().savedGames.find(g => g.id.startsWith('imported-'));
    const importedState = (saved!.envelope.initialState as unknown as { state: Record<string, unknown> }).state;
    expect(Object.prototype.hasOwnProperty.call(importedState, 'authToken')).toBe(false);
    // __proto__ quedó como clave propia inofensiva o eliminada, nunca como prototipo
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rechaza comandos de tipo desconocido', async () => {
    const env = makeEnvelope({ commands: [{ type: 'DELETE_ALL', cid: 'x' }] });
    const err = await useGameStore.getState().importSavedGame(JSON.stringify(env));
    expect(err).toBe('El fichero contiene comandos no válidos');
  });

  it('rechaza más de 50.000 comandos', async () => {
    const env = makeEnvelope({
      commands: Array.from({ length: 50_001 }, (_, i) => ({ type: 'PASS', cid: `c${i}` })),
    });
    const err = await useGameStore.getState().importSavedGame(JSON.stringify(env));
    expect(err).toBe('El fichero contiene demasiados comandos');
  });

  it('asigna siempre un id nuevo aunque el fichero traiga uno', async () => {
    const env = makeEnvelope();
    const container = { format: 'nt4hsave', id: 'evil-id', name: 'X', envelope: env };
    const err = await useGameStore.getState().importSavedGame(JSON.stringify(container));
    expect(err).toBeNull();
    const saved = useGameStore.getState().savedGames.find(g => g.name === 'X');
    expect(saved).toBeTruthy();
    expect(saved!.id.startsWith('imported-')).toBe(true);
    expect(saved!.id).not.toBe('evil-id');
  });
});
