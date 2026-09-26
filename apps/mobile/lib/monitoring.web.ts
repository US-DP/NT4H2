/**
 * monitoring.web — noop en web.
 *
 * @sentry/react-native no soporta web; si se quisiera telemetría web
 * habría que integrar @sentry/react aquí con el mismo condicional de DSN.
 */

export function initMonitoring(): void {
  // Sin telemetría en web por ahora
}

export function captureError(_error: unknown, _context?: Record<string, unknown>): void {
  // noop
}
