/**
 * toast — cola de avisos efímeros para NtToastHost.
 * Un solo aviso visible a la vez; el nuevo reemplaza al anterior.
 */

import { create } from 'zustand';

export interface ToastMessage {
  message: string;
  /** Acción opcional (ej. "Deshacer") */
  action?: { label: string; onPress: () => void };
  /** ms hasta auto-cierre (por defecto 4000) */
  durationMs?: number;
}

interface ToastState {
  current: ToastMessage | null;
  show: (message: string, opts?: Omit<ToastMessage, 'message'>) => void;
  dismiss: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  current: null,
  show: (message, opts) => {
    if (timer) clearTimeout(timer);
    set({ current: { message, ...opts } });
    timer = setTimeout(() => set({ current: null }), opts?.durationMs ?? 4000);
  },
  dismiss: () => {
    if (timer) clearTimeout(timer);
    set({ current: null });
  },
}));

export const toast = {
  show: (message: string, opts?: Omit<ToastMessage, 'message'>) =>
    useToastStore.getState().show(message, opts),
  dismiss: () => useToastStore.getState().dismiss(),
};
