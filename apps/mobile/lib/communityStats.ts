/**
 * communityStats — estadísticas de comunidad (opt-in, anónimas).
 *
 * Si el usuario activa `shareStats` en Perfil, al terminar cada partida
 * se envía SOLO la lista de ids de logros desbloqueados al backend
 * (`/api/stats/report/`), que agrega contadores sin identidad.
 * `fetchCommunity()` devuelve la "rareza" (% de informantes) de cada
 * logro — el equivalente a los % globales de desbloqueo de Steam.
 */

import { API_BASE, fetchWithTimeout } from './config';
import { authFetch } from './auth';
import { useSettings } from '../store/settingsStore';
import { loadHistory } from './gameHistory';
import { evaluateAchievements } from './achievements';

export interface CommunityStats {
  reports: number;
  rarity: Record<string, number>;
}

let cache: { data: CommunityStats; at: number } | null = null;
const CACHE_TTL = 60_000;

/** GET /api/stats/community/ — rareza por achievement id (0..1). */
export async function fetchCommunity(): Promise<CommunityStats | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.data;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/stats/community/`, {
      method: 'GET',
    }, 8000);
    if (!res.ok) return null;
    const data = (await res.json()) as CommunityStats;
    cache = { data, at: Date.now() };
    return data;
  } catch {
    return null; // sin conexión → sin rareza, la pantalla funciona igual
  }
}

/**
 * Si `shareStats` está activo, informa los ids actualmente desbloqueados.
 * Llamar tras registrar una partida terminada. Nunca lanza: el
 * informe es best-effort y silencioso.
 */
export async function reportIfOptedIn(): Promise<void> {
  if (!useSettings.getState().shareStats) return;
  try {
    const entries = await loadHistory();
    const unlocks = evaluateAchievements(entries)
      .filter((a) => a.unlocked)
      .map((a) => a.id);
    const res = await fetchWithTimeout(`${API_BASE}/stats/report/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlocks }),
    }, 8000);
    // Solo invalida la caché si el informe entró — un 5xx no cambió los
    // porcentajes y mantener la caché evita re-descargar al abrir Stats.
    if (res.ok) cache = null;
  } catch {
    // best-effort: un fallo de red no debe afectar a la partida
  }
}

// ── Clasificación pública (opt-in separado de shareStats) ────────────────

export interface LeaderboardEntryData {
  name: string;
  wins: number;
  games: number;
}

let lbCache: { data: LeaderboardEntryData[]; at: number } | null = null;

/** GET /api/stats/leaderboard/ — top 25 por victorias. */
export async function fetchLeaderboard(): Promise<LeaderboardEntryData[] | null> {
  if (lbCache && Date.now() - lbCache.at < CACHE_TTL) return lbCache.data;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/stats/leaderboard/`, { method: 'GET' }, 8000);
    if (!res.ok) return null;
    const data = (await res.json()) as { entries?: LeaderboardEntryData[] };
    const entries = Array.isArray(data.entries) ? data.entries : [];
    lbCache = { data: entries, at: Date.now() };
    return entries;
  } catch {
    return null;
  }
}

/**
 * Informa un resultado a la clasificación pública. Solo si el usuario
 * activó `publicLeaderboard` Y tiene nombre visible (`displayName`).
 * NT4H es cooperativo: `won` = la partida terminó en victoria del equipo.
 */
export async function reportLeaderboardResult(won: boolean): Promise<void> {
  const s = useSettings.getState();
  if (!s.publicLeaderboard) return;
  const name = (s.displayName ?? '').trim();
  if (!name) return;
  try {
    // authFetch adjunta el JWT si hay sesión: el backend usa entonces el
    // display_name de la cuenta, y sin él el informe anónimo chocaba con
    // el 409 "name belongs to a registered account" para usuarios
    // registrados que informaban bajo su propio nick.
    const res = await authFetch('/stats/leaderboard/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, won }),
    });
    if (res.ok) lbCache = null;
  } catch {
    // best-effort
  }
}
