# Registro de deuda técnica — NT4H2

Deuda viva tras la auditoría y remediación. Cada entrada: qué, por qué
existe, coste si no se paga, trigger para atacarla.

| # | Deuda | Por qué existe | Coste | Trigger para pagarla |
|---|---|---|---|---|
| TD-1 | `RESOLVING_CARD`/`WAITING_FOR_CHOICE` son fases del schema sin uso activo del orquestador (las elecciones usan `pendingChoices`) | Cambiar el flujo a fases dedicadas tocaría `isLegal`, la UI y el replay — el riesgo no compensaba | El grafo de fases declara estados que el runtime nunca entra; confunde al lector | Si se refactoriza la máquina de fases o se añaden elecciones encadenadas complejas |
| TD-2 | `state.eventLog` crece sin límite en memoria, snapshots y GET de estado | La UI usa el log completo (historial, stats de fin de partida) — truncarlo rompe el contrato | Latencia/memoria creciente en partidas largas (O(n) por poll) | Cuando el p95 del GET state supere el presupuesto, o partidas >2 h en producción → deltas por revisión o log paginado |
| TD-3 | Runner mono-instancia (estado en memoria + STATE_DIR) | El diseño online es 1 proceso; escalar exige routing por sala o compartir estado | Toda la carga online cae en un proceso; el reaper es el único GC | >N salas concurrentes sostenidas (medir con `nt4h_runner_rooms`) |
| TD-4 | SQLite en desarrollo; Postgres solo en prod | Simplicidad local | Comportamientos divergentes (constraints, JSON) — mitigado: los tests corren sobre SQLite pero los queries son portables | Cualquier query que dependa de features de Postgres → test en CI con Postgres |
| TD-5 | `ENEMY_DEFEATED` como hecho + `DEFEAT_PLAYER_ENEMY` como instrucción (dos eventos, mismo efecto) | El directo es privado (recompensas ocultas), el foldable es público | Riesgo de divergencia si alguien edita uno y no el otro | Si se toca el flujo de recompensas — unificar con test de paridad |
| TD-6 | `GAME_ENDED` se infiere por snapshot (last_event_type) — no hay evento durable en GameEvent | El fin de partida lo detecta el motor, no el backend | La auditoría de "por qué terminó" depende del snapshot | Si se quiere analítica de fin de partida → persistir GAME_ENDED como GameEvent |
| TD-7 | Autosave local (IndexedDB/AsyncStorage) sin cifrado — guarda manos de todos los jugadores | Hot-seat: el dispositivo ES la frontera de confianza | En un dispositivo compartido, el save expone la partida | Solo si se añade sync de saves a la nube — cifrar con clave por usuario |

## Reglas del registro

- Nada entra sin trigger medible — "mejorar X" no es deuda, es deseo.
- Cada release revisa si algún trigger se disparó.
- La deuda pagada sale del registro (el D### permanece en AGENTS.md).
