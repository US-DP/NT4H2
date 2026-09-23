/**
 * @nt4h/catalog — Carga y validacion del catalogo de cartas.
 *
 * Carga todos los archivos JSON de data/official/, los valida con
 * CardDefinitionSchema (Zod), y construye indices por id, nombre y clase.
 */

import { CardDefinitionSchema, type CardDefinition } from '@nt4h/schema';

// Importar datos JSON (resolveJsonModule esta activado)
import explorerData from '../data/official/abilities/explorer.json' with { type: 'json' };
import warriorData from '../data/official/abilities/warrior.json' with { type: 'json' };
import mageData from '../data/official/abilities/mage.json' with { type: 'json' };
import rogueData from '../data/official/abilities/rogue.json' with { type: 'json' };
import hordeData from '../data/official/horde.json' with { type: 'json' };
import warlordsData from '../data/official/warlords.json' with { type: 'json' };
import marketData from '../data/official/market.json' with { type: 'json' };
import heroesData from '../data/official/heroes.json' with { type: 'json' };
import scenariosData from '../data/official/scenarios.json' with { type: 'json' };

interface SetFile {
  setId: string;
  cards: unknown[];
}

const SET_FILES: SetFile[] = [
  explorerData as unknown as SetFile,
  warriorData as unknown as SetFile,
  mageData as unknown as SetFile,
  rogueData as unknown as SetFile,
  hordeData as unknown as SetFile,
  warlordsData as unknown as SetFile,
  marketData as unknown as SetFile,
  heroesData as unknown as SetFile,
  scenariosData as unknown as SetFile,
];

export interface CatalogLoadResult {
  cards: CardDefinition[];
  byId: Map<string, CardDefinition>;
  byName: Map<string, CardDefinition[]>;
  byClass: Map<string, CardDefinition[]>;
  byType: Map<string, CardDefinition[]>;
  errors: { setId: string; cardId: string; error: string }[];
  totalCards: number;
  totalCopies: number;
}

export function loadCatalog(): CatalogLoadResult {
  const cards: CardDefinition[] = [];
  const errors: { setId: string; cardId: string; error: string }[] = [];

  for (const setFile of SET_FILES) {
    for (const rawCard of setFile.cards) {
      const result = CardDefinitionSchema.safeParse(rawCard as Record<string, unknown>);
      if (result.success) {
        // Normalizar alias snake_case → camelCase en los efectos
        const card = result.data;
        normalizeEffects(card.effects);
        cards.push(card);
      } else {
        errors.push({
          setId: setFile.setId,
          cardId: (rawCard as { id?: string }).id ?? 'unknown',
          error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
      }
    }
  }

  // Construir indices
  const byId = new Map<string, CardDefinition>();
  const byName = new Map<string, CardDefinition[]>();
  const byClass = new Map<string, CardDefinition[]>();
  const byType = new Map<string, CardDefinition[]>();

  let totalCopies = 0;

  for (const card of cards) {
    // Colisión de ids: un duplicado sobrescribiría en silencio al anterior —
    // registrarlo como error de catálogo en lugar de aceptarlo
    if (byId.has(card.id)) {
      errors.push({
        setId: 'byId',
        cardId: card.id,
        error: `duplicate card id (also defined in another set)`,
      });
      continue;
    }
    byId.set(card.id, card);

    const nameList = byName.get(card.name) ?? [];
    nameList.push(card);
    byName.set(card.name, nameList);

    if (card.heroClass) {
      const classList = byClass.get(card.heroClass) ?? [];
      classList.push(card);
      byClass.set(card.heroClass, classList);
    }

    const typeList = byType.get(card.type) ?? [];
    typeList.push(card);
    byType.set(card.type, typeList);

    totalCopies += card.copies;
  }

  return {
    cards,
    byId,
    byName,
    byClass,
    byType,
    errors,
    totalCards: cards.length,
    totalCopies,
  };
}

/** Obtener una carta por ID, lanzando error si no existe */
export function getCard(catalog: CatalogLoadResult, id: string): CardDefinition {
  const card = catalog.byId.get(id);
  if (!card) throw new Error(`Card not found: ${id}`);
  return card;
}

/** Obtener todas las cartas de una clase */
export function getClassCards(catalog: CatalogLoadResult, heroClass: string): CardDefinition[] {
  return catalog.byClass.get(heroClass) ?? [];
}

/**
 * Normalizar alias snake_case → camelCase en los efectos de una carta.
 * Mutación in-place sobre los efectos parseados.
 */
function normalizeEffects(effects: any[]): void {
  for (const eff of effects) {
    if (!eff || typeof eff !== 'object') continue;
    // Coalescer alias snake_case
    if (eff.type === 'DRAW_AND_CHECK') {
      if (eff.expected_name && !eff.expectedName) eff.expectedName = eff.expected_name;
      if (eff.on_match && !eff.onMatch) eff.onMatch = eff.on_match;
      if (eff.on_mismatch && !eff.onMismatch) eff.onMismatch = eff.on_mismatch;
      // Limpiar alias
      delete eff.expected_name;
      delete eff.on_match;
      delete eff.on_mismatch;
      // Recursión en sub-efectos
      if (eff.onMatch) normalizeEffects(eff.onMatch);
      if (eff.onMismatch) normalizeEffects(eff.onMismatch);
    } else if (eff.type === 'SWAP_ENEMY') {
      if (eff.new_from && !eff.newFrom) eff.newFrom = eff.new_from;
      delete eff.new_from;
    } else if (eff.type === 'STEAL_COINS_MULTIPLE') {
      if (eff.max_total && !eff.maxTotal) eff.maxTotal = eff.max_total;
      if (eff.max_per_hero && !eff.maxPerHero) eff.maxPerHero = eff.max_per_hero;
      delete eff.max_total;
      delete eff.max_per_hero;
    } else if (eff.type === 'PLAY_RANDOM_CARD_FROM_OTHER_HERO') {
      if (eff.cost_glory && !eff.costGlory) eff.costGlory = eff.cost_glory;
      delete eff.cost_glory;
    }
    // Recursión en effects anidados (ON_DEFEAT, ON_ENEMY_DEFEATED, etc.)
    if (eff.effects && Array.isArray(eff.effects)) normalizeEffects(eff.effects);
    // Recursión en then/else de CONDITIONAL
    if (eff.then && Array.isArray(eff.then)) normalizeEffects(eff.then);
    if (eff.else && Array.isArray(eff.else)) normalizeEffects(eff.else);
  }
}
