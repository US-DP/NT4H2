/** Slice gameplay del gameStore — extraido de gameStore.ts. */

import type { StateCreator } from 'zustand';
import type { GameStore } from '../shared.js';

import {
  customDecks,
  loadCatalogWithCustom,
  useCustomContent,
} from '../../lib/customContent';
import i18n from '../../lib/i18n';
import { engineReasonFromText } from '../../lib/engineReasons';
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
  currentSeq,
  evaluateCommand,
  execute,
  processPhases,
  registerCoreEffects,
  resetInstanceCounter,
  resetPhaseSeq,
  resetResolveSeq,
  resetSeq,
  setSeq,
  setupGame,
  startFirstTurn,
} from '@nt4h/engine';
import type {
  Command,
  GameConfig,
} from '@nt4h/schema';

type Actions = Pick<GameStore, 'initCatalog'|'newGame'|'playCard'|'endAttack'|'startEvasion'|'toggleEvasionCard'|'cancelEvasion'|'evasion'|'buyCard'|'endTurn'|'undoLastCommand'|'playHeroAbility'|'checkCardPlayable'|'checkMarketCardBuyable'|'resolvePendingChoice'|'chooseLeaderCards'|'acceptTurnStartEffect'|'swapStartingCards'|'openSupportDeck'|'buySupportCard'|'toggleSwapMode'|'toggleSwapCard'>;

export const createGameplaySlice: StateCreator<GameStore, [['zustand/immer', never]], [], Actions> = (set, get) => ({
  initCatalog: async () => {
    const catalog = loadCatalog();
    set((state) => {
      state.catalog = catalog;
    });
    // Precargar PNGs en segundo plano — la primera partida no espera descargas
    void prefetchCardImages(catalog);
    try {
      // Conjuntos del Taller (persistidos) → se fusionan al catálogo.
      // Await: quien cree una partida con contenido custom necesita que
      // esta promesa haya resuelto (antes el merge llegaba tarde y un
      // customDeckId resolvía contra el catálogo oficial → setup error).
      await useCustomContent.getState().init();
      const merged = loadCatalogWithCustom();
      set((state) => { state.catalog = merged; });
      void prefetchCardImages(merged);
    } catch {
      // Init rechazado (storage corrupto etc.): el catálogo oficial ya
      // está cargado — solo se pierde el Taller.
      console.warn('useCustomContent.init failed — catálogo oficial en uso');
    }
  },

  newGame: (config: GameConfig) => {
    // Una sesión online viva seguiría pisando gameState con cada
    // broadcast command_result → cortar antes de crear la partida local.
    if (get().connectionMode === 'online') get().disconnectOnline();
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
    const customState = useCustomContent.getState();
    // La hidratación del Taller es async: una config con mazos/pools
    // custom ejecutada antes de init() resolvería contra el catálogo
    // oficial y fallaría con "unknown id" — rechazar con motivo claro.
    if (usesCustom && !customState.loaded) {
      const errors = [i18n.t('common.msg.customNotLoaded')];
      set((state) => { state.ui.message = errors[0]; });
      return { ok: false, errors };
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
    // Pools ausentes = whitelist oficial EXPLÍCITA (paridad con la ruta
    // online de (play)/index.tsx): el default del motor usa todo
    // catalog.byType, que tras la fusión incluye las cartas del Taller —
    // sin esto una partida "oficial" con sets instalados se contaminaba.
    if (customState.sets.length > 0) {
      const official = loadCatalog();
      const officialIds = (tp: string) => (official.byType.get(tp) ?? []).map(c => c.id);
      resolvedConfig = {
        ...resolvedConfig,
        hordeCardIds: config.hordeCardIds?.length ? config.hordeCardIds : officialIds('HORDE'),
        warlordIds: config.warlordIds?.length ? config.warlordIds : officialIds('WARLORD'),
        marketCardIds: config.marketCardIds?.length ? config.marketCardIds : officialIds('MARKET'),
        ...(config.useScenarios && !config.scenarioIds?.length
          ? { scenarioIds: officialIds('SCENARIO') }
          : {}),
      };
    }
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();

    const result = setupGame(resolvedConfig, catalog);

    // setupGame acumula errores sin lanzar (héroes inexistentes, pools
    // vacíos, mazos inválidos) — instalar el estado parcial igualmente
    // dejaba la partida colgada en INITIAL_PLAYER_SELECTION. Misma
    // política que el runner: rechazar y mostrar los motivos.
    if (result.errors.length > 0) {
      set((state) => { state.ui.message = i18n.t('common.msg.newGameFailed'); });
      return { ok: false, errors: result.errors };
    }
    // Partida rápida: recordar la última configuración usada (solo si
    // arrancó — una config rota no debe repetirse por "partida rápida").
    useSettings.getState().set({ lastGameConfig: config });

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
      // Punto cero del rewind local: estado tras setup+primer turno, el
      // RNG y el seq global en ese instante (los comandos aún no se han
      // registrado). El seq también es el del snapshot del save (§51.12).
      state.undoBase = {
        state: structuredClone(turnResult.state),
        rngState: result.rng.serialize().state,
        seed: config.seed,
        seq: currentSeq(),
      };
      // En puja pendiente, el primer viewer es el primer jugador sin pujar
      state.viewerId = hasPendingBids
        ? result.state.playerOrder[0] ?? null
        : turnResult.state.activePlayerId;
      state.ui.message = hasPendingBids
        ? i18n.t('common.msg.leaderBid')
        : i18n.t('common.msg.gameStarted', { id: turnResult.state.activePlayerId });
      state.ui.privacyScreen = config.playerCount > 1;
      // Un modo de selección del juego anterior no debe arrastrarse
      // (los instanceIds ya no existen en la nueva partida — y con
      // resetInstanceCounter pueden reciclarse y apuntar a otra carta,
      // p.ej. Enter jugando una selección que el usuario nunca hizo)
      state.ui.evasionSelection = null;
      state.ui.swapSelection = null;
      state.ui.selectedCardInstanceId = null;
      state.ui.selectedEnemyInstanceId = null;
    });
    return { ok: true, errors: [] };
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
        state.ui.message = engineReasonFromText(i18n.t, result.reason) ?? i18n.t('common.msg.playFailed');
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
        state.ui.message = engineReasonFromText(i18n.t, execResult.reason) ?? i18n.t('common.msg.endAttackFailed');
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
        state.ui.message = engineReasonFromText(i18n.t, execResult.reason) ?? i18n.t('common.msg.evadeFailed');
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
        state.ui.message = engineReasonFromText(i18n.t, result.reason) ?? i18n.t('common.msg.buyFailed');
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
        state.ui.message = engineReasonFromText(i18n.t, execResult.reason) ?? i18n.t('common.msg.endTurnFailed');
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
    // Restaurar los contadores globales al punto del snapshot: sin esto el
    // rewind genera instanceIds/seqs a partir del contador vivo y diverge
    // del run original (mismo tratamiento que loadGame/replayInit).
    if (typeof undoBase.seq === 'number') setSeq(undoBase.seq);
    else resetSeq();
    resetInstanceCounter();
    const registry = new EffectRegistry();
    registerCoreEffects(registry);
    // structuredClone: si execute() mutara el estado de entrada, la base
    // del undo quedaría protegida para deshacer varios pasos seguidos.
    let restored = structuredClone(undoBase.state);
    // Contar rechazos como loadGame: si el catálogo/reglas cambiaron
    // desde que se jugó, un comando rechazado deja el estado divergido —
    // truncar initialCommands encima amplificaría la divergencia en los
    // siguientes undos sin que el jugador lo supiera.
    let rejected = 0;
    for (const cmd of cmds) {
      const r = execute(restored, cmd, rng, registry, catalog, cmd.actorId);
      if (r.accepted) {
        restored = processPhases(r.newState, rng, catalog).state;
      } else {
        rejected += 1;
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
      // Hot-seat: el turno rebobinado puede ser de otro jugador — el
      // viewer debe seguir al nuevo activo o los comandos siguientes
      // actuarían con el actorId equivocado.
      state.viewerId = restored.activePlayerId;
      state.ui.privacyScreen =
        (state.initialConfig?.playerCount ?? 1) > 1;
      state.ui.message = rejected > 0
        ? i18n.t('gm.undoRejected', { count: rejected })
        : i18n.t('gm.undoDone');
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
        state.ui.message = engineReasonFromText(i18n.t, result.reason) ?? i18n.t('common.msg.abilityFailed');
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
    // TARGET_REQUIRED no es "injugable": la carta se selecciona primero y
    // el objetivo se elige después en el campo (isValidEnemyTarget valida
    // el enemigo concreto al confirmar). Sin este escape, toda pericia de
    // daño directo quedaba bloqueada en la mano y era injugable desde la UI.
    const ok = evalResult.legal ||
      (evalResult.reasonCode === 'TARGET_REQUIRED' && gameState.battlefield.length > 0);
    return { ok, reason: evalResult.reason, reasonCode: evalResult.reasonCode, costs: evalResult.costs };
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
    return { ok: evalResult.legal, reason: evalResult.reason, reasonCode: evalResult.reasonCode, costs: evalResult.costs };
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
        state.ui.message = i18n.t('common.msg.choiceRejected', { reason: engineReasonFromText(i18n.t, result.reason) ?? i18n.t('common.msg.reasonUnknown') });
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
        state.ui.message = i18n.t('common.msg.bidRejected', { reason: engineReasonFromText(i18n.t, result.reason) ?? i18n.t('common.msg.reasonUnknown') });
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

  acceptTurnStartEffect: (accepted: boolean) => {
    const { gameState, rng, registry, catalog, connectionMode, viewerId } = get();
    if (!gameState || !rng || !registry) return;

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'ACCEPT_TURN_START_EFFECT', accepted });
      return;
    }

    const actorId = viewerId ?? gameState.activePlayerId;
    const cmd: Command = { type: 'ACCEPT_TURN_START_EFFECT', cid: newCid('cmd'), actorId, accepted };
    const result = execute(gameState, cmd, rng, registry, catalog ?? undefined, actorId);
    if (!result.accepted) {
      set((state) => {
        state.ui.message = i18n.t('common.msg.choiceRejected', { reason: engineReasonFromText(i18n.t, result.reason) ?? i18n.t('common.msg.reasonUnknown') });
      });
      return;
    }
    const finalState = catalog
      ? processPhases(result.newState, rng, catalog).state
      : result.newState;
    set((state) => {
      state.gameState = finalState;
      state.initialCommands.push(cmd);
    });
  },

  toggleSwapMode: () => {
    set((state) => {
      state.ui.swapSelection = state.ui.swapSelection === null ? [] : null;
      state.ui.selectedCardInstanceId = null;
      state.ui.selectedEnemyInstanceId = null;
    });
  },

  toggleSwapCard: (cardInstanceId: string) => {
    set((state) => {
      const sel = state.ui.swapSelection;
      if (sel === null) return;
      if (sel.includes(cardInstanceId)) {
        state.ui.swapSelection = sel.filter((id) => id !== cardInstanceId);
      } else if (sel.length < 2) {
        // spec §4.1: máximo 2 cartas
        state.ui.swapSelection = [...sel, cardInstanceId];
      }
    });
  },

  swapStartingCards: (cardInstanceIds: string[]) => {
    const { gameState, rng, registry, catalog, connectionMode, viewerId } = get();
    if (!gameState || !rng || !registry || cardInstanceIds.length === 0) return;

    set((state) => { state.ui.swapSelection = null; });

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'SWAP_STARTING_CARDS', cardInstanceIds });
      return;
    }

    const actorId = viewerId ?? gameState.activePlayerId;
    const cmd: Command = { type: 'SWAP_STARTING_CARDS', cid: newCid('cmd'), actorId, cardInstanceIds };
    const result = execute(gameState, cmd, rng, registry, catalog ?? undefined, actorId);
    if (!result.accepted) {
      set((state) => {
        state.ui.message = i18n.t('common.msg.choiceRejected', { reason: engineReasonFromText(i18n.t, result.reason) ?? i18n.t('common.msg.reasonUnknown') });
      });
      return;
    }
    const finalState = catalog
      ? processPhases(result.newState, rng, catalog).state
      : result.newState;
    set((state) => {
      state.gameState = finalState;
      state.initialCommands.push(cmd);
    });
  },

  openSupportDeck: (supportDeckIndex: number) => {
    const { gameState, rng, registry, catalog, connectionMode, viewerId } = get();
    if (!gameState || !rng || !registry) return;

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'OPEN_SUPPORT_DECK', supportDeckIndex });
      return;
    }

    const actorId = viewerId ?? gameState.activePlayerId;
    const cmd: Command = { type: 'OPEN_SUPPORT_DECK', cid: newCid('cmd'), actorId, supportDeckIndex };
    const result = execute(gameState, cmd, rng, registry, catalog ?? undefined, actorId);
    if (!result.accepted) {
      set((state) => {
        state.ui.message = i18n.t('common.msg.choiceRejected', { reason: engineReasonFromText(i18n.t, result.reason) ?? i18n.t('common.msg.reasonUnknown') });
      });
      return;
    }
    const finalState = catalog
      ? processPhases(result.newState, rng, catalog).state
      : result.newState;
    set((state) => {
      state.gameState = finalState;
      state.initialCommands.push(cmd);
    });
  },

  buySupportCard: (supportDeckIndex: number, paymentType: 'GLORY' | 'COINS') => {
    const { gameState, rng, registry, catalog, connectionMode, viewerId } = get();
    if (!gameState || !rng || !registry) return;

    const actorId = viewerId ?? gameState.activePlayerId;
    // Desestructuración por clave computada: equivalente a players[actorId]
    // sin el acceso dinámico que security/detect-object-injection marca.
    const { [actorId]: player } = gameState.players;
    // Pago exacto declarado (el motor exige amount === coste)
    const drawn = player?.supportCardsDrawnThisTurn ?? 0;
    const payment = paymentType === 'GLORY'
      ? { type: 'GLORY' as const, amount: 2 + drawn }
      : { type: 'COINS' as const, amount: 5 + drawn * 2 };

    if (connectionMode === 'online') {
      get().sendOnlineCommand({ type: 'BUY_SUPPORT_CARD', supportDeckIndex, payment });
      return;
    }

    const cmd: Command = { type: 'BUY_SUPPORT_CARD', cid: newCid('cmd'), actorId, supportDeckIndex, payment };
    const result = execute(gameState, cmd, rng, registry, catalog ?? undefined, actorId);
    if (!result.accepted) {
      set((state) => {
        state.ui.message = i18n.t('common.msg.choiceRejected', { reason: engineReasonFromText(i18n.t, result.reason) ?? i18n.t('common.msg.reasonUnknown') });
      });
      return;
    }
    const finalState = catalog
      ? processPhases(result.newState, rng, catalog).state
      : result.newState;
    set((state) => {
      state.gameState = finalState;
      state.initialCommands.push(cmd);
    });
  },
});
