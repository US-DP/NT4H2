# Despliegue y operación

## Topología

- **backend** (Django ASGI: uvicorn/daphne) — REST + WebSocket.
- **engine-runner** (Node, imagen `apps/engine-runner/Dockerfile`) — una
  instancia del motor por sala.
- **Postgres** (producción) y **Redis** (channel layer, obligatorio con
  multi-worker).

## Configuración

Todas las variables en `.env.example`. Fail-closed en producción:
`DJANGO_SECRET_KEY`, `REDIS_URL`, `ENGINE_RUNNER_TOKEN` (sin ellos el
backend/runner no arrancan fuera de dev).

## Health checks

- Runner: `GET /health` (sin auth — liveness probe).
- Backend: `GET /api/health/` (sondeo de infra, sin rate-limit estricto).

## Migraciones

`python manage.py migrate` antes de levantar. Las migraciones son
hacia adelante (`UniqueConstraint(session,cid)`, `GameSnapshot`, etc.) —
rollback = migración inversa estándar de Django.

## Ciclo de vida de salas

`reap_stale_rooms()` corre perezoso en `list_rooms` (≤1/min) y explícito:

```bash
python manage.py reap_rooms
```

- WAITING sin conectados > 30 min → borrada (runner + DB).
- PLAYING sin actividad > 48 h → `mark_finished` (conserva evento
  terminal, snapshot final y estadísticas; la sala del runner se borra).
- FINISHED > 24 h → borrada en cascada (eventos y snapshots caen con ella).

## Persistencia del runner

`ENGINE_RUNNER_STATE_DIR` → snapshot atómico por sala tras cada comando
aceptado (tmp+rename) + flush inmediato en `GAME_ENDED`. Al arrancar
restaura estado+RNG+cids; ficheros corruptos se apartan a
`*.corrupt-<ts>` (TTL de inspección) y `roomId` inválido por filename se
rechaza.

## Recuperación

- Runner caído: el backend responde `engine_unavailable` (no muta nada);
  el cliente reintenta tras reconectar (`_pendingCmds` + dedup `cid`).
- Runner reiniciado: restaura desde `STATE_DIR`; si falta, el backend
  restaura desde el último `GameSnapshot` (409 = ya viva, cuenta como
  éxito).
- Backend reiniciado: las conexiones WS re-autentican por ticket; la
  dedup por `GameEvent.cid` sobrevive.

## Estado compartido multi-worker

`game/store.py` centraliza el estado efímero vía `django.core.cache`:
rate-limits REST (`rl:*`), tickets WS (`wst:*`, un solo uso), conteo de
espectadores (`spec:*`, cap global por sala) y dedup de `clientMessageId`
de chat (`cmid:*`, sobrevive a reconexiones y doble pestaña).

Con `REDIS_URL` → `RedisCache` (todos los workers comparten estado).
Sin `REDIS_URL` → `LocMemCache` (por proceso, válido en dev/single-worker).

## Observabilidad

- Logs estructurados por logger (`game`, `security`); chat y comandos
  llevan `roomId`/`seq`.
- `GET /api/metrics/` — métricas en formato Prometheus: salas por estado,
  jugadores conectados, eventos persistidos. Requiere `METRICS_TOKEN`
  (Bearer) en producción; sin él solo responde a localhost.
- `GET /metrics` en el runner — salas vivas, comandos aceptados/rechazados,
  dedup hits, restores, uptime (sin auth; servicio interno).

## Pruebas de carga

`scripts/loadtest_ws.mjs` (Node ≥21, WebSocket nativo, sin deps):

```bash
node scripts/loadtest_ws.mjs --base http://localhost:8000 \
  --players 4 --spectators 20 --msgs 50
```

Crea una sala real, une jugadores, arranca la partida y mide latencias
de connect/chat/comandos + el comportamiento del cap de espectadores.
Apuntar solo a entornos de laboratorio.

## Objetivos

Ver `slo.md` — SLI/SLO, capacidad objetivo, RPO/RTO, alertas sugeridas
y política de rollback por tag semver.

## Releases

Tags semver `v*.*.*` disparan `.github/workflows/release.yml`: gate de
tests (engine+runner), build de la imagen Docker y GitHub Release con las
notas extraídas de `CHANGELOG.md` (el tag debe existir como `## [vX.Y.Z]`).
