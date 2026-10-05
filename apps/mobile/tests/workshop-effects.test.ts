/**
 * Cobertura Taller ↔ catálogo oficial ↔ motor.
 *
 * Verifica que:
 * - Todo tipo de efecto usado por las cartas oficiales es construible
 *   desde el editor del Taller (ACTION_DEFS o nodo estructural).
 * - Todo ACTION_DEF produce un CardEffect que valida contra el esquema
 *   Zod del motor y pasa validateCardEffects/validateEffectSources.
 * - Round-trip: los nodos del editor reproducen los efectos exactos de
 *   cartas oficiales representativas (las que antes no eran editables).
 */

import { describe, it, expect } from 'vitest';
import { loadCatalog, EFFECT_REGISTRY, validateEffectSources } from '@nt4h/catalog';
import { CardEffectSchema, validateCardEffects, type CardEffect, type CardType } from '@nt4h/schema';
import {
  ACTION_DEFS, buildNode, buildEffects,
  type EffectNode, type NodeKind,
} from '../components/study/CreateCardTab';
import { describeResolution, describeEffect } from '../lib/effectDescriptions';

// ---------- helpers ----------

let key = 1;
const k = () => key++;

function action(type: string, extra: Partial<EffectNode> = {}): EffectNode {
  return { key: k(), kind: 'ACTION', actionType: type, amountMode: 'fixed', amount: '1', ...extra };
}

/** Tipos de efecto producidos por cada kind estructural (no-ACTION). */
const KIND_FX: Record<Exclude<NodeKind, 'ACTION'>, { type: string; node: Partial<EffectNode> }> = {
  COND: { type: 'CONDITIONAL', node: { condKind: 'HAS_CAPABILITY', condParam: 'EXPERTISE', thenN: [action('GAIN_COINS')] } },
  REPEAT: { type: 'REPEAT', node: { times: '2', timesMode: 'fixed', max: '3', children: [action('DRAW_CARDS')] } },
  CHOOSE: {
    type: 'CHOOSE_ONE',
    node: {
      options: [
        { label: 'A', children: [action('GAIN_COINS')] },
        { label: 'B', children: [action('DRAW_CARDS')] },
      ],
    },
  },
  ON_DEFEAT: { type: 'ON_DEFEAT', node: { children: [action('GAIN_GLORY')] } },
  ON_HORDE: { type: 'ON_HORDE_ATTACK', node: { children: [action('DEAL_DAMAGE_TO_HERO')] } },
  ON_ENEMY_DEF: { type: 'ON_ENEMY_DEFEATED', node: { children: [action('GAIN_COINS', { heroTarget: 'DEFEATING_HERO' })] } },
  PERSISTENT: { type: 'PLACE_PERSISTENT', node: { persistTrigger: 'HORDE_ATTACK', children: [action('DEFEAT_ENEMY', { target: 'ENEMY_WITH_MAX_FORTITUDE' })] } },
  DRAW_CHECK: { type: 'DRAW_AND_CHECK', node: { cardName: 'Disparo Rápido', thenN: [action('PLAY_IMMEDIATELY')], elseN: [] } },
  FOR_EACH: { type: 'FOR_EACH', node: { collection: 'ENEMIES', children: [action('DEAL_DAMAGE')] } },
  TRY: {
    type: 'TRY_EFFECT',
    node: {
      children: [action('GAIN_COINS')],
      elseN: [action('GAIN_GLORY')],
    },
  },
  LISTEN: {
    type: 'REGISTER_LISTENER',
    node: {
      listenEvent: 'ENEMY_DEFEATED', duration: 'GAME', listenTag: 'venganza', once: true,
      children: [action('GAIN_COINS')],
    },
  },
};

/** Recorre recursivamente los efectos de una carta y devuelve sus tipos. */
function collectTypes(effects: CardEffect[] | undefined, into = new Set<string>()): Set<string> {
  for (const eff of effects ?? []) {
    into.add(eff.type);
    const c = eff as unknown as Record<string, unknown>;
    for (const key of ['effects', 'then', 'else', 'onMatch', 'onMismatch', 'onFailure']) {
      const sub = c[key];
      if (Array.isArray(sub)) collectTypes(sub as CardEffect[], into);
    }
    const opts = c['options'];
    if (Array.isArray(opts)) {
      for (const o of opts) collectTypes((o as { effects?: CardEffect[] }).effects, into);
    }
  }
  return into;
}

// ---------- tests ----------

describe('Taller: cobertura de tipos de efecto', () => {
  const catalog = loadCatalog();
  const allCards = [...catalog.byId.values()];

  it('el catálogo oficial se carga (92 cartas)', () => {
    expect(allCards.length).toBe(92);
  });

  it('todo tipo de efecto usado en el catálogo es construible en el editor', () => {
    const actionTypes = new Set(ACTION_DEFS.map(d => d.type));
    const kindTypes = new Set(Object.values(KIND_FX).map(x => x.type));
    const constructible = new Set([...actionTypes, ...kindTypes]);
    const used = new Set<string>();
    for (const card of allCards) {
      collectTypes(card.effects as CardEffect[] | undefined, used);
      collectTypes((card as { heroAbility?: { effects?: CardEffect[] } }).heroAbility?.effects, used);
      collectTypes((card as { peritia?: { effects?: CardEffect[] } }).peritia?.effects, used);
    }
    // CUSTOM_SCENARIO existe en cartas oficiales pero NO es construible
    // en el editor: su `handler` solo despacha escenarios hardcodeados y
    // validateContentSet lo rechaza al publicar — no se ofrece.
    const missing = [...used].filter(t => !constructible.has(t) && t !== 'CUSTOM_SCENARIO');
    expect(missing).toEqual([]);
  });

  it('todo ACTION_DEF produce un efecto válido para el esquema del motor', () => {
    for (const def of ACTION_DEFS) {
      const node = action(def.type, {
        cardName: 'Disparo Rápido',
        searchAction: 'PUT_IN_HAND',
        searchDeck: 'ABILITY',
      });
      const eff = buildNode(node);
      expect(eff, `ACTION_DEF ${def.type} devolvió null`).not.toBeNull();
      expect(eff!.type).toBe(def.type);
      const parsed = CardEffectSchema.safeParse(eff);
      expect(parsed.success, `ACTION_DEF ${def.type} → esquema: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
      expect(validateCardEffects([eff!])).toEqual([]);
      const meta = EFFECT_REGISTRY.find(m => m.type === def.type);
      expect(meta, `${def.type} no está en EFFECT_REGISTRY`).toBeDefined();
      const okSource = meta!.allowedSources.some((ct: CardType) => validateEffectSources(ct, [eff!]).length === 0);
      expect(okSource, `${def.type} no valida para ningún allowedSource`).toBe(true);
    }
  });

  it('todo nodo estructural produce un efecto válido', () => {
    for (const [kind, spec] of Object.entries(KIND_FX)) {
      const node: EffectNode = { key: k(), kind: kind as NodeKind, ...spec.node };
      const eff = buildNode(node);
      expect(eff, `kind ${kind} devolvió null`).not.toBeNull();
      expect(eff!.type).toBe(spec.type);
      expect(CardEffectSchema.safeParse(eff).success, `kind ${kind} → esquema`).toBe(true);
      expect(validateCardEffects([eff!])).toEqual([]);
      const text = describeEffect(eff!);
      expect(text, `kind ${kind} cae en texto genérico`).not.toBe('Efecto especial.');
    }
  });
});

describe('Taller: round-trip de efectos oficiales', () => {
  const catalog = loadCatalog();
  const byId = (id: string) => catalog.byId.get(id)!;

  it('warrior.all-or-nothing — DRAW_AND_ADD_ATTACK', () => {
    const [eff] = buildEffects([action('DRAW_AND_ADD_ATTACK', { amount: '1' })]);
    expect(eff).toEqual(byId('warrior.all-or-nothing').effects[0]);
  });

  it('explorer.collect-arrows — RECOVER_CARD_BY_NAME + SHUFFLE_DECK + GAIN_COINS', () => {
    const fx = buildEffects([
      action('RECOVER_CARD_BY_NAME', { cardName: 'Disparo Rápido', to: 'BOTTOM_OF_DECK' }),
      action('SHUFFLE_DECK', { searchDeck: 'ABILITY' }),
      action('GAIN_COINS', { amount: '1' }),
    ]);
    expect(fx).toEqual(byId('explorer.collect-arrows').effects);
  });

  it('explorer.survival — SWAP_ENEMY', () => {
    const [eff] = buildEffects([action('SWAP_ENEMY', { target: 'SELECTED_ENEMY' })]);
    expect(eff).toEqual(byId('explorer.survival').effects[0]);
  });

  it('hero.valerys — INTERCEPT_DAMAGE en pericia', () => {
    const [eff] = buildEffects([action('INTERCEPT_DAMAGE', { heroTarget: 'OTHER_HERO' })]);
    const ability = (byId('hero.valerys') as { heroAbility?: { effects: CardEffect[] } }).heroAbility!;
    expect(eff).toEqual(ability.effects[0]);
  });

  it('hero.aranel — SEARCH_DECK + SHUFFLE_DECK', () => {
    const fx = buildEffects([
      action('SEARCH_DECK', { cardName: '', searchAction: 'SWAP_WITH_HAND', searchDeck: 'ABILITY' }),
      action('SHUFFLE_DECK', { searchDeck: 'ABILITY' }),
    ]);
    const ability = (byId('hero.aranel') as { heroAbility?: { effects: CardEffect[] } }).heroAbility!;
    // El oficial omite `deck` en SEARCH_DECK (por defecto ABILITY)
    expect(fx[0]).toMatchObject({ type: 'SEARCH_DECK', action: 'SWAP_WITH_HAND' });
    expect(fx[1]).toEqual(ability.effects[1]);
  });

  it('rogue.trap — PLACE_PERSISTENT con disparador HORDE_ATTACK', () => {
    const node: EffectNode = {
      key: k(), kind: 'PERSISTENT', persistTrigger: 'HORDE_ATTACK',
      children: [action('DEFEAT_ENEMY', { target: 'ENEMY_WITH_MAX_FORTITUDE' })],
    };
    const [eff] = buildEffects([node]);
    const official = byId('rogue.trap').effects[0] as Extract<CardEffect, { type: 'PLACE_PERSISTENT' }>;
    expect(eff.type).toBe('PLACE_PERSISTENT');
    expect((eff as typeof official).trigger).toBe(official.trigger);
    expect((eff as typeof official).effects).toHaveLength(1);
    expect((eff as typeof official).effects[0]).toMatchObject({ type: 'DEFEAT_ENEMY', target: { kind: 'ENEMY_WITH_MAX_FORTITUDE' } });
  });

  it('explorer.rapid-shot — DRAW_AND_CHECK con PLAY_IMMEDIATELY', () => {
    const node: EffectNode = {
      key: k(), kind: 'DRAW_CHECK', amount: '1', amountMode: 'fixed', cardName: 'Disparo Rápido',
      thenN: [action('PLAY_IMMEDIATELY')], elseN: [],
    };
    const [eff] = buildEffects([node]);
    const official = byId('explorer.rapid-shot').effects[0] as Extract<CardEffect, { type: 'DRAW_AND_CHECK' }>;
    expect(eff.type).toBe('DRAW_AND_CHECK');
    expect((eff as typeof official).expectedName).toBe(official.expectedName);
    expect((eff as typeof official).onMatch).toEqual(official.onMatch);
  });

  it('scenario.umbrous-swamp — ON_ENEMY_DEFEATED con condición de fortaleza', () => {
    const node: EffectNode = {
      key: k(), kind: 'ON_ENEMY_DEF', fortitudeGte: '3',
      children: [action('GAIN_COINS', { amount: '1', heroTarget: 'DEFEATING_HERO' })],
    };
    const [eff] = buildEffects([node]);
    expect(eff).toEqual(byId('scenario.umbrous-swamp').effects.find(e => e.type === 'ON_ENEMY_DEFEATED'));
  });

  it('CUSTOM_SCENARIO no es construible en el editor (handler sin despacho genérico)', () => {
    // El motor solo despacha handlers de escenarios oficiales hardcodeados;
    // publicar una carta del Taller con CUSTOM_SCENARIO la rechaza
    // validateContentSet — el editor ni siquiera ofrece la acción.
    const fx = buildEffects([action('CUSTOM_SCENARIO', { cardName: 'kalern-mud' })]);
    expect(fx).toEqual([]);
  });
});

describe('Descripción de efectos (Colección / zoom)', () => {
  const catalog = loadCatalog();

  it('ningún efecto oficial cae en el texto genérico «Efecto especial»', () => {
    const walk = (list: CardEffect[] | undefined): string[] => {
      const out: string[] = [];
      for (const eff of list ?? []) {
        out.push(describeEffect(eff));
        const c = eff as unknown as Record<string, unknown>;
        for (const key of ['effects', 'then', 'else', 'onMatch', 'onMismatch', 'onFailure']) {
          if (Array.isArray(c[key])) out.push(...walk(c[key] as CardEffect[]));
        }
        for (const o of (c['options'] as { effects?: CardEffect[] }[] ?? [])) {
          out.push(...walk(o.effects));
        }
      }
      return out;
    };
    for (const card of catalog.byId.values()) {
      const texts = [
        ...walk(card.effects as CardEffect[] | undefined),
        ...walk((card as { heroAbility?: { effects?: CardEffect[] } }).heroAbility?.effects),
        ...walk((card as { peritia?: { effects?: CardEffect[] } }).peritia?.effects),
      ];
      for (const t of texts) {
        expect(t, `${card.id} produce texto genérico`).not.toBe('Efecto especial.');
        expect(t).not.toContain('?');
      }
    }
  });

  it('toda carta oficial con texto impreso lo expone en altText', () => {
    // Las Huestes (27) y las armas del Mercado (2) no llevan texto impreso.
    for (const card of catalog.byId.values()) {
      if (card.type === 'HORDE') continue;
      const hasFx = (card.effects?.length ?? 0) > 0
        || ((card as { heroAbility?: { effects?: unknown[] } }).heroAbility?.effects?.length ?? 0) > 0
        || !!(card as { peritia?: unknown }).peritia;
      if (!hasFx) continue; // armas del Mercado sin efecto
      expect(card.altText ?? card.textOverride, `${card.id} (${card.name}) sin texto impreso`).toBeTruthy();
    }
  });

  it('describeResolution describe Disparo Rápido completo', () => {
    const steps = describeResolution(catalog.byId.get('explorer.rapid-shot')!);
    const text = steps.join(' ');
    expect(text).toContain('Disparo Rápido');
    expect(text).toContain('inmediatamente');
  });

  it('describeResolution incluye la pericia de héroe (Valèrys)', () => {
    const steps = describeResolution(catalog.byId.get('hero.valerys')!);
    const text = steps.join(' ');
    expect(text).toContain('Pericia');
    expect(text).toContain('otro héroe');
    expect(text).toContain('Gloria');
  });

  it('todo efecto construible en el Taller tiene descripción real', () => {
    for (const def of ACTION_DEFS) {
      const node = action(def.type, {
        cardName: 'Disparo Rápido', statusId: 'mark',
        times: '2', targetCount: '1', spillTarget: 'OTHER_ENEMY',
      });
      const eff = buildNode(node)!;
      const text = describeEffect(eff);
      expect(text, `${def.type} cae en texto genérico`).not.toBe('Efecto especial.');
    }
  });
});
