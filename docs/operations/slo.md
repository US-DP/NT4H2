# Objetivos operativos — NT4H Digital

SLIs medibles contra `/api/metrics/` (backend) y `/metrics` (runner).
Objetivos *declarados* — deben validarse con `scripts/loadtest_ws.mjs`
y telemetría real antes de comprometerlos ante usuarios.

## SLI / SLO

| SLI | Medición | SLO (single-worker) |
|---|---|---|
| Disponibilidad HTTP | `api/health` 200 + `runner /health` 200 | ≥ 99.5 % mensual |
| Comandos aceptados | `nt4h_runner_commands_accepted_total / commands_total` | ≥ 95 % (el resto = rechazos legítimos del juego) |
| Latencia p95 REST | timing de proxy/lb externo | ≤ 300 ms |
| Latencia p95 WS (comando→ack) | medible con `loadtest_ws.mjs` | ≤ 500 ms |
| Dedup efectivo | `nt4h_runner_dedup_hits_total` estable | sin duplicar ejecución — invariante, no objetivo |
| Persistencia | flush tras `GAME_ENDED` inmediato | invariante |

## Capacidad objetivo

- 100 salas PLAYING concurrentes por runner (`MAX_ROOMS=1000` es el cap
  duro; 100 es el objetivo validable con el load test).
- 32 espectadores por sala (cap global vía `spec:*` en cache).
- Chat: 5 msg/5 s por conexión; comandos: 30/10 s por jugador-sala.

## RPO / RTO

| Escenario | RPO | RTO |
|---|---|---|
| Backend DB (SQLite/Postgres) | Backup diario → pérdida ≤ 24 h de salas/estadísticas | Re-deploy + `migrate` + copia de DB: ~30 min |
| Runner con `ENGINE_RUNNER_STATE_DIR` | Último snapshot atómico por comando aceptado (debounce 500 ms, flush inmediato en `GAME_ENDED`) | Reinicio del proceso: automático (restaura en boot) |
| Runner sin STATE_DIR | Estado volátil — RPO = cero garantizado; el backend restaura desde `GameSnapshot` (cada 50 eventos + cierre) | ~segundos, bajo demanda al próximo comando |

## Rollback / roll-forward

- Código: `git checkout vX.Y.Z` + redeploy (release workflow publica
  artefacto Docker por tag).
- Migraciones: `migrate <app> <n>` para retroceder; las migraciones
  destructivas deben llevar tests y nota en deployment.md.
- Datos: los snapshots `GameSnapshot` y el event log sobreviven al
  rollback mientras el schema sea compatible — las migraciones nuevas
  no pueden borrar columnas usadas por versiones anteriores en la misma
  release.

## Alertas sugeridas (no implementadas — pendiente colector)

- `rate(nt4h_runner_commands_rejected_total[5m])` anómalo → runner sano
  pero tráfico hostil o bug de cliente.
- `nt4h_rooms_total{status="playing"}` cayendo a 0 con tráfico previo →
  runner caído o reaper agresivo.
- `nt4h_players_connected` sin `nt4h_rooms_total` → desajuste de ciclo
  de vida.
