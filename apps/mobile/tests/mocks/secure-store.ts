/** Mock de expo-secure-store — almacén en memoria para tests. */

const store = new Map<string, string>();

export async function getItemAsync(key: string) {
  return store.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string) {
  store.set(key, value);
}
export async function deleteItemAsync(key: string) {
  store.delete(key);
}
export function __clear() {
  store.clear();
}
