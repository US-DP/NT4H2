/**
 * Harness compartido de los tests de API del runner: boot del servidor en
 * puerto efímero, helpers HTTP, siembra de estados artesanales vía
 * /restore y builders de estado deterministas. Lo usan server-cards.test.ts
 * (cobertura por carta) y server-effects.test.ts (cobertura por efecto +
 * replay) — una sola fuente evita que los dos harness diverjan.
 */

process.env.ENGINE_RUNNER_DEV_OPEN = '1';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import {
  setupGame, startFirstTurn, DeterministicRng,
  resetInstanceCounter, resetPhaseSeq, resetResolveSeq,
  resetAbilitySeq, resetScenarioSeq,
} from '@nt4h/engine';
import { loadCatalog } from '@nt4h/catalog';
import type { CardDefinition, CardInstance, EnemyState, GameState } from '@nt4h/schema';

export const catalog = loadCatalog();

export async function bootServer(): Promise<{ server: Server; base: string }> {
  const { app } = await import('./server.js');
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

/** Helpers HTTP ligados a la base del servidor de test. */
export function makeHttp(base: string) {
  const postJson = async (path: string, body: unknown): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };

  const getJson = async (path: string): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${base}${path}`);
    return { status: res.status, json: await res.json() };
  };

  const del = async (roomId: string) =>
    fetch(`${base}/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});

  let cidSeq = 0;
  const send = (roomId: string, playerId: string, command: Record<string, unknown>) => {
    const cid = `svrfx-${++cidSeq}`;
    return postJson(`/rooms/${roomId}/command`, {
      cid, playerId, command: { ...command, cid },
    });
  };

  /** Siembra un estado artesanal en una sala vía /restore. */
  const restore = async (roomId: string, state: GameState, rng: DeterministicRng) => {
    const r = await postJson(`/rooms/${roomId}/restore`, {
      snapshot: {
        state,
        rngState: rng.serialize(),
        cids: [], revision: 0, seq: 5000, lastClientSeq: {}, savedAt: Date.now(),
      },
    });
    assert.equal(r.status, 200, `restore ${roomId}: ${JSON.stringify(r.json)}`);
  };

  const fullState = async (roomId: string): Promise<GameState> => {
    const r = await getJson(`/rooms/${roomId}/full-state`);
    assert.equal(r.status, 200);
    return r.json.state as GameState;
  };

  /** Vista proyectada tal como la vería `playerId` (o espectador si null). */
  const projected = async (roomId: string, playerId: string | null): Promise<GameState> => {
    const q = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
    const r = await getJson(`/rooms/${roomId}/state${q}`);
    assert.equal(r.status, 200);
    return r.json.state as GameState;
  };

  /**
   * Resuelve todas las pendingChoices por API: CONFIRM → 'yes' (opt-in
   * ejercitado), REACTION_WINDOW → 'USE_ABILITY', SELECT_* → primeras
   * opciones; turn-start-* va por ACCEPT_TURN_START_EFFECT. Acumula todos
   * los eventos devueltos por /command.
   */
  const drainChoices = async (roomId: string, acc: any[]): Promise<boolean> => {
    let saw = false;
    for (let i = 0; i < 30; i++) {
      const st = await fullState(roomId);
      const pc = st.pendingChoices?.[0] as any;
      if (!pc) return saw;
      saw = true;
      if (String(pc.choiceId).startsWith('turn-start-')) {
        const r = await send(roomId, pc.playerId, { type: 'ACCEPT_TURN_START_EFFECT', accepted: true });
        acc.push(...(r.json.events ?? []));
        continue;
      }
      let selectedIds: string[];
      if (pc.type === 'REACTION_WINDOW') selectedIds = ['USE_ABILITY'];
      else if (pc.type === 'CONFIRM') {
        // 'yes' cuando hay opt-in sí/no; si no, primera opción válida
        // ('glory'/'coins' en ulthar-pay, instanceId en ulthar-trophy…)
        selectedIds = (pc.options ?? []).includes('yes')
          ? ['yes']
          : (pc.options ?? []).slice(0, Math.max(1, pc.minSelections ?? 1));
      } else {
        const min = Math.max(1, pc.minSelections ?? 1);
        selectedIds = (pc.options ?? []).slice(0, min);
      }
      const r = await send(roomId, pc.playerId, { type: 'RESOLVE_CHOICE', choiceId: pc.choiceId, selectedIds });
      acc.push(...(r.json.events ?? []));
    }
    return saw;
  };

  return { postJson, getJson, del, send, restore, fullState, projected, drainChoices };
}
export type Http = ReturnType<typeof makeHttp>;

export const roomIdFor = (defId: string, suffix = '', prefix = 'card') =>
  `${prefix}-${defId.replace(/\./g, '-')}${suffix}`;

// ---------------------------------------------------------------------------
// Harness de estado (misma partida rica que el E2E: cualquier efecto tiene
// recursos suficientes para disparar — héroe+baraja según la clase de carta)
// ---------------------------------------------------------------------------

export type HeroClass = 'explorer' | 'warrior' | 'mage' | 'rogue';
// Mapeo auditado contra los PNG: verde=Explorador (Beleth-Il/Idril),
// azul=Guerrero (Lisavette/Valèrys), morado=Mago (Aranel/Taheral),
// rojo=Pícaro (Feldon/Neddia).
export const CLASS_SETUP: Record<HeroClass, { heroId: string; heroFace: 'MALE' | 'FEMALE'; deckId: string }> = {
  explorer: { heroId: 'hero.beleth-il', heroFace: 'MALE', deckId: 'explorer.default' },
  warrior: { heroId: 'hero.lisavette', heroFace: 'FEMALE', deckId: 'warrior.default' },
  mage: { heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'mage.default' },
  rogue: { heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'rogue.default' },
};

export function classFor(def: CardDefinition): HeroClass {
  if (def.type === 'ABILITY') return def.id.split('.')[0] as HeroClass;
  if (def.type === 'HERO') return ((def.heroClass ?? 'WARRIOR').toLowerCase() as HeroClass);
  if (def.type === 'MARKET') return 'explorer';
  return 'warrior';
}

let instSeq = 0;
export function resetInstSeq() { instSeq = 0; }
export function inst(definitionId: string, ownerId: string, zone: CardInstance['zone'], name?: string): CardInstance {
  instSeq += 1;
  return { instanceId: `svr-${instSeq}`, definitionId, ownerId, zone, name } as CardInstance;
}

export function enemyFromDef(defId: string, instanceId: string): EnemyState {
  const def = catalog.byId.get(defId)!;
  return {
    instanceId, definitionId: def.id, baseFortitude: def.printedFortitude ?? 1,
    wounds: 0, reward: def.reward ?? null, trophyGlory: def.trophyGlory ?? 0, modifiers: [],
    isWarlord: def.type === 'WARLORD', isOrc: def.isOrc ?? false,
    specialIcons: def.specialIcons ?? [], damageDisabled: false,
  } as EnemyState;
}

export function moveFromDeck(state: GameState, playerId: string, defId: string): CardInstance {
  const p = (state.players as Record<string, any>)[playerId];
  const inHand = p.hand.find((c: CardInstance) => c.definitionId === defId);
  if (inHand) return inHand;
  const idx = p.abilityDeck.findIndex((c: CardInstance) => c.definitionId === defId);
  const card = idx >= 0
    ? p.abilityDeck.splice(idx, 1)[0]
    : inst(defId, playerId, 'HAND', catalog.byId.get(defId)?.name);
  card.zone = 'HAND';
  p.hand = [...p.hand, card];
  return card;
}

export function* walkEffects(effects: readonly unknown[] | undefined): Generator<any> {
  for (const e of (effects ?? []) as any[]) {
    if (!e || typeof e !== 'object') continue;
    yield e;
    yield* walkEffects(e.then);
    yield* walkEffects(e.else);
    yield* walkEffects(e.effects);
    yield* walkEffects(e.onMatch ?? e.on_match);
    yield* walkEffects(e.onMismatch ?? e.on_mismatch);
    yield* walkEffects(e.onFailure);
    if (Array.isArray(e.options)) {
      for (const o of e.options) yield* walkEffects(o?.effects);
    }
  }
}

export function buildStateFor(cardDef: CardDefinition): { state: GameState; rng: DeterministicRng } {
  resetInstanceCounter(); resetPhaseSeq(); resetResolveSeq(); resetAbilitySeq(); resetScenarioSeq();
  const seed = `svr-fx-${cardDef.id}`;
  const rng = new DeterministicRng(seed);
  const cls = classFor(cardDef);
  const hero1 = CLASS_SETUP[cls];
  const setup = setupGame({
    mode: 'STANDARD', playerCount: 2, seed,
    heroes: [
      { playerId: 'p1', heroId: hero1.heroId, heroFace: hero1.heroFace, deckId: hero1.deckId },
      { playerId: 'p2', heroId: 'hero.valerys', heroFace: 'MALE', deckId: 'warrior.default' },
    ],
    useScenarios: false,
  } as any, catalog);
  const state = startFirstTurn(setup.state, rng, catalog).state;
  state.pendingChoices = [];
  state.eventLog = [];

  const wearDefs = (catalog.byClass.get(cls.toUpperCase() as any) ?? []).slice(0, 3);
  state.players.p1 = {
    ...state.players.p1,
    coins: 10, glory: 2, wounds: 1,
    wearPile: wearDefs.map(d => inst(d.id, 'p1', 'WEAR_PILE', d.name)),
    persistentCards: [],
  };
  state.players.p2 = {
    ...state.players.p2,
    coins: 5, glory: 0,
    wearPile: [inst('warrior.sword-strike', 'p2', 'WEAR_PILE', 'Espadazo')],
  };

  const caps = new Set(state.players.p1.capabilities as string[]);
  for (const c of cardDef.requiredCapabilities ?? []) caps.add(c);
  for (const p of cardDef.penaltyCapabilities ?? []) caps.add(p.icon);
  for (const eff of walkEffects(cardDef.effects)) {
    if (eff.type === 'CONDITIONAL' && eff.condition?.kind === 'HAS_CAPABILITY') caps.add(eff.condition.icon);
  }
  state.players.p1 = { ...state.players.p1, capabilities: [...caps] as any };

  state.battlefield = [
    enemyFromDef('horde.001', 'svr-orc-weak'),
    enemyFromDef('horde.006', 'svr-orc-mid'),
    enemyFromDef('warlord.gurdrug', 'svr-warlord'),
  ];
  state.phase = 'PLAYER_ATTACK';
  state.activePlayerId = 'p1';
  return { state, rng };
}
