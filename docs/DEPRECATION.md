# Política de deprecación — NT4H2

El sistema tiene contratos multi-componente (REST backend, WS, API del
motor, proyección, snapshot). Retirar algo sin proceso rompe clientes
desplegados o saves/replays existentes — el save de una partida en
IndexedDB puede tener meses.

## Reglas

1. **Los contratos públicos** (`/api/*`, mensajes WS, tipos de comando,
   eventos del eventLog, formato de save) **no se retiran** sin periodo
   de coexistencia. El endpoint `?playerId&token` de WS se retiró solo
   porque era un riesgo de seguridad y los clientes eran internos.
2. **Marcado**: lo deprecado se anota `deprecated` + versión en que se
   retira en el código y en `docs/api/api.md`.
3. **Periodo mínimo**: una release menor completa de aviso (el changelog
   dice "deprecated, se retira en vX.Y+1").
4. **Eventos del motor**: los tipos de evento publicados NUNCA se
   eliminan — el fold de replays antiguos depende de su reducer
   existiendo. Un evento obsoleto deja de emitirse pero su reducer
   permanece.
5. **Saves locales**: el esquema de save tolera campos ausentes
   (forward-compat); un campo nuevo no puede hacer ilegible un save viejo.

## Proceso

1. Marcar + documentar la versión de retirada.
2. Avisar en CHANGELOG (sección "Deprecated").
3. A la retirada: buscar consumidores reales (`rg` + la trazabilidad de
   UI); el workflow release exige la suite verde — un contrato roto
   debería romper un test.
4. Mover la entrada al changelog de la versión que retira.
