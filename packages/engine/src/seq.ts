/**
 * seq — contador de secuencia global del motor.
 *
 * D426 (especificacion §51.12): los eventos deben tener seq monotonico global
 * dentro de una partida para que el replay y el eventLog sean consistentes.
 * Antes habia contadores independientes por modulo (phaseSeq, resolveSeq,
 * abilitySeq, scenarioSeq, soloSeq) que podian producir seqs duplicados o
 * desordenados entre modulos.
 *
 * El contador se reinicia con resetSeq() (llamado desde los reset*Seq
 * compatibles con tests existentes).
 */
let globalSeq = 0;

/** Callbacks a ejecutar cuando el contador se reinicia o restaura (replay).
 *  Lo usan módulos con estado derivado de los seqs (p.ej. dedup de oyentes). */
const resetHooks: (() => void)[] = [];

export function onSeqReset(fn: () => void): void {
  resetHooks.push(fn);
}

export function nextSeq(): number {
  return ++globalSeq;
}

export function resetSeq(): void {
  globalSeq = 0;
  for (const fn of resetHooks) fn();
}

/** Restaurar el contador a un valor concreto (replay desde snapshot mid-game). */
export function setSeq(n: number): void {
  globalSeq = n;
  for (const fn of resetHooks) fn();
}

/** Valor actual del contador (para snapshots). */
export function currentSeq(): number {
  return globalSeq;
}
