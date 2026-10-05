# Política de seguridad

## Alcance

Este repositorio contiene la digitalización del juego de mesa *No Time for
Heroes*: motor de reglas (`packages/engine`), app Expo (`apps/mobile`),
backend Django (`apps/backend`) y runner de partidas (`apps/engine-runner`).

Las vulnerabilidades en cualquiera de estos componentes — especialmente las
que afecten a autenticación, autorización, privacidad de la información de
partida (manos, mazos, recompensas ocultas) o integridad del motor — deben
comunicarse de forma privada.

## Cómo reportar una vulnerabilidad

**No abras una incidencia pública** para vulnerabilidades de seguridad.

- Abre un *security advisory* privado en GitHub:
  `Security → Report a vulnerability` en el repositorio.
- O contacta con los mantenedores por el canal privado del proyecto.

Incluye: descripción, impacto esperado, pasos de reproducción y, si lo tienes,
una propuesta de mitigación.

## Compromiso de respuesta

- Acuse de recibo: 72 h.
- Evaluación de severidad y plan: 7 días.
- Corrección priorizada según severidad; críticas con hotfix.

## Qué ya está cubierto (resumen)

Consulta `AGENTS.md` (D431–D443) para el detalle técnico. En síntesis:

- Autenticación por tokens de jugador + tickets WS efímeros de un solo uso
  (los tokens nunca viajan en URLs de WebSocket).
- Autorización verificada en servidor: el `playerId` de los comandos se deriva
  de la conexión autenticada, no del payload del cliente.
- Proyección de estado por jugador: manos, orden de mazos, recompensas no
  reveladas y elecciones secretas nunca salen al espectador ni a otros
  jugadores.
- Idempotencia por `cid` persistente (backend + runner) ante reintentos.
- Rate limiting por IP/scope (REST) y por conexión (chat WS), límites de
  tamaño de frame, de sala, de espectadores y de mensajes.
- `SECRET_KEY`, `REDIS_URL` y `ENGINE_RUNNER_TOKEN` fail-closed en producción.
- Salas con ciclo de vida: reap de WAITING vacías, PLAYING inactivas (via
  `mark_finished` para conservar replay/estadísticas) y FINISHED antiguas.

## Secretos

Nunca commits de claves, tokens ni `.env` reales. Usa `.env.example` como
referencia y el escáner de secretos de CI (gitleaks) como red.
