# ADR-003: Tickets efímeros para WebSocket en vez de tokens en la URL

**Estado**: aceptada

## Contexto

Autenticar el WebSocket con `?token=<playerToken>` deja el token largo en
logs de proxies, historiales y capturas — un secreto de larga duración
expuesto por transporte.

## Decisión

El cliente pide `POST /api/rooms/<id>/ws-ticket/` con `{playerId,
playerToken}` por REST (header Authorization) y recibe un ticket de un solo
uso (~60 s, vinculado a sala+jugador). El WS conecta con `?ticket=` y el
`playerId` se deriva de la conexión autenticada — nunca del payload.

## Alternativas

- Subprotocolo/header en el handshake WS: no soportado de forma uniforme
  por clientes web/Expo.
- Sesión por cookie: el producto usa JWT por header, no cookies.

## Consecuencias

- Los tokens de jugador no aparecen en logs de conexión.
- Kick de jugador revoca tickets pendientes (`_revoke_ws_tickets`).
- El almacén de tickets es en memoria por proceso — migrar a Redis antes
  de multi-worker (limitación documentada).
