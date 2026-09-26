/**
 * gen-icons.js — genera los assets base de la app (icon, adaptive-icon,
 * splash, favicon) como PNGs válidos sin dependencias externas.
 *
 * Uso: node scripts/gen-icons.js   → escribe en apps/mobile/assets/
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BG = [0x0f, 0x0f, 0x1e];      // theme.background
const ACCENT = [0xf1, 0xc4, 0x0f];  // theme.accent
const SURFACE = [0x1a, 0x1a, 0x2e]; // theme.surface

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(file, width, height, pixelFn) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filtro None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      const i = rowStart + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  console.log(`${path.basename(file)} ${width}x${height} (${png.length} B)`);
}

/** Icono: fondo oscuro + rombo dorado (emblema) con núcleo oscuro. */
function iconPixel(x, y, w, h) {
  const cx = w / 2, cy = h / 2;
  const d = Math.abs(x - cx) + Math.abs(y - cy);
  const outer = w * 0.36, inner = w * 0.22;
  if (d < inner) return [...SURFACE, 255];
  if (d < outer) return [...ACCENT, 255];
  return [...BG, 255];
}

/** Adaptive icon (Android): mismo motivo con margen de seguridad (zona
 *  visible central ≈ 66%). */
function adaptivePixel(x, y, w, h) {
  const cx = w / 2, cy = h / 2;
  const d = Math.abs(x - cx) + Math.abs(y - cy);
  const outer = w * 0.20, inner = w * 0.12;
  if (d < inner) return [...SURFACE, 255];
  if (d < outer) return [...ACCENT, 255];
  return [...BG, 255];
}

/** Splash: fondo + emblema centrado grande. */
function splashPixel(x, y, w, h) {
  const cx = w / 2, cy = h / 2;
  const d = Math.abs(x - cx) + Math.abs(y - cy);
  const outer = Math.min(w, h) * 0.16, inner = outer * 0.62;
  if (d < inner) return [...SURFACE, 255];
  if (d < outer) return [...ACCENT, 255];
  return [...BG, 255];
}

/** Favicon 48px. */
function faviconPixel(x, y, w, h) {
  const cx = w / 2, cy = h / 2;
  const d = Math.abs(x - cx) + Math.abs(y - cy);
  return d < w * 0.42 ? [...ACCENT, 255] : [...BG, 255];
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
writePng(path.join(outDir, 'icon.png'), 1024, 1024, iconPixel);
writePng(path.join(outDir, 'adaptive-icon.png'), 1024, 1024, adaptivePixel);
writePng(path.join(outDir, 'splash.png'), 1284, 2778, splashPixel);
writePng(path.join(outDir, 'favicon.png'), 48, 48, faviconPixel);
