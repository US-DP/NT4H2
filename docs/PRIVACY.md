# Privacidad — inventario de datos personales

## Qué se almacena

| Dato | Dónde | Retención | Acceso |
|---|---|---|---|
| Email + hash de contraseña | `accounts.User` | vida de la cuenta | propio usuario |
| display_name, avatar, locale | `accounts.User`/`PlayerProfile` | vida de la cuenta | `display_name` es público en salas/leaderboard; el email nunca se expone |
| `Player.auth_token` | backend | vida de la sala | solo el jugador (header `X-Player-Token`) |
| Chat de sala | `GameEvent` type=CHAT | últimos 200 mensajes por sala | miembros de la sala; espectadores no reciben chat ni lo emiten |
| Estadísticas de partida | `PlayerStatistics` | vida de la cuenta | propio usuario + endpoint público por UUID |
| Estadísticas de comunidad | `CommunityStat` | indefinida | **opt-in**, agregadas y anónimas (sin usuario/IP/sala) |
| Leaderboard | `LeaderboardEntry` | mientras opt-in | **opt-in**: solo el `displayName` elegido |
| Sesión online (playerToken) | SecureStore del dispositivo | TTL 24 h | solo el dispositivo |
| Snapshots `GameSnapshot` | backend | ≤10 por sala, FIFO | interno — manos completas, nunca servido a clientes |
| IP | logs/rate-limit (memoria) | ventana del bucket | no se persiste como dato de usuario |

## Lo que NO se almacena

- Ubicación, contactos, identificadores de dispositivo.
- Historial de navegación ni analítica de terceros.
- Los events del motor crudos no llegan al cliente (proyección siempre).

## Borrado

- La sala se borra completa (jugadores, eventos, snapshots) por el reaper
  o al cerrarla el host.
- Estadísticas de cuenta: opt-out limpia por configuración de perfil.
