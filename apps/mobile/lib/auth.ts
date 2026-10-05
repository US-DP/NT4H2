/**
 * auth.ts — cliente de la API de cuentas (Fase 1: identidad persistente).
 *
 * JWT access (15 min) + refresh rotatorio (14 días). El refresh se guarda
 * en expo-secure-store en nativo y en localStorage en web. `authFetch`
 * adjunta el Bearer y renueva el access transparentemente ante un 401.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE, fetchWithTimeout } from './config';

const K_ACCESS = 'nt4h.auth.access';
const K_REFRESH = 'nt4h.auth.refresh';
const K_USER = 'nt4h.auth.user';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  avatar: string;
  locale: string;
  timezone: string;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

/* ---------- almacenamiento ---------- */

// Web: sessionStorage (como secureStorage.ts) — los JWT viven solo en la
// pestaña; localStorage los dejaba indefinidamente legibles para
// cualquier script inyectado. Nativo: SecureStore con fallback a
// AsyncStorage (menos seguro pero persistente; mejor que perder sesión).
function _webStorage(): Storage | null {
  return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
}

async function _setItem(key: string, value: string): Promise<void> {
  const ss = _webStorage();
  if (Platform.OS === 'web') {
    ss?.setItem(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    await AsyncStorage.setItem(key, value);
  }
}

async function _getItem(key: string): Promise<string | null> {
  const ss = _webStorage();
  if (Platform.OS === 'web') {
    return ss?.getItem(key) ?? null;
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return AsyncStorage.getItem(key);
  }
}

async function _delItem(key: string): Promise<void> {
  const ss = _webStorage();
  if (Platform.OS === 'web') {
    ss?.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    await AsyncStorage.removeItem(key);
  }
}

export async function persistSession(tokens: AuthTokens, user: AuthUser): Promise<void> {
  await Promise.all([
    _setItem(K_ACCESS, tokens.access),
    _setItem(K_REFRESH, tokens.refresh),
    _setItem(K_USER, JSON.stringify(user)),
  ]);
}

export async function loadSession(): Promise<{ tokens: AuthTokens; user: AuthUser } | null> {
  const [access, refresh, rawUser] = await Promise.all([
    _getItem(K_ACCESS),
    _getItem(K_REFRESH),
    _getItem(K_USER),
  ]);
  if (!access || !refresh || !rawUser) return null;
  try {
    return { tokens: { access, refresh }, user: JSON.parse(rawUser) as AuthUser };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await Promise.all([_delItem(K_ACCESS), _delItem(K_REFRESH), _delItem(K_USER)]);
}

/* ---------- API ---------- */

async function _postJson(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetchWithTimeout(`${API_BASE.replace(/\/api$/, '')}/api/v1${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export const authApi = {
  register: (email: string, password: string, displayName: string, locale = 'es') =>
    _postJson('/auth/register/', { email, password, display_name: displayName, locale }),
  login: (email: string, password: string) =>
    _postJson('/auth/login/', { email, password }),
  refresh: (refresh: string) => _postJson('/auth/refresh/', { refresh }),
  logout: (refresh: string, access: string) => _postJson('/auth/logout/', { refresh }, access),
  // (claimGuest eliminado: el join con JWT ya auto-vincula la cuenta —
  //  sin flujo UI que lo llamara era superficie muerta)
  /** PATCH /api/v1/me — sincroniza campos de la cuenta (display_name, locale). */
  updateMe: (patch: { display_name?: string; locale?: string; avatar?: string; timezone?: string }) =>
    authFetch('/v1/me/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  /** Estadísticas de cuenta del jugador (jugadas/ganadas/abandonadas). */
  myStatistics: (userId: string) => authFetch(`/v1/players/${userId}/statistics/`),
};

// Hooks que authStore registra: lib/auth no puede importar el store
// (dependencia circular), así que el store se suscribe.
let _onSessionCleared: (() => void) | null = null;
let _onAccessRefreshed: ((access: string, refresh: string) => void) | null = null;
export function setAuthHooks(hooks: {
  onSessionCleared?: () => void;
  onAccessRefreshed?: (access: string, refresh: string) => void;
}): void {
  _onSessionCleared = hooks.onSessionCleared ?? null;
  _onAccessRefreshed = hooks.onAccessRefreshed ?? null;
}

/** True si el JWT access está caducado (o a punto: margen de 5s). */
function _isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 5_000;
  } catch {
    return false; // token opaco/no-JWT: que decida el servidor
  }
}

let _refreshing: Promise<string | null> | null = null;

function _doRefresh(): Promise<string | null> {
  _refreshing ??= _refreshNow().finally(() => {
    _refreshing = null;
  });
  return _refreshing;
}

async function _refreshNow(): Promise<string | null> {
  const refresh = await _getItem(K_REFRESH);
  if (!refresh) return null;
  let res: Response;
  try {
    res = await authApi.refresh(refresh);
  } catch {
    // Fallo de red/timeout: no destruir la sesión — el refresh de 14
    // días sigue siendo válido cuando vuelva la conectividad.
    return null;
  }
  if (!res.ok) {
    // Solo una respuesta de auth real (401/403) significa "refresh
    // revocado": un 500/502 del servidor no debe cerrar la sesión.
    if (res.status === 401 || res.status === 403) {
      await clearSession();
      _onSessionCleared?.();
    }
    return null;
  }
  const body = (await res.json()) as AuthTokens;
  const userRaw = await _getItem(K_USER);
  if (userRaw) {
    await persistSession(body, JSON.parse(userRaw) as AuthUser);
  } else {
    await Promise.all([_setItem(K_ACCESS, body.access), _setItem(K_REFRESH, body.refresh)]);
  }
  _onAccessRefreshed?.(body.access, body.refresh);
  return body.access;
}

/** Lee el access almacenado, renovándolo vía refresh si ya caducó. */
export async function getAccessToken(): Promise<string | null> {
  const access = await _getItem(K_ACCESS);
  const refresh = await _getItem(K_REFRESH);
  if (!access || !refresh) return null;
  if (!_isExpired(access)) return access;
  return _doRefresh();
}

/**
 * fetch autenticado con retry tras 401: renueva el access una vez y reintenta.
 * Si la renovación falla por auth, la sesión se limpia y devuelve el 401.
 */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let access = await getAccessToken();
  if (!access) return fetchWithTimeout(`${API_BASE}${path}`, init);
  const withAuth = (token: string) => ({
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  });
  let res = await fetchWithTimeout(`${API_BASE}${path}`, withAuth(access));
  if (res.status !== 401) return res;
  access = await _doRefresh();
  if (!access) return res;
  res = await fetchWithTimeout(`${API_BASE}${path}`, withAuth(access));
  return res;
}

/** Cabecera Authorization para las llamadas sueltas (create/join room). */
export async function authHeaders(): Promise<Record<string, string>> {
  const access = await getAccessToken();
  return access ? { Authorization: `Bearer ${access}` } : {};
}
