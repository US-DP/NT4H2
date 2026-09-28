/** Slice gameplay del gameStore — extraido de gameStore.ts. */

import type { StateCreator } from 'zustand';
import type { GameStore } from '../shared.js';

import {
  customDecks,
  loadCatalogWithCustom,
  useCustomContent,
} from '../../lib/customContent';
import i18n from '../../lib/i18n';
import { prefetchCardImages } from '../../lib/prefetch.js';
import { useCollection } from '../collectionStore.js';
import { useSettings } from '../settingsStore.js';
import { newCid } from '../shared.js';
import {
  deckToConfigEntry,
  loadCatalog,
} from '@nt4h/catalog';
import {
  DeterministicRng,
  EffectRegistry,
  evaluateCommand,
  execute,
  processPhases,
  registerCoreEffects,
  resetInstanceCounter,
  resetPhaseSeq,
  resetResolveSeq,
  setupGame,
  startFirstTurn,
} from '@nt4h/engine';
import type {
  Command,
  GameConfig,
} from '@nt4h/schema';

type Actions = Pick<GameStore, 'initCatalog'|'newGame'|'playCard'|'endAttack'|'startEvasion'|'toggleEvasionCard'|'cancelEvasion'|'evasion'|'buyCard'|'endTurn'|'undoLastCommand'|'playHeroAbility'|'checkCardPlayable'|'checkMarketCardBuyable'|'resolvePendingChoice'|'chooseLeaderCards'>;

export const createGameplaySlice: StateCreator<GameStore, [['zustand/immer', never]], [], Actions> = (set, get) => ({
  initCatalog: () => {
    // Conjuntos del Taller (persistidos) → se fusionan al catálogo al cargar
    void useCustomContent.getState().init().then(() => {
      const merged = loadCatalogWithCustom();
      set((state) => { state.catalog = merged; });
      void prefetchCardImages(merged);
    });
    const catalog = loadCatalog();
    set((state) => {
      state.catalog = catalog;
    });
    // Precargar PNGs en segundo plano — la primera partida no espera descargas
    void prefetchCardImages(catalog);
  },

  newGame: (config: GameConfig) => {
    let catalog = get().catalog ?? loadCatalogWithCustom();
    // Si algún héroe usa un mazo personalizado, resolver su snapshot ahora
    // y fusionar el catálogo con los conjuntos del Taller.
    const decks = customDecks();
    const usesCustom = config.heroes?.some(h => h.customDeckId)
      || Boolean(config.hordeCardIds?.length)
      || Boolean(config.marketCardIds?.length)
      || Boolean(config.warlordIds?.length)
      || Boolean(config.scenarioIds?.some(id => id.startsWith('custom.') || !catalog.byId.has(id)));
    if (usesCustom || get().catalog === null) {
      catalog = loadCatalogWithCustom();
    }
    let resolvedConfig = config;
    if (usesCustom) {
      resolvedConfig = {
        ...config,
        customDecks: config.heroes
          .map(h => h.customDeckId ? decks.find(d => d.id === h.customDeckId) : undefined)
          .filter((d): d is NonNullable<typeof d> => d !== undefined)
          .map(deckToConfigEntry),
      };
    }
    // Partida rápida: recordar la última configuración usada
    useSettings.getState().set({ lastGameConfig: config });
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();

    const result = setupGame(resolvedConfig, catalog);

    // Colección: las cartas que entran en juego quedan "descubiertas"
    // (héroe elegido + cartas de su(s) mazo(s) + escenarios usados).
    const discovered: string[] = [];
    const abilityClasses = new Set<string>();
    for (const h of config.heroes ?? []) {
      discovered.push(h.heroId);
      for (const deckId of [h.deckId, h.secondDeckId]) {
        if (deckId) abilityClasses.add(deckId.split('.')[0].toUpperCase());
      }
    }
    for (const c of catalog.byId.values()) {
      if (c.type === 'ABILITY' && c.heroClass && abilityClasses.has(c.heroClass)) {
        discovered.push(c.id);
      }
    }
    for (const id of config.scenarioIds ?? []) discovered.push(id);
    useCollection.getState().markDiscovered(discovered);

    // D427: si hay pujas de Líder pendientes, la partida espera a que los
    // jugadores elijan cartas (CHOOSE_LEADER_CARDS). En solitario o si no
    // hay pujas, se arranca el turno 1 directamente.
    const hasPendingBids = result.state.pendingChoices.some(c => c.choiceId.startsWith('leader-bid-'));
    const turnResult = hasPendingBids
      ? { state: result.state, events: result.events }
      : startFirstTurn(result.state, result.rng, catalog);

    const registry = new EffectRegistry();
    registerCoreEffects(registry);

    set((state) => {
      state.gameState = turnResult.state;
      state.rng = result.rng;
      state.registry = registry;
      state.catalog = catalog;
      state.initialConfig = config;
      state.initialCommands = [];
      // Punto cero del rewind local: estado tras setup+primer turno y el
      // RNG en ese instante (los comandos aún no se han registrado).
      state.undoBase = {
        state: structuredClone(turnResult.state),
        rngState: result.rng.serialize().state,
        seed: config.seed,
      };
      // En puja pendiente, el primer viewer es el primer jugador sin pujar
      state.viewerId = hasPendingBids
        ? result.state.playerOrder[0] ?? null
        : turnResult.state.activePlayerId;
      state.ui.message = hasPendingBids
        ? i18n.t('common.msg.leaderBid')
        : i18n.t('common.msg.gameStarted', { id: turnResult.state.activePlayerId });
      state.ui.privacyScreen = config.playerCount > 1;
    });
  },

  playCard: (cardInstanceId: string, targetEnemyId?: string) => {
    const { gameState, rng, registry, catalog, connectionMode } = get();
    if (!gameState || !rng || !registry || !catalog) return;

    // D419: en online el servidor es autoritativo — nunca ejecutar localmente
    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'PLAY_CARD', cardInstanceId, targetEnemyId });
      set((state) => { state.ui.selectedCardInstanceId = null; });
      return;
    }

    const cardDef = catalog.byId.get(
      gameState.players[gameState.activePlayerId]?.hand.find(c => c.instanceId === cardInstanceId)?.definitionId ?? ''
    );

    // D430: pasar por execute — valida (isLegal), emite CARD_PLAYED/CARD_MOVED
    // y resuelve efectos via applyEvent (necesario para replay correcto)
    const cmd: Command = {
      type: 'PLAY_CARD',
      cid: newCid('play'),
      cardInstanceId,
      targetEnemyId,
    };
    const result = execute(gameState, cmd, rng, registry, catalog);
    if (!result.accepted) {
      set((state) => {
        state.ui.message = result.reason ?? i18n.t('common.msg.playFailed');
        state.ui.selectedCardInstanceId = null;
      });
      return;
    }
    // Procesar fases automáticas si la carta dejó pendingPhase
    const final = processPhases(result.newState, rng, catalog);

    set((state) => {
      if (state.gameState) {
        state.gameState = final.state;
      }
      state.initialCommands.push(cmd);
      state.ui.selectedCardInstanceId = null;
      state.ui.message = i18n.t('common.msg.cardPlayed', { name: cardDef?.name ?? cardInstanceId });
    });
  },

  endAttack: () => {
    const { gameState, rng, registry, catalog, connectionMode } = get();
    if (!gameState || !rng || !registry || !catalog) return;

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'END_ATTACK' });
      return;
    }

    // D430: pasar por execute para validar (isLegal) y emitir eventos correctos
    const cmd: Command = {
      type: 'END_ATTACK',
      cid: newCid('ea'),
    };
    const execResult = execute(gameState, cmd, rng, registry, catalog);
    if (!execResult.accepted) {
      set((state) => {
        state.ui.message = execResult.reason ?? i18n.t('common.msg.endAttackFailed');
      });
      return;
    }
    const result = processPhases(execResult.newState, rng, catalog);

    set((state) => {
      state.gameState = result.state;
      state.initialCommands.push(cmd);
      state.ui.message = i18n.t('common.msg.attackEnded');
    });
  },

  startEvasion: () => {
    set((state) => {
      state.ui.evasionSelection = [];
      state.ui.selectedCardInstanceId = null;
      state.ui.selectedEnemyInstanceId = null;
      state.ui.message = i18n.t('common.msg.chooseEvasion');
    });
  },

  toggleEvasionCard: (cardInstanceId: string) => {
    set((state) => {
      const sel = state.ui.evasionSelection;
      if (sel === null) return;
      state.ui.evasionSelection = sel.includes(cardInstanceId)
        ? sel.filter((id) => id !== cardInstanceId)
        : [...sel, cardInstanceId];
    });
  },

  cancelEvasion: () => {
    set((state) => {
      state.ui.evasionSelection = null;
      state.ui.message = null;
    });
  },

  evasion: (cardInstanceIds: string[]) => {
    const { gameState, rng, registry, catalog, connectionMode } = get();
    if (!gameState || !rng || !registry || !catalog) return;

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'EVASION', discardedCardInstanceIds: cardInstanceIds });
      set((state) => { state.ui.evasionSelection = null; });
      return;
    }

    const cmd: Command = {
      type: 'EVASION',
      cid: newCid('ev'),
      discardedCardInstanceIds: cardInstanceIds,
    };
    const execResult = execute(gameState, cmd, rng, registry, catalog);
    if (!execResult.accepted) {
      set((state) => {
        state.ui.message = execResult.reason ?? i18n.t('common.msg.evadeFailed');
      });
      return;
    }
    const result = processPhases(execResult.newState, rng, catalog);

    set((state) => {
      state.gameState = result.state;
      state.initialCommands.push(cmd);
      state.ui.evasionSelection = null;
      state.ui.message = i18n.t('common.msg.evasionDone', { count: cardInstanceIds.length });
    });
  },

  buyCard: (marketCardInstanceId: string) => {
    const { gameState, rng, registry, connectionMode } = get();
    if (!gameState || !rng || !registry) return;

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'BUY_CARD', marketCardInstanceId });
      return;
    }

    const cmd: Command = {
      type: 'BUY_CARD',
      cid: newCid('buy'),
      marketCardInstanceId,
    };

    const result = execute(gameState, cmd, rng, registry, get().catalog ?? undefined);
    if (!result.accepted) {
      set((state) => {
        state.ui.message = result.reason ?? i18n.t('common.msg.buyFailed');
      });
      return;
    }

    // Comprar puede disparar oyentes (REGISTER_LISTENER) y condiciones de
    // fin de partida → avanzar fases como en endTurn.
    const catalogNow = get().catalog;
    const final = catalogNow
      ? processPhases(result.newState, rng, catalogNow)
      : { state: result.newState };

    set((state) => {
      if (state.gameState) {
        state.gameState = final.state;
      }
      state.initialCommands.push(cmd);
      state.ui.message = i18n.t('common.msg.cardBought');
    });
  },

  endTurn: () => {
    const { gameState, rng, registry, catalog, connectionMode } = get();
    if (!gameState || !rng || !registry || !catalog) return;

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'END_TURN' });
      return;
    }

    // D430: pasar por execute para validar (isLegal) y emitir PHASE_CHANGED
    const cmd: Command = {
      type: 'END_TURN',
      cid: newCid('et'),
    };
    const execResult = execute(gameState, cmd, rng, registry, get().catalog ?? undefined);
    if (!execResult.accepted) {
      set((state) => {
        state.ui.message = execResult.reason ?? i18n.t('common.msg.endTurnFailed');
      });
      return;
    }
    const result = processPhases(execResult.newState, rng, catalog);

    set((state) => {
      state.gameState = result.state;
      state.initialCommands.push(cmd);
      state.ui.message = i18n.t('common.msg.turnOf', { id: result.state.activePlayerId });
      // En hot-seat, mostrar pantalla de privacidad al cambiar de jugador
      if (state.initialConfig && state.initialConfig.playerCount > 1) {
        state.ui.privacyScreen = true;
        state.viewerId = result.state.activePlayerId;
      }
    });
  },

  undoLastCommand: () => {
    const { connectionMode, undoBase, initialCommands, catalog } = get();
    // Solo local: en online el servidor es autoritativo (D419).
    if (connectionMode !== 'local' || !undoBase || !catalog) return;
    if (initialCommands.length === 0) {
      set((state) => { state.ui.message = i18n.t('gm.undoNone'); });
      return;
    }

    // Re-ejecutar el log sobre la base menos el último comando — el
    // mismo mecanismo del loadGame/replay (event sourcing §51.12).
    const cmds = initialCommands.slice(0, -1);
    const rng = DeterministicRng.deserialize({
      seed: undoBase.seed,
      state: undoBase.rngState,
    });
    const registry = new EffectRegistry();
    registerCoreEffects(registry);
    // structuredClone: si execute() mutara el estado de entrada, la base
    // del undo quedaría protegida para deshacer varios pasos seguidos.
    let restored = structuredClone(undoBase.state);
    for (const cmd of cmds) {
      const r = execute(restored, cmd, rng, registry, catalog, cmd.actorId);
      if (r.accepted) {
        restored = processPhases(r.newState, rng, catalog).state;
      }
    }

    set((state) => {
      state.gameState = restored;
      state.rng = rng;
      state.registry = registry;
      state.initialCommands = cmds;
      state.ui.selectedCardInstanceId = null;
      state.ui.selectedEnemyInstanceId = null;
      state.ui.evasionSelection = null;
      state.ui.message = i18n.t('gm.undoDone');
    });
  },

  playHeroAbility: (targetId?: string) => {
    const { gameState, rng, registry, connectionMode, viewerId } = get();
    if (!gameState || !rng || !registry) return;

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'USE_HERO_ABILITY', targetId });
      return;
    }

    // El actor puede no ser el jugador activo (pericia reactiva en la
    // ventana de la Horda) — actorId lo preserva para el replay.
    const actorId = viewerId ?? gameState.activePlayerId;
    const cmd: Command = {
      type: 'USE_HERO_ABILITY',
      cid: newCid('ability'),
      actorId,
      targetId,
    };

    const result = execute(gameState, cmd, rng, registry, get().catalog ?? undefined, actorId);
    if (!result.accepted) {
      set((state) => {
        state.ui.message = result.reason ?? i18n.t('common.msg.abilityFailed');
      });
      return;
    }

    // Una pericia puede derrotar al último Señor o disparar oyentes:
    // dejar que la máquina de fases avance hasta pedir entrada de nuevo.
    const catalogNow = get().catalog;
    const final = catalogNow
      ? processPhases(result.newState, rng, catalogNow)
      : { state: result.newState };

    set((state) => {
      if (state.gameState) {
        state.gameState = final.state;
      }
      state.initialCommands.push(cmd);
      state.ui.message = i18n.t('common.msg.abilityUsed');
    });
  },

  checkCardPlayable: (cardInstanceId: string) => {
    const { gameState, catalog, connectionMode, online, viewerId } = get();
    if (!gameState || !catalog) return { ok: false, reason: 'No hay partida activa' };
    // En online la jugabilidad es del jugador autenticado; en hot-seat, del viewer
    const actorId = connectionMode === 'online' && online.playerId
      ? online.playerId
      : viewerId ?? gameState.activePlayerId;
    const player = gameState.players[actorId];
    if (!player) return { ok: false, reason: 'Jugador no encontrado' };
    const cmd: Command = { type: 'PLAY_CARD', cid: newCid('check'), cardInstanceId };
    const evalResult = evaluateCommand(gameState, player.playerId, cmd, catalog);
    return { ok: evalResult.legal, reason: evalResult.reason, reasonCode: evalResult.reasonCode };
  },

  checkMarketCardBuyable: (marketCardInstanceId: string) => {
    const { gameState, catalog, connectionMode, online, viewerId } = get();
    if (!gameState || !catalog) return { ok: false, reason: 'No hay partida activa' };
    const actorId = connectionMode === 'online' && online.playerId
      ? online.playerId
      : viewerId ?? gameState.activePlayerId;
    const player = gameState.players[actorId];
    if (!player) return { ok: false, reason: 'Jugador no encontrado' };
    const cmd: Command = { type: 'BUY_CARD', cid: newCid('check-buy'), marketCardInstanceId };
    const evalResult = evaluateCommand(gameState, player.playerId, cmd, catalog);
    return { ok: evalResult.legal, reason: evalResult.reason, reasonCode: evalResult.reasonCode };
  },

  resolvePendingChoice: (choiceId: string, selectedIds: string[]) => {
    const { gameState, rng, registry, catalog, connectionMode, viewerId } = get();
    if (!gameState || !rng || !registry) return;

    // D427: el viewer actual resuelve SU elección (no la del jugador activo)
    const actorId = viewerId ?? gameState.activePlayerId;

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'RESOLVE_CHOICE', choiceId, selectedIds });
      return;
    }

    const cmd: Command = { type: 'RESOLVE_CHOICE', cid: newCid('cmd'), actorId, choiceId, selectedIds };
    const result = execute(gameState, cmd, rng, registry, catalog ?? undefined, actorId);
    if (!result.accepted) {
      set((state) => {
        state.ui.message = i18n.t('common.msg.choiceRejected', { reason: result.reason ?? i18n.t('common.msg.reasonUnknown') });
      });
      return;
    }

    // Procesar fases automáticas tras la resolución
    const phaseResult = catalog
      ? processPhases(result.newState, rng, catalog)
      : { state: result.newState };
    const finalState = phaseResult.state;

    set((state) => {
      state.gameState = finalState;
      state.initialCommands.push(cmd);
    });
  },

  chooseLeaderCards: (cardInstanceIds: string[]) => {
    const { gameState, rng, registry, catalog, connectionMode, viewerId } = get();
    if (!gameState || !rng || !registry) return;

    const actorId = viewerId ?? gameState.activePlayerId;

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'CHOOSE_LEADER_CARDS', cardInstanceIds });
      return;
    }

    const cmd: Command = { type: 'CHOOSE_LEADER_CARDS', cid: newCid('cmd'), actorId, cardInstanceIds };
    const result = execute(gameState, cmd, rng, registry, catalog ?? undefined, actorId);
    if (!result.accepted) {
      set((state) => {
        state.ui.message = i18n.t('common.msg.bidRejected', { reason: result.reason ?? i18n.t('common.msg.reasonUnknown') });
      });
      return;
    }

    const finalState = result.newState;
    set((state) => {
      state.gameState = finalState;
      state.initialCommands.push(cmd);
      // Tras pujar, pasar al siguiente jugador con puja pendiente (hot-seat)
      const nextBid = finalState.pendingChoices.find(c => c.choiceId.startsWith('leader-bid-'));
      if (nextBid) {
        state.viewerId = nextBid.playerId;
        state.ui.privacyScreen = true;
      } else {
        state.viewerId = finalState.activePlayerId;
        state.ui.privacyScreen = true;
      }
    });
  },
});
