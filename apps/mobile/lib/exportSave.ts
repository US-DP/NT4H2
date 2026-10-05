/**
 * exportSave — exportar una partida guardada como fichero JSON.
 *
 * Nativo: escribe en caché con expo-file-system y comparte con expo-sharing.
 * Web: descarga directa via Blob.
 */

import { Platform } from 'react-native';
import type * as FileSystemNS from 'expo-file-system';
import type * as SharingNS from 'expo-sharing';

export async function exportTextFile(
  filename: string,
  contents: string,
  mimeType = 'application/json',
): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      const blob = new Blob([contents], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    } catch {
      return false;
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require('expo-file-system') as typeof FileSystemNS;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sharing = require('expo-sharing') as typeof SharingNS;
    const path = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(path, contents);
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(path, { mimeType, dialogTitle: filename });
    return true;
  } catch {
    return false;
  }
}
