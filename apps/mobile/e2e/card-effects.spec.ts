/**
 * Nivel 16c: E2E por carta — verificación de efectos desde la interfaz.
 *
 * A diferencia de `packages/engine/tests/cards/effect-verification.test.ts`
 * (que ejerce el motor directamente), estos tests juegan CADA carta
 * jugable (ABILITY + MARKET) a través de la UI real del navegador:
 *
 *   1. Se fabrica una partida guardada con el engine real (setupGame +
 *      estado enriquecido: enemigos en campo, monedas, heridas, desgaste)
 *      y la carta bajo test ya en la mano de p1.
 *   2. El save se inyecta en localStorage['nt4h-saved-games'] y se carga
 *      por la vía real («Continuar» → loadGame → mesa).
 *   3. La carta se juega con clicks reales (selección → enemigo →
 *      «Jugar carta») y las pendingChoices se resuelven interactuando con
 *      el diálogo, incluido el flujo pass-device para elecciones de p2.
 *   4. El historial en modo técnico muestra `• TIPO_EVENTO · seq N` —
 *      ahí se aserta la evidencia de cada efecto declarado.
 *
 * Las cartas MARKET verifican además la compra real (coste + carta a mano).
 * Solo proyecto chromium: el panel de historial técnico es desktop.
 */

import { test as base, expect, type Page, type Locator } from '@playwright/test';
import {
  setupGame, startFirstTurn, createReplay, DeterministicRng,
  resetInstanceCounter, resetPhaseSeq, resetResolveSeq,
  resetAbilitySeq, resetScenarioSeq, applyScenarioEffects, onTurnStart,
} from '@nt4h/engine';
import { loadCatalog, getCardImages } from '@nt4h/catalog';
import type { CardDefinition, CardInstance, EnemyState, GameState } from '@nt4h/schema';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const catalog = loadCatalog();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Guardián de sesión (auto-fixture): durante TODO el test vigila que
 *  - ningún PNG de carta devuelve 404 (una carta rota se vería vacía en la
 *    mesa sin que el historial lo delate)
 *  - no hay errores JS sin capturar (pageerror)
 * Un efecto puede disparar con un rendering roto debajo — esto lo detecta.
 */
const test = base.extend<{ _watch: void }>({
  _watch: [async ({ page }, use) => {
    const brokenAssets: string[] = [];
    const pageErrors: string[] = [];
    page.on('response', r => {
      if (r.status() === 404 && r.url().includes('/assets/cards/')) brokenAssets.push(r.url());
    });
    // #418 = mismatch de hidratación del export estático (cosmético —
    // React rehidrata client-side; no afecta a la partida)
    page.on('pageerror', e => {
      const msg = String(e?.message ?? e);
      if (!/#418/.test(msg)) pageErrors.push(msg);
    });
    await use();
    expect(
      [...brokenAssets.map(u => `PNG 404: ${u}`), ...pageErrors.map(e => `pageerror: ${e}`)],
      'recursos rotos o errores JS durante la sesión',
    ).toEqual([]);
  }, { auto: true }],
});

// ---------------------------------------------------------------------------
// Fabricación de la partida guardada (mismo "estado rico" que el oráculo del
// engine: cualquier efecto tiene recursos suficientes para disparar)
// ---------------------------------------------------------------------------

let instSeq = 0;
function inst(definitionId: string, ownerId: string, zone: CardInstance['zone'], name?: string): CardInstance {
  instSeq += 1;
  return { instanceId: `e2e-${instSeq}`, definitionId, ownerId, zone, name } as CardInstance;
}

/**
 * Las cuatro barajas de héroe: cada clase usa su pareja héroe+mazo real.
 * Las cartas se mueven del mazo construido a la mano (moveFromDeck) — la
 * instancia es un miembro genuino de la baraja, no una inyección fantasma.
 */
type HeroClass = 'explorer' | 'warrior' | 'mage' | 'rogue';
// Mapeo auditado contra los PNG: banner verde=Explorador (Beleth-Il/Idril),
// azul=Guerrero (Lisavette/Valèrys), morado=Mago (Aranel/Taheral),
// rojo=Pícaro (Feldon/Neddia).
const CLASS_SETUP: Record<HeroClass, { heroId: string; heroFace: 'MALE' | 'FEMALE'; deckId: string }> = {
  explorer: { heroId: 'hero.beleth-il', heroFace: 'MALE', deckId: 'explorer.default' },
  warrior: { heroId: 'hero.lisavette', heroFace: 'FEMALE', deckId: 'warrior.default' },
  mage: { heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'mage.default' },
  rogue: { heroId: 'hero.feldon', heroFace: 'MALE', deckId: 'rogue.default' },
};

/** Clase propietaria de la carta bajo test (la baraja que la contiene). */
function classFor(def: CardDefinition): HeroClass {
  if (def.type === 'ABILITY') return def.id.split('.')[0] as HeroClass;
  if (def.type === 'HERO') return ((def.heroClass ?? 'WARRIOR').toLowerCase() as HeroClass);
  if (def.type === 'MARKET') return 'explorer'; // el mercado lo compra cualquiera
  return 'warrior'; // enemigos/escenarios: la carta de ataque es de guerrero
}

/**
 * Mueve una instancia REAL de la def del mazo de habilidad del jugador a su
 * mano (equivale a haberla robado). Fallback a instancia fabricada si la
 * baraja no la contiene — no debería ocurrir con la clase correcta.
 */
function moveFromDeck(state: GameState, playerId: string, defId: string): CardInstance {
  const p = (state.players as Record<string, any>)[playerId];
  const inHand = p.hand.find((c: CardInstance) => c.definitionId === defId);
  if (inHand) return inHand; // ya repartida en la mano inicial
  const idx = p.abilityDeck.findIndex((c: CardInstance) => c.definitionId === defId);
  const card = idx >= 0
    ? p.abilityDeck.splice(idx, 1)[0]
    : inst(defId, playerId, 'HAND', catalog.byId.get(defId)?.name);
  card.zone = 'HAND';
  p.hand = [...p.hand, card];
  return card;
}

function enemyFromDef(defId: string, instanceId: string): EnemyState {
  const def = catalog.byId.get(defId)!;
  return {
    instanceId,
    definitionId: def.id,
    baseFortitude: def.printedFortitude ?? 1,
    wounds: 0,
    reward: def.reward ?? null,
    trophyGlory: def.trophyGlory ?? 0,
    modifiers: [],
    isWarlord: def.type === 'WARLORD',
    isOrc: def.isOrc ?? false,
    specialIcons: def.specialIcons ?? [],
    damageDisabled: false,
  } as EnemyState;
}

function buildStateFor(cardDef: CardDefinition): { state: GameState; rng: DeterministicRng; seed: string } {
  resetInstanceCounter();
  resetPhaseSeq();
  resetResolveSeq();
  resetAbilitySeq();
  resetScenarioSeq();
  const seed = `e2e-fx-${cardDef.id}`;
  const rng = new DeterministicRng(seed);
  // p1 juega con la baraja propietaria de la carta bajo test (las cuatro
  // clases rotan según la def) — el mazo contiene la carta de verdad.
  const cls = classFor(cardDef);
  const hero1 = CLASS_SETUP[cls];
  const setup = setupGame({
    mode: 'STANDARD',
    playerCount: 2,
    seed,
    heroes: [
      { playerId: 'p1', heroId: hero1.heroId, heroFace: hero1.heroFace, deckId: hero1.deckId },
      { playerId: 'p2', heroId: 'hero.valerys', heroFace: 'MALE', deckId: 'warrior.default' },
    ],
    useScenarios: false,
  } as any, catalog);
  const state = startFirstTurn(setup.state, rng, catalog).state;
  state.pendingChoices = [];
  // eventLog vacío: el historial solo debe mostrar los eventos de ESTE test
  state.eventLog = [];

  // Desgaste con cartas de la propia clase (la pila solo puede contener
  // cartas de la baraja del héroe)
  const wearDefs = (catalog.byClass.get(cls.toUpperCase() as any) ?? []).slice(0, 3);
  state.players.p1 = {
    ...state.players.p1,
    coins: 10,
    glory: 2,
    wounds: 1, // maxWounds es 2 — 1 deja margen de curación sin eliminar al héroe
    wearPile: wearDefs.map(d => inst(d.id, 'p1', 'WEAR_PILE', d.name)),
    persistentCards: [],
  };
  state.players.p2 = {
    ...state.players.p2,
    coins: 5,
    glory: 0,
    wearPile: [inst('warrior.sword-strike', 'p2', 'WEAR_PILE', 'Espadazo')],
  };

  // Capacidades requeridas por la carta (HAS_CAPABILITY, penalizaciones de
  // mercado) — concederlas para no sesgar la rama evaluada.
  const caps = new Set(state.players.p1.capabilities as string[]);
  for (const c of cardDef.requiredCapabilities ?? []) caps.add(c);
  for (const p of cardDef.penaltyCapabilities ?? []) caps.add(p.icon);
  for (const eff of walkEffects(cardDef.effects)) {
    if (eff.type === 'CONDITIONAL' && eff.condition?.kind === 'HAS_CAPABILITY') caps.add(eff.condition.icon);
  }
  state.players.p1 = { ...state.players.p1, capabilities: [...caps] as any };

  state.battlefield = [
    enemyFromDef('horde.001', 'e2e-orc-weak'),   // Hueste 1 — fortaleza 2
    enemyFromDef('horde.006', 'e2e-orc-mid'),    // Hueste 6 — fortaleza 3
    enemyFromDef('warlord.gurdrug', 'e2e-warlord'), // Gurdrug — fortaleza 8
  ];
  state.phase = 'PLAYER_ATTACK';
  state.activePlayerId = 'p1';
  return { state, rng, seed };
}

function* walkEffects(effects: readonly unknown[] | undefined): Generator<any> {
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

function makeSave(state: GameState, rng: DeterministicRng, seed: string, name: string): Record<string, unknown> {
  // Sin `config`: loadGame sintetiza una mínima desde el propio estado
  // (heroIds, modo y useScenarios correctos por construcción).
  return {
    id: `e2e-${name}`,
    name,
    savedAt: Date.now(),
    envelope: createReplay('nt4h', seed, state, [], {}, rng),
  };
}

// ---------------------------------------------------------------------------
// Objetivo de la carta — réplica de la regla E-13 (misma que getCardTargeting
// de lib/targeting.ts; no importable aquí porque arrastra expo-localization)
// ---------------------------------------------------------------------------

const SPECIAL_DAMAGE = new Set([
  'DEAL_DAMAGE_SPLIT', 'DEAL_DAMAGE_ALL_ENEMIES',
  'DEAL_DAMAGE_TO_HERO', 'DEAL_DAMAGE_TO_OTHER_HEROES',
]);

function cardNeedsEnemy(def: CardDefinition): { needs: boolean; filters: any[] } {
  const all = [...walkEffects(def.effects)];
  const special = all.some(e => SPECIAL_DAMAGE.has(e.type));
  // El selector (con o sin filtro) ya exige targetEnemyId — el filtro solo
  // restringe qué enemigos son válidos.
  const selectors = all.filter(e => e.target?.kind === 'SELECTED_ENEMY' || e.target?.kind === 'ONE_ENEMY');
  const filters = selectors.map(e => e.target.filter).filter(Boolean);
  const needs = ((def.printedAttack ?? 0) > 0 && !special) || selectors.length > 0;
  return { needs, filters };
}

function pickTargetName(state: GameState, def: CardDefinition): { instanceId: string; name: string } | null {
  const { needs, filters } = cardNeedsEnemy(def);
  if (!needs) return null;
  const all = [...walkEffects(def.effects)];
  const hasOnDefeat = all.some(e => e.type === 'ON_DEFEAT');
  const candidates = state.battlefield.filter(e =>
    filters.every(f =>
      (f.isOrc === undefined || e.isOrc === f.isOrc) &&
      (f.isWarlord === undefined || e.isWarlord === f.isWarlord) &&
      (f.minFortitude === undefined || e.baseFortitude >= f.minFortitude)));
  const sorted = [...candidates].sort((a, b) => a.baseFortitude - b.baseFortitude);
  const pick = hasOnDefeat ? sorted[0] : (sorted[sorted.length - 1] ?? sorted[0]);
  if (!pick) return null;
  const name = catalog.byId.get(pick.definitionId)?.name ?? pick.definitionId;
  return { instanceId: pick.instanceId, name };
}

// ---------------------------------------------------------------------------
// Oráculo E2E: cada efecto declarado debe producir evidencia visible en el
// historial técnico (tipo de evento) o como diálogo de elección resuelto.
// ---------------------------------------------------------------------------

interface Expect {
  /** Tipos de evento aceptables (al menos uno debe aparecer) */
  events?: string[];
  /** Un diálogo de pendingChoice visto también vale como evidencia */
  prompt?: boolean;
  /** CARD_MOVED adicional a la propia jugada (robo/recuperación) */
  extraMove?: boolean;
}

const EFFECT_EVIDENCE: Record<string, Expect> = {
  GAIN_COINS: { events: ['COINS_GAINED', 'COINS_STOLEN'] },
  // Valérys no es carta; para cartas la gloria es inmediata
  GAIN_GLORY: { events: ['GLORY_GAINED'] },
  DRAW_CARDS: { events: ['CARDS_DRAWN'], extraMove: true },
  LOSE_CARDS: { events: ['CARDS_LOST'], extraMove: true },
  HEAL_WOUNDS: { events: ['WOUND_HEALED'] },
  PREVENT_DAMAGE: { events: ['PREVENTION_APPLIED'] },
  PREVENT_ENEMY_DAMAGE: { events: ['ENEMY_DAMAGE_DISABLED'] },
  DISABLE_ENEMY_DAMAGE: { events: ['ENEMY_DAMAGE_DISABLED'] },
  CANCEL_ALL_DAMAGE: { events: ['CANCELLATION_ACTIVATED'] },
  APPLY_VULNERABILITY: { events: ['VULNERABILITY_APPLIED'] },
  DEFEAT_ENEMY: { events: ['ENEMY_DEFEATED'] },
  SWAP_ENEMY: { events: ['ENEMY_SWAPPED'] },
  STEAL_COINS: { events: ['COINS_STOLEN', 'COINS_GAINED'] },
  END_ATTACK: { events: ['PHASE_CHANGED'] },
  COST: { events: ['COINS_LOST', 'GLORY_LOST'] },
  PLACE_PERSISTENT: { events: ['PERSISTENT_CARD_PLACED'] },
  MODIFY_DAMAGE: { events: ['MODIFIER_ADDED'] },
  SHUFFLE_DECK: { events: ['DECK_SHUFFLED'] },
  RECOVER_CARDS: { events: ['CARDS_RECOVERED'], extraMove: true },
  ALL_HEROES_RECOVER: { events: ['CARDS_RECOVERED'], extraMove: true },
  OTHER_HEROES_RECOVER: { events: ['CARDS_RECOVERED'], extraMove: true },
  RECOVER_THIS_CARD: { events: ['CARDS_RECOVERED'], extraMove: true },
  RECOVER_CARD_BY_NAME: { events: ['CARDS_RECOVERED'], extraMove: true, prompt: true },
  SEARCH_WEAR_PILE_PUT_IN_HAND: { extraMove: true, prompt: true },
  SEARCH_DECK: { extraMove: true, prompt: true },
  DEAL_DAMAGE_SPLIT: { events: ['DAMAGE_DEALT', 'ENEMY_DEFEATED'] },
  DEAL_DAMAGE_ALL_ENEMIES: { events: ['DAMAGE_DEALT', 'ENEMY_DEFEATED'] },
  DEAL_DAMAGE_TO_HERO: { events: ['HERO_WOUNDED', 'CARDS_LOST'], prompt: true },
  DEAL_DAMAGE_TO_OTHER_HEROES: { events: ['HERO_WOUNDED', 'CARDS_LOST'] },
  DRAW_AND_CHECK: { events: ['CARDS_DRAWN'], extraMove: true },
  DRAW_AND_ADD_ATTACK: { events: ['CARDS_DRAWN', 'DAMAGE_DEALT'], extraMove: true },
  PLAY_IMMEDIATELY: { events: ['CARD_PLAYED'] }, // 2º CARD_PLAYED — se verifica por conteo
  DISCARD_FROM_HAND: { events: ['CARDS_LOST'], extraMove: true, prompt: true },
  CHOOSE_ONE: { prompt: true },
  SELECT_HERO: { prompt: true },
  INTERCEPT_DAMAGE: { events: ['DAMAGE_INTERCEPTED'], prompt: true },
  LOOK_AT_CARDS: { events: ['CARDS_REVEALED_TO_PLAYER'], prompt: true },
  BLOCK_NEXT_DAMAGE: { events: ['BLOCK_GRANTED'] },
  GRANT_ARMOR: { events: ['ARMOR_GRANTED'] },
  APPLY_STATUS: { events: ['STATUS_APPLIED'] },
  REGISTER_LISTENER: { events: ['LISTENER_REGISTERED'] },
};

const DEFERRED = new Set(['ON_DEFEAT', 'ON_ENEMY_DEFEATED', 'ON_HORDE_ATTACK', 'TRIGGER', 'CUSTOM_SCENARIO']);

function evalBranch(cond: any): 'then' | 'else' | 'unknown' {
  if (!cond) return 'then';
  switch (cond.kind) {
    case 'FIRST_CARD_OF_NAME_THIS_TURN': return 'then'; // estado fresco: primera del turno
    case 'ALREADY_USED_AGAINST_THIS_ENEMY': return 'else'; // nunca usada contra el objetivo
    case 'HAS_CAPABILITY': return 'then'; // la concedemos en buildStateFor
    default: return 'unknown';
  }
}

/** Recolecta las expectativas de cada efecto de la carta (con ramas evaluadas). */
function expectedEvidence(def: CardDefinition): Expect[] {
  const out: Expect[] = [];
  const walk = (effs: any[]) => {
    for (const eff of effs ?? []) {
      const type: string = eff.type;
      if (type === 'CONDITIONAL') {
        const branch = evalBranch(eff.condition);
        if (branch === 'unknown') { walk(eff.then); walk(eff.else); }
        else walk(branch === 'then' ? eff.then : eff.else);
        continue;
      }
      if (type === 'ON_DEFEAT' || type === 'ON_ENEMY_DEFEATED' || type === 'ON_HORDE_ATTACK' || type === 'TRIGGER') {
        // El objetivo muere (elegimos el más débil) → los internos deben verse
        walk(eff.effects);
        continue;
      }
      if (DEFERRED.has(type)) continue;
      const evidence = EFFECT_EVIDENCE[type];
      if (evidence) out.push(evidence);
      if (type === 'CHOOSE_ONE') {
        // Auto-pick de la primera opción: sus efectos internos también cuentan
        for (const o of eff.options ?? []) walk(o?.effects);
      }
    }
  };
  walk(def.effects as any[]);
  return out;
}

/**
 * Dirección esperada de los contadores visibles (● monedas, ★ gloria) tras
 * jugar la carta. Solo se devuelve cuando el resultado es unívoco: un solo
 * sentido para ese recurso, sin contenedores ambiguos (CHOOSE_ONE elige una
 * opción, PLAY_IMMEDIATELY juega otra carta, DEFEAT_ENEMY/ON_DEFEAT otorga la
 * recompensa del objetivo) que puedan compensar el delta.
 */
function economyExpectation(def: CardDefinition): { coins?: 1 | -1; glory?: 1 | -1 } {
  let coinGain = false, coinLoss = false, gloryGain = false, gloryLoss = false;
  let ambiguous = false;
  const walk = (effs: any[]) => {
    for (const eff of effs ?? []) {
      const t: string = eff.type;
      if (t === 'CONDITIONAL') {
        const b = evalBranch(eff.condition);
        if (b === 'unknown') ambiguous = true;
        if (b !== 'else') walk(eff.then);
        if (b !== 'then') walk(eff.else);
        continue;
      }
      if (t === 'CHOOSE_ONE' || t === 'PLAY_IMMEDIATELY'
        || t === 'PLAY_RANDOM_CARD_FROM_OTHER_HERO'
        || t === 'DEFEAT_ENEMY' || t === 'ON_DEFEAT') {
        ambiguous = true;
        continue;
      }
      if (t === 'GAIN_COINS' || t === 'STEAL_COINS') coinGain = true;
      if (t === 'COST' && eff.resource !== 'GLORY') coinLoss = true;
      if (t === 'GAIN_GLORY') gloryGain = true;
      if (t === 'COST' && eff.resource === 'GLORY') gloryLoss = true;
      for (const sub of ['effects', 'then', 'else', 'onMatch', 'onMismatch', 'onFailure']) walk(eff[sub]);
    }
  };
  walk(def.effects as any[]);
  const eco: { coins?: 1 | -1; glory?: 1 | -1 } = {};
  if (!ambiguous) {
    if (coinGain && !coinLoss) eco.coins = 1;
    if (coinLoss && !coinGain) eco.coins = -1;
    if (gloryGain && !gloryLoss) eco.glory = 1;
    if (gloryLoss && !gloryGain) eco.glory = -1;
  }
  return eco;
}

// ---------------------------------------------------------------------------
// Drivers de UI
// ---------------------------------------------------------------------------

/** Inyecta el save y lo carga desde la portada («Cargar partida <name>»). */
async function loadSavedGame(page: Page, save: Record<string, unknown>) {
  const name = String(save.name);
  await page.addInitScript((json) => localStorage.setItem('nt4h-saved-games', json), JSON.stringify([save]));
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(esc(name)) }).first().click();
  await expect(page.getByText(/Campo de Batalla/i).first()).toBeVisible({ timeout: 20000 });
  // Hot-seat puede pedir relevo de dispositivo tras la carga
  const ready = page.getByRole('button', { name: /Estoy listo/i });
  if (await ready.count().catch(() => 0)) await ready.first().click().catch(() => {});
  else {
    const readyText = page.getByText(/^Estoy listo$/i);
    if (await readyText.count().catch(() => 0)) await readyText.first().click().catch(() => {});
  }
}

/** Click en la carta de la MANO (la ocurrencia más baja de la pantalla). */
async function clickHandCard(page: Page, name: string) {
  const matches = page.getByRole('button', { name: new RegExp(`^${esc(name)}`) });
  const n = await matches.count();
  let best: Locator | null = null;
  let bestY = -1;
  for (let i = 0; i < n; i++) {
    const box = await matches.nth(i).boundingBox().catch(() => null);
    if (box && box.y > bestY) { bestY = box.y; best = matches.nth(i); }
  }
  expect(best, `la carta ${name} no aparece como botón en la mano`).not.toBeNull();
  await best!.click();
}

/**
 * Resuelve diálogos de pendingChoice interactuando con la UI hasta que no
 * quede ninguno. Devuelve true si apareció al menos un diálogo.
 *
 * La selección se lee del contador «Confirmar (n/m)» del propio botón —
 * rastrear clicks no funciona porque el texto del diálogo cambia al
 * seleccionar y un rastreo por contenido re-clicaría la misma opción,
 * deseleccionándola en bucle.
 */
/**
 * El diálogo de pendingChoice es el último `[role="alert"]` VISIBLE que
 * contiene botones — la mesa renderiza otros alerts decorativos sin botones
 * (avisos de desgaste, "reconstruir costará 1 herida") que descartaríamos
 * con un `.last()` a ciegas.
 */
async function choiceDialog(page: Page): Promise<Locator | null> {
  const alerts = page.locator('[role="alert"]');
  const count = await alerts.count();
  for (let k = count - 1; k >= 0; k--) {
    const candidate = alerts.nth(k);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if ((await candidate.getByRole('button').count()) > 0) return candidate;
  }
  return null;
}

async function drainChoiceDialogs(page: Page): Promise<boolean> {
  let saw = false;
  for (let i = 0; i < 25; i++) {
    let box = await choiceDialog(page);
    if (!box) {
      // Pantalla de privacidad hot-seat (relevo a otro jugador): no es un
      // role=alert — el botón «Estoy listo» vive fuera del diálogo
      const ready = page.getByRole('button', { name: /Estoy listo/i });
      const readyText = page.getByText(/^Estoy listo$/i);
      if (await ready.count().catch(() => 0)) {
        await ready.first().click().catch(() => {});
        saw = true;
        continue;
      }
      if (await readyText.count().catch(() => 0)) {
        await readyText.first().click().catch(() => {});
        saw = true;
        continue;
      }
      // Pausa breve: elecciones encadenadas tardan un render en aparecer
      await page.waitForTimeout(400);
      box = await choiceDialog(page);
      if (!box) break;
    }
    saw = true;

    // RNW a veces deja overlays que interceptan el puntero sobre los
    // botones del diálogo (p.ej. la ventana de reacción queda cubierta por
    // el panel de desglose durante HORDE_ATTACK): si el click real no
    // puede aterrizar, despachamos el evento DOM — React lo recoge por
    // delegación y ejercita el mismo handler onPress.
    const clickOption = async (opt: Locator) => {
      await opt.click({ timeout: 3000 }).catch(() => opt.dispatchEvent('click'));
    };

    // Relevo de dispositivo (elección de otro jugador / privacidad hot-seat)
    const pass = box.getByRole('button', { name: /Pasa el dispositivo|Estoy listo|Continuar partida/i });
    if (await pass.count()) { await clickOption(pass.first()); continue; }

    const confirm = box.getByRole('button', { name: /Confirmar selección/i });
    const buttons = box.getByRole('button');
    const n = await buttons.count();
    const options: Locator[] = [];
    for (let b = 0; b < n; b++) {
      const label = (await buttons.nth(b).getAttribute('aria-label')) ?? '';
      if (!/Confirmar selección/i.test(label)) options.push(buttons.nth(b));
    }
    // El contador «Confirmar (n/m)» es el oráculo de selección — más fiable
    // que los atributos aria de RNW, que no siempre se emiten como se espera
    const readSelected = async (): Promise<number | null> => {
      const t = await confirm.first().innerText().catch(() => '');
      const m = /(\d+)\s*\/\s*(\d+)/.exec(t);
      return m ? +m[1] : null;
    };

    if (await confirm.count()) {
      const confirmDisabled = await confirm.first().isDisabled().catch(() => false);
      if (confirmDisabled) {
        // SELECT_*: faltan selecciones mínimas — clicar opciones hasta que
        // el contador suba (si un clic baja el contador, era un deselect:
        // se re-clica para dejarla marcada y se prueba otra)
        for (const opt of options) {
          const before = await readSelected();
          await clickOption(opt);
          await page.waitForTimeout(150);
          const after = await readSelected();
          if (after !== null && before !== null && after > before) break;
          if (after !== null && before !== null && after < before) {
            await clickOption(opt);
            await page.waitForTimeout(150);
          }
          if (before === null || after === null) break;
        }
        continue;
      }
      // Habilitado: si nada seleccionado y hay opciones, ejercitar una —
      // los efectos opt-in (minSelections=0) solo se ven si se elige algo
      const sel = await readSelected();
      if (options.length > 0 && sel === 0) {
        await clickOption(options[0]);
        continue;
      }
      await clickOption(confirm.first());
      continue;
    }

    // Sin «Confirmar»: REACTION_WINDOW (preferir «Usar pericia» — el paso
    // intermedio hacia USE_HERO_ABILITY; «Pasar» solo si no hay opción),
    // CONFIRM (Sí/No) o elección directa — cualquier opción resuelve ya
    const abilityBtn = box.getByRole('button', { name: /Usar pericia|Usar poder/i });
    if (await abilityBtn.count()) { await clickOption(abilityBtn.first()); continue; }
    const skipBtn = box.getByRole('button', { name: /^Pasar$/i });
    if (await skipBtn.count()) { await clickOption(skipBtn.first()); continue; }
    if (options.length > 0) { await clickOption(options[0]); continue; }
    break;
  }
  return saw;
}

/** Tipos de evento visibles en el historial técnico («• TYPE · seq N»). */
async function collectEventTypes(page: Page): Promise<string[]> {
  const toggle = page.getByRole('button', { name: /detalles técnicos/i });
  if (await toggle.count()) await toggle.first().click();
  const texts = await page.getByText(/· seq \d+/).allInnerTexts();
  return texts.map(t => (/([A-Z_]+)\s*·\s*seq/.exec(t)?.[1] ?? '')).filter(Boolean);
}

/**
 * Contadores visibles del jugador activo: «● monedas» y «★ gloria» en la
 * lista de jugadores. Las recompensas de enemigo van dentro del evento
 * ENEMY_DEFEATED (sin COINS_GAINED propio) — el contador es la evidencia
 * real en la interfaz.
 */
async function readPlayerCounters(page: Page): Promise<{ coins: number; glory: number }> {
  const coins = await page.getByText(/^●\s*\d+$/).first().innerText().catch(() => '0');
  const glory = await page.getByText(/^★\s*\d+$/).first().innerText().catch(() => '0');
  return {
    coins: +(/(\d+)/.exec(coins)?.[1] ?? 0),
    glory: +(/(\d+)/.exec(glory)?.[1] ?? 0),
  };
}

/** «🗑 Desgaste: N» — el máximo de todos los paneles (p1 es el mayor). */
async function readMaxWear(page: Page): Promise<number> {
  const texts = await page.getByText(/Desgaste:\s*\d+/).allInnerTexts();
  return Math.max(0, ...texts.map(t => +(/(\d+)/.exec(t)?.[1] ?? '0')));
}

/**
 * Heridas visibles de un enemigo del campo («Heridas: x/y» en su carta).
 * null si ya no está en el campo (derrotado → lo confirma ENEMY_DEFEATED).
 */
async function readEnemyWounds(page: Page, enemyName: string): Promise<number | null> {
  const btn = page
    .locator('[aria-label^="Campo de Batalla"]')
    .getByRole('button', { name: new RegExp(`^${esc(enemyName)}`) })
    .first();
  const text = await btn.innerText().catch(() => '');
  const m = /Heridas:\s*(\d+)\s*\/\s*\d+/.exec(text);
  return m ? +m[1] : null;
}

/** Efectos que sacan cartas del Desgaste o eluden la zona — desactivan el
 *  chequeo «Desgaste +1» (puede quedar igual o menor legítimamente). */
const WEAR_MOVERS = new Set([
  'RECOVER_CARDS', 'ALL_HEROES_RECOVER', 'OTHER_HEROES_RECOVER',
  'RECOVER_THIS_CARD', 'RECOVER_CARD_BY_NAME', 'SEARCH_WEAR_PILE_PUT_IN_HAND',
  'PLACE_PERSISTENT', 'MOVE_CARD', 'REMOVE_FROM_GAME', 'PLAY_IMMEDIATELY',
  'TRY_EFFECT', 'REPEAT', 'FOR_EACH', 'CHOOSE_ONE', 'CONDITIONAL',
  'PLAY_RANDOM_CARD_FROM_OTHER_HERO', 'LOOK_AT_CARDS', 'DRAW_AND_CHECK',
  'DRAW_AND_ADD_ATTACK', 'DRAW_FROM_BOTTOM', 'DRAW_UP_TO', 'LOSE_CARDS',
  'DISCARD_FROM_HAND', 'SEARCH_DECK', 'INTERCEPT_DAMAGE', 'ON_DEFEAT',
  'ON_ENEMY_DEFEATED', 'ON_HORDE_ATTACK', 'TRIGGER', 'REGISTER_LISTENER',
]);
// NOTA: solo aplicamos la aserción cuando NINGÚN efecto está en la lista —
// cualquier cadena que mueva/robre/descarte podría compensar el +1.

// ---------------------------------------------------------------------------
// Tests por carta
// ---------------------------------------------------------------------------

const playableDefs = catalog.cards.filter(d => d.type === 'ABILITY' || d.type === 'MARKET');

test.describe('E2E — efecto de cada carta jugable desde la interfaz', () => {
  test.describe.configure({ timeout: 60000 });
  test.beforeEach(({}, testInfo) => {
    // El historial técnico solo está en el layout de escritorio
    test.skip(testInfo.project.name !== 'chromium', 'solo proyecto chromium (panel técnico desktop)');
  });

  for (const def of playableDefs) {
    test(`${def.id} — ${def.name}`, async ({ page }) => {
      const expectations = expectedEvidence(def);
      const failures: string[] = [];

      // --- Paso 0 (mercado): compra real por la UI ---
      const isMarket = def.type === 'MARKET';
      if (isMarket) {
        const { state, rng, seed } = buildStateFor(def);
        state.phase = 'MARKET';
        const marketCard = inst(def.id, 'market', 'MARKET', def.name);
        state.market = [marketCard, ...state.market.filter(c => c.definitionId !== def.id)];
        await loadSavedGame(page, makeSave(state, rng, seed, `buy-${def.id}`));
        const handBefore = await page.getByText(/Mano \(\d+\)/).first().innerText();
        await page.getByRole('button', { name: new RegExp(`Comprar ${esc(def.name)}`) }).first().click();
        await drainChoiceDialogs(page);
        const types = await collectEventTypes(page);
        if (!types.includes('MARKET_PURCHASED')) failures.push('compra sin MARKET_PURCHASED');
        const handAfter = await page.getByText(/Mano \(\d+\)/).first().innerText();
        if (handAfter === handBefore) failures.push('la carta comprada no incrementó la mano');
      }

      // --- Jugar la carta por la UI real ---
      const { state, rng, seed } = buildStateFor(def);
      // La instancia se mueve del mazo real de la baraja propietaria a la
      // mano (como si se hubiera robado), no se fabrica de la nada
      moveFromDeck(state, 'p1', def.id);
      const target = pickTargetName(state, def);
      await loadSavedGame(page, makeSave(state, rng, seed, `play-${def.id}`));

      // Contadores visibles ANTES de jugar — el delta es la prueba de que
      // la carta salió de la mano y el daño aterrizó en el tablero
      const wearBefore = await readMaxWear(page);
      const woundsBefore = target ? await readEnemyWounds(page, target.name) : null;
      const countersBefore = await readPlayerCounters(page);

      await clickHandCard(page, def.name);

      if (target) {
        const battlefield = page.locator('[aria-label^="Campo de Batalla"]');
        const enemyBtn = battlefield.getByRole('button', { name: new RegExp(`^${esc(target.name)}`) });
        await enemyBtn.first().click();
        await page.getByRole('button', { name: /Jugar carta contra el enemigo/i }).first().click();
      } else {
        await page.getByRole('button', { name: /Jugar carta/i }).first().click();
      }

      const sawPrompt = await drainChoiceDialogs(page);
      const types = await collectEventTypes(page);
      const countOf = (t: string) => types.filter(x => x === t).length;

      // La carta debe haberse jugado (la UI la aceptó y emitió CARD_PLAYED)
      if (!types.includes('CARD_PLAYED')) failures.push('sin CARD_PLAYED — la jugada no se ejecutó');

      // La carta jugada pasa a su destinationAfterUse (CARD_MOVED
      // HAND→WEAR_PILE): el contador visible de Desgaste debe subir —
      // salvo si el destino declarado es otro (REMOVED_FROM_GAME,
      // IN_FRONT_OF_PLAYER) o sus efectos mueven cartas por la zona
      const goesToWear = (def.destinationAfterUse ?? 'WEAR_PILE') === 'WEAR_PILE';
      const wearNeutral = [...walkEffects(def.effects)].every(e => !WEAR_MOVERS.has(e.type));
      if (wearNeutral && types.includes('CARD_PLAYED')) {
        const wearAfter = await readMaxWear(page);
        if (goesToWear && wearAfter < wearBefore + 1) {
          failures.push(`Desgaste no subió tras jugar (${wearBefore}→${wearAfter})`);
        }
        // REMOVED_FROM_GAME / IN_FRONT_OF_PLAYER: la carta NO puede ir al
        // Desgaste — si subió, la jugada terminó en la zona equivocada
        if (!goesToWear && wearAfter !== wearBefore) {
          failures.push(`destino ${def.destinationAfterUse} pero Desgaste cambió (${wearBefore}→${wearAfter})`);
        }
      }

      // Economía visible: si la carta declara un único sentido para ● o ★,
      // el contador debe moverse en esa dirección (el evento técnico solo
      // dice que ocurrió; el contador prueba que se aplicó al jugador)
      const eco = economyExpectation(def);
      if (eco.coins || eco.glory) {
        const countersAfter = await readPlayerCounters(page);
        if (eco.coins === 1 && countersAfter.coins <= countersBefore.coins) {
          failures.push(`ganancia de monedas no visible: ● ${countersBefore.coins}→${countersAfter.coins}`);
        }
        if (eco.coins === -1 && countersAfter.coins >= countersBefore.coins) {
          failures.push(`coste de monedas no visible: ● ${countersBefore.coins}→${countersAfter.coins}`);
        }
        if (eco.glory === 1 && countersAfter.glory <= countersBefore.glory) {
          failures.push(`ganancia de gloria no visible: ★ ${countersBefore.glory}→${countersAfter.glory}`);
        }
        if (eco.glory === -1 && countersAfter.glory >= countersBefore.glory) {
          failures.push(`coste de gloria no visible: ★ ${countersBefore.glory}→${countersAfter.glory}`);
        }
      }

      // Daño impreso con objetivo → DAMAGE_DEALT/ENEMY_DEFEATED en el historial
      if (target && (def.printedAttack ?? 0) > 0) {
        const special = [...walkEffects(def.effects)].some(e =>
          ['DEAL_DAMAGE_SPLIT', 'DEAL_DAMAGE_ALL_ENEMIES', 'DEAL_DAMAGE_TO_HERO', 'DEAL_DAMAGE_TO_OTHER_HEROES'].includes(e.type));
        if (!special && !types.includes('DAMAGE_DEALT') && !types.includes('ENEMY_DEFEATED')) {
          failures.push(`printedAttack=${def.printedAttack} sin DAMAGE_DEALT/ENEMY_DEFEATED`);
        }
        // …y visible en la carta del enemigo: sus Heridas suben (o cae
        // derrotado y desaparece del campo → ENEMY_DEFEATED lo cubre)
        if (!special && woundsBefore !== null) {
          const woundsAfter = await readEnemyWounds(page, target.name);
          const defeated = types.includes('ENEMY_DEFEATED') && woundsAfter === null;
          if (!defeated && woundsAfter !== null && woundsAfter <= woundsBefore) {
            failures.push(`daño no visible en el enemigo: Heridas ${woundsBefore}→${woundsAfter}`);
          }
        }
      }

      for (const exp of expectations) {
        const byEvent = (exp.events ?? []).some(t => types.includes(t));
        const byExtraMove = exp.extraMove ? countOf('CARD_MOVED') >= 2 : false;
        const byPrompt = exp.prompt ? sawPrompt : false;
        const bySecondPlay = exp.events?.includes('CARD_PLAYED') ? countOf('CARD_PLAYED') >= 2 : false;
        if (!byEvent && !byExtraMove && !byPrompt && !bySecondPlay) {
          failures.push(`efecto ${JSON.stringify(exp)}: sin evidencia en la interfaz`);
        }
      }

      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Enemigos (HORDE + WARLORD): no se «juegan» — su efecto observable es la
// recompensa al derrotarlos. Cada uno se pone en el campo a 1 herida de morir
// y se remata con una carta real por la interfaz.
// ---------------------------------------------------------------------------

const enemyDefs = catalog.cards.filter(d => d.type === 'HORDE' || d.type === 'WARLORD');

test.describe('E2E — enemigos derrotados desde la interfaz', () => {
  test.describe.configure({ timeout: 60000 });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'solo proyecto chromium (panel técnico desktop)');
  });

  for (const def of enemyDefs) {
    test(`${def.id} — ${def.name}`, async ({ page }) => {
      const { state, rng, seed } = buildStateFor(def);
      const target = enemyFromDef(def.id, 'e2e-target');
      target.wounds = Math.max(0, (def.printedFortitude ?? 1) - 1);
      // Otro enemigo vivo: al derrotar un Señor la partida no debe terminar
      const extraDef = catalog.cards.find(d => d.type === 'HORDE' && d.name !== def.name)!;
      state.battlefield = [target, enemyFromDef(extraDef.id, 'e2e-extra')];
      const strike = catalog.byId.get('warrior.sword-strike')!;
      // Espadazo sale del mazo de guerrero real de p1 (clase 'warrior' por
      // classFor en defs de enemigo)
      moveFromDeck(state, 'p1', 'warrior.sword-strike');
      await loadSavedGame(page, makeSave(state, rng, seed, `foe-${def.id}`));
      const before = await readPlayerCounters(page);

      await clickHandCard(page, strike.name);
      const battlefield = page.locator('[aria-label^="Campo de Batalla"]');
      await battlefield.getByRole('button', { name: new RegExp(`^${esc(def.name)}`) }).first().click();
      await page.getByRole('button', { name: /Jugar carta contra el enemigo/i }).first().click();
      await drainChoiceDialogs(page);

      const types = await collectEventTypes(page);
      const after = await readPlayerCounters(page);
      const failures: string[] = [];
      if (!types.includes('ENEMY_DEFEATED')) failures.push('sin ENEMY_DEFEATED — la carta no lo remató');
      // La recompensa viaja dentro de ENEMY_DEFEATED.reward (no hay
      // COINS_GAINED/GLORY_GAINED separados) — la evidencia en la interfaz
      // es que los contadores del héroe suben.
      if ((def.reward?.coins ?? 0) > 0 && after.coins - before.coins < def.reward!.coins!) {
        failures.push(`recompensa de ${def.reward!.coins} monedas no reflejada (${before.coins}→${after.coins})`);
      }
      if ((def.reward?.glory ?? 0) > 0 && after.glory - before.glory < def.reward!.glory!) {
        failures.push(`recompensa de ${def.reward!.glory} gloria no reflejada (${before.glory}→${after.glory})`);
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Pericias de héroe: activas por el botón «Usar poder», reactivas por la
// ventana de reacción (REACTION_WINDOW del jugador no activo, con relevo de
// dispositivo) y pasivas por su disparador real (evasión, reducción de daño,
// cascada de Disparo Rápido).
// ---------------------------------------------------------------------------

const heroDefs = catalog.cards.filter(d => d.type === 'HERO');
const REACTIVE_HEROES = new Set(['hero.valerys', 'hero.lisavette']);

function heroSetup(def: CardDefinition) {
  const { state, rng, seed } = buildStateFor(def);
  const ability = def.heroAbility!;
  state.players.p1 = {
    ...state.players.p1,
    heroId: def.id,
    heroUsesRemaining: ability.uses ?? 1,
    heroMaxUses: ability.uses ?? 1,
  };
  return { state, rng, seed };
}

test.describe('E2E — pericias de héroe desde la interfaz', () => {
  test.describe.configure({ timeout: 60000 });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'solo proyecto chromium (panel técnico desktop)');
  });

  for (const def of heroDefs) {
    test(`${def.id} — ${def.name}`, async ({ page }) => {
      const failures: string[] = [];

      if (REACTIVE_HEROES.has(def.id)) {
        // Valèrys/Lisavette: reacción del jugador NO activo durante el
        // Ataque de la Horda — se inyecta la REACTION_WINDOW que crearía
        // el motor (buildReactionWindow) y se resuelve por la UI, con
        // relevo de dispositivo incluido.
        const { state, rng, seed } = buildStateFor(def);
        const ability = def.heroAbility!;
        state.phase = 'HORDE_ATTACK';
        state.activePlayerId = 'p1';
        state.players.p2 = {
          ...state.players.p2,
          heroId: def.id,
          heroUsesRemaining: ability.uses ?? 1,
          heroMaxUses: ability.uses ?? 1,
        };
        // Lisavette exige una carta «Escudo» en mano — la mueve del mazo
        // de guerrero real de p2
        if (def.id === 'hero.lisavette') moveFromDeck(state, 'p2', 'warrior.shield');
        state.pendingChoices = [{
          choiceId: `reaction-p2-e2e`,
          playerId: 'p2',
          type: 'REACTION_WINDOW',
          prompt: 'Reacción: ¿Usar pericia de héroe o pasar?',
          options: ['USE_ABILITY', 'PASS'],
          minSelections: 1,
          maxSelections: 1,
        } as any];
        await loadSavedGame(page, makeSave(state, rng, seed, `hero-${def.id}`));
        await drainChoiceDialogs(page);
        const types = await collectEventTypes(page);
        if (!types.includes('HERO_ABILITY_USED')) failures.push('pericia reactiva sin HERO_ABILITY_USED');
        if (def.id === 'hero.valerys' && !types.includes('DAMAGE_INTERCEPTED')) {
          failures.push('Valèrys sin DAMAGE_INTERCEPTED');
        }
        if (def.id === 'hero.lisavette' && !types.includes('ENEMY_DAMAGE_DISABLED') && !types.includes('CARD_MOVED')) {
          failures.push('Lisavette sin evidencia de Escudo/prevención');
        }
        expect(failures, failures.join('\n')).toEqual([]);
        return;
      }

      if (def.id === 'hero.taheral') {
        // Pasiva de evasión real: ATTACK_CHOICE → Evadir → descartar 2 →
        // CONFIRM «Taheral: ¿usar tu Pericia…?» → Sí → COINS_GAINED ×2/descarte
        const { state, rng, seed } = heroSetup(def);
        state.phase = 'ATTACK_CHOICE';
        await loadSavedGame(page, makeSave(state, rng, seed, `hero-${def.id}`));
        await page.getByRole('button', { name: /Evadir/i }).first().click();
        // Descartar las dos primeras cartas de la mano por la UI
        const handNames = state.players.p1.hand
          .map(c => catalog.byId.get(c.definitionId)?.name ?? c.definitionId);
        const distinct = [...new Set(handNames)].slice(0, 2);
        for (const n of distinct) await clickHandCard(page, n);
        await page.getByRole('button', { name: /Confirmar evasión/i }).first().click();
        await drainChoiceDialogs(page);
        const types = await collectEventTypes(page);
        if (!types.includes('HERO_ABILITY_USED')) failures.push('Taheral sin HERO_ABILITY_USED tras aceptar');
        if (!types.includes('COINS_GAINED')) failures.push('Taheral sin COINS_GAINED por los descartes');
        expect(failures, failures.join('\n')).toEqual([]);
        return;
      }

      if (def.id === 'hero.feldon' || def.id === 'hero.beleth-il') {
        // Pasivas opt-in que el motor ofrece como CONFIRM en su disparador:
        // Feldon al recibir daño de la Horda; Beleth-Il al fallar una carta
        // en la cascada de Disparo Rápido. Se inyecta la elección idéntica
        // a la que crea el motor y se acepta por la UI.
        const { state, rng, seed } = heroSetup(def);
        if (def.id === 'hero.feldon') {
          state.phase = 'HORDE_ATTACK';
          state.pendingChoices = [{
            choiceId: `feldon-reduce-${state.turnNumber}-p1`,
            playerId: 'p1',
            type: 'CONFIRM',
            prompt: 'Feldon: ¿usar tu Pericia para perder solo la mitad de cartas?',
            options: ['yes', 'no'],
            minSelections: 1,
            maxSelections: 1,
          } as any];
        } else {
          const failed = state.players.p1.abilityDeck[0];
          expect(failed, 'mazo de habilidad vacío para Beleth-Il').toBeTruthy();
          state.pendingChoices = [{
            choiceId: `beleth-recover-p1-e2e`,
            playerId: 'p1',
            type: 'CONFIRM',
            prompt: 'Beleth-Il: ¿usar tu Pericia para recuperar la carta fallida a la mano y robar otra?',
            options: ['yes', 'no'],
            minSelections: 1,
            maxSelections: 1,
            relatedCardIds: [failed.instanceId],
          } as any];
        }
        await loadSavedGame(page, makeSave(state, rng, seed, `hero-${def.id}`));
        await drainChoiceDialogs(page);
        const types = await collectEventTypes(page);
        if (!types.includes('HERO_ABILITY_USED')) failures.push('pericia pasiva sin HERO_ABILITY_USED tras aceptar');
        if (def.id === 'hero.beleth-il' && !types.includes('CARDS_DRAWN')) {
          failures.push('Beleth-Il sin robo extra (CARDS_DRAWN)');
        }
        expect(failures, failures.join('\n')).toEqual([]);
        return;
      }

      // Pericias activas (Aranel, Neddia, Idril…): botón «Usar poder» en
      // fase PLAYER_ATTACK + resolución de la elección que generan.
      const { state, rng, seed } = heroSetup(def);
      await loadSavedGame(page, makeSave(state, rng, seed, `hero-${def.id}`));
      const power = page.getByRole('button', { name: /Usar poder/i });
      await expect(power.first()).toBeEnabled({ timeout: 10000 });
      await power.first().click();
      const sawPrompt = await drainChoiceDialogs(page);
      const types = await collectEventTypes(page);
      if (!types.includes('HERO_ABILITY_USED')) failures.push('pericia sin HERO_ABILITY_USED');
      const effects = (def.heroAbility?.effects ?? []) as any[];
      const expectsPrompt = effects.some(e => e.type === 'SEARCH_DECK' || e.type === 'LOOK_AT_CARDS');
      if (expectsPrompt && !sawPrompt) failures.push('pericia sin diálogo de elección visible');
      if (effects.some(e => e.type === 'SHUFFLE_DECK') && !types.includes('DECK_SHUFFLED')) {
        failures.push('SHUFFLE_DECK sin DECK_SHUFFLED');
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Escenarios: se inyectan activos y se ejercita su vía real —
//   - Modificadores declarativos: applyScenarioEffects (la misma que usa el
//     motor al revelar) y evidencia visible (precio de mercado, fortaleza,
//     recompensas suprimidas).
//   - ON_ENEMY_DEFEATED: se derrota un enemigo apto por la UI.
//   - CUSTOM_SCENARIO: oferta de inicio de turno (Sí/No) o la vía propia
//     del handler (Cemenmar por evasión).
// ---------------------------------------------------------------------------

const scenarioDefs = catalog.cards.filter(d => d.type === 'SCENARIO');

/** Juega Espadazo contra el enemigo dado y devuelve eventos + delta de contadores. */
async function playStrikeOnEnemy(
  page: Page, state: GameState, rng: DeterministicRng, seed: string,
  saveName: string, enemyName: string,
): Promise<{ types: string[]; coinsDelta: number; gloryDelta: number }> {
  const strike = catalog.byId.get('warrior.sword-strike')!;
  moveFromDeck(state, 'p1', 'warrior.sword-strike');
  await loadSavedGame(page, makeSave(state, rng, seed, saveName));
  const before = await readPlayerCounters(page);
  await clickHandCard(page, strike.name);
  const battlefield = page.locator('[aria-label^="Campo de Batalla"]');
  await battlefield.getByRole('button', { name: new RegExp(`^${esc(enemyName)}`) }).first().click();
  await page.getByRole('button', { name: /Jugar carta contra el enemigo/i }).first().click();
  await drainChoiceDialogs(page);
  const types = await collectEventTypes(page);
  const after = await readPlayerCounters(page);
  return { types, coinsDelta: after.coins - before.coins, gloryDelta: after.glory - before.glory };
}

test.describe('E2E — escenarios desde la interfaz', () => {
  test.describe.configure({ timeout: 60000 });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'solo proyecto chromium (panel técnico desktop)');
  });

  const scenarioWith = (def: CardDefinition) => {
    const ctx = buildStateFor(def);
    ctx.state.scenario = inst(def.id, 'scenario', 'SCENARIO_ACTIVE', def.name) as any;
    return ctx;
  };

  for (const def of scenarioDefs) {
    test(`${def.id} — ${def.name}`, async ({ page }) => {
      const failures: string[] = [];
      const effs = (def.effects ?? []) as any[];
      const has = (t: string) => effs.some(e => e.type === t);
      const onDefeat = effs.find(e => e.type === 'ON_ENEMY_DEFEATED') as any;

      if (def.id === 'scenario.lotharion-market') {
        // -1 al coste de mercado: visible en el precio tachado/mostrado
        const { state: base, rng, seed } = scenarioWith(def);
        const state = applyScenarioEffects(base, def.id, catalog).state;
        state.phase = 'MARKET';
        const card = state.market[0];
        const printed = catalog.byId.get(card.definitionId)?.printedCost ?? 0;
        await loadSavedGame(page, makeSave(state, rng, seed, `sc-${def.id}`));
        // El precio efectivo (impreso −1) debe verse en el mercado
        await expect(
          page.getByText(`💰 ${Math.max(0, printed - 1)}`).first(),
          'el precio rebajado no se muestra en el mercado',
        ).toBeVisible({ timeout: 10000 });
        return;
      }

      if (has('IGNORE_COIN_REWARDS') || has('IGNORE_GLORY_REWARDS') || has('MODIFY_FORTITUDE')) {
        const { state: base, rng, seed } = scenarioWith(def);
        // El enemigo debe estar en el campo ANTES de applyScenarioEffects:
        // el reducer de SCENARIO_EFFECTS_APPLIED materializa el aura sobre
        // los enemigos presentes (los que entren después la reciben vía
        // applyEntryAuras).
        const modDesc = (effs.find(e => e.type === 'MODIFY_FORTITUDE') as any)?.modifier;
        const fortMod = modDesc?.kind === 'CONSTANT' ? (modDesc.value ?? 0) : 0;
        const targetDef = catalog.byId.get('horde.001')!;
        const effectiveFort = (targetDef.printedFortitude ?? 1) + fortMod;
        const enemy = enemyFromDef('horde.001', 'e2e-scen-target');
        enemy.wounds = Math.max(0, effectiveFort - 1);
        base.battlefield = [enemy, enemyFromDef('horde.002', 'e2e-extra')];
        const state = applyScenarioEffects(base, def.id, catalog).state;
        const strike = catalog.byId.get('warrior.sword-strike')!;
        moveFromDeck(state, 'p1', 'warrior.sword-strike');
        await loadSavedGame(page, makeSave(state, rng, seed, `sc-${def.id}`));
        if (has('MODIFY_FORTITUDE')) {
          // La fortaleza efectiva rebajada se muestra en el campo
          await expect(
            page.getByText(/\(base 2\)/).first(),
            'fortaleza modificada no visible (esperado «(base 2)»)',
          ).toBeVisible({ timeout: 10000 });
        }
        const before = await readPlayerCounters(page);
        await clickHandCard(page, strike.name);
        const battlefield = page.locator('[aria-label^="Campo de Batalla"]');
        await battlefield.getByRole('button', { name: /^Hueste 1/ }).first().click();
        await page.getByRole('button', { name: /Jugar carta contra el enemigo/i }).first().click();
        await drainChoiceDialogs(page);
        const types = await collectEventTypes(page);
        const after = await readPlayerCounters(page);
        if (!types.includes('ENEMY_DEFEATED')) failures.push('sin ENEMY_DEFEATED');
        // La recompensa viaja dentro de ENEMY_DEFEATED — la evidencia en la
        // interfaz es el delta de los contadores del héroe.
        const rc = targetDef.reward?.coins ?? 0;
        const trophy = targetDef.trophyGlory ?? 0;
        const rg = trophy + (targetDef.reward?.glory ?? 0);
        if (has('IGNORE_COIN_REWARDS')) {
          if (after.coins !== before.coins) {
            failures.push(`IGNORE_COIN_REWARDS: monedas ${before.coins}→${after.coins}`);
          }
        } else if (rc > 0 && after.coins - before.coins < rc) {
          failures.push(`recompensa de monedas no reflejada (${before.coins}→${after.coins})`);
        }
        if (has('IGNORE_GLORY_REWARDS')) {
          // Brunmar suprime solo la Gloria del DORSO — el laurel del frente
          // (trophyGlory) es valor de trofeo y se cobra igualmente.
          const expected = before.glory + trophy;
          if (after.glory !== expected) {
            failures.push(`IGNORE_GLORY_REWARDS: gloria ${before.glory}→${after.glory} (esperado ${expected}, trofeo ${trophy})`);
          }
        } else if (rg > 0 && after.glory - before.glory < rg) {
          failures.push(`recompensa de gloria no reflejada (${before.glory}→${after.glory})`);
        }
        expect(failures, failures.join('\n')).toEqual([]);
        return;
      }

      if (onDefeat) {
        // +1 moneda por enemigo derrotado (con umbral si lo hay): usar un
        // enemigo sin monedas de recompensa para que el delta del contador
        // sea atribuible al escenario.
        const { state, rng, seed } = scenarioWith(def);
        const minFort = onDefeat.condition?.fortitudeGte ?? 0;
        const enemyDefId = minFort >= 3 ? 'horde.008' : 'horde.003'; // coins:0
        const enemyDef = catalog.byId.get(enemyDefId)!;
        const enemy = enemyFromDef(enemyDefId, 'e2e-scen-target');
        enemy.wounds = Math.max(0, (enemyDef.printedFortitude ?? 1) - 1);
        state.battlefield = [enemy, enemyFromDef('horde.002', 'e2e-extra')];
        const { types, coinsDelta } =
          await playStrikeOnEnemy(page, state, rng, seed, `sc-${def.id}`, enemyDef.name);
        if (!types.includes('ENEMY_DEFEATED')) failures.push('sin ENEMY_DEFEATED');
        if (coinsDelta < 1) failures.push('ON_ENEMY_DEFEATED sin la moneda extra del escenario');
        expect(failures, failures.join('\n')).toEqual([]);
        return;
      }

      if (def.id === 'scenario.cemenmar-wastes') {
        // Yermo de Cemenmar: evasión → robo opt-in de monedas (SELECT_COINS_TO_STEAL)
        const { state, rng, seed } = scenarioWith(def);
        state.phase = 'ATTACK_CHOICE';
        await loadSavedGame(page, makeSave(state, rng, seed, `sc-${def.id}`));
        await page.getByRole('button', { name: /Evadir/i }).first().click();
        const handNames = state.players.p1.hand
          .map(c => catalog.byId.get(c.definitionId)?.name ?? c.definitionId);
        for (const n of [...new Set(handNames)].slice(0, 2)) await clickHandCard(page, n);
        await page.getByRole('button', { name: /Confirmar evasión/i }).first().click();
        const sawPrompt = await drainChoiceDialogs(page);
        const types = await collectEventTypes(page);
        if (!sawPrompt) failures.push('sin diálogo SELECT_COINS_TO_STEAL tras evadir');
        if (!types.includes('COINS_STOLEN')) failures.push('sin COINS_STOLEN del Yermo');
        expect(failures, failures.join('\n')).toEqual([]);
        return;
      }

      // CUSTOM_SCENARIO con oferta de inicio de turno: inyectar la
      // pendingChoice turn-start-* que crea el motor y aceptarla por la UI.
      const { state, rng, seed } = scenarioWith(def);
      const offer = onTurnStart(state, def.id);
      if (!offer) {
        // Sin oferta implementada: al menos el escenario se muestra activo
        await loadSavedGame(page, makeSave(state, rng, seed, `sc-${def.id}`));
        await expect(page.getByText(new RegExp(esc(def.name))).first()).toBeVisible({ timeout: 10000 });
        return;
      }
      // Prerrequisitos de las ofertas (Portal de Ulthar necesita trofeo y
      // pago; Lágrimas necesita gloria y mano ajena — ya cubierto por el
      // estado rico).
      state.players.p1 = {
        ...state.players.p1,
        glory: Math.max(state.players.p1.glory, 2),
        trophies: def.id === 'scenario.ulthar-portal' ? ['e2e-trophy-1'] : state.players.p1.trophies,
      };
      state.pendingChoices = [{
        choiceId: `turn-start-${state.turnNumber}`,
        playerId: 'p1',
        type: 'CONFIRM',
        prompt: offer.prompt,
        options: [],
        minSelections: 0,
        maxSelections: 1,
      } as any];
      await loadSavedGame(page, makeSave(state, rng, seed, `sc-${def.id}`));
      const sawPrompt = await drainChoiceDialogs(page);
      const types = await collectEventTypes(page);
      if (!sawPrompt) failures.push('oferta de escenario no mostrada');
      const expected: Record<string, string[]> = {
        'scenario.ur-mountains': ['CARDS_DRAWN', 'ENEMY_REVEALED'],
        'scenario.eque-port': ['CARD_MOVED', 'CARDS_DRAWN'],
        'scenario.kalern-mud': ['ENEMY_RETURNED_TO_HORDE'],
        'scenario.ulthar-portal': ['ENEMY_RETURNED_TO_HORDE'],
        'scenario.tears-of-aradiel': ['GLORY_LOST', 'GLORY_GAINED'],
        'scenario.jade-deposits': ['COINS_GAINED', 'CARDS_DRAWN'],
      };
      for (const t of expected[def.id] ?? []) {
        if (!types.includes(t)) failures.push(`escenario aceptado sin ${t}`);
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Guarda de cobertura: TODA definición del catálogo debe tener un test E2E
// generado en uno de los describes de arriba. Si el catálogo gana un tipo o
// una carta nueva sin sección asignada, este test lo delata al instante —
// «cada carta tiene test» deja de ser una convención y pasa a ser un hecho
// verificado.
// ---------------------------------------------------------------------------

test('cobertura — toda carta del catálogo tiene test E2E', () => {
  const covered = new Set([
    ...playableDefs.map(d => d.id),   // ABILITY + MARKET
    ...enemyDefs.map(d => d.id),      // HORDE + WARLORD
    ...heroDefs.map(d => d.id),       // HERO
    ...scenarioDefs.map(d => d.id),   // SCENARIO
  ]);
  const missing = catalog.cards.filter(d => !covered.has(d.id));
  expect(
    missing.map(d => `${d.id} (${d.type})`),
    'definiciones del catálogo sin test E2E — añadir su sección',
  ).toEqual([]);
  // Y no puede haber tipos nuevos sin una vía de verificación pensada:
  const types = new Set(catalog.cards.map(d => d.type));
  const knownTypes = new Set(['ABILITY', 'MARKET', 'HORDE', 'WARLORD', 'HERO', 'SCENARIO']);
  expect([...types].filter(t => !knownTypes.has(t)), 'tipo de carta desconocido para el harness').toEqual([]);
});

test('assets — toda carta READY_FOR_GAME tiene su PNG servido', () => {
  // hasFrontImage() confía en el status de images.json; un PNG borrado o
  // nunca exportado dejaría la carta vacía en la mesa sin que nadie lo
  // note. El árbol servido es public/ (metro dev y expo export).
  const missing: string[] = [];
  for (const def of catalog.cards) {
    const imgs = getCardImages(def.id);
    if (!imgs || imgs.status !== 'READY_FOR_GAME') continue;
    for (const variant of ['front', 'back'] as const) {
      const rel = imgs[variant];
      if (rel && !existsSync(join(process.cwd(), 'public', rel))) {
        missing.push(`${def.id}: public/${rel}`);
      }
    }
  }
  expect(missing, 'PNGs declarados READY_FOR_GAME pero inexistentes en public/').toEqual([]);
});
