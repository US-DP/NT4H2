# Contrato de API — NT4H Digital

## Backend Django (`apps/backend`, prefijo `/api/`)

### Identidad (`/api/v1/`, `accounts/`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `auth/register/` | — | Alta de cuenta → `{token, user}` |
| POST | `auth/login/` | — | Login → `{token, user}` |
| POST | `auth/refresh/` | — | Renueva el access token |
| POST | `auth/logout/` | Bearer | Invalida el refresh (blacklist) |
| GET/PATCH | `me/` | Bearer | Perfil propio (display_name, avatar) |
| GET | `players/<uuid>/statistics/` | Bearer | Estadísticas públicas de un jugador |

### Salas (`/api/rooms/`, `game/`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `rooms/` | Bearer | Crear sala → `{roomId, hostToken, ...}` |
| GET | `rooms/list/` | Bearer | Listar salas (dispara reap perezoso) |
| GET | `rooms/<id>/` | miembro | Estado de sala (config pública; pools solo con `X-Player-Token`) |
| GET | `rooms/<id>/engine/?playerId=` | `X-Player-Token` | Vista proyectada del motor para ese jugador |
| POST | `rooms/<id>/join/` | Bearer | Unirse → `{authToken}` + héroe/mazo/cara elegidos |
| POST | `rooms/<id>/leave/` | Bearer + token propio (host para ajenos en WAITING) | Salir |
| POST | `rooms/<id>/ready/` | Bearer | Marcar listo (roster: héroe+mazo+cara) |
| POST | `rooms/<id>/kick/` | Bearer host | Expulsar (WAITING) |
| POST | `rooms/<id>/unkick/` | Bearer host | Readmitir |
| POST | `rooms/<id>/start/` | Bearer host + `hostToken` | Reconstruye runner con roster → PLAYING |
| POST | `rooms/<id>/transfer-host/` | Bearer host | Ceder host |
| POST | `rooms/<id>/close/` | Bearer host | Cerrar sala |
| POST | `rooms/<id>/skip-turn/` | Bearer + token propio | Saltar turno propio |
| POST | `rooms/<id>/ws-ticket/` | Bearer + `playerToken` | Ticket WS de un solo uso (~60 s) |

### Estadísticas opt-in (`/api/stats/`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `stats/report/` | Bearer | Informe de partida (anónimo, opt-in) |
| GET | `stats/community/` | — | Agregados de comunidad |
| GET | `stats/leaderboard/` | — | Clasificación |

### Misceláneo

| Método | Ruta | Descripción |
|---|---|---|
| GET | `api/health/` | Sondeo de infra |
| GET | `api/metrics/` | Métricas Prometheus (Bearer `METRICS_TOKEN` o localhost) |

### WebSocket (`/ws/room/<id>/`)

Conexión con `?ticket=<ticket>` (un solo uso) o `?spectator=1`
(solo lectura, cap 32/sala). Mensajes C→S:

- `game.command{cid, command}` — solo PLAYING; `playerId` = conexión autenticada.
- `chat.message{text, clientMessageId}` — ≤500 chars, 5 msg/5 s, idempotente por `clientMessageId`.

S→C: `game.command_ack{ref,accepted,reason}`, `game.command_result`
(metadatos, **sin events**), `chat.message{...}` server-asignado,
`room.*` (join/leave/ready/finished), `game.sync` (pide re-fetch).

## Engine runner (`apps/engine-runner`, `:3001`, `X-Engine-Token`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Liveness (sin auth) |
| GET | `/metrics` | Métricas Prometheus del proceso (sin auth — interno) |
| POST | `/rooms/<id>/create` | Crea sala con `config` (409 si existe) |
| POST | `/rooms/<id>/command` | `{cid, playerId, command, expectedRevision?, clientSequence?}` → `{accepted, events?, reason?, revision}` |
| GET | `/rooms/<id>/state?playerId=` | Vista proyectada (espectador sin `playerId`) |
| GET | `/rooms/<id>/full-state` | Estado completo + rngState + revision — **interno**, solo snapshots |
| POST | `/rooms/<id>/restore` | `{snapshot}` — 409 = ya viva (éxito para el llamador) |
| DELETE | `/rooms/<id>` | Borrar sala |

Errores: 400 validación Zod · 403 `unknown_player` · 409 `stale_revision`/
sala existente · 413 body >256 KiB · 429 rate-limit.

## Móvil (`apps/mobile`)

Consume REST + WS anteriores. Env: `EXPO_PUBLIC_SENTRY_DSN` (telemetría
opt-in). Persistencia local de partidas en `localStorage` (web).
