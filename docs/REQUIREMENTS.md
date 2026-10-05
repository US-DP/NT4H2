# Requisitos — NT4H2

## Funcional

- Motor de juego de ajedrez variante (Némesis Tétrada 4H2) como
  paquete puro: estado de partida, generación de movimientos,
  reglas especiales, validación y serialización (FEN del juego).
- Modos: local, vs bot, online con salas y replays.
- App móvil (React Native/Expo) con UX completa: tablero, historial,
  configuración de partida, accesibilidad y i18n.
- Backend Python: cuentas, partidas online, cola de
  matchmaking/emparejamiento, horda, replay y eventos traducidos.
- Catálogo y esquema compartidos (`packages/catalog`,
  `packages/schema`) para paridad móvil↔backend.

## No funcional

- **Determinismo**: el motor es puro y testeable; mismas entradas →
  mismos resultados (replays verificables).
- **Seguridad**: ver `THREAT_MODEL.md` — tickets WS efímeros,
  proyección de privacidad en eventos, validación en servidor.
- **Accesibilidad**: modo compacto, modos de color (protanopía,
  deuteranopía, tritanopía, alto contraste), target ≥44px,
  labels completos en controles de auth.
- **i18n**: ES/EN en toda la UI; eventos de replay traducidos.
- **Observabilidad**: telemetría y errores de servidor visibles con
  mensajes accionables en la app.

## Fuera de alcance

- Matchmaking con ELO federado entre instancias.
- Cliente web (la UI de referencia es la app móvil).
