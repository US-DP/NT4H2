/**
 * cardWorkshop/editorState.ts — estado de UI compartido del editor.
 *
 * El árbol de efectos se renderiza con componentes recursivos (EffectList
 * dentro de EffectList). Pasar este estado por props requeriría perforar
 * ~10 niveles, así que vive aquí a nivel de módulo, con un patrón de
 * "mutar + bump()" que repinta la lista que lo toca.
 *
 * Contenido:
 *  - collapsedNodes / diagErrorKeys / diagWarnKeys: Sets de claves de nodo.
 *  - editorUi: estado mutable no-Set (portapapeles, foco, modo básico,
 *    nombres de carta conocidos y payload de drag & drop).
 *  - useDebouncedValue: hook genérico de debounce para diagnósticos.
 */

import { useEffect, useState } from 'react';
import type { EffectNode } from './model';

/** Estado de colapso por clave de nodo (las keys son únicas en todo el
 *  árbol, así que un Set global sirve para "contraer todo"). */
export const collapsedNodes = new Set<number>();

/** Claves de nodo con diagnóstico (borde rojo = error, ámbar = warning). */
export const diagErrorKeys = new Set<number>();
export const diagWarnKeys = new Set<number>();

/** Payload de un arrastre en curso (drag & drop web, §3.2). */
export interface DndPayload {
  /** id de la instancia de EffectList origen. */
  list: number;
  index: number;
  node: EffectNode;
  /** Todas las keys del subárbol arrastrado (incluida la raíz): permite
   *  rechazar drops dentro del propio subárbol, que clonaban el nodo y
   *  borraban el original → desaparición silenciosa. */
  keys?: Set<number>;
}

/** Solicitud de borrado pendiente tras un drop entre listas distintas:
 *  la lista origen lo procesa en su próximo render. */
export interface DndPendingRemoval {
  list: number;
  index: number;
  key: number;
}

export const editorUi = {
  /** Portapapeles de nodos: copiar/pegar entre ramas y listas.
   *  Lista porque la selección múltiple puede copiar varios nodos a la vez. */
  clipboard: [] as EffectNode[],
  /** Nodo "enfocado" tras pulsar un problema del panel de diagnósticos. */
  focusedKey: null as number | null,
  /** Modo básico (§15.4): oculta tipos técnicos y controles avanzados. */
  basicMode: false,
  /** Nombres de carta conocidos (catálogo oficial + sets custom) para
   *  autocompletado de referencias. CreateCardTab lo actualiza por render. */
  knownCardNames: [] as string[],
  /** Arrastre en curso (null cuando no hay drag). */
  dnd: null as DndPayload | null,
  /** Borrado pendiente tras un drop entre listas distintas. */
  dndPendingRemoval: null as DndPendingRemoval | null,
};

/** Debounce genérico (§17): no recompilar/validar en cada pulsación. */
export function useDebouncedValue<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
