# NT4H Digital â€” GuÃ­a del proyecto

## Resumen
DigitalizaciÃ³n del juego de mesa "No Time for Heroes" (NT4H). Motor de reglas determinista en TypeScript + frontend Expo (web/mobile) + backend Django.

## Estructura del monorepo
```
nt4h-digital/
â”œâ”€â”€ packages/
â”‚   â”œâ”€â”€ engine/       # Motor de reglas (TypeScript, ESM)
â”‚   â”œâ”€â”€ catalog/      # CatÃ¡logo de cartas (JSON + validaciÃ³n Zod)
â”‚   â”œâ”€â”€ schema/       # Tipos compartidos (Zod schemas)
â”‚   â””â”€â”€ config/       # tsconfig base compartido
â”œâ”€â”€ apps/
â”‚   â”œâ”€â”€ mobile/       # Frontend Expo (web + mobile)
â”‚   â”œâ”€â”€ backend/      # Backend Django + Channels
â”‚   â””â”€â”€ engine-runner/ # Servidor Node que ejecuta el motor
```

## Comandos

### Motor (packages/engine)
```bash
cd packages/engine
pnpm build        # Compilar TypeScript (tsc --noEmit, ESM)
pnpm test         # Ejecutar tests (vitest, 511 tests)
pnpm typecheck    # Verificar tipos
```

### Frontend (apps/mobile)
```bash
cd apps/mobile
pnpm web          # Iniciar servidor de desarrollo Expo web (puerto 8081)
pnpm typecheck    # Verificar tipos (tsc --noEmit)
pnpm build        # Build de producciÃ³n web
pnpm test         # Ejecutar tests UI (vitest, 198 tests)
pnpm test:e2e     # Ejecutar tests E2E (Playwright)
```

### Backend (apps/backend)
```bash
cd apps/backend
python manage.py runserver
python manage.py test       # 25 tests Django
ruff check .                # Linter Python (ruff.toml configurado)
bandit -r .                 # AnÃ¡lisis de seguridad Python
```

### Linters (todo el monorepo)
```bash
# Engine (TypeScript + ESLint + eslint-plugin-security)
cd packages/engine && pnpm lint    # 257 warnings (object-injection falsos positivos, any, prefer-const)

# UI (TypeScript + ESLint + react-hooks + security)
cd apps/mobile && pnpm eslint app components store   # 34 warnings

# Catalog / Schema (TypeScript + ESLint)
cd packages/catalog && pnpm eslint src   # 1 warning
cd packages/schema && pnpm eslint src    # 0 problemas

# Backend (Python: ruff + bandit)
cd apps/backend && ruff check .    # 0 errores
cd apps/backend && bandit -r .     # 0 issues
```

**ConfiguraciÃ³n ESLint**: `eslint.config.js` en cada paquete TS con reglas de seguridad (no-eval, no-child-process, unsafe-regex, pseudoRandomBytes), TypeScript estricto (no-explicit-any, consistent-type-imports) y calidad (prefer-const, eqeqeq, no-debugger).

**Nota react-hooks/rules-of-hooks**: desactivada en UI por bug conocido de eslint-plugin-react-hooks v5 con multi-archivo (reporta falsos positivos en archivos que no usan hooks). `exhaustive-deps` sigue activa.

## Notas tÃ©cnicas importantes

### Metro + ESM TypeScript
Los paquetes del workspace (`@nt4h/engine`, `@nt4h/catalog`, etc.) usan la convenciÃ³n ESM de importar con extensiÃ³n `.js` (ej: `from './loader.js'`). Metro (Expo) no resuelve `.js` a `.ts` por defecto.

**SoluciÃ³n**: `apps/mobile/metro.config.js` tiene un resolver personalizado que reescribe imports relativos con extensiÃ³n `.js`/`.mjs` a sin extensiÃ³n, para que Metro los resuelva via `sourceExts`.

### React 19
El proyecto usa React 19.0.0 con `jsx: "react-jsx"` en tsconfig. **No importar React explÃ­citamente** en componentes (`import React from 'react'` causa error TS6133).

Es necesario instalar `react-dom@19.0.0` explÃ­citamente (no viene por defecto con Expo).

### Estructura de carpetas Expo Router
- `app/index.tsx` â€” pantalla de inicio
- `app/(game)/index.tsx` â€” pantalla de partida
- `app/(settings)/index.tsx` â€” pantalla de configuraciÃ³n
- `app/_layout.tsx` â€” layout raÃ­z con Stack navigator

### Estado del juego (Zustand + immer)
- `store/gameStore.ts` â€” estado global con Zustand + immer
- `store/useProjectedState.ts` â€” hook para estado proyectado (ocultaciÃ³n de info)
- Hot-seat: `viewerId` + `privacyScreen` para cambiar de jugador
- Persistencia: localStorage (web) para guardar/cargar partidas

### Motor de reglas
- 511 tests pasan (vitest)
- Fases 1-9 completas: RNG, catÃ¡logo, fases, efectos, hÃ©roes, escenarios, solo, multiclase
- MÃ³dulos avanzados: projection, replay, modifiers
- Build limpio (tsc --noEmit)
- D364-D367: Multiclase integrado en setupGame (secondDeckId, capabilities, mercado filtrado, warlordsDefeatedCount)
- D371: Ventana de reacciÃ³n en HORDE_ATTACK (REACTION_WINDOW pending choice)
- D370: Lisavette usa carta Escudo de mano (warrior.shield)
- Comandos: PLAY_CARD, END_ATTACK, EVASION, BUY_CARD, END_TURN, USE_HERO_ABILITY, CHOOSE_LEADER_CARDS, SELECT_TARGET, RESOLVE_CHOICE, PASS, START_GAME, SWAP_STARTING_CARDS, ACCEPT_TURN_START_EFFECT, OPEN_SUPPORT_DECK, BUY_SUPPORT_CARD

### Seguridad online (D431-D439)
- **Tokens de jugador (D431)**: `Player.auth_token` (128 hex, `secrets.token_hex(64)`) emitido en `create_room` (`hostToken`) y `join_room` (`authToken`). Requerido para: WS connect (`?playerId&token`), `start` (solo host), `leave` (propio o host), `engine/?playerId=` (proyecciÃ³n). El `playerId` del comando WS se deriva de la conexiÃ³n autenticada, no del payload.
- **ValidaciÃ³n Zod (D432)**: `server.ts` valida `CommandSchema` (discriminated union de los 15 tipos) y `CreateRoomSchema` antes de ejecutar.
- **Auth backendâ†’runner (D433)**: header `X-Engine-Token` con secreto compartido `ENGINE_RUNNER_TOKEN` (vacÃ­o en dev = abierto).
- **processedCids acotado (D434)**: `BoundedCidSet` FIFO (mÃ¡x 500) evita memory leak.
- **Sin estado completo (D435)**: el runner no devuelve `state` en `/command` ni `/state` sin `playerId` â€” siempre vista proyectada (espectador si no hay playerId). El broadcast WS solo difunde eventos + `stateChanged`.
- **Graceful shutdown (D436)**: SIGTERM/SIGINT cierran el server con timeout de 5s.
- **Channel layer (D437)**: `REDIS_URL` activa `channels_redis`; en dev usa InMemoryChannelLayer.
- **Escrituras de contenido (D438)**: `ContentWritePermission` exige `Authorization: Bearer $CONTENT_API_TOKEN` en POST/PUT/DELETE de `/api/cards*` cuando el token estÃ¡ configurado.
- **ReconexiÃ³n WS (D439)**: `connectOnline` reconecta con backoff exponencial (1sâ†’15s mÃ¡x) + heartbeat ping cada 20s; tras cada reconexiÃ³n re-pide el estado proyectado.
- **Settings seguros**: `DJANGO_DEBUG=False` por defecto, `SECRET_KEY` obligatoria en producciÃ³n, `ALLOWED_HOSTS` explÃ­cito, cookies/HTTPS seguros cuando `DEBUG=False`.

## Estado del desarrollo
- [x] Fases 1-9: Motor de reglas completo
- [x] Fase 10: Frontend offline (web) â€” funcional
- [x] BUG-1..8: Correcciones de auditorÃ­a contra especificaciÃ³n maestra
- [x] Tests UI: Niveles 9-15 completos (198 tests, vitest + renderer custom)
- [x] Tests E2E: Nivel 16 configurado (Playwright, recorridos crÃ­ticos)
- [x] CI: Workflow por capas para motor y UI
- [x] Fase 11: Backend + online â€” salas REST + WebSocket + integraciÃ³n engine-runner + UI online
- [x] Fase 12: Estudio de creaciÃ³n â€” pantalla StudyScreen con 12 pestaÃ±as (UI-240..325), navegaciÃ³n secundaria, migas de pan, estado de guardado, constructor de mazos, sandbox, versionado

## Sistema de tests

### Motor de reglas (packages/engine)
- **Niveles 0-8**: 511 tests con vitest
- CI: `.github/workflows/engine-ci.yml` (7 capas)

### UI (apps/mobile)
- **Nivel 9**: Pruebas de componentes (38 tests) â€” CardView, PlayerPanel, Battlefield, HandView, MarketView, PrivacyScreen
- **Nivel 10**: Pruebas de accesibilidad (25 tests) â€” WCAG 2.2 AA, teclado, iconos, terminologÃ­a
- **Nivel 11**: Pruebas de interacciÃ³n (12 tests) â€” seleccionar, comprar, confirmar
- **Nivel 12**: Pruebas responsive (10 tests) â€” mÃ³vil, tableta, escritorio
- **Nivel 13**: Pruebas de estados (11 tests) â€” vacÃ­o, sin catÃ¡logo, sin gameState
- **Nivel 14**: Pruebas de privacidad (8 tests) â€” manos ajenas, recompensas ocultas, hot-seat
- **Nivel 15**: Pruebas de flujo (12 tests) â€” crear partida, jugar, mercado, cambio turno
- **Nivel 15b**: Pruebas de flujo online (6 tests) â€” gameStore online, WebSocket, comandos
- **Nivel 15c**: Pruebas del Estudio (7 tests) â€” UI-240..325, navegaciÃ³n, migas, guardado, versionado
- **Nivel 16**: Pruebas E2E (Playwright) â€” 12 passed, 3 flaky, 1 skipped
- **Total UI**: 198 tests (vitest) + E2E (Playwright)
- **Backend**: 29 tests (Django TestCase) â€” API REST salas, jugadores, engine state, content CRUD (CardDefinition, CardVersion), autorizaciÃ³n por token
- CI: `.github/workflows/ui-ci.yml` (8 capas)

### Componentes UI recientes
- `components/AppNav.tsx` â€” navegaciÃ³n adaptativa (UI-020..UI-024).
- `components/CreateGameFlow.tsx` â€” flujo de creaciÃ³n de partida (UI-040..UI-050).
- `components/ChatPanel.tsx` â€” panel de chat bÃ¡sico (UI-180..UI-189).
- `components/PlayerPanel.tsx` â€” paneles de jugador con capacidades (UI-080..UI-085).
- `components/HandView.tsx` â€” mano con jugabilidad visual (UI-100..UI-108).
- `components/Battlefield.tsx` â€” campo de batalla con fortaleza efectiva y daÃ±o aportado (UI-090..UI-099).
- `components/MarketView.tsx` â€” mercado con costes, descuentos y penalizaciones (UI-140..UI-146).
- `components/HeroDetail.tsx` â€” detalle ampliado de hÃ©roe (UI-084..085).
- `components/SaveIndicator.tsx` â€” indicador de guardado (UI-201).
- `components/ExitGameDialog.tsx` â€” diÃ¡logo de salida (UI-024).
- `components/HelpButton.tsx` â€” botÃ³n de ayuda contextual (UI-223).
- `components/Tutorial.tsx` â€” tutorial paso a paso (UI-220..222).
- `app/(rulebook)/index.tsx` â€” pantalla de reglamento con bÃºsqueda (UI-225..226).
- `components/KeywordTooltip.tsx` â€” explicaciÃ³n de palabras clave (UI-224).
- `apps/mobile/store/gameStore.ts` â€” conexiÃ³n online: `setGameState`, `connectOnline`, `sendOnlineCommand`, modo `local`/`online`.
- `app/(game)/index.tsx` â€” indicador de sala online.
- `app/(room)/index.tsx` â€” carga estado del motor y arranca partida online.
- `backend/game/consumers.py`, `game/engine_client.py`, `game/views.py` â€” salas REST + WebSocket con delegaciÃ³n a engine-runner.
- `app/(profile)/index.tsx` â€” perfil y accesibilidad (UI-014, UI-007).
- `components/MarketView.tsx` â€” mercado con costes, descuentos y penalizaciones (UI-140..UI-146).
- `components/Battlefield.tsx` â€” campo de batalla con fortaleza efectiva y daÃ±o aportado (UI-090..UI-099).

### Infraestructura de tests UI
- **Renderer custom**: `tests/renderer.ts` â€” renderizador ligero que no depende de react-test-renderer
- **Mocks**: `tests/mocks/` â€” react-native, expo-router, expo-status-bar, expo-image, react-is
- **Config**: `vitest.config.ts` con alias para mocks y paquetes del workspace

### Trazabilidad
- `TRAZABILIDAD_UI.md` â€” matriz requisitos UI-* â†’ componentes â†’ tests
- `ESPECIFICACION_UI.md` â€” especificaciÃ³n completa de UI (292 requisitos: 7 principios UI-P + 285 numerados UI-001..UI-424, 46 secciones, cubre juego/comunicaciÃ³n/creaciÃ³n/gestiÃ³n, priorizaciÃ³n MVP y criterios de aceptaciÃ³n)
- `ESTRATEGIA_PRUEBAS.md` â€” estrategia maestra de pruebas (32 secciones, 21 niveles)
- `ANALISIS_BRECHA_PRUEBAS.md` â€” anÃ¡lisis de brecha entre estrategia e implementaciÃ³n

## TODOs conocidos (features no implementadas)
- **ElecciÃ³n del LÃ­der (D427, IMPLEMENTADO)**: la puja es interactiva â€” `setupGame` crea `pendingChoices` `SELECT_CARDS_FOR_LEADER` (`leader-bid-<pid>`) por jugador; `CHOOSE_LEADER_CARDS` resuelve por suma de daÃ±o, desempate por `playerAge`, cartas al fondo del mazo y robo hasta 4. El engine-runner y la UI mÃ³vil (`PendingChoiceView`) manejan el estado de puja pendiente.
- **Sistema de Apoyos (solitario)**: `openSupportDeck` y `buySupportCard` estÃ¡n cableadas a comandos `OPEN_SUPPORT_DECK` y `BUY_SUPPORT_CARD`. La carta robada se devuelve al fondo del mazo de Apoyo (pendiente de verificar en `solo.ts`)
- **Multiclase**: D364-D367 corregidos. `setupGame` ahora maneja MULTICLASS con `secondDeckId`: construye mazo de 15 cartas con 2 clases (mÃ­n 5 de cada), incluye capabilities de ambas clases, filtra mercado por capabilities. `warlordsDefeatedCount` rastrea SeÃ±ores derrotados (2 en multiclase 4 jugadores). Fin de partida requiere todos los SeÃ±ores derrotados.
- **Ventana de reacciÃ³n D371**: HORDE_ATTACK ahora pausa para permitir pericias reactivas (ValÃ¨rys, Lisavette). `buildReactionWindow` crea elecciones `REACTION_WINDOW` para hÃ©roes no activos con pericias reactivas. Los jugadores pueden `USE_ABILITY` o `PASS` via `RESOLVE_CHOICE`.
- **Lisavette D370**: la implementaciÃ³n ahora verifica carta "Escudo" (warrior.shield) en mano, la juega (mueve a WEAR_PILE), transfiere 1 Escudo al hÃ©roe objetivo y roba hasta 2 Monedas. El jugador selecciona hÃ©roe y enemigo objetivos (SELECT_HERO + SELECT_ENEMY), pero el Escudo transferido previene 1 daÃ±o del total del Ataque de la Horda (no especÃ­ficamente del enemigo seleccionado); hacer la prevenciÃ³n enemigo-especÃ­fica requerirÃ­a refactorizar el sistema de daÃ±o de la Horda.
- **swapStartingCards (solitario)**: cableado al comando `SWAP_STARTING_CARDS`
- **CatÃ¡logo Huestes F2**: hay 8 Huestes con F2 en `horde.json` (coincide con el PDF). La spec del solitario dice "quedan 22" pero 27-8=19; es una inconsistencia de la spec, no del catÃ¡logo
- **Empates con elecciÃ³n del jugador**: `HERO_WITH_FEWEST_WOUNDS` y `ENEMY_WITH_MAX_FORTITUDE` en empate prefieren al jugador activo o primer enemigo. La spec dice "tu eliges" pero requiere UI/pendingChoice
- **Daga Ã‰lfica (RECOVER_THIS_CARD)**: interceptaciÃ³n en `resolver.ts` evita el `CARD_MOVED` a `WEAR_PILE` cuando la carta tiene `RECOVER_THIS_CARD`; `applyEvent` busca en `wearPile` y `hand`
- **Pericias de SeÃ±ores de la Guerra**: Gurdrug (pÃ©rdida de carta al daÃ±arlo), Shriekknifer (recuperar carta con ataque impreso 1), Roghkiller (+1 fortaleza a orcos) implementadas como hooks en `resolver.ts` y `engine.ts`
- **CatÃ¡logos de habilidades COMPLETOS**: explorer (7 Ãºnicas/15 copias), mage (9 Ãºnicas/15 copias), rogue (9 Ãºnicas/15 copias), warrior (8 Ãºnicas/15 copias). Todos coinciden con el PDF original
- **Escenarios con effects vacÃ­os**: 7 escenarios ahora tienen `CUSTOM_SCENARIO` con handler referenciando `scenarios/index.ts`. Los handlers reales (`applyScenarioEffects`, `onTurnStart`, `executeTurnStartEffect`) se invocan en `setup.ts` y `engine.ts`
- **executeTurnStartEffect**: cableado al comando `ACCEPT_TURN_START_EFFECT`. `onTurnStart` genera `pendingChoice` CONFIRM tras `TURN_STARTED`
- **Puerto de Eque**: `executeTurnStartEffect` ahora aplica `MODIFIER_ADDED` (+1 daÃ±o) a cada enemigo del campo
- **Ruinas de Brunmar**: `applyScenarioEffects` aplica -1 a enemigos actuales; `processBattlefieldReplenishment` aplica -1 a enemigos revelados mientras el escenario estÃ© activo
- **HÃ©roes como 8 discretos (no 4 con 2 caras)**: el catÃ¡logo modela 8 hÃ©roes separados en lugar de 4 cartas con cara frontal/trasera. El schema tiene `heroFace: 'FEMALE' | 'MALE'` pero `setup.ts` usa `heroId` directamente. La asignaciÃ³n de clases estÃ¡ marcada `[REVISAR]` en la spec. Faltan hÃ©roes de Mago y PÃ­caro en el catÃ¡logo actual.
- **Constructor mazo multiclase (FIX)**: el paso 3 (completar hasta 15) ahora usa un tracker `usedCopies` por `definitionId` para respetar el lÃ­mite de copias de cada carta, evitando duplicar copias mÃ¡s allÃ¡ de lo que define el catÃ¡logo.
- **Re-revelado de escenarios tras SeÃ±or (FIX B1)**: `processBattlefieldReplenishment` y `processScenarioTransition` ahora verifican `!state.warlordRevealed` antes de revelar un nuevo escenario cuando el campo queda vacÃ­o. Antes podÃ­a revelar un escenario nuevo tras aparecer el SeÃ±or, violando la spec Â§3.4.
- **Lisavette prevenciÃ³n enemigo-especÃ­fica (FIX B2)**: ahora emite `ENEMY_DAMAGE_DISABLED` para el enemigo seleccionado en vez de `SHIELD_TRANSFERRED` genÃ©rico. El enemigo seleccionado no causa daÃ±o en el Ataque de la Horda (usando el mecanismo `damageDisabled` existente).
- **ValÃ¨rys Anti-Magia con interceptor (FIX B3)**: al redirigir daÃ±o a ValÃ¨rys, el motor recalcula el daÃ±o de la Horda usando las capacidades del interceptor (no del objetivo original), para que Anti-Magia se aplique correctamente segÃºn quiÃ©n recibe el daÃ±o.
- **Feldon como interceptor (FIX B10)**: si Feldon intercepta el daÃ±o de la Horda (vÃ­a ValÃ¨rys), su reducciÃ³n de mitad de cartas se aplica correctamente.
- **classToCaps MAGE sin EXPERTISE (FIX B4)**: spec Â§7.1 confirma Mago=Magia (sin Pericia). Corregido `classToCaps` en `setup.ts`.
- **buildReactionWindow filtra Lisavette sin escudo (FIX B5)**: la ventana de reacciÃ³n solo se ofrece a Lisavette si tiene `warrior.shield` en mano.
- **Aranel/Neddia/Idril no consumen uso en vacÃ­o (FIX B6)**: si el mazo de Habilidad (Aranel), mazo de Mercado (Neddia) o mazo de Horda (Idril) estÃ¡n vacÃ­os, la pericia no consume el uso.
- **Filtrado multiclase mercado con penaltyCapabilities (FIX B7)**: el filtrado del mercado en multiclase ahora considera `penaltyCapabilities`, permitiendo ver cartas que se pueden comprar con penalizaciÃ³n.
- **BUY_CARD defensivo (FIX B8)**: `execute` ahora rechaza la compra si `cardDef` es `undefined` (no solo `isLegal`).
- **marketDeck solitario limpio (FIX B9)**: en modo solitario, `marketDeck` se vacÃ­a tras seleccionar las 5 cartas iniciales (spec Â§4.1: no se reponen).

## AuditorÃ­a de malas prÃ¡cticas (segunda ronda)
- **playerId en RESOLVE_CHOICE/CHOOSE_LEADER_CARDS (D401)**: `getPlayerIdFromCommand` derivaba todos los comandos de `activePlayerId`, imposibilitando resolver `REACTION_WINDOW` de jugadores no activos (ValÃ¨rys/Lisavette) y pujas de lÃ­der. Ahora deriva el playerId de la `pendingChoice` correspondiente.
- **MutaciÃ³n en resolveCard (D402)**: `DRAW_AND_ADD_ATTACK` (Todo o Nada) mutaba `playerState.abilityDeck` in-place, corrompiendo el estado base sobre el que se aplican eventos â€” la carta robada desaparecÃ­a de todas las zonas. Corregido a actualizaciÃ³n inmutable.
- **Portal de Ulthar (D398)**: `CARD_MOVED` a `HORDE_DECK` era un no-op (la Hueste no volvÃ­a al mazo) y el trofeo se destruÃ­a sin reaparecer (`ENEMY_REVEALED` no-op + bÃºsqueda en `hordeDeck` vacÃ­a). Ahora usa `ENEMY_RETURNED_TO_HORDE` y recupera el `definitionId` del `eventLog` (ENEMY_DEFEATED) para crear el `EnemyState`.
- **Doble puja de lÃ­der (D403)**: `setupGame` creaba pendingChoices Y aplicaba la heurÃ­stica â†’ `CHOOSE_LEADER_CARDS` movÃ­a cartas dos veces. Eliminadas las pendingChoices huÃ©rfanas; la heurÃ­stica es la Ãºnica vÃ­a.
- **REACTION_WINDOW obsoletas (D404)**: elecciones no resueltas bloqueaban la regeneraciÃ³n de la ventana en turnos siguientes. Se limpian al salir de `HORDE_ATTACK`.
- **`interceptedBy` residual (D403)**: si el daÃ±o quedaba en 0, el flag persistÃ­a y redirigÃ­a el siguiente ataque. Se limpia cuando `effectiveDamage === 0`.
- **`requiredWarlordKills` hardcodeado (D405)**: multiclase 2-3 jugadores solo tiene 1 SeÃ±or pero exigÃ­a 2 â†’ partida imposible. Ahora se deriva de los SeÃ±ores reales en juego.
- **`processHordeAttackTriggers` devolvÃ­a state original (D402)**: descartaba `currentState` acumulado de los triggers de Trampa.
- **`setupSoloMode` divergente (D408)**: duplicaba setupGame sin resets, sin `applyScenarioEffects`, ignorando `copies` y sin eventos. Ahora delega en `setupGame` tras validar.
- **`MODIFY_FORTITUDE` con `ALL_ENEMIES` ignoraba `filter`** (Roghkiller): ahora respeta `isOrc`/`isWarlord`.
- **Guards en applyEvent**: `ENEMY_DEFEATED` con `defeatingPlayerId` invÃ¡lido ya no crashea; `COINS_STOLEN` clampea a las monedas disponibles; `MODIFIER_ADDED` a 'market' sin `amount` ya no aplica -1 arbitrario.
- **isLegal PLAY_CARD**: valida que `targetEnemyId` exista en el campo (evita quemar carta sin efecto).
- **Backend**: `asgi.py` montaba solo HTTP â€” los WebSocket nunca llegaban a `GameConsumer`. Ahora `ProtocolTypeRouter` + `AllowedHostsOriginValidator` + `AuthMiddlewareStack`. `httpx.Client` sÃ­ncrono en consumer async â†’ envuelto en `database_sync_to_async`. `playerId` validado contra la sesiÃ³n antes de ejecutar comandos. Transacciones atÃ³micas en create/join_room. ValidaciÃ³n de entrada (mode, maxPlayers, JSON body). No se exponen internals en errores.
- **engine-runner**: try/catch en handlers (un config malformado podÃ­a tumbar el proceso), `express.json({limit: '100kb'})`, lÃ­mite de 1000 salas, endpoint DELETE /rooms/:roomId, validaciÃ³n de `cid`/`command`.
- **UI gameStore**: `buyCard`/`useHeroAbility` ignoraban `result.accepted` (mensaje falso). `sendOnlineCommand` no verificaba `readyState`. `JSON.parse` sin try/catch en onmessage. `loadGame` restauraba el snapshot inicial en vez de replayar comandos. `saveGame` reportaba Ã©xito aunque localStorage fallara. `initialCommands` nunca se rellenaba. `'RESTORE'` vs `'RESTORATION'` inconsistente. `setMessage` no declarado en la interfaz.

## Regla de auditorÃ­a continua
**Obligatorio**: Cada vez que se encuentre una discrepancia entre el cÃ³digo y la `ESPECIFICACION_MAESTRA.md`, al terminar la correcciÃ³n se deben realizar **5 tandas adicionales** de comprobaciÃ³n leyendo secciones distintas del documento maestro y verificando que el cÃ³digo concuerda. El objetivo es asegurar convergencia completa con la especificaciÃ³n.
