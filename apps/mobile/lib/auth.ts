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

async function _setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    await AsyncStorage.setItem(key, value);
  }
}

async function _getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return AsyncStorage.getItem(key);
  }
}

async function _delItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(key);
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
  claimGuest: (roomId: string, playerId: string, playerToken: string, access: string) =>
    _postJson('/auth/claim-guest/', { roomId, playerId, playerToken }, access),
};

/** Lee el access almacenado, renovándolo vía refresh si la petición daría 401. */
export async function getAccessToken():Promise<string | null> {
  const access = await _getItem(K_ACCESS);
  const refresh = await _getItem(K_REFRESH);
  if (!access || !refresh) return null;
  return access;
}

let _refreshing: Promise<string | null> | null = null;

async function _refreshNow(): Promise<string | null> {
  const refresh = await _getItem(K_REFRESH);
  if (!refresh) return null;
  const res = await authApi.refresh(refresh);
  if (!res.ok) {
    await clearSession();
    return null;
  }
  const body = (await res.json()) as AuthTokens;
  const userRaw = await _getItem(K_USER);
  await persistSession(body, userRaw ? (JSON.parse(userRaw) as AuthUser) : ({} as AuthUser));
  return body.access;
}

/**
 * fetch autenticado con retry tras 401: renueva el access una vez y reintenta.
 * Si la renovación falla, la sesión se limpia y devuelve la respuesta 401.
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
  _refreshing ??= _refreshNow().finally(() => {
    _refreshing = null;
  });
  access = await _refreshing;
  if (!access) return res;
  res = await fetchWithTimeout(`${API_BASE}${path}`, withAuth(access));
  return res;
}

/** Cabecera Authorization para las llamadas sueltas (create/join room). */
export async function authHeaders(): Promise<Record<string, string>> {
  const access = await getAccessToken();
  return access ? { Authorization: `Bearer ${access}` } : {};
}
