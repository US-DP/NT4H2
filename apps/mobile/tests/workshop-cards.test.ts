/**
 * Reproducción del catálogo oficial desde el Taller + cartas originales.
 *
 * Parte 1 — para CADA carta oficial con efectos, se reconstruyen los
 * EffectNode que un jugador montaría en el editor y se comprueba que
 * buildEffects genera exactamente los CardEffect del catálogo.
 *
 * Parte 2 — cartas originales que mezclan nodos estructurales: se validan
 * contra CardEffectSchema/CardDefinitionSchema, validateCardEffects y
 * validateEffectSources, y se comprueba que describeEffect las narra.
 */

import { describe, it, expect } from 'vitest';
import { loadCatalog, validateEffectSources } from '@nt4h/catalog';
import {
  CardEffectSchema, CardDefinitionSchema,
  validateCardEffects, type CardDefinition, type CardEffect,
} from '@nt4h/schema';
import { buildEffects, balanceWarnings, type EffectNode, type NodeKind } from '../components/study/CreateCardTab';
import { describeEffect } from '../lib/effectDescriptions';

// ---------- helpers ----------

let key = 1;
const k = () => key++;

const n = (kind: NodeKind, p: Partial<EffectNode> = {}): EffectNode => ({ key: k(), kind, ...p });
const act = (actionType: string, p: Partial<EffectNode> = {}): EffectNode =>
  n('ACTION', { actionType, amountMode: 'fixed', amount: '1', ...p });
const cond = (condKind: string, condParam: string, thenN: EffectNode[], elseN: EffectNode[] = []): EffectNode =>
  n('COND', { condKind, condParam, thenN, elseN });

/**
 * Canonicalización para comparar Taller ↔ catálogo:
 * - `expectedCard` (definitionId) se omite: el editor referencia por nombre
 *   y el resolver ya prefiere expectedCard pero acepta expectedName.
 * - `peritia.text` es narrativo; el Taller lo cubre con textOverride/altText.
 * - MULTIPLY(2, x) ≡ SUM(x, x) (Saqueo del Pícaro).
 */
const canon = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(canon);
  if (obj && typeof obj === 'object') {
    const src = obj as Record<string, unknown>;
    if (src.kind === 'MULTIPLY' && Array.isArray(src.factors) && src.factors.length === 2) {
      const [a, b] = src.factors as Record<string, unknown>[];
      if (a?.kind === 'CONSTANT' && a.value === 2) return { kind: 'SUM', of: [canon(b), canon(b)] };
    }
    const out: Record<string, unknown> = {};
    for (const [k2, v] of Object.entries(src)) {
      if (k2 === 'expectedCard' || k2 === 'text') continue;
      out[k2] = canon(v);
    }
    // SEARCH_DECK.deck es opcional y por defecto ABILITY
    if (src.type === 'SEARCH_DECK' && out.deck === 'ABILITY') delete out.deck;
    return out;
  }
  return obj;
};

// ---------- Parte 1: cada carta oficial reproducible ----------

/** Nodos que un jugador montaría en el editor para reproducir la carta. */
const OFFICIAL_NODES: Record<string, EffectNode[]> = {
  // Explorador
  'explorer.companion-wolf': [act('PREVENT_DAMAGE', { amount: '2' })],
  'explorer.precise-shot': [act('LOSE_CARDS'), act('END_ATTACK')],
  'explorer.rapid-shot': [
    n('DRAW_CHECK', { amount: '1', amountMode: 'fixed', cardName: 'Disparo Rápido', thenN: [act('PLAY_IMMEDIATELY')], elseN: [] }),
  ],
  'explorer.bullseye': [act('GAIN_GLORY'), act('LOSE_CARDS')],
  'explorer.arrow-volley': [
    act('DEAL_DAMAGE_SPLIT', { amount: '2', targetCount: '2', target: 'ALL_ENEMIES' }),
    act('DEAL_DAMAGE_TO_HERO', { amount: '2', heroTarget: 'HERO_WITH_FEWEST_WOUNDS' }),
  ],
  'explorer.collect-arrows': [
    act('RECOVER_CARD_BY_NAME', { cardName: 'Disparo Rápido' }),
    act('SHUFFLE_DECK', { searchDeck: 'ABILITY' }),
    act('GAIN_COINS'),
  ],
  'explorer.survival': [act('SWAP_ENEMY')],
  // Guerrero
  'warrior.brutal-attack': [act('LOSE_CARDS')],
  'warrior.shield-charge': [act('PREVENT_DAMAGE', { amount: '2' })],
  'warrior.double-slash': [act('LOSE_CARDS')],
  'warrior.shield': [act('PREVENT_ENEMY_DAMAGE'), act('END_ATTACK')],
  'warrior.sword-strike': [cond('FIRST_CARD_OF_NAME_THIS_TURN', 'Espadazo', [act('DRAW_CARDS')])],
  'warrior.step-back': [act('DRAW_CARDS', { amount: '2' })],
  'warrior.all-or-nothing': [act('DRAW_AND_ADD_ATTACK')],
  'warrior.voice-of-encouragement': [
    act('ALL_HEROES_RECOVER', { amount: '2' }),
    act('DRAW_CARDS'),
    act('GAIN_GLORY'),
  ],
  // Mago
  'mage.protective-aura': [
    act('CANCEL_ALL_DAMAGE', { duration: 'NEXT_HORDE_ATTACK' }),
    act('LOSE_CARDS', { amountMode: 'fieldEnemies' }),
  ],
  'mage.fireball': [act('DEAL_DAMAGE_ALL_ENEMIES', { amount: '2' }), act('DEAL_DAMAGE_TO_OTHER_HEROES')],
  'mage.ice-shot': [act('DISABLE_ENEMY_DAMAGE', { duration: 'UNTIL_END_OF_TURN' }), act('DRAW_CARDS')],
  'mage.corrosive-arrow': [
    act('APPLY_VULNERABILITY', { duration: 'UNTIL_END_OF_TURN' }),
    act('LOSE_CARDS'),
  ],
  'mage.staff-strike': [cond('ALREADY_USED_AGAINST_THIS_ENEMY', 'Golpe de Bastón', [])],
  'mage.healing-orb': [act('ALL_HEROES_RECOVER', { amount: '2' }), act('HEAL_WOUNDS')],
  'mage.fire-bolt': [act('GAIN_GLORY')],
  'mage.reconstitution': [act('DRAW_CARDS'), act('RECOVER_CARDS', { amount: '2' })],
  'mage.light-torrent': [act('OTHER_HEROES_RECOVER', { amount: '2' }), act('GAIN_GLORY')],
  // Pícaro
  'rogue.to-the-heart': [
    n('ON_DEFEAT', { children: [cond('FIRST_CARD_OF_NAME_THIS_TURN', 'Al Corazón', [act('GAIN_COINS')])] }),
    act('LOSE_CARDS'),
  ],
  'rogue.sneak-attack': [
    n('ON_DEFEAT', { children: [cond('FIRST_CARD_OF_NAME_THIS_TURN', 'Ataque Furtivo', [act('GAIN_COINS')])] }),
  ],
  'rogue.precise-crossbow': [cond('ALREADY_USED_AGAINST_THIS_ENEMY', 'Ballesta Precisa', [])],
  'rogue.in-the-shadows': [act('PREVENT_DAMAGE', { amount: '2' })],
  'rogue.deceive': [
    act('COST', { amount: '2', resource: 'COINS' }),
    act('DISABLE_ENEMY_DAMAGE', { duration: 'UNTIL_END_OF_TURN' }),
  ],
  'rogue.pickpocket': [act('STEAL_COINS', { heroTarget: 'EACH_OTHER' })],
  'rogue.plunder-a': [act('GAIN_COINS', { amountMode: 'enemiesMult', amount: '2' })],
  'rogue.plunder-b': [act('GAIN_COINS', { amountMode: 'enemies' }), act('GAIN_GLORY')],
  'rogue.trap': [
    n('PERSISTENT', { persistTrigger: 'HORDE_ATTACK', children: [
      act('DEFEAT_ENEMY', { target: 'ENEMY_WITH_MAX_FORTITUDE', loot: 'lost' }),
    ] }),
  ],
  // Mercado
  'market.elven-dagger': [cond('HAS_CAPABILITY', 'EXPERTISE', [act('RECOVER_THIS_CARD', { to: 'HAND' })])],
  'market.healing-potion': [act('HEAL_WOUNDS')],
  'market.whetstone': [act('MODIFY_DAMAGE', { scope: 'NEXT_CARD' })],
  'market.conjuration-vial': [act('SEARCH_WEAR_PILE_PUT_IN_HAND')],
  'market.concentration-elixir': [act('DRAW_CARDS', { amount: '3' })],
  'market.elven-cloak': [act('DISABLE_ENEMY_DAMAGE', { duration: 'UNTIL_END_OF_TURN' })],
  'market.plate-armor': [act('RECOVER_CARDS', { amount: '4' })],
  // Escenarios
  'scenario.battlefield': [
    n('ON_ENEMY_DEF', { children: [act('GAIN_COINS', { heroTarget: 'DEFEATING_HERO' })] }),
  ],
  'scenario.tears-of-aradiel': [act('CUSTOM_SCENARIO', { cardName: 'tears-of-aradiel' })],
  'scenario.kalern-mud': [act('CUSTOM_SCENARIO', { cardName: 'kalern-mud' })],
  'scenario.lotharion-market': [act('MODIFY_MARKET_COST', { amount: '-1' })],
  'scenario.ur-mountains': [act('CUSTOM_SCENARIO', { cardName: 'ur-mountains' })],
  'scenario.umbrous-swamp': [
    n('ON_ENEMY_DEF', { fortitudeGte: '3', children: [act('GAIN_COINS', { heroTarget: 'DEFEATING_HERO' })] }),
  ],
  'scenario.skaarg-plains': [act('IGNORE_COIN_REWARDS')],
  'scenario.ulthar-portal': [act('CUSTOM_SCENARIO', { cardName: 'ulthar-portal' })],
  'scenario.eque-port': [act('CUSTOM_SCENARIO', { cardName: 'eque-port' })],
  'scenario.brunmar-ruins': [
    act('MODIFY_FORTITUDE', { amount: '-1', target: 'ALL_ENEMIES', duration: 'WHILE_SOURCE_ACTIVE' }),
    act('IGNORE_GLORY_REWARDS'),
  ],
  'scenario.jade-deposits': [act('CUSTOM_SCENARIO', { cardName: 'jade-deposits' })],
  'scenario.cemenmar-wastes': [act('CUSTOM_SCENARIO', { cardName: 'cemenmar-wastes' })],
};

/** Pericias de héroe (abilityNodes del editor). */
const OFFICIAL_HERO_ABILITY: Record<string, { uses: number; nodes: EffectNode[] }> = {
  'hero.aranel': { uses: 1, nodes: [
    act('SEARCH_DECK', { searchAction: 'SWAP_WITH_HAND' }),
    act('SHUFFLE_DECK', { searchDeck: 'ABILITY' }),
  ] },
  'hero.neddia': { uses: 1, nodes: [
    act('SEARCH_DECK', { searchAction: 'SWAP_WITH_HAND', searchDeck: 'MARKET', targetCount: '2' }),
    act('SHUFFLE_DECK', { searchDeck: 'MARKET' }),
  ] },
  'hero.valerys': { uses: 2, nodes: [
    act('INTERCEPT_DAMAGE', { heroTarget: 'OTHER_HERO' }),
    act('GAIN_GLORY'),
  ] },
  'hero.taheral': { uses: 1, nodes: [
    act('GAIN_COINS', { amountMode: 'evasionMult', amount: '2' }),
  ] },
  'hero.idril': { uses: 2, nodes: [act('LOOK_AT_CARDS', { amount: '3' })] },
};

/** Pericias de Señor de la Guerra (peritiaNodes del editor). */
const OFFICIAL_PERITIA: Record<string, { trigger: string; condition?: string; nodes: EffectNode[] }> = {
  'warlord.gurdrug': { trigger: 'DAMAGE_DEALT', nodes: [act('LOSE_CARDS')] },
  'warlord.roghkiller': { trigger: 'CONTINUOUS', nodes: [
    act('MODIFY_FORTITUDE', { amount: '1', target: 'ALL_ENEMIES', orcOnly: true, duration: 'WHILE_SOURCE_ACTIVE' }),
  ] },
  'warlord.shriekknifer': { trigger: 'CARD_PLAYED', condition: 'printedAttack == 1', nodes: [
    act('RECOVER_CARDS'),
  ] },
};

const catalog = loadCatalog();

describe('Taller → reproducción de cada carta oficial', () => {
  it('todas las cartas con efectos tienen nodos de editor mapeados', () => {
    for (const card of catalog.byId.values()) {
      if ((card.effects?.length ?? 0) > 0) {
        expect(OFFICIAL_NODES[card.id], `${card.id} (${card.name}) sin mapeo`).toBeTruthy();
      }
      if ((card.heroAbility?.effects?.length ?? 0) > 0) {
        expect(OFFICIAL_HERO_ABILITY[card.id], `${card.id} pericia sin mapeo`).toBeTruthy();
      }
      if (card.peritia) {
        expect(OFFICIAL_PERITIA[card.id], `${card.id} pericia de Señor sin mapeo`).toBeTruthy();
      }
    }
  });

  it('cada carta oficial: buildEffects reproduce los efectos exactos', () => {
    for (const [id, nodes] of Object.entries(OFFICIAL_NODES)) {
      const card = catalog.byId.get(id);
      expect(card, id).toBeTruthy();
      // CUSTOM_SCENARIO no es construible en el editor: su `handler` solo
      // despacha los escenarios oficiales hardcodeados del motor.
      if (card!.effects.every(e => e.type === 'CUSTOM_SCENARIO')) continue;
      const built = buildEffects(nodes);
      expect(canon(built), `${id} (${card!.name})`).toEqual(canon(card!.effects));
    }
  });

  it('cada pericia de héroe: buildEffects reproduce los efectos y usos', () => {
    for (const [id, spec] of Object.entries(OFFICIAL_HERO_ABILITY)) {
      const card = catalog.byId.get(id)!;
      const built = buildEffects(spec.nodes);
      expect(canon(built), id).toEqual(canon(card.heroAbility!.effects));
      expect(card.heroAbility!.uses).toBe(spec.uses);
    }
  });

  it('cada pericia de Señor: trigger, condición y efectos reproducidos', () => {
    for (const [id, spec] of Object.entries(OFFICIAL_PERITIA)) {
      const card = catalog.byId.get(id)!;
      const built = buildEffects(spec.nodes);
      expect(canon(built), id).toEqual(canon(card.peritia!.effects));
      expect(card.peritia!.trigger).toBe(spec.trigger);
      expect((card.peritia as { condition?: string }).condition ?? undefined).toBe(spec.condition);
    }
  });

  it('los efectos reconstruidos pasan la validación del catálogo', () => {
    const cardOf = (id: string) => catalog.byId.get(id)!;
    for (const [id, nodes] of Object.entries(OFFICIAL_NODES)) {
      const effects = buildEffects(nodes);
      for (const e of effects) {
        const parsed = CardEffectSchema.safeParse(e);
        expect(parsed.success, `${id}: ${JSON.stringify(e)}`).toBe(true);
      }
      expect(validateCardEffects(effects), id).toEqual([]);
      expect(validateEffectSources(cardOf(id).type, effects), id).toEqual([]);
    }
    for (const [id, spec] of Object.entries(OFFICIAL_HERO_ABILITY)) {
      const effects = buildEffects(spec.nodes);
      expect(validateCardEffects(effects), id).toEqual([]);
      expect(validateEffectSources(cardOf(id).type, effects), id).toEqual([]);
    }
    for (const [id, spec] of Object.entries(OFFICIAL_PERITIA)) {
      const effects = buildEffects(spec.nodes);
      expect(validateCardEffects(effects), id).toEqual([]);
      expect(validateEffectSources(cardOf(id).type, effects), id).toEqual([]);
    }
  });
});

// ---------- Parte 2: cartas originales mezclando nodos ----------

describe('Taller → cartas originales combinadas', () => {
  const custom = (partial: Partial<CardDefinition> & Pick<CardDefinition, 'id' | 'name' | 'type'>): CardDefinition => ({
    copies: 1,
    effects: [],
    destinationAfterUse: 'WEAR_PILE',
    officialStatus: 'CUSTOM',
    setId: 'set.taller-local',
    author: 'local',
    version: '1.0.0',
    verificationStatus: 'INFERRED',
    altText: 'Carta de prueba del Taller',
    ...partial,
  });

  const expectCardOk = (card: CardDefinition, fx: CardEffect[]) => {
    for (const e of fx) {
      const p = CardEffectSchema.safeParse(e);
      expect(p.success, `${card.id}: ${JSON.stringify(e)}`).toBe(true);
      expect(describeEffect(e)).not.toBe('Efecto especial.');
    }
    expect(validateCardEffects(fx)).toEqual([]);
    expect(validateEffectSources(card.type, fx)).toEqual([]);
    const parsed = CardDefinitionSchema.safeParse({ ...card, effects: fx });
    expect(parsed.success, `${card.id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
  };

  it('habilidad de Pícaro: repetición condicionada + robo al derrotar', () => {
    const fx = buildEffects([
      n('REPEAT', { timesMode: 'enemies', max: '4', children: [
        cond('FIRST_CARD_OF_NAME_THIS_TURN', 'Sombra Cazadora', [
          act('DEAL_DAMAGE', { target: 'SELECTED_ENEMY' }),
        ]),
      ] }),
      n('ON_DEFEAT', { children: [
        act('STEAL_COINS', { heroTarget: 'EACH_OTHER' }),
        act('DRAW_CARDS'),
      ] }),
    ]);
    expectCardOk(
      custom({ id: 'custom.sombra', name: 'Sombra Cazadora', type: 'ABILITY', heroClass: 'ROGUE', printedAttack: 2 }),
      fx,
    );
  });

  it('carta de Mercado: elección opcional + prevención hasta la próxima horda', () => {
    const fx = buildEffects([
      n('CHOOSE', { prompt: '¿Qué reliquia tomas?', optional: true, options: [
        { label: 'Oro', children: [act('GAIN_COINS', { amount: '2' })] },
        { label: 'Cura', children: [act('HEAL_WOUNDS')] },
      ] }),
      act('PREVENT_DAMAGE', { amount: '3', duration: 'NEXT_HORDE_ATTACK' }),
    ]);
    expectCardOk(
      custom({ id: 'custom.reliquia', name: 'Reliquia Orca', type: 'MARKET', printedCost: 4 }),
      fx,
    );
  });

  it('escenario: modificar fortaleza solo a orcos + pericia disparada', () => {
    const fx = buildEffects([
      act('MODIFY_FORTITUDE', { amount: '-1', target: 'ALL_ENEMIES', orcOnly: true, duration: 'WHILE_SOURCE_ACTIVE' }),
      n('ON_ENEMY_DEF', { fortitudeGte: '4', children: [act('GAIN_GLORY', { amount: '2' })] }),
    ]);
    expectCardOk(custom({ id: 'custom.pantano', name: 'Pantano de Orcos', type: 'SCENARIO' }), fx);
  });

  it('habilidad de Mago: robar-comprobar encadenado con ramas', () => {
    const fx = buildEffects([
      n('DRAW_CHECK', {
        amount: '1', cardName: 'Bola de Fuego',
        thenN: [act('PLAY_IMMEDIATELY', { inheritTarget: true }), act('GAIN_GLORY')],
        elseN: [act('RECOVER_CARDS', { amount: '2' })],
      }),
      act('SHUFFLE_DECK', { searchDeck: 'ABILITY' }),
    ]);
    expectCardOk(
      custom({ id: 'custom.cadena', name: 'Cadena Mística', type: 'ABILITY', heroClass: 'MAGE', printedAttack: 0 }),
      fx,
    );
  });

  it('pericia de héroe custom: buscar en Mercado ×2 + interceptar daño', () => {
    const fx = buildEffects([
      act('SEARCH_DECK', { searchAction: 'SWAP_WITH_HAND', searchDeck: 'MARKET', targetCount: '2' }),
      act('SHUFFLE_DECK', { searchDeck: 'MARKET' }),
      act('INTERCEPT_DAMAGE', { heroTarget: 'ALL_OTHERS' }),
    ]);
    const card = custom({
      id: 'custom.hero-test', name: 'Héroe de Prueba', type: 'HERO',
      heroAbility: { uses: 2, effects: fx },
      maxWounds: 3, capabilities: ['MELEE'],
    });
    for (const e of fx) {
      expect(CardEffectSchema.safeParse(e).success).toBe(true);
    }
    expect(validateCardEffects(fx)).toEqual([]);
    expect(validateEffectSources('HERO', fx)).toEqual([]);
    expect(CardDefinitionSchema.safeParse(card).success).toBe(true);
  });

  it('Señor custom: pericia disparada por carta jugada con daño 1', () => {
    const fx = buildEffects([
      n('PERSISTENT', { persistTrigger: 'HORDE_ATTACK', children: [
        act('DEAL_DAMAGE_TO_HERO', { amount: '2', heroTarget: 'HERO_WITH_FEWEST_WOUNDS' }),
      ] }),
      act('LOSE_CARDS', { amount: '2' }),
    ]);
    const card = custom({
      id: 'custom.warlord-test', name: 'Jefe de Prueba', type: 'WARLORD',
      printedFortitude: 10, reward: { coins: 3, glory: 2 },
      peritia: { trigger: 'CARD_PLAYED', condition: 'printedAttack == 1', effects: fx },
    });
    for (const e of fx) {
      expect(CardEffectSchema.safeParse(e).success).toBe(true);
      expect(describeEffect(e)).not.toBe('Efecto especial.');
    }
    expect(validateEffectSources('WARLORD', fx)).toEqual([]);
    expect(CardDefinitionSchema.safeParse(card).success).toBe(true);
  });

  it('valores libres: "ganar 99 Monedas" y "robar 99 cartas" se permiten, con aviso', () => {
    const fx = buildEffects([
      act('GAIN_COINS', { amount: '99' }),
      act('DRAW_CARDS', { amount: '99' }),
    ]);
    // Los valores libres son válidos: el contenido custom es opt-in
    for (const e of fx) {
      expect(CardEffectSchema.safeParse(e).success).toBe(true);
    }
    expect(validateCardEffects(fx)).toEqual([]);
    expect(validateEffectSources('ABILITY', fx)).toEqual([]);
    // ...pero el editor avisa de la potencia extrema (no bloquea)
    const warns = balanceWarnings(fx);
    expect(warns.length).toBe(2);
    expect(warns.join(' ')).toContain('potencia extrema');
  });

  it('cantidades ≤0 en efectos de magnitud generan aviso de degenerado', () => {
    const fx = buildEffects([
      act('DRAW_CARDS', { amount: '0' }),
      act('DEAL_DAMAGE', { amount: '-3' }),
      act('MODIFY_DAMAGE', { amount: '0', scope: 'THIS_TURN' }),
    ]);
    const warns = balanceWarnings(fx);
    expect(warns.length).toBe(3);
    expect(warns.join(' ')).toContain('no hará nada');
    // Los modificadores negativos legítimos (Brunmar -1) NO avisan
    const ok = buildEffects([act('MODIFY_FORTITUDE', { amount: '-1' })]);
    expect(balanceWarnings(ok)).toEqual([]);
  });

  it('el aviso recorre efectos anidados (condicional dentro de repetición)', () => {
    const fx = buildEffects([
      n('REPEAT', { times: '3', timesMode: 'fixed', max: '5', children: [
        cond('ENEMY_FORTITUDE_GTE', '3', [act('GAIN_GLORY', { amount: '99' })]),
      ] }),
    ]);
    expect(balanceWarnings(fx).join(' ')).toContain('potencia extrema');
  });
});
