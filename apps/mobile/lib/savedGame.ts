/**
 * savedGame — helpers de presentación para partidas guardadas y papelera.
 */

import type { SavedGame, SaveCompatibility } from '../store/gameStore';
import type { NtBadgeTone } from '../components/ui/NtBadge';
import i18n from './i18n';

/** Etiqueta corta del modo de juego de una partida guardada. */
export function modeLabel(mode: string | undefined): string {
  switch (mode) {
    case 'SOLO': return i18n.t('common.mode.solo');
    case 'MULTICLASS': return i18n.t('common.mode.multiclass');
    default: return i18n.t('common.mode.standard');
  }
}

/** Modo de una partida guardada (desde el envelope de replay). */
export function savedGameMode(saved: SavedGame): string | undefined {
  const config = saved.envelope?.initialState?.state as { mode?: string } | undefined;
  return config?.mode;
}

/** Badge de compatibilidad para una partida guardada (null = sin aviso). */
export function compatBadge(compat: SaveCompatibility): { label: string; tone: NtBadgeTone } | null {
  switch (compat) {
    case 'version-mismatch':
      return { label: i18n.t('common.compat.oldVersion'), tone: 'warning' };
    case 'incompatible':
      return { label: i18n.t('common.compat.incompatible'), tone: 'danger' };
    default:
      return null;
  }
}

/** Días que quedan antes de que la papelera purgue la partida. */
export function trashDaysLeft(deletedAt: number, retentionDays: number): number {
  const remaining = retentionDays - (Date.now() - deletedAt) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(remaining));
}
