/**
 * Setup para tests de UI con vitest.
 */

(globalThis as any).__DEV__ = false;

// i18n: inicializa con los recursos es/en reales — los componentes
// migrados resuelven t('ns.key') a sus textos ES en los tests.
import '../lib/i18n';
import i18n from 'i18next';
import { beforeAll } from 'vitest';

beforeAll(async () => {
  await i18n.changeLanguage('es');
});
