/**
 * Nivel 9-PNG: Pruebas del sistema de imágenes PNG de cartas.
 *
 * Verifica los requisitos UI-PNG-001..011, UI-GAME-001..008, UI-PNG-020..022,
 * UI-ACCESS-PNG-001..006, UI-PNG-007 (placeholder).
 *
 * Pruebas:
 * - Catálogo de imágenes carga correctamente.
 * - Cada carta original tiene PNG frontal.
 * - Las Huestes tienen PNG trasero (recompensa).
 * - Selección de variante (front, back, thumbnail, game).
 * - Fallback de variante (game → front).
 * - Placeholder cuando no hay PNG.
 * - CardView renderiza PNG o placeholder.
 * - Capas dinámicas (selección, objetivo válido, bloqueado).
 * - Descripción accesible estructurada.
 * - Estados de verificación.
 */

import { describe, it, expect } from 'vitest';
import { render, expectText, findAllText } from './renderer';

// Importar funciones del catálogo de imágenes
import {
  getCardImages,
  getImagePath,
  hasFrontImage,
  hasBackImage,
  isReadyForGame,
  countCardsWithImages,
  countReadyForGame,
} from '@nt4h/catalog';

// Importar CardView y hook
import { CardView } from '../components/CardView';
import { buildAccessibleLabel } from '../store/cardImage';

import type { CardDefinition } from '@nt4h/schema';

// ============================================================================
// Helpers
// ============================================================================

function makeCardDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id: 'test-card-no-png',
    name: 'Test Card',
    type: 'ABILITY',
    copies: 1,
    effects: [],
    verificationStatus: 'OCR',
    ...overrides,
  } as CardDefinition;
}

// IDs de cartas reales del catálogo
const EXPLORER_RAPID_SHOT = 'explorer.rapid-shot';
const EXPLORER_PRECISE_SHOT = 'explorer.precise-shot';
const HORDE_001 = 'horde.001';
const HORDE_027 = 'horde.027';
const WARLORD_GURDRUG = 'warlord.gurdrug';
const MARKET_DAGGER = 'market.elven-dagger';
const SCENARIO_BATTLEFIELD = 'scenario.battlefield';

// ============================================================================
// UI-PNG-001..005: Principio fundamental PNG
// ============================================================================

describe('PNG — UI-PNG-001 (uso obligatorio)', () => {
  it('el catálogo de imágenes carga con cartas', () => {
    expect(countCardsWithImages()).toBeGreaterThan(0);
  });

  it('cartas de habilidad tienen PNG frontal', () => {
    expect(hasFrontImage(EXPLORER_RAPID_SHOT)).toBe(true);
    expect(hasFrontImage(EXPLORER_PRECISE_SHOT)).toBe(true);
  });

  it('huestes tienen PNG frontal', () => {
    expect(hasFrontImage(HORDE_001)).toBe(true);
    expect(hasFrontImage(HORDE_027)).toBe(true);
  });

  it('señores de la guerra tienen PNG frontal', () => {
    expect(hasFrontImage(WARLORD_GURDRUG)).toBe(true);
  });

  it('mercado tiene PNG frontal', () => {
    expect(hasFrontImage(MARKET_DAGGER)).toBe(true);
  });

  it('escenarios tienen PNG frontal', () => {
    expect(hasFrontImage(SCENARIO_BATTLEFIELD)).toBe(true);
  });
});

// ============================================================================
// UI-PNG-002: Separación imagen/lógica
// ============================================================================

describe('PNG — UI-PNG-002 (separación imagen/lógica)', () => {
  it('getImagePath no lee la imagen para resolver lógica', () => {
    // La función solo devuelve una ruta, no interpreta el PNG
    const path = getImagePath(EXPLORER_RAPID_SHOT, 'front');
    expect(path).toBeDefined();
    expect(typeof path).toBe('string');
  });

  it('una carta sin imagen sigue teniendo definición lógica', () => {
    const imgs = getCardImages('nonexistent.card');
    expect(imgs).toBeUndefined();
    // La definición lógica sigue existiendo en el catálogo independente
  });
});

// ============================================================================
// UI-PNG-003: Correspondencia obligatoria
// ============================================================================

describe('PNG — UI-PNG-003 (correspondencia)', () => {
  it('cada entrada tiene front definido', () => {
    const imgs = getCardImages(EXPLORER_RAPID_SHOT);
    expect(imgs).toBeDefined();
    expect(imgs?.front).toBeDefined();
    expect(imgs?.front).toContain('.png');
  });
});

// ============================================================================
// UI-PNG-006..008: Estados y placeholder
// ============================================================================

describe('PNG — UI-PNG-006..008 (estados)', () => {
  it('cartas oficiales están READY_FOR_GAME', () => {
    expect(isReadyForGame(EXPLORER_RAPID_SHOT)).toBe(true);
  });

  it('carta inexistente no está ready', () => {
    expect(isReadyForGame('nonexistent.card')).toBe(false);
  });

  it('countReadyForGame > 0', () => {
    expect(countReadyForGame()).toBeGreaterThan(0);
  });
});

// ============================================================================
// UI-PNG-009: Selección automática de resolución
// ============================================================================

describe('PNG — UI-PNG-009 (selección de variante)', () => {
  it('front devuelve el frontal', () => {
    const path = getImagePath(EXPLORER_RAPID_SHOT, 'front');
    expect(path).toBeDefined();
    expect(path).toContain('front');
  });

  it('game hace fallback a front si no existe game específica', () => {
    const path = getImagePath(EXPLORER_RAPID_SHOT, 'game');
    expect(path).toBeDefined();
  });

  it('thumbnail hace fallback a front', () => {
    const path = getImagePath(EXPLORER_RAPID_SHOT, 'thumbnail');
    expect(path).toBeDefined();
  });

  it('preview hace fallback a front', () => {
    const path = getImagePath(EXPLORER_RAPID_SHOT, 'preview');
    expect(path).toBeDefined();
  });

  it('back devuelve undefined si no hay trasero (habilidades)', () => {
    const path = getImagePath(EXPLORER_RAPID_SHOT, 'back');
    // Las habilidades no tienen trasero específico
    expect(path).toBeUndefined();
  });
});

// ============================================================================
// UI-GAME-003: Reversos (Huestes)
// ============================================================================

describe('PNG — UI-GAME-003 (reversos de Huestes)', () => {
  it('huestes tienen PNG trasero', () => {
    expect(hasBackImage(HORDE_001)).toBe(true);
    expect(hasBackImage(HORDE_027)).toBe(true);
  });

  it('habilidades no tienen PNG trasero específico', () => {
    expect(hasBackImage(EXPLORER_RAPID_SHOT)).toBe(false);
  });

  it('back de hueste devuelve la ruta del trasero', () => {
    const path = getImagePath(HORDE_001, 'back');
    expect(path).toBeDefined();
    expect(path).toContain('back');
  });
});

// ============================================================================
// UI-PNG-007..008: Placeholder en CardView
// ============================================================================

describe('PNG — UI-PNG-007..008 (placeholder)', () => {
  it('CardView muestra placeholder si no hay PNG', () => {
    const card = makeCardDef({ id: 'nonexistent.card', name: 'Carta Sin Imagen' });
    const { root } = render(<CardView card={card} />);
    const texts = findAllText(root);
    expect(texts.some(t => t.includes('Imagen no disponible'))).toBe(true);
    expect(texts.some(t => t.includes('PNG pendiente'))).toBe(true);
  });

  it('CardView muestra el nombre en el placeholder', () => {
    const card = makeCardDef({ id: 'nonexistent.card', name: 'Mi Carta Test' });
    const { root } = render(<CardView card={card} />);
    expectText(root, 'Mi Carta Test');
  });

  it('CardView con PNG real no muestra placeholder', () => {
    const card = makeCardDef({ id: EXPLORER_RAPID_SHOT, name: 'Disparo Rápido' });
    const { root } = render(<CardView card={card} />);
    const texts = findAllText(root);
    // No debe mostrar "Imagen no disponible"
    expect(texts.some(t => t.includes('Imagen no disponible'))).toBe(false);
  });
});

// ============================================================================
// UI-PNG-020..022: Capas dinámicas
// ============================================================================

describe('PNG — UI-PNG-020..022 (capas dinámicas)', () => {
  it('CardView muestra borde de selección (selected)', () => {
    const card = makeCardDef({ id: EXPLORER_RAPID_SHOT, name: 'Test' });
    const { root } = render(<CardView card={card} selected />);
    // El estilo del Pressable debe tener borderColor amarillo
    function findBorderColor(nodes: any[], color: string): boolean {
      for (const n of nodes) {
        const style = n.props?.style;
        if (Array.isArray(style)) {
          for (const s of style) {
            if (s && typeof s === 'object' && s.borderColor === color) return true;
          }
        } else if (style && typeof style === 'object' && style.borderColor === color) {
          return true;
        }
        if (findBorderColor(n.children, color)) return true;
      }
      return false;
    }
    expect(findBorderColor(root, '#f1c40f')).toBe(true);
  });

  it('CardView muestra borde de objetivo válido (validTarget)', () => {
    const card = makeCardDef({ id: EXPLORER_RAPID_SHOT, name: 'Test' });
    const { root } = render(<CardView card={card} validTarget />);
    function findBorderColor(nodes: any[], color: string): boolean {
      for (const n of nodes) {
        const style = n.props?.style;
        if (Array.isArray(style)) {
          for (const s of style) {
            if (s && typeof s === 'object' && s.borderColor === color) return true;
          }
        } else if (style && typeof style === 'object' && style.borderColor === color) {
          return true;
        }
        if (findBorderColor(n.children, color)) return true;
      }
      return false;
    }
    expect(findBorderColor(root, '#2ecc71')).toBe(true);
  });

  it('CardView muestra estado bloqueado con motivo', () => {
    const card = makeCardDef({ id: EXPLORER_RAPID_SHOT, name: 'Test' });
    const { root } = render(<CardView card={card} blocked blockedReason="Fase incorrecta" />);
    expectText(root, 'Fase incorrecta');
  });
});

// ============================================================================
// UI-ACCESS-PNG-001..006: Accesibilidad
// ============================================================================

describe('PNG — UI-ACCESS-PNG-001..006 (accesibilidad)', () => {
  it('buildAccessibleLabel genera descripción estructurada', () => {
    const label = buildAccessibleLabel({
      name: 'Disparo Certero',
      type: 'ABILITY',
      heroClass: 'EXPLORER',
      printedAttack: 3,
    });
    expect(label).toContain('Disparo Certero');
    expect(label).toContain('Explorador');
    expect(label).toContain('Ataque 3');
  });

  it('buildAccessibleLabel no usa nombres de archivo', () => {
    const label = buildAccessibleLabel({
      name: 'Disparo Rápido',
      type: 'ABILITY',
      heroClass: 'EXPLORER',
    });
    expect(label).not.toContain('.png');
    expect(label).not.toContain('frontal_');
  });

  it('buildAccessibleLabel para Hueste incluye Fortaleza', () => {
    const label = buildAccessibleLabel({
      name: 'Hueste 1',
      type: 'HORDE',
      printedFortitude: 2,
    });
    expect(label).toContain('Hueste 1');
    expect(label).toContain('Fortaleza 2');
  });

  it('buildAccessibleLabel para Mercado incluye Coste', () => {
    const label = buildAccessibleLabel({
      name: 'Daga Élfica',
      type: 'MARKET',
      printedCost: 3,
    });
    expect(label).toContain('Daga Élfica');
    expect(label).toContain('Coste 3');
  });

  it('CardView tiene accessibilityLabel', () => {
    const card = makeCardDef({
      id: 'test-acc',
      name: 'Carta Accesible',
      type: 'ABILITY',
      heroClass: 'WARRIOR',
      printedAttack: 2,
    });
    const { root } = render(<CardView card={card} />);
    function findAccLabel(nodes: any[]): string | undefined {
      for (const n of nodes) {
        if (n.props?.accessibilityLabel) return n.props.accessibilityLabel;
        const found = findAccLabel(n.children);
        if (found) return found;
      }
      return undefined;
    }
    const label = findAccLabel(root);
    expect(label).toBeDefined();
    expect(label).toContain('Carta Accesible');
  });
});

// ============================================================================
// UI-GAME-001..008: PNG en componentes
// ============================================================================

describe('PNG — UI-GAME-001 (cartas en mano)', () => {
  it('CardView con PNG real renderiza un componente Image', () => {
    const card = makeCardDef({ id: EXPLORER_RAPID_SHOT, name: 'Disparo Rápido' });
    const { root } = render(<CardView card={card} />);
    // Buscar nodo tipo Image
    function findImage(nodes: any[]): boolean {
      for (const n of nodes) {
        if (n.type === 'Image') return true;
        if (findImage(n.children)) return true;
      }
      return false;
    }
    expect(findImage(root)).toBe(true);
  });
});

describe('PNG — UI-GAME-003 (reversos)', () => {
  it('CardView con showBack busca la imagen trasera', () => {
    const card = makeCardDef({ id: HORDE_001, name: 'Hueste 1', type: 'HORDE' });
    const { root } = render(<CardView card={card} showBack />);
    // Debe renderizar Image (el trasero existe para huestes)
    function findImage(nodes: any[]): boolean {
      for (const n of nodes) {
        if (n.type === 'Image') return true;
        if (findImage(n.children)) return true;
      }
      return false;
    }
    expect(findImage(root)).toBe(true);
  });

  it('CardView con showBack sin trasero muestra placeholder', () => {
    const card = makeCardDef({ id: 'no-back-card', name: 'Sin Reverso', type: 'ABILITY' });
    const { root } = render(<CardView card={card} showBack />);
    expectText(root, 'Imagen no disponible');
  });
});
