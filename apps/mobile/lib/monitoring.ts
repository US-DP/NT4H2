/**
 * monitoring — captura de errores con Sentry (solo nativo).
 *
 * En web se usa monitoring.web.ts (noop). Sentry se inicializa solo
 * si EXPO_PUBLIC_SENTRY_DSN está configurada — sin DSN no hace nada.
 * Carga perezosa para no arrastrar el SDK a tests ni a builds sin DSN.
 */

import { Platform } from 'react-native';
import type * as SentryModule from '@sentry/react-native';
import { sanitizeDiagnostic, formatDiagnostic } from './diagnostics';

export function initMonitoring(): void {
  if (Platform.OS === 'web') return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native') as typeof SentryModule;
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      // No enviar PII: el juego no tiene datos personales, pero por si acaso
      sendDefaultPii: false,
    });
  } catch {
    // SDK no disponible (tests, entorno sin prebuild) — la app sigue sin telemetría
  }
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  // Diagnóstico sanitizado: redacta secretos, rutas y semillas antes de
  // que el error salga del dispositivo (Sentry) o vaya a consola en dev.
  let diagnostic: ReturnType<typeof sanitizeDiagnostic> | null = null;
  try {
    diagnostic = sanitizeDiagnostic(error, {
      code: typeof context?.code === 'string' ? context.code : undefined,
      zone: typeof context?.zone === 'string' ? context.zone : undefined,
    });
  } catch { /* la sanitización nunca debe romper la captura */ }
  if (process.env.NODE_ENV !== 'production' && diagnostic) {
    try { console.error(formatDiagnostic(diagnostic)); } catch { /* noop */ }
  }
  if (Platform.OS === 'web') return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native') as typeof SentryModule;
    Sentry.withScope((scope) => {
      if (diagnostic) {
        // Sentry pide Context ({[k]: unknown}) — SafeDiagnostic es un
        // interface sin index signature; el cast no pierde información.
        scope.setContext('diagnostic', diagnostic as unknown as Record<string, unknown>);
      }
      if (context) scope.setContext('context', context);
      // El error CRUDO puede llevar tokens/semillas/rutas en message y
      // stack — enviar solo la versión sanitizada (conserva nombre y
      // frames relativos para agrupar y localizar).
      const safe = diagnostic
        ? Object.assign(new Error(diagnostic.message), {
            name: error instanceof Error ? error.name : 'Error',
            stack: diagnostic.stackTail.join('\n') || undefined,
          })
        : error;
      Sentry.captureException(safe);
    });
  } catch {
    // ignorar
  }
}
