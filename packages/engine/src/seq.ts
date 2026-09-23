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

export function nextSeq(): number {
  return ++globalSeq;
}

export function resetSeq(): void {
  globalSeq = 0;
}

/** Restaurar el contador a un valor concreto (replay desde snapshot mid-game). */
export function setSeq(n: number): void {
  globalSeq = n;
}

/** Valor actual del contador (para snapshots). */
export function currentSeq(): number {
  return globalSeq;
}
