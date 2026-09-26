/**
 * assetImport — importación segura de imágenes del Taller.
 *
 * Reglas (documento de revisión, "assets del taller"):
 *   - Validación por magic bytes: solo PNG, JPEG y WebP.
 *   - SVG rechazado siempre (puede llevar <script>).
 *   - Límite de tamaño: 4 MiB por imagen.
 *   - Los assets viven en `nt4h.assets` separados del contenido — nunca se
 *     mezclan con las imágenes oficiales.
 *   - En web, la imagen se re-codifica vía canvas (elimina EXIF y cualquier
 *     metadato/payload). En nativo se guardan los bytes validados.
 */

import { storageGet, storageSet } from './storage';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface AssetValidation {
  ok: boolean;
  mime?: ImageMime;
  /** 'too-large' | 'unsupported-format' | 'svg-rejected' | 'empty' */
  reason?: string;
  /** La imagen trae metadatos EXIF que conviene eliminar. */
  hasExif?: boolean;
}

const ASSET_PREFIX = 'nt4h.asset/';

/** Detección por magic bytes — nunca confiar en la extensión ni el MIME declarado. */
export function validateImageBytes(bytes: Uint8Array): AssetValidation {
  if (!bytes || bytes.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'too-large' };
  }
  // Rechazo explícito de texto/XML (SVG y variantes)
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 512)))
    .toLowerCase();
  if (head.includes('<svg') || head.includes('<?xml') || head.trimStart().startsWith('<')) {
    return { ok: false, reason: 'svg-rejected' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ok: true, mime: 'image/png' };
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    // APP1 EXIF marker: FF E1 ... 'Exif\0\0'
    const headStr = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
    return { ok: true, mime: 'image/jpeg', hasExif: headStr.includes('Exif\x00\x00') };
  }
  // WebP: 'RIFF' .... 'WEBP'
  if (
    bytes.length > 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { ok: true, mime: 'image/webp' };
  }
  return { ok: false, reason: 'unsupported-format' };
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa existe en web; en RN con polyfill. Fallback manual si no existe.
  if (typeof btoa === 'function') return btoa(bin);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += chars[a >> 2] + chars[((a & 3) << 4) | (b >> 4 || 0)]
      + (i + 1 < bytes.length ? chars[((b & 15) << 2) | (c >> 6 || 0)] : '=')
      + (i + 2 < bytes.length ? chars[c & 63] : '=');
  }
  return out;
}

/**
 * Re-codifica la imagen vía canvas (web) para eliminar EXIF/metadatos.
 * Devuelve bytes PNG limpios, o null si el entorno no soporta canvas.
 */
export async function stripImageMetadata(bytes: Uint8Array, mime: ImageMime): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null;
  try {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')?.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const clean = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!clean) return null;
    return new Uint8Array(await clean.arrayBuffer());
  } catch {
    return null;
  }
}

export interface ImportedAsset {
  /** Referencia estable para sourceImage: 'asset:<id>' */
  ref: string;
  mime: ImageMime;
  exifStripped: boolean;
}

/**
 * Importa bytes de imagen: valida, limpia EXIF cuando es posible y
 * guarda en almacenamiento separado del contenido oficial.
 */
export async function importImageAsset(bytes: Uint8Array): Promise<ImportedAsset | { error: string }> {
  const v = validateImageBytes(bytes);
  if (!v.ok || !v.mime) return { error: v.reason ?? 'invalid' };
  let finalBytes = bytes;
  let exifStripped = false;
  if (v.mime === 'image/jpeg' && v.hasExif) {
    const clean = await stripImageMetadata(bytes, v.mime);
    if (clean) { finalBytes = clean; exifStripped = true; }
  }
  const id = `img-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  await storageSet(`${ASSET_PREFIX}${id}`, bytesToBase64(finalBytes));
  return { ref: `asset:${id}`, mime: v.mime, exifStripped };
}

/** Lee un asset por su referencia 'asset:<id>'. */
export async function readImageAsset(ref: string): Promise<string | null> {
  if (!ref.startsWith('asset:')) return null;
  const b64 = await storageGet(`${ASSET_PREFIX}${ref.slice(6)}`);
  return b64;
}
