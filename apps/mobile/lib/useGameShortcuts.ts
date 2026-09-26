/**
 * useGameShortcuts — atajos de teclado de la mesa de juego (solo web).
 *
 * Reglas de seguridad de entrada:
 *  - Ignora eventos en INPUT/TEXTAREA/contentEditable.
 *  - Ignora combinaciones con modificadores (Ctrl/Alt/Meta) para no
 *    interferir con atajos del sistema o del navegador.
 *  - Ignora composición IME (`isComposing`).
 *
 * Atajos:
 *  1-5 → pestañas de la mesa · h/e/c → panel lateral · Escape → cerrar
 *  modales abiertos.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';

export type MobileTabKey = 'combat' | 'hand' | 'market' | 'status' | 'log';
export type SideTabKey = 'history' | 'status' | 'chat';

export interface GameShortcutHandlers {
  /** Ajuste global: si es false solo Escape sigue activo. */
  enabled: boolean;
  setMobileTab: (tab: MobileTabKey) => void;
  setSideTab: (tab: SideTabKey) => void;
  /** Cierra el modal de nivel superior abierto (Escape). */
  closeTopmost: () => void;
  /** ← → : mueve la selección por las cartas de la mano. */
  cycleHandCard?: (dir: -1 | 1) => void;
  /** Enter: juega la carta seleccionada (si no requiere objetivo). */
  playSelectedCard?: () => void;
}

const MOBILE_TAB_KEYS: Record<string, MobileTabKey> = {
  '1': 'combat',
  '2': 'hand',
  '3': 'market',
  '4': 'status',
  '5': 'log',
};

const SIDE_TAB_KEYS: Record<string, SideTabKey> = {
  h: 'history',
  e: 'status',
  c: 'chat',
};

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable === true
  );
}

export function useGameShortcuts(handlers: GameShortcutHandlers): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.isComposing || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      if (isEditableTarget(ev.target)) return;

      if (ev.key === 'Escape') {
        handlers.closeTopmost();
        ev.preventDefault();
        return;
      }
      if (!handlers.enabled) return;
      const mobileTab = MOBILE_TAB_KEYS[ev.key];
      if (mobileTab) {
        handlers.setMobileTab(mobileTab);
        ev.preventDefault();
        return;
      }
      const sideTab = SIDE_TAB_KEYS[ev.key.toLowerCase()];
      if (sideTab) {
        handlers.setSideTab(sideTab);
        ev.preventDefault();
      }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        handlers.cycleHandCard?.(ev.key === 'ArrowLeft' ? -1 : 1);
        ev.preventDefault();
        return;
      }
      if (ev.key === 'Enter') {
        handlers.playSelectedCard?.();
        ev.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers.enabled, handlers.setMobileTab, handlers.setSideTab, handlers.closeTopmost, handlers.cycleHandCard, handlers.playSelectedCard]);
}
