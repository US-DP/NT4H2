/** Versión del contenido del catálogo oficial (cards + mappings). */
export const CATALOG_VERSION = '0.1.0';

export { loadCatalog, getCard, getClassCards } from './loader.js';
export type { CatalogLoadResult } from './loader.js';
export {
  getCardImages,
  getImagePath,
  hasFrontImage,
  hasBackImage,
  isReadyForGame,
  countCardsWithImages,
  countReadyForGame,
  getAllImages,
} from './images.js';
export type { CardImages, ImageStatus, ImageVariant } from './images.js';
export { EFFECT_REGISTRY, getEffectMeta, validateEffectSources } from './effects.js';
export type { EffectMeta, EffectCategory } from './effects.js';
export { validateContentSet, mergeCustomCards, deckToConfigEntry } from './custom.js';
export type { CustomSetResult } from './custom.js';
