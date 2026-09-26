/**
 * Importación segura de assets del Taller.
 */

import { describe, it, expect } from 'vitest';
import { validateImageBytes, MAX_IMAGE_BYTES } from '../lib/assetImport';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('assetImport — magic bytes y rechazos', () => {
  it('acepta PNG/JPEG/WebP por magic bytes', () => {
    expect(validateImageBytes(PNG).mime).toBe('image/png');
    expect(validateImageBytes(JPG).mime).toBe('image/jpeg');
    expect(validateImageBytes(WEBP).mime).toBe('image/webp');
  });

  it('rechaza SVG siempre (puede contener <script>)', () => {
    const r = validateImageBytes(SVG);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('svg-rejected');
  });

  it('rechaza GIF y formatos no soportados', () => {
    expect(validateImageBytes(GIF).ok).toBe(false);
    expect(validateImageBytes(GIF).reason).toBe('unsupported-format');
  });

  it('rechaza archivos vacíos y sobredimensionados', () => {
    expect(validateImageBytes(new Uint8Array(0)).reason).toBe('empty');
    expect(validateImageBytes(new Uint8Array(MAX_IMAGE_BYTES + 1)).reason).toBe('too-large');
  });

  it('detecta EXIF en JPEG', () => {
    const withExif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0x10, ...new TextEncoder().encode('Exif\x00\x00'), 1]);
    expect(validateImageBytes(withExif).hasExif).toBe(true);
    expect(validateImageBytes(JPG).hasExif).toBe(false);
  });
});
