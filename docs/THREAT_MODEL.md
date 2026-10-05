# Modelo de amenazas — NT4H2

Alcance: motor de juego, runner, backend Django/Channels, app móvil/web.
Activos: partidas en curso (estado + RNG), cuentas de usuario, tokens de
jugador, integridad del eventLog y privacidad de manos/mazos.

## Confianza

- **Clientes**: NO confiables. Todo comando se valida en el runner
  (Zod + `isLegal`); el backend re-escribe el `playerId` autenticado.
- **Backend**: autoridad de sala (roster, tickets, persistencia).
- **Runner**: confiado — solo accesible por el backend (`X-Engine-Token`).
  En producción debe quedar tras la red privada/proxy, nunca público.
- **Usuarios de la sala**: mutuamente hostiles (información oculta).

## STRIDE

| Amenaza | Control |
|---|---|
| **Suplantación** | JWT para cuentas; `Player.auth_token` (128 hex) por presencia; tickets WS de un solo uso (60 s, vinculados sala+jugador, revocables en kick); `playerId` del comando deriva de la conexión, no del payload |
| **Manipulación** | El motor es autoritativo: replay/fold determinista, `canTransition` aplicada en el reducer, dedup atómica por `(session,cid)`, `clientSequence` ordena comandos del mismo jugador, `expectedRevision` rechaza escrituras sobre estado obsoleto |
| **Repudio** | `GameEvent` durable por comando con veredicto persistido; snapshots periódicos con estado completo (auditoría interna, nunca expuesta) |
| **Fuga de información** | Proyección por jugador en el runner (manos, orden de mazos, recompensas ocultas, trampas boca abajo, pujas secretas); el broadcast WS nunca lleva `events` en crudo ni estado completo; espectadores solo reciben vista pública; `seed` y pools del motor nunca salen de `to_dict` público |
| **Denegación de servicio** | Rate limits por IP (`_rate_limited` con scopes), por conexión WS y por sala+jugador en el runner; caps: tamaño de body (100 KB / 10 MB restore), mensajes WS, espectadores/sala (32), salas (1000), log de chat (200), `MAX_PHASE_ITERS`; body del runner acotado en el cliente (8 MB) |
| **Elevación de privilegio** | Host verificado por token bajo lock (TOCTOU cubierto); `skip-turn` con umbral anti-AFK; admin tras `ADMIN_URL` secreta; escrituras de contenido solo con `CONTENT_API_TOKEN`; `X-Forwarded-For` solo confiable desde `TRUSTED_PROXY_IPS` |

## Riesgos residuales aceptados

- `ENGINE_RUNNER_TOKEN` vacío en dev permite runner abierto — documentado,
  el runner exige `ENGINE_RUNNER_DEV_OPEN=1` para arrancar sin token.
- La trazabilidad UI (TRAZABILIDAD_UI.md) no es enforcement — los tests
  cubren los contratos críticos.
- Modo offline/hot-seat: el dispositivo es la frontera de confianza.

## Reporte

Ver `SECURITY.md` — canal de divulgación responsable.
