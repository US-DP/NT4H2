/**
 * secureStorage — almacenamiento de valores pequeños y sensibles.
 *
 * Nativo: expo-secure-store (Keychain iOS / Keystore Android, cifrado).
 * Web: sessionStorage (SecureStore no existe en web; sessionStorage
 * limita la vida del token a la pestaña — localStorage lo dejaría
 * indefinidamente legible por cualquier script inyectado).
 * Tests: memoria (sessionStorage puede no existir en node).
 *
 * SOLO para valores pequeños (tokens, ids). Nunca blobs ni JSON grande.
 */

import { Platform } from 'react-native';
import type * as SecureStore from 'expo-secure-store';

const isNative = Platform.OS !== 'web';
const memory = new Map<string, string>();
const hasSS = () => typeof sessionStorage !== 'undefined';

// Carga perezosa: evita que el bundle web toque el módulo nativo
// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = () => require('expo-secure-store') as typeof SecureStore;

export async function secureGet(key: string): Promise<string | null> {
  if (isNative) return store().getItemAsync(key);
  if (hasSS()) return sessionStorage.getItem(key);
  return memory.get(key) ?? null;
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (isNative) return store().setItemAsync(key, value);
  if (hasSS()) sessionStorage.setItem(key, value);
  else memory.set(key, value);
}

export async function secureDelete(key: string): Promise<void> {
  if (isNative) return store().deleteItemAsync(key);
  if (hasSS()) sessionStorage.removeItem(key);
  else memory.delete(key);
}
