/**
 * @nt4h/engine — Motor de reglas de No Time for Heroes.
 *
 * Exporta:
 * - DeterministicRng: RNG sembrado para determinismo.
 * - applyEvent / replayEvents: reducer puro.
 * - EffectRegistry + registerCoreEffects: registro de efectos.
 * - evalValue / evalCondition / resolveTarget: evaluadores.
 * - EventBus: sistema de disparadores.
 * - createInitialState: estado inicial de una partida.
 * - execute: ejecutar un comando.
 */

export { DeterministicRng } from './rng/index.js';
export { applyEvent, replayEvents } from './events/applyEvent.js';
export {
  EffectRegistry,
  registerCoreEffects,
  evalValue,
  evalCondition,
  resolveTarget,
  resolveHeroTargets,
} from './effects/registry.js';
export type { EffectHandler } from './effects/registry.js';
export {
  EventBus,
  MAX_EVENT_DEPTH,
  MAX_CHAIN_DEPTH,
  PRIORITY_ACTIVE_PLAYER,
  PRIORITY_OTHER_PLAYERS,
  PRIORITY_SCENARIO,
  PRIORITY_HORDE,
} from './triggers/index.js';
export type { TriggerListener } from './triggers/index.js';
export { createInitialState } from './state/initialState.js';
export { execute, isLegal } from './commands/execute.js';
export type { CommandResult, ValidationResult } from './commands/execute.js';
export { canTransition, nextPhases, validateTransition } from './phases/transitions.js';
export { setupGame, startFirstTurn, resetInstanceCounter } from './phases/setup.js';
export type { SetupResult } from './phases/setup.js';
export { processPhases, resetPhaseSeq } from './phases/engine.js';
export type { PhaseResult } from './phases/engine.js';
export { resolveCard, processHordeAttackTriggers, resetResolveSeq } from './effects/resolver.js';
export type { ResolveResult } from './effects/resolver.js';
export { useHeroAbility, resetAbilitySeq } from './heroes/abilities.js';
export type { AbilityResult } from './heroes/abilities.js';
export { applyScenarioEffects, clearScenarioEffects, onEnemyDefeated, onTurnStart, executeTurnStartEffect, resetScenarioSeq } from './scenarios/index.js';
export { setupSoloMode, buySupportCard, openSupportDeck, calculateSoloScore, getSoloTitle, resetSoloSeq } from './modes/solo.js';
export { setupMulticlassMode, validateMulticlassDeck, isMulticlassGameEnded } from './modes/multiclass.js';
export { projectForPlayer, projectEventsForPlayer } from './projection/index.js';
export type { PlayerGameState } from './projection/index.js';
export { createSnapshot, replay, replayFromSnapshot, replayInit, replayStep, stateHash, createReplay, ENGINE_VERSION, RULESET_VERSION, SNAPSHOT_VERSION } from './replay/index.js';
export type { GameSnapshot, ReplayEnvelope, ReplayCursor, CommandResult as ReplayCommandResult } from './replay/index.js';
export { getEffectiveFortitude, effectiveDamage, effectiveHordeDamage, effectiveEnemyDamage, expireModifiers, MODIFIER_LAYERS } from './modifiers/index.js';
export type { ModifierLayer } from './modifiers/index.js';
export { nextSeq, resetSeq, setSeq, currentSeq } from './seq.js';
export { computeFinalScore } from './scoring.js';
export type { FinalScore, PlayerScore } from './scoring.js';
export { evaluateCommand, reasonToCode } from './evaluation.js';
export type { CommandEvaluation, CommandReasonCode, CommandCostPreview } from './evaluation.js';
export { computeHordeAttackBreakdown } from './analysis/hordeBreakdown.js';
export type { HordeAttackBreakdown, HordeAttackEnemyLine } from './analysis/hordeBreakdown.js';
