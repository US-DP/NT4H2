# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Unreleased]

### Añadido

- Documentación de proyecto: `SECURITY.md`, `CONTRIBUTING.md`, `.env.example`,
  `CHANGELOG.md`, ADRs en `docs/decisions/` y guías en `docs/operations/`
  y `docs/api/`.
- CI: job de build de la imagen Docker del runner, análisis de secretos
  (gitleaks), auditoría de dependencias (`pnpm audit`, `pip-audit`) y
  workflow de release por tag semver.
- Plantillas de PR e incidencias y `CODEOWNERS`.
- Observabilidad: `GET /api/metrics/` (backend) y `GET /metrics` (runner)
  en formato Prometheus; `METRICS_TOKEN` protege el endpoint en prod.
- `game/store.py`: estado efímero compartido vía Django cache — con
  `REDIS_URL` los rate-limits, tickets WS, cap de espectadores y dedup de
  chat son globales (multi-worker listo); sin ella, LocMem por proceso.
- `scripts/loadtest_ws.mjs`: prueba de carga WS sin dependencias (Node ≥21).
- Test de simulacro de restore (`RestoreDrillTests`).

### Corregido (revisión visual + e2e online)

- `POST /api/rooms/` devolvía 403 a cualquier cliente real — era el único
  endpoint de salas sin `@csrf_exempt` (el test client de Django no enforza
  CSRF, así que la suite no lo detectaba). Nuevo test con
  `enforce_csrf_checks=True`.
- Lobby online: tras `join`, el ticket WS se pedía con `roomId` vacío
  (`/api/rooms//ws-ticket/` → 404) por closure obsoleta en `connect()`,
  mostrando "No se pudo autenticar la conexión en tiempo real" a todo
  invitado.

### Corregido (auditoría 2025 — fases de remediación)

- Motor: `isLegal` rechaza comandos en `FINISHED` (salvo `PASS`), valida
  objetivos requeridos y filtros de clase en `PLAY_CARD`, y bloquea acciones
  con elecciones obligatorias pendientes.
- Motor: empates de selectores de héroe estadísticos (`FEWEST_WOUNDS`,
  `MOST_WOUNDS/GLORY/COINS`) y `INTERCEPT_DAMAGE from:OTHER_HERO` crean
  `SELECT_HERO` en vez de elegir silenciosamente.
- Motor: `GAME_ENDED` limpia `pendingChoices`; `SWAP_ENEMY` transporta
  `newEnemyReward`; `OVERKILL_DAMAGE`/`INTERCEPT_DAMAGE` usan daño
  modificado y objetivo elegido.
- Proyección: `PENDING_CHOICES_REMOVED` redacta `choiceIds`; `DECK_SHUFFLED`/
  `DECK_RESHUFFLED` visibles con `newOrder` eliminado; recompensas ocultas.
- Backend: chat persiste sin lock de sesión con retención FIFO (200/sala);
  `restore` 409 = éxito; reaper PLAYING→FINISHED vía `mark_finished`;
  body cap de respuestas del runner; `cid` ≤128; `TRUSTED_PROXY_IPS`
  cacheado; `ROOM_RATE_LIMIT_MAX` tolerante.
- Runner: `cidSchema`/`idSchema` con charset seguro (anti log-forging);
  `MAX_ROOMS` y validación de `roomId` en snapshots al arrancar; NaN
  rechazado en `revision`/`lastClientSeq`; `stateChanged` en dedup;
  Dockerfile con `USER node`, `COPY patches` y `start` ejecutable.
- Móvil: cola de comandos drenada tras re-sincronizar; reintento único ante
  `stale_revision`; correlación por `cid` (un `command_result` ajeno ya no
  limpia tu pending); mazos validados antes de persistir; historial con
  `scenariosCount` real y `contentScope` online.
- Infra: CI con Node 22 (alineado con la imagen), paths de lockfile/turbo
  en los filtros, `pnpm dev` ya no arranca el backend de Python.

### Cambiado

- Las respuestas de error del runner distinguen 400/403/409/429 del
  genérico `engine_unavailable`.
