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
 *
 * E2E_BASE_URL: URL de un servidor ya arrancado (pnpm web --port N).
 * Útil cuando 8081 está ocupado por otra app en la máquina de desarrollo —
 * con la variable definida no se levanta webServer propio.
 *
 * Para suites largas (card-effects.spec.ts, ~92 tests × page-load) el
 * servidor de Metro resulta inestable; la vía robusta es servir el build
 * estático: `pnpm build` (con EXPO_PUBLIC_API_URL/WS_URL https/wss) y
 * `node ../../tools/serve-dist.cjs` (añade el shim de process.env que el
 * bundle lee en runtime) → E2E_BASE_URL=http://localhost:8099.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8081';
const externalServer = !!process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL,
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
  webServer: externalServer
    ? undefined
    : {
        command: 'pnpm web',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        // Metro en frío (Windows, sin caché) puede tardar >2 min en el primer bundle
        timeout: 300 * 1000,
      },
});
