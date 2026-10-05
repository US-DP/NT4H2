/**
 * authStore — regresión del bug de auditoría: un fallo de red en
 * login/register lanzaba fuera del store y la pantalla quedaba con
 * busy=true para siempre. Deben devolver false + error traducible.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
  clearSession: vi.fn(async () => undefined),
  loadSession: vi.fn(async () => null),
  persistSession: vi.fn(async () => undefined),
  setAuthHooks: vi.fn(),
}));

const { useAuth } = await import('../store/authStore');
const { authApi } = await import('../lib/auth');

describe('authStore — fallo de red', () => {
  it('login devuelve false con auth.networkError cuando fetch lanza', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new TypeError('fetch failed'));
    const ok = await useAuth.getState().login('a@b.c', 'pw');
    expect(ok).toBe(false);
    expect(useAuth.getState().error).toBe('auth.networkError');
    expect(useAuth.getState().status).not.toBe('authed');
  });

  it('register devuelve false con auth.networkError cuando fetch lanza', async () => {
    vi.mocked(authApi.register).mockRejectedValue(new TypeError('fetch failed'));
    const ok = await useAuth.getState().register('a@b.c', 'pw', 'Ana');
    expect(ok).toBe(false);
    expect(useAuth.getState().error).toBe('auth.networkError');
  });
});
