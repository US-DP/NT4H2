/**
 * phaseLabels — etiquetas localizadas de las fases de la partida.
 *
 * Separado de PhaseIndicator para que pantallas que solo necesitan el
 * nombre de la fase no importen el componente completo.
 *
 * Mantiene la API `Record<string, string>` (los consumidores hacen
 * `PHASE_LABELS[phase] ?? phase`), pero cada acceso se resuelve via i18n
 * en `common.phases.*`, de modo que respeta el idioma activo aunque
 * cambie en tiempo de ejecución (i18n.changeLanguage).
 */

import i18n from './i18n';

/** Fases con etiqueta traducida (claves de `common.phases`). */
const PHASE_KEYS = [
  'SETUP',
  'INITIAL_PLAYER_SELECTION',
  'TURN_START',
  'ATTACK_CHOICE',
  'PLAYER_ATTACK',
  'RESOLVING_CARD',
  'WAITING_FOR_CHOICE',
  'HORDE_ATTACK',
  'MARKET',
  'RESTORATION',
  'BATTLEFIELD_REPLENISHMENT',
  'SCENARIO_TRANSITION',
  'TURN_END',
  'GAME_END_CHECK',
  'FINISHED',
] as const;

const known = new Set<string>(PHASE_KEYS);

export const PHASE_LABELS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop) {
    if (typeof prop !== 'string' || !known.has(prop)) return undefined;
    return i18n.t(`common.phases.${prop}`, { defaultValue: prop });
  },
  has(_target, prop) {
    return typeof prop === 'string' && known.has(prop);
  },
  ownKeys() {
    return [...PHASE_KEYS];
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (typeof prop !== 'string' || !known.has(prop)) return undefined;
    return {
      enumerable: true,
      configurable: true,
      value: i18n.t(`common.phases.${prop}`, { defaultValue: prop }),
    };
  },
});
