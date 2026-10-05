/**
 * cardImage — utilidad pura para obtener la ruta de imagen PNG de una carta.
 * (No es un hook de React: no usa estado ni efectos.)
 *
 * Cumple UI-PNG-001..011:
 * - Selección automática de variante (UI-PNG-009)
 * - Fallback a marcador de posición (UI-PNG-007)
 * - Estados de verificación (UI-PNG-006)
 */

import { getImagePath, hasFrontImage, type ImageVariant } from '@nt4h/catalog';
import { assetImageUri } from '../lib/assetImport';
import i18n from '../lib/i18n';

export interface CardImageResult {
  /** Ruta de la imagen, o undefined si no hay PNG disponible */
  path: string | undefined;
  /** true si hay un PNG frontal disponible y verificado */
  hasImage: boolean;
  /** true si se debe mostrar el marcador de placeholder */
  showPlaceholder: boolean;
}

export function cardImage(
  cardId: string,
  variant: ImageVariant = 'game',
): CardImageResult {
  const relPath = getImagePath(cardId, variant);
  const hasImage = hasFrontImage(cardId);

  // Los PNGs se sirven desde public/ → URI absoluta '/assets/cards/...'
  // (metro.config.js sirve public/ en dev; expo export la copia en prod)
  return {
    path: relPath ? `/${relPath}` : undefined,
    hasImage,
    showPlaceholder: !hasImage,
  };
}

// ============================================================================
// Imágenes del Taller (sourceImage 'asset:<id>')
//
// El Taller deja adjuntar una imagen propia (lib/assetImport). Los bytes se
// guardan en `nt4h.asset/<id>` y la referencia viaja en `sourceImage` de la
// CardDefinition. cardImage() solo conoce el registro oficial: esta capa
// delega en el cache síncrono de assetImport (assetImageUri).
// ============================================================================

/**
 * Resuelve `card.sourceImage` ('asset:<id>') a un data-URI renderizable.
 * Síncrono (sin hooks): usa el cache de lib/assetImport; el primer toque
 * dispara la carga en segundo plano y warmImageAssets() la precalienta.
 */
export function customCardImageUri(sourceImage: string | undefined): string | undefined {
  return assetImageUri(sourceImage);
}

/**
 * Construye la descripción accesible de una carta (UI-ACCESS-PNG-001).
 * Los lectores de pantalla no deben leer nombres de archivo (UI-ACCESS-PNG-002).
 */
export function buildAccessibleLabel(card: {
  name: string;
  type: string;
  heroClass?: string;
  printedAttack?: number;
  printedFortitude?: number;
  printedCost?: number;
}, expanded = true): string {
  const parts: string[] = [card.name];

  const classLabel = card.heroClass
    ? i18n.t(`create.classes.${card.heroClass}`, { defaultValue: '' })
    : '';
  if (card.heroClass && classLabel) {
    parts.push(i18n.t('cardui.a11y.ofClass', { class: classLabel }));
  } else {
    parts.push(i18n.t(`cardui.types.${card.type}`, { defaultValue: card.type }));
  }

  // srExpandedLabels: con el ajuste OFF la etiqueta se queda en
  // nombre + tipo/clase; ON añade ataque, fortaleza y coste.
  if (expanded) {
    if (card.printedAttack !== undefined && card.printedAttack > 0) {
      parts.push(i18n.t('cardui.a11y.attack', { n: card.printedAttack }));
    }
    if (card.printedFortitude !== undefined) {
      parts.push(i18n.t('cardui.a11y.fortitude', { n: card.printedFortitude }));
    }
    if (card.printedCost !== undefined) {
      parts.push(i18n.t('cardui.a11y.cost', { n: card.printedCost }));
    }
  }

  return parts.join('. ') + '.';
}
