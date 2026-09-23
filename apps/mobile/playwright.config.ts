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
    timeout: 120 * 1000,
  },
});
