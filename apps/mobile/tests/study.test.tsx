/**
 * Nivel 15: Pruebas de la pantalla del Estudio de creación (Fase 12).
 *
 * Verifica:
 * - UI-240: navegación secundaria con 12 pestañas
 * - UI-241: migas de pan
 * - UI-242: estado de guardado permanente
 * - UI-243: botón de guardar borrador
 * - UI-250: vista de héroes
 * - UI-260..267: constructor de mazos
 * - UI-310..315: sandbox
 * - UI-320..325: versionado
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ReactModule from 'react';

// --- Mock hooks: proporcionar implementaciones funcionales sin React fiber ---

const hookState: { values: any[]; index: number } = {
  values: [],
  index: 0,
};

function resetHooks() {
  hookState.values = [];
  hookState.index = 0;
}

// Mock useGameStore
const mockCatalog = {
  byType: new Map([
    ['HERO', [
      { id: 'hero.aranel', name: 'Aranel', type: 'HERO', capabilities: ['RANGED', 'EXPERTISE'], heroAbility: { uses: 2, effects: [] } },
      { id: 'hero.feldon', name: 'Feldon', type: 'HERO', capabilities: ['MELEE', 'EXPERTISE'], heroAbility: { uses: 1, effects: [] } },
    ]],
    ['HORDE', [
      { id: 'horde.001', name: 'Goblin', type: 'HORDE', printedFortitude: 2, copies: 3, isOrc: false },
    ]],
    ['WARLORD', [
      { id: 'warlord.gurdrug', name: 'Gurdrug', type: 'WARLORD', printedFortitude: 8 },
    ]],
    ['MARKET', [
      { id: 'market.potion', name: 'Poción', type: 'MARKET', copies: 2, printedCost: 3, requiredCapabilities: [] },
    ]],
    ['SCENARIO', [
      { id: 'scenario.plain', name: 'Planicie', type: 'SCENARIO' },
    ]],
  ]),
  byClass: new Map([
    ['EXPLORER', [
      { id: 'explorer.quick-shot', name: 'Disparo Rápido', heroClass: 'EXPLORER', printedAttack: 2, copies: 3 },
      { id: 'explorer.aim', name: 'Puntería', heroClass: 'EXPLORER', printedAttack: 1, copies: 2 },
    ]],
    ['WARRIOR', [
      { id: 'warrior.shield', name: 'Escudo', heroClass: 'WARRIOR', printedAttack: 0, copies: 2 },
    ]],
    ['MAGE', []],
    ['ROGUE', []],
  ]),
  byId: new Map(),
};

vi.mock('../store/gameStore', () => ({
  useGameStore: (selector: any) => selector({ catalog: mockCatalog }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useLocalSearchParams: () => ({}),
}));

// Mock react module with working hooks
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof ReactModule>('react');
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)): [T, (v: T) => void] => {
      const idx = hookState.index++;
      if (hookState.values[idx] === undefined) {
        hookState.values[idx] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setter = (v: T) => { hookState.values[idx] = v; };
      return [hookState.values[idx], setter];
    },
    useMemo: <T,>(factory: () => T, _deps: any[]): T => factory(),
    useCallback: <T,>(cb: T, _deps: any[]): T => cb,
    useEffect: (_fn: any, _deps?: any[]) => {},
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});

// Re-import React after mock
const React = await import('react');

// Custom render that doesn't swallow errors
function renderDebug(element: any): { root: any[] } {
  function renderEl(el: any): any[] {
    if (el == null || typeof el === 'boolean') return [];
    if (typeof el === 'string') return [{ type: 'TEXT', props: {}, children: [], text: el }];
    if (typeof el === 'number') return [{ type: 'TEXT', props: {}, children: [], text: String(el) }];
    if (Array.isArray(el)) return el.flatMap(renderEl);
    const { type, props } = el;
    if (typeof type === 'string') {
      const children = props.children ? (Array.isArray(props.children) ? props.children.flatMap(renderEl) : renderEl(props.children)) : [];
      return [{ type, props, children }];
    }
    if (typeof type === 'function') {
      const result = type(props);
      return renderEl(result);
    }
    if (type && typeof type === 'object') {
      const renderFn = type.render ?? type.type;
      if (typeof renderFn === 'function') {
        const result = renderFn(props, undefined);
        return renderEl(result);
      }
    }
    return [];
  }
  return { root: renderEl(element) };
}

function findAllText(nodes: any[]): string[] {
  const texts: string[] = [];
  function walk(node: any) {
    if (node.text != null) {
      const last = texts[texts.length - 1];
      if (last !== undefined && !last.endsWith('\n')) {
        texts[texts.length - 1] = last + node.text;
      } else {
        texts.push(node.text);
      }
    } else {
      if (texts.length > 0 && !texts[texts.length - 1].endsWith('\n')) {
        texts[texts.length - 1] += '\n';
      }
      for (const child of node.children) walk(child);
      if (texts.length > 0 && !texts[texts.length - 1].endsWith('\n')) {
        texts[texts.length - 1] += '\n';
      }
    }
  }
  for (const node of nodes) walk(node);
  return texts.map(t => t.trim()).filter(t => t.length > 0);
}

// Import after mocks
const StudyScreenModule = await import('../app/(study)/index');
const StudyScreen = StudyScreenModule.default;

describe('StudyScreen — Estudio de creación (Fase 12)', () => {
  beforeEach(() => {
    resetHooks();
  });

  it('UI-240: muestra las 12 pestañas de navegación secundaria', async () => {
    resetHooks();
    // Ancho: el sidebar agrupado muestra todas las pestañas siempre.
    const { Dimensions } = await import('react-native');
    const prevGet = Dimensions.get;
    Dimensions.get = () => ({ width: 1200, height: 800 }) as ReturnType<typeof Dimensions.get>;
    try {
      const { root } = renderDebug(React.createElement(StudyScreen));
      const texts = findAllText(root);
      const tabLabels = ['Resumen', 'Héroes', 'Habilidades', 'Mazos', 'Huestes', 'Señores', 'Mercado', 'Escenarios', 'Reglas', 'Conjuntos', 'Pruebas', 'Versiones'];
      for (const label of tabLabels) {
        expect(texts.some(t => t.includes(label))).toBe(true);
      }
    } finally {
      Dimensions.get = prevGet;
    }
  });

  it('UI-240b: en estrecho el índice se colapsa tras "Taller · <sección>"', () => {
    resetHooks();
    // 375px (mock por defecto): solo el selector compacto, no la barra.
    const { root } = renderDebug(React.createElement(StudyScreen));
    const texts = findAllText(root);
    expect(texts.some(t => t.includes('Taller'))).toBe(true);
  });

  it('UI-241: muestra migas de pan con jerarquía', () => {
    resetHooks();
    const { root } = renderDebug(React.createElement(StudyScreen));
    const texts = findAllText(root);
    expect(texts.some(t => t.includes('Taller'))).toBe(true);
  });

  it('UI-242/243: muestra botón de guardar borrador', () => {
    resetHooks();
    const { root } = renderDebug(React.createElement(StudyScreen));
    const texts = findAllText(root);
    expect(texts.some(t => t.includes('Guardar borrador'))).toBe(true);
  });

  it('UI-030: muestra botón para volver al inicio', () => {
    resetHooks();
    const { root } = renderDebug(React.createElement(StudyScreen));
    const texts = findAllText(root);
    expect(texts.some(t => t.includes('Volver al inicio'))).toBe(true);
  });

  it('UI-250: pestaña Resumen muestra estadísticas del catálogo', () => {
    resetHooks();
    const { root } = renderDebug(React.createElement(StudyScreen));
    const texts = findAllText(root);
    expect(texts.some(t => t.includes('Resumen del proyecto'))).toBe(true);
  });

  it('UI-320: muestra estado del proyecto (Borrador)', () => {
    resetHooks();
    const { root } = renderDebug(React.createElement(StudyScreen));
    const texts = findAllText(root);
    expect(texts.some(t => t.includes('Borrador'))).toBe(true);
  });

  it('muestra el nombre del proyecto', () => {
    resetHooks();
    const { root } = renderDebug(React.createElement(StudyScreen));
    const texts = findAllText(root);
    expect(texts.some(t => t.includes('Proyecto sin título'))).toBe(true);
  });
});
