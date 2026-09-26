/**
 * pickFile — selecciona un fichero de texto (JSON) multiplataforma.
 *
 * Web: DocumentPicker devuelve una blob: URI legible con fetch.
 * Nativo: la copia en caché se lee con expo-file-system.
 * Devuelve null si el usuario cancela.
 */

import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { MAX_IMPORT_BYTES } from '../store/gameStore';

export async function pickTextFile(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({
    // .nt4hsave no tiene mime registrado; aceptamos cualquier fichero y la
    // validación de contenido ocurre en importSavedGame (entrada no confiable)
    type: '*/*',
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];
  // Límite de tamaño antes de leer: evita agotar memoria con ficheros enormes
  if (typeof asset.size === 'number' && asset.size > MAX_IMPORT_BYTES) return null;
  try {
    if (Platform.OS === 'web') {
      return await (await fetch(asset.uri)).text();
    }
    return await FileSystem.readAsStringAsync(asset.uri);
  } catch {
    return null;
  }
}
