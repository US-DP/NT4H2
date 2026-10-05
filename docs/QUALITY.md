# Atributos de calidad y presupuestos — NT4H2

Prioridad de atributos (en orden — cuando chocan, gana el de arriba):

1. **Determinismo** — fold(eventLog) ≡ estado vivo, siempre.
2. **Privacidad** — info oculta nunca sale del perímetro del jugador.
3. **Corrección de reglas** — el motor ejecuta las reglas del juego.
4. **Disponibilidad** — la sala sobrevive reinicios de runner/backend.
5. **Latencia** — la partida se siente inmediata.
6. **Escalabilidad** — más salas sin degradar las que corren.
7. **Mantenibilidad** — el contrato es legible y los D### dicen por qué.

## Presupuestos medibles

| Atributo | Presupuesto | Cómo se mide |
|---|---|---|
| Determinismo | 0 divergencias | `pnpm test` engine: replay/replayFromSnapshot en cada comando |
| Privacidad | 0 fugas | tests de proyección por rol (jugador/spectador) + revisión en cada evento nuevo |
| Disponibilidad | sala PLAYING sobrevive restart de runner | restore desde GameSnapshot (test + simulacro) |
| Latencia WS | comando → broadcast < 500 ms p95 | `scripts/loadtest_ws.mjs` + métricas runner |
| GET state | < 300 ms p95 | `/api/rooms/:id/engine/` con token |
| Tamaño snapshot | crece con eventLog — monitorizado; si p95 > 2 MB revisar retención | GameSnapshot.data tamaño |
| Rate limits | `ROOM_RATE_LIMIT_MAX` por IP; runner 30 cmd/10 s por jugador | tests + 429 observados |
| Cobertura | engine 744 · backend 105 · runner 26 — ningún fix sin test | `tools/test_all.*` |

## Decisiones de arquitectura vigentes

- Event-sourced: toda mutación del motor es un evento; los reducers son
  idempotentes y el fold es bit-idéntico al estado vivo.
- Autoridad: el runner decide legalidad (`isLegal`); el backend decide
  identidad; el cliente solo propone.
- Proyección: el cliente nunca ve `full-state`; solo su vista.
- Idempotencia: `cid` deduplica en runner (memoria) y backend (columna).
