/**
 * config — endpoints del backend centralizados.
 *
 * Configurables por variables de entorno de Expo:
 * - EXPO_PUBLIC_API_URL  (ej. https://api.example.com/api)
 * - EXPO_PUBLIC_WS_URL   (ej. wss://api.example.com/ws)
 *
 * En desarrollo caen a localhost. En producción EXIGIR wss://+https://:
 * el token de jugador viaja por estos canales.
 */

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_API = 'http://localhost:8000/api';
const DEFAULT_WS = 'ws://localhost:8000/ws';

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export const API_BASE = envOr('EXPO_PUBLIC_API_URL', DEFAULT_API);
export const WS_BASE = envOr('EXPO_PUBLIC_WS_URL', DEFAULT_WS);

// Producción: rechazar esquemas en claro — el auth token iría sin cifrar
if (process.env.NODE_ENV === 'production') {
  if (!API_BASE.startsWith('https://')) {
    throw new Error('EXPO_PUBLIC_API_URL debe usar https:// en producción');
  }
  if (!WS_BASE.startsWith('wss://')) {
    throw new Error('EXPO_PUBLIC_WS_URL debe usar wss:// en producción');
  }
}

/** Timeout por defecto para llamadas REST (ms) */
export const FETCH_TIMEOUT_MS = 10_000;

/**
 * fetch con timeout via AbortController — una promesa colgada no deja la
 * UI en limbo indefinidamente.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
