/**
 * @nt4h/schema — Validadores de contenido personalizado (Taller).
 *
 * - validateCardEffects: limites anti-recursion/patologicos sobre la lista
 *   de efectos de una carta (profundidad, presupuesto de nodos).
 * - validateDeck: reglas de construccion de mazo (15 cartas, clases,
 *   copias disponibles, multiclase).
 * - resolveDeckEntries: expande cardEntries a una lista de definitionIds.
 */

import type { CardDefinition, CardEffect, DeckDefinition } from './card.js';

// ============================================================================
// Limites de complejidad (anti ciclos / presupuesto de resolucion)
// ============================================================================

/** Profundidad maxima de anidado de efectos (CONDITIONAL / ON_* / PLACE_PERSISTENT). */
export const MAX_EFFECT_DEPTH = 6;
/** Presupuesto maximo de nodos de efecto por carta (suma de toda la lista). */
export const MAX_EFFECT_NODES = 64;
/** Maximo de efectos de nivel superior por carta (sin limite artificial bajo). */
export const MAX_TOP_LEVEL_EFFECTS = 32;

interface NestedCarrier {
  effects?: CardEffect[];
  then?: CardEffect[];
  else?: CardEffect[];
  onMatch?: CardEffect[];
  onMismatch?: CardEffect[];
  on_match?: CardEffect[];
  on_mismatch?: CardEffect[];
  onFailure?: CardEffect[];
  options?: { effects?: CardEffect[] }[];
}

function collectNested(eff: CardEffect): CardEffect[] {
  const c = eff as CardEffect & NestedCarrier;
  const out: CardEffect[] = [];
  for (const key of [
    'effects', 'then', 'else',
    'onMatch', 'onMismatch', 'on_match', 'on_mismatch',
    'onFailure',
  ] as const) {
    const list = c[key];
    if (Array.isArray(list)) out.push(...list);
  }
  // CHOOSE_ONE: las ramas tambien son listas de efectos anidados
  if (Array.isArray(c.options)) {
    for (const opt of c.options) {
      if (Array.isArray(opt.effects)) out.push(...opt.effects);
    }
  }
  return out;
}

/**
 * Valida la lista ordenada de efectos de una carta:
 * - como mucho MAX_TOP_LEVEL_EFFECTS efectos de primer nivel
 * - profundidad de anidado <= MAX_EFFECT_DEPTH
 * - presupuesto total de nodos <= MAX_EFFECT_NODES
 * Devuelve la lista de errores (vacia = valido).
 */
export function validateCardEffects(effects: CardEffect[]): string[] {
  const errors: string[] = [];
  if (effects.length > MAX_TOP_LEVEL_EFFECTS) {
    errors.push(`Demasiados efectos (${effects.length} > ${MAX_TOP_LEVEL_EFFECTS})`);
  }
  let nodes = 0;
  const stack: { eff: CardEffect; depth: number }[] =
    effects.map(eff => ({ eff, depth: 1 }));
  while (stack.length > 0) {
    const { eff, depth } = stack.pop()!;
    nodes++;
    if (nodes > MAX_EFFECT_NODES) {
      errors.push(`Carta demasiado compleja (>${MAX_EFFECT_NODES} nodos de efecto)`);
      return errors;
    }
    if (depth > MAX_EFFECT_DEPTH) {
      errors.push(`Anidado de efectos demasiado profundo (>${MAX_EFFECT_DEPTH})`);
      return errors;
    }
    // Reglas especificas de nodos de control (Taller §9.7, §9.11, §20)
    if (eff.type === 'REPEAT') {
      const r = eff as { type: 'REPEAT'; max?: number; effects?: CardEffect[] };
      if (typeof r.max !== 'number' || r.max < 1) {
        errors.push('REPEAT sin limite maximo verificable (max >= 1 obligatorio)');
      }
      if (!Array.isArray(r.effects) || r.effects.length === 0) {
        errors.push('REPEAT sin efectos internos');
      }
    }
    if (eff.type === 'CHOOSE_ONE') {
      const ch = eff as { type: 'CHOOSE_ONE'; options?: { effects?: CardEffect[] }[] };
      if (!Array.isArray(ch.options) || ch.options.length < 2) {
        errors.push('CHOOSE_ONE necesita al menos 2 opciones');
      }
      // Las elecciones encadenadas (CHOOSE_ONE dentro de CHOOSE_ONE) se
      // rechazan: el jugador no puede resolver dos elecciones anidadas
      // en la misma resolucion.
      for (const opt of ch.options ?? []) {
        if (opt.effects?.some(e => e.type === 'CHOOSE_ONE')) {
          errors.push('CHOOSE_ONE no puede contener otra eleccion en sus ramas');
          break;
        }
      }
    }
    for (const sub of collectNested(eff)) stack.push({ eff: sub, depth: depth + 1 });
  }

  // Patrones patologicos de nivel de carta (Taller §20)
  const allNodes = (() => {
    const acc: CardEffect[] = [];
    const st = [...effects];
    while (st.length) { const e = st.pop()!; acc.push(e); st.push(...collectNested(e)); }
    return acc;
  })();
  // Recuperarse y jugarse a si misma en la misma resolucion = bucle potencial
  const selfRecover = allNodes.some(e => e.type === 'RECOVER_THIS_CARD');
  const selfReplay = allNodes.some(e => e.type === 'PLAY_IMMEDIATELY');
  if (selfRecover && selfReplay) {
    errors.push('La carta se recupera y se juega a si misma (bucle potencial)');
  }
  // Repeticion que contiene otra repeticion: combinatorio, revisar
  const repeats = allNodes.filter(e => e.type === 'REPEAT');
  if (repeats.length > 3) {
    errors.push(`Demasiadas repeticiones (${repeats.length}): complejidad no verificable`);
  }
  return errors;
}

// ============================================================================
// Validacion de mazos
// ============================================================================

export interface DeckValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Valida un DeckDefinition contra las reglas oficiales:
 * - exactamente deckSize cartas (15 en el juego base)
 * - todas las cartas existen y son de tipo ABILITY
 * - la clase de cada carta esta en heroClassIds
 * - no se piden mas copias de las definidas en la carta
 * - multiclase (2 clases): minimo 5 cartas de cada clase
 */
export function validateDeck(
  deck: DeckDefinition,
  byId: Map<string, CardDefinition>,
): DeckValidation {
  const errors: string[] = [];
  const classes = new Set(deck.heroClassIds);
  const perClass = new Map<string, number>();
  let total = 0;
  // Agregar copias por definición: dos entradas con el mismo
  // cardDefinitionId (copies ≤ max cada una) no pueden superar el límite.
  const copiesByDef = new Map<string, number>();

  for (const entry of deck.cardEntries) {
    const def = byId.get(entry.cardDefinitionId);
    if (!def) {
      errors.push(`Carta desconocida: ${entry.cardDefinitionId}`);
      continue;
    }
    if (def.type !== 'ABILITY') {
      errors.push(`${def.name} no es una carta de Habilidad`);
      continue;
    }
    if (def.heroClass && !classes.has(def.heroClass)) {
      errors.push(`${def.name} es de clase ${def.heroClass}, incompatible con el mazo`);
    }
    const totalCopies = (copiesByDef.get(entry.cardDefinitionId) ?? 0) + entry.copies;
    copiesByDef.set(entry.cardDefinitionId, totalCopies);
    if (totalCopies > def.copies) {
      errors.push(`${def.name}: se piden ${totalCopies} copias (max ${def.copies})`);
    }
    total += entry.copies;
    const cls = def.heroClass ?? 'UNKNOWN';
    perClass.set(cls, (perClass.get(cls) ?? 0) + entry.copies);
  }

  if (total !== deck.deckSize) {
    errors.push(`El mazo tiene ${total} cartas (deben ser ${deck.deckSize})`);
  }
  if (classes.size === 2) {
    for (const cls of classes) {
      if ((perClass.get(cls) ?? 0) < 5) {
        errors.push(`Multiclase: minimo 5 cartas de ${cls}`);
      }
    }
  } else if (classes.size === 1) {
    const cls = [...classes][0];
    // En monoclase todas las cartas deben ser de esa clase (ya cubierto arriba),
    // pero si el mazo declara clase y ninguna carta coincide, es un error claro.
    if ((perClass.get(cls) ?? 0) !== total) {
      errors.push(`El mazo declara clase ${cls} pero contiene cartas de otras clases`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Expande cardEntries a la lista plana de definitionIds (copias incluidas). */
export function resolveDeckEntries(deck: DeckDefinition): string[] {
  const ids: string[] = [];
  for (const entry of deck.cardEntries) {
    for (let i = 0; i < entry.copies; i++) ids.push(entry.cardDefinitionId);
  }
  return ids;
}
