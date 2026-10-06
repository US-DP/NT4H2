/**
 * Nivel 17: E2E multijugador real — DOS clientes de navegador contra el
 * backend vivo (Django+Channels :8000 + engine-runner :3001).
 *
 * Recorrido: el anfitrión crea la sala desde la UI (hub «Online»),
 * el invitado se une con el código, se prepara, el anfitrión inicia y
 * AMBOS contextos llegan a la mesa de juego. Verifica en la interfaz:
 * - creación/unión por REST,
 * - presencia sincronizada entre contextos (WS real del navegador),
 * - ready → inicio → estado PLAYING,
 * - proyección por jugador: cada cliente llega a su mesa.
 *
 * Requisito: backend en http://localhost:8000 (CORS dev admite :8081 —
 * ejecutar contra Metro, no contra el dist :8099). Se salta limpio si
 * el backend no responde.
 *
 *   DJANGO_DEBUG=true python manage.py runserver 8000
 *   cd apps/mobile && pnpm test:e2e -- multijugador
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const BACKEND = 'http://localhost:8000';

async function backendUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/list/`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Portada → «Nueva partida» → hub de modos. */
async function gotoPlayHub(page: Page) {
  await page.goto('/');
  await page.getByText(/Nueva partida/i).first().click();
  await expect(page.getByText(/Partida rápida/i).first()).toBeVisible({ timeout: 15000 });
}

test.describe('Multijugador online (backend real)', () => {
  test.beforeEach(async () => {
    test.skip(
      !(await backendUp()),
      'Backend no disponible en :8000 (DJANGO_DEBUG=true python manage.py runserver)',
    );
  });

  test('crear → unirse → preparado → iniciar: ambos clientes ven la mesa', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const host = await ctxA.newPage();
    const guest = await ctxB.newPage();

    try {
      // ── Anfitrión: hub → tarjeta «Online» → lobby con código ──────────
      await gotoPlayHub(host);
      await host.getByText(/Jugar online/i).first().click();
      const title = host.getByText(/^Sala /).first();
      await expect(title).toBeVisible({ timeout: 20000 });
      const code = (await title.innerText()).replace(/^Sala /, '').trim();
      expect(code.length).toBeGreaterThan(0);

      // ── Invitado: «Unirse con código» → formulario → Unirse ───────────
      await gotoPlayHub(guest);
      await guest.getByText(/Unirse con código/i).first().click();
      await guest.getByPlaceholder(/Código de sala/i).fill(code);
      await guest.getByPlaceholder(/Tu nombre/i).fill('Invitado E2E');
      await guest.getByLabel('Beleth-Il').click();
      await guest.getByLabel('Guerrero').click();
      await guest.getByLabel('Masculina').click();
      await guest.getByRole('button', { name: 'Unirse', exact: true }).click();

      // Ambos lobbys listan a los dos jugadores (presencia REST+WS real).
      // El nombre suelto tiene un duplicado aria-hidden en RN-web: se
      // busca la fila completa «Invitado E2E — Beleth-Il …» que solo
      // existe en el roster visible.
      await expect(host.getByText(/Invitado E2E — .*Beleth-Il/).first()).toBeVisible({ timeout: 30000 });
      await expect(guest.getByText(/Invitado E2E — .*Beleth-Il/).first()).toBeVisible({ timeout: 30000 });
      await expect(guest.getByText(/^Sala /).first()).toBeVisible({ timeout: 30000 });

      // ── Invitado se prepara → el anfitrión lo ve «Preparado» ──────────
      await guest.getByText('Estoy preparado').first().click();
      await expect(host.getByText('Preparado').first()).toBeVisible({ timeout: 30000 });

      // ── Anfitrión inicia → navega directo a /(game); el invitado
      //    ve «Ir a la partida» cuando la sala pasa a PLAYING ─────────────
      await host.getByText('Iniciar partida').first().click();
      await guest.getByText('Ir a la partida').first().click();

      // La mesa real renderiza en ambos contextos (proyección por jugador)
      await expect(host.getByText(/Campo de [Bb]atalla/i).first()).toBeVisible({ timeout: 30000 });
      await expect(guest.getByText(/Campo de [Bb]atalla/i).first()).toBeVisible({ timeout: 30000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
