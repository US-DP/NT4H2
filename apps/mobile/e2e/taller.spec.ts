/**
 * Nivel 16b: E2E del Taller — crear una carta en la interfaz real.
 *
 * Verifica que los efectos funcionan EN LA INTERFAZ, no solo en el motor:
 * 1. El editor añade nodos, genera el texto y el simulador los resuelve.
 * 2. La carta se guarda en "Mis creaciones" y aparece en la biblioteca.
 * 3. El panel de problemas responde a un nodo incompleto sin congelar la UI.
 *
 * La UI arranca en español (locale fijado a es-ES en playwright.config).
 * Requiere el servidor web (Playwright lo arranca vía webServer).
 *
 * Nota RN-web: `locator.fill()` no dispara `onChangeText` de los TextInput
 * de react-native-web — hay que teclear con `pressSequentially`.
 */

import { test, expect, type Page } from '@playwright/test';

/** Campo "Nombre" del borrador (su accessibilityLabel es la etiqueta). */
const nameInput = (page: Page) => page.getByRole('textbox', { name: 'Nombre', exact: true });
/** Botón que abre/cierra el picker de efectos. */
const addEffectBtn = (page: Page) => page.getByRole('button', { name: '+ Añadir efecto', exact: true });
/** Fila del picker de efectos (a11y: `addNodeA11y` → "Añadir <label>"). */
const pickerRow = (page: Page, label: string) =>
  page.getByRole('button', { name: `Añadir ${label}`, exact: true });

const openPicker = async (page: Page) => {
  // La sección «Acciones (N)» solo existe con el picker abierto.
  const acciones = page.getByText(/Acciones \(\d+\)/).first();
  await addEffectBtn(page).click();
  // La página puede hidratar tarde: el primer click puede caer antes de que
  // React adjunte el handler → reintenta el toggle si el picker no apareció.
  try {
    await expect(acciones).toBeVisible({ timeout: 8000 });
  } catch {
    await addEffectBtn(page).click();
    await expect(acciones).toBeVisible({ timeout: 10000 });
  }
};

const typeName = async (page: Page, name: string) => {
  const input = nameInput(page);
  // La página puede hidratar tarde: teclas enviadas antes de que React
  // adjunte onChangeText se pierden → reintenta hasta que el valor pegue.
  await expect(async () => {
    if ((await input.inputValue()) !== name) {
      await input.click();
      await input.press('ControlOrMeta+a');
      await input.press('Backspace');
      await input.pressSequentially(name);
    }
    expect(await input.inputValue()).toBe(name);
  }).toPass({ timeout: 15000 });
};

test.describe('Workshop: create a card in the real UI', () => {
  test('the editor shows the form and the effect picker', async ({ page }) => {
    await page.goto('/(study)/create');
    await expect(nameInput(page)).toBeVisible({ timeout: 15000 });
    await openPicker(page);
  });

  test('adding an action generates the text and the simulator resolves it', async ({ page }) => {
    await page.goto('/(study)/create');
    await typeName(page, 'E2E Crossbow');
    await openPicker(page);
    await pickerRow(page, 'Ganar Monedas').click();
    // Generated PSCT preview shows the effect sentence
    await expect(page.getByText(/Texto que leerá la carta/i).first())
      .toBeVisible({ timeout: 10000 });
    // Simulator runs the real engine resolver and shows deltas
    await page.getByRole('button', { name: 'Simular', exact: true }).first().click();
    // El delta del simulador es «+N Monedas» — distinto del título del
    // nodo «Ganar Monedas (1)», que también está presente (y oculto).
    await expect(page.getByText(/\+\d+ Monedas/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('saving publishes the card to My creations', async ({ page }) => {
    const cardName = `E2E Crossbow ${Date.now()}`;
    await page.goto('/(study)/create');
    await typeName(page, cardName);
    await openPicker(page);
    await pickerRow(page, 'Ganar Monedas').click();
    await page.getByRole('button', { name: /Guardar en Mis creaciones|Guardar cambios/i }).first()
      .click({ timeout: 15000 });
    // La sección solo se renderiza con customCards > 0 (tras el upsert).
    await expect(page.getByText(/Mis creaciones \(\d+\)/i).first()).toBeVisible({ timeout: 25000 });
    await expect(page.getByText(cardName).first()).toBeVisible({ timeout: 10000 });
  });

  test('an incomplete node shows diagnostics without freezing the UI', async ({ page }) => {
    await page.goto('/(study)/create');
    await openPicker(page);
    // Empty structural node → diagnostic visible, no crash.
    // force: la fila del picker puede quedar fuera del viewport (lista larga).
    await pickerRow(page, 'Repetición').click({ force: true, timeout: 15000 });
    await expect(page.getByText(/Problemas \(/).first()).toBeVisible({ timeout: 10000 });
  });
});
