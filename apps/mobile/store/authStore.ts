/**
 * authStore — estado de la cuenta (Fase 1: identidad persistente).
 *
 * `status`: 'loading' al hidratar, 'guest' sin sesión, 'authed' con JWT.
 * Las acciones devuelven { ok } / { ok:false, error } para la UI.
 */

import { create } from 'zustand';
import { authApi, clearSession, loadSession, persistSession, type AuthUser } from '../lib/auth';
import { API_BASE } from '../lib/config';

interface AuthState {
  status: 'loading' | 'guest' | 'authed';
  user: AuthUser | null;
  access: string | null;
  refresh: string | null;
  error: string | null;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, displayName: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  access: null,
  refresh: null,
  error: null,

  hydrate: async () => {
    const session = await loadSession();
    if (!session) {
      set({ status: 'guest' });
      return;
    }
    set({
      status: 'authed',
      user: session.user,
      access: session.tokens.access,
      refresh: session.tokens.refresh,
    });
  },

  login: async (email, password) => {
    const res = await authApi.login(email, password);
    if (!res.ok) {
      set({ error: 'auth.loginFailed' });
      return false;
    }
    const body = (await res.json()) as { access: string; refresh: string };
    const me = await fetch(`${API_BASE.replace(/\/api$/, '')}/api/v1/me/`, {
      headers: { Authorization: `Bearer ${body.access}` },
    });
    const user = (await me.json()) as AuthUser;
    await persistSession(body, user);
    set({ status: 'authed', user, access: body.access, refresh: body.refresh, error: null });
    return true;
  },

  register: async (email, password, displayName) => {
    const res = await authApi.register(email, password, displayName);
    if (!res.ok) {
      let code = 'auth.registerFailed';
      try {
        const body = (await res.json()) as Record<string, string[]>;
        const first = Object.values(body)[0]?.[0];
        if (first) code = `auth.err.${first}`;
      } catch {
        /* cuerpo no JSON */
      }
      set({ error: code });
      return false;
    }
    const body = (await res.json()) as { user: AuthUser; tokens: { access: string; refresh: string } };
    await persistSession(body.tokens, body.user);
    set({
      status: 'authed',
      user: body.user,
      access: body.tokens.access,
      refresh: body.tokens.refresh,
      error: null,
    });
    return true;
  },

  logout: async () => {
    const { refresh, access } = get();
    if (refresh && access) {
      try {
        await authApi.logout(refresh, access);
      } catch {
        /* mejor esfuerzo: la sesión local se limpia igual */
      }
    }
    await clearSession();
    set({ status: 'guest', user: null, access: null, refresh: null, error: null });
  },
}));
