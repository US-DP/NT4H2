/**
 * Contenido personalizado (Taller) — demostración E2E del entregable E:
 *
 * Un ContentSet validado con carta multi-efecto, héroe, escenario, hueste y
 * Señor personalizados + mazo de 15 cartas, fusionado al catálogo y jugado en
 * una partida real del motor. Se verifica:
 * - validateContentSet acepta el conjunto y rechaza ids oficiales
 * - setupGame construye el mazo personalizado (15 cartas, con la carta custom)
 * - la carta custom ejecuta sus efectos ordenados (daño + condicional)
 * - la partida con contenido custom es determinista (mismo seed → mismo hash)
 */
import { describe, it, expect } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { EffectRegistry, registerCoreEffects } from '../src/effects/registry.js';
import { setupGame, resetInstanceCounter } from '../src/phases/setup.js';
import { resetPhaseSeq, processPhases } from '../src/phases/engine.js';
import { loadCatalog, validateContentSet, mergeCustomCards } from '@nt4h/catalog';
import { stateHash } from '../src/replay/index.js';
import { execute } from '../src/commands/execute.js';
import type { GameState, Command, GameEvent } from '@nt4h/schema';

const C = (v: number) => ({ kind: 'CONSTANT' as const, value: v });

/** Conjunto personalizado: carta 3 efectos + héroe + escenario + hueste + señor + mazo 15 */
const CUSTOM_SET = {
  id: 'set.custom-demo',
  name: 'Demo del Taller',
  version: '1.0.0',
  author: 'tester',
  description: 'Conjunto de prueba con todos los tipos',
  status: 'PUBLISHED',
  cards: [
    {
      id: 'custom.firebrand',
      name: 'Tizón Ardiente',
      type: 'ABILITY',
      heroClass: 'EXPLORER',
      copies: 3,
      printedAttack: 0,
      officialStatus: 'CUSTOM',
      effects: [
        { type: 'DEAL_DAMAGE', amount: C(2), target: { kind: 'SELECTED_ENEMY' } },
        {
          type: 'CONDITIONAL',
          condition: { kind: 'ENEMY_DEFEATED_BY_THIS_CARD' },
          then: [{ type: 'GAIN_COINS', amount: C(1) }],
        },
        { type: 'GAIN_GLORY', amount: C(1) },
      ],
    },
    {
      id: 'custom.hero.sable',
      name: 'Sable la Errante',
      type: 'HERO',
      heroClass: 'EXPLORER',
      officialStatus: 'CUSTOM',
      maxWounds: 10,
      capabilities: ['RANGED', 'EXPERTISE'],
      heroAbility: { uses: 1, effects: [{ type: 'DRAW_CARDS', amount: C(2) }] },
    },
    {
      id: 'custom.scenario.fog',
      name: 'Niebla Densa',
      type: 'SCENARIO',
      officialStatus: 'CUSTOM',
      effects: [{ type: 'MODIFY_FORTITUDE', modifier: C(-1), target: { kind: 'ALL_ENEMIES' }, duration: 'WHILE_SOURCE_ACTIVE' }],
    },
    {
      id: 'custom.horde.slime',
      name: 'Limo Verde',
      type: 'HORDE',
      officialStatus: 'CUSTOM',
      printedFortitude: 2,
      reward: { coins: 1, glory: 1 },
    },
    {
      id: 'custom.warlord.blob',
      name: 'Rey de los Limos',
      type: 'WARLORD',
      officialStatus: 'CUSTOM',
      printedFortitude: 8,
      reward: { coins: 4, glory: 5 },
    },
    {
      id: 'custom.hail-of-arrows',
      name: 'Lluvia de Flechas',
      type: 'ABILITY',
      heroClass: 'EXPLORER',
      copies: 1,
      printedAttack: 0,
      officialStatus: 'CUSTOM',
      effects: [
        {
          type: 'REPEAT',
          times: C(3),
          max: 5,
          effects: [
            { type: 'DEAL_DAMAGE', amount: C(1), target: { kind: 'SELECTED_ENEMY' } },
          ],
        },
      ],
    },
    {
      id: 'custom.war-cry',
      name: 'Grito de Guerra',
      type: 'ABILITY',
      heroClass: 'EXPLORER',
      copies: 1,
      printedAttack: 0,
      officialStatus: 'CUSTOM',
      effects: [
        {
          type: 'CHOOSE_ONE',
          prompt: 'Elige tu táctica',
          options: [
            { label: 'Daño', effects: [{ type: 'DEAL_DAMAGE', amount: C(3), target: { kind: 'SELECTED_ENEMY' } }] },
            { label: 'Monedas', effects: [{ type: 'GAIN_COINS', amount: C(2) }] },
            { label: 'Escudos', effects: [{ type: 'SHIELD', amount: C(2) }] },
          ],
        },
      ],
    },
    {
      id: 'custom.recursion-trap',
      name: 'Trampa Recursiva',
      type: 'ABILITY',
      heroClass: 'EXPLORER',
      copies: 1,
      printedAttack: 0,
      officialStatus: 'CUSTOM',
      // REPEAT anidado: 50 × 50 × GAIN_COINS = 2500 ops — dentro del
      // presupuesto pero el test lo escala con 5 repeticiones de nivel 1.
      effects: [
        { type: 'REPEAT', times: C(50), max: 50, effects: [
          { type: 'REPEAT', times: C(50), max: 50, effects: [
            { type: 'REPEAT', times: C(50), max: 50, effects: [
              { type: 'GAIN_COINS', amount: C(1) },
            ] },
          ] },
        ] },
      ],
    },
  ],
  decks: [
    {
      id: 'deck.custom.sable',
      name: 'Mazo de Sable',
      heroClassIds: ['EXPLORER'],
      cardEntries: [
        // 12 cartas oficiales del Explorador + 3 copias de la carta custom
        { cardDefinitionId: 'explorer.rapid-shot', copies: 6 },
        { cardDefinitionId: 'explorer.precise-shot', copies: 2 },
        { cardDefinitionId: 'explorer.arrow-volley', copies: 2 },
        { cardDefinitionId: 'explorer.collect-arrows', copies: 2 },
        { cardDefinitionId: 'custom.firebrand', copies: 3 },
      ],
      deckSize: 15,
      officialStatus: 'CUSTOM',
      author: 'tester',
      version: '1.0.0',
    },
  ],
};

function customCatalog() {
  const base = loadCatalog();
  const res = validateContentSet(CUSTOM_SET, base.byId);
  expect(res.ok).toBe(true);
  return mergeCustomCards(base, [res.set!]);
}

function makeConfig(seed: string) {
  return {
    mode: 'STANDARD' as const,
    playerCount: 1,
    seed,
    heroes: [
      {
        playerId: 'p1',
        heroId: 'custom.hero.sable',
        heroFace: 'FEMALE' as const,
        deckId: 'explorer.default',
        customDeckId: 'deck.custom.sable',
      },
    ],
    customDecks: [
      {
        id: 'deck.custom.sable',
        cardDefinitionIds: [
          'explorer.rapid-shot', 'explorer.rapid-shot', 'explorer.rapid-shot',
          'explorer.rapid-shot', 'explorer.rapid-shot', 'explorer.rapid-shot',
          'explorer.precise-shot', 'explorer.precise-shot',
          'explorer.arrow-volley', 'explorer.arrow-volley',
          'explorer.collect-arrows', 'explorer.collect-arrows',
          'custom.firebrand', 'custom.firebrand', 'custom.firebrand',
        ],
      },
    ],
    useScenarios: false,
  };
}

function freshSetup(seed = 'custom-001') {
  resetInstanceCounter();
  resetPhaseSeq();
  const catalog = customCatalog();
  const result = setupGame(makeConfig(seed), catalog);
  return { ...result, catalog };
}

describe('Taller — validateContentSet', () => {
  it('acepta un conjunto con los 6 tipos de entidad', () => {
    const base = loadCatalog();
    const res = validateContentSet(CUSTOM_SET, base.byId);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.set!.cards).toHaveLength(8);
    expect(res.set!.decks).toHaveLength(1);
  });

  it('rechaza ids que colisionan con el catálogo oficial', () => {
    const base = loadCatalog();
    const evil = { ...CUSTOM_SET, cards: [{ ...CUSTOM_SET.cards[0], id: 'explorer.rapid-shot' }] };
    const res = validateContentSet(evil, base.byId);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.includes('colisiona'))).toBe(true);
  });

  it('rechaza contenido marcado como oficial', () => {
    const base = loadCatalog();
    const evil = { ...CUSTOM_SET, cards: [{ ...CUSTOM_SET.cards[0], officialStatus: 'OFFICIAL' }] };
    const res = validateContentSet(evil, base.byId);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.includes('oficial'))).toBe(true);
  });

  it('rechaza cartas con anidado patológico', () => {
    const base = loadCatalog();
    // 8 niveles de CONDITIONAL anidados (> MAX_EFFECT_DEPTH = 6)
    const deep = (n: number): Record<string, unknown> =>
      n === 0 ? { type: 'GAIN_COINS', amount: C(1) }
        : { type: 'CONDITIONAL', condition: { kind: 'HAS_CAPABILITY', icon: 'RANGED' }, then: [deep(n - 1)] };
    const evil = { ...CUSTOM_SET, cards: [{ ...CUSTOM_SET.cards[0], effects: [deep(8)] }] };
    const res = validateContentSet(evil, base.byId);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.includes('profundo'))).toBe(true);
  });
});

describe('Taller — partida real con contenido personalizado', () => {
  it('setupGame construye el mazo personalizado de 15 cartas', () => {
    const { state, errors } = freshSetup();
    expect(errors).toEqual([]);
    const p = state.players.p1;
    expect(p.heroId).toBe('custom.hero.sable');
    const ids = [...p.hand, ...p.abilityDeck].map(c => c.definitionId);
    expect(ids.filter(id => id === 'custom.firebrand')).toHaveLength(3);
    expect(p.hand.length + p.abilityDeck.length).toBe(15);
  });

  it('la carta custom ejecuta sus efectos ordenados (daño + Gloria)', () => {
    const { state, catalog } = freshSetup('custom-002');
    const rng = new DeterministicRng('custom-002');
    const registry = new EffectRegistry();
    registerCoreEffects(registry);

    // Forzar: fase de ataque, p1 con Tizón Ardiente en mano
    const p = state.players.p1;
    const fb = [...p.hand, ...p.abilityDeck].find(c => c.definitionId === 'custom.firebrand')!;
    const enemy = state.battlefield[0];
    const cur: GameState = {
      ...state,
      phase: 'PLAYER_ATTACK',
      activePlayerId: 'p1',
      players: {
        ...state.players,
        p1: {
          ...p,
          hand: [{ ...fb, zone: 'HAND' as const }, ...p.hand.filter(c => c.instanceId !== fb.instanceId)],
          abilityDeck: p.abilityDeck.filter(c => c.instanceId !== fb.instanceId),
        },
      },
    };

    const gloryBefore = cur.players.p1.glory;
    const cmd: Command = {
      type: 'PLAY_CARD',
      cid: 'play-fb',
      cardInstanceId: fb.instanceId,
      targetEnemyId: enemy.instanceId,
    };
    const r = execute(cur, cmd, rng, registry, catalog);
    expect(r.accepted).toBe(true);

    // Efecto 1: DAMAGE_DEALT al enemigo elegido por el jugador
    const dmg = r.events.filter(e => e.type === 'DAMAGE_DEALT' && e.targetId === enemy.instanceId);
    expect(dmg.length).toBeGreaterThan(0);
    // Efecto 3: GAIN_GLORY 1
    expect(r.events.some(e => e.type === 'GLORY_GAINED' && e.playerId === 'p1')).toBe(true);
    const mid = processPhases(r.newState, rng, catalog).state;
    expect(mid.players.p1.glory).toBe(gloryBefore + 1);
  });

  it('dos partidas con el mismo seed y contenido custom → mismo hash', () => {
    const a = freshSetup('custom-003');
    const b = freshSetup('custom-003');
    expect(stateHash(a.state)).toBe(stateHash(b.state));
  });

  /** Pone una carta custom en la mano de p1 (cirugía de estado) y juega la carta */
  function playCustom(state: GameState, defId: string, targetEnemyId?: string) {
    const rng = new DeterministicRng('fx-' + defId);
    const registry = new EffectRegistry();
    registerCoreEffects(registry);
    const catalog = customCatalog();
    const p = state.players.p1;
    const base = [...p.hand, ...p.abilityDeck][0]; // carta cualquiera como molde de instancia
    const inst = { ...base, definitionId: defId, instanceId: `inst-${defId}` };
    const cur: GameState = {
      ...state,
      phase: 'PLAYER_ATTACK',
      activePlayerId: 'p1',
      players: { ...state.players, p1: { ...p, hand: [inst, ...p.hand] } },
    };
    return execute(cur, {
      type: 'PLAY_CARD', cid: `play-${defId}`, cardInstanceId: inst.instanceId,
      targetEnemyId,
    }, rng, registry, catalog);
  }

  it('REPEAT ejecuta sus efectos N veces con límite (Taller §9.7)', () => {
    const { state } = freshSetup('custom-004');
    const enemy = state.battlefield[0];
    const r = playCustom(state, 'custom.hail-of-arrows', enemy.instanceId);
    expect(r.accepted).toBe(true);
    // 3 repeticiones × 1 de daño al enemigo seleccionado
    const dmg = r.events.filter(
      (e): e is Extract<GameEvent, { type: 'DAMAGE_DEALT' }> =>
        e.type === 'DAMAGE_DEALT' && e.targetId === enemy.instanceId,
    );
    expect(dmg.length).toBe(3);
    expect(dmg.every(e => e.amount === 1)).toBe(true);
  });

  it('CHOOSE_ONE pausa la resolución y ejecuta la rama elegida (Taller §9.11)', () => {
    const { state } = freshSetup('custom-005');
    const rng = new DeterministicRng('fx-choice');
    const registry = new EffectRegistry();
    registerCoreEffects(registry);
    const catalog = customCatalog();
    const p = state.players.p1;
    const base = [...p.hand, ...p.abilityDeck][0];
    const inst = { ...base, definitionId: 'custom.war-cry', instanceId: 'inst-war-cry' };
    const cur: GameState = {
      ...state, phase: 'PLAYER_ATTACK', activePlayerId: 'p1',
      players: { ...state.players, p1: { ...p, hand: [inst, ...p.hand] } },
    };
    const r1 = execute(cur, { type: 'PLAY_CARD', cid: 'play-wc', cardInstanceId: inst.instanceId, targetEnemyId: cur.battlefield[0].instanceId }, rng, registry, catalog);
    expect(r1.accepted).toBe(true);
    // La carta NO se resuelve aún: hay una elección pendiente CHOOSE_EFFECT
    const choice = r1.newState.pendingChoices.find(c => c.type === 'CHOOSE_EFFECT');
    expect(choice).toBeTruthy();
    expect(choice!.options).toEqual(['Daño', 'Monedas', 'Escudos']);
    // La carta sigue en mano (sin destino aplicado todavía)
    expect(r1.newState.players.p1.hand.some(c => c.instanceId === inst.instanceId)).toBe(true);

    // Elegir la rama 'Monedas'
    const coinsBefore = r1.newState.players.p1.coins;
    const r2 = execute(r1.newState, {
      type: 'RESOLVE_CHOICE', cid: 'choose-coins', choiceId: choice!.choiceId,
      selectedIds: ['Monedas'],
    }, rng, registry, catalog);
    expect(r2.accepted).toBe(true);
    expect(r2.events.some(e => e.type === 'COINS_GAINED' && e.playerId === 'p1' && e.amount === 2)).toBe(true);
    expect(r2.newState.pendingChoices.some(c => c.choiceId === choice!.choiceId)).toBe(false);
    // La carta se mueve al Desgaste tras resolver la rama
    expect(r2.newState.players.p1.wearPile.some(c => c.instanceId === inst.instanceId)).toBe(true);
    expect(r2.newState.players.p1.coins).toBeGreaterThanOrEqual(coinsBefore);
  });

  it('el presupuesto de resolución detiene cadenas patológicas con RESOLUTION_HALTED', () => {
    const { state } = freshSetup('custom-006');
    const r = playCustom(state, 'custom.recursion-trap');
    expect(r.accepted).toBe(true);
    // 50³ efectos internos >> 10.000 ops: la resolución se corta de forma controlada
    expect(r.events.some(e => e.type === 'RESOLUTION_HALTED')).toBe(true);
  });

  it('el contenido custom no altera el catálogo oficial base', () => {
    const base = loadCatalog();
    customCatalog(); // merge produce objeto nuevo
    const base2 = loadCatalog();
    expect(stateHash).toBeTruthy();
    expect(base2.byId.has('custom.firebrand')).toBe(false);
    expect(base.byId.size).toBe(base2.byId.size);
  });
});
