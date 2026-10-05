/**
 * authStore — estado de la cuenta (Fase 1: identidad persistente).
 *
 * `status`: 'loading' al hidratar, 'guest' sin sesión, 'authed' con JWT.
 * Las acciones devuelven { ok } / { ok:false, error } para la UI.
 */

import { create } from 'zustand';
import { authApi, clearSession, loadSession, persistSession, setAuthHooks, type AuthUser } from '../lib/auth';
import { API_BASE, fetchWithTimeout } from '../lib/config';
import i18n from '../lib/i18n';

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

export const useAuth = create<AuthState>((set, get) => {
  // lib/auth renueva/revoca sesiones fuera del store (authFetch,
  // getAccessToken): sin estos hooks el estado quedaría con un access
  // caducado o 'authed' tras un clearSession por refresh revocado.
  setAuthHooks({
    onSessionCleared: () =>
      set({ status: 'guest', user: null, access: null, refresh: null, error: null }),
    onAccessRefreshed: (access, refresh) => set({ access, refresh }),
  });
  return {
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
    // Sin try/catch, un fallo de red (timeout, servidor caído) lanzaba
    // fuera del store: la pantalla quedaba con busy=true para siempre.
    try {
      const res = await authApi.login(email, password);
      if (!res.ok) {
        set({ error: 'auth.loginFailed' });
        return false;
      }
      const body = (await res.json()) as { access: string; refresh: string };
      // El login ya devolvió tokens, pero /me/ puede fallar (500, HTML de
      // proxy): sin check se persistía un usuario corrupto o lanzaba.
      const me = await fetchWithTimeout(`${API_BASE.replace(/\/api$/, '')}/api/v1/me/`, {
        headers: { Authorization: `Bearer ${body.access}` },
      });
      if (!me.ok) {
        set({ error: 'auth.loginFailed' });
        return false;
      }
      const user = (await me.json()) as AuthUser;
      await persistSession(body, user);
      set({ status: 'authed', user, access: body.access, refresh: body.refresh, error: null });
      return true;
    } catch {
      set({ error: 'auth.networkError' });
      return false;
    }
  },

  register: async (email, password, displayName) => {
    // locale: idioma activo de la UI — registrar siempre 'es' guardaba un
    // dato de cuenta incorrecto para usuarios en inglés.
    const locale = i18n.language?.toLowerCase().startsWith('en') ? 'en' : 'es';
    // Igual que login: un fallo de red lanzaba y dejaba el botón
    // bloqueado con spinner permanente.
    try {
      const res = await authApi.register(email, password, displayName, locale);
      if (!res.ok) {
        let code = 'auth.registerFailed';
        try {
          const body = (await res.json()) as Record<string, string[]>;
          const first = Object.values(body)[0]?.[0];
          // Fallback si el backend devuelve un mensaje sin traducción:
          // sin esto la UI pintaba la clave i18n en crudo.
          if (first) {
            const candidate = `auth.err.${first}`;
            code = i18n.exists(candidate) ? candidate : code;
          }
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
    } catch {
      set({ error: 'auth.networkError' });
      return false;
    }
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
  };
});
