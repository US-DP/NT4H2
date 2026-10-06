// Captura todas las secciones y fases de la app para docs/assets/screenshots/.
// Requisitos: `pnpm web` en apps/mobile (localhost:8081) y playwright instalado.
// Uso: node tools/capture-screenshots.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../docs/assets/screenshots/');
const BASE = process.env.APP_URL || 'http://localhost:8081';

const ROUTES = [
  ['/(auth)', 'auth.png'], ['/(content)', 'content.png'], ['/(create)', 'create.png'],
  ['/(play)', 'play-menu.png'], ['/(room)', 'room-lobby.png'], ['/rooms', 'rooms-list.png'],
  ['/(rulebook)', 'rulebook.png'], ['/(stats)', 'stats.png'], ['/(study)', 'workshop.png'],
  ['/(profile)', 'profile.png'], ['/(replay)', 'replay.png'], ['/(dev)/showcase', 'showcase.png'],
  ['/', 'home.png'], ['/(library)', 'library.png'],
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = async (name, ms = 1200) => { await page.waitForTimeout(ms); await page.screenshot({ path: OUT + name }); console.log('ok', name); };

const clickVis = async (re, ms = 2200) => {
  const m = page.locator('button, [role="button"], a, div[tabindex="0"]').filter({ hasText: re });
  const n = await m.count();
  for (let i = 0; i < Math.min(n, 20); i++) {
    const el = m.nth(i);
    if (await el.isVisible().catch(() => false)) { await el.click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(ms); return true; }
  }
  return false;
};
const body = async () => (await page.locator('body').innerText()).slice(0, 250);
const settle = async () => { for (let i = 0; i < 6; i++) if (!(await clickVis(/Estoy listo/, 1800))) break; };

// --- Rutas estáticas ---
for (const [r, name] of ROUTES) {
  try { await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 30000 }); await shot(name); }
  catch (e) { console.log('FAIL', name, e.message.slice(0, 80)); }
}

// --- Reglamento: detalle de capítulo ---
try {
  await page.goto(BASE + '/(rulebook)', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  const link = page.locator('a, [role="link"], [role="button"]').filter({ hasText: /turno|ataque|horda/i }).first();
  if (await link.count()) { await link.click(); await shot('rulebook-detail.png'); }
} catch { /* opcional */ }

// --- Colección: detalle de carta ---
try {
  await page.goto(BASE + '/(library)', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1800);
  const card = page.locator('[role="button"], a').filter({ hasText: /Aranel|Fuego|Disparo/i }).first();
  if (await card.count()) { await card.click(); await shot('library-card-detail.png', 1500); }
} catch { /* opcional */ }

// --- Partida local: puja de líder -> ataque -> mercado -> horda ---
try {
  await page.goto(BASE + '/(play)', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  await clickVis(/Partida rápida/, 4000);
  await page.screenshot({ path: OUT + 'game-privacy.png' });
  await settle();
  for (let p = 0; p < 2; p++) {
    const opts = page.locator('text=/\\(Atq \\d\\)/');
    const n = await opts.count();
    for (let i = 0; i < n; i++) {
      if (await opts.nth(i).isVisible().catch(() => false)) { await opts.nth(i).click({ timeout: 2500 }).catch(() => {}); break; }
    }
    await page.waitForTimeout(500);
    await clickVis(/Pujar/, 2200);
    await settle();
  }
  await settle();
  await page.waitForTimeout(1000);
  if (/Elección|Turno \d/.test(await body())) await shot('game-board.png', 300);

  let hordeShot = false;
  for (let step = 0; step < 30; step++) {
    // Entre elección y elección el hot-seat muestra "Estoy listo" (pantalla de
    // privacidad al pasar el dispositivo): hay que quitarla dentro del bucle o
    // ningún patrón de click casa y la partida se aborta en el primer cambio
    // de jugador.
    await settle();
    const txt0 = await body();
    console.log('  step', step, JSON.stringify(txt0.slice(0, 80)));
    // El asalto de la Horda se captura desde su UI real, nunca por texto del
    // log (que ya decía "la Horda" en fase Mercado). Tres vías:
    //  - ventana de reacción: botón "Usar pericia"
    //  - resumen abierto: botón "Continuar partida"
    //  - fase HORDE_ATTACK sin auto-apertura (modo 'modifiers' sin
    //    modificadores): se pulsa "Ver desglose" del banner para abrir el
    //    modal con el desglose por enemigo.
    // Se busca por texto, no por rol: el Pressable de cierre no declara
    // accessibilityRole.
    const hordeBtn = page.locator('text=/^\\s*(Continuar partida|Usar pericia)\\s*$/').first();
    if (!hordeShot && /Ataque de la Horda|Horda ataca/i.test(txt0)) {
      await clickVis(/Ver desglose/, 2500);
      await page.waitForSelector('text=/Continuar partida|Usar pericia/', { timeout: 5000 }).catch(() => null);
    }
    if (await hordeBtn.isVisible().catch(() => false)) {
      await shot('game-horde.png', 400);
      hordeShot = true;
      await clickVis(/Continuar partida|Pasar/, 2000);
      // Sigue la cadena normal de clicks: la fase debe avanzar, no reabrir
      // el modal en bucle.
    }
    const clicked = await clickVis(/Atac.{0,15}Horda|a la Horda/i, 2500)
      || await clickVis(/Evadir/i, 2500)
      || await clickVis(/Terminar|Pasar|Continuar|Siguiente|Finalizar|mercado/i, 2500);
    if (!clicked) break;
    await settle();
    const txt = await body();
    if (/Elección de ataque/.test(txt)) await shot('game-attack.png', 300);
    if (/Mercado/.test(txt)) await shot('game-market.png', 300);
    if (/Victoria|Derrota|Fin de la partida/i.test(txt)) { await shot('game-end.png', 300); break; }
  }
} catch (e) { console.log('game flow FAIL', e.message.slice(0, 100)); }

// --- Viewport móvil ---
try {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
  await m.waitForTimeout(1500);
  await m.screenshot({ path: OUT + 'mobile-home.png' });
  console.log('ok mobile-home.png');
  await m.close();
} catch { /* opcional */ }

// --- Sala online real: invitación -> formulario -> lobby preparado ---
// Requiere el stack completo (Django :8000 + engine-runner). Si el backend
// no responde se omite sin fallar: las 3 capturas conservan su versión.
const API = process.env.API_URL || 'http://localhost:8000';
try {
  const probe = await fetch(`${API}/api/health/`,
    { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!probe?.ok) throw new Error('backend no disponible');

  // Sala con host creada vía REST (el runner crea la contraparte).
  const created = await fetch(`${API}/api/rooms/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostId: 'shots-host', hostName: 'Anfitrión',
      mode: 'STANDARD', maxPlayers: 2,
      heroes: [{ playerId: 'shots-host', heroId: 'hero.aranel',
                 deckId: 'explorer.default', heroFace: 'FEMALE' }],
    }),
  }).then((r) => r.json());
  if (!created?.roomId) throw new Error(created?.error || 'sin roomId');

  // Deep link de invitación — nunca une automáticamente.
  await page.goto(`${BASE}/rooms/${created.roomId}`,
    { waitUntil: 'networkidle', timeout: 30000 });
  await shot('room-invite.png');

  // Formulario de unirse: héroe + clase + cara (flujo del invitado).
  if (await clickVis(/Unirse a la sala/, 2500)) {
    await shot('room-join-form.png');
    await clickVis(/^Feldon$/, 1200);
    await clickVis(/^Guerrero$/, 1200);
    await clickVis(/^Masculina$/, 1200);
    if (await clickVis(/^Unirse$/, 3500)) {
      await page.waitForTimeout(2000);
      // Preparado: el invitado marca su estado en el lobby.
      await clickVis(/Estoy listo|Preparado/, 2500);
      await page.waitForTimeout(800);
      await shot('room-ready.png');
    }
  }
} catch (e) { console.log('room flow SKIP', e.message.slice(0, 100)); }

await browser.close();
console.log('done');
