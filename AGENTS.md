# NT4H Digital — Guía del proyecto

## Resumen

Digitalización del juego de mesa "No Time for Heroes" (NT4H). Motor de reglas determinista en TypeScript + frontend Expo (web/mobile) + backend Django.

## Estructura del monorepo

```text
nt4h-digital/
├── packages/
│   ├── engine/       # Motor de reglas (TypeScript, ESM)
│   ├── catalog/      # Catálogo de cartas (JSON + validación Zod)
│   ├── schema/       # Tipos compartidos (Zod schemas)
│   └── config/       # tsconfig base compartido
├── apps/
│   ├── mobile/       # Frontend Expo (web + mobile)
│   ├── backend/      # Backend Django + Channels
│   └── engine-runner/ # Servidor Node que ejecuta el motor
├── docs/            # ARCHITECTURE, decisions/ (ADRs),
│                    # operations/ (DEPLOYMENT), api/ (API), audits/ (informes)
└── .github/         # workflows CI + CODEOWNERS + plantillas PR/issue
```

Documentos del proyecto: `README.md` (entrada), `SECURITY.md` (reporte de
vulnerabilidades), `CONTRIBUTING.md` (flujo + gates), `CHANGELOG.md`,
`.env.example` (todas las vars con fallback de dev documentadas),
`LICENSE` (todos los derechos reservados).

## Comandos

### Motor (packages/engine)

```bash
cd packages/engine
pnpm build        # Compilar TypeScript (tsc --noEmit, ESM)
pnpm test         # Ejecutar tests (vitest, 737 tests)
pnpm typecheck    # Verificar tipos
```

### Frontend (apps/mobile)

```bash
cd apps/mobile
pnpm web          # Iniciar servidor de desarrollo Expo web (puerto 8081)
pnpm typecheck    # Verificar tipos (tsc --noEmit)
pnpm build        # Build de producción web
pnpm test         # Ejecutar tests UI (vitest, 400 tests)
pnpm test:e2e     # Ejecutar tests E2E (Playwright)
pnpm test:e2e:demo # E2E con navegador VISIBLE + slowMo + vídeo
                   # (playwright.demo.config.ts; E2E_SLOW_MO=800 para más
                   # pausa; -g "Nombre" filtra; usa E2E_BASE_URL si está)
```

### Backend (apps/backend)

```bash
cd apps/backend
python manage.py runserver
python manage.py test       # 106 tests Django
ruff check .                # Linter Python (ruff.toml configurado)
bandit -r .                 # Análisis de seguridad Python
```

### Linters (todo el monorepo)

```bash
# Engine (TypeScript + ESLint + eslint-plugin-security)
cd packages/engine && pnpm lint    # 290 warnings (object-injection falsos positivos, any, prefer-const)

# UI (TypeScript + ESLint + react-hooks + security)
cd apps/mobile && pnpm lint                    # eslint . (0 errores, 261 warnings; --max-warnings 270)

# Catalog / Schema (TypeScript + ESLint)
cd packages/catalog && pnpm eslint src   # 1 warning
cd packages/schema && pnpm eslint src    # 0 problemas

# Backend (Python: ruff + bandit)
cd apps/backend && ruff check .    # 0 errores
cd apps/backend && bandit -r .     # 0 issues
cd apps/backend && black --check -l 120 .   # formateado (config en .flake8/.pylintrc)
cd apps/backend && flake8 .                 # 0 (config .flake8; plugins ANN/DAR/WPS excluidos)
cd apps/backend && pydocstyle --convention=google --add-ignore=D1 .   # 0
cd apps/backend && DJANGO_DEBUG=true pylint backend game      # 10/10 (.pylintrc + pylint-django)
cd apps/backend && deptry .                 # 0 (config en pyproject.toml [tool.deptry])
cd apps/backend && vulture .                # 0 (config en pyproject.toml [tool.vulture] — convenciones Django en ignore_names)
cd apps/backend && python -m pip_audit -r requirements.txt            # 0 CVEs
cd apps/backend && npx pyright              # type-check (pyrightconfig.json; ~67 falsos positivos Django/DRF sin stubs (.players inversa, .user_id FK, .data en tests, Client.get/patch posicional, username=None del User custom))
cd .. && cd .. && yamllint .                # 0 (config .yamllint.yml — 'on:' de GHA y 120 cols)
cd .. && cd .. && actionlint .github/workflows/*.yml                  # 0 errores en CI workflows
cd apps/backend && radon cc -s -a backend game --exclude "migrations,tests.py"  # media A (2.7); ninguna función ≥C
cd apps/backend && radon mi -s game/views                           # todo A
# detect-secrets scan apps/backend                                   # 0 secretos
# codespell: NO usar con el dict por defecto — el repo es ES-first y
#   solo produce falsos positivos (fase/oficial/comando/hiLight…).
# mypy/refurb: bloqueados en Windows por WDAC (módulos mypyc compilados
#   no autorizados por el Control de Aplicaciones) — usar pyright.
```

**Un comando lo verifica todo**: `tools/test_all.ps1` / `tools/test_all.sh` (engine+runner+mobile+backend+yamllint). Gate local opt-in: `git config core.hooksPath .githooks`. Release: `tools/release.ps1 x.y.z` (exige [vx.y.z] en CHANGELOG + suite verde, taggea). Dependabot (npm/pip/docker/gha) + OpenSSF scorecard en CI; releases adjuntan SBOM CycloneDX + attestation SLSA del tarball del runner. Gobernanza: docs/THREAT_MODEL (STRIDE), docs/PRIVACY, docs/DATA_MODEL, docs/QUALITY (presupuestos), docs/TECH_DEBT (registro con triggers), docs/DEPRECATION (los eventos del motor nunca se eliminan — el fold de replays viejos depende de ellos), docs/operations/{INCIDENTS,production-readiness}. CONTRIBUTING lleva DoR/DoD + checklist de revisión (determinismo y privacidad son bloqueantes).

**Tipado Python**: `mypy`/`refurb` quedan bloqueados por Windows App Control (WDAC bloquea las DLLs nativas de mypy); se usa `pyright` vía Node como sustituto. `vulture`/`codespell` no aportan en este repo: todo falsos positivos por convenciones Django (settings, admin, migrations) y por ser un proyecto en español.

**Configuración ESLint**: `eslint.config.js` en cada paquete TS con reglas de seguridad (no-eval, no-child-process, unsafe-regex, pseudoRandomBytes), TypeScript estricto (no-explicit-any, consistent-type-imports) y calidad (prefer-const, eqeqeq, no-debugger).

**Nota react-hooks/rules-of-hooks**: desactivada en UI por bug conocido de eslint-plugin-react-hooks v5 con multi-archivo (reporta falsos positivos en archivos que no usan hooks). `exhaustive-deps` sigue activa.

## Notas técnicas importantes

### Metro + ESM TypeScript

Los paquetes del workspace (`@nt4h/engine`, `@nt4h/catalog`, etc.) usan la convención ESM de importar con extensión `.js` (ej: `from './loader.js'`). Metro (Expo) no resuelve `.js` a `.ts` por defecto.

**Solución**: `apps/mobile/metro.config.js` tiene un resolver personalizado que reescribe imports relativos con extensión `.js`/`.mjs` a sin extensión, para que Metro los resuelva via `sourceExts`.

### Unistyles (componentes `Nt*`)

`react-native-unistyles` v3 exige el plugin babel `['react-native-unistyles/plugin', { root: 'apps/mobile' }]` en `apps/mobile/babel.config.js`. **Sin él los `StyleSheet.create(theme => …)` devuelven estilos vacíos** — los NtButton/NtInput/etc. se renderizan como texto plano sin fondo (síntoma: botones "invisibles" en pantallas de sala). Tras tocar babel.config.js hay que reiniciar Metro con `--clear`.

Los motivos de bloqueo del motor llegan como `reasonCode` + `costs` (evaluation.ts); la UI los traduce con `lib/engineReasons.ts` — nunca pintar `reason` en crudo (es inglés).

### React 19

El proyecto usa React 19.0.0 con `jsx: "react-jsx"` en tsconfig. **No importar React explícitamente** en componentes (`import React from 'react'` causa error TS6133).

Es necesario instalar `react-dom@19.0.0` explícitamente (no viene por defecto con Expo).

### Estructura de carpetas Expo Router

- `app/index.tsx` — pantalla de inicio
- `app/(game)/index.tsx` — pantalla de partida
- `app/(settings)/index.tsx` — pantalla de configuración
- `app/_layout.tsx` — layout raíz con Stack navigator

### Estado del juego (Zustand + immer)

- `store/gameStore.ts` — compositor: estado inicial + `useGameStore` (Zustand + immer)
- `store/shared.ts` — tipos (GameStore, SavedGame…) + helpers compartidos (sanitizeOnlineState, newCid)
- `store/slices/{ui,gameplay,online,saves}.ts` — acciones por dominio (StateCreator con immer)
- `store/useProjectedState.ts` — hook para estado proyectado (ocultación de info)
- Hot-seat: `viewerId` + `privacyScreen` para cambiar de jugador
- Persistencia: localStorage (web) para guardar/cargar partidas

### Estructura del engine (paquete @nt4h/engine)

- `effects/registry.ts` — EffectRegistry + evaluadores compartidos (evalValue, resolveTarget…)
- `effects/handlers/{damage,cards,economy,enemies,control}.ts` — los 68 `register()` por dominio
- `effects/resolver.ts` — resolveCard + executeEffectChain; `rapidShot.ts`/`hordeTriggers.ts` aparte
- `commands/execute.ts` — execute + isLegal; `commands/resolveChoice.ts` — despacho RESOLVE_CHOICE
- `events/applyEvent.ts` — fold + helpers; `events/reducers/{combat,cards,economy,flow}.ts` — un applyXxx por tipo
- `phases/engine.ts` — orquestador processPhases; `phases/steps/*.ts` — una fase por archivo

### Check de complejidad/LOC

`python scripts/check-complexity.py [--fail]` — informe LOC + densidad de decisiones
por archivo (excluye node_modules/tests/datos declarativos). WARN >800 LOC,
FAIL >1500 LOC (con `--fail` sale 1). Ratchet: no dejar crecer sin refactor.

### Motor de reglas

- 744 tests pasan (vitest)
- Eventos de coste explícitos: `COINS_LOST`/`GLORY_LOST` (ambos clamp a 0) — ya no se emiten `COINS_GAINED`/`GLORY_GAINED` con amount negativo (COST, Apoyos solitario, Portal de Ulthar). `applyCoinsGained` sigue admitiendo negativos para rejugabilidad de logs antiguos.
- Fases 1-9 completas: RNG, catálogo, fases, efectos, héroes, escenarios, solo, multiclase
- Módulos avanzados: projection, replay, modifiers
- Build limpio (tsc --noEmit)
- D364-D367: Multiclase integrado en setupGame (secondDeckId, capabilities, mercado filtrado, warlordsDefeatedCount)
- D371: Ventana de reacción en HORDE_ATTACK (REACTION_WINDOW pending choice)
- D370: Lisavette usa carta Escudo de mano (warrior.shield)
- Comandos: PLAY_CARD, END_ATTACK, EVASION, BUY_CARD, END_TURN, USE_HERO_ABILITY, CHOOSE_LEADER_CARDS, RESOLVE_CHOICE, PASS, SWAP_STARTING_CARDS, ACCEPT_TURN_START_EFFECT, OPEN_SUPPORT_DECK, BUY_SUPPORT_CARD (13 tipos — START_GAME/SELECT_TARGET no existen en la union; el start lo orquesta el runner y los objetivos van en PLAY_CARD.targetEnemyId)
- D440: fidelidad del eventLog — `ENEMY_REVEALED` transporta `enemy?: EnemyState` completo (el reducer lo inserta y saca de hordeDeck; `reward` se redacta en la proyección online); `SCENARIO_REVEALED` extrae la carta de `scenarioDeck`; `EFFECTS_EXPIRED{scope:HORDE_ATTACK_END|RESTORATION|TURN_END}` reproduce las limpiezas de fase vía helpers compartidos en `modifiers/` (cleanupHordeAttackEnd/cleanupRestoration/cleanupTurnEnd); `PENDING_CHOICES_REMOVED` documenta la poda de elecciones de héroes eliminados; `TROPHY_REMOVED` documenta la retirada de trofeos (Portal de Ulthar); `HORDE_ATTACKED` consume `interceptedBy`. `processHordeAttackTriggers` devuelve state con eventos YA aplicados — los llamadores aplican los eventos sobre el estado PRE-trigger (o usan el state tal cual), nunca ambos.
- D441: `isLegal` rechaza TODO comando en `FINISHED` (excepto `PASS`, no-op por contrato); `GAME_ENDED` limpia `pendingChoices`. `PLAY_CARD` exige `targetEnemyId` en cartas de daño directo (printedAttack sin reparto o efecto `SELECTED_ENEMY`/`ONE_ENEMY`), valida el `filter` de clase del objetivo, y bloquea si el jugador tiene una pendingChoice obligatoria sin resolver.
- D442: empates de selectores de héroe estadísticos (FEWEST_WOUNDS/MOST_WOUNDS/MOST_GLORY/MOST_COINS) en CUALQUIER efecto crean `SELECT_HERO`; `INTERCEPT_DAMAGE from:OTHER_HERO` también ofrece elección (era el primero de playerOrder).
- **Fuentes oficiales de verdad**: reglamento Holocubierta 2015 en `https://garesys.com/media/rules/manual-no-time-for-heroes-es.pdf` (+ reglas solitario `https://garesys.com/media/rules/nt4h-modo-solitario.pdf`); texto de carta = el PNG en `apps/mobile/assets/cards/**` (el `altText` del catálogo puede desviarse — Feldon/Idril ya corregidos). `server-clauses.test.ts` cita página del manual por regla.
- D443: proyección — `DECK_SHUFFLED`/`DECK_RESHUFFLED` son públicos salvo `newOrder`; `PENDING_CHOICES_REMOVED` lleva los ids redactados (`hidden`); chat persiste sin lock de sesión (colisión seq→reintento) y con retención de 200 mensajes por sala.
- D446: `skip-turn` exige host + PLAYING **y** que el turno lleve ≥`SKIP_TURN_MIN_SECONDS` (120 por defecto) si el jugador sigue conectado — antes era un botón de veto universal del host. `PERSISTENT_CARD_PLACED`/`persistentCards` redactan `definitionId`+`persistentTrigger` para no-dueños (la Trampa es boca abajo) y `LEADER_BID_CARDS` redacta los ids de la puja ajena (puja secreta). `halted` del orquestador ahora sólo señala no-convergencia real: las fases que esperan entrada externa salen del bucle en el `default` en vez de quemar el presupuesto; el runner devuelve 500 `phase_halted` si la máquina agota iteraciones. Chat: el `clientMessageId` se consume DESPUÉS de validar texto/membresía (un rechazo ya no quema el token de dedup).
- D445: todas las fases declaradas están verificadas — `applyPhaseChanged` valida `canTransition` (throw en vivo y replay; un PHASE_CHANGED ilegal no puede entrar en el eventLog). `TURN_STARTED` fija `phase=TURN_START` (antes el log saltaba GAME_END_CHECK→ATTACK_CHOICE sin fase intermedia). `RESOLVING_CARD`/`WAITING_FOR_CHOICE` son fases reservadas del schema (contrato/i18n) — las elecciones usan `pendingChoices` sin fase dedicada.

### Seguridad online (D431-D439)

- **Tokens de jugador (D431)**: `Player.auth_token` (128 hex, `secrets.token_hex(64)`) emitido en `create_room` (`hostToken`) y `join_room` (`authToken`). Requerido para: `start` (solo host), `leave` (propio o host), `engine/?playerId=` (proyección). **El WS ya NO acepta `?playerId&token` en la URL** (el token largo quedaría en logs de proxy): el cliente pide `POST /api/rooms/<id>/ws-ticket/` {playerId, playerToken} → ticket efímero de un solo uso (~60 s) vinculado a (sala, jugador), y conecta con `?ticket=`. Tanto el lobby como el socket de partida usan tickets. El `playerId` del comando WS se deriva de la conexión autenticada, no del payload.
- **Validación Zod (D432)**: `server.ts` valida `CommandSchema` (discriminated union de los 13 tipos) y `CreateRoomSchema` antes de ejecutar.
- **Auth backend→runner (D433)**: header `X-Engine-Token` con secreto compartido `ENGINE_RUNNER_TOKEN` (vacío en dev = abierto).
- **processedCids acotado (D434)**: `BoundedCidSet` FIFO (máx 500) evita memory leak.
- **Sin estado completo (D435)**: el runner no devuelve `state` en `/command` ni `/state` sin `playerId` — siempre vista proyectada (espectador si no hay playerId). El broadcast WS solo difunde eventos + `stateChanged`.
- **Graceful shutdown (D436)**: SIGTERM/SIGINT cierran el server con timeout de 5s.
- **Channel layer (D437)**: `REDIS_URL` activa `channels_redis`; en dev usa InMemoryChannelLayer.
- **Escrituras de contenido (D438)**: `ContentWritePermission` exige `Authorization: Bearer $CONTENT_API_TOKEN` en POST/PUT/DELETE de `/api/cards*` cuando el token está configurado.
- **Reconexión WS (D439)**: `connectOnline` reconecta con backoff exponencial (1s→15s máx, gobernado por NetInfo) + heartbeat ping cada 20s; tras cada reconexión re-pide el estado proyectado y **vacía la cola de comandos pendientes** (`_pendingCmds`, máx acotado) — un comando enviado con el socket caído se encola en vez de perderse.
- **Persistencia del runner**: `ENGINE_RUNNER_STATE_DIR` activa snapshots atómicos por sala (tmp+rename tras cada comando aceptado) y restauración al arrancar (estado + RNG + cids + customSets). Sin la var, el runner es memoria pura.
- **Persistencia Fase-2 (backend)**: el consumer deduplica `cid` contra la columna `GameEvent.cid` ANTES de llamar al runner (sobrevive a reinicios del runner sin STATE_DIR) — `UniqueConstraint(session, cid)` hace la dedup atómica (los registros `engine_unavailable` no ocupan la columna para permitir el reintento); `GameSnapshot` guarda el estado COMPLETO del runner (vía `GET /rooms/<id>/full-state`, interno) cada `SNAPSHOT_EVERY_EVENTS=50` **eventos COMMAND** (el seq global ya no cuenta mensajes de chat) y al cerrar la sala — base del replay (≤10 por sala, poda FIFO); un `GAME_ENDED` del runner cierra la sesión a FINISHED (`mark_finished`: evento terminal + snapshot final + **estadísticas de cuenta** (`PlayerStatistics`: played/won/lost/turns) + broadcast `room.finished`). `skip_turn` persiste su cid para cubrir la dedup. (`GET /rooms/<id>/sync/` y `GameSnapshot.revision` eliminados — ningún cliente aplicaba el delta y el campo era redundante con `created_at`/`id`).
- **Contenido custom online**: `config.customSets` viaja al runner, que lo valida (`ContentSetSchema` + `validateContentSet`) y fusiona solo para esa sala (`mergeCustomCards`); el backend reenvía pools (`hordeCardIds`, `warlordIds`, `marketCardIds`, `customDecks`, `scenarioIds`…). `config.contentManifest` (id+versión de sets del host) permite al invitado ver qué le falta e importarlo desde la propia sala.
- **Roster online por miembros**: el invitado elige héroe+clase+cara al unirse (`Player.hero_id/deck_id/hero_face`); `start_room` exige roster completo y **reconstruye la sala del runner** (`delete` + `create` con los `heroes` de todos los miembros) antes de marcar PLAYING — en WAITING no hay estado de motor que perder.
- **Config pública vs privada**: `GameSession.to_dict(include_private_config=…)` filtra la config por `_PUBLIC_CONFIG_KEYS` (manifest, versiones, customSets — lo que un invitado necesita para jugar); los pools del motor (`hordeCardIds`…) solo salen a miembros autenticados (`room_state` con `?playerId` + `X-Player-Token`).
- **Broadcast sin events**: `game.command_result` difunde metadatos (comando, accepted, stateChanged, revisión) — nunca los `events` en crudo del runner (revelarían manos, descartes y orden futuro del mazo a espectadores). Los clientes re-piden su vista proyectada por GET.
- **Limpieza de salas**: `reap_stale_rooms()` borra WAITING sin conectados y FINISHED antiguas; corre perezoso en `list_rooms` (≤1/min) y vía `python manage.py reap_rooms`.
- **Runner**: `create` devuelve 409 si la sala ya existe (no reinicia en silencio); el shutdown cierra el HTTP antes de volcar snapshots (los comandos del drain no se pierden); JSON malformado responde 400 JSON (middleware de error). Un `GAME_ENDED` emite flush inmediato de persistencia (sin esperar el debounce de 500 ms — la resolución final no se pierde en un crash). `apps/engine-runner/Dockerfile` empaqueta el runner (contexto = raíz del monorepo; runtime `tsx` porque los paquetes @nt4h/* exponen `main: src/index.ts`).
- **Espectadores WS**: cap de `32` por sala vía `game/store.py` (`spectator_try_add`, atomic check+incr, TTL 6h). **D444 — estado efímero compartido**: `store.py` usa `django.core.cache`; con `REDIS_URL` es `RedisCache` (global multi-worker: rate-limits `rl:*`, tickets WS `wst:*`, espectadores `spec:*`, dedup chat `cmid:*`) y sin ella `LocMemCache` (por proceso, dev). NUNCA reintroducir dicts module-level para estos contadores. La dedup de `clientMessageId` ahora cubre resends tras reconexión (antes era un set por conexión).
- **Replay incremental**: `replayInit`/`replayStep` (@nt4h/engine) exponen un cursor de replay (estado + RNG + registry); la pantalla de replay mantiene checkpoints {state, rngState, seq} y solo recalcula el delta al avanzar (antes O(n²) por visionado completo).
- **Perf UI (M-3)**: `CardView` va en `memo` y la mano usa `HandCard` memoizado con comparador que ignora los handlers — seguro porque TODA variable que cambia su comportamiento está cubierta por una prop comparada (`mode` cubre swap/evasión, `selected` cubre la rama de deselección, `blocked` cubre jugabilidad; las acciones del store son estables). Sin hooks React nuevos ni `getState` en handlers: el renderer ligero de tests invoca los componentes directamente y mockea `useGameStore` como función plana.
- **Componentes antes muertos**: `PhaseIndicator` (UI-071, barra Ataque→Mercado→Restablecimiento) va bajo `GameHeader` en la pantalla de partida; `KeywordTooltip` (UI-224) se usa en los chips de keywords del reglamento (muestra las secciones que comparten la palabra).
- **Pericias de Señores declarativas**: `CardDefinition.peritia = {trigger: DAMAGE_DEALT|CARD_PLAYED|CONTINUOUS, effects, condition?}` — el resolver las ejecuta genéricamente (Gurdrug y Shriekknifer migrados a datos; el aura CONTINUOUS de Roghkiller sigue especial-casada en setup/engine). Los Señores del Taller llevan pericia sin tocar código.
- **Trazabilidad**: `scripts/gen_traceability.py` regenera `docs/rules-traceability.json` (v2): 20 reglas + 92 cartas, 92/92 VERIFIED. `scripts/verify_cards_ocr.py` cruza catálogo vs OCR del P&P (`docs/card-verification-report.json`); `scripts/promote_verified.py` promociona a CONFIRMED.
- **Settings seguros**: `DJANGO_DEBUG=False` por defecto, `SECRET_KEY` obligatoria en producción, `ALLOWED_HOSTS` explícito, cookies/HTTPS seguros cuando `DEBUG=False`.

## Estado del desarrollo

- [x] Fases 1-9: Motor de reglas completo
- [x] Fase 10: Frontend offline (web) — funcional
- [x] BUG-1..8: Correcciones de auditoría contra especificación maestra
- [x] Tests UI: Niveles 9-15 completos (400 tests, vitest + renderer custom)
- [x] Tests E2E: Nivel 16 configurado (Playwright, recorridos críticos)
- [x] CI: Workflow por capas para motor y UI
- [x] Fase 11: Backend + online — salas REST + WebSocket + integración engine-runner + UI online
- [x] Fase 13: Identidad persistente (cuentas) — app `accounts` con `User` custom (login por email, `display_name` único, `PlayerProfile`, `PlayerStatistics`), JWT simplejwt (access 15 min + refresh rotatorio con blacklist), endpoints `/api/v1/auth/*` (register/login/refresh/logout/claim-guest), `/api/v1/me/`, `/api/v1/players/<id>/` (público/statistics/match-history). `Player.user` FK vinculada en create/join si la petición lleva Bearer JWT (`accounts.authentication.get_auth_user` — auth POR VISTA, no global: el Bearer de CONTENT_API_TOKEN no es JWT y moriría con 401). Mobile: `lib/auth.ts` (secure-store + authFetch con refresh automático), `store/authStore.ts`, `app/(auth)/index.tsx`, entrada «Cuenta» en Perfil. Migrar AUTH_USER_MODEL en una DB existente exige recrearla (admin.0001 migra antes que accounts): en dev basta renombrar db.sqlite3 y `migrate`.
- [x] Fase 12: Estudio de creación — pantalla StudyScreen con 12 pestañas (UI-240..325), navegación secundaria, migas de pan, estado de guardado, constructor de mazos, sandbox, versionado
- [x] Plataforma Fase 2: persistencia/idempotencia — dedup de `cid` en Django (GameEvent), snapshots `GameSnapshot` del runner (cada 50 eventos + fin de partida), endpoint `full-state` interno en el runner, `GET /sync/` para resync, `mark_finished` en GAME_ENDED

## Sistema de tests

### Motor de reglas (packages/engine)

- **Niveles 0-8**: 737 tests con vitest
- CI: `.github/workflows/engine-ci.yml` (7 capas)

### UI (apps/mobile)

- **Nivel 9**: Pruebas de componentes (38 tests) — CardView, PlayerPanel, Battlefield, HandView, MarketView, PrivacyScreen
- **Nivel 10**: Pruebas de accesibilidad (25 tests) — WCAG 2.2 AA, teclado, iconos, terminología
- **Nivel 11**: Pruebas de interacción (12 tests) — seleccionar, comprar, confirmar
- **Nivel 12**: Pruebas responsive (10 tests) — móvil, tableta, escritorio
- **Nivel 13**: Pruebas de estados (11 tests) — vacío, sin catálogo, sin gameState
- **Nivel 14**: Pruebas de privacidad (8 tests) — manos ajenas, recompensas ocultas, hot-seat
- **Nivel 15**: Pruebas de flujo (12 tests) — crear partida, jugar, mercado, cambio turno
- **Nivel 15b**: Pruebas de flujo online (6 tests) — gameStore online, WebSocket, comandos
- **Nivel 15c**: Pruebas del Estudio (7 tests) — UI-240..325, navegación, migas, guardado, versionado
- **Nivel 16**: Pruebas E2E (Playwright) — 12 passed, 3 flaky, 1 skipped
- **Total UI**: 398 tests (vitest) + E2E (Playwright)
- **Backend**: 106 tests (Django TestCase) — API REST salas, jugadores, engine state, autorización por token, persistencia Fase-2
- **Engine-runner**: `pnpm test` (node:test + tsx, sin deps nuevas) — 25 tests: dedup por cid antes de clientSequence, `full-state`, restore desde snapshot, 403 `unknown_player`, persistencia atómica
- CI: `.github/workflows/ui-ci.yml` (8 capas)

### Componentes UI recientes

- `components/AppNav.tsx` — navegación adaptativa (UI-020..UI-024).
- `components/CreateGameFlow.tsx` — flujo de creación de partida (UI-040..UI-050).
- `components/ChatPanel.tsx` — panel de chat básico (UI-180..UI-189).
- `components/PlayerPanel.tsx` — paneles de jugador con capacidades (UI-080..UI-085).
- `components/HandView.tsx` — mano con jugabilidad visual (UI-100..UI-108).
- `components/Battlefield.tsx` — campo de batalla con fortaleza efectiva y daño aportado (UI-090..UI-099).
- `components/MarketView.tsx` — mercado con costes, descuentos y penalizaciones (UI-140..UI-146).
- `components/HeroDetail.tsx` — detalle ampliado de héroe (UI-084..085).
- `components/SaveIndicator.tsx` — indicador de guardado (UI-201).
- `components/ExitGameDialog.tsx` — diálogo de salida (UI-024).
- `components/HelpButton.tsx` — botón de ayuda contextual (UI-223).
- `components/Tutorial.tsx` — tutorial paso a paso (UI-220..222).
- `app/(rulebook)/index.tsx` — pantalla de reglamento con búsqueda (UI-225..226).
- `components/KeywordTooltip.tsx` — explicación de palabras clave (UI-224).
- `apps/mobile/store/gameStore.ts` — conexión online: `setGameState`, `connectOnline`, `sendOnlineCommand`, modo `local`/`online`.
- `app/(game)/index.tsx` — indicador de sala online.
- `app/(room)/index.tsx` — carga estado del motor y arranca partida online.
- `backend/game/consumers.py`, `game/engine_client.py`, `game/views/` — salas REST + WebSocket con delegación a engine-runner. `game/views/` es un paquete por dominio (antes un solo views.py ~1400 líneas): `rooms.py` (ciclo de vida/join/leave/start), `players.py` (kick/unkick/transfer/skip), `engine.py` (estado proyectado + tickets WS), `stats.py` (leaderboard/salud), `_common.py` (guardas, rate limit, `_require_host`, `_verify_player`, broadcast). `__init__.py` reexporta la superficie pública — los patch targets `game.views.X` de los tests siguen válidos.
- `app/(profile)/index.tsx` — perfil y accesibilidad (UI-014, UI-007).
- `components/MarketView.tsx` — mercado con costes, descuentos y penalizaciones (UI-140..UI-146).
- `components/Battlefield.tsx` — campo de batalla con fortaleza efectiva y daño aportado (UI-090..UI-099).
- `components/study/CreateCardTab.tsx` (~890 líneas) — Taller: metadatos, validación, guardado, biblioteca, papelera.
- `components/study/cardWorkshop/` — núcleo del editor: `model.ts` (árbol/migración/diff), `registry.ts` (acciones/condiciones/scope), `compiler.ts` (nodos→CardEffect con diagnósticos), `validation.ts` (semántica/balance/quickFix), `simulate.ts` (resolver real + seed), `text.ts` (PSCT), `EffectTree.tsx` (editor recursivo + multi-select + fragmentos + drag&drop web), `SimPanel.tsx`, `FxPreview.tsx`, `editorState.ts` (estado UI compartido), `editorStyles.ts`.

### Infraestructura de tests UI

- **Renderer custom**: `tests/renderer.ts` — renderizador ligero que no depende de react-test-renderer
- **Mocks**: `tests/mocks/` — react-native, expo-router, expo-status-bar, expo-image, react-is
- **Config**: `vitest.config.ts` con alias para mocks y paquetes del workspace

### Trazabilidad

- `docs/TRAZABILIDAD_UI.md` — matriz requisitos UI-* → componentes → tests
- `docs/ESPECIFICACION_UI.md` — especificación completa de UI (292 requisitos: 7 principios UI-P + 285 numerados UI-001..UI-424, 46 secciones, cubre juego/comunicación/creación/gestión, priorización MVP y criterios de aceptación)
- `docs/ESTRATEGIA_PRUEBAS.md` — estrategia maestra de pruebas (32 secciones, 21 niveles)
- `docs/ANALISIS_BRECHA_PRUEBAS.md` — análisis de brecha entre estrategia e implementación

## Sistema de logros y estadísticas

- lib/achievements.defs.ts — catálogo declarativo de logros (añadir = una fila; stat = clave estable de STATS en lib/achievements.ts, cambiarla rompe progreso acumulado).
- lib/gameHistory.ts — registro idempotente en
t4h-game-history; la partida se graba en FINISHED con eventos del eventLog (marketBuys, enemiesDefeated, warlordsByMe).
- Comunidad (opt-in shareStats, default off): POST /api/stats/report/ + GET /api/stats/community/ → rareza global anónima (contadores CommunityStat, sin identidad).
- Diseño y taxonomía completos: docs/LOGROS_Y_ESTADISTICAS.md.

## TODOs conocidos (features no implementadas)

- **Elección del Líder (D427, IMPLEMENTADO)**: la puja es interactiva — `setupGame` crea `pendingChoices` `SELECT_CARDS_FOR_LEADER` (`leader-bid-<pid>`) por jugador; `CHOOSE_LEADER_CARDS` resuelve por suma de daño, desempate por `playerAge`, cartas al fondo del mazo y robo hasta 4. El engine-runner y la UI móvil (`PendingChoiceView`) manejan el estado de puja pendiente.
- **Sistema de Apoyos (solitario)**: `openSupportDeck` y `buySupportCard` están cableadas a comandos `OPEN_SUPPORT_DECK` y `BUY_SUPPORT_CARD`. La carta robada se devuelve al fondo del mazo de Apoyo (pendiente de verificar en `solo.ts`)
- **Multiclase**: D364-D367 corregidos. `setupGame` ahora maneja MULTICLASS con `secondDeckId`: construye mazo de 15 cartas con 2 clases (mín 5 de cada), incluye capabilities de ambas clases, filtra mercado por capabilities. `warlordsDefeatedCount` rastrea Señores derrotados (2 en multiclase 4 jugadores). Fin de partida requiere todos los Señores derrotados.
- **Ventana de reacción D371**: HORDE_ATTACK ahora pausa para permitir pericias reactivas (Valèrys, Lisavette). `buildReactionWindow` crea elecciones `REACTION_WINDOW` para héroes no activos con pericias reactivas. Los jugadores pueden `USE_ABILITY` o `PASS` via `RESOLVE_CHOICE`.
- **Lisavette D370**: la implementación ahora verifica carta "Escudo" (warrior.shield) en mano, la juega (mueve a WEAR_PILE), transfiere 1 Escudo al héroe objetivo y roba hasta 2 Monedas. El jugador selecciona héroe y enemigo objetivos (SELECT_HERO + SELECT_ENEMY), pero el Escudo transferido previene 1 daño del total del Ataque de la Horda (no específicamente del enemigo seleccionado); hacer la prevención enemigo-específica requeriría refactorizar el sistema de daño de la Horda.
- **swapStartingCards (solitario)**: cableado al comando `SWAP_STARTING_CARDS`
- **Catálogo Huestes F2**: hay 8 Huestes con F2 en `horde.json` (coincide con el PDF). La spec del solitario dice "quedan 22" pero 27-8=19; es una inconsistencia de la spec, no del catálogo
- **Empates con elección del jugador**: `HERO_WITH_FEWEST_WOUNDS` y `ENEMY_WITH_MAX_FORTITUDE` en empate prefieren al jugador activo o primer enemigo. La spec dice "tu eliges" pero requiere UI/pendingChoice
- **Daga Élfica (RECOVER_THIS_CARD)**: interceptación en `resolver.ts` evita el `CARD_MOVED` a `WEAR_PILE` cuando la carta tiene `RECOVER_THIS_CARD`; `applyEvent` busca en `wearPile` y `hand`
- **Pericias de Señores de la Guerra**: Gurdrug (pérdida de carta al dañarlo), Shriekknifer (recuperar carta con ataque impreso 1), Roghkiller (+1 fortaleza a orcos) implementadas como hooks en `resolver.ts` y `engine.ts`
- **Catálogos de habilidades COMPLETOS**: explorer (7 únicas/15 copias), mage (9 únicas/15 copias), rogue (9 únicas/15 copias), warrior (8 únicas/15 copias). Todos coinciden con el PDF original
- **Escenarios con effects vacíos**: 7 escenarios ahora tienen `CUSTOM_SCENARIO` con handler referenciando `scenarios/index.ts`. Los handlers reales (`applyScenarioEffects`, `onTurnStart`, `executeTurnStartEffect`) se invocan en `setup.ts` y `engine.ts`
- **executeTurnStartEffect**: cableado al comando `ACCEPT_TURN_START_EFFECT`. `onTurnStart` genera `pendingChoice` CONFIRM tras `TURN_STARTED`
- **Puerto de Eque**: `executeTurnStartEffect` ahora aplica `MODIFIER_ADDED` (+1 daño) a cada enemigo del campo
- **Ruinas de Brunmar**: `applyScenarioEffects` aplica -1 a enemigos actuales; `processBattlefieldReplenishment` aplica -1 a enemigos revelados mientras el escenario esté activo
- **Héroes como 8 discretos (no 4 con 2 caras)**: el catálogo modela 8 héroes separados en lugar de 4 cartas con cara frontal/trasera. El schema tiene `heroFace: 'FEMALE' | 'MALE'` pero `setup.ts` usa `heroId` directamente. La asignación de clases está marcada `[REVISAR]` en la spec. Faltan héroes de Mago y Pícaro en el catálogo actual.
- **Constructor mazo multiclase (FIX)**: el paso 3 (completar hasta 15) ahora usa un tracker `usedCopies` por `definitionId` para respetar el límite de copias de cada carta, evitando duplicar copias más allá de lo que define el catálogo.
- **Re-revelado de escenarios tras Señor (FIX B1)**: `processBattlefieldReplenishment` y `processScenarioTransition` ahora verifican `!state.warlordRevealed` antes de revelar un nuevo escenario cuando el campo queda vacío. Antes podía revelar un escenario nuevo tras aparecer el Señor, violando la spec §3.4.
- **Lisavette prevención enemigo-específica (FIX B2)**: ahora emite `ENEMY_DAMAGE_DISABLED` para el enemigo seleccionado en vez de `SHIELD_TRANSFERRED` genérico. El enemigo seleccionado no causa daño en el Ataque de la Horda (usando el mecanismo `damageDisabled` existente).
- **Valèrys Anti-Magia con interceptor (FIX B3)**: al redirigir daño a Valèrys, el motor recalcula el daño de la Horda usando las capacidades del interceptor (no del objetivo original), para que Anti-Magia se aplique correctamente según quién recibe el daño.
- **Feldon como interceptor (FIX B10)**: si Feldon intercepta el daño de la Horda (vía Valèrys), su reducción de mitad de cartas se aplica correctamente.
- **classToCaps MAGE sin EXPERTISE (FIX B4)**: spec §7.1 confirma Mago=Magia (sin Pericia). Corregido `classToCaps` en `setup.ts`.
- **buildReactionWindow filtra Lisavette sin escudo (FIX B5)**: la ventana de reacción solo se ofrece a Lisavette si tiene `warrior.shield` en mano.
- **Aranel/Neddia/Idril no consumen uso en vacío (FIX B6)**: si el mazo de Habilidad (Aranel), mazo de Mercado (Neddia) o mazo de Horda (Idril) están vacíos, la pericia no consume el uso.
- **Filtrado multiclase mercado con penaltyCapabilities (FIX B7)**: el filtrado del mercado en multiclase ahora considera `penaltyCapabilities`, permitiendo ver cartas que se pueden comprar con penalización.
- **BUY_CARD defensivo (FIX B8)**: `execute` ahora rechaza la compra si `cardDef` es `undefined` (no solo `isLegal`).
- **marketDeck solitario limpio (FIX B9)**: en modo solitario, `marketDeck` se vacía tras seleccionar las 5 cartas iniciales (spec §4.1: no se reponen).

## Auditoría de malas prácticas (segunda ronda)

- **playerId en RESOLVE_CHOICE/CHOOSE_LEADER_CARDS (D401)**: `getPlayerIdFromCommand` derivaba todos los comandos de `activePlayerId`, imposibilitando resolver `REACTION_WINDOW` de jugadores no activos (Valèrys/Lisavette) y pujas de líder. Ahora deriva el playerId de la `pendingChoice` correspondiente.
- **Mutación en resolveCard (D402)**: `DRAW_AND_ADD_ATTACK` (Todo o Nada) mutaba `playerState.abilityDeck` in-place, corrompiendo el estado base sobre el que se aplican eventos — la carta robada desaparecía de todas las zonas. Corregido a actualización inmutable.
- **Portal de Ulthar (D398)**: `CARD_MOVED` a `HORDE_DECK` era un no-op (la Hueste no volvía al mazo) y el trofeo se destruía sin reaparecer (`ENEMY_REVEALED` no-op + búsqueda en `hordeDeck` vacía). Ahora usa `ENEMY_RETURNED_TO_HORDE` y recupera el `definitionId` del `eventLog` (ENEMY_DEFEATED) para crear el `EnemyState`.
- **Doble puja de líder (D403)**: `setupGame` creaba pendingChoices Y aplicaba la heurística → `CHOOSE_LEADER_CARDS` movía cartas dos veces. Eliminadas las pendingChoices huérfanas; la heurística es la única vía.
- **REACTION_WINDOW obsoletas (D404)**: elecciones no resueltas bloqueaban la regeneración de la ventana en turnos siguientes. Se limpian al salir de `HORDE_ATTACK`.
- **`interceptedBy` residual (D403)**: si el daño quedaba en 0, el flag persistía y redirigía el siguiente ataque. Se limpia cuando `effectiveDamage === 0`.
- **`requiredWarlordKills` hardcodeado (D405)**: multiclase 2-3 jugadores solo tiene 1 Señor pero exigía 2 → partida imposible. Ahora se deriva de los Señores reales en juego.
- **`processHordeAttackTriggers` devolvía state original (D402)**: descartaba `currentState` acumulado de los triggers de Trampa.
- **`setupSoloMode` divergente (D408)**: duplicaba setupGame sin resets, sin `applyScenarioEffects`, ignorando `copies` y sin eventos. Ahora delega en `setupGame` tras validar.
- **`MODIFY_FORTITUDE` con `ALL_ENEMIES` ignoraba `filter`** (Roghkiller): ahora respeta `isOrc`/`isWarlord`.
- **Guards en applyEvent**: `ENEMY_DEFEATED` con `defeatingPlayerId` inválido ya no crashea; `COINS_STOLEN` clampea a las monedas disponibles; `MODIFIER_ADDED` a 'market' sin `amount` ya no aplica -1 arbitrario.
- **isLegal PLAY_CARD**: valida que `targetEnemyId` exista en el campo (evita quemar carta sin efecto).
- **Backend**: `asgi.py` montaba solo HTTP — los WebSocket nunca llegaban a `GameConsumer`. Ahora `ProtocolTypeRouter` + `AllowedHostsOriginValidator` + `AuthMiddlewareStack`. `httpx.Client` síncrono en consumer async → envuelto en `database_sync_to_async`. `playerId` validado contra la sesión antes de ejecutar comandos. Transacciones atómicas en create/join_room. Validación de entrada (mode, maxPlayers, JSON body). No se exponen internals en errores.
- **engine-runner**: try/catch en handlers (un config malformado podía tumbar el proceso), `express.json({limit: '100kb'})`, límite de 1000 salas, endpoint DELETE /rooms/:roomId, validación de `cid`/`command`.
- **UI gameStore**: `buyCard`/`useHeroAbility` ignoraban `result.accepted` (mensaje falso). `sendOnlineCommand` no verificaba `readyState`. `JSON.parse` sin try/catch en onmessage. `loadGame` restauraba el snapshot inicial en vez de replayar comandos. `saveGame` reportaba éxito aunque localStorage fallara. `initialCommands` nunca se rellenaba. `'RESTORE'` vs `'RESTORATION'` inconsistente. `setMessage` no declarado en la interfaz.

## Auditoría de implementaciones a medias (tercera ronda)

- **`PLAY_RANDOM_CARD_FROM_OTHER_HERO`**: el handler robaba la carta a la mano del lanzador sin resolver sus efectos (quedaba robada para siempre). Ahora `resolveCard` la intercepta: paga la Gloria solo si hay carta que tomar, la resuelve recursivamente como el jugador activo y el destino la manda al Desgaste de su dueño. Añadida a `TOP_LEVEL_ONLY_EFFECTS` — en rutas anidadas no hay propagación de pendingChoice.
- **`IGNORE_COIN/GLORY_REWARDS`**: validados para ABILITY/MARKET pero solo consumidos por `applyScenarioEffects` — no-op silencioso en el Taller. Restringidos a `['SCENARIO']` (error de validación en vez de degradación).
- **`LOOK_AT_CARDS` + `action:'REORDER'`**: solo revelaba las cartas — el reorden nunca se pedía. `resolveCard` devuelve un `pendingChoice` `SELECT_ORDER` y `resolveChoice` continúa `pendingEffects` + aplica el destino de la carta tras reordenar.
- **Oyentes que hacen daño no comprobaban derrotas**: `dispatchListeners` aplica ahora `checkFortitudeDefeats` tras cada oyente — un oyente que mata ya emite `ENEMY_DEFEATED` (antes enemigo zombi sin trofeo ni retirada).
- **`SWAP_ENEMY` fallback** fabricaba stats (fortaleza 1, botín nulo): ahora no-op — el resolver con catálogo es la única vía.
- **`MODIFY_FORTITUDE` anidado** perdía `sourceId` → auras `WHILE_SOURCE_ACTIVE` eternas (purga por sourceId no lo encontraba). El fallback pasa `ctx.currentCardInstanceId`.
- **`DEAL_DAMAGE_HITS`/`OVERKILL_DAMAGE` ignoraban `applyDamageModifiers`** (MODIFY_DAMAGE/Piedra de Amolar solo beneficiaban a DEAL_DAMAGE). HITS aplica el bonus por golpe; OVERKILL lo incluye además en el cálculo de exceso.
- **`EnemyState.effectiveFortitude` (campo, retirado)**: era un caché stale que solo materializaba `applyModifiers` (tooling) — `abilities.ts` y Battlefield lo leían ignorando modificadores. Eliminado el campo, `applyModifiers`/`applyLayer`/alias `effectiveFortitude`, y los lectores migrados a `getEffectiveFortitude` (base+mods al vuelo). `LEADER_DETERMINED` limpia `leaderBidCards` en reducer + caminos inline (residuo de puja).
- **Comandos sin emisor móvil (corregido)**: `ACCEPT_TURN_START_EFFECT`, `SWAP_STARTING_CARDS`, `OPEN_SUPPORT_DECK`, `BUY_SUPPORT_CARD` existían en el motor pero la UI nunca los enviaba (el "Continuar" de una `turn-start-*` caía a RESOLVE_CHOICE, rechazado). Cableados: `PendingChoiceView` muestra Sí/No para `turn-start-*` → `acceptTurnStartEffect`; `SupportDecksView` (bajo MarketView) abre/compra Apoyos en SOLO; `HandView` tiene modo de cambio inicial (≤2 cartas, una vez) → `swapStartingCards`. Selección de swap en `ui.swapSelection` (el renderer ligero de tests no soporta `useState` extra en componentes). `ActionState` UI-123 completo: `confirmed`/`rejected` del veredicto `accepted` del `command_ack`, `retrying` si el socket cambia con la acción en vuelo.
- **Runner (engine-runner)**: `/command` rechaza `playerId` que no esté en `room.state.players` (403 `unknown_player`) antes de poblar `rateLimit`/`lastClientSeq` con ids arbitrarios; `GET /state` actualiza `lastActivity` — una sala con polling activo pero sin comandos (puja larga, rival pensando) ya no muere al sweep de 24h. Helpers sin `export default` dentro de `app/(game)/` generaban rutas fantasma → movidos a `app/(game)/_shared/` (el router ignora `_dirs`).
- **Schema**: eliminados `DEAL_DAMAGE.splittable` y `Modifier.conditionMet` (cero productores/consumidores en todo el repo). `makeGameState` de tests ya pasa `listeners`.
- **Multiclase online perdía `secondDeckId`/`playerAge`** (el más grave): el `Player` de Django no los persistía y `_recreate_engine_room` reconstruía el roster sin ellos → la sala MULTICLASS arrancaba sin segundas barajas y sin degradación visible. Persistidos (`Player.second_deck_id`, `player_age`, migración 0016), validados en `_parse_heroes`/`_parse_join_fields` con el contrato del runner (secondDeckId ≤128, playerAge entero 0-200), conservados en rejoin (ausencia ≠ vacío) y reenviados al recreate. El join móvil muestra el picker de segunda clase cuando el preview de la sala devuelve `MULTICLASS`.
- **`skip_turn` sin resucitación**: un 404 del runner devolvía 502 aunque existiera snapshot; ahora restaura vía `restore_room_from_snapshot` y reintenta get_state/execute una vez (mismo patrón que `room_engine_state`/`consumers`).
- **Broadcast de `skip_turn` divergente** del contrato del consumer (`command`/`roomRevision` → `commandType`/`revision` + `cid`/`accepted`). El socket de lobby lee `msg.roomRevision ?? msg.revision`.
- **Colisión de `cid` en el consumer**: si dos procesos ejecutaban el mismo comando concurrentemente, el perdedor devolvía el seq existente pero aun así difundía SU resultado — divergente si el runner reinició entre ambas. Ahora `persist_event` devuelve `(seq, deduplicado)`; el ack se emite tras persistir y el deduplicado reenvía el veredicto persistido sin segundo broadcast.
- **Backend limpiezas**: `GameSnapshot.revision` (columna+writer+migración 0017) y `GET /rooms/<id>/sync/` retirados — sin consumidor real. `ChoiceDialog` (componente duplicado de `PendingChoiceView`), `registerSound`/registry sin assets, `noColorOnly` (invariante estructural) y `useProjectedState` retirados. El lobby renderiza `deckId`/`heroFace`/`secondDeckId` del roster.

## Regla de auditoría continua

**Obligatorio**: Cada vez que se encuentre una discrepancia entre el código y la `ESPECIFICACION_MAESTRA.md`, al terminar la corrección se deben realizar **5 tandas adicionales** de comprobación leyendo secciones distintas del documento maestro y verificando que el código concuerda. El objetivo es asegurar convergencia completa con la especificación.
