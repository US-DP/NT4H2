# Respuesta a incidentes — NT4H2

## Severidades

| Sev | Definición | Ejemplos | Respuesta |
|---|---|---|---|
| S1 | Servicio caído o partidas corruptas en masa | runner inalcanzable, fold divergente persistido | mitigar YA, postmortem obligatorio |
| S2 | Degradación parcial o bypass de reglas | `isLegal` con agujero, privacidad de manos rota | fix urgente, nota en CHANGELOG |
| S3 | Fallo con workaround | espectadores sin cap parcial, métricas a medias | siguiente release |
| S4 | Bug cosmético sin impacto | traducción rota, badge descuadrado | backlog |

## Contención inmediata

- Runner comprometido/inestable → reiniciar el proceso; las salas se
  restauran desde `ENGINE_RUNNER_STATE_DIR` o desde `GameSnapshot` vía
  backend.
- Backend corrupto → `python manage.py reap_rooms` limpia salas
  zombi; las FINISHED son inmutables.
- Fuga de token de jugador → kick del playerId (revoca tickets) +
  `leave`+rejoin emite `auth_token` nuevo.
- Secreto comprometido (`ENGINE_RUNNER_TOKEN`, `SECRET_KEY`, JWT) →
  rotar y redeployar; los tokens de jugador son independientes.
- Flood en producción → `ROOM_RATE_LIMIT_MAX` baja el umbral en caliente
  sin redeploy.

## Postmortem (plantilla)

1. Qué pasó / cómo se detectó (métrica, usuario, test).
2. Línea temporal (detección → mitigación → fix).
3. Causa raíz (commit/cambio que la introdujo).
4. Qué test/gate la habría pillado antes — añadirlo.
5. Acciones: fix, doc, monitorización.
