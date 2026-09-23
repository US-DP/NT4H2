/**
 * @nt4h/catalog — Catálogo de imágenes PNG de cartas.
 *
 * Carga el mapeo cardId → rutas de imagen desde images.json.
 * Proporciona funciones para obtener la ruta de imagen adecuada
 * según la variante (front, back, thumbnail, game, preview).
 *
 * Cumple UI-PNG-001..011: separación imagen/lógica, selección de variante,
 * fallback textual, estados de verificación.
 */

import imagesData from '../data/official/images.json' with { type: 'json' };

export type ImageStatus =
  | 'PENDING_EXTRACTION'
  | 'EXTRACTED'
  | 'CROP_REVIEW_REQUIRED'
  | 'CROP_VERIFIED'
  | 'FRONT_BACK_MAPPING_REQUIRED'
  | 'FRONT_BACK_MAPPING_VERIFIED'
  | 'OPTIMIZED'
  | 'READY_FOR_GAME'
  | 'REJECTED';

export type ImageVariant = 'front' | 'back' | 'thumbnail' | 'game' | 'preview' | 'mask';

export interface CardImages {
  front?: string;
  back?: string;
  thumbnail?: string;
  game?: string;
  preview?: string;
  mask?: string;
  status: ImageStatus;
  hash?: string;
  pdfPage?: number;
  pdfRow?: number;
  pdfCol?: number;
}

type ImagesJson = Record<string, Omit<CardImages, 'status'> & { status?: ImageStatus }>;

const images = imagesData as unknown as ImagesJson;

/** Obtiene la info de imágenes de una carta por su ID. */
export function getCardImages(cardId: string): CardImages | undefined {
  const entry = images[cardId];
  if (!entry) return undefined;
  return {
    front: entry.front,
    back: entry.back,
    thumbnail: entry.thumbnail,
    game: entry.game,
    preview: entry.preview,
    mask: entry.mask,
    status: entry.status ?? 'PENDING_EXTRACTION',
    hash: entry.hash,
    pdfPage: entry.pdfPage,
    pdfRow: entry.pdfRow,
    pdfCol: entry.pdfCol,
  };
}

/**
 * Obtiene la ruta de imagen para una variante específica.
 * Si la variante solicitada no existe, hace fallback:
 *   game → front
 *   preview → front
 *   thumbnail → front
 *   back → undefined (no fallback a front)
 *
 * UI-PNG-009: selección automática de resolución.
 */
export function getImagePath(cardId: string, variant: ImageVariant = 'front'): string | undefined {
  const imgs = getCardImages(cardId);
  if (!imgs) return undefined;

  const path = imgs[variant];
  if (path) return path;

  // Fallbacks
  if (variant === 'game' || variant === 'preview' || variant === 'thumbnail') {
    return imgs.front;
  }
  return undefined;
}

/** ¿Tiene la carta un PNG frontal disponible? */
export function hasFrontImage(cardId: string): boolean {
  const imgs = getCardImages(cardId);
  return !!imgs?.front && imgs.status !== 'REJECTED' && imgs.status !== 'PENDING_EXTRACTION';
}

/** ¿Tiene la carta un PNG trasero disponible? */
export function hasBackImage(cardId: string): boolean {
  const imgs = getCardImages(cardId);
  return !!imgs?.back;
}

/** ¿La imagen está lista para usar en partida? (UI-PNG-006, UI-VALID-PNG-004) */
export function isReadyForGame(cardId: string): boolean {
  const imgs = getCardImages(cardId);
  return imgs?.status === 'READY_FOR_GAME' && !!imgs.front;
}

/** Número total de cartas con imagen en el catálogo. */
export function countCardsWithImages(): number {
  return Object.keys(images).length;
}

/** Número de cartas listas para partida. */
export function countReadyForGame(): number {
  return Object.values(images).filter(
    (img) => img.status === 'READY_FOR_GAME' && !!img.front,
  ).length;
}

/** Todas las entradas de imágenes. */
export function getAllImages(): Record<string, CardImages> {
  const result: Record<string, CardImages> = {};
  for (const [id, img] of Object.entries(images)) {
    result[id] = {
      front: img.front,
      back: img.back,
      thumbnail: img.thumbnail,
      game: img.game,
      preview: img.preview,
      mask: img.mask,
      status: img.status ?? 'PENDING_EXTRACTION',
      hash: img.hash,
      pdfPage: img.pdfPage,
      pdfRow: img.pdfRow,
      pdfCol: img.pdfCol,
    };
  }
  return result;
}
