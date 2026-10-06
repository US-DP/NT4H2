// Captura docs/assets/screenshots/game-end.png (pantalla Fin de partida).
// Paso 1 — generar la partida finalizada:
//   cd packages/engine && GEN_SAVE=1 SAVE_OUT=/abs/path/game-end-save.json pnpm vitest run _gen-finish
// Paso 2 — con `pnpm web` en apps/mobile (APP_URL si no es :8081):
//   node tools/shot-game-end.mjs
//   SAVE_JSON=… APP_URL=http://localhost:8081 node tools/shot-game-end.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.APP_URL || 'http://localhost:8081';
const SAVE = process.env.SAVE_JSON || join(HERE, 'game-end-save.json');
const OUT = join(HERE, '../docs/assets/screenshots/game-end.png');
const save = JSON.parse(readFileSync(SAVE, 'utf8'));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((s) => {
  localStorage.setItem('nt4h-saved-games', JSON.stringify([s]));
}, save);

await page.goto(`${BASE}/(play)`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
const entry = page.getByText(save.name, { exact: false }).first();
if (!(await entry.isVisible({ timeout: 8000 }).catch(() => false))) {
  throw new Error('la partida guardada no aparece en (play)');
}
await entry.click();
await page.waitForTimeout(4000);
await page.screenshot({ path: OUT });
console.log('ok game-end.png');
await browser.close();
