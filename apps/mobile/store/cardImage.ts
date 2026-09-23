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
  const path = getImagePath(cardId, variant);
  const hasImage = hasFrontImage(cardId);

  return {
    path,
    hasImage,
    showPlaceholder: !hasImage,
  };
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
}): string {
  const parts: string[] = [card.name];

  const typeLabels: Record<string, string> = {
    ABILITY: 'Habilidad',
    HERO: 'Héroe',
    HORDE: 'Hueste',
    WARLORD: 'Señor de la Guerra',
    MARKET: 'Objeto de Mercado',
    SCENARIO: 'Escenario',
  };

  const classLabels: Record<string, string> = {
    WARRIOR: 'Guerrero',
    EXPLORER: 'Explorador',
    ROGUE: 'Pícaro',
    MAGE: 'Mago',
  };

  const typeLabel = typeLabels[card.type] ?? card.type;
  if (card.heroClass && classLabels[card.heroClass]) {
    parts.push(`de ${classLabels[card.heroClass]}`);
  } else {
    parts.push(typeLabel);
  }

  if (card.printedAttack !== undefined && card.printedAttack > 0) {
    parts.push(`Ataque ${card.printedAttack}`);
  }
  if (card.printedFortitude !== undefined) {
    parts.push(`Fortaleza ${card.printedFortitude}`);
  }
  if (card.printedCost !== undefined) {
    parts.push(`Coste ${card.printedCost}`);
  }

  return parts.join('. ') + '.';
}
