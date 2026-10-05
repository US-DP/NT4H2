# Dependencias — NT4H Digital

Monorepo pnpm (`pnpm-workspace.yaml`). Versiones fijadas por
`pnpm-lock.yaml` (JS/TS) y `apps/backend/requirements.txt` (Python).

## Runtime — motor y frontend

| Dependencia | Uso | Licencia |
|---|---|---|
| TypeScript | motor `packages/engine` (ESM estricto) | Apache-2.0 |
| Zod | schemas de `packages/schema` + validación en runner | MIT |
| Expo / React Native | app `apps/mobile` (web + mobile) | MIT |
| React | 19 — UI de la app | MIT |
| Zustand + immer | estado del juego en UI | MIT |
| react-native-unistyles | tema de componentes `Nt*` | MIT |
| Node.js | `apps/engine-runner` (servidor de salas) | MIT |
| ws | WebSocket del runner | MIT |

## Runtime — backend

| Dependencia | Uso | Licencia |
|---|---|---|
| Django | API + auth + admin | BSD-3 |
| Django REST Framework | endpoints REST | BSD-3 |
| Channels + Daphne | WebSocket lobby/partida | BSD-3 |
| channels-redis | channel layer en producción | BSD-3 |
| psycopg2-binary | Postgres en producción | LGPL |
| djangorestframework-simplejwt | JWT | MIT |
| httpx | llamadas backend→runner | BSD-3 |

## Tooling de desarrollo/CI

| Herramienta | Uso |
|---|---|
| vitest | tests motor y UI |
| Playwright | E2E de la app |
| ESLint + eslint-plugin-security | lint TS (por paquete) |
| ruff, bandit, black, flake8, pyright, deptry, vulture, radon, pip-audit | toolchain Python |
| yamllint, actionlint | lint de workflows |

## Política

- Ninguna dependencia nueva sin justificar en el PR (licencia,
  mantenimiento, alternativa stdlib).
- Dependabot activo (npm/pip/github-actions) semanal.
- `pip-audit` + scorecard en CI — CVEs bloquean.
