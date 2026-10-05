/**
 * EFFECT_REGISTRY — registro central de tipos de efecto soportados.
 *
 * Cada entrada describe un tipo de CardEffect que el motor sabe resolver.
 * El Taller lo usa para el selector de efectos del editor; la auditoria lo
 * usa para verificar que toda carta solo usa efectos registrados.
 *
 * allowedSources limita en que tipos de carta puede usarse el efecto.
 */

import type { CardEffect, CardType } from '@nt4h/schema';

export type EffectCategory =
  | 'damage' | 'prevention' | 'cards' | 'resources'
  | 'control' | 'enemies' | 'modifiers' | 'special';

export interface EffectMeta {
  type: CardEffect['type'];
  category: EffectCategory;
  /** Nombre legible en español para el editor */
  label: string;
  /** Descripcion corta del efecto */
  description: string;
  /** Tipos de carta en los que el efecto tiene sentido */
  allowedSources: CardType[];
  /** El efecto puede pedir elegir objetivo al jugador */
  needsTarget: boolean;
}

const ABILITY: CardType[] = ['ABILITY', 'MARKET'];
const HEROES: CardType[] = ['HERO'];
const ENEMIES: CardType[] = ['HORDE', 'WARLORD'];
const ANY: CardType[] = ['ABILITY', 'HERO', 'HORDE', 'WARLORD', 'MARKET', 'SCENARIO'];

function meta(
  type: CardEffect['type'], category: EffectCategory, label: string,
  description: string, allowedSources: CardType[], needsTarget = false,
): EffectMeta {
  return { type, category, label, description, allowedSources, needsTarget };
}

export const EFFECT_REGISTRY: EffectMeta[] = [
  // Daño
  meta('DEAL_DAMAGE', 'damage', 'Infligir daño', 'Daño a un enemigo según selector', ABILITY, true),
  meta('DEAL_DAMAGE_ALL_ENEMIES', 'damage', 'Daño a todos', 'Daño a todos los enemigos del campo', ABILITY),
  meta('DEAL_DAMAGE_SPLIT', 'damage', 'Daño repartido', 'Reparte daño entre varios enemigos', ABILITY, true),
  meta('DEAL_DAMAGE_TO_HERO', 'damage', 'Daño a héroe', 'Daño a un héroe (pérdida de cartas)', ANY, true),
  meta('DEAL_DAMAGE_TO_OTHER_HEROES', 'damage', 'Daño a otros héroes', 'Daño a los demás héroes', ANY),
  // Prevención
  meta('PREVENT_DAMAGE', 'prevention', 'Prevenir daño', 'Previene daño al héroe activo', ABILITY),
  meta('PREVENT_ENEMY_DAMAGE', 'prevention', 'Anular enemigo', 'Un enemigo no inflige daño', ABILITY, true),
  meta('CANCEL_ALL_DAMAGE', 'prevention', 'Cancelar daño', 'Cancela todo el daño de la Horda', ABILITY),
  meta('SHIELD', 'prevention', 'Escudo', 'El héroe activo gana Escudos', ABILITY),
  // Cartas
  meta('DRAW_CARDS', 'cards', 'Robar cartas', 'Roba cartas del mazo de Habilidad', ABILITY),
  meta('DRAW_AND_ADD_ATTACK', 'cards', 'Robar y atacar', 'Roba cartas y suma su ataque', ABILITY),
  meta('LOSE_CARDS', 'cards', 'Perder cartas', 'Pierde cartas del mazo al Desgaste', ANY),
  meta('RECOVER_CARDS', 'cards', 'Recuperar cartas', 'Recupera cartas del Desgaste',
    ['ABILITY', 'MARKET', 'WARLORD']),
  meta('RECOVER_CARD_BY_NAME', 'cards', 'Recuperar por nombre', 'Recupera una carta concreta del Desgaste', ABILITY),
  meta('SEARCH_DECK', 'cards', 'Buscar en mazo', 'Busca una carta en un mazo', ['ABILITY', 'MARKET', 'HERO']),
  meta('SHUFFLE_DECK', 'cards', 'Barajar mazo', 'Baraja un mazo', ['ABILITY', 'MARKET', 'HERO']),
  meta('SEARCH_WEAR_PILE_PUT_IN_HAND', 'cards', 'Rescatar del Desgaste', 'Lleva cartas del Desgaste a la mano', ABILITY),
  // Recursos
  meta('GAIN_GLORY', 'resources', 'Ganar Gloria', 'El héroe activo gana Gloria', ANY),
  meta('GAIN_COINS', 'resources', 'Ganar Monedas', 'Gana Monedas', ANY),
  meta('STEAL_COINS', 'resources', 'Robar Monedas', 'Roba Monedas a otro héroe', ABILITY, true),
  meta('HEAL_WOUNDS', 'resources', 'Curar Heridas', 'Retira Heridas del héroe activo', ABILITY),
  meta('COST', 'resources', 'Coste', 'Coste en Monedas o Gloria de la carta', ['MARKET', 'ABILITY']),
  // Control de flujo
  meta('CONDITIONAL', 'control', 'Condicional', 'Ejecuta efectos si se cumple una condición', ANY),
  meta('ON_DEFEAT', 'control', 'Al derrotar', 'Efectos al derrotar al objetivo', ABILITY),
  meta('ON_ENEMY_DEFEATED', 'control', 'Tras derrota', 'Efectos cuando un enemigo cae', ANY),
  meta('ON_HORDE_ATTACK', 'control', 'Al atacar la Horda', 'Efectos durante el ataque de la Horda', ENEMIES),
  // Solo SCENARIO: los flags ignoreCoinRewards/ignoreGloryRewards los
  // fija applyScenarioEffects mientras el escenario está activo; en una
  // carta de habilidad/mercado eran no-ops silenciosos (auditoría).
  meta('IGNORE_COIN_REWARDS', 'control', 'Ignorar Monedas', 'No se ganan Monedas de recompensa', ['SCENARIO']),
  meta('IGNORE_GLORY_REWARDS', 'control', 'Ignorar Gloria', 'No se gana Gloria de recompensa', ['SCENARIO']),
  meta('END_ATTACK', 'control', 'Terminar ataque', 'Finaliza la fase de ataque', ABILITY),
  meta('REPEAT', 'control', 'Repetir', 'Repite sus efectos N veces (con máximo obligatorio)', ABILITY),
  meta('CHOOSE_ONE', 'control', 'Elección', 'El jugador elige una de varias ramas de efectos', ABILITY),
  // Enemigos
  meta('DISABLE_ENEMY_DAMAGE', 'enemies', 'Desactivar enemigo', 'Un enemigo no ataca', ABILITY, true),
  meta('APPLY_VULNERABILITY', 'enemies', 'Vulnerabilidad', 'Un enemigo recibe daño extra', ABILITY, true),
  meta('DEFEAT_ENEMY', 'enemies', 'Derrotar enemigo', 'Derrota a un enemigo directamente', ABILITY, true),
  meta('SWAP_ENEMY', 'enemies', 'Cambiar enemigo', 'Sustituye un enemigo por otro de la Horda', ABILITY, true),
  meta('RETURN_TO_HORDE', 'enemies', 'Devolver a la Horda', 'Devuelve un enemigo al fondo de la Horda', ABILITY, true),
  // Modificadores
  meta('MODIFY_DAMAGE', 'modifiers', 'Modificar daño', 'Modifica el daño de la carta', ABILITY),
  meta('MODIFY_FORTITUDE', 'modifiers', 'Modificar Fortaleza', 'Altera la Fortaleza de un enemigo', ANY, true),
  meta('MODIFY_MARKET_COST', 'modifiers', 'Modificar coste', 'Altera los precios del Mercado', ['SCENARIO', 'HORDE', 'WARLORD']),
  // Especiales
  meta('DRAW_AND_CHECK', 'special', 'Robar y comprobar', 'Roba y aplica efectos según la carta', ABILITY),
  meta('PLAY_IMMEDIATELY', 'special', 'Jugar inmediato', 'Juega otra carta inmediatamente', ABILITY),
  meta('PLACE_PERSISTENT', 'special', 'Efecto persistente', 'Deja un efecto activo con disparador', ANY),
  meta('RECOVER_THIS_CARD', 'special', 'Recuperar esta carta', 'La carta vuelve a la mano o al mazo', ABILITY),
  meta('REMOVE_FROM_GAME', 'special', 'Retirar del juego', 'La carta se retira de la partida', ABILITY),
  meta('ALL_HEROES_RECOVER', 'special', 'Todos recuperan', 'Todos los héroes recuperan cartas', ANY),
  meta('OTHER_HEROES_RECOVER', 'special', 'Otros recuperan', 'Los demás héroes recuperan cartas', ANY),
  meta('INTERCEPT_DAMAGE', 'special', 'Interceptar daño', 'Un héroe recibe el daño de otro', HEROES),
  meta('LOOK_AT_CARDS', 'special', 'Mirar la Horda', 'Mira y reordena cartas de la Horda', ['ABILITY', 'MARKET', 'HERO']),
  meta('STEAL_COINS_MULTIPLE', 'special', 'Robo múltiple', 'Roba Monedas a varios héroes', ABILITY),
  meta('PLAY_RANDOM_CARD_FROM_OTHER_HERO', 'special', 'Carta ajena', 'Juega una carta al azar de otro héroe', ABILITY),
  meta('CUSTOM_SCENARIO', 'special', 'Escenario especial', 'Handler nombrado para escenarios únicos', ['SCENARIO']),
  // === Extensiones del Taller (fase 1+) ===
  meta('DEAL_DAMAGE_HITS', 'damage', 'Golpes múltiples', 'N golpes de daño separados a un enemigo', ABILITY, true),
  meta('EXECUTE_ENEMY', 'enemies', 'Ejecutar enemigo', 'Derrota al enemigo si su Fortaleza ≤ umbral', ABILITY, true),
  meta('OVERKILL_DAMAGE', 'damage', 'Daño sobrante', 'El exceso de daño salta a otro enemigo', ABILITY, true),
  meta('SPAWN_ENEMY', 'enemies', 'Invocar enemigo', 'Revela N cartas de la Horda al campo', ANY),
  meta('DISCARD_HORDE_CARD', 'enemies', 'Descartar de la Horda', 'Elimina N cartas del mazo de la Horda', ANY),
  meta('MOVE_HORDE_CARDS', 'enemies', 'Reordenar la Horda', 'Mueve N cartas del fondo al principio (o al revés)', ANY),
  meta('DRAW_FROM_BOTTOM', 'cards', 'Robar del fondo', 'Roba cartas del fondo del mazo de Habilidad', ABILITY),
  meta('DRAW_UP_TO', 'cards', 'Robar hasta N', 'Roba hasta completar N cartas en mano', ABILITY),
  meta('TAKE_WOUNDS', 'damage', 'Sufrir Heridas', 'Un héroe recibe N Heridas directas', ANY, true),
  meta('GRANT_ARMOR', 'prevention', 'Armadura', 'Reduce cada instancia de daño en N hasta fin de turno', ABILITY),
  meta('MOVE_CARD', 'cards', 'Mover carta', 'Mueve N cartas entre mano, Desgaste y mazo', ABILITY),
  meta('FOR_EACH', 'control', 'Para cada uno', 'Ejecuta sus efectos por cada enemigo/héroe', ANY),
  meta('APPLY_STATUS', 'enemies', 'Aplicar estado', 'Aplica un estado a enemigos (marca, veneno, aturdimiento…)', ANY, true),
  meta('REMOVE_STATUS', 'enemies', 'Quitar estado', 'Retira un estado de enemigos', ANY, true),
  meta('INCREASE_STATUS', 'enemies', 'Aumentar estado', 'Suma acumulaciones a un estado de enemigos', ANY, true),
  // === Extensiones del Taller (fase 2): variables, bloqueo, oyentes ===
  meta('SET_VARIABLE', 'special', 'Guardar variable', 'Guarda un valor con nombre para usarlo en otros efectos', ANY),
  meta('BLOCK_NEXT_DAMAGE', 'prevention', 'Bloquear daño', 'Cancela hasta N del próximo daño recibido', ANY),
  meta('TRY_EFFECT', 'control', 'Intentar efectos', 'Ejecuta efectos; si fallan, ejecuta el fallback', ANY),
  meta('REGISTER_LISTENER', 'control', 'Oyente de evento', 'Ejecuta efectos cada vez que ocurra un tipo de evento', ANY),
  meta('REMOVE_LISTENER', 'control', 'Quitar oyentes', 'Retira tus oyentes con una etiqueta', ANY),
  meta('DISCARD_FROM_HAND', 'cards', 'Descartar de la mano', 'El jugador elige N cartas de su mano para descartar', ANY),
];

const registryByType = new Map(EFFECT_REGISTRY.map(m => [m.type, m]));

/** Metadatos de un tipo de efecto (undefined si no esta registrado). */
export function getEffectMeta(type: CardEffect['type']): EffectMeta | undefined {
  return registryByType.get(type);
}

/**
 * Efectos que el motor solo intercepta en el nivel raíz de la resolución
 * de una carta. Anidados dentro de CONDITIONAL/REPEAT/FOR_EACH/etc. caen
 * en handlers no-op (se descartan en silencio), generan elecciones que
 * nadie resolverá (CHOOSE_ONE/DISCARD_FROM_HAND) o fabrican un enemigo
 * con stats corruptos (SWAP_ENEMY). Rechazarlos al validar.
 */
export const TOP_LEVEL_ONLY_EFFECTS: ReadonlySet<CardEffect['type']> = new Set([
  'CHOOSE_ONE',
  'DISCARD_FROM_HAND',
  'DRAW_AND_CHECK',
  'DRAW_AND_ADD_ATTACK',
  'ON_DEFEAT',
  'ON_HORDE_ATTACK',
  'PLAY_IMMEDIATELY',
  'CUSTOM_SCENARIO',
  'SPAWN_ENEMY',
  'SWAP_ENEMY',
  'PLAY_RANDOM_CARD_FROM_OTHER_HERO',
]);

/**
 * Valida que los efectos de una carta usan tipos registrados y compatibles
 * con el tipo de carta. Devuelve errores legibles para el editor.
 */
export function validateEffectSources(cardType: CardType, effects: CardEffect[]): string[] {
  const errors: string[] = [];
  // PLAY_IMMEDIATELY sí es legal anidado dentro de onMatch/onMismatch de
  // un DRAW_AND_CHECK — es la mecánica entera de Disparo Rápido (la
  // carta robada se juega en el acto si coincide).
  const walk = (
    list: CardEffect[],
    path: string,
    depth: number,
    parentType?: CardEffect['type'],
    parentKey?: string,
  ): void => {
    list.forEach((eff, i) => {
      const p = `${path}[${i}]`;
      const m = registryByType.get(eff.type);
      if (!m) {
        errors.push(`${p}: efecto desconocido ${eff.type}`);
        return;
      }
      if (!m.allowedSources.includes(cardType)) {
        errors.push(`${p}: ${m.label} no puede usarse en cartas de tipo ${cardType}`);
      }
      const nestedRapidShot =
        eff.type === 'PLAY_IMMEDIATELY'
        && parentType === 'DRAW_AND_CHECK'
        && (parentKey === 'onMatch' || parentKey === 'onMismatch');
      if (depth > 0 && TOP_LEVEL_ONLY_EFFECTS.has(eff.type) && !nestedRapidShot) {
        errors.push(`${p}: ${m.label} solo puede usarse en el nivel raíz de la carta`);
      }
      const c = eff as unknown as Record<string, unknown>;
      for (const key of ['effects', 'then', 'else', 'onMatch', 'onMismatch', 'onFailure']) {
        const sub = c[key];
        if (Array.isArray(sub)) {
          walk(sub as CardEffect[], `${p}.${key}`, depth + 1, eff.type, key);
        }
      }
      // CHOOSE_ONE: validar las ramas como listas anidadas
      const opts = c['options'];
      if (Array.isArray(opts)) {
        for (let oi = 0; oi < opts.length; oi++) {
          const sub = (opts[oi] as { effects?: unknown }).effects;
          if (Array.isArray(sub)) {
            walk(sub as CardEffect[], `${p}.options[${oi}]`, depth + 1, eff.type, 'options');
          }
        }
      }
    });
  };
  walk(effects, 'effects', 0);
  return errors;
}

/**
 * Listas de efectos que se ejecutan DIRECTAMENTE contra el registry
 * (`heroAbility.effects`, `peritia.effects`): no pasan por el intercepto
 * de resolveCard, así que los tipos TOP_LEVEL_ONLY son no-ops incluso en
 * el nivel raíz. Valida la lista entera como si todo fuera "anidado".
 */
export function validateDirectExecuteEffects(effects: CardEffect[]): string[] {
  const errors: string[] = [];
  const walk = (list: CardEffect[], path: string): void => {
    list.forEach((eff, i) => {
      const p = `${path}[${i}]`;
      if (TOP_LEVEL_ONLY_EFFECTS.has(eff.type)) {
        errors.push(`${p}: ${eff.type} no se ejecuta en efectos declarativos (pericia/pericia de héroe)`);
      }
      const c = eff as unknown as Record<string, unknown>;
      for (const key of ['effects', 'then', 'else', 'onMatch', 'onMismatch', 'onFailure']) {
        const sub = c[key];
        if (Array.isArray(sub)) walk(sub as CardEffect[], `${p}.${key}`);
      }
      const opts = c['options'];
      if (Array.isArray(opts)) {
        for (let oi = 0; oi < opts.length; oi++) {
          const sub = (opts[oi] as { effects?: unknown }).effects;
          if (Array.isArray(sub)) walk(sub as CardEffect[], `${p}.options[${oi}]`);
        }
      }
    });
  };
  walk(effects, 'effects');
  return errors;
}
