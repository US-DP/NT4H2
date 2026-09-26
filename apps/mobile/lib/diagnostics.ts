/**
 * diagnostics — diagnóstico seguro para reportar errores.
 *
 * El stack crudo puede exponer rutas internas, tokens, semillas y datos
 * privados de la partida. `sanitizeDiagnostic` produce un informe
 * estructurado y redactado que el usuario puede compartir sin riesgo:
 *
 *   - mensaje y stack reducidos a la primera línea + frames relativos
 *   - tokens/secretos redactados (patrones hex/base64 largos, params)
 *   - rutas absolutas → nombre de fichero
 *   - URLs → solo host + ruta sin query
 *   - contexto de partida limitado a campos públicos (fase, turno, sala)
 */

import { Platform } from 'react-native';
import { ENGINE_VERSION } from '@nt4h/engine';
import { CATALOG_VERSION } from '@nt4h/catalog';

/** Patrones que se redactan del texto del diagnóstico. */
const SECRET_PATTERNS: [RegExp, string | ((m: string) => string)][] = [
  // tokens hex/base64url largos (auth_token, tickets, api keys)
  [/\b[0-9a-f]{32,}\b/gi, '[REDACTED]'],
  [/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED-JWT]'],
  // query params con credenciales
  [/([?&](?:token|playerToken|authToken|key|secret|ticket)=)[^&\s]+/gi, '$1[REDACTED]'],
  // URLs → host + ruta sin query (regex lineal: sin grupos ambiguos)
  [/https?:\/\/\S+/g, (m: string) => {
    try { const u = new URL(m); return `${u.protocol}//${u.host}${u.pathname}`; }
    catch { return '[URL]'; }
  }],
  // rutas absolutas → nombre de fichero (match acotado, basename en callback)
  [/[A-Za-z0-9_.:\\/-]{3,200}\.(?:ts|tsx|js|jsx|py|json)\b/g, (m: string) => {
    const parts = m.split(/[\\/]/);
    return parts[parts.length - 1] || m;
  }],
  // semillas del RNG
  [/\b(seed|semilla)[=:]\s*["']?[\w-]+["']?/gi, '$1=[REDACTED]'],
];

export interface DiagnosticContext {
  /** Zona de la UI donde ocurrió (p. ej. 'market', 'battlefield'). */
  zone?: string;
  /** Código de error corto estable (p. ej. 'GAME-RENDER-014'). */
  code?: string;
}

export interface SafeDiagnostic {
  code: string;
  message: string;
  stackTail: string[];
  engineVersion: string;
  catalogVersion: string;
  platform: string;
  diagnosticId: string;
  /** Contexto público de partida (fase, turno, sala, revisión). */
  game?: Record<string, string | number | undefined>;
}

function redact(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) {
    out = typeof rep === 'string' ? out.replace(re, rep) : out.replace(re, rep);
  }
  return out;
}

/** Construye un diagnóstico seguro a partir de un error capturado. */
export function sanitizeDiagnostic(
  error: unknown,
  context: DiagnosticContext = {},
  gameContext?: Record<string, string | number | undefined>,
): SafeDiagnostic {
  const err = error instanceof Error ? error : new Error(String(error));
  const frames = (err.stack ?? '')
    .split('\n')
    .slice(1, 6) // primeras 5 frames bastan para localizar
    .map((f) => redact(f.trim()))
    .filter(Boolean);
  const diagnosticId = Array.from({ length: 8 }, () =>
    '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('').replace(/(.{4})(.{4})/, '$1-$2');
  return {
    code: context.code ?? 'GAME-RENDER',
    message: redact(err.message || String(error)).slice(0, 300),
    stackTail: frames,
    engineVersion: ENGINE_VERSION,
    catalogVersion: CATALOG_VERSION,
    platform: Platform.OS,
    diagnosticId,
    game: gameContext,
  };
}

/** Serializa el diagnóstico en texto plano compacto para el portapapeles. */
export function formatDiagnostic(d: SafeDiagnostic): string {
  const lines = [
    `NT4H ${d.code} · ${d.diagnosticId}`,
    `motor ${d.engineVersion} · catálogo ${d.catalogVersion} · ${d.platform}`,
    d.message,
  ];
  if (d.game) {
    const ctx = Object.entries(d.game)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    if (ctx) lines.push(`ctx: ${ctx}`);
  }
  if (d.stackTail.length) lines.push(...d.stackTail);
  return lines.join('\n');
}
