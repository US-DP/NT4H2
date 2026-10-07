/**
 * Generador temporal de la captura `game-end.png`: juega una partida
 * pasiva (los héroes nunca atacan ni compran → la Horda gana) y vuelca
 * un SavedGame importable a /tmp. No forma parte de la suite — se usa
 * solo para documentación. Ejecutar: pnpm vitest run _gen-finish
 */
import { it } from 'vitest';
// Opt-in: solo genera el save cuando se pide explícitamente (GEN_SAVE=1),
// para no escribir ficheros en corridas normales de la suite/CI.
const itGen = process.env.GEN_SAVE ? it : it.skip;
import { writeFileSync } from 'node:fs';
import { DeterministicRng } from '../src/rng/index.js';
import { setupGame, startFirstTurn, resetInstanceCounter } from '../src/phases/setup.js';
import { processPhases, resetPhaseSeq } from '../src/phases/engine.js';
import { execute } from '../src/commands/execute.js';
import { EffectRegistry, registerCoreEffects } from '../src/effects/registry.js';
import { resetResolveSeq } from '../src/effects/resolver.js';
import { resetAbilitySeq } from '../src/heroes/abilities.js';
import { resetScenarioSeq } from '../src/scenarios/index.js';
import { createReplay, stateHash, ENGINE_VERSION, SNAPSHOT_VERSION } from '../src/replay/index.js';
import { loadCatalog, CATALOG_VERSION } from '@nt4h/catalog';
import type { Command, GameState } from '@nt4h/schema';

itGen('partida pasiva hasta FINISHED → SavedGame JSON', () => {
  const catalog = loadCatalog();
  resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetAbilitySeq(); resetScenarioSeq();
  const registry = new EffectRegistry();
  registerCoreEffects(registry);
  const rng = new DeterministicRng('shot-game-end');
  const config = {
    mode: 'STANDARD',
    playerCount: 2,
    seed: 'shot-game-end',
    heroes: [
      { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
      { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'warrior.default' },
    ],
    useScenarios: false,
  };
  const setup = setupGame(config as never, catalog);
  let state: GameState = startFirstTurn(setup.state, rng, catalog).state;

  const commands: Command[] = [];
  let cid = 0;
  let lastReason = '';
  const tryExec = (c: Record<string, unknown>): boolean => {
    const command = { ...c, cid: `shot-${cid}` } as unknown as Command;
    const r = execute(state, command, rng, registry, catalog) as {
      accepted?: boolean; newState?: GameState; ok?: boolean; reason?: string;
    };
    if (!r.accepted || !r.newState) { lastReason = r.reason ?? '?'; return false; }
    cid++;
    commands.push(command);
    state = r.newState;
    return true;
  };

  let guard = 6000;
  const seen: Record<string, number> = {};
  while (state.phase !== 'FINISHED' && guard-- > 0) {
    seen[state.phase] = (seen[state.phase] ?? 0) + 1;
    const prevWounds = (state as GameState & {__pw?: number}).__pw ?? -1;
    const wounds = Object.entries(state.players).map(([id, p]) => `${id}:${p.wounds}/${p.maxWounds}`).join(',');
    if (wounds !== String(prevWounds) || guard % 300 === 0) {
      const last = state.eventLog.slice(-4).map(e => e.type).join('>');
      console.log(`iter=${6000 - guard} phase=${state.phase} turno=${state.turnNumber} activo=${state.activePlayerId} wounds=[${wounds}] evs=${last}`);
      (state as GameState & {__pw?: string}).__pw = wounds;
    }
    const choice = state.pendingChoices?.[0];
    if (choice) {
      if (choice.choiceId.startsWith('turn-start-')) {
        if (!tryExec({ type: 'ACCEPT_TURN_START_EFFECT', accepted: false, actorId: choice.playerId })) {
          throw new Error(`turn-start irresoluble: ${choice.choiceId}`);
        }
        continue;
      }
      const sel = choice.minSelections > 0
        ? choice.options.slice(0, choice.minSelections)
        : [];
      if (!tryExec({ type: 'RESOLVE_CHOICE', choiceId: choice.choiceId, selectedIds: sel })
        && !tryExec({ type: 'RESOLVE_CHOICE', choiceId: choice.choiceId, selectedIds: choice.options.slice(0, 1) })) {
        throw new Error(`elección irresoluble: ${choice.type} ${choice.choiceId}`);
      }
      continue;
    }
    if (!['ATTACK_CHOICE', 'PLAYER_ATTACK', 'MARKET'].includes(state.phase)) {
      const next = processPhases(state, rng, catalog).state;
      if (next.phase === state.phase && !next.pendingChoices.length) {
        throw new Error(`processPhases no avanza desde ${state.phase} turno ${state.turnNumber}`);
      }
      state = next;
      continue;
    }
    const me = state.players[state.activePlayerId];
    const dead = me && me.wounds >= (me.maxWounds ?? 3);
    if (dead) break; // héroe eliminado a mitad de turno: solo PASS (no-op) — fin
    let progressed = false;
    if (state.phase === 'MARKET') {
      for (const card of state.market) {
        if (tryExec({ type: 'BUY_CARD', marketCardInstanceId: card.instanceId })) { progressed = true; break; }
      }
      if (!progressed) progressed = tryExec({ type: 'END_TURN' });
    } else {
      const enemy = state.battlefield[0];
      for (const card of me.hand) {
        if (tryExec({ type: 'PLAY_CARD', cardInstanceId: card.instanceId, targetEnemyId: enemy?.instanceId })
          || tryExec({ type: 'PLAY_CARD', cardInstanceId: card.instanceId })) {
          progressed = true;
          break;
        }
      }
      if (!progressed) progressed = tryExec({ type: 'END_ATTACK' });
    }
    if (!progressed) {
      console.log(`sin progreso: fase=${state.phase} turno=${state.turnNumber} activo=${state.activePlayerId} rechazo=${lastReason}`);
      break;
    }
  }
  // Si la partida se atascó (héroe eliminado a mitad de turno) forzamos
  // el fin: la captura solo necesita un estado FINISHED verosímil.
  if (state.phase !== 'FINISHED') {
    state = { ...state, phase: 'FINISHED' };
    console.log('estado forzado a FINISHED para la captura');
  }
  console.log(`turnos=${state.turnNumber} comandos=${commands.length} eventos=${state.eventLog.length}`);

  // El envelope usa como "estado inicial" el estado FINAL con cero
  // comandos: loadGame restaura el snapshot directamente y la app
  // muestra la pantalla de fin sin re-ejecutar nada.
  const freshRng = new DeterministicRng('shot-game-end');
  const envelope = createReplay(
    config.mode, config.seed, state, [],
    { catalog: CATALOG_VERSION }, freshRng,
  );
  const saved = {
    id: 'shot-game-end',
    name: 'Partida de captura',
    savedAt: Date.now(),
    envelope,
    config,
    meta: {
      engineVersion: ENGINE_VERSION,
      catalogVersion: CATALOG_VERSION,
      snapshotVersion: SNAPSHOT_VERSION,
      stateHash: stateHash(state, rng.serialize().state),
    },
  };
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- SAVE_OUT es env del runner de tests
  writeFileSync(
    process.env.SAVE_OUT || '../../tools/game-end-save.json',
    JSON.stringify(saved),
  );
  console.log('save escrito — héroes:', Object.keys(state.players)
    .map((id) => `${id} wounds=${state.players[id].wounds}`).join(', '));
}, 300_000);
