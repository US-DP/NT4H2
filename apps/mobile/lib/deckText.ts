/**
 * deckText — importar un mazo desde una lista de texto plano.
 *
 * Formato aceptado por línea (como en Untap/Cockatrice):
 *   4 Espadazo
 *   4x Espadazo
 *   Espadazo x4
 *   Espadazo          (una copia)
 * Líneas vacías y comentarios (#, //) se ignoran.
 *
 * La coincidencia es insensible a mayúsculas, tildes y signos; solo se
 * aceptan cartas de tipo ABILITY (los mazos de héroe no llevan otra cosa).
 */

import type { CardDefinition } from '@nt4h/schema';

export interface ParsedDeckText {
  /** cardDefinitionId → copias */
  cards: Record<string, number>;
  /** Clases distintas encontradas entre las cartas reconocidas */
  classes: string[];
  /** Nombres de líneas que no corresponden a ninguna carta */
  unknown: string[];
  /** Total de copias reconocidas */
  total: number;
}

/** Normaliza un nombre de carta para comparar: sin tildes, minúsculas. */
export function normalizeCardName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Índice nombre-normalizado → carta (solo ABILITY). */
export function cardNameIndex(
  cards: Iterable<CardDefinition>,
): Map<string, CardDefinition> {
  const index = new Map<string, CardDefinition>();
  for (const card of cards) {
    if (card.type !== 'ABILITY') continue;
    const key = normalizeCardName(card.name);
    if (!index.has(key)) index.set(key, card);
  }
  return index;
}

const LINE_PATTERNS: RegExp[] = [
  /^(\d+)\s*[x×]?\s+(.+)$/i, // "4 Espadazo" / "4x Espadazo"
  /^(.+?)\s*[x×](\d+)$/i, // "Espadazo x4"
];

export function parseDeckText(
  text: string,
  index: Map<string, CardDefinition>,
): ParsedDeckText {
  const cards: Record<string, number> = {};
  const unknown: string[] = [];
  const classes = new Set<string>();
  let total = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    let copies = 1;
    let name = line;
    for (const pattern of LINE_PATTERNS) {
      const m = line.match(pattern);
      if (m) {
        if (/^\d+$/.test(m[1])) {
          copies = Math.min(parseInt(m[1], 10), 99);
          name = m[2].trim();
        } else {
          name = m[1].trim();
          copies = Math.min(parseInt(m[2], 10), 99);
        }
        break;
      }
    }

    const card = index.get(normalizeCardName(name));
    if (!card) {
      unknown.push(name);
      continue;
    }
    cards[card.id] = (cards[card.id] ?? 0) + copies;
    total += copies;
    if (card.heroClass) classes.add(card.heroClass);
  }

  return { cards, classes: [...classes], unknown, total };
}
