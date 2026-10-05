# Operaciones — NT4H Digital

Superficie operativa del stack desplegado (backend Django + Channels,
runner del motor por sala, frontend Expo). El detalle vive en
[`operations/`](operations/).

## Comandos habituales

```bash
tools/test_all.ps1 / tools/test_all.sh   # batería completa (engine+runner+mobile+backend+yamllint)
tools/release.ps1 x.y.z                  # release: exige [vx.y.z] en CHANGELOG + suite verde
```

Producción: el runner toma snapshots atómicos por sala
(`ENGINE_RUNNER_STATE_DIR`) y el backend guarda `GameSnapshot` cada
`SNAPSHOT_EVERY_EVENTS=50` eventos + al cerrar la sala (poda FIFO,
≤10 por sala). Channel layer: `REDIS_URL` activa `channels_redis`;
en dev es InMemory.

## Documentos

| Doc | Contenido |
|---|---|
| [operations/deployment.md](operations/deployment.md) | Despliegue de la plataforma |
| [operations/incidents.md](operations/incidents.md) | Respuesta a incidentes y severidades |
| [operations/production-readiness.md](operations/production-readiness.md) | Checklist de salida a producción |
| [operations/slo.md](operations/slo.md) | SLI/SLO y objetivos del servicio |

## Notas

- Graceful shutdown del runner: SIGTERM/SIGINT con timeout 5 s.
- Releases adjuntan SBOM CycloneDX + attestation SLSA.
