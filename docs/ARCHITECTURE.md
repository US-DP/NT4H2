# Arquitectura — NT4H Digital

## Vista de componentes

```text
┌────────────────┐   REST/WS    ┌──────────────────┐   HTTP    ┌───────────────────┐
│  apps/mobile   │ ───────────► │  apps/backend    │ ────────► │ apps/engine-runner│
│  Expo (web/mov)│              │  Django+Channels │           │ Node: motor por   │
│                │ ◄─────────── │                  │ ◄──────── │ sala (memoria +   │
│  Zustand+immer │  broadcast   │  Postgres/Redis  │  snapshot │  snapshots disco) │
└────────────────┘              └──────────────────┘           └───────────────────┘
                                       │                                │
                                       ▼                                ▼
                                  GameSession,                    @nt4h/engine
                                  GameEvent, GameSnapshot         @nt4h/schema
                                                                  @nt4h/catalog
```

## Responsabilidades

| Componente | Responsabilidad |
|---|---|
| `packages/schema` | Tipos y schemas Zod compartidos (estado, eventos, comandos, cartas). |
| `packages/catalog` | Catálogo oficial + sets del Taller; validación `validateContentSet`. |
| `packages/engine` | Motor determinista: `isLegal` → ejecución → eventos → `applyEvent` (fold). Proyección por jugador y replay. |
| `apps/engine-runner` | Aloja una instancia del motor por sala. Autoritativo: valida comandos, deduplica por `cid`, persiste snapshots (opcional `STATE_DIR`). |
| `apps/backend` | Autenticación (JWT), salas/membresía, WS (Channels), idempotencia por `cid` en `GameEvent`, snapshots `GameSnapshot`, estadísticas, reaper de salas. |
| `apps/mobile` | Cliente Expo. Zustand+immer; vista proyectada; cola de comandos offline; i18n es/en. |

## Dirección de dependencias

`schema` ← `catalog` ← `engine` ← `engine-runner` y `mobile`. El backend no
importa el motor: habla con el runner por HTTP y con los clientes por
REST/WS. Nada de lo privado (manos, mazos, RNG) cruza la frontera del
runner salvo en `/full-state` autenticado.

## Flujo de un comando online

1. Cliente envía `{type:"game.command", cid, command}` por WS autenticado
   (ticket efímero; `playerId` derivado de la conexión, no del payload).
2. `consumers.py` verifica membresía + status PLAYING + dedup por `cid`
   (`GameEvent.cid` unique).
3. POST `/rooms/<id>/command` al runner con `X-Engine-Token`.
4. Runner: `isLegal` → ejecución → eventos → `applyEvent` → snapshot debounced.
5. Backend persiste el veredicto como `COMMAND` GameEvent; broadcast
   `game.command_result` **sin events** (solo metadatos + `stateChanged`).
6. Cada cliente re-pide su vista proyectada (`GET /state?playerId=`).

## Determinismo / event-sourcing

- Todo cambio de estado observable sale como `GameEvent` con `seq` único.
- El estado se reproduce foldando el log: `applyEvent(state, event)`.
- Regla dura: ejecución y reducer deben producir el mismo estado
  (tests `fold-vs-live`). Si un comando muta fuera de eventos, hay que
  documentar la poda con `PENDING_CHOICES_REMOVED`/equivalente.
- RNG determinista serializado por comando — el replay consume el mismo
  stream de números.

## Autenticación y autorización

- REST: JWT (`accounts/`); WS: ticket de un solo uso emitido por
  `POST /api/rooms/<id>/ws-ticket/` (los tokens de jugador nunca van en la
  URL del socket).
- Runner: `X-Engine-Token` compartido backend↔runner (fail-closed en prod).
- Espectadores: conexión sin `playerId`, sin comandos, vista sin manos.

## Límites y trade-offs aceptados

- Rate-limit, tickets WS y conteo de espectadores son **por proceso**
  (documentado: migrar a Redis antes de multi-worker).
- Snapshots del runner: atómicos por fichero; restauración al boot con
  cuarentena de corruptos (`.corrupt-<ts>`).
- Chat persiste como `GameEvent` sin lock de sesión (colisión seq →
  reintento), con retención de 200 por sala.
