# Glosario unificado — NT4H Digital

Este documento fija la terminología canónica del proyecto. Toda la UI,
documentación y código orientado al usuario deben usar estos términos.
Cuando aparezca un sinónimo histórico, preferir el término canónico.

## Entidades del juego

| Término canónico | Evitar | Notas |
|---|---|---|
| **Hueste** | Horda, enemigo genérico | Enemigo individual que sale a la mesa. La **Horda** es el mazo del que salen las Huestes y el ataque colectivo que ejecutan. "Horda" nunca designa a una carta individual. |
| **Señor de la Guerra** | Jefe, boss, warlord suelto | Enemigo final del escenario. En código puede aparecer `warlord`/`warlordsDefeatedCount` como identificador técnico. |
| **Héroe** | Personaje, avatar | El personaje del jugador. Cada héroe tiene cara FEMALE/MALE y mazo asociado. |
| **Escenario** | Aventura, misión | Carta de escenario activa que modifica la partida. |
| **Mercado** | Tienda, shop | Zona de compra durante la fase de Mercado. |
| **Apoyo** | Soporte | Mazo de apoyo en modo solitario (`SUPPORT`). |

## Conceptos de partida

| Término canónico | Evitar | Notas |
|---|---|---|
| **Partida** | Sesión (en UI) | `GameSession` es el nombre técnico del modelo online; en pantalla siempre "partida". Una **sala** es el lobby que precede a la partida online. |
| **Mazo** | Deck (en UI) | `deck` es aceptable como identificador técnico (`deckId`, `playerDeck`), pero en pantalla siempre "mazo". |
| **Desgaste** | Pila de descarte, discard | Zona `WEAR_PILE`: cartas jugadas/compradas que representan el desgaste del héroe. No usar "descartes" — descartar es la acción de enviar cartas al desgaste. |
| **Pericia** | Habilidad, poder, skill | Capacidad especial del héroe (`USE_HERO_ABILITY` en el motor). Reservar "capacidad" para las capabilities de clase (`capabilities`). |
| **Turno** | Ronda | Una ronda está formada por los turnos de todos los jugadores. `turnNumber` cuenta turnos. |
| **Gloria** | Puntos de victoria | Recurso de victoria. |
| **Monedas** | Oro, dinero | Recurso de compra en el Mercado. |

## Conceptos de la app

| Término canónico | Evitar | Notas |
|---|---|---|
| **Jugar** | Nueva partida (como sección) | Sección `/(play)`: punto de entrada para crear, continuar, importar y gestionar partidas. |
| **Inicio** | Home, principal | Pantalla de orientación `app/index.tsx`. |
| **Salas** | Lobby, online | Listado/creación de salas online. La sala individual es "sala". |
| **Taller** | Estudio, editor | `/(study)`: herramientas de autoría de contenido (cartas, mazos, escenarios). La ruta interna se mantiene como `study` (identificador técnico), pero en pantalla siempre "Taller". |
| **Colección** | Biblioteca, catálogo (en UI) | `/(library)`: explorador de cartas. "Catálogo" designa el paquete `@nt4h/catalog` y sus versiones, no la pantalla. |
| **Reglamento** | Reglas, rulebook (en UI) | `/(rulebook)`. |
| **Papelera** | Eliminados, archivados | Partidas borradas recuperables durante `TRASH_RETENTION_DAYS` (30 días). El borrado definitivo se llama "Eliminar definitivamente". |
| **Preparado** | Listo (en sala), ready (en UI) | Estado del invitado en sala online antes de iniciar. El anfitrión lo tiene implícito. |
| **Guardada** | Salvada | Partida persistida en `nt4h-saved-games`. |

## Estados y compatibilidad

| Término canónico | Significado |
|---|---|
| **Compatible** | La partida guardada coincide con la versión del motor y del snapshot actual. |
| **Versión antigua** (`version-mismatch`) | El snapshot es válido pero el motor difiere: se puede cargar con aviso. |
| **Incompatible** | Snapshot de versión no soportada: no se puede cargar. |

## Reglas de uso

1. **Una pantalla, un término**: si una entidad tiene nombre canónico, no
   alternar con sinónimos en la misma pantalla.
2. **Código vs. UI**: los identificadores técnicos (`warlord`, `wearPile`,
   `deckId`, `roomId`, `session`) permanecen en inglés/snake_case; su
   traducción visible sigue este glosario.
3. **Texto nuevo**: cualquier cadena nueva en `lib/i18n.ts` debe usar los
   términos canónicos tanto en `es` como en `en`.
4. **Ambigüedad**: si surge un término no cubierto, añadirlo aquí antes de
   introducirlo en la UI.
