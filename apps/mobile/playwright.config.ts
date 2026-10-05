import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración de Playwright para tests E2E de NT4H Digital.
 *
 * Los tests E2E verifican recorridos críticos del usuario en el navegador:
 * - Crear partida
 * - Jugar carta
 * - Comprar en mercado
 * - Cambiar turno (hot-seat)
 * - Guardar/cargar partida
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8081',
    // La app decide el idioma por locale del dispositivo (i18n.ts);
    // los specs aserten textos en español — sin esto un navegador
    // en-US renderiza "New game" y todo falla de forma opaca.
    locale: 'es-ES',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'pnpm web',
    url: 'http://localhost:8081',
    reuseExistingServer: !process.env.CI,
    // Metro en frío (Windows, sin caché) puede tardar >2 min en el primer bundle
    timeout: 300 * 1000,
  },
});
