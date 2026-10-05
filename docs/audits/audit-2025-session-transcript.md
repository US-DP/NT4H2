# Transcript crudo de la sesión de auditoría (2025)

> **No es un documento editado**: conserva íntegro el volcado de la
> sesión (prompt truncado, mensajes de herramienta, notificaciones y
> metadatos del IDE). Se mantiene solo como evidencia de procedencia.
> El informe legible está en
> [`audit-2025-findings.md`](audit-2025-findings.md).

---

actuación.

# 2. Mapa funcional

Enumera las funcionalidades detectadas y clasifícalas como:

- Completa.
- Parcialmente implementada.
- Implementación dudosa.
- No funcional.
- No verificable.

# 3. Hallazgos detallados

Para cada problema utiliza esta plantilla:

## [Identificador] Título del problema

- Tipo:
- Severidad:
- Confianza:
- Esfuerzo:
- Módulo:
- Archivos afectados:
- Líneas relevantes:
- Estado actual:
- Comportamiento esperado:
- Problema detectado:
- Evidencia:
- Pasos para reproducirlo:
- Impacto:
- Causa probable:
- Solución recomendada:
- Pruebas necesarias:
- Dependencias con otros problemas:

Incluye fragmentos pequeños de código únicamente cuando sean necesarios para demostrar el problema.

# 4. Funcionalidades incompletas

Para cada funcionalidad indica:

- Objetivo de la funcionalidad.
- Porcentaje aproximado de implementación.
- Partes terminadas.
- Partes pendientes.
- Bloqueos existentes.
- Archivos implicados.
- Trabajo necesario para completarla.
- Criterios de aceptación.

# 5. Deuda técnica

Agrupa la deuda por áreas:

- Arquitectura.
- Backend.
- Frontend.
- Base de datos.
- Motor o lógica de negocio.
- Infraestructura.
- Seguridad.
- Pruebas.
- Documentación.
- Dependencias.

# 6. Problemas de integración

Comprueba y documenta la coherencia entre:

- Interfaz y lógica.
- Cliente y servidor.
- Servidor y base de datos.
- Modelos y migraciones.
- Tipos compartidos.
- Documentación e implementación.
- Configuración de desarrollo y producción.

# 7. Cobertura de pruebas

Indica:

- Qué partes tienen pruebas.
- Qué partes carecen de pruebas.
- Qué pruebas fallan.
- Qué flujos críticos deberían probarse.
- Qué casos límite no están cubiertos.

# 8. Plan de corrección priorizado

Organiza el trabajo en fases:

1. Problemas críticos y de seguridad.
2. Bugs que bloquean funcionalidades principales.
3. Funcionalidades incompletas.
4. Integridad y consistencia de los datos.
5. Estabilidad y control de errores.
6. Pruebas automatizadas.
7. Refactorizaciones.
8. Rendimiento y mejoras opcionales.

Para cada fase indica:

- Objetivo.
- Problemas incluidos.
- Orden recomendado.
- Dependencias.
- Riesgos.
- Resultado esperado.

# 9. Mejoras rápidas

Incluye cambios de alto impacto y bajo esfuerzo que puedan realizarse sin introducir riesgos importantes.

# 10. Aspectos no verificables

Explica qué partes no pudieron comprobarse y qué sería necesario para hacerlo.

## Resultado esperado

El informe debe permitir convertir cada hallazgo en una tarea independiente dentro de un gestor de proyectos.

No hagas cambios todavía. Primero entrega la auditoría completa. Después de presentar el informe, propón un plan de implementación incremental, pero espera instrucciones antes de modificar archivos.

=== MESSAGE 321 - System ===
<additional_metadata>
The user took the following actions after the last message. ONLY talk about this if it is directly relevant to the user's next request. Otherwise prioritize the user's actual request.

<user_actions>
The following changes were made by the USER to: C:\Users\alex0\PycharmProjects\beliber\game\src\main.gd.
[diff_block_start]
@@ -728,9 +728,10 @@
 		if ws_auth:
 			_ws_send({"op": "play", "resign": true})
 		else:
-			# side explícito: sin él el resync asumía que se rindió el
-		# rival (el relay archiva el mv tal cual)
-		_ws_send({"op": "move", "mv": {"resign": true, "side": my_net}})
+			# side explícito: sin él el resync asumía que se rindió
+			# el rival (el relay archiva el mv tal cual)
+			_ws_send({"op": "move",
+				"mv": {"resign": true, "side": my_net}})
 	elif online:
 		_rpc_move.rpc({"from": Vector2i(-1, -1),
 			"to": Vector2i(-1, -1), "resign": true})
[diff_block_end]

Please note that the above snippet only shows the MODIFIED lines from the last change. It shows up to 3 lines of unchanged lines before and after the modified lines. The actual file contents may have many more lines not shown.

The following changes were made by the USER to: C:\Users\alex0\PycharmProjects\beliber\game\src\net_client.gd.
[diff_block_start]
@@ -164,7 +164,7 @@
 	app._ws_cfg = cfg   # memorizada para reconstruir en resync
 	# clamp de índices: una cfg corrupta (relay no la valida) indexaba
 	# fuera de factions[]/setups[] y tumbaba el cliente
-	var nf := app.factions.size()
+	var nf: int = app.factions.size()
 	var f0 := clampi(int(cfg.f0), 0, nf - 1)
 	var f1 := clampi(int(cfg.f1), 0, nf - 1)
 	app.opt_p0.select(f0); app.opt_eq0.select(
[diff_block_end]

Please note that the above snippet only shows the MODIFIED lines from the last change. It shows up to 3 lines of unchanged lines before and after the modified lines. The actual file contents may have many more lines not shown.

The file C:\Users\alex0\PycharmProjects\dnd-companion\backend\app\api\campaigns.py was changed by the USER, but the exact changes are unavailable; re-read the file to see its current content.

The file C:\Users\alex0\PycharmProjects\dnd-companion\backend\app\api\characters.py was changed by the USER, but the exact changes are unavailable; re-read the file to see its current content.

The following changes were made by the USER to: C:\Users\alex0\PycharmProjects\dnd-companion\backend\app\api\operations.py.
[diff_block_start]
@@ -52,7 +52,6 @@
     def __init__(self, state_conn=None, entity_id=None):
         self._state = state_conn
         self.entity_id = entity_id
-        self.entity_id = entity_id
 
     def content_db(self):
         return content_db()
[diff_block_end]

Please note that the above snippet only shows the MODIFIED lines from the last change. It shows up to 3 lines of unchanged lines before and after the modified lines. The actual file contents may have many more lines not shown.

The following changes were made by the USER to: C:\Users\alex0\PycharmProjects\dnd-companion\backend\app\engine\combat_ops.py.
[diff_block_start]
@@ -242,6 +242,21 @@
             "payload": {"combatant": c.model_dump(), "index": idx}}, []
 
 
+@op("combatant.delegate")
+def combatant_delegate(combat: Combat, p: dict, ctx):
+    """El DM cede un NPC/monstruo a un jugador (`player_uid`, None lo
+    retira). El delegado puede mover su token y atacar con él como
+    si fuera su PJ — guard de auth en api/operations."""
+    c = _find(combat, p["combatant_id"])
+    prev = c.delegated_to
+    c.delegated_to = p.get("player_uid")
+    return {"operation_type": "combatant.delegate",
+            "payload": {"combatant_id": c.id, "player_uid": prev}}, [
+            {"type": "combatant.delegated",
+             "payload": {"combatant": c.name,
+                         "player_uid": c.delegated_to}}]
+
+
 @op("combatant.add_raw")
 def combatant_add_raw(combat: Combat, p: dict, ctx):
     """Undo helper: reinsert...[391 chars truncated]...main.py.
[diff_block_start]
@@ -120,7 +120,14 @@
         name = (info or {}).get("username")
         authed = resolved is not None
     elif user_id:
-        resolved = name = user_id   # el id local ya es el nombre
+        # un ?user_id suelto solo acredita identidad en campañas SIN
+        # dueño (modo local puro). Con owner es spoofable: antes
+        # heredaba el rol real del uid suplantado — incluido owner/DM
+        row = state_db().execute(
+            "SELECT owner_id FROM campaigns WHERE id = ?",
+            (campaign_id,)).fetchone()
+        if not (row and row["owner_id"]):
+            resolved = name = user_id   # el id local ya es el nombre
     role = "local"
     if resolved:
         from .api.auth import member_role
[diff_block_end]

Please note that the above snippet only shows the MODIFIED lines from the last change. It shows up to 3 lines of unchanged lines before and after the modified lines. The actual file contents may have many more lines not shown.

The following changes were made by the USER to: C:\Users\alex0\PycharmProjects\dnd-companion\backend\tests\test_diff_features.py.
[diff_block_start]
@@ -142,9 +142,6 @@
     # no ensuciar la content DB real del usuario — el pack del test
     # se desinstala al terminar
     assert client.delete("/api/packages/mi-pack").status_code == 200
-    # no ensuciar la content DB real del usuario — el pack del test
-    # se desinstala al terminar
-    assert client.delete("/api/packages/mi-pack").status_code == 200
 
 
 # --- sesiones, escenas, timeline ---------------------------------------
[diff_block_end]

Please note that the above snippet only shows the MODIFIED lines from the last change. It shows up to 3 lines of unchanged lines before and after the modified lines. The actual file contents may have many more lines not shown.

The following changes were made by the USER to: C:\Users\alex0\PycharmProjects\dnd-companion\backend\tests\test_review_fixes.py.
[diff_block_start]
@@ -1361,11 +1361,7 @@
     assert not any(h["id"] == f"pkg:{child_id}:x" for h in hits)
     # solo packs — una fuente de pipeline no se borra por aquí
     assert client.delete("/api/packages/srd:2014").status_code == 404
-    # limpieza: el test escribe en la content DB REAL del usuario —
-    # sin esto cada pytest dejaba un 'pkg:base-*' huérfano
-    assert client.delete(f"/api/packages/{base_id}").status_code == 200
-    # limpieza: el test escribe en la content DB REAL del usuario —
-    # sin esto cada pytest dejaba un 'pkg:base-*' huérfano
+    # limpieza: sin esto cada pytest dejaba un 'pkg:base-*' huérfano
     assert client.delete(f"/api/packages/{base_id}").status_code == 200
[diff_block_end]

Please note that the above snippet only shows the MODIFIED lines from the last change. It shows up to 3 lines of unchanged lines before and after the modified lines. The actual file contents may have many more lines not shown.

The file C:\Users\alex0\PycharmProjects\dnd-companion\frontend\src\i18n.jsx was changed by the USER, but the exact changes are unavailable; re-read the file to see its current content.

The following changes were made by the USER to: C:\Users\alex0\PycharmProjects\dnd-companion\frontend\src\pages\CampaignBoard.jsx.
[diff_block_start]
@@ -108,7 +108,6 @@
             ev?.type === 'character.hp.changed' ||
             ev?.type === 'character.condition.applied' ||
             ev?.type === 'character.updated' ||
-            ev?.type === 'character.updated' ||
             ev?.type?.startsWith('combat.')) load()
         // tiradas públicas (las secretas nunca llegan a este socket)
         if (ev?.type === 'dice.roll.created') {
[diff_block_end]

Please note that the above snippet only shows the MODIFIED lines from the last change. It shows up to 3 lines of unchanged lines before and after the modified lines. The actual file contents may have many more lines not shown.
</user_actions>
</additional_metadata>

=== MESSAGE 322 - Assistant ===
Nueva auditoría completa — sin cambios, solo informe. El estado actual ya incorpora las rondas anteriores de fixes, así que concentro la búsqueda en lo que NO se ha cubierto todavía. Lanzo 4 exploraciones paralelas por dominio:

=== MESSAGE 323 - Tool ===
Background subagent started with agent_id=6fabb093. You can wait for this agent to finish using the read_subagent tool, otherwise you will automatically be notified with a <subagent_completion_notification> when it completes.

=== MESSAGE 324 - Tool ===
Background subagent started with agent_id=6e064faa. You can wait for this agent to finish using the read_subagent tool, otherwise you will automatically be notified with a <subagent_completion_notification> when it completes.

=== MESSAGE 325 - Tool ===
Background subagent started with agent_id=af7a593f. You can wait for this agent to finish using the read_subagent tool, otherwise you will automatically be notified with a <subagent_completion_notification> when it completes.

=== MESSAGE 326 - Tool ===
Background subagent started with agent_id=0826ca55. You can wait for this agent to finish using the read_subagent tool, otherwise you will automatically be notified with a <subagent_completion_notification> when it completes.

=== MESSAGE 327 - System ===
<subagent_completion_notification>
[Background subagent with agent_id=6fabb093 completed]

[Error] Connection error, send a message to continue retrying
</subagent_completion_notification>

=== MESSAGE 328 - System ===
<subagent_completion_notification>
[Background subagent with agent_id=6e064faa completed]

[Error] Connection error, send a message to continue retrying
</subagent_completion_notification>

=== MESSAGE 329 - System ===
<subagent_completion_notification>
[Background subagent with agent_id=af7a593f completed]

[Error] Connection error, send a message to continue retrying
</subagent_completion_notification>

=== MESSAGE 330 - System ===
<subagent_completion_notification>
[Background subagent with agent_id=0826ca55 completed]

[Error] Connection error, send a message to continue retrying
</subagent_completion_notification>

=== MESSAGE 331 - System ===
<additional_metadata>
NOTE: Open files and cursor position may not be related to the user's current request. Always verify relevance before assuming connection.

The current state of the user's IDE is as follows:
Other open documents:
- /c:/Users/alex0/PycharmProjects/NT4H2/.dockerignore
- /c:/Users/alex0/PycharmProjects/NT4H2/apps/engine-runner/Dockerfile
- /c:/Users/alex0/PycharmProjects/vnc-remote-secure/src/vnc_remote_secure/security/maintenance.py
- /c:/Users/alex0/PycharmProjects/vnc-remote-secure/tests/unit/core/test_deferred_lifecycle.py
- /c:/Users/alex0/PycharmProjects/vnc-remote-secure/tests/unit/security/test_audit_hardening.py
Only use this information if it is directly relevant to the user's request.
</additional_metadata>

=== MESSAGE 332 - User ===
continua

=== MESSAGE 333 - Assistant ===
Los 4 subagentes fallaron por error de conexión. Compruebo si produjeron salida parcial:

=== MESSAGE 334 - Tool ===
Subagent 6fabb093 exited with an error:

Connection error, send a message to continue retrying

=== MESSAGE 335 - Tool ===
Subagent 6e064faa exited with an error:

Connection error, send a message to continue retrying

=== MESSAGE 336 - Tool ===
Subagent af7a593f exited with an error:

Connection error, send a message to continue retrying

=== MESSAGE 337 - Tool ===
Subagent 0826ca55 exited with an error:

Connection error, send a message to continue retrying

=== MESSAGE 338 - Assistant ===
Sin salida parcial — reintento los 4:

=== MESSAGE 339 - Tool ===
Background subagent started with agent_id=d81c74d9. You can wait for this agent to finish using the read_subagent tool, otherwise you will automatically be notified with a <subagent_completion_notification> when it completes.

=== MESSAGE 340 - Tool ===
Background subagent started with agent_id=31e485b3. You can wait for this agent to finish using the read_subagent tool, otherwise you will automatically be notified with a <subagent_completion_notification> when it completes.

=== MESSAGE 341 - Tool ===
Background subagent started with agent_id=6096a8c6. You can wait for this agent to finish using the read_subagent tool, otherwise you will automatically be notified with a <subagent_completion_notification> when it completes.

=== MESSAGE 342 - Tool ===
Background subagent started with agent_id=6d2b95c6. You can wait for this agent to finish using the read_subagent tool, otherwise you will automatically be notified with a <subagent_completion_notification> when it completes.

=== MESSAGE 343 - Assistant ===
Mientras corren, hago mi propia verificación (Fase 6): linters, scripts auxiliares y archivos huérfanos:

=== MESSAGE 344 - Tool ===
Output from command in shell 24f339:
audit_catalog.py
check-complexity.py
gen_traceability.py
promote_verified.py
verify_cards_ocr.py


Exit code: 0

=== MESSAGE 345 - Tool ===
Output from command in shell 707e79:

✖ 313 problems (0 errors, 313 warnings)
  0 errors and 2 warnings potentially fixable with the `--fix` option.



Exit code: 0

=== MESSAGE 346 - Tool ===
Output from command in shell c995e3:
	Total issues (by confidence):
		Undefined: 0
		Low: 0
		Medium: 0
		High: 1
Files skipped (0):


Exit code: 1

=== MESSAGE 347 - Assistant ===


=== MESSAGE 348 - Tool ===
Output from command in shell 1c4392:

>> Issue: [B101:assert_used] Use of assert detected. The enclosed code will be removed when compiling to optimised 
byte code.
   Severity: Low   Confidence: High
   Location: .\game\engine_client.py:48:4
	Total potential issues skipped due to specifically being disabled (e.g., #nosec BXXX): 3
	Total issues (by severity):
	Total issues (by confidence):




Exit code: 1

=== MESSAGE 349 - Assistant ===


=== MESSAGE 350 - Tool ===
Output from command in shell ed2681:


Exit code: 1

=== MESSAGE 351 - Assistant ===


=== MESSAGE 352 - Tool ===
Output from command in shell d77313:
>> Issue: [B101:assert_used] Use of assert detected. The enclosed code will be removed when compiling to optimised byte code. | CWE: CWE-703 (https://cwe.mitre.org/data/definitions/703.html)    More Info: https://bandit.readthedocs.io/en/1.9.4/plugins/b101_assert_used.html


Exit code: 1

=== MESSAGE 353 - Assistant ===


=== MESSAGE 354 - Tool ===
Output from command in shell ee92ea:

	No issues identified.
	Total potential issues skipped due to specifically being disabled (e.g., #nosec BXXX): 3
	Total issues (by severity):
	Total issues (by confidence):




Exit code: 1

=== MESSAGE 355 - Assistant ===


=== MESSAGE 356 - Tool ===
Output truncated at line 59; continue reading from line 60.

<file-view path="C:\Users\alex0\PycharmProjects\NT4H2\apps\backend\game\engine_client.py" start_line="40" end_line="59">
 40|        try:
 41|            with httpx.Client(timeout=timeout) as client:
 42|                return client.post(_url(path), json=body, headers=_headers())
 43|        except httpx.HTTPStatusError:
 44|            raise
 45|        except httpx.HTTPError as exc:
 46|            last_exc = exc
 47|            logger.warning("runner POST %s falló (intento %s/2): %s", path, _attempt + 1, exc)
 48|    assert last_exc is not None
 49|    raise last_exc
 50|
 51|
 52|class EngineRunnerClient:  # noqa: PIE798 - namespacing deliberado sobre los 5 endpoints
 53|    """Thin client that delegates game state execution to engine-runner."""
 54|
 55|    @staticmethod
 56|    def create_room(room_id: str, config: dict) -> dict:
 57|        with httpx.Client(timeout=5.0) as client:
 58|            response = client.post(
 59|                _url(f"/rooms/{room_id}/create"),
</file-view>

=== MESSAGE 357 - Tool ===
Output from command in shell 189287:
settings.py:13: _DEV_SECRET_KEY = "dev-secret-key-change-in-production"  # nosec B105  # noqa: S105


Exit code: 0

=== MESSAGE 358 - Assistant ===
Verifico directamente un sospechoso clave: path traversal de `roomId` en `snapshotPath`:

=== MESSAGE 359 - Tool ===
<file-view path="C:\Users\alex0\PycharmProjects\NT4H2\apps\engine-runner\server.ts" start_line="245" end_line="294">
245|  customSets?: ContentSet[];
246|}>();
247|
248|// ============================================================================
249|// Persistencia de snapshots (opt-in): si ENGINE_RUNNER_STATE_DIR está definido,
250|// cada sala se guarda tras cada comando aceptado y se restaura al arrancar.
251|// Sin él el runner sigue siendo en memoria pura (dev).
252|// ============================================================================
253|
254|const STATE_DIR = process.env.ENGINE_RUNNER_STATE_DIR ?? '';
255|if (STATE_DIR) {
256|  mkdirSync(STATE_DIR, { recursive: true });
257|}
258|
259|interface RoomSnapshot {
260|  state: GameState;
261|  rngState: { seed: string; state: number };
262|  revision: number;
263|  cids: string[];
264|  lastClientSeq: Record<string, number>;
265|  customSets?: ContentSet[];
266|  savedAt: number;
267|}
268|
269|function snapshotPath(roomId: string): string {
270|  // roomId es idSchema (≤128, sin '/'); filtrar por seguridad extra
271|  const safe = roomId.replace(/[^A-Za-z0-9_-]/g, '_');
272|  return join(STATE_DIR, `${safe}.json`);
273|}
274|
275|function persistRoom(roomId: string, room: NonNullable<ReturnType<typeof rooms.get>>): void {
276|  if (!STATE_DIR) return;
277|  const snap: RoomSnapshot = {
278|    state: room.state,
279|    rngState: room.rng.serialize(),
280|    revision: room.revision,
281|    cids: room.processedCids.toArray(),
282|    lastClientSeq: Object.fromEntries(room.lastClientSeq),
283|    customSets: room.customSets,
284|    savedAt: Date.now(),
285|  };
286|  const path = snapshotPath(roomId);
287|  try {
288|    // Escritura atómica: tmp + rename (evita snapshots a medias en crash)
289|    writeFileSync(`${path}.tmp`, JSON.stringify(snap));
290|    renameSync(`${path}.tmp`, path);
291|  } catch (err) {
292|    console.error(`persist ${roomId} failed:`, err);
293|  }
294|}
</file-view>

=== MESSAGE 360 - Assistant ===


=== MESSAGE 361 - Tool ===
Output from command in shell aba176:
165: expectedRevision: z.number().int().min(0).optional(),
190: function requireEngineAuth(req: express.Request, res: express.Response, next: express.NextFunction):
201: res.status(401).json({ error: 'Unauthorized' });
447: app.use('/rooms/:roomId/restore', express.json({ limit: '10mb' }));
449: app.use(express.json({ limit: '100kb' }));
494: res.json({ status: 'ok', service: 'engine-runner' });
497: app.post('/rooms/:roomId/create', requireEngineAuth, (req, res) => {
501: res.status(400).json({ error: 'Invalid roomId' });
507: res.status(409).json({ error: 'Room already exists' });
511: res.status(503).json({ error: 'Too many rooms' });
517: res.status(400).json({ error: 'Invalid game config' });
527: res.status(400).json(merged.body);
541: res.status(400).json({ error: 'Invalid game config', details: result.errors.slice(0, 10) });
566: res.json({ ok: true, roomId });
572: res.status(500).json({ error: 'Room creation failed' });
576: app.post('/rooms/:roomId/command', requireEngineAuth, (req, res) => {
581: res.status(404).json({ error: 'Room not found' });
587: res.status(400).json({ error: 'Missing or invalid command', reason: 'invalid_command', accepted: fal
590: const { cid, playerId, command, expectedRevision, clientSequence } = parsed.data;
597: res.json({ accepted: true, events: [], cached: true, revision: room.revision });


Exit code: 0

=== MESSAGE 362 - Assistant ===


=== MESSAGE 363 - Tool ===
Output truncated at line 685; continue reading from line 686.

<file-view path="C:\Users\alex0\PycharmProjects\NT4H2\apps\engine-runner\server.ts" start_line="576" end_line="685">
576|app.post('/rooms/:roomId/command', requireEngineAuth, (req, res) => {
577|  const { roomId } = req.params;
578|
579|  const room = rooms.get(roomId);
580|  if (!room) {
581|    res.status(404).json({ error: 'Room not found' });
582|    return;
583|  }
584|
585|  const parsed = CommandBodySchema.safeParse(req.body);
586|  if (!parsed.success) {
587|    res.status(400).json({ error: 'Missing or invalid command', reason: 'invalid_command', accepted: false });
588|    return;
589|  }
590|  const { cid, playerId, command, expectedRevision, clientSequence } = parsed.data;
591|  room.lastActivity = Date.now();
592|
593|  // Idempotencia: CID duplicado → ack cacheado. ANTES del rate-limit y
594|  // de los checks de revisión/clientSequence: un reintento legítimo del
595|  // mismo comando no debe consumir cuota ni recibir "stale_revision".
596|  if (room.processedCids.has(cid)) {
597|    res.json({ accepted: true, events: [], cached: true, revision: room.revision });
598|    return;
599|  }
600|
601|  // El playerId viene autenticado por el backend, pero si no pertenece a
602|  // esta sala el comando iba a ser rechazado por el motor de todos modos:
603|  // rechazarlo antes evita poblar rateLimit/lastClientSeq con ids
604|  // arbitrarios (mapas no acotados por sala).
605|  if (!Object.hasOwn(room.state.players, playerId)) {
606|    res.status(403).json({ accepted: false, error: 'unknown_player', reason: 'unknown_player' });
607|    return;
608|  }
609|
610|  // Rate limiting por sala+jugador: máx 30 comandos por 10 s (anti-spam)
611|  const rlKey = `${roomId}:${playerId}`;
612|  const rl = rateLimit.get(rlKey) ?? { count: 0, windowStart: Date.now() };
613|  if (Date.now() - rl.windowStart > 10_000) {
614|    rl.count = 0;
615|    rl.windowStart = Date.now();
616|  }
617|  rl.count++;
618|  rateLimit.set(rlKey, rl);
619|  if (rl.count > 30) {
620|    res.status(429).json({ error: 'Rate limit exceeded', reason: 'rate_limited', accepted: false });
621|    return;
622|  }
623|
624|  // Comando sobre revisión antigua → el cliente debe re-sincronizar
625|  if (expectedRevision !== undefined && expectedRevision !== room.revision) {
626|    res.status(409).json({
627|      accepted: false,
628|      error: 'stale_revision',
629|      reason: 'stale_revision',
630|      revision: room.revision,
631|    });
632|    return;
633|  }
634|
635|  // Anti-reordenado: una clientSequence inferior a la última procesada es
636|  // un comando duplicado fuera de la ventana de cids (D434 no lo coge)
637|  const lastSeq = room.lastClientSeq.get(playerId);
638|  if (clientSequence !== undefined && lastSeq !== undefined && clientSequence <= lastSeq) {
639|    res.json({ accepted: false, reason: 'out_of_order_command', revision: room.revision });
640|    return;
641|  }
642|
643|  // El cid del envelope es el que se deduplica y persiste: si difiere del
644|  // del propio comando, el dedup del runner y el del backend quedarían
645|  // auditando identidades distintas.
646|  if (command.cid !== cid) {
647|    res.status(400).json({ error: 'cid mismatch between envelope and command', reason: 'cid_mismatch', accepted: false });
648|    return;
649|  }
650|
651|  const rngBackup = room.rng.serialize();
652|  try {
653|    // Ejecutar comando — D423: pasar playerId autenticado por el backend.
654|    // actorId queda sellado con el jugador autenticado: el valor enviado
655|    // por el cliente (si venía) no puede suplantar a otro jugador.
656|    const authenticatedCommand = { ...command, actorId: playerId } as Command;
657|    const result = execute(room.state, authenticatedCommand, room.rng, room.registry, room.catalog, playerId);
658|
659|    if (!result.accepted) {
660|      // Un rechazo puede haber consumido RNG (elecciones/efectos que
661|      // barajan antes de fallar): restaurar el backup para que el RNG
662|      // vivo siga coincidiendo con un replay de comandos aceptados.
663|      room.rng = DeterministicRng.deserialize(rngBackup);
664|      res.json({ accepted: false, reason: result.reason });
665|      return;
666|    }
667|
668|    // Procesar fases ANTES de confirmar: si lanza, el comando queda sin
669|    // aplicar — ni estado, ni cid, ni revisión — y el 500 es coherente
670|    // con lo persistido (antes el commit parcial divergía del veredicto).
671|    let phaseResult;
672|    try {
673|      phaseResult = processPhases(result.newState, room.rng, room.catalog);
674|    } catch (phaseErr) {
675|      room.rng = DeterministicRng.deserialize(rngBackup);
676|      throw phaseErr;
677|    }
678|
679|    // Commit: estado + dedup + secuencia + revisión, todo junto.
680|    room.state = phaseResult.state;
681|    room.processedCids.add(cid);
682|    if (clientSequence !== undefined) room.lastClientSeq.set(playerId, clientSequence);
683|    room.revision++;
684|    schedulePersist(roomId);
685|    // GAME_ENDED: flush inmediato — la ventana de debounce tras el
</file-view>

=== MESSAGE 364 - Assistant ===


=== MESSAGE 365 - Tool ===
Output from command in shell 71a106:
engine_client.py:78: body["expectedRevision"] = expected_revision
engine_client.py:80: body["clientSequence"] = client_sequence
consumers.py:459: "expected_revision": content.get("expectedRevision"),
consumers.py:460: "client_sequence": content.get("clientSequence"),


Exit code: 0

=== MESSAGE 366 - Assistant ===


=== MESSAGE 367 - Tool ===
Output from command in shell 83ad32:
112: const last = get().online.lastRevision;
133: state.online.lastRevision = rev;
171: set((state) => { state.online.lastRevision = msg.revision ?? null; });
392: state.online = { roomId, playerId, playerToken: token || null, socket: null, lastRevision: null
438: const last = get().online.lastRevision;
452: state.online.lastRevision = data.revision;
529: set((state) => { state.online.lastRevision = msg.revision ?? null; });
567: state.online = { roomId, playerId: null, playerToken: null, socket: null, lastRevision: null, l
596: state.online = { roomId: null, playerId: null, playerToken: null, socket: null, lastRevision: n
652: clientSequence: ++_clientSeq,
653: ...(online.lastRevision !== null ? { expectedRevision: online.lastRevision } : {}),


Exit code: 0

=== MESSAGE 368 - Assistant ===


=== MESSAGE 369 - Tool ===
Output truncated at line 836; continue reading from line 837.

<file-view path="C:\Users\alex0\PycharmProjects\NT4H2\apps\engine-runner\server.ts" start_line="757" end_line="836">
757|app.post('/rooms/:roomId/restore', requireEngineAuth, (req, res) => {
758|  const { roomId } = req.params;
759|  if (!roomIdSchema.test(roomId)) {
760|    res.status(400).json({ error: 'Invalid roomId' });
761|    return;
762|  }
763|  if (rooms.has(roomId)) {
764|    res.status(409).json({ error: 'Room already exists' });
765|    return;
766|  }
767|  if (rooms.size >= MAX_ROOMS) {
768|    res.status(503).json({ error: 'Too many rooms' });
769|    return;
770|  }
771|  const snap = (req.body as { snapshot?: unknown } | null)?.snapshot as Partial<RoomSnapshot> | undefined;
772|  const rngState = snap?.rngState;
773|  if (
774|    !snap
775|    || !rngState
776|    || !isPlausibleState(snap.state)
777|    || typeof rngState.seed !== 'string'
778|    || typeof rngState.state !== 'number'
779|  ) {
780|    res.status(400).json({ error: 'Invalid snapshot' });
781|    return;
782|  }
783|  const merged = mergeRoomCustomSets(Array.isArray(snap.customSets) ? snap.customSets : []);
784|  if (!merged.ok) {
785|    res.status(400).json(merged.body);
786|    return;
787|  }
788|  const registry = new EffectRegistry();
789|  registerCoreEffects(registry);
790|  const cids = new BoundedCidSet();
791|  for (const cid of snap.cids ?? []) cids.add(cid);
792|  const revision = typeof snap.revision === 'number' ? snap.revision : 0;
793|  rooms.set(roomId, {
794|    state: snap.state,
795|    rng: DeterministicRng.deserialize(rngState),
796|    registry,
797|    processedCids: cids,
798|    lastActivity: Date.now(),
799|    revision,
800|    lastClientSeq: new Map(Object.entries(snap.lastClientSeq ?? {})),
801|    catalog: merged.catalog,
802|    customSets: merged.customSets.length > 0 ? merged.customSets : undefined,
803|  });
804|  schedulePersist(roomId);
805|  console.log(`room ${roomId} restaurada desde snapshot del backend (rev ${revision})`);
806|  res.json({ ok: true, roomId, revision });
807|});
808|
809|// D416: eliminar sala (cleanup)
810|app.delete('/rooms/:roomId', requireEngineAuth, (req, res) => {
811|  const { roomId } = req.params;
812|  if (!rooms.has(roomId)) {
813|    res.status(404).json({ error: 'Room not found' });
814|    return;
815|  }
816|  dropRoom(roomId);
817|  res.json({ ok: true });
818|});
819|
820|// ============================================================================
821|// D436: graceful shutdown
822|// ============================================================================
823|
824|const PORT = Number(process.env.ENGINE_RUNNER_PORT ?? 3001);
825|const restored = loadPersistedRooms();
826|if (restored > 0) console.log(`${restored} sala(s) restauradas desde disco`);
827|// Sin middleware de error, un JSON malformado devolvía la página HTML por
828|// defecto de Express (con stack fuera de producción): responder JSON 400.
829|app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
830|  const type = err && typeof err === 'object' ? (err as { type?: string }).type : undefined;
831|  if (type === 'entity.parse.failed') {
832|    res.status(400).json({ error: 'Invalid JSON body' });
833|    return;
834|  }
835|  // Un body >límite devolvía 500 — el backend lo clasificaba como fallo
836|  // del runner en vez de "payload demasiado grande" (413 correcto).
</file-view>

=== MESSAGE 370 - Assistant ===


=== MESSAGE 371 - Tool ===
Output truncated at line 420; continue reading from line 421.

<file-view path="C:\Users\alex0\PycharmProjects\NT4H2\apps\engine-runner\server.ts" start_line="336" end_line="420">
336|    && Array.isArray(s.battlefield)
337|    && Array.isArray(s.eventLog)
338|    // Los arrays que sanitizeForPlayer recorre sin guard: un snapshot
339|    // plausible sin ellos restauraba y luego crasheaba /state con 500
340|    // permanente (y nunca llegaba a marcarse .corrupt-*).
341|    && Array.isArray(s.hordeDeck)
342|    && Array.isArray(s.marketDeck)
343|    && Array.isArray(s.scenarioDeck)
344|    && Array.isArray(s.market)
345|    && Array.isArray(s.pendingChoices)
346|    && typeof s.rngState?.seed === 'string'
347|    && typeof s.rngState?.state === 'number',
348|  );
349|}
350|
351|function loadPersistedRooms(): number {
352|  if (!STATE_DIR || !existsSync(STATE_DIR)) return 0;
353|  let loaded = 0;
354|  const CORRUPT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // .corrupt-* >7 días: podar
355|  for (const file of readdirSync(STATE_DIR)) {
356|    // Restos de un crash a mitad de persist: el .tmp nunca llegó al rename.
357|    if (file.endsWith('.tmp')) {
358|      try { unlinkSync(join(STATE_DIR, file)); } catch { /* mejor esfuerzo */ }
359|      continue;
360|    }
361|    // Snapshots apartados por corrupción: se conservan un tiempo para
362|    // inspección manual, pero no indefinidamente.
363|    if (file.includes('.corrupt-')) {
364|      try {
365|        if (Date.now() - statSync(join(STATE_DIR, file)).mtimeMs > CORRUPT_TTL_MS) {
366|          unlinkSync(join(STATE_DIR, file));
367|        }
368|      } catch { /* mejor esfuerzo */ }
369|      continue;
370|    }
371|    if (!file.endsWith('.json')) continue;
372|    try {
373|      const snap = JSON.parse(readFileSync(join(STATE_DIR, file), 'utf-8')) as RoomSnapshot;
374|      if (!isPlausibleState(snap?.state) || typeof snap.rngState?.state !== 'number') {
375|        throw new Error('snapshot con forma inválida');
376|      }
377|      const registry = new EffectRegistry();
378|      registerCoreEffects(registry);
379|      const cids = new BoundedCidSet();
380|      for (const cid of snap.cids ?? []) cids.add(cid);
381|      const roomId = file.slice(0, -5);
382|      const roomCatalog = snap.customSets?.length
383|        ? mergeCustomCards(catalog, snap.customSets)
384|        : catalog;
385|      rooms.set(roomId, {
386|        state: snap.state,
387|        rng: DeterministicRng.deserialize(snap.rngState),
388|        registry,
389|        processedCids: cids,
390|        // TTL fresco al restaurar: con savedAt una sala guardada hace
391|        // >24h moriría en el primer sweep aunque los jugadores reconecten
392|        // tras el reinicio del runner.
393|        lastActivity: Date.now(),
394|        revision: snap.revision ?? 0,
395|        lastClientSeq: new Map(Object.entries(snap.lastClientSeq ?? {})),
396|        catalog: roomCatalog,
397|        customSets: snap.customSets,
398|      });
399|      loaded++;
400|    } catch (err) {
401|      // Apartar el fichero corrupto: sin ello el error se repite en cada
402|      // arranque y el snapshot queda invisible para inspección manual.
403|      console.error(`snapshot ${file} corrupto — ignorado:`, err);
404|      try {
405|        renameSync(join(STATE_DIR, file), join(STATE_DIR, `${file}.corrupt-${Date.now()}`));
406|      } catch { /* el fichero ya se movió o no es accesible */ }
407|    }
408|  }
409|  return loaded;
410|}
411|
412|// D415: limite de salas en memoria para evitar memory leak / DoS
413|const MAX_ROOMS = 1000;
414|
415|// Rate limiting por sala+jugador (ventana deslizante simple)
416|const rateLimit = new Map<string, { count: number; windowStart: number }>();
417|// Salas inactivas se eliminan tras 24h — evita leak de partidas abandonadas
418|const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
419|const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
420|
</file-view>

=== MESSAGE 372 - Assistant ===
Hallazgo propio confirmado: en `loadPersistedRooms`/`/restore` el runner nunca restaura el `seq` global del motor — tras un reinicio, `nextSeq()` reemite valores ya usados en `eventLog` (seqs duplicados → `sync?after=` y ordenación de `GameEvent` rotas). Lo guardo para el informe. Veo el estado de los subagentes:

=== MESSAGE 373 - Tool ===
Subagent d81c74d9 is still running. Stopped waiting after 600.2 seconds.

=== MESSAGE 374 - System ===
<subagent_completion_notification>
[Background subagent with agent_id=6d2b95c6 completed]

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
</subagent_completion_notification>

=== MESSAGE 375 - System ===
<subagent_completion_notification>
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
</subagent_completion_notification>

=== MESSAGE 376 - Assistant ===
Backend y runner/infra ya reportaron. Espero a engine y mobile:

=== MESSAGE 377 - Tool ===
Subagent d81c74d9 completed successfully:

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