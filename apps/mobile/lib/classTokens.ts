/**
 * classTokens — única fuente de verdad visual de las clases de héroe.
 *
 * Asociación del juego físico: Guerrero azul, Explorador verde,
 * Pícaro rojo, Mago morado. Nunca depender solo del color: cada clase
 * lleva también un símbolo textual distintivo.
 */

import type { HeroClass } from '@nt4h/schema';

export interface ClassToken {
  color: string;
  /** Tinte suave para fondos */
  soft: string;
  /** Símbolo textual (la forma comunica la clase además del color) */
  symbol: string;
  label: string;
}

export const CLASS_TOKENS: Record<HeroClass, ClassToken> = {
  WARRIOR: { color: '#4285D4', soft: '#4285D422', symbol: '🛡', label: 'Guerrero' },
  EXPLORER: { color: '#3FA66B', soft: '#3FA66B22', symbol: '🏹', label: 'Explorador' },
  ROGUE: { color: '#C65358', soft: '#C6535822', symbol: '🗡', label: 'Pícaro' },
  MAGE: { color: '#8A63C7', soft: '#8A63C722', symbol: '✦', label: 'Mago' },
};

export function classColor(heroClass?: string): string | undefined {
  return heroClass ? CLASS_TOKENS[heroClass as HeroClass]?.color : undefined;
}

export function classLabel(heroClass?: string): string | undefined {
  return heroClass ? CLASS_TOKENS[heroClass as HeroClass]?.label : undefined;
}

/** Colores de acento para tipos de carta sin clase (marcos/fallbacks) */
const TYPE_COLORS: Record<string, string> = {
  HORDE: '#3D4A66',
  WARLORD: '#8E1F1F',
  MARKET: '#D4A017',
  HERO: '#E67E22',
  SCENARIO: '#16A085',
};

/** Color de acento de una carta: clase si es de héroe/habilidad, tipo si no */
export function cardAccentColor(card: { heroClass?: string; type: string }): string {
  return classColor(card.heroClass) ?? TYPE_COLORS[card.type] ?? '#555';
}
