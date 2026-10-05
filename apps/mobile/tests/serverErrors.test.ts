/**
 * serverErrors — los mensajes del backend (inglés) se traducen a claves
 * i18n antes de mostrarse; los ya traducidos y los desconocidos pasan.
 */

import { describe, it, expect } from 'vitest';
import i18n from '../lib/i18n';
import { serverErrorText } from '../lib/serverErrors';

const t = (k: string) => i18n.t(k) as string;

describe('serverErrorText', () => {
  it('traduce errores conocidos del backend', () => {
    i18n.changeLanguage('es');
    expect(serverErrorText('Room is full', t)).toBe('La sala está llena');
    expect(serverErrorText('Not all players are ready', t)).toBe(
      'No todos los jugadores están listos',
    );
  });

  it('cubre el prefijo Only the host can', () => {
    expect(serverErrorText('Only the host can start', t)).toBe(
      'Solo el anfitrión puede hacer eso',
    );
    expect(serverErrorText('Only the host can kick', t)).toBe(
      'Solo el anfitrión puede hacer eso',
    );
  });

  it('mapea fallos de red y aborts a un mensaje de conexión', () => {
    expect(serverErrorText('Network request failed', t)).toBe(
      'Sin conexión con el servidor; comprueba tu red',
    );
    expect(serverErrorText('The operation was aborted.', t)).toBe(
      'Sin conexión con el servidor; comprueba tu red',
    );
  });

  it('deja pasar mensajes ya traducidos o desconocidos', () => {
    expect(serverErrorText('Has sido expulsado de esta sala', t)).toBe(
      'Has sido expulsado de esta sala',
    );
    expect(serverErrorText('something unexpected', t)).toBe('something unexpected');
  });

  it('funciona en inglés', () => {
    i18n.changeLanguage('en');
    expect(serverErrorText('Room is full', t)).toBe('The room is full');
    i18n.changeLanguage('es');
  });
});
