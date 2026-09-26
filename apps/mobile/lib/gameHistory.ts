/**
 * gameHistory — registro local de partidas finalizadas.
 *
 * Append-only con tope (MAX_ENTRIES); las estadísticas se derivan de
 * esta lista. Solo datos de resultado — nunca estado de juego, chat
 * ni identificadores de sesión.
 */

import { storageGet, storageSet } from './storage';
import type { GameConfig } from '@nt4h/schema';

const STORAGE_KEY = 'nt4h-game-history';
const MAX_ENTRIES = 100;

export interface GameHistoryEntry {
  id: string;
  endedAt: number;
  mode: string;
  playerCount: number;
  /** Nombres de héroe ganadores (empate → varios) */
  winners: string[];
  /** Puntuación ganadora (gloria final) */
  topScore: number;
  /** 'official' = sin contenido personalizado; 'custom' = usó contenido del Taller */
  contentScope: 'official' | 'custom';
  /** Héroes usados en la partida (playerOrder → heroId). Opcional en
   *  entradas antiguas. */
  heroesPlayed?: string[];
  /** Nº de escenarios activos (0 = partida base) */
  scenariosCount?: number;
  /** El ganador terminó sin heridas (bonus "Tenaz") */
  flawless?: boolean;

  // — Enriquecidos (stats/logros de victoria; ausentes en entradas viejas) —
  /** Héroe que controlaba el jugador local (viewerId) */
  myHeroId?: string;
  /** Gloria final del jugador local (no solo la máxima) */
  yourScore?: number;
  /** El jugador local ganó la partida */
  won?: boolean;
  /** Señores de la Guerra derrotados en la partida */
  warlordsDefeated?: number;
  /** Turnos totales de la partida */
  turnsTaken?: number;
  /** La partida se jugó online (sala) vs local */
  online?: boolean;
  /** Cartas del Mercado compradas por el jugador local en la partida */
  marketBuys?: number;
  /** Enemigos derrotados por el jugador local en la partida */
  enemiesDefeated?: number;
  /** Señores de la Guerra derrotados personalmente por el jugador local */
  warlordsByMe?: number;
  /** Monedas del jugador local al final de la partida */
  coinsEnd?: number;
  /** Heridas del jugador local al final de la partida */
  woundsEnd?: number;
}

/** La config usó contenido personalizado (mazo custom o pools/escenarios custom). */
export function configUsedCustom(config: GameConfig | null | undefined): boolean {
  if (!config) return false;
  return Boolean(
    config.customDecks?.length
    || config.heroes?.some((h) => h.customDeckId)
    || config.hordeCardIds?.length
    || config.warlordIds?.length
    || config.marketCardIds?.length
    || config.scenarioIds?.some((id) => id.startsWith('custom.')),
  );
}

export async function loadHistory(): Promise<GameHistoryEntry[]> {
  try {
    const raw = await storageGet(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as GameHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Cola FIFO de escrituras: dos llamadas concurrentes (FINISHED llega por
 *  estado proyectado y por broadcast) leerían la misma lista y la segunda
 *  sobrescribiría la primera — lost update. */
let writeQueue: Promise<void> = Promise.resolve();

/** Registra una partida finalizada. Idempotente por `id`. */
export function recordFinishedGame(entry: GameHistoryEntry): Promise<void> {
  const op = writeQueue.then(async () => {
    const list = await loadHistory();
    if (list.some((e) => e.id === entry.id)) return;
    list.unshift(entry);
    await storageSet(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  });
  // Un fallo en un registro no debe dejar la cola rota para los siguientes.
  writeQueue = op.catch(() => {});
  return op;
}

export async function clearHistory(): Promise<void> {
  await storageSet(STORAGE_KEY, '[]');
}

export interface HistoryStats {
  total: number;
  official: number;
  custom: number;
  byMode: Record<string, number>;
  /** Puntuación máxima alcanzada */
  bestScore: number;
}

export function computeStats(entries: GameHistoryEntry[]): HistoryStats {
  const byMode: Record<string, number> = {};
  let best = 0;
  for (const e of entries) {
    byMode[e.mode] = (byMode[e.mode] ?? 0) + 1;
    if (e.topScore > best) best = e.topScore;
  }
  return {
    total: entries.length,
    official: entries.filter((e) => e.contentScope === 'official').length,
    custom: entries.filter((e) => e.contentScope === 'custom').length,
    byMode,
    bestScore: best,
  };
}
