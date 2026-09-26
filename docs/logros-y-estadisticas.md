# Sistema de logros y estadísticas — investigación y propuesta

> Investigación para NT4H Digital. Conclusiones de documentación oficial de
> plataformas, artículos de diseño publicados y ejemplos de juegos, con una
> propuesta concreta aplicable al proyecto (estado actual: 12 logros locales
> evaluados sobre `nt4h-game-history` en `lib/achievements.ts`).

## 1. Fuentes consultadas

| Fuente | Tipo | Enlace |
|---|---|---|
| Steamworks — Stats & Achievements | Doc oficial | `partner.steamgames.com/doc/features/achievements` |
| Steamworks — ISteamUserStats / GlobalAchievementPercentages | Doc oficial | `partner.steamgames.com/doc/api/isteamuserstats` |
| Xbox XR-055 / XR-057 (Achievements & Gamerscore / Unlocking) | Política oficial | `learn.microsoft.com/gaming/gdk/docs/store/policies` |
| Google Play — Achievements, Quality checklist, Level Up | Doc oficial | `developer.android.com/games/pgs/achievements` |
| Google Play — Game Stats API | Doc oficial | `developer.android.com/games/pgs/gamestats` |
| Blair, L. — "The Cake Is Not a Lie" I–III (GameDeveloper) | Estudio + taxonomía | `gamedeveloper.com/design/the-cake-is-not-a-lie-*` |
| "Achievement Design 101" (Kongregate) | Guía especializada | `gamedeveloper.com/design/achievement-design-101` |
| "More Best Practices for Achievement Design" (Blair) | Guía especializada | `gamedeveloper.com/design/feature-more-best-practices-for-achievement-design` |
| Extra Credits — "Achievements" | Análisis de diseño | episodio S2011E07 |
| Slay the Spire — lista de logros | Ejemplo (roguelike de cartas) | `slaythespire.wiki.gg/wiki/Achievements` |
| Board Game Arena — stats.inc.php | Ejemplo (adaptación de juegos de mesa) | `github.com/micahstairs/bga-innovation` |
| Asmodee Digital — API de integración | Ejemplo (juegos de mesa online) | `doc.asmodee.net/integration` |
| Google Play — privacidad del perfil de juego | Doc oficial | `support.google.com/googleplay/answer/3129346` |

## 2. Lo que dicen las plataformas (requisitos y buenas prácticas)

**Steam** separa *stats* (INT / FLOAT / AVGRATE — media móvil) de *achievements*.
Un logro puede declarar una `Progress Stat`: el porcentaje de progreso lo calcula
la plataforma, no el juego. Steam expone los porcentajes globales de desbloqueo,
que los jugadores usan como indicador de rareza — los logros con <5% de
desbloqueo son los que "presumen".

**Xbox (XR-055/057)**: ≥10 logros y 1000 Gamerscore en lanzamiento; cada logro
debe ser *alcanzable por cualquier jugador* y "representar una exploración
exhaustiva o un compromiso real con el contenido del juego". Prohibido:
logros que exijan compras, desbloqueos por menús/trucos o por actividad fuera
del juego. Lección clave: **un logro debe ser evidencia de que jugaste, no de
que existe la mecánica**.

**Google Play**: ≥10 logros (recomendados ≥40), incremental achievements con
barra de progreso, logros ocultos solo para evitar spoilers ("minimize the use
of hidden achievements"), nombres/descripciones/iconos únicos, y **agrupar
`increment()`** para no quemar cuota de API. Game Stats publica estadísticas
del jugador en su perfil (eventos repetitivos + una estadística de progresión).

**BGA (Board Game Arena)**: en adaptaciones de juegos de mesa las estadísticas
se dividen en *table stats* (de la partida: turnos, duración) y *player stats*
(por jugador: puntos, recursos). Los IDs son estables: "si cambias el ID,
pierdes el histórico" — lección directa de versionado.

**Asmodee Digital** (adaptaciones de juegos de mesa: Splendor, Ticket to Ride):
logros sincronizados entre plataformas + ELO + historial de partidas en la
nube — el patrón si algún día NT4H sincroniza entre dispositivos.

## 3. Taxonomía de diseño (síntesis de Blair + Kongregate + Extra Credits)

Blair construye la taxonomía en dos ejes independientes:

- **Measurement** (cumplir una tarea a cierto nivel: "15+ gloria") vs
  **Completion** (terminar algo: "completa una partida").
- **Orientation**: meta hacia un resultado vs rendimiento medido.

Tipos por objetivo (la revisión del usuario, mapeada):

| Categoría | Definición | En NT4H |
|---|---|---|
| Progresión | marcos temporales del juego | primeras N partidas, subir en solitario |
| Habilidad | actos difíciles, no garantizados | ganar sin heridas, gloria ≥25 |
| Exploración | recorrer contenido | jugar los 8 héroes, 3 escenarios |
| Colección | reunir cosas del juego | instalar sets, usar cartas de cada clase |
| Experimentación | combinar cosas nuevas | multiclase, contenido del Taller |
| Dominio | nivel maestro / meta | todas las demás + N partidas |

Categorías de presentación: visibles (la norma — Google recomienda minimizar
los ocultos a spoilers), encadenados ("Gloria 15 → 30"), acumulativos
(incremental), y meta-logros ("el que tiene todos los demás").

**Extra Credits** propone la división más útil para detectar basura:
- *Unavoidable*: pasan siempre → inútiles como logro (regalar la primera
  partida sirve como "bienvenida", no como mérito).
- *Optional*: mini-objetivos (la mayoría buena está aquí).
- *Inspiring*: invitan a jugar de otra forma (pacifista, speedrun,
  restricciones autoimpuestas) — **los mejores logros suelen ser estos**.

Slay the Spire (roguelike de cartas, el género más cercano) ejemplifica:
cadena de dificultad *Ascend 0→10→20*, retos autoimpuestos *Who Needs
Relics?* (ganar con 1 reliquia), *Speed Climber* (ganar en <20 min), y cada
jefe por primera vez. Nada de "juega 500 partidas" ni de win-rate.

## 4. Errores frecuentes (evidenciados en las fuentes)

1. **Logros basados en el camino fácil**: si el camino más fácil es tedioso,
   el logro está roto — los jugadores elegirán fácil+tedioso sobre
   difícil+divertido (Kongregate). → Diseñar mirando "¿cómo lo haría lo
   menos divertido posible?" y especificar condiciones que lo impidan.
2. **Grind puro**: "mata 1000 enemigos" no motiva, adormece. Si hay
   acumulativos, que midan el bucle *central* con umbrales bajos y palpables
   (Google: incremental = progreso visible + tiers).
3. **Negativos**: Blair advierte de logros por perder/fallar — pueden
   sentirse como burla si son obligatorios (salvo los que celebran el
   aprendizaje tipo "primera derrota con honor", ambiguo).
4. **Achievements as currency**: usar desbloqueos como recurso del juego
   puede vaciar de motivación intrínseca (Blair pt. 3). → En NT4H los
   logros no desbloquean contenido de juego.
5. **Porcentajes injustos**: "sé el 1% global" genera frustración y
   explota los numerosos%: lo visible debería ser alcanzable; lo raro,
   oculto u opcional.
6. **Ruido estadístico**: contar todo porque se puede ("monedas totales
   recogidas desde instalación") no sirve a nadie. Una estadística solo
   vale si *cambia una decisión o una emoción* del jugador.
7. **Spoilers en descripción**: Google exige ocultar los que spoilean.

## 5. UX

- Categorías sobre una lista plana: Progresión / Héroes / Reto / Taller.
- Progreso siempre que sea acumulativo ("3/8 héroes"), con barra.
- Orden sugerido por el propio diseño de Google: desbloqueados + los que
  están a un paso ("próximos a desbloquear") primero.
- Notificación en partida: toast no modal; los desbloqueos en cadena se
  agrupan ("+2 logros").
- Privacidad: Google Play y Valorant exponen "ocultar historial/stats" —
  en NT4H todo es local por defecto; si llega sync, stats públicas
  **opt-in** (nunca por defecto) y nada de identificadores.

## 6. Diseño técnico

- **Modelo de datos**: separar *eventos* (GameHistoryEntry — lo que pasó)
  de *agregados* (contadores) y de *definiciones* (logros). Las
  definiciones en un JSON/TS declarativo → "editar requisitos sin tocar
  código" y versionable (`statsSchema: 2` en el envelope, con migración).
- **Eventos**: hoy solo registramos `partida_finalizada`. Los logros de
  dentro de la partida ("derrota al Señor X", "juega las 15 cartas")
  requieren el `GAME_HISTORY` del motor — ya existe.
- **Persistencia**: local (AsyncStorage) es suficiente mientras sea un
  juego local-first. Para online, que el desbloqueo lo otorgue el backend
  (autoritativo) — el cliente solo lo solicita.
- **Anti-cheat**: en un juego local el jugador "hace trampas contra sí
  mismo" — aceptable. En partidas online, el desbloqueo sale del estado
  del runner, no del cliente.
- **Retroactividad**: evaluar logros **derivando del historial** (como
  hacemos) hace que nuevos logros se desbloqueen solos en la primera
  evaluación post-actualización — patrón recomendado sobre "marcadores
  persistentes" que se quedan obsoletos.
- **Duplicados**: `recordFinishedGame` ya es idempotente por id; mantener.

## 7. Propuesta para NT4H

**Ya implementado**: `gameHistory.ts` (registro idempotente, schema
versionado, oficial/custom separado, eventos intra-partida), motor
`achievements.ts` + catálogo declarativo `achievements.defs.ts` (22 logros,
categorías, meta-logro), toast de desbloqueo en FINISHED, pantalla
`/(stats)` con resumen/victorias/héroes/filtros/próximos, y
**estadísticas de comunidad** (`CommunityStat` + `/api/stats/report/` +
`/api/stats/community/` en el backend, toggle `shareStats` opt-in en
Perfil, rareza global en la pantalla).

**Estado del roadmap tras la implementación**:

### Esencial (fase 1) — ✅ hecho
1. ~~Toast al desbloquear~~ → badge "Logro desbloqueado" en `FINISHED`.
2. ~~Campos enriquecidos~~ → `myHeroId`, `yourScore`, `won`,
   `warlordsDefeated`, `turnsTaken`, `online`, `marketBuys`,
   `enemiesDefeated`, `warlordsByMe` (derivados del `eventLog`).
3. ~~Logros por victoria~~ → racha 3, victoria por héroe ×8, primera
   victoria, 10 victorias.
4. ~~Progreso accionable~~ → "2/3 — falta 1".

### Recomendado (fase 2) — ✅ hecho
5. ~~Categorías + filtros~~ → chips por categoría en `/(stats)`.
6. ~~Próximos a desbloquear~~ → bloque ≥60% destacado.
7. ~~Eventos intra-partida~~ → Mercader (3 compras), Carnicero (10
   enemigos), El verdugo (Señor personal).
8. ~~Config de logros sin código~~ → `achievements.defs.ts` (datos puros).

### Opcional (fase 3) — parcial
9. ~~Sync opt-in~~ → **informe anónimo** de logros (no sync de cuenta —
   no hay cuentas; el patrón Asmodee queda documentado si llegan).
10. ~~Estadísticas globales~~ → `/api/stats/community/` agrega rareza
    por logro, mostrada en la pantalla (privacidad: solo contadores).
11. ~~Temporadas~~ → **descartado** (cooperativo de sobremesa sin ladder).

**Qué falta, priorizado**:

### Esencial (fase 1)
1. **Desbloquear notificándolo**: toast al desbloquear en la pantalla final
   ("Logro: Ni un rasguño"). Sin esto, los logros no existen de cara al
   jugador.
2. **Campos de partida enriquecidos** en GameHistoryEntry: `myHeroId`
   (qué héroe controlaste tú), `yourScore` (tu gloria, no solo la máxima),
   `won` (si tú ganaste), `turnsTaken`, `warlordDefeated`. Hoy no se puede
   distinguir "gané" de "ganó alguien" en local multijugador.
3. **Logros por victoria** (la estadística más básica que falta): racha de
   victorias, victorias por héroe, primera victoria en cada modo.
4. **Descripciones de progreso accionables**: "2/3 — juega 1 solitario
   más" en vez de "2/3".

### Recomendado (fase 2)
5. **Categorías + filtros** en la pantalla (todas/progresión/héroes/reto).
6. **Próximos a desbloquear** (progress/target ≥ 60%) destacados arriba.
7. **Eventos intra-partida**: enemigos derrotados por héroe, cartas
   jugadas, monedas del mercado → logros de habilidad reales:
   "Pelirrojo contable" (terminar con 30+ monedas), "Carnicero de Orcos"
   (derrotar un Señor de la Guerra).
8. **Tareas/configuración externa de logros** en JSON (`achievements.json`
   cargable): permite añadir logros por parche sin publicar código —
   requisito de administración.

### Opcional (fase 3, si hay online real)
9. **Sincronización opt-in** a la cuenta + leaderboard de la sala
   (no global por defecto — el juego es cooperativo de sobremesa).
10. **Estadísticas globales de la comunidad** solo si el backend las
    agrega anónimamente (% de desbloqueo = "rareza", como Steam).
11. **Temporadas**: innecesarias en un juego cooperativo sin ladder —
    descartable a menos que se quiera un "reto mensual".

### Descartado explícitamente
- XP/nivel de jugador por volumen (grind vacío — Blair).
- Logros por perder o por derrotar perdiendo (negativos).
- Comparativas públicas obligatorias (el juego es cooperativo/local).

### Catálogo propuesto (ampliación sobre los 12 actuales)

| Logro | Tipo | Condición | Progreso |
|---|---|---|---|
| Primera sangre | progresión | derrota tu primer enemigo de élite | — |
| Héroe de casa | exploración | gana con cada uno de los 8 héroes | x/8 |
| La clase correcta | colección | juega una partida con mazos de cada clase | x/clases |
| Mano limpia | habilidad | gana sin perder cartas de mano | — |
| Mercader | economía | compra las 3 armas del mercado en una partida | — |
| Señores caídos | reto | derrota a los 3 Señores de la Guerra | x/3 |
| Sexta escena | exploración | juega partida con cada escenario | x/12 |
| Racha brillante | dominio | 3 victorias seguidas | x/3 |
| El trasfondo | experimentación | gana una multiclase con clases distintas | — |
| Cosecha/Trono/Leyenda | encadenado | gloria 15 → 30 → 45 | tiers |
| Arquitecto | meta | publica un set en el Taller y gana con él | — |
| Todos contra todos | online | gana una partida online de 3+ jugadores | — |

**Regla de corte**: antes de añadir un logro, preguntar "¿el camino más
fácil y aburrido de conseguirlo sigue siendo divertido?" — si no, redefinir
la condición hasta que lo sea (lección Kongregate).

### Estadísticas que aportan vs ruido

| Añadir | No añadir |
|---|---|
| Victorias/derrotas por héroe | total de cartas jugadas de por vida |
| Gloria media por modo (AVGRATE — suaviza outliers) | monedas totales acumuladas |
| Racha actual de victorias | nº de veces que abriste el Taller |
| Mejor resultado por escenario | tiempo total jugado (fomgeta sesiones) |
| % de partidas completadas vs abandonadas | contadores por fase del turno |

El criterio: **una estadística solo se guarda si cambia una decisión o una
emoción del jugador**. Tiempo jugado existe pero no se muestra como métrica
de éxito (evita presión de sesión larga en un juego de sobremesa).

## 8. Trabajo restante (si se retoma)

- **Backend**: si algún día hay cuentas de jugador, migrar el informe
  anónimo a sync por cuenta (patrón Asmodee: merge por achievement_id,
  último `unlockedAt` gana).
- **Retro-award**: los campos nuevos (`won`, `warlordsByMe`…) no existen
  en partidas grabadas antes de esta versión — la evaluación los cuenta
  como 0; la victoria tiene fallback via `myHeroId`/`winners`.
- **E2E**: validar el toast de desbloqueo en un flujo Playwright real.
