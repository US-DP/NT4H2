/**
 * Desglose autoritativo del ataque de la Horda.
 *
 * Única fuente de verdad del cálculo: `processHordeAttack` lo usa para
 * resolver el daño y la UI lo consume para mostrar el resumen (sin
 * recalcular nada por su cuenta).
 */

import type { GameState } from '@nt4h/schema';
import type { CatalogLoadResult } from '@nt4h/catalog';
import { getEffectiveFortitude, getEnemyOutgoingDamageBonus } from '../modifiers/index.js';

export interface HordeAttackEnemyLine {
  enemyInstanceId: string;
  definitionId: string;
  /** Fortaleza efectiva − Heridas (mín. 0), antes de modificadores */
  baseDamage: number;
  antiMagicReduction: number;
  outgoingBonus: number;
  /** Contribución final del enemigo (0 si está desactivado) */
  finalDamage: number;
  damageDisabled: boolean;
}

export interface HordeAttackBreakdown {
  /** Jugador cuyas capacidades/defensas se usaron en el cálculo */
  targetPlayerId: string;
  /** Si el jugador activo tiene el daño interceptado (Valèrys), su id */
  interceptedBy: string | null;
  enemyLines: HordeAttackEnemyLine[];
  baseTotal: number;
  /** Suma de daño enemigo tras Anti-Magia y bonus, antes de defensas */
  subtotal: number;
  shieldsApplied: number;
  preventionApplied: number;
  /** Daño absorbido por el bloqueo de un uso (BLOCK_NEXT_DAMAGE) */
  blockApplied: number;
  cancelled: boolean;
  halvedByFeldon: boolean;
  /** Cartas de Desgaste que provoca el asalto */
  finalExhaustion: number;
}

/**
 * Calcula el daño de la Horda. Por defecto el objetivo es el interceptor
 * (Valèrys) si existe, o el jugador activo. `forPlayerId` fuerza otro
 * objetivo (p. ej. el motor lo usa para el daño crudo contra el objetivo
 * original antes de resolver la intercepción).
 */
export function computeHordeAttackBreakdown(
  state: GameState,
  catalog: CatalogLoadResult,
  forPlayerId?: string,
): HordeAttackBreakdown {
  const active = state.players[state.activePlayerId];
  const interceptorId = active?.interceptedBy ?? null;
  const targetId = forPlayerId ?? interceptorId ?? state.activePlayerId;
  const target = state.players[targetId];

  const heroHasMagic = (target?.capabilities ?? []).includes('MAGIC');
  // Armadura del objetivo (GRANT_ARMOR): reduce cada instancia de daño
  const armor = target?.armor ?? 0;
  const enemyLines: HordeAttackEnemyLine[] = state.battlefield.map(enemy => {
    const base = Math.max(0, getEffectiveFortitude(enemy, state) - enemy.wounds);
    let antiMagicReduction = 0;
    if (heroHasMagic && enemy.specialIcons?.includes('ANTI_MAGIC')) {
      const v = catalog.byId.get(enemy.definitionId)?.antiMagicValue ?? 1;
      antiMagicReduction = Math.min(base, v);
    }
    const outgoingBonus = getEnemyOutgoingDamageBonus(enemy);
    // 'stun' (Taller §3): el enemigo salta este ataque de la Horda
    const stunned = (enemy.statuses ?? []).some(s => s.id === 'stun' && s.stacks > 0);
    const disabled = !!enemy.damageDisabled || stunned;
    // La armadura reduce el aporte de cada enemigo por separado
    const finalDamage = disabled
      ? 0
      : Math.max(0, Math.max(0, base - antiMagicReduction) + outgoingBonus - armor);
    return {
      enemyInstanceId: enemy.instanceId,
      definitionId: enemy.definitionId,
      baseDamage: base,
      antiMagicReduction,
      outgoingBonus,
      finalDamage,
      damageDisabled: disabled,
    };
  });

  const baseTotal = enemyLines.reduce((s, l) => s + l.baseDamage, 0);
  const subtotal = enemyLines.reduce((s, l) => s + l.finalDamage, 0);
  let finalExhaustion = subtotal;

  const preventionApplied = target ? Math.min(target.prevention, finalExhaustion) : 0;
  finalExhaustion = Math.max(0, finalExhaustion - preventionApplied);
  const shieldsApplied = target ? Math.min(target.shields, finalExhaustion) : 0;
  finalExhaustion = Math.max(0, finalExhaustion - shieldsApplied);
  // Bloqueo del próximo daño (BLOCK_NEXT_DAMAGE): se consume aunque se use en parte
  const blockApplied = target ? Math.min(target.blockNext ?? 0, finalExhaustion) : 0;
  finalExhaustion = Math.max(0, finalExhaustion - blockApplied);

  const cancelled = !!target?.damageCancellation;
  if (cancelled) finalExhaustion = 0;

  const halvedByFeldon = target?.heroId === 'hero.feldon' && target.feldonDecision === 'HALVE';
  if (halvedByFeldon) finalExhaustion = Math.floor(finalExhaustion / 2);

  return {
    targetPlayerId: targetId,
    interceptedBy: interceptorId,
    enemyLines,
    baseTotal,
    subtotal,
    shieldsApplied,
    preventionApplied,
    blockApplied,
    cancelled,
    halvedByFeldon,
    finalExhaustion,
  };
}
