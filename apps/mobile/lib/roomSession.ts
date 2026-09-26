/**
 * roomSession — persistencia de la sesión online (reconexión tras recargar).
 *
 * Guarda {roomId, playerId, playerToken} en almacenamiento seguro.
 * El token es la credencial D431 — por eso SecureStore y no AsyncStorage.
 */

import { secureGet, secureSet, secureDelete } from './secureStorage';

const KEY = 'nt4h.room.session';

export interface RoomSession {
  roomId: string;
  playerId: string;
  playerToken: string;
  savedAt: number;
}

export async function saveRoomSession(session: Omit<RoomSession, 'savedAt'>): Promise<void> {
  try {
    await secureSet(KEY, JSON.stringify({ ...session, savedAt: Date.now() }));
  } catch {
    // Almacenamiento no disponible — la sesión simplemente no se restaura
  }
}

/** TTL de la sesión guardada: una sala rejoinable no vive para siempre
 *  (el backend las barre tras ~30min sin conectados / 24h FINISHED). */
export const ROOM_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export async function loadRoomSession(): Promise<RoomSession | null> {
  try {
    const raw = await secureGet(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoomSession>;
    if (!parsed.roomId || !parsed.playerId || !parsed.playerToken) return null;
    // savedAt inválido (ausente, NaN, ≤0 o en el futuro) → la sesión no es
    // de confianza: sin el check estricto un NaN pasaría como "fresca" y
    // se reintentaría el rejoin a una sala muerta para siempre.
    const now = Date.now();
    const ageMs = now - (parsed.savedAt ?? NaN);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ROOM_SESSION_TTL_MS) {
      void clearRoomSession();
      return null;
    }
    return parsed as RoomSession;
  } catch {
    return null;
  }
}

export async function clearRoomSession(): Promise<void> {
  try {
    await secureDelete(KEY);
  } catch {
    // ignorar
  }
}
