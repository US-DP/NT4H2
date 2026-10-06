<h1 align="center">NT4H Digital</h1>

<p align="center">
  <img src="apps/mobile/assets/icon.png" alt="Icono de NT4H Digital" width="96" />
</p>

<p align="center">
  <strong>No Time for Heroes</strong>, jugable en digital: salas online en
  tiempo real, solitario, hot-seat y un motor de reglas determinista que
  garantiza que cada partida se pueda repetir exactamente.
</p>

<p align="center">
  <a href="#inicio-rápido">Inicio rápido</a> ·
  <a href="docs/ARCHITECTURE.md">Arquitectura</a> ·
  <a href="docs/api/api.md">API</a> ·
  <a href="CONTRIBUTING.md">Contribuir</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://github.com/US-DP/NT4H2/actions/workflows/engine-ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/US-DP/NT4H2/engine-ci.yml?branch=main&label=engine%20CI" alt="CI del motor"></a>
  <a href="https://github.com/US-DP/NT4H2/actions/workflows/backend-ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/US-DP/NT4H2/backend-ci.yml?branch=main&label=backend%20CI" alt="CI del backend"></a>
  <a href="https://github.com/US-DP/NT4H2/actions/workflows/ui-ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/US-DP/NT4H2/ui-ci.yml?branch=main&label=UI%20CI" alt="CI del frontend"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licencia-propietaria-red" alt="Licencia"></a>
</p>

<p align="center">
  <img src="docs/assets/screenshots/game-board.png" alt="Partida en curso: puja de líder, campo de batalla con tres huestes, escenario activo y mano del jugador" width="900">
</p>

<table align="center"><tr>
  <td><img src="docs/assets/screenshots/game-attack.png" alt="Elección de ataque: enemigos con resistencia y modificadores, mercado bloqueado y mano del jugador" width="420"></td>
  <td><img src="docs/assets/screenshots/game-market.png" alt="Fase de Mercado: cartas comprables con coste, monedas disponibles y aviso de reconstrucción del mazo" width="420"></td>
  <td><img src="docs/assets/screenshots/game-horde.png" alt="Ataque de la Horda: previsión de desgaste con desglose y ventana de reacción pendiente" width="420"></td>
</tr><tr>
  <td colspan="3" align="center"><img src="docs/assets/screenshots/game-end.png" alt="Fin de partida: logros desbloqueados, ganador por Gloria y ranking final con trofeos por héroe" width="420"></td>
</tr></table>
<p align="center"><sub>Elección de ataque · Mercado · Ataque de la Horda (con elección de reacción) · Fin de partida</sub></p>

<table align="center"><tr>
  <td><img src="docs/assets/screenshots/home.png" alt="Pantalla de inicio con el mazo de cartas y acceso a nueva partida" width="420"></td>
  <td><img src="docs/assets/screenshots/library.png" alt="Colección de cartas con filtros por tipo, clase y origen" width="420"></td>
  <td><img src="docs/assets/screenshots/library-card-detail.png" alt="Detalle de carta en la colección con arte ampliado, tipo y atributos" width="420"></td>
</tr></table>
<p align="center"><sub>Inicio · Colección · Detalle de carta</sub></p>

<table align="center"><tr>
  <td><img src="docs/assets/screenshots/rulebook.png" alt="Reglamento interactivo con buscador, atajos e índice de capítulos" width="420"></td>
  <td><img src="docs/assets/screenshots/room-lobby.png" alt="Lobby online real: roster con héroe y clase, estado preparado y chat" width="420"></td>
  <td><img src="docs/assets/screenshots/workshop.png" alt="Taller de contenido personalizado con resumen del catálogo" width="420"></td>
</tr></table>
<p align="center"><sub>Reglamento · Salas online · Taller de contenido</sub></p>

<table align="center"><tr>
  <td><img src="docs/assets/screenshots/play-menu.png" alt="Menú de juego: partida rápida, solitario, online e importar partida" width="420"></td>
  <td><img src="docs/assets/screenshots/auth.png" alt="Pantalla de cuenta: inicio de sesión para estadísticas y rango online" width="420"></td>
  <td><img src="docs/assets/screenshots/stats.png" alt="Estadísticas y logros con estado vacío antes de la primera partida" width="420"></td>
</tr></table>
<p align="center"><sub>Modos de juego · Cuenta · Estadísticas</sub></p>

<details><summary>Todas las capturas — las 12 restantes del inventario</summary>

Las anteriores muestran el flujo principal; estas completan las 26
pantallas publicadas en `docs/assets/screenshots/`:

| Salas online | |
|---|---|
| ![Unirse a sala: selector de héroe, clase y cara de la carta](docs/assets/screenshots/room-join-form.png)<br><sub>Unirse a sala — héroe/clase/cara</sub> | ![Invitación a sala en /rooms/CÓDIGO con datos de la partida](docs/assets/screenshots/room-invite.png)<br><sub>Invitación a sala (`/rooms/[code]`)</sub> |
| ![Sala en espera: jugador listo, aguardando al anfitrión](docs/assets/screenshots/room-ready.png)<br><sub>Sala en espera — listo, esperando al anfitrión</sub> | ![Listado de salas públicas disponibles en el menú de juego](docs/assets/screenshots/rooms-list.png)<br><sub>Salas públicas</sub> |

| Contenido | |
|---|---|
| ![Contenido instalado: juego base oficial y aviso de conjuntos personalizados](docs/assets/screenshots/content.png)<br><sub>Contenido instalado</sub> | ![Asistente de nueva partida, paso 1: modo de juego (solitario/estándar/multiclase)](docs/assets/screenshots/create.png)<br><sub>Nueva partida — asistente</sub> |
| ![Capítulo del reglamento con el texto de la regla](docs/assets/screenshots/rulebook-detail.png)<br><sub>Capítulo del reglamento</sub> | ![Pantalla de privacidad para pasar el dispositivo sin revelar la mano](docs/assets/screenshots/game-privacy.png)<br><sub>Privacidad — pasar el dispositivo</sub> |

| Cuenta y partida | |
|---|---|
| ![Perfil y accesibilidad: nombre visible, idioma, tamaño de texto y densidad](docs/assets/screenshots/profile.png)<br><sub>Perfil y accesibilidad</sub> | ![Replay de partida desde el eventLog determinista](docs/assets/screenshots/replay.png)<br><sub>Replay</sub> |
| ![Inicio en viewport móvil](docs/assets/screenshots/mobile-home.png)<br><sub>Inicio — móvil</sub> | ![Showcase de componentes de la UI (dev)](docs/assets/screenshots/showcase.png)<br><sub>Showcase de componentes (dev)</sub> |

</details>

## Contenido

- [Qué es](#qué-es) · [Características](#características) · [Estado](#estado-del-proyecto)
- [Inicio rápido](#inicio-rápido) · [Configuración](#configuración) · [Solución de problemas](#solución-de-problemas)
- [Arquitectura](#arquitectura) · [Estructura](#estructura-del-monorepo) · [Pruebas](#pruebas-y-calidad)
- [Despliegue](#despliegue) · [Limitaciones](#limitaciones-conocidas) · [Hoja de ruta](#hoja-de-ruta)
- [Documentación](#documentación) · [Contribuir](#contribuir-seguridad-y-soporte) · [Licencia](#licencia)

## Qué es

**NT4H Digital es la digitalización del juego de mesa cooperativo
_No Time for Heroes_**, para jugadores que quieren echar partidas online
o en solitario sin renunciar a las reglas completas: el motor ejecuta las
15 fases del turno, los efectos de las cartas y la información oculta
exactamente como el juego físico.

La diferencia técnica: el motor es **determinista y event-sourced** —
cada partida es una secuencia de eventos rejugable bit a bit, lo que
permite replay, auditoría y recuperación de salas tras un reinicio.

## Características

- **Salas online multijugador** (2-4 héroes cooperativo) con WebSocket,
  reconexión automática y recuperación de partida tras caídas del servidor.
- **Modo solitario y hot-seat** — la misma regla, sin servidor.
- **Motor autoritativo**: el servidor decide la legalidad de cada comando;
  el cliente solo propone. Sin trampas ni desincronización.
- **Información oculta real**: manos, mazos, trampas y pujas solo salen en
  la vista proyectada del propio jugador; espectadores reciben la vista
  pública.
- **Replay determinista** de cualquier partida guardada.
- **Taller de contenido**: cartas, escenarios y sets personalizados con
  validación por esquema Zod antes de entrar en una partida.
- **Cuentas con JWT**, estadísticas opt-in y leaderboard público.
- **Chat de sala** con rate-limit y retención limitada.

## Estado del proyecto

> [!IMPORTANT]
> Desarrollo activo post-auditoría. Funcional pero sin versión 1.0: la
> API interna puede cambiar antes de esa marca. Suite actual: motor 744,
> mobile ~400, backend 106, runner 26 tests — todo en verde en CI.

## Inicio rápido

```bash
git clone https://github.com/US-DP/NT4H2.git && cd NT4H2
pnpm install

# Motor de reglas — 744 tests en ~8 s
cd packages/engine && pnpm test

# App web en http://localhost:8081
cd apps/mobile && pnpm web
```

Backend y runner solo hacen falta para el modo online:

```bash
# Backend (:8000) — variables en .env.example
cd apps/backend
python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python manage.py migrate && .venv\Scripts\python manage.py runserver

# Runner de partidas (:3001)
cd apps/engine-runner && pnpm dev
```

**Verificación**: `GET http://localhost:8000/api/health/` debe devolver
`{"status":"ok"}` y el runner responde en `http://localhost:3001/health`.

## Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node.js | ≥ 20 (CI usa 22) | engine, runner, mobile |
| pnpm | 11 | workspaces + turbo |
| Python | 3.11+ | backend Django |
| Docker | cualquiera | solo para la imagen del runner |

## Configuración

Todo tiene fallback seguro en desarrollo — la app web y el motor arrancan
sin configurar nada. Las variables marcadas como `(PROD)` en
[`.env.example`](.env.example) son obligatorias en producción:

| Variable | Componente | Efecto |
|---|---|---|
| `DJANGO_SECRET_KEY` | backend | (PROD) secreto de Django |
| `DATABASE_URL` | backend | Postgres; vacío = SQLite local |
| `REDIS_URL` | backend | (PROD multi-worker) channel layer; vacío = InMemory |
| `ENGINE_RUNNER_TOKEN` | backend + runner | (PROD) secreto compartido `X-Engine-Token` |
| `ENGINE_RUNNER_URL` | backend | URL del runner (def. `http://localhost:3001`) |
| `ENGINE_RUNNER_STATE_DIR` | runner | snapshots a disco; vacío = memoria pura |
| `METRICS_TOKEN` | backend | Bearer para `/api/metrics/` fuera de localhost |
| `CONTENT_API_TOKEN` | backend | Bearer requerido en escrituras `/api/cards*` |

## Solución de problemas

**`Cannot find module './loader.js'` en Metro** — los paquetes del
workspace usan imports ESM con extensión `.js`; `metro.config.js` ya lleva
el resolver que los reescribe. No borres esa personalización.

**El runner no responde (`ECONNREFUSED :3001`)** — el backend lo tolera:
los endpoints que dependen del motor devuelven error controlado. Arranca
`apps/engine-runner` con `pnpm dev` o acepta el fallo en esas rutas.

**Warnings de versiones Expo al arrancar** (`expo-router`, `react-native`,
`expo-image`…) — el bundle funciona igual; la alineación de versiones está
registrada en `docs/TECH_DEBT.md`.

**En Windows, comandos que imprimen por stderr devuelven exit 1** — es un
quirk de PowerShell con streams nativos (`$ErrorActionPreference`), no un
fallo real: comprueba la salida ("OK", "would be left unchanged").

## Arquitectura

```mermaid
flowchart LR
    Mobile[App Expo<br>web + móvil] -->|REST + WS| Backend[Django + Channels<br>salas, auth, persistencia]
    Backend -->|HTTP + X-Engine-Token| Runner[engine-runner<br>una sala por partida]
    Runner --> Engine["@nt4h/engine<br>motor determinista"]
    Backend --> DB[(Postgres / SQLite)]
    Backend --> Redis[(Redis<br>channel layer)]
```

La app envía **intenciones** (`PLAY_CARD`, `END_TURN`, …); el runner las
valida con `isLegal`, las ejecuta en el motor y devuelve el veredicto;
el backend persiste el comando (dedup por `cid`) y avisa por WS. Los
clientes re-piden su **vista proyectada** — nunca el estado completo.
Detalle en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Estructura del monorepo

```text
packages/
  engine/        Motor de reglas determinista (TypeScript, vitest)
  catalog/       Catálogo oficial + sets del Taller (Zod)
  schema/        Tipos y schemas compartidos
  config/        tsconfig base
apps/
  mobile/        Frontend Expo (vitest + E2E Playwright)
  backend/       API REST + WebSocket (Django + Channels)
  engine-runner/ Servicio Node: una instancia del motor por sala
docs/            Arquitectura, ADRs, operación, auditorías, gobernanza
scripts/         Trazabilidad, complejidad, verificación de catálogo
tools/           test_all, release
```

## Pruebas y calidad

```powershell
tools/test_all.ps1    # una orden: engine + runner + mobile + backend + yamllint
```

Por capa: `pnpm test`/`typecheck`/`lint` en cada paquete TS,
`python manage.py test` + `ruff` + `black` + `bandit` en el backend,
E2E con Playwright (`pnpm test:e2e`). La CI corre todo por capas,
con análisis de secretos y dependencias, OpenSSF Scorecard y releases
con SBOM CycloneDX + attestation SLSA.

## Despliegue

- **Runner**: `apps/engine-runner/Dockerfile` (`node:22-alpine`,
  `USER node`, contexto = raíz del monorepo).
- **Backend**: ASGI (uvicorn/daphne) + Postgres + Redis.
- Runbook: [`docs/operations/deployment.md`](docs/operations/deployment.md) ·
  checklist de go-live: [`docs/operations/production-readiness.md`](docs/operations/production-readiness.md) ·
  SLOs: [`docs/operations/slo.md`](docs/operations/slo.md).

## Limitaciones conocidas

- El runner es mono-instancia (estado en memoria + snapshots a disco):
  toda la carga online recae en un proceso.
- Sin emparejamiento público ni ladder: las salas se crean por código.
- Los saves locales guardan la partida sin cifrar (hot-seat: el
  dispositivo es la frontera de confianza).
- `docs/TECH_DEBT.md` lleva el registro completo con triggers de pago.

## Hoja de ruta

- [x] Motor determinista completo (15 fases, event-sourcing, replay).
- [x] Salas online con reconexión, host-transfer y recuperación tras
      reinicio del runner (snapshots `GameSnapshot` + `STATE_DIR`).
- [x] Taller de contenido personalizado validado por esquema.
- [ ] Versión 1.0: congelar API interna y formato de save.
- [ ] Alinear versiones Expo (router 5, RN 0.79.6, skia, image).
- [ ] Emparejamiento público / leaderboard competitivo.
- [ ] Exportar partidas a formatos externos (PGN-like).

## Documentación

| Para | Doc |
|---|---|
| Guía operativa completa | [`AGENTS.md`](AGENTS.md) |
| Arquitectura y contratos | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| API REST/WS | [`docs/api/api.md`](docs/api/api.md) |
| Amenazas (STRIDE) | [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) |
| Privacidad y datos | [`docs/PRIVACY.md`](docs/PRIVACY.md) · [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) |
| Calidad y deuda | [`docs/QUALITY.md`](docs/QUALITY.md) · [`docs/TECH_DEBT.md`](docs/TECH_DEBT.md) |
| Operación | [`docs/operations/`](docs/operations/) (deploy, SLO, incidentes, PRR) |
| Decisiones | [`docs/decisions/`](docs/decisions/) (ADRs) |
| Auditorías | [`docs/audits/`](docs/audits/) |

## Contribuir, seguridad y soporte

- Cómo contribuir: [`CONTRIBUTING.md`](CONTRIBUTING.md) (flujo, gates,
  Definition of Done/Ready y checklist de revisión).
- Vulnerabilidades: [`SECURITY.md`](SECURITY.md) — **nunca** en una
  incidencia pública.
- Errores y features: GitHub Issues con las plantillas del repo.

## Autores y mantenimiento

Proyecto mantenido por [US-DP](https://github.com/US-DP). Revisiones de
documentación en cada release: las capturas se regeneran con
`tools/capture-screenshots.mjs` y la guía operativa vive en
[`AGENTS.md`](AGENTS.md).

## Reconocimientos

_No Time for Heroes_ es un juego de mesa de sus autores y editorial
originales; este proyecto es una digitalización no oficial con fines
de estudio. El código usa dependencias OSS enumeradas en los manifiestos
de cada paquete y en el SBOM de cada release.

## Licencia

[`LICENSE`](LICENSE) — todos los derechos reservados; el contenido
del juego original pertenece a sus titulares.
