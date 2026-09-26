/**
 * Renderizador ligero para tests de componentes React Native.
 *
 * No usa react-test-renderer (que tiene problemas con vitest/esbuild).
 * En su lugar, usa React.createElement para construir el árbol de elementos
 * y extrae el texto y las props directamente.
 */

import React from 'react';

type RenderNode = {
  type: string | Function;
  props: Record<string, any>;
  children: RenderNode[];
  text?: string;
};

/**
 * Renderiza un elemento React a un árbol de nodos simples.
 * Soporta:
 * - Componentes funcionales
 * - Componentes nativos (View, Text, Pressable, etc.)
 * - Props y children
 * - Hooks básicos (useState, useMemo, useEffect no se ejecutan;
 *   los tests que necesitan hooks los mockean con vi.mock('react'))
 */
function renderElement(element: React.ReactElement | string | number | null | undefined | boolean): RenderNode[] {
  if (element == null || typeof element === 'boolean') return [];
  if (typeof element === 'string') return [{ type: 'TEXT', props: {}, children: [], text: element }];
  if (typeof element === 'number') return [{ type: 'TEXT', props: {}, children: [], text: String(element) }];
  if (Array.isArray(element)) return element.flatMap(renderElement);

  const { type, props } = element as { type: any; props: Record<string, any> };
  if (typeof type === 'string') {
    // Componente nativo (View, Text, etc.)
    const children = renderChildren(props.children);
    return [{ type, props, children }];
  }
  if (typeof type === 'function') {
    // Componente funcional
    try {
      const result = (type as (p: Record<string, any>) => any)(props);
      return renderElement(result as React.ReactElement);
    } catch {
      return [];
    }
  }
  if (type === React.Fragment) {
    return renderChildren(props.children);
  }
  // forwardRef, memo, etc. tienen una propiedad .type o .render
  if (type && typeof type === 'object') {
    const renderFn = type.render ?? type.type;
    if (typeof renderFn === 'function') {
      try {
        const result = renderFn(props, undefined);
        return renderElement(result as React.ReactElement);
      } catch {
        return [];
      }
    }
  }
  return [];
}

function renderChildren(children: React.ReactNode): RenderNode[] {
  if (children == null) return [];
  if (Array.isArray(children)) return children.flatMap(renderElement);
  return renderElement(children as React.ReactElement);
}

/**
 * Renderiza un componente y devuelve el árbol de nodos.
 */
export function render(component: React.ReactElement): { root: RenderNode[] } {
  const root = renderElement(component);
  return { root };
}

/**
 * Busca todo el texto en el árbol, concatenando texto adyacente.
 * React Native separa texto como {"⚔ "}{3} en nodos distintos,
 * así que los unimos para permitir patrones como /⚔.*3/.
 */
export function findAllText(nodes: RenderNode[]): string[] {
  const texts: string[] = [];
  function walk(node: RenderNode) {
    if (node.text != null) {
      // Acumular texto adyacente en el mismo padre
      const last = texts[texts.length - 1];
      if (last !== undefined && !last.endsWith('\n')) {
        texts[texts.length - 1] = last + node.text;
      } else {
        texts.push(node.text);
      }
    } else {
      // Nuevo contexto (nuevo componente), añadir separador
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

/**
 * Verifica que existe texto que coincide con el patrón.
 */
export function expectText(nodes: RenderNode[], pattern: string | RegExp): void {
  const texts = findAllText(nodes);
  const found = texts.find(t => (typeof pattern === 'string' ? t.includes(pattern) : pattern.test(t)));
  if (!found) {
    throw new Error(`Text not found: ${pattern}\nAvailable texts: ${texts.join(', ')}`);
  }
}

/**
 * Encuentra el primer nodo con onPress.
 */
export function findPressable(nodes: RenderNode[]): RenderNode | null {
  function walk(node: RenderNode): RenderNode | null {
    if (node.props?.onPress) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }
  for (const node of nodes) {
    const found = walk(node);
    if (found) return found;
  }
  return null;
}

/**
 * Simula un press en el primer elemento presionable.
 */
export function press(nodes: RenderNode[]): void {
  const pressable = findPressable(nodes);
  if (pressable?.props?.onPress) {
    pressable.props.onPress();
  } else {
    throw new Error('No pressable element found');
  }
}
