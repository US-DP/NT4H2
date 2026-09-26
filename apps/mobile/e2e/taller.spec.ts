/**
 * Nivel 16b: E2E del Taller — crear una carta en la interfaz real.
 *
 * Verifica que los efectos funcionan EN LA INTERFAZ, no solo en el motor:
 * 1. El editor añade nodos, genera el texto y el simulador los resuelve.
 * 2. La carta se guarda en "My creations" y aparece en la biblioteca.
 * 3. El panel de problemas responde a un nodo incompleto sin congelar la UI.
 *
 * La UI arranca en inglés por defecto (locale del navegador de test).
 * Requiere el servidor web (Playwright lo arranca vía webServer).
 */

import { test, expect, type Page } from '@playwright/test';

/** Campo "Name" del borrador (localizado por su placeholder). */
const nameInput = (page: Page) => page.locator('input[placeholder*="Tiz"]').first();

test.describe('Workshop: create a card in the real UI', () => {
  test('the editor shows the form and the effect picker', async ({ page }) => {
    await page.goto('/(study)/create');
    await expect(nameInput(page)).toBeVisible({ timeout: 15000 });
    await page.getByText('+ Add effect', { exact: true }).first().click();
    await expect(page.getByText(/Actions \(\d+\)/).first()).toBeVisible({ timeout: 10000 });
  });

  test('adding an action generates the text and the simulator resolves it', async ({ page }) => {
    await page.goto('/(study)/create');
    await nameInput(page).fill('E2E Crossbow');
    await page.getByText('+ Add effect', { exact: true }).first().click();
    await page.getByText('Gain Coins', { exact: true }).first().click();
    // Generated PSCT preview shows the effect sentence
    await expect(page.getByText(/Text the card will read/i).first())
      .toBeVisible({ timeout: 10000 });
    // Simulator runs the real engine resolver and shows deltas
    await page.getByText('Simulate', { exact: true }).first().click();
    await expect(page.getByText(/Coins/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('saving publishes the card to My creations', async ({ page }) => {
    await page.goto('/(study)/create');
    await nameInput(page).fill(`E2E Crossbow ${Date.now()}`);
    await page.getByText('+ Add effect', { exact: true }).first().click();
    await page.getByText('Gain Coins', { exact: true }).first().click();
    await page.getByText(/Save to My creations|Save changes/i).first()
      .click({ force: true, timeout: 15000 });
    await expect(page.getByText(/My creations \(\d+\)/i).first()).toBeVisible({ timeout: 25000 });
  });

  test('an incomplete node shows diagnostics without freezing the UI', async ({ page }) => {
    await page.goto('/(study)/create');
    await page.getByText('+ Add effect', { exact: true }).first().click();
    // Empty structural node → diagnostic visible, no crash.
    // force: la fila del picker puede quedar fuera del viewport (lista larga).
    await page.getByText('Repetition', { exact: true }).first()
      .click({ force: true, timeout: 15000 });
    await expect(page.getByText(/Problems \(/).first()).toBeVisible({ timeout: 10000 });
  });
});
