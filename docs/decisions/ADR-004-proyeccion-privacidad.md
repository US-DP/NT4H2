# ADR-004: Proyección por jugador como frontera de privacidad

**Estado**: aceptada

## Contexto

En un juego de información oculta, el estado completo (manos, orden de
mazos, recompensas no reveladas, elecciones secretas, RNG) no puede salir
a clientes que no deben verlo — ni por endpoints ni por broadcasts.

## Decisión

El runner solo sirve `projectForPlayer(state, viewerId)`:
manos y `pendingChoices` propias, `newOrder` de barajados eliminado,
recompensas de enemigos `null` hasta su derrota, eventos privados filtrados
o con ids redactados (`hidden`). El broadcast de resultados no incluye
`events` en crudo. `/full-state` existe pero requiere `X-Engine-Token` —
uso interno (snapshots), nunca servido a clientes.

## Alternativas

- Cifrado por jugador: complejidad de claves sin beneficio si el servidor
  ya es autoritativo.
- Confiar en el cliente para ocultar: cualquier espectador leería todo.

## Consecuencias

- La proyección es el único punto donde auditar fugas — cualquier campo
  nuevo de `GameState` debe revisarse ahí.
- El eventLog proyectado se sanitiza por tipo (`PRIVATE_EVENT_TYPES`) y
  por payload (`sanitizeEventForViewer`).
- El replay del lado cliente usa datos públicos; el completo requiere
  snapshot autorizado.
