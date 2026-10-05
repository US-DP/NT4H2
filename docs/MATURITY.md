# Matriz de madurez — autoevaluación NT4H Digital

Escala 0-4 por dimensión (0=implícito … 4=medido/evolutivo).
Revisar por release. La puntuación NO sustituye al análisis de
riesgos — un 4 medio con un fallo crítico abierto sigue siendo un
proyecto con un fallo crítico abierto.

| Dimensión | Nivel | Evidencia |
|---|---|---|
| Requisitos | 4 | `REQUIREMENTS.md` + `TRAZABILIDAD_UI.md` (requisito → componente → test) + `GLOSARIO.md` |
| Arquitectura | 4 | `ARCHITECTURE.md` + 4 ADRs (event-sourcing, runner separado, tickets WS, proyección-privacidad) |
| Pruebas | 4 | 737 tests motor + 400 UI + 106 backend + E2E Playwright + `ESTRATEGIA_PRUEBAS`/`ANALISIS_BRECHA` medidos |
| Seguridad | 4 | `THREAT_MODEL.md` (STRIDE), tickets WS efímeros (D431), Zod en transporte, bandit/pip-audit/detect-secrets en CI |
| Despliegue | 4 | `operations/deployment.md`, release.ps1 con SBOM CycloneDX + attestation SLSA, scorecard en CI |
| Operación | 3 | `INCIDENTS` + `SLO` + `production-readiness` + heartbeat/reconexión gobernada; sin monitor externo |
| Recuperación | 3 | Snapshots de runner + `GameSnapshot` cada N eventos + dedup `cid` — replay verificado por el propio modelo event-sourced |
| Documentación | 4 | Índice `docs/README.md` + especificación UI + auditorías + ADRs indexados |
| Datos | 4 | `DATA_MODEL.md` + `DEPRECATION.md` (eventos del motor nunca se eliminan — replays dependen) |
| Equipo | 1 | Mantenedor único — bus factor = 1 |
| **Total** | **35/40** | **proyecto de referencia** (31+) |

## Qué falta para subir

- Operación →4 exige monitor/alerting externo al runner.
- Equipo →2 exige un segundo mantenedor — no es un cambio de repo.

## Lo que deliberadamente NO se busca

Multi-región, Kubernetes, observabilidad distribuida — un juego de
mesa digital autoalojable no justifica la maquinaria.
