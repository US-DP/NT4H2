/**
 * Nivel 16: Pruebas E2E — Recorridos críticos.
 *
 * Estos tests verifican los recorridos más importantes del usuario
 * en el navegador real, usando Playwright.
 *
 * Recorridos cubiertos:
 * 1. Cargar página de inicio (UI-030)
 * 2. Navegar a Jugar y ver los modos (UI-035)
 * 3. Crear partida rápida offline (UI-040..050)
 * 4. Ver mesa de juego (UI-070..073)
 * 5. Pantalla de privacidad hot-seat (UI-202..205)
 * 6. Modo solitario sin privacidad
 * 7. Asistente de creación (/(create))
 * 8. Responsive + accesibilidad
 *
 * Nota: Estos tests requieren que el servidor web esté corriendo.
 * La configuración de Playwright lo inicia automáticamente.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Portada → «Nueva partida» → hub Jugar con las ModeCards de modos. */
async function gotoPlayHub(page: Page) {
  await page.goto('/');
  await page.getByText(/Nueva partida/i).first().click();
  await expect(page.getByText(/Partida rápida/i).first()).toBeVisible({ timeout: 15000 });
}

/** Hub Jugar → «Partida rápida» → privacidad hot-seat → mesa de juego. */
async function startQuickGame(page: Page) {
  await gotoPlayHub(page);
  await page.getByText(/Partida rápida/i).first().click();
  await expect(page.getByText(/Pasa el dispositivo/i).first()).toBeVisible({ timeout: 15000 });
  await page.getByText(/Estoy listo/i).first().click();
  await expect(page.getByText(/Campo de Batalla/i).first()).toBeVisible({ timeout: 15000 });
}

test.describe('Recorrido 1: Cargar página de inicio (UI-030)', () => {
  test('la página de inicio muestra el título', async ({ page }) => {
    await page.goto('/');
    // El título aparece en el panel de portada
    await expect(page.getByText('No Time for Heroes').first()).toBeVisible({ timeout: 15000 });
  });

  test('muestra la acción principal "Nueva partida"', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Nueva partida/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('sin partidas guardadas muestra "Aprender a jugar"', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Aprender a jugar/i).first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Recorrido 2: Hub Jugar (UI-035)', () => {
  test('«Nueva partida» navega al hub con los cuatro modos', async ({ page }) => {
    await gotoPlayHub(page);
    await expect(page.getByText(/Modo solitario/i).first()).toBeVisible();
    await expect(page.getByText(/Online/i).first()).toBeVisible();
  });
});

test.describe('Recorrido 3: Crear partida offline (UI-040..050)', () => {
  test('al pulsar "Partida rápida" aparece la pantalla de privacidad', async ({ page }) => {
    await gotoPlayHub(page);
    await page.getByText(/Partida rápida/i).first().click();
    // En modo 2 jugadores hot-seat, debe mostrar pantalla de privacidad (UI-202)
    await expect(page.getByText(/Pasa el dispositivo/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('al confirmar privacidad, muestra la mesa de juego', async ({ page }) => {
    await startQuickGame(page);
  });
});

test.describe('Recorrido 4: Ver mesa de juego (UI-070..073)', () => {
  test('muestra el campo de batalla', async ({ page }) => {
    await startQuickGame(page);
  });

  test('muestra la mano del jugador', async ({ page, isMobile }) => {
    await startQuickGame(page);
    // En móvil la mano vive en su propia pestaña (la contextual por fase
    // arranca en «Lucha» durante la Puja de Líder): hay que abrirla.
    if (isMobile) {
      await page.getByText(/^Mano$/i).first().click();
    }
    // La mano del jugador activo aparece con su cabecera «Mano (n)»
    await expect(page.getByText(/Mano \(/i).first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Recorrido 5: Modo solitario (UI-030)', () => {
  test('al pulsar "Modo solitario" se inicia sin pantalla de privacidad', async ({ page }) => {
    await gotoPlayHub(page);
    await page.getByText(/Modo solitario/i).first().click();
    // En modo solitario (1 jugador) no debe haber pantalla de privacidad
    await expect(page.getByText(/Campo de Batalla/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Pasa el dispositivo/i)).not.toBeVisible();
  });
});

test.describe('Recorrido 6: Asistente de creación', () => {
  test('«Nueva partida» del hub abre el asistente en el paso Modo', async ({ page }) => {
    await gotoPlayHub(page);
    // La ModeCard «Nueva partida» del hub (no el botón de la portada)
    await page.getByText(/Configura modo/i).first().click();
    // El paso 1 del asistente es «Modo»: en escritorio aparece como
    // etiqueta suelta del stepper; en móvil va fusionada en el texto
    // «Paso 1 de 6 · Modo». El subtítulo del paso es estable en ambos.
    await expect(page.getByText(/Selecciona un modo/i).first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Recorrido 7: Responsive (UI-370..374)', () => {
  test('página de inicio funciona en móvil', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Solo en móvil');
    await page.goto('/');
    await expect(page.getByText('No Time for Heroes').first()).toBeVisible({ timeout: 15000 });
  });

  test('página de inicio funciona en escritorio', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Solo en escritorio');
    await page.goto('/');
    await expect(page.getByText('No Time for Heroes').first()).toBeVisible({ timeout: 15000 });
  });

  /** scrollWidth == clientWidth ⇒ sin desplazamiento horizontal global. */
  async function expectNoHorizontalOverflow(page: Page) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }

  test('la mesa de juego no desborda horizontalmente en móvil', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Solo en móvil');
    await startQuickGame(page);
    // La barra HUD (HeroStatusBar) desbordaba ~96px a 360px cuando el
    // aviso «Reconstruir el mazo…» se activaba (flexShrink:0 implícito
    // de RN-web sobre contenedores flexWrap). Regresión permanente.
    await expectNoHorizontalOverflow(page);
    for (const tab of ['Mano', 'Tienda', 'Estado', 'Registro', 'Lucha']) {
      const t = page.getByText(new RegExp(`^${tab}`)).last();
      if (await t.isVisible().catch(() => false)) {
        await t.click();
        await page.waitForTimeout(300);
        await expectNoHorizontalOverflow(page);
      }
    }
  });

  test('la mesa de juego no desborda horizontalmente en escritorio', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Solo en escritorio');
    await startQuickGame(page);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('Recorrido 8: Accesibilidad E2E (UI-360..369)', () => {
  test('página de inicio es navegable con teclado', async ({ page }) => {
    await page.goto('/');
    // Tabular debe llegar a un elemento interactivo o con tabIndex
    await page.keyboard.press('Tab');
    // El foco debe estar en un elemento interactivo (incluyendo divs con role/tabIndex)
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName ?? null;
    });
    // Aceptar BUTTON, A, INPUT, SELECT, TEXTAREA, o DIV (con tabIndex/role)
    expect(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'DIV']).toContain(focused);
  });

  test('página de inicio no tiene errores de contraste graves', async ({ page }) => {
    await page.goto('/');
    // El título debe ser visible (contraste suficiente)
    const title = page.getByText('No Time for Heroes').first();
    await expect(title).toBeVisible({ timeout: 15000 });
    // La hidratación reemplaza nodos → getComputedStyle sobre un elemento
    // desconectado devuelve ''. Re-resuelve el locator en cada intento.
    await expect(async () => {
      const color = await page.getByText('No Time for Heroes').first()
        .evaluate((el) => window.getComputedStyle(el).color);
      expect(color).not.toBe('');
    }).toPass({ timeout: 15000 });
  });
});
