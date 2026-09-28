/**
 * Nivel: Taller — paridad compilador/diagnósticos (Fase 1).
 *
 * - compileTree: ningún nodo inválido desaparece sin diagnóstico con ruta.
 * - semanticDiagnostics: variables, listeners, combos, complejidad.
 * - cloneSubtree: claves únicas en todo el subárbol al duplicar.
 * - Paridad: todo ACTION_DEF tiene describeEffect no-genérico y type único.
 */

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '@nt4h/catalog';
import {
  ACTION_DEFS, EFFECT_TEMPLATES,
  compileTree, buildEffects,
  semanticDiagnostics, complexityOf,
  cloneSubtree, countNodes, maxDepth, nextNodeKey, migrateDraft, DRAFT_VERSION,
  simulateEffects, DEFAULT_SIM_OPTIONS, esT, wrapInContainer, unwrapAt, C,
  balanceWarnings, findNode, patchNode, quickFixFor, diffDrafts, EMPTY_DRAFT,
  wrapManyInContainer, moveToIndex,
  type EffectNode, type NodeKind,
} from '../components/study/cardWorkshop';
import { describeEffect } from '../lib/effectDescriptions';

const node = (kind: NodeKind, extra: Partial<EffectNode> = {}): EffectNode =>
  ({ key: nextNodeKey(), kind, ...extra });
const act = (type: string, extra: Partial<EffectNode> = {}): EffectNode =>
  node('ACTION', { actionType: type, amountMode: 'fixed', amount: '1', ...extra });
const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map(d => d.code);

describe('compileTree: sin descartes silenciosos', () => {
  it('CHOOSE con menos de 2 opciones con efectos → DISCARDED_NODE + ruta', () => {
    const r = compileTree([
      node('CHOOSE', {
        options: [
          { label: 'A', children: [act('GAIN_COINS')] },
          { label: 'B', children: [] },
        ],
      }),
    ]);
    expect(r.effects).toEqual([]);
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0];
    expect(d.code).toBe('DISCARDED_NODE');
    expect(d.severity).toBe('error');
    expect(d.path).toContain('raíz[0]');
  });

  it('nodo vacío anidado señala su ruta completa', () => {
    const r = compileTree([
      node('COND', {
        condKind: 'HAS_CAPABILITY', condParam: 'EXPERTISE',
        thenN: [node('REPEAT', { children: [] })],
        elseN: [act('SHIELD')],
      }),
    ]);
    // COND sigue compilando (sino tiene efectos) pero el hijo muerto se marca
    const d = r.diagnostics.find(x => x.code === 'DISCARDED_NODE');
    expect(d).toBeDefined();
    expect(d!.path).toBe('raíz[0] → entonces[0]');
    expect(r.effects).toHaveLength(1); // el COND sobrevive con la rama else
  });

  it('disparador sin efectos → descarte explícito', () => {
    for (const kind of ['ON_DEFEAT', 'ON_HORDE', 'PERSISTENT', 'LISTEN', 'TRY', 'FOR_EACH'] as NodeKind[]) {
      const r = compileTree([node(kind, { children: [] })]);
      expect(r.effects, kind).toEqual([]);
      expect(codes(r), kind).toContain('DISCARDED_NODE');
    }
  });

  it('ACTION desconocida → DISCARDED_NODE (nunca null mudo)', () => {
    const r = compileTree([act('NONEXISTENT_EFFECT')]);
    expect(r.effects).toEqual([]);
    expect(codes(r)).toContain('DISCARDED_NODE');
  });

  it('COND sin ramas compila como requisito + info (paridad con el catálogo)', () => {
    // mage.staff-strike usa CONDITIONAL then:[] como puerta de jugabilidad
    const r = compileTree([node('COND', { condKind: 'ENEMY_IS_ORC', thenN: [], elseN: [] })]);
    expect(r.effects).toHaveLength(1);
    expect(r.effects[0].type).toBe('CONDITIONAL');
    expect(codes(r)).toContain('EMPTY_CONDITIONAL');
    expect(r.diagnostics[0].severity).toBe('info');
  });

  it('buildEffects conserva compat: mismos efectos, sin diags expuestos', () => {
    const nodes = [act('DEAL_DAMAGE'), act('DRAW_CARDS')];
    expect(buildEffects(nodes)).toEqual(compileTree(nodes).effects);
  });
});

describe('semanticDiagnostics', () => {
  it('variable leída sin asignar → VARIABLE_NEVER_SET', () => {
    const d = semanticDiagnostics([
      act('DEAL_DAMAGE', { amountMode: 'variable', varName: 'carga' }),
    ]);
    expect(d.map(x => x.code)).toContain('VARIABLE_NEVER_SET');
  });

  it('variable asignada después de leerla → VARIABLE_READ_BEFORE_SET', () => {
    const d = semanticDiagnostics([
      act('DEAL_DAMAGE', { amountMode: 'variable', varName: 'x' }),
      act('SET_VARIABLE', { varName: 'x' }),
    ]);
    expect(d.map(x => x.code)).toContain('VARIABLE_READ_BEFORE_SET');
  });

  it('variable bien ordenada → sin avisos', () => {
    const d = semanticDiagnostics([
      act('SET_VARIABLE', { varName: 'x' }),
      act('DEAL_DAMAGE', { amountMode: 'variable', varName: 'x' }),
    ]);
    expect(d.filter(x => x.code.startsWith('VARIABLE_'))).toEqual([]);
  });

  it('listener sin etiqueta → LISTENER_NO_TAG; REMOVE_LISTENER huérfano', () => {
    const d = semanticDiagnostics([
      node('LISTEN', { children: [act('GAIN_COINS')] }),
      act('REMOVE_LISTENER', { varName: 'fantasma' }),
    ]);
    const cs = d.map(x => x.code);
    expect(cs).toContain('LISTENER_NO_TAG');
    expect(cs).toContain('REMOVE_LISTENER_ORPHAN');
  });

  it('tags duplicados → DUPLICATE_LISTENER_TAG', () => {
    const d = semanticDiagnostics([
      node('LISTEN', { listenTag: 'a', children: [act('GAIN_COINS')] }),
      node('LISTEN', { listenTag: 'a', children: [act('SHIELD')] }),
    ]);
    expect(d.map(x => x.code)).toContain('DUPLICATE_LISTENER_TAG');
  });

  it('PLAY_IMMEDIATELY + RECOVER_THIS_CARD → aviso de bucle', () => {
    const d = semanticDiagnostics([act('PLAY_IMMEDIATELY'), act('RECOVER_THIS_CARD')]);
    expect(d.map(x => x.code)).toContain('LOOP_PLAY_RECOVER');
  });

  it('MOVE_CARD a la misma zona → SAME_ZONE', () => {
    const d = semanticDiagnostics([act('MOVE_CARD', { moveFrom: 'HAND', moveTo: 'HAND' })]);
    expect(d.map(x => x.code)).toContain('SAME_ZONE');
  });

  it('referencia a carta inexistente → UNKNOWN_CARD_REF', () => {
    const d = semanticDiagnostics(
      [act('SEARCH_DECK', { cardName: 'Carta Inventada' })],
      undefined,
      { knownCardNames: new Set(['Espada', 'Escudo']) },
    );
    expect(d.map(x => x.code)).toContain('UNKNOWN_CARD_REF');
  });

  it('referencia a carta existente → sin aviso', () => {
    const d = semanticDiagnostics(
      [act('SEARCH_DECK', { cardName: 'Espada' })],
      undefined,
      { knownCardNames: new Set(['Espada']) },
    );
    expect(d.map(x => x.code)).not.toContain('UNKNOWN_CARD_REF');
  });

  it('handler fuera de la lista permitida → UNKNOWN_HANDLER', () => {
    const d = semanticDiagnostics(
      [act('CUSTOM_SCENARIO', { cardName: 'malicioso' })],
      undefined,
      { knownHandlers: new Set(['scenario.kalern-mud']) },
    );
    expect(d.map(x => x.code)).toContain('UNKNOWN_HANDLER');
  });

  it('opciones idénticas y ramas idénticas', () => {
    const same = () => act('GAIN_COINS');
    const d = semanticDiagnostics([
      node('CHOOSE', { options: [
        { label: 'A', children: [same()] },
        { label: 'B', children: [same()] },
      ] }),
      node('COND', { condKind: 'ENEMY_IS_ORC', thenN: [same()], elseN: [same()] }),
    ]);
    const cs = d.map(x => x.code);
    expect(cs).toContain('IDENTICAL_OPTIONS');
    expect(cs).toContain('IDENTICAL_BRANCHES');
  });

  it('REPEAT con times ≤ 0 y times > max', () => {
    const d = semanticDiagnostics([
      node('REPEAT', { times: '0', max: '3', children: [act('SHIELD')] }),
      node('REPEAT', { times: '9', max: '3', children: [act('SHIELD')] }),
    ]);
    const cs = d.map(x => x.code);
    expect(cs).toContain('REPEAT_ZERO');
    expect(cs).toContain('REPEAT_MAX_CLAMPS');
  });
});

describe('cloneSubtree y complejidad', () => {
  it('duplicar regenera keys en TODO el subárbol', () => {
    const orig = node('COND', {
      condKind: 'ENEMY_IS_ORC',
      thenN: [node('REPEAT', { children: [act('SHIELD'), act('DRAW_CARDS')] })],
      elseN: [act('GAIN_COINS')],
    });
    const copy = cloneSubtree(orig);
    const keys = (n: EffectNode[]): number[] => {
      const out: number[] = [];
      const w = (l: EffectNode[]) => l.forEach(x => {
        out.push(x.key);
        w(x.thenN ?? []); w(x.elseN ?? []); w(x.children ?? []);
        (x.options ?? []).forEach(o => w(o.children));
      });
      w(n);
      return out;
    };
    const origKeys = keys([orig]);
    const copyKeys = keys([copy]);
    expect(origKeys.length).toBeGreaterThan(1);
    expect(new Set(copyKeys).size).toBe(copyKeys.length); // únicas
    for (const k2 of copyKeys) expect(origKeys).not.toContain(k2); // ninguna compartida
  });

  it('complexityOf cuenta nodos, profundidad y peor caso', () => {
    const tree = [
      node('REPEAT', { times: '3', max: '5', children: [act('DEAL_DAMAGE'), act('DRAW_CARDS')] }),
      node('FOR_EACH', { collection: 'ENEMIES', children: [act('GAIN_COINS')] }),
    ];
    const c = complexityOf(tree);
    expect(c.nodes).toBe(5);
    expect(c.depth).toBe(2);
    expect(c.worstOps).toBe(3 * 2 + 6 * 1); // REPEAT(3)×2 + FOR_EACH(6)×1
  });

  it('countNodes y maxDepth sobre árbol vacío', () => {
    expect(countNodes([])).toBe(0);
    expect(maxDepth([])).toBe(0);
  });
});

describe('migrateDraft: versionado y saneado', () => {
  it('acepta un borrador válido y le sella la versión', () => {
    const d = migrateDraft({
      cardType: 'ABILITY', name: 'Prueba',
      nodes: [act('DEAL_DAMAGE')],
    });
    expect(d).not.toBeNull();
    expect(d!.draftVersion).toBe(DRAFT_VERSION);
    expect(d!.name).toBe('Prueba');
    expect(d!.nodes).toHaveLength(1);
    // Objeto vacío → borrador por defecto (recuperación parcial, no pérdida)
    expect(migrateDraft({})).not.toBeNull();
  });

  it('rechaza datos no recuperables y versiones futuras', () => {
    expect(migrateDraft(null)).toBeNull();
    expect(migrateDraft('texto')).toBeNull();
    expect(migrateDraft(42)).toBeNull();
    expect(migrateDraft({ draftVersion: DRAFT_VERSION + 5, nodes: [] })).toBeNull();
  });

  it('sanea nodos inválidos y deduplica claves', () => {
    const d = migrateDraft({
      cardType: 'ABILITY',
      nodes: [
        { key: 1, kind: 'ACTION', actionType: 'DEAL_DAMAGE', amount: '1' },
        { key: 1, kind: 'ACTION', actionType: 'DRAW_CARDS' }, // key duplicada
        { key: 2, kind: 'NO_EXISTE' },                        // kind inválido → fuera
        'basura',
        { key: 3, kind: 'ACTION', actionType: 'SHIELD', injected: '<script>' },
      ],
    });
    expect(d).not.toBeNull();
    expect(d!.nodes).toHaveLength(3);
    const keys = d!.nodes.map(n => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect((d!.nodes[2] as unknown as Record<string, unknown>).injected).toBeUndefined();
  });

  it('tolera sub-árboles: migra opciones y ramas', () => {
    const d = migrateDraft({
      cardType: 'ABILITY',
      nodes: [{
        key: 9, kind: 'CHOOSE',
        options: [
          { label: 'A', children: [{ key: 9, kind: 'ACTION', actionType: 'GAIN_COINS' }] },
        ],
      }],
    });
    const choose = d!.nodes[0];
    expect(choose.options).toHaveLength(1);
    expect(choose.options![0].children[0].key).not.toBe(9); // key dedup recursiva
  });
});

describe('simulador de carta', () => {
  const catalog = loadCatalog();
  const baseDef = {
    id: 'sim.test', name: 'Prueba', type: 'ABILITY' as const, copies: 1,
    effects: [], officialStatus: 'CUSTOM' as const, setId: 'set.taller-local',
    author: 'local', version: '1.0.0', verificationStatus: 'INFERRED' as const,
    destinationAfterUse: 'WEAR_PILE' as const,
  };

  it('DEAL_DAMAGE derrota a un enemigo de fortaleza 1', () => {
    const effects = buildEffects([act('DEAL_DAMAGE', { amount: '5' })]);
    const r = simulateEffects(baseDef, effects, {
      ...DEFAULT_SIM_OPTIONS, enemies: 1, enemyFortitude: 1,
    }, catalog, esT);
    expect(r.ok).toBe(true);
    expect(r.enemiesDefeated).toBe(1);
    expect(r.trace.length).toBeGreaterThan(0);
  });

  it('GAIN_COINS genera delta de monedas', () => {
    const effects = buildEffects([act('GAIN_COINS', { amount: '3' })]);
    const r = simulateEffects(baseDef, effects, DEFAULT_SIM_OPTIONS, catalog, esT);
    expect(r.ok).toBe(true);
    expect(r.deltas.some(d => d.includes('Monedas'))).toBe(true);
  });

  it('sin efectos → error legible, nunca excepción', () => {
    const r = simulateEffects(baseDef, [], DEFAULT_SIM_OPTIONS, catalog, esT);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('FOR_EACH daña a cada enemigo del campo', () => {
    const effects = buildEffects([
      node('FOR_EACH', { collection: 'ENEMIES', children: [act('DEAL_DAMAGE', { amount: '1' })] }),
    ]);
    const r = simulateEffects(baseDef, effects, {
      ...DEFAULT_SIM_OPTIONS, enemies: 3, enemyFortitude: 5,
    }, catalog, esT);
    expect(r.ok).toBe(true);
    const hits = r.trace.filter(l => l.text.includes('Daño'));
    expect(hits.length).toBe(3);
  });
});

describe('plantillas', () => {
  it('todas producen nodos compilables con claves únicas', () => {
    for (const tpl of EFFECT_TEMPLATES) {
      const nodes = tpl.build();
      expect(nodes.length, tpl.id).toBeGreaterThan(0);
      const keys = new Set<number>();
      const walk = (l: EffectNode[]) => l.forEach(n => {
        expect(keys.has(n.key), `${tpl.id} key duplicada`).toBe(false);
        keys.add(n.key);
        walk(n.thenN ?? []); walk(n.elseN ?? []); walk(n.children ?? []);
        (n.options ?? []).forEach(o => walk(o.children));
      });
      walk(nodes);
      const r = compileTree(nodes);
      expect(r.diagnostics.filter(d => d.severity === 'error'), tpl.id).toEqual([]);
      expect(r.effects.length, tpl.id).toBeGreaterThan(0);
    }
  });

  it('cada build() genera claves distintas a la anterior', () => {
    const a = EFFECT_TEMPLATES[0].build();
    const b = EFFECT_TEMPLATES[0].build();
    expect(a[0].key).not.toBe(b[0].key);
  });
});

describe('balance por tipo de efecto (§11)', () => {
  it('umbrales específicos por acción, no un límite global', () => {
    const deal = (v: number) =>
      ({ type: 'DEAL_DAMAGE', amount: C(v), target: { kind: 'SELECTED_ENEMY' } }) as never;
    const draw = (v: number) => ({ type: 'DRAW_CARDS', amount: C(v) }) as never;
    const market = (v: number) => ({ type: 'MODIFY_MARKET_COST', modifier: C(v) }) as never;
    // DEAL_DAMAGE: límite 10 → 12 avisa; 10 no
    expect(balanceWarnings([deal(12)])).not.toEqual([]);
    expect(balanceWarnings([deal(10)])).toEqual([]);
    // MODIFY_MARKET_COST: límite 10 → 9 no avisa; 20 sí
    expect(balanceWarnings([market(9)])).toEqual([]);
    expect(balanceWarnings([market(20)])).not.toEqual([]);
    // DRAW_CARDS: límite 6 → 7 avisa
    expect(balanceWarnings([draw(7)])).not.toEqual([]);
    // fallback 25 para efectos sin perfil
    expect(balanceWarnings([{ type: 'REORDER_HORDE', amount: C(30) } as never])).not.toEqual([]);
  });
});

describe('envolver / extraer contenedores', () => {
  it('wrapInContainer mete el nodo en la rama correcta', () => {
    const list = [act('DEAL_DAMAGE'), act('DRAW_CARDS')];
    const cond = wrapInContainer(list, 0, 'COND');
    expect(cond[0].kind).toBe('COND');
    expect(cond[0].thenN?.[0].actionType).toBe('DEAL_DAMAGE');
    expect(cond).toHaveLength(2);

    const rep = wrapInContainer(list, 1, 'REPEAT');
    expect(rep[1].kind).toBe('REPEAT');
    expect(rep[1].children?.[0].actionType).toBe('DRAW_CARDS');

    const fe = wrapInContainer(list, 0, 'FOR_EACH');
    expect(fe[0].collection).toBe('ENEMIES');

    const tryN = wrapInContainer(list, 0, 'TRY');
    expect(tryN[0].children?.[0].actionType).toBe('DEAL_DAMAGE');
  });

  it('unwrapAt devuelve los hijos a la lista padre', () => {
    const kids = [act('GAIN_COINS'), act('SHIELD')];
    const list: EffectNode[] = [
      act('DEAL_DAMAGE'),
      { key: nextNodeKey(), kind: 'COND', thenN: [kids[0]], elseN: [kids[1]] },
    ];
    const out = unwrapAt(list, 1);
    expect(out.map(n => n.actionType)).toEqual(['DEAL_DAMAGE', 'GAIN_COINS', 'SHIELD']);
  });

  it('unwrapAt sin hijos no toca la lista', () => {
    const list = [act('DEAL_DAMAGE')];
    expect(unwrapAt(list, 0)).toEqual(list);
  });
});

describe('condiciones compuestas (§5.2/§9)', () => {
  const condNode = (extra: Partial<EffectNode> = {}): EffectNode => ({
    key: nextNodeKey(), kind: 'COND',
    condKind: 'HAS_CAPABILITY', condParam: 'EXPERTISE',
    thenN: [act('GAIN_COINS')], elseN: [], ...extra,
  });

  it('AND de dos condiciones', () => {
    const [eff] = buildEffects([condNode({
      condJoin: 'AND', condKind2: 'HAND_GTE', condParam2: '3',
    })]) as { condition: { kind: string; conditions: { kind: string }[] } }[];
    expect(eff.condition.kind).toBe('AND');
    expect(eff.condition.conditions.map(c => c.kind)).toEqual(['HAS_CAPABILITY', 'HERO_STAT_GTE']);
  });

  it('NOT envuelve la condición completa', () => {
    const [eff] = buildEffects([condNode({
      condJoin: 'OR', condKind2: 'ENEMY_COUNT_GTE', condParam2: '2', condNot: true,
    })]) as { condition: { kind: string; condition: { kind: string } } }[];
    expect(eff.condition.kind).toBe('NOT');
    expect(eff.condition.condition.kind).toBe('OR');
  });

  it('segunda condición desconocida avisa pero conserva la primera', () => {
    const res = compileTree([condNode({ condJoin: 'AND', condKind2: 'INVENTED' })]);
    expect(res.diagnostics.some(d => d.code === 'UNKNOWN_CONDITION2')).toBe(true);
    const eff = res.effects[0] as { condition: { kind: string } };
    expect(eff.condition.kind).toBe('HAS_CAPABILITY');
  });

  it('condiciones idénticas → diagnóstico IDENTICAL_CONDITIONS', () => {
    const diags = semanticDiagnostics([condNode({
      condJoin: 'AND', condKind2: 'HAS_CAPABILITY', condParam2: 'EXPERTISE',
    })], esT, {});
    expect(diags.some(d => d.code === 'IDENTICAL_CONDITIONS')).toBe(true);
  });
});

describe('cantidades avanzadas (§7)', () => {
  const effAmount = (mode: string) => {
    const [eff] = buildEffects([{
      key: nextNodeKey(), kind: 'ACTION', actionType: 'DRAW_CARDS',
      amountMode: mode, amount: '2',
    } as EffectNode]);
    return (eff as { amount: { kind: string } }).amount;
  };
  it('stats de héroe, enemigo y derrotados compilan a su ValueExpr', () => {
    expect(effAmount('heroWounds')).toEqual({ kind: 'HERO_STAT', stat: 'WOUNDS' });
    expect(effAmount('heroCoins')).toEqual({ kind: 'HERO_STAT', stat: 'COINS' });
    expect(effAmount('handCards')).toEqual({ kind: 'HERO_STAT', stat: 'CARDS_IN_HAND' });
    expect(effAmount('enemyWounds')).toEqual({
      kind: 'ENEMY_WOUNDS_OF', target: { kind: 'SELECTED_ENEMY' },
    });
    expect(effAmount('defeatedEnemies')).toEqual({ kind: 'DEFEATED_ENEMIES' });
    expect(effAmount('handCardsMult').kind).toBe('MULTIPLY');
  });
});

describe('comparador de borradores (§13)', () => {
  it('diffDrafts reporta campos y zonas de nodos cambiados', () => {
    const a = { ...EMPTY_DRAFT, name: 'A', nodes: [act('DEAL_DAMAGE')] };
    const b = { ...EMPTY_DRAFT, name: 'B', copies: '5', nodes: [act('DEAL_DAMAGE'), act('SHIELD')] };
    const diffs = diffDrafts(a, b);
    expect(diffs.find(d => d.field === 'name')).toEqual({ field: 'name', from: 'A', to: 'B' });
    expect(diffs.find(d => d.field === 'copies')).toBeDefined();
    expect(diffs.find(d => d.field === 'nodes')).toBeDefined();
    expect(diffDrafts(a, { ...a })).toEqual([]);
  });
});

describe('envolver selección múltiple (§3.2)', () => {
  it('wrapMany agrupa varios índices conservando orden y posición', () => {
    const list = [act('DEAL_DAMAGE'), act('SHIELD'), act('GAIN_COINS'), act('DRAW_CARDS')];
    const out = wrapManyInContainer(list, [1, 2], 'REPEAT');
    expect(out).toHaveLength(3);
    expect(out[0].actionType).toBe('DEAL_DAMAGE');
    expect(out[1].kind).toBe('REPEAT');
    expect(out[1].children?.map(c => c.actionType)).toEqual(['SHIELD', 'GAIN_COINS']);
    expect(out[2].actionType).toBe('DRAW_CARDS');
    // Índices no contiguos también funcionan
    const out2 = wrapManyInContainer(list, [0, 2], 'COND');
    expect(out2).toHaveLength(3);
    expect(out2[0].kind).toBe('COND');
    expect(out2[0].thenN?.map(c => c.actionType)).toEqual(['DEAL_DAMAGE', 'GAIN_COINS']);
    // Un solo índice delega en wrapInContainer
    expect(wrapManyInContainer(list, [1], 'TRY')[1].kind).toBe('TRY');
    // Vacío → sin cambios
    expect(wrapManyInContainer(list, [], 'COND')).toBe(list);
  });
});

describe('drag & drop (§3.2)', () => {
  it('moveToIndex reordena dentro de la lista', () => {
    expect(moveToIndex([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveToIndex([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveToIndex([1, 2, 3], 1, 3)).toEqual([1, 3, 2]); // al final
    expect(moveToIndex([1, 2, 3], 1, -1)).toEqual([2, 1, 3]); // al principio (clamp)
    const same = [1, 2, 3];
    expect(moveToIndex(same, 1, 1)).toBe(same); // no-op: misma referencia
    expect(moveToIndex(same, 9, 0)).toBe(same); // índice inválido: sin cambios
  });
});

describe('catálogo oficial en partida real (§4.3)', () => {
  it('cada carta jugable oficial resuelve con el motor sin error', () => {
    const catalog = loadCatalog();
    const opts = { ...DEFAULT_SIM_OPTIONS, enemies: 3, deckSize: 8 };
    const failures: string[] = [];
    for (const card of catalog.byId.values()) {
      // Solo cartas jugables desde la mano: ABILITY/MARKET. Los escenarios y
      // pericias de héroe/Señor se resuelven por vías distintas del motor.
      if (card.type !== 'ABILITY' && card.type !== 'MARKET') continue;
      if ((card.effects?.length ?? 0) === 0) continue;
      const res = simulateEffects(card, card.effects, opts, catalog, esT);
      if (!res.ok) failures.push(`${card.id} (${card.name}): ${res.error}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('rendimiento: árboles grandes (§17)', () => {
  it('compila y valida un árbol de ~1000 nodos dentro del presupuesto', () => {
    // 200 REPEAT con 4 hijos (5 nodos c/u) + 200 acciones sueltas = 1200
    const big: EffectNode[] = [];
    for (let i = 0; i < 200; i++) {
      big.push({
        key: nextNodeKey(), kind: 'REPEAT', timesMode: 'fixed', times: '2', max: '3',
        children: [act('DEAL_DAMAGE'), act('SHIELD'), act('GAIN_COINS'), act('DRAW_CARDS')],
      } as EffectNode);
    }
    for (let i = 0; i < 200; i++) big.push(act('GAIN_COINS'));
    expect(countNodes(big)).toBe(1200);
    const t0 = performance.now();
    const res = compileTree(big);
    semanticDiagnostics(big, esT, {});
    const ms = performance.now() - t0;
    expect(res.effects).toHaveLength(400);
    // Presupuesto: <2s en CI — suficiente para no bloquear la UI (debounced).
    expect(ms).toBeLessThan(2000);
  });
});

describe('corrección automática segura (§10.2)', () => {
  it('quickFixFor propone parches solo para códigos arreglables', () => {
    const n = act('APPLY_STATUS');
    expect(quickFixFor('EMPTY_STATUS_ID', n)).toEqual({ statusId: 'mark' });
    expect(quickFixFor('EMPTY_VAR_NAME', n)).toEqual({ varName: 'v1' });
    expect(quickFixFor('LISTENER_NO_TAG', n)).toEqual({ listenTag: `tag-${n.key}` });
    expect(quickFixFor('REPEAT_ZERO', n)).toEqual({ timesMode: 'fixed', times: '1' });
    expect(quickFixFor('REPEAT_NO_MAX', n)).toEqual({ max: '10' });
    expect(quickFixFor('SAME_ZONE', { ...n, moveFrom: 'HAND' })).toEqual({ moveTo: 'WEAR_PILE' });
    // Códigos sin arreglo seguro → null
    expect(quickFixFor('VARIABLE_NEVER_SET', n)).toBeNull();
    expect(quickFixFor('UNKNOWN_CARD_REF', n)).toBeNull();
  });

  it('findNode y patchNode localizan y parchan en profundidad', () => {
    const leaf = act('GAIN_COINS');
    const tree = [
      { key: nextNodeKey(), kind: 'COND', thenN: [act('DEAL_DAMAGE')], elseN: [] } as EffectNode,
      { key: nextNodeKey(), kind: 'REPEAT', children: [leaf], timesMode: 'fixed', times: '2' } as EffectNode,
    ];
    expect(findNode(tree, leaf.key)).toBe(leaf);
    expect(findNode(tree, 999999)).toBeNull();
    const patched = patchNode(tree, leaf.key, { amount: '9' });
    expect(findNode(patched, leaf.key)?.amount).toBe('9');
    expect(findNode(tree, leaf.key)?.amount).not.toBe('9'); // sin mutar el original
  });
});

describe('paridad registro ↔ descripción', () => {
  it('todo ACTION_DEF tiene describeEffect no-genérico', () => {
    for (const def of ACTION_DEFS) {
      const eff = compileTree([act(def.type, {
        cardName: 'Disparo Rápido', searchAction: 'PUT_IN_HAND', searchDeck: 'ABILITY',
      })]).effects[0];
      expect(eff, def.type).toBeDefined();
      const text = describeEffect(eff);
      expect(text, `${def.type} cae en texto genérico`).not.toBe('Efecto especial.');
      expect(text.length, def.type).toBeGreaterThan(0);
    }
  });

  it('no hay tipos de acción duplicados en ACTION_DEFS', () => {
    const types = ACTION_DEFS.map(d => d.type);
    expect(new Set(types).size).toBe(types.length);
  });
});
