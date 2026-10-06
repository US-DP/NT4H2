/**
 * targeting — determina si una carta necesita que el jugador elija enemigo.
 *
 * Reglas del motor (packages/engine):
 * - TargetSelector ONE_ENEMY / SELECTED_ENEMY → el jugador elige 1 enemigo
 *   (targetEnemyId en el comando PLAY_CARD). ONE_ENEMY puede llevar filtro
 *   (isOrc, isWarlord, minFortitude sobre la fortaleza EFECTIVA).
 * - ALL_ENEMIES, ENEMY_WITH_MAX_FORTITUDE, ENEMY_WITH_FEWEST_WOUNDS →
 *   el objetivo es automático, no hay elección.
 * - Los efectos pueden estar anidados (CONDITIONAL then/else, ON_DEFEAT,
 *   ON_ENEMY_DEFEATED, DRAW_AND_CHECK onMatch/onMismatch) → escaneo recursivo.
 */

import type { CardDefinition, EnemyState, GameState, TargetSelector } from '@nt4h/schema';
import { getEffectiveFortitude } from '@nt4h/engine';
import i18n from './i18n';

export interface CardTargeting {
  /** 'enemy' = el jugador debe elegir 1 enemigo; 'none' = se juega directa */
  mode: 'none' | 'enemy';
  /** Filtros que debe cumplir el enemigo elegido (de todos los efectos que piden selección) */
  filters: { isOrc?: boolean; isWarlord?: boolean; minFortitude?: number }[];
  /** Texto explicativo para la UI ("Elige un enemigo", "Afecta a todos", …) */
  description: string;
}

/** ¿Este selector requiere que el jugador elija un enemigo? */
function isPlayerChoice(sel: TargetSelector): boolean {
  return sel.kind === 'ONE_ENEMY' || sel.kind === 'SELECTED_ENEMY';
}

const AUTO_TARGET_KEYS: Record<string, string> = {
  ALL_ENEMIES: 'hud.targetAutoAll',
  ENEMY_WITH_MAX_FORTITUDE: 'hud.targetAutoMaxFort',
  ENEMY_WITH_FEWEST_WOUNDS: 'hud.targetAutoFewestWounds',
};

/** Recorre los efectos de una carta, incluidos los anidados. */
function* walkEffects(effects: readonly unknown[] | undefined): Generator<Record<string, unknown>> {
  if (!effects) return;
  for (const eff of effects) {
    if (!eff || typeof eff !== 'object') continue;
    const e = eff as Record<string, unknown>;
    yield e;
    // Ramas condicionales y efectos anidados
    const branch = (v: unknown) => (Array.isArray(v) ? v : undefined);
    yield* walkEffects(branch(e.then));
    yield* walkEffects(branch(e.else));
    yield* walkEffects(branch(e.effects));
    yield* walkEffects(branch(e.onMatch ?? e.on_match));
    yield* walkEffects(branch(e.onMismatch ?? e.on_mismatch));
    // TRY_EFFECT.onFailure y CHOOSE_ONE.options[].effects: un efecto
    // con objetivo dentro de estas ramas igualmente necesita
    // targetEnemyId en el comando — si la UI no lo pide, resolveTarget
    // devuelve null y el efecto es un no-op silencioso.
    yield* walkEffects(branch(e.onFailure));
    const opts = e.options;
    if (Array.isArray(opts)) {
      for (const o of opts) {
        yield* walkEffects(branch((o as Record<string, unknown>)?.effects));
      }
    }
  }
}

/**
 * Analiza una carta y devuelve qué objetivo necesita.
 * Una carta puede tener varios efectos con distintos tipos de objetivo:
 * si alguno requiere elección del jugador, el modo es 'enemy'.
 */
export function getCardTargeting(cardDef: CardDefinition | undefined | null): CardTargeting {
  // Regla E-13/D441 del motor: printedAttack>0 sin efecto de daño
  // "especial" (reparto/área/héroes) exige targetEnemyId, igual que un
  // selector SELECTED_ENEMY/ONE_ENEMY. Si la UI no lo pide, el comando
  // se rechaza con TARGET_REQUIRED y la carta era injugable.
  const SPECIAL_DAMAGE = new Set([
    'DEAL_DAMAGE_SPLIT', 'DEAL_DAMAGE_ALL_ENEMIES',
    'DEAL_DAMAGE_TO_HERO', 'DEAL_DAMAGE_TO_OTHER_HEROES',
  ]);
  const hasSpecialDamage = (cardDef?.effects ?? []).some(
    e => SPECIAL_DAMAGE.has((e as { type?: string }).type ?? ''),
  );
  const printedNeedsTarget = (cardDef?.printedAttack ?? 0) > 0 && !hasSpecialDamage;

  if (!cardDef?.effects?.length) {
    if (printedNeedsTarget) {
      return { mode: 'enemy', filters: [], description: i18n.t('hud.targetChoose') };
    }
    return { mode: 'none', filters: [], description: i18n.t('hud.targetNoEffects') };
  }

  let needsChoice = printedNeedsTarget;
  const filters: CardTargeting['filters'] = [];
  const autoKinds = new Set<string>();

  for (const eff of walkEffects(cardDef.effects)) {
    // Efectos que afectan a todos sin selector explícito
    if (eff.type === 'DEAL_DAMAGE_ALL_ENEMIES') {
      autoKinds.add('ALL_ENEMIES');
      continue;
    }
    const target = eff.target as TargetSelector | undefined;
    if (!target || typeof target !== 'object' || !target.kind) continue;
    if (isPlayerChoice(target)) {
      needsChoice = true;
      const filter = (target as { filter?: CardTargeting['filters'][number] }).filter;
      if (filter) filters.push(filter);
    } else {
      autoKinds.add(target.kind);
    }
  }

  if (needsChoice) {
    const parts = [i18n.t('hud.targetChoose')];
    for (const f of filters) {
      if (f.isOrc === true) parts.push(i18n.t('hud.targetOnlyOrcs'));
      if (f.isOrc === false) parts.push(i18n.t('hud.targetNotOrcs'));
      if (f.isWarlord === true) parts.push(i18n.t('hud.targetOnlyWarlord'));
      if (f.isWarlord === false) parts.push(i18n.t('hud.targetNotWarlord'));
      if (f.minFortitude !== undefined)
        parts.push(i18n.t('hud.targetMinFort', { value: f.minFortitude }));
    }
    return { mode: 'enemy', filters, description: parts.join(' · ') };
  }

  if (autoKinds.size > 0) {
    const desc = [...autoKinds]
      .map(k => i18n.t(AUTO_TARGET_KEYS[k] ?? 'hud.targetAuto'))
      .join(' · ');
    return { mode: 'none', filters: [], description: desc };
  }

  return { mode: 'none', filters: [], description: i18n.t('hud.targetNoNeed') };
}

/**
 * ¿Es `enemy` un objetivo válido para esta carta?
 * Un enemigo derrotado nunca es objetivo. Con filtros, se usan las reglas
 * del motor (fortaleza efectiva con modificadores, orco, Señor).
 */
export function isValidEnemyTarget(
  targeting: CardTargeting,
  enemy: EnemyState,
  state: GameState,
): { ok: boolean; reason?: string } {
  if (targeting.mode !== 'enemy') return { ok: false, reason: i18n.t('hud.reasonNoTarget') };
  const eff = getEffectiveFortitude(enemy, state);
  if (enemy.wounds >= eff) return { ok: false, reason: i18n.t('hud.reasonDefeated') };
  for (const f of targeting.filters) {
    if (f.isOrc !== undefined && enemy.isOrc !== f.isOrc) {
      return { ok: false, reason: i18n.t(f.isOrc ? 'hud.reasonOnlyOrcs' : 'hud.reasonNotOrcs') };
    }
    if (f.isWarlord !== undefined && enemy.isWarlord !== f.isWarlord) {
      return { ok: false, reason: i18n.t(f.isWarlord ? 'hud.reasonOnlyWarlord' : 'hud.reasonNotWarlord') };
    }
    if (f.minFortitude !== undefined && eff < f.minFortitude) {
      return { ok: false, reason: i18n.t('hud.reasonMinFort', { value: f.minFortitude }) };
    }
  }
  return { ok: true };
}
