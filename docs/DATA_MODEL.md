# Modelo de datos — NT4H2

## Backend (Django)

| Modelo | Rol | Notas |
|---|---|---|
| `accounts.User` | Cuenta registrada | email único, display_name único (iexact), JWT SimpleJWT |
| `accounts.PlayerProfile` | Preferencias | show_online_status, stats opt-in, leaderboard opt-in |
| `accounts.PlayerStatistics` | Agregados por cuenta | played/won/lost/turns — alimentado por `mark_finished` |
| `game.GameSession` | Sala | room_id único, status WAITING/PLAYING/FINISHED, config privada + `_PUBLIC_CONFIG_KEYS`, kicked_ids, turn_player_id/turn_started_at (reloj anti-AFK) |
| `game.Player` | Presencia en sala | player_id, auth_token (secreto), is_host/is_ready/is_connected(+refcount), roster (heroId/deckId/face) |
| `game.GameEvent` | Event sourcing | (session, seq) único; `cid` único por sesión = dedup durable de comandos; CHAT con retención 200 |
| `game.GameSnapshot` | Checkpoint | estado completo del runner (state+rng+revision+cids+customSets); ≤10 por sala; **interno, nunca servido** |
| `game.CommunityStat` | Métricas anónimas | contadores por achievement_id, opt-in |
| `game.LeaderboardEntry` | Ranking público | displayName + wins/games, opt-in |

## Motor (in-memory / snapshots)

`GameState` (schema Zod): phase (15 fases), players (mano/mazo/wear/
trofeos persistentes), battlefield, market, scenarioDeck, hordeDeck,
pendingChoices, eventLog, monotonicCounter, rngState.

## Flujo

```text
Cliente → backend REST/WS → validación → runner (motor autoritativo)
        → GameEvent (veredicto) + GameSnapshot periódico
        → broadcast metadatos → clientes re-piden estado proyectado
```

El eventLog del motor es la fuente de verdad para replay; los GameEvent
de Django son el registro de comandos (auditoría + dedup), NO el fold.
