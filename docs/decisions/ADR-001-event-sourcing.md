# ADR-001: Motor de reglas event-sourced y determinista

**Estado**: aceptada

## Contexto

Un juego de tablero online necesita: replay fiable, auditoría de partidas,
sincronización de clientes tras reconexión, y que el servidor pueda verificar
cada comando sin confiar en el cliente.

## Decisión

El estado del juego es el fold de un log de `GameEvent` con `seq` único y
RNG determinista. Los comandos (`PLAY_CARD`, `END_TURN`…) producen eventos;
los reducers (`applyEvent`) son la única vía autorizada de mutación en la
proyección del estado. Toda mutación directa durante la ejecución se
documenta con un evento de compensación (`PENDING_CHOICES_REMOVED`,
`LEADER_BID_CARDS`…).

## Alternativas

- Estado mutable + snapshots periódicos: simple pero sin auditoría ni
  replay fiel.
- CRDT: innecesario — la autoridad es el runner, no hay escritura
  concurrente distribuida.

## Consecuencias

- Replay y hot-restore exactos; tests `fold-vs-live` como invariante.
- Toda nueva mutación requiere evento + reducer o diverge.
- `rngState` viaja en snapshots para restaurar el stream de azar.
