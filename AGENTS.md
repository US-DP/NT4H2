# NT4H Digital — Guía del proyecto

## Resumen
Digitalización del juego de mesa "No Time for Heroes" (NT4H). Motor de reglas determinista en TypeScript + frontend Expo (web/mobile) + backend Django.

## Estructura del monorepo
```
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
```

## Comandos

### Motor (packages/engine)
```bash
cd packages/engine
pnpm build        # Compilar TypeScript (tsc --noEmit, ESM)
pnpm test         # Ejecutar tests (vitest, 679 tests)
pnpm typecheck    # Verificar tipos
```

### Frontend (apps/mobile)
```bash
cd apps/mobile
pnpm web          # Iniciar servidor de desarrollo Expo web (puerto 8081)
pnpm typecheck    # Verificar tipos (tsc --noEmit)
pnpm build        # Build de producción web
pnpm test         # Ejecutar tests UI (vitest, 365 tests)
pnpm test:e2e     # Ejecutar tests E2E (Playwright)
```

### Backend (apps/backend)
```bash
cd apps/backend
python manage.py runserver
python manage.py test       # 89 tests Django
ruff check .                # Linter Python (ruff.toml configurado)
bandit -r .                 # Análisis de seguridad Python
```

### Linters (todo el monorepo)
```bash
# Engine (TypeScript + ESLint + eslint-plugin-security)
cd packages/engine && pnpm lint    # 290 warnings (object-injection falsos positivos, any, prefer-const)

# UI (TypeScript + ESLint + react-hooks + security)
cd apps/mobile && pnpm lint                    # eslint . (0 errores, 242 warnings de plugins conocidos)

# Catalog / Schema (TypeScript + ESLint)
cd packages/catalog && pnpm eslint src   # 1 warning
cd packages/schema && pnpm eslint src    # 0 problemas

# Backend (Python: ruff + bandit)
cd apps/backend && ruff check .    # 0 errores
cd apps/backend && bandit -r .     # 0 issues
cd apps/backend && black --check -l 120 .   # formateado (config en .flake8/.pylintrc)
cd apps/backend && flake8 .                 # 0 (config .flake8; plugins ANN/DAR/WPS excluidos)
cd apps/backend && pydocstyle --convention=google --add-ignore=D1 .   # 0
cd apps/backend && DJANGO_DEBUG=true pylint backend content game      # 10/10 (.pylintrc + pylint-django)
```

**Configuración ESLint**: `eslint.config.js` en cada paquete TS con reglas de seguridad (no-eval, no-child-process, unsafe-regex, pseudoRandomBytes), TypeScript estricto (no-explicit-any, consistent-type-imports) y calidad (prefer-const, eqeqeq, no-debugger).

**Nota react-hooks/rules-of-hooks**: desactivada en UI por bug conocido de eslint-plugin-react-hooks v5 con multi-archivo (reporta falsos positivos en archivos que no usan hooks). `exhaustive-deps` sigue activa.

## Notas técnicas importantes

### Metro + ESM TypeScript
Los paquetes del workspace (`@nt4h/engine`, `@nt4h/catalog`, etc.) usan la convención ESM de importar con extensión `.js` (ej: `from './loader.js'`). Metro (Expo) no resuelve `.js` a `.ts` por defecto.

**Solución**: `apps/mobile/metro.config.js` tiene un resolver personalizado que reescribe imports relativos con extensión `.js`/`.mjs` a sin extensión, para que Metro los resuelva via `sourceExts`.

### React 19
El proyecto usa React 19.0.0 con `jsx: "react-jsx"` en tsconfig. **No importar React explícitamente** en componentes (`import React from 'react'` causa error TS6133).

Es necesario instalar `react-dom@19.0.0` explícitamente (no viene por defecto con Expo).

### Estructura de carpetas Expo Router
- `app/index.tsx` — pantalla de inicio
- `app/(game)/index.tsx` — pantalla de partida
- `app/(settings)/index.tsx` — pantalla de configuración
- `app/_layout.tsx` — layout raíz con Stack navigator

### Estado del juego (Zustand + immer)
- `store/gameStore.ts` — estado global con Zustand + immer
- `store/useProjectedState.ts` — hook para estado proyectado (ocultación de info)
- Hot-seat: `viewerId` + `privacyScreen` para cambiar de jugador
- Persistencia: localStorage (web) para guardar/cargar partidas

### Motor de reglas
- 679 tests pasan (vitest)
- Fases 1-9 completas: RNG, catálogo, fases, efectos, héroes, escenarios, solo, multiclase
- Módulos avanzados: projection, replay, modifiers
- Build limpio (tsc --noEmit)
- D364-D367: Multiclase integrado en setupGame (secondDeckId, capabilities, mercado filtrado, warlordsDefeatedCount)
- D371: Ventana de reacción en HORDE_ATTACK (REACTION_WINDOW pending choice)
- D370: Lisavette usa carta Escudo de mano (warrior.shield)
- Comandos: PLAY_CARD, END_ATTACK, EVASION, BUY_CARD, END_TURN, USE_HERO_ABILITY, CHOOSE_LEADER_CARDS, RESOLVE_CHOICE, PASS, SWAP_STARTING_CARDS, ACCEPT_TURN_START_EFFECT, OPEN_SUPPORT_DECK, BUY_SUPPORT_CARD (13 tipos — START_GAME/SELECT_TARGET no existen en la union; el start lo orquesta el runner y los objetivos van en PLAY_CARD.targetEnemyId)
- D440: fidelidad del eventLog — `ENEMY_REVEALED` transporta `enemy?: EnemyState` completo (el reducer lo inserta y saca de hordeDeck; `reward` se redacta en la proyección online); `SCENARIO_REVEALED` extrae la carta de `scenarioDeck`; `EFFECTS_EXPIRED{scope:HORDE_ATTACK_END|RESTORATION|TURN_END}` reproduce las limpiezas de fase vía helpers compartidos en `modifiers/` (cleanupHordeAttackEnd/cleanupRestoration/cleanupTurnEnd); `PENDING_CHOICES_REMOVED` documenta la poda de elecciones de héroes eliminados; `TROPHY_REMOVED` documenta la retirada de trofeos (Portal de Ulthar); `HORDE_ATTACKED` consume `interceptedBy`. `processHordeAttackTriggers` devuelve state con eventos YA aplicados — los llamadores aplican los eventos sobre el estado PRE-trigger (o usan el state tal cual), nunca ambos.

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
- **Contenido custom online**: `config.customSets` viaja al runner, que lo valida (`ContentSetSchema` + `validateContentSet`) y fusiona solo para esa sala (`mergeCustomCards`); el backend reenvía pools (`hordeCardIds`, `warlordIds`, `marketCardIds`, `customDecks`, `scenarioIds`…). `config.contentManifest` (id+versión de sets del host) permite al invitado ver qué le falta e importarlo desde la propia sala.
- **Roster online por miembros**: el invitado elige héroe+clase+cara al unirse (`Player.hero_id/deck_id/hero_face`); `start_room` exige roster completo y **reconstruye la sala del runner** (`delete` + `create` con los `heroes` de todos los miembros) antes de marcar PLAYING — en WAITING no hay estado de motor que perder.
- **Config pública vs privada**: `GameSession.to_dict(include_private_config=…)` filtra la config por `_PUBLIC_CONFIG_KEYS` (manifest, versiones, customSets — lo que un invitado necesita para jugar); los pools del motor (`hordeCardIds`…) solo salen a miembros autenticados (`room_state` con `?playerId` + `X-Player-Token`).
- **Broadcast sin events**: `game.command_result` difunde metadatos (comando, accepted, stateChanged, revisión) — nunca los `events` en crudo del runner (revelarían manos, descartes y orden futuro del mazo a espectadores). Los clientes re-piden su vista proyectada por GET.
- **Limpieza de salas**: `reap_stale_rooms()` borra WAITING sin conectados y FINISHED antiguas; corre perezoso en `list_rooms` (≤1/min) y vía `python manage.py reap_rooms`.
- **Runner**: `create` devuelve 409 si la sala ya existe (no reinicia en silencio); el shutdown cierra el HTTP antes de volcar snapshots (los comandos del drain no se pierden); JSON malformado responde 400 JSON (middleware de error).
- **Pericias de Señores declarativas**: `CardDefinition.peritia = {trigger: DAMAGE_DEALT|CARD_PLAYED|CONTINUOUS, effects, condition?}` — el resolver las ejecuta genéricamente (Gurdrug y Shriekknifer migrados a datos; el aura CONTINUOUS de Roghkiller sigue especial-casada en setup/engine). Los Señores del Taller llevan pericia sin tocar código.
- **Trazabilidad**: `scripts/gen_traceability.py` regenera `docs/rules-traceability.json` (v2): 20 reglas + 92 cartas, 92/92 VERIFIED. `scripts/verify_cards_ocr.py` cruza catálogo vs OCR del P&P (`docs/card-verification-report.json`); `scripts/promote_verified.py` promociona a CONFIRMED.
- **Settings seguros**: `DJANGO_DEBUG=False` por defecto, `SECRET_KEY` obligatoria en producción, `ALLOWED_HOSTS` explícito, cookies/HTTPS seguros cuando `DEBUG=False`.

## Estado del desarrollo
- [x] Fases 1-9: Motor de reglas completo
- [x] Fase 10: Frontend offline (web) — funcional
- [x] BUG-1..8: Correcciones de auditoría contra especificación maestra
- [x] Tests UI: Niveles 9-15 completos (365 tests, vitest + renderer custom)
- [x] Tests E2E: Nivel 16 configurado (Playwright, recorridos críticos)
- [x] CI: Workflow por capas para motor y UI
- [x] Fase 11: Backend + online — salas REST + WebSocket + integración engine-runner + UI online
- [x] Fase 12: Estudio de creación — pantalla StudyScreen con 12 pestañas (UI-240..325), navegación secundaria, migas de pan, estado de guardado, constructor de mazos, sandbox, versionado

## Sistema de tests

### Motor de reglas (packages/engine)
- **Niveles 0-8**: 679 tests con vitest
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
- **Total UI**: 365 tests (vitest) + E2E (Playwright)
- **Backend**: 89 tests (Django TestCase) — API REST salas, jugadores, engine state, content CRUD (CardDefinition, CardVersion), autorización por token
- **Engine-runner**: `pnpm test` (node:test + tsx, sin deps nuevas) — regresión de dedup por cid antes de clientSequence
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
- `backend/game/consumers.py`, `game/engine_client.py`, `game/views.py` — salas REST + WebSocket con delegación a engine-runner.
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
- `TRAZABILIDAD_UI.md` — matriz requisitos UI-* → componentes → tests
- `ESPECIFICACION_UI.md` — especificación completa de UI (292 requisitos: 7 principios UI-P + 285 numerados UI-001..UI-424, 46 secciones, cubre juego/comunicación/creación/gestión, priorización MVP y criterios de aceptación)
- `ESTRATEGIA_PRUEBAS.md` — estrategia maestra de pruebas (32 secciones, 21 niveles)
- `ANALISIS_BRECHA_PRUEBAS.md` — análisis de brecha entre estrategia e implementación

## Sistema de logros y estadísticas
- lib/achievements.defs.ts — catálogo declarativo de logros (añadir = una fila; stat = clave estable de STATS en lib/achievements.ts, cambiarla rompe progreso acumulado).
- lib/gameHistory.ts — registro idempotente en 
t4h-game-history; la partida se graba en FINISHED con eventos del eventLog (marketBuys, enemiesDefeated, warlordsByMe).
- Comunidad (opt-in shareStats, default off): POST /api/stats/report/ + GET /api/stats/community/ → rareza global anónima (contadores CommunityStat, sin identidad).
- Diseño y taxonomía completos: docs/logros-y-estadisticas.md.

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

## Regla de auditoría continua
**Obligatorio**: Cada vez que se encuentre una discrepancia entre el código y la `ESPECIFICACION_MAESTRA.md`, al terminar la corrección se deben realizar **5 tandas adicionales** de comprobación leyendo secciones distintas del documento maestro y verificando que el código concuerda. El objetivo es asegurar convergencia completa con la especificación.
