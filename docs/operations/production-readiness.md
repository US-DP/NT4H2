# Production Readiness Review — NT4H2

Checklist de go-live. Marcar **done / no aplica / follow-up con dueño**.
Re-correr antes de cada release mayor o cambio de infraestructura.

## Propiedad y alcance

- [ ] Dueño del servicio identificado (CODEOWNERS cubre cada componente)
- [ ] Blast radius documentado: qué se rompe si cae el runner vs el backend
- [ ] Versión desplegada identificable (tag semver + CHANGELOG)

## Fiabilidad

- [ ] Health checks: backend `/api/health/` real (toca DB), runner `/health`
- [ ] El runner restaura salas desde STATE_DIR tras restart — verificado
      con test de simulacro
- [ ] `reap_rooms` corre en producción (cron/celery) — salas zombi se limpian
- [ ] Timeouts: backend→runner 5 s (execute) / 10 s (restore); los HTTP
      de cliente tienen límite; los WS tienen heartbeat
- [ ] `ENGINE_RUNNER_TOKEN` informado — el runner no arranca en blanco
      sin `ENGINE_RUNNER_DEV_OPEN=1` explícito

## Seguridad

- [ ] `SECRET_KEY` rotada desde el valor de ejemplo; `DEBUG=False`
- [ ] `TRUSTED_PROXY_IPS` correcta — rate limits y logs usan la IP real
- [ ] Runner tras red privada/proxy — no expuesto públicamente
- [ ] HTTPS terminado antes del backend; `wss://` en producción
- [ ] Dependabot activo; último escaneo de seguridad en verde
      (security.yml: bandit + npm audit + gitleaks)
- [ ] Secretos en gestor/CI secrets — nada en el repo (git history limpio)

## Observabilidad

- [ ] Métricas scrapeando: `/api/metrics/` + `/metrics` del runner
- [ ] Alertas definidas contra `docs/operations/slo.md`
      (latencia p95, errores 5xx, rooms por snapshot)
- [ ] Logs estructurados con nivel controlado (`LOG_LEVEL`), sin datos
      sensibles en ellos
- [ ] La capacidad de `channels_redis`/`CACHES` es la compartida — el
      estado multi-worker (tickets, rate limits, espectadores) no depende
      de la memoria del proceso

## Datos

- [ ] Migraciones aplicadas y reversibles; backup de Postgres verificado
      (restore probado, no solo configurado)
- [ ] Retenciones activas: snapshots ≤10/sala, chat ≤200, salas reaper
- [ ] `GameSnapshot` nunca servido a clientes — es estado privado completo

## Rollout y rollback

- [ ] La release genera artefacto (imagen runner + SBOM + attestation)
- [ ] Rollback documentado en deployment.md; la imagen anterior existe
- [ ] `CHANGELOG.md` tiene sección `[vX.Y.Z]` — el workflow lo exige

## Post-release

- [ ] Dashboard revisado tras el deploy (errores 5xx, latency, rooms)
- [ ] Incidencias → `docs/operations/incidents.md` (severidad + postmortem)
