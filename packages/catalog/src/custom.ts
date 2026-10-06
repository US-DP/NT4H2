/**
 * @nt4h/catalog — Contenido personalizado (Taller).
 *
 * - validateContentSet: valida un JSON de conjunto (cartas + mazos).
 * - mergeCustomCards: fusiona cartas personalizadas en un CatalogLoadResult.
 *
 * Las cartas personalizadas se validan con CardDefinitionSchema y los limites
 * de validateCardEffects; nunca se permite pisar ids oficiales.
 */

import {
  ContentSetSchema,
  validateCardEffects,
  validateDeck,
  type CardDefinition,
  type ContentSet,
  type DeckDefinition,
} from '@nt4h/schema';
import type { CatalogLoadResult } from './loader.js';
import { normalizeEffects } from './loader.js';
import { validateDirectExecuteEffects, validateEffectSources } from './effects.js';

export interface CustomSetResult {
  ok: boolean;
  set?: ContentSet;
  errors: string[];
}

/**
 * Valida un JSON arbitrario como ContentSet:
 * estructura, cartas (schema + limites de efectos + fuentes permitidas)
 * y mazos (tamaño 15, cartas existentes).
 */
export function validateContentSet(
  raw: unknown,
  officialById: Map<string, CardDefinition>,
): CustomSetResult {
  // Alias snake_case → camelCase ANTES del safeParse (Zod strippea las
  // claves desconocidas: un JSON importado a mano con `on_match`…
  // perdería la rama sin error alguno).
  const rawCardsForNorm = (raw as { cards?: { effects?: unknown[] }[] } | null)?.cards;
  if (Array.isArray(rawCardsForNorm)) {
    for (const c of rawCardsForNorm) {
      if (Array.isArray(c?.effects)) normalizeEffects(c.effects);
    }
  }
  const parsed = ContentSetSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    };
  }
  const set = parsed.data;
  const errors: string[] = [];
  const setById = new Map<string, CardDefinition>();

  // El schema defaultea officialStatus=OFFICIAL: para detectar intentos de
  // marcar contenido del Taller como oficial hay que mirar el JSON crudo.
  const rawCards = Array.isArray((raw as { cards?: unknown[] }).cards)
    ? (raw as { cards: { id?: string; officialStatus?: string }[] }).cards
    : [];
  const explicitlyOfficial = new Set(
    rawCards
      .filter(c => c.officialStatus === 'OFFICIAL' || c.officialStatus === 'OFFICIAL_PROMO')
      .map(c => c.id),
  );

  for (const card of set.cards) {
    if (officialById.has(card.id)) {
      errors.push(`${card.id}: el id colisiona con una carta oficial (prohibido)`);
      continue;
    }
    if (setById.has(card.id)) {
      errors.push(`${card.id}: id duplicado dentro del conjunto`);
      continue;
    }
    if (explicitlyOfficial.has(card.id)) {
      errors.push(`${card.id}: el contenido del Taller no puede marcarse como oficial`);
    }
    errors.push(...validateCardEffects(card.effects).map(e => `${card.id}: ${e}`));
    errors.push(...validateEffectSources(card.type, card.effects).map(e => `${card.id}: ${e}`));
    // CUSTOM_SCENARIO valida como efecto permitido en SCENARIO, pero el
    // motor despacha escenarios por definitionId y el `handler` es dato
    // muerto para contenido custom — sería un no-op silencioso en partida.
    for (const eff of card.effects) {
      if (eff.type === 'CUSTOM_SCENARIO') {
        errors.push(`${card.id}: CUSTOM_SCENARIO solo existe en escenarios oficiales (el handler no es interpretable por el Taller)`);
      }
    }
    if (card.heroAbility) {
      errors.push(...validateCardEffects(card.heroAbility.effects).map(e => `${card.id}.heroAbility: ${e}`));
      // La pericia de héroe corre directa contra el registry: los tipos
      // que el resolver solo intercepta en raíz de carta no funcionan.
      errors.push(...validateDirectExecuteEffects(card.heroAbility.effects).map(e => `${card.id}.heroAbility: ${e}`));
    }
    if (card.peritia) {
      // La pericia declarativa pasa por los mismos límites que los
      // efectos normales — sin esto bypassaría los límites del Taller.
      errors.push(...validateCardEffects(card.peritia.effects).map(e => `${card.id}.peritia: ${e}`));
      // El resolver solo ejecuta un tipo de efecto por trigger; el resto
      // se descartaría en silencio en partida.
      const SUPPORTED_BY_TRIGGER: Record<string, string[]> = {
        DAMAGE_DEALT: ['LOSE_CARDS'],
        CARD_PLAYED: ['RECOVER_CARDS'],
      };
      if (card.peritia.trigger === 'CONTINUOUS') {
        errors.push(`${card.id}.peritia: trigger CONTINUOUS no tiene ejecución genérica (las auras continuas solo existen hardcodeadas)`);
      } else {
        const supported = SUPPORTED_BY_TRIGGER[card.peritia.trigger] ?? [];
        const unsupported = card.peritia.effects.filter(e => !supported.includes(e.type));
        for (const e of unsupported) {
          errors.push(`${card.id}.peritia: ${e.type} no se ejecuta con trigger ${card.peritia.trigger} (soportados: ${supported.join(', ')})`);
        }
      }
      // La única gramática de condición que el motor interpreta.
      if (card.peritia.condition && !/^printedAttack\s*==\s*\d+$/.test(card.peritia.condition)) {
        errors.push(`${card.id}.peritia: condition '${card.peritia.condition}' no usa la gramática soportada ('printedAttack == N')`);
      }
    }
    setById.set(card.id, card);
  }

  // Validar mazos contra cartas oficiales + del propio conjunto
  const mergedById = new Map([...officialById, ...setById]);
  const deckIds = new Set<string>();
  for (const deck of set.decks) {
    if (deckIds.has(deck.id)) errors.push(`${deck.id}: id de mazo duplicado`);
    deckIds.add(deck.id);
    // Reglas completas de mazo (tamaño, copias máximas, clases, multiclase…):
    // antes solo se comprobaba suma/ids, así que el runner aceptaba mazos
    // que la UI luego rechazaba (asimetría runner↔UI).
    errors.push(...validateDeck(deck, mergedById).errors.map(e => `${deck.id}: ${e}`));
  }

  return { ok: errors.length === 0, set, errors };
}

/**
 * Fusiona cartas de conjuntos personalizados en un CatalogLoadResult,
 * devolviendo un objeto nuevo (el catálogo oficial queda intacto).
 */
export function mergeCustomCards(
  catalog: CatalogLoadResult,
  sets: ContentSet[],
): CatalogLoadResult {
  const byId = new Map(catalog.byId);
  const byClass = new Map(catalog.byClass);
  const byType = new Map(catalog.byType);
  const errors = [...catalog.errors];
  const cards = [...catalog.cards];
  let totalCopies = catalog.totalCopies;

  for (const set of sets) {
    for (const card of set.cards) {
      // Un set validado nunca contiene officialStatus explicito OFFICIAL;
      // si el default del schema dejo 'OFFICIAL', marcar como CUSTOM.
      const stamped = {
        ...card,
        setId: set.id,
        officialStatus: (card.officialStatus === 'OFFICIAL' ? 'CUSTOM' : card.officialStatus) as CardDefinition['officialStatus'],
      };
      if (byId.has(stamped.id)) {
        errors.push({ setId: set.id, cardId: stamped.id, error: 'duplicate card id' });
        continue;
      }
      byId.set(stamped.id, stamped);
      cards.push(stamped);
      // Copiar los arrays al indexar: `new Map(catalog.byX)` comparte los
      // arrays internos con el catálogo original — un push directo
      // contaminaba los índices globales con cartas del Taller de otra
      // sala (y acumulaba duplicados a cada merge).
      if (stamped.heroClass && stamped.type !== 'HERO') {
        byClass.set(stamped.heroClass, [...(byClass.get(stamped.heroClass) ?? []), stamped]);
      }
      byType.set(stamped.type, [...(byType.get(stamped.type) ?? []), stamped]);
      totalCopies += stamped.copies;
    }
  }
  return { cards, byId, byClass, byType, errors, totalCards: cards.length, totalCopies };
}

/** Convierte un DeckDefinition validado en el snapshot que usa GameConfig. */
export function deckToConfigEntry(deck: DeckDefinition): { id: string; cardDefinitionIds: string[] } {
  const ids: string[] = [];
  for (const e of deck.cardEntries) for (let i = 0; i < e.copies; i++) ids.push(e.cardDefinitionId);
  return { id: deck.id, cardDefinitionIds: ids };
}
