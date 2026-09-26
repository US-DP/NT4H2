/**
 * storage — persistencia clave-valor NO sensible.
 *
 * Nativo: @react-native-async-storage/async-storage.
 * Web: localStorage.
 * Tests/node: memoria.
 *
 * Para tokens y credenciales usar secureStorage.ts (SecureStore), NO esto.
 */

import { Platform } from 'react-native';
import type * as MmkvModule from 'react-native-mmkv';
import type AsyncStorageModule from '@react-native-async-storage/async-storage';

const isNative = Platform.OS !== 'web';
const memory = new Map<string, string>();
const hasLS = () => typeof localStorage !== 'undefined';

// MMKV en nativo: lecturas/escrituras síncronas y ~30x más rápidas que
// AsyncStorage para preferencias e índices pequeños. Requiere
// react-native-nitro-modules (ya instalado para Unistyles).
interface MmkvLike {
  getString: (k: string) => string | undefined;
  set: (k: string, v: string) => void;
  delete: (k: string) => void;
}
let _mmkv: MmkvLike | null | false = null;
function mmkv(): MmkvLike | null {
  if (_mmkv === null) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MMKV } = require('react-native-mmkv') as typeof MmkvModule;
      _mmkv = new MMKV({ id: 'nt4h-preferences' }) as MmkvLike;
    } catch (err) {
      // Sin MMKV (módulo nativo ausente o no linkeado) no podemos hacer
      // un no-op silencioso: los datos se perderían sin rastro. Se cae a
      // AsyncStorage — más lento pero persistente.
      console.warn('storage: react-native-mmkv no disponible, usando AsyncStorage', err);
      _mmkv = false;
    }
  }
  return _mmkv || null;
}

const store = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage')
    .default as typeof AsyncStorageModule;

export async function storageGet(key: string): Promise<string | null> {
  if (isNative) {
    const mm = mmkv();
    if (mm) {
      const v = mm.getString(key);
      if (v !== undefined) return v;
      // Fallback de migración: leer el valor previo de AsyncStorage
      const legacy = await store().getItem(key);
      if (legacy !== null) {
        mm.set(key, legacy);
        void store().removeItem(key);
      }
      return legacy;
    }
    return store().getItem(key);
  }
  if (hasLS()) return localStorage.getItem(key);
  return memory.get(key) ?? null;
}

export async function storageSet(key: string, value: string): Promise<void> {
  if (isNative) {
    const mm = mmkv();
    if (mm) return mm.set(key, value);
    return store().setItem(key, value);
  }
  if (hasLS()) localStorage.setItem(key, value);
  else memory.set(key, value);
}

export async function storageRemove(key: string): Promise<void> {
  if (isNative) {
    const mm = mmkv();
    if (mm) return mm.delete(key);
    return store().removeItem(key);
  }
  if (hasLS()) localStorage.removeItem(key);
  else memory.delete(key);
}

/**
 * Escritura "atómica" emulada: primero a `<key>.tmp`, después al destino
 * y se borra el temporal. Si el proceso muere entre medias queda el valor
 * anterior intacto (los lectores ignoran `.tmp`).
 */
export async function storageSetAtomic(key: string, value: string): Promise<void> {
  await storageSet(`${key}.tmp`, value);
  await storageSet(key, value);
  await storageRemove(`${key}.tmp`);
}
