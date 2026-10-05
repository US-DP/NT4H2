# Auditoría de código — NT4H2 (2025, solo lectura)

Auditoría multi-dominio ejecutada sobre el monorepo sin modificar
código: engine-runner e infraestructura, backend Django y motor de
reglas determinista (segundo pase tras correcciones). Cada sección es
un informe independiente con hallazgos verificados con evidencia.

> Nota de procedencia: el transcript completo de la sesión de
> auditoría se conserva en
> [`audit-2025-session-transcript.md`](audit-2025-session-transcript.md).
> El informe del motor quedó truncado en la fuente original; el punto
> de corte se marca al final de su sección.

## Alcance cubierto

| Dominio | Informe | Hallazgos |
|---|---|---|
| `apps/engine-runner` + contratos + infra/Docker | §1 | R-*, C-*, I-*, O-* |
| `apps/backend` (Django + Channels) | §2 | B-* |
| `packages/engine` (motor determinista) | §3 | E-* |
| `apps/mobile` | — | sin informe (subagente no reportó) |

## Hallazgo propio de la sesión (engine-runner)

En `loadPersistedRooms`/`/restore` el runner **nunca restaura el
`seq` global del motor** — tras un reinicio, `nextSeq()` reemite
valores ya usados en `eventLog` (seqs duplicados → `sync?after=` y
la ordenación de `GameEvent` rotas).

---

# Auditoría engine-runner + contratos + infra — NT4H2 (solo lectura)

## Resumen ejecutivo

El código está notablemente maduro: la mayoría de los vectores pedidos ya están mitigados y documentados (path traversal en `snapshotPath`, XFF spoofing, `unknown_player`, 413, flush en `GAME_ENDED`, dedup persistente por cid, tickets WS). Los hallazgos restantes son de contorno: un `pnpm install` que probablemente rompe el build Docker por el patch de `expo-image`, un script `start` que produce un artefacto no ejecutable, divergencia de sanitización cliente/servidor en `supportDecks`, el contenedor corriendo como root, y varios bordes de validación/log.

Descartados tras verificación (falsos positivos del brief): `expectedRevision` races (el handler de `/command` es síncrono, Node single-thread — serialización total), spoofing de `X-Forwarded-For` en el backend (honrado solo desde `TRUSTED_PROXY_IPS`, `_common.py:96-107`), restore sin auth (lleva `requireEngineAuth`, `server.ts:757`), BoundedCidSet vs dedup (la dedup real es la `UniqueConstraint(session,cid)` de Postgres — la ventana de 500 es solo caché), coste de `Rng.deserialize` por comando (solo serialize por comando + deserialize en fallo — trivial), `roomId` con `\n` en logs (todas las rutas que loguean `roomId` validan `roomIdSchema` antes o el id viene de `rooms` map).

---

## Hallazgos

### R — engine-runner (`apps/engine-runner/server.ts`)

**R-1 · Validación/schema · Severidad: Media · Confianza: Alta**
`cidSchema` y `idSchema` (líneas 73-82) solo limitan longitud; permiten `\n`, `\r`, ANSI, unicode de control. `cid` se interpola en `console.error(\`command ${cid} en ${roomId} failed\`)` (línea 705) y viaja a `GameEvent.data`/logs del backend. Actual: `z.string().min(1).max(128)` sin restricción de charset. Esperado: `[A-Za-z0-9:_-]` o al menos rechazo de control chars. Repro: POST `/rooms/r1/command` con `cid="x\n[FORGED] admin"` y comando inválido en `execute` → línea forjada en log. Fix: `z.string().regex(/^[\x21-\x7e]{1,128}$/)` en cid/playerId.

**R-2 · Robustez · Severidad: Baja-Media · Confianza: Alta**
`loadPersistedRooms()` (líneas 351-410) no respeta `MAX_ROOMS`: un `STATE_DIR` con N ficheros los carga todos al arrancar. Además el `roomId` derivado del filename (`file.slice(0,-5)`, línea 381) no se valida contra `roomIdSchema` — un fichero `weird\u202ename.json` creado por otro proceso entra al mapa y se usa en logs y en `dropRoom` (`key.startsWith(\`${roomId}:\`)`). Repro: crear 1500 ficheros JSON válidos en STATE_DIR → arranque lento/OOM. Fix: cortar al llegar a `MAX_ROOMS` y `if (!roomIdSchema.test(roomId))` → renombrar a `.corrupt-*`.

**R-3 · Confiabilidad · Severidad: Media · Confianza: Media**
Respuesta de dedup `{accepted:true, events:[], cached:true, revision}` (línea 597) no incluye `stateChanged:true`. El consumer mapea `stateChanged` → `false` en el broadcast `game.command_result` (consumers.py:442). Si la respuesta original se perdió (timeout del backend, `_post_idempotent` reintentó) y el broadcast original nunca llegó, los OTROS clientes nunca saben que deben re-pedir la vista — solo el emisor recibe el ack con revision. Repro: `kill -9` al runner tras aplicar el comando pero antes de responder; el reintento devuelve `cached` → broadcast con `stateChanged:false`. Fix: incluir `stateChanged:true` en la rama cached (el estado sí cambió por ese cid).

**R-4 · Validación · Severidad: Baja · Confianza: Alta**
`/restore` acepta `snap.revision` negativo/`NaN`/`Infinity` (línea 792: solo `typeof === 'number'`) y `lastClientSeq` con valores no numéricos (línea 800, `Object.entries` sin filtrar). Un `lastClientSeq` con valor `NaN` queda en el mapa y `clientSequence <= NaN` es siempre `false` → el anti-reordenado queda silenciosamente desactivado para ese jugador. Fix: `Number.isSafeInteger(v) && v >= ...[6006 chars truncated]...kages/). Un cambio solo en el lockfile no corre ningún gate de engine. Node 20 en CI vs `node:22-alpine` en Dockerfile — divergencia de versión no testeada. Fix: añadir paths `pnpm-*.yaml`, `turbo.json` y alinear `node-version` (o usar `node-version-file`/`packageManager`).

**I-7 · turbo · Severidad: Baja · Confianza: Alta**
`turbo.json` `test.dependsOn: ["^build"]` — pero los paquetes `@nt4h/*` no tienen build real (`main: src/index.ts`), así que `turbo run test` ejecuta builds vacíos/no-ops y la caché de `test` puede quedar invalidada por razones espurias (inputs por defecto incluyen todo el repo). `lint: {}` sin dependsOn está bien. Menor: `@nt4h/backend` se incluye en el workspace turbo — `turbo run dev` lanzaría `python manage.py runserver` dentro de `pnpm dev`, potencialmente bloqueante/`persistent`. Verificar que `turbo run dev` en raíz no arranque el backend inesperadamente.

### C — Config/backend (confirmaciones + bordes)

**C-1 · Config · Severidad: Baja · Confianza: Alta**
`ROOM_RATE_LIMIT_MAX` se traduce a `settings.ROOM_RATE_LIMIT_MAX` (settings.py:189-191) pero `int(env)` sin try → un valor no numérico crashea el arranque de Django (mientras `ROOM_RATE_LIMIT_<SCOPE>` sí tolera `ValueError`, _common.py:132-136). Inconsistencia: el override global es más frágil que los por-scope. Fix: envolver en try/except con warning.

**C-2 · Config · Severidad: Informativa · Confianza: Alta**
`TRUSTED_PROXY_IPS` se lee en `_common.py:92` por llamada (`os.environ.get` cada request → set nuevo por hit de rate-limit; trivial). `REDIS_URL` correctamente fail-closed en producción (settings.py:180-184). `ENGINE_RUNNER_TOKEN` fail-closed en ambos lados (server.ts:176-185, settings.py:178). Nada que corregir salvo cachear el set de proxies.

**C-3 · Dedup/eventos · Severidad: Baja · Confianza: Media**
Backend `persist_event` (consumers.py:558-603): si el `cid` excede `max_length` de la columna `GameEvent.cid` (verificar `models.py` — el consumer no acota `cid`; el runner acepta hasta 128), el `IntegrityError` es interpretado como "colisión de cid", entra en el bucle, y si no hay registro previo devuelve `(None, False)` → el ack se envía pero el evento no queda registrado. Además `_command_seen` filtra `cid=cid` exacto — cid más largo que la columna nunca deduplica. Fix: `cid = cid[:128]` al validar en consumer (consumers.py:274 ya valida tipo pero no longitud).

### Raíz / huérfanos

**O-1 · Informativa · Confianza: Alta**
`_check_mojibake.py` NO existe en la raíz (no encontrado por glob/grep) — el brief lo suponía huérfano; confirmado ausente, nada que reportar. `scripts/` (`audit_catalog.py`, `check-complexity.py`, `gen_traceability.py`, `promote_verified.py`, `verify_cards_ocr.py`) están referenciados en AGENTS.md como vivos; no verifiqué sus rutas internas una a una — recomendación: ejecutar `python scripts/check-complexity.py` para confirmar que no apuntan a rutas movidas.

---

## Recomendaciones priorizadas

1. **I-1**: `COPY patches ./patches` en el Dockerfile (bloqueante potencial) + job de docker build en CI (I-4).
2. **I-2**: `USER node` en la imagen.
3. **R-1**: charset whitelist en `cidSchema`/`idSchema` (log forging).
4. **X-1**: añadir `supportDecks` a `sanitizeOnlineState` (paridad cortafuegos).
5. **R-3**: `stateChanged:true` en la respuesta de cid cacheado.
6. **I-3**: corregir `start`/`build` del runner (artefacto no ejecutable).
7. Menores: R-4 (NaN en revision/lastClientSeq), R-2 (MAX_ROOMS + roomIdSchema en load), C-1 (try en `ROOM_RATE_LIMIT_MAX`), I-5/I-6 (pinning y paths CI).

**No pude ejecutar**: `pnpm install`/`docker build` para confirmar I-1 a ciencia cierta (solo lectura, sin shell) — la confianza es media por eso; el padre debería verificar con un `docker build` real. Tampoco leí `models.py` para confirmar `max_length` de `GameEvent.cid` (C-3) ni audité los scripts Python de raíz internamente (O-1).

---

[Background subagent with agent_id=31e485b3 completed]

He revisado a fondo `consumers.py`, `views/*`, `models.py`, `engine_client.py`, `settings.py`, `urls.py`, `accounts/*` y el inventario de tests. Informe de auditoría (solo lectura, nada modificado).

---

# Auditoría backend Django — NT4H2

## Hallazgos

### B-1 — `create_room` sin `@csrf_exempt` → 403 en producción
- **Tipo:** bug funcional / seguridad-config | **Severidad:** ALTA | **Confianza:** alta
- **Archivo:** `game/views/rooms.py:274` (`def create_room`) — es la única vista POST de `game.views` sin el decorador (comparar con `join_room:559`, `leave_room:592`, `set_ready:732`, `start_room:816`, `close_room:871`, `ws_ticket` en `engine.py:320`, `stats_report` en `stats.py:28`).
- **Actual:** `CsrfViewMiddleware` (activo en `settings.py:59`) rechaza cualquier POST sin token CSRF. Los tests usan `Client(enforce_csrf_checks=False)` → pasan. En producción el cliente Expo no envía cookie CSRF → `POST /api/rooms/` devuelve 403.
- **Esperado:** `@csrf_exempt` como el resto (la auth es por token, no por cookie — CSRF no aplica).
- **Repro:** POST real (curl/fetch sin `X-CSRFToken`) a `/api/rooms/` con `DEBUG=False` → 403.
- **Fix:** añadir `@csrf_exempt` a `create_room`.

### B-2 — `room_exists(room_id)` llamado con argumento → TypeError en connect de espectador
- **Tipo:** bug | **Severidad:** media | **Confianza:** alta
- **Archivo:** `game/consumers.py:65` vs firma en `consumers.py:605-608` (`def room_exists(self)` — sin parámetro, usa `self.room_id`).
- **Actual:** para un espectador que conecta a una sala inexistente se ejecuta `await self.room_exists(room_id)` → `TypeError` → el `connect` aborta con excepción (cierre sucio, log de error) en vez del `4404` previsto.
- **Esperado:** `await self.room_exists()` (como en la línea 86 para tickets).
- **Fix:** quitar el argumento.

### B-3 — TOCTOU en `set_ready`: el jugador expulsado puede resucitar su fila
- **Tipo:** concurrencia | **Severidad:** media-alta | **Confianza:** alta
- **Archivo:** `game/views/rooms.py:733-761`.
- **Actual:** `_verify_player` lee el `Player` FUERA del lock (línea 741). Un `kick_player` concurrente borra la fila entre la verificación y el `transaction.atomic()` de línea 757. Dentro del lock se hace `player.is_ready = ready; player.save(update_fields=["is_ready"])` — `save()` sobre una instancia cuyo pk ya no existe ejecuta UPDATE (0 filas) → **fallback INSERT** (comportamiento de Django), resucitando al expulsado con su `auth_token` intacto. El comentario de línea 755-756 afirma lo contrario, pero el check está fuera del lock.
- **Esperado:** re-`SELECT` del `Player` con `select_for_update()` dentro del atomic y 403 si desapareció.
- **Repro:** carrera `kick` + `ready` simultáneos (threading test).
- **Fix:** dentro del atomic: `player = Player.objects.filter(session=session, player_id=player_id).first()` → 404 si None.

### B-4 — Sala PLAYING re-marcada/borrada por el reaper sin lock ni re-check
- **Tipo:** concurrencia | **Severidad:** media | **Confianza:** media-alta
- **Archivo:** `game/views/_common.py:455-470` (`stale_playing`) y `471-489`.
- **Actual:** `stale_playing` anota `last_event_at` en el queryset y luego escribe `status="FINISHED"` + `delete_room()` por fila sin `select_for_update`. Entre la evaluación del annotate y el `save` puede aterrizar un comando real → la sala se cierra y se borra del runner en mitad de la partida. Igual para el borrado de WAITING/FINISHED: un `join`/`leave` concurrente choca con `session.delete()` (p. ej. `_apply_join` hace `select_for_update().get(pk)` → `DoesNotExist` → 500).
- **Esperado:** re-verificación bajo `select_for_update` (status + cutoff) antes de mutar/borrar; capturar `DoesNotExist` en consumidores.
- **Fix:** envolver cada sesión en `transaction.atomic()` con re-check dentro.

### B-5 — `updated_at` no es proxy fiable de actividad → rea...[15497 chars truncated]...en `_execute_command_request` del consumer (`consumers.py:464-476`) y su carrera doble-restore (B-12).
  - `leave_room` en PLAYING (games_abandoned, abort por sala vacía, veto-vs-leave del host) — hay `test_leave_last_player_closes_room` pero no mid-game.
  - `persist_event` agotando reintentos / colisión de seq (B-9).
  - Carrera kick↔ready (B-3) y reap↔join (B-4).
  - `_rejoin_player` con cambio de `customDeck` y conflicto `ownerPlayerId` (409 de `_register_custom_deck`).
  - `MeView.patch` errores (avatar inválido, display_name colisión) y `PlayerStatisticsView` 404/ajeno.
  - Reaper: transición PLAYING→FINISHED con actividad reciente al límite (test `test_reap_playing_uses_event_activity` existe — parcial).

### B-25 — Rutas/vistas potencialmente muertas (verificar con mobile)
- **Tipo:** dead code | **Severidad:** informativa | **Confianza:** baja (requiere cruzar con `apps/mobile`)
- `POST /api/stats/report/` y `GET /api/stats/community/` — opt-in; verificar que el cliente envía informes.
- `transfer-host`, `unkick` — documentadas; verificar uso real en mobile.
- `health_check` sin rate-limit (trivial, probablemente sondeo de infra).
- `GameEvent` se acumula sin pruning por sala FINISHED (el reaper borra la sala a las 24 h — los eventos caen en cascada; ok por diseño, pero una sala PLAYING eterna sin reaper podría crecer sin límite — mitigado por ROOM_PLAYING_GC_HOURS).

### B-26 — `chat.message` en WAITING persiste GameEvents para siempre hasta reap (30 min sin conectados)
- **Tipo:** recursos | **Severidad:** baja | **Confianza:** alta
- **Archivo:** `consumers.py:182-185`, `235-270`.
- **Actual:** el chat solo se bloquea en FINISHED; en WAITING/PLAYING cada mensaje es un `GameEvent` durable con `select_for_update` sobre la sesión — el lock de sesión convierte el chat en punto de serialización con comandos de partida (cada chat bloquea el next `MAX(seq)`). 5 msg/5 s por conexión × 4 jugadores = presión de locks innecesaria sobre la misma fila que serializa comandos.
- **Fix:** persistir chat sin lock de sesión (seq en tabla aparte o sin seq), o no persistir chat (solo broadcast).

### B-27 — `hmac.compare_digest` sobre strings con longitudes distintas: ok; pero `_verify_player_or_host` permite al HOST ejecutar `leave` ajenas incluso en PLAYING si coincide token — ya bloqueado por el check de línea 624-626 (exige token del propio jugador en PLAYING). ✅ descartado como falso positivo — verificado.

### Falsos positivos descartados
- `unique_together (session, player_id)` + joins concurrentes: cubierto por `select_for_update` en `_apply_join`.
- Tokens en URL: retirado (tickets).
- Broadcast de eventos/manos: ya filtrado (`game.command_result` sin events, chat no a espectadores).
- `SECRET_KEY`/`DEBUG`/`REDIS`/`ENGINE_RUNNER_TOKEN`: fail-closed en producción.
- Host transfer en disconnect: implementado y con lock.
- CSRF en DRF views de accounts: no necesario (JWT por header, no cookies).
- `seed` en respuestas: nunca sale de `to_dict`.

## Recomendaciones prioritarias
1. **B-1** (bloqueo total de `create_room` en prod) y **B-2** (TypeError en connect espectador) — fixes de una línea.
2. **B-3 + B-4 + B-5** — endurecer TOCTOU y el proxy de actividad del reaper (añadir `updated_at` al bump de revisión).
3. **B-10/B-12** — tratar 409 de restore como éxito; cap de body de respuesta del runner.
4. **B-6** — reaper PLAYING→FINISHED vía `mark_finished` para no perder stats/snapshot.
5. Mover `_WS_TICKETS`/`_RATE_LIMITS`/`_SPECTATOR_COUNTS` a Redis compartido antes de multi-worker (B-17).

## No verificado (requiere el repo del cliente mobile / engine-runner)
- Qué endpoints REST consume realmente `apps/mobile` (candidatos a dead code: B-25).
- Contrato exacto de `CreateRoomSchema`/`idSchema` en `apps/engine-runner` para confirmar paridad de validación (B-18).
- No pude ejecutar tests ni linters (modo solo lectura, sin shell).

---

# Auditoría del motor determinista — segundo pase (post-correcciones)

Investigación completada. Leí los handlers completos, reducers, `execute.ts`, `resolveChoice.ts`, `phases/engine.ts` + `steps/hordeAttack.ts`, `projection/index.ts`, `replay/index.ts`, `setup.ts`, `solo.ts`, `registry.ts`, `triggers/index.ts`, `catalog/{loader,effects}.ts` y `schema/card.ts`. Hallazgos reales, con evidencia:

---

## Hallazgos

### E-1 — Divergencia live/fold: eventos de oyentes aplicados sobre el estado final, no en su posición del log
- **Tipo**: event-sourcing / fold divergence · **Severidad**: Alta · **Confianza**: Alta
- **Archivo**: `packages/engine/src/commands/execute.ts:419-445`
- **Actual**: los eventos de oyente (`dev`) se aplican con `applyEvent(s, dev)` sobre `s = result.newState` (estado tras **todos** los eventos del comando), pero en `emitted` se insertan justo tras su disparador. Un oyente que reacciona al evento N ve (y muta) el estado que incluye los eventos N+1..M.
- **Esperado**: el estado vivo debe ser idéntico al fold del `eventLog`.
- **Evidencia**:
  ```ts
  let s = result.newState;
  for (const ev of result.events) {
    emitted.push(ev); foldState = applyEvent(foldState, ev);
    const dl = dispatchListeners(foldState, ev, ...);
    for (const dev of dl.events) { emitted.push(dev); s = applyEvent(s, dev); }
  }
  ```
- **Repro**: REGISTER_LISTENER sobre `DAMAGE_DEALT` que emite `DAMAGE_DEALT` al mismo enemigo; si el evento N+1 era `ENEMY_DEFEATED` de ese enemigo, el daño del oyente es no-op en vivo (enemigo ya fuera) pero en replay se aplica (enemigo aún presente tras N). Estados divergen.
- **Fix incremental**: reconstruir `s` plegando `emitted` desde `state` (mismo patrón que `executeCommand`), en vez de aplicar los dev sobre el estado final.

### E-2 — Las `pendingChoices` nunca se event-sourcean (no existe evento `PENDING_CHOICE_CREATED`)
- **Tipo**: event-sourcing · **Severidad**: Alta (para `replayFromSnapshot`/fold del eventLog) · **Confianza**: Alta
- **Archivos**: `execute.ts:556, 635-670, 944`; `phases/engine.ts:118, 163, 199-211`; `resolveChoice.ts:180, 252, 542, 647, 755`; `setup.ts:760-769`. Grep confirma que solo existe `PENDING_CHOICES_REMOVED` en todo `packages/`.
- **Actual**: todas las elecciones se añaden por mutación directa. `replayFromSnapshot(snapshot, events)` no puede reconstruir ninguna elección pendiente; solo el replay por comandos las regenera.
- **Fix**: emitir `PENDING_CHOICE_CREATED` (con el payload del PendingChoice) y un reducer que lo inserte; o documentar que el fold de eventos no reproduce `pendingChoices`.

### E-3 — `isLegal(PLAY_CARD)` no bloquea elecciones obligatorias pendientes
- **Tipo**: resolver/legalidad · **Severidad**: Media · **Confianza**: Alta
- **Archivo**: `execute.ts:52-107` (vs. `END_ATTACK`:118, `EVASION`:155, `END_TURN`:220, que sí lo hacen). `BUY_CARD` tampoco (161-208).
- **Actual**: un jugador puede jugar otra carta con una `pendingChoice` `minSelections>0` sin resolver (p.ej. un `CHOOSE_ONE`/`SELECT_ORDER` de la carta anterior). La elección queda resoluble más tarde con contexto obsoleto (estado ya mutado por la segunda carta).
- **Repro**: carta con `CHOOSE_ONE` → `PLAY_CARD` de otra carta se acepta; luego `RESOLVE_CHOICE` resuelve la rama contra un estado distinto del que la generó.
- **Fix**: mismo guard `state.pendingChoices.some(c => c.playerId === playerId && c.minSelections > 0)` en `PLAY_CARD` (y considerar `BUY_CARD`).

### E-4 — `INTERCEPT_DAMAGE` (pericia de Valèrys/Lisavette) intercepta al primer jugador de `playerOrder`, no al objetivo del ataque
- **Tipo**: handler / parámetro ignorado · **Severidad**: Media-Alta en 3+ jugadores · **Confianza**: Media-Alta
- **Archivo**: `effects/handlers/damage.ts:253-265`; `registry.ts:437-438`
- **Actual**: `resolveHeroTargets('OTHER_HERO')` devuelve **todos** los demás y el handler toma `fromIds[0]` — el primero de `play...[2188 chars truncated]...DAMAGE_TO_HERO`).
- **Actual**: el mismo selector en `GAIN_COINS`, `TAKE_WOUNDS`, `INTERCEPT_DAMAGE`, etc. cae al fallback determinista silencioso sin pendingChoice — comportamiento inconsistente entre tipos de efecto.
- **Fix**: generalizar la detección de empate a todo efecto con `HeroSelector`.

### E-8 — `applyStatusApplied`: re-aplicar un estado existente no refresca la duración
- **Tipo**: reducer fidelity · **Severidad**: Baja-Media · **Confianza**: Alta
- **Archivo**: `events/reducers/flow.ts:339-343`
- **Actual**: al acumular stacks se conserva la `duration` original; un `APPLY_STATUS{duration:UNTIL_END_OF_TURN}` seguido de uno `PERMANENT` (o viceversa) deja la duración del primero. Diverge si el emisor esperaba "última duración gana".
- **Fix**: definir la política (max/primera/última) y aplicarla en el reducer.

### E-9 — `applyArmorGranted`: la segunda `ARMOR_GRANTED` sobrescribe `armorExpiry` de toda la armadura acumulada
- **Tipo**: reducer fidelity · **Severidad**: Baja · **Confianza**: Alta
- **Archivo**: `events/reducers/combat.ts:331-336`
- **Actual**: `armor` se suma pero `armorExpiry` se reemplaza con la del último evento — una armadura `PERMANENT` seguida de una `UNTIL_END_OF_TURN` (o al revés) pierde/eterniza todo el pool.
- **Fix**: tratar la armadura por tramos (lista) o priorizar `PERMANENT`.

### E-10 — Proyección: `PENDING_CHOICES_REMOVED` expone `choiceIds` a espectadores/otros jugadores
- **Tipo**: projection / info leak · **Severidad**: Baja-Media · **Confianza**: Alta
- **Archivo**: `projection/index.ts:21-31, 289-311` (no está en `PRIVATE_EVENT_TYPES` ni se redacta)
- **Actual**: los ids son semánticos (`feldon-reduce-<turno>-<playerId>`, `trap-<seq>`, `cemenmar-steal-<turno>`, `lisavette-*`, `reaction-<pid>-<seq>`): cualquier espectador infiere qué elecciones existieron y fueron podadas (p.ej. eliminación de un jugador con reacción pendiente).
- **Fix**: añadirlo a la sanitización (ocultar ids, conservar count) o hacer los choiceIds opacos.

### E-11 — Proyección: `DECK_SHUFFLED`/`DECK_RESHUFFLED` se ocultan también al dueño del mazo
- **Tipo**: projection / over-filtering · **Severidad**: Baja · **Confianza**: Alta
- **Archivo**: `projection/index.ts:298-302`
- **Actual**: el propio jugador nunca ve en su `eventLog` que su mazo se barajó/recicló (la UI no puede mostrar "mazo agotado → reciclaje").
- **Fix**: filtrar `newOrder` para el dueño pero conservar el evento redactado.

### E-12 — `OVERKILL_DAMAGE`: el spill se calcula sin el bonus/mark incluido en el `DAMAGE_DEALT` emitido
- **Tipo**: handler / consistencia de cálculo · **Severidad**: Baja-Media · **Confianza**: Media
- **Archivo**: `effects/handlers/damage.ts:323-346`
- **Actual**: `over = amount - remaining` donde `amount` excluye `getEnemyDamageBonus(enemy) + mark.bonus` que sí suma el evento principal; con vulnerabilidad/marca el sobrante queda infra-computado respecto al daño realmente aplicado. (La semántica deseada — ¿el bonus cuenta para el exceso? — es ambigua, pero el comentario 311-314 afirma alinearlo y no lo hace del todo.)
- **Fix**: decidir si el bonus entra en `over` y alinear ambos cálculos.

### E-13 — `isLegal(PLAY_CARD)` no valida la clase del objetivo ni la obligatoriedad del `target`
- **Tipo**: resolver/legalidad · **Severidad**: Baja-Media · **Co

---

> **Corte de la fuente**: el informe del motor determinista quedó
> truncado en la línea anterior (E-13 incompleto); los hallazgos
> E-14+ y la sección de cierre no llegaron a escribirse. El
> transcript (`audit-2025-session-transcript.md`) termina en el mismo
> punto — no hay más contenido que recuperar.
