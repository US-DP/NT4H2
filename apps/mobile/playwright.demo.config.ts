import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Config "demo": misma suite que playwright.config.ts pero con el
 * navegador VISIBLE, cámara lenta y grabación de vídeo — sirve para ver
 * cada carta jugándose de verdad en la interfaz mientras el test aserta.
 *
 *   pnpm test:e2e:demo                          → suite completa en pantalla
 *   pnpm test:e2e:demo -- -g "Espadazo"         → una sola carta
 *   E2E_BASE_URL=http://localhost:8099 pnpm test:e2e:demo
 *                                               → contra el build estático
 *   E2E_SLOW_MO=800 pnpm test:e2e:demo          → más despacio todavía
 *
 * Solo corre el proyecto chromium (el recorrido es el mismo en mobile) y
 * sin reintentos: lo que se ve en pantalla es exactamente lo que pasó.
 */
export default defineConfig({
  ...base,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...base.use,
    headless: false,
    video: { mode: 'on', size: { width: 1600, height: 900 } },
    launchOptions: { slowMo: Number(process.env.E2E_SLOW_MO ?? 400) },
  },
  projects: (base.projects ?? []).filter(p => p.name === 'chromium'),
});
