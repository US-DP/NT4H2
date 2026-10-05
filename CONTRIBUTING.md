# Guía de contribución

## Antes de empezar

Lee `AGENTS.md` — es la referencia operativa del proyecto (comandos,
convenciones, decisiones D###, advertencias de seguridad). Los cambios que
alteren una decisión documentada deben actualizarla ahí.

## Flujo de trabajo

1. Crea una rama desde `main` descriptiva: `fix/…`, `feat/…`, `docs/…`.
2. Cambios acotados: una incidencia = una PR. Nada de refactors mezclados
   con features.
3. Mensajes de commit: explican la intención, no la mecánica
   (`fix: evitar que el chat bloquee comandos por el lock de sesión`).
4. Abre PR contra `main` — la CI debe estar verde. Revisión por otra
   persona en cambios que toquen motor, seguridad o persistencia.

## Gates que deben pasar antes de la PR

Todo de golpe: `tools/test_all.ps1` / `tools/test_all.sh`. Gate local
opt-in: `git config core.hooksPath .githooks` (ruff + chequeo de
secretos en lo staged). Por suite:

```bash
# Motor
cd packages/engine && pnpm typecheck && pnpm test && pnpm lint

# Frontend
cd apps/mobile && pnpm typecheck && pnpm test && pnpm lint

# Backend
cd apps/backend && ruff check . && black --check -l 120 . && python manage.py test

# Runner
cd apps/engine-runner && pnpm typecheck && pnpm test
```

## Reglas no negociables

- **Determinismo**: el motor es event-sourced — ningún cambio puede hacer que
  fold(replay) diverja del estado vivo. Si emites un evento nuevo, necesitas
  su reducer; si mutas estado fuera de eventos, el replay se rompe.
- **Privacidad**: información oculta (manos, mazos, recompensas, elecciones)
  solo sale en la vista proyectada del propio jugador. Todo broadcast va
  sanitizado (`sanitizeEventForViewer`).
- **i18n**: la UI es español-primero; toda cadena visible va por i18n, con
  clave en `es` y `en`.
- **Sin secretos**: ni tokens ni `.env` en el repo.
- **Errores honestos**: un comando rechazado no muta estado ni emite eventos;
  la UI muestra el motivo real, no mensajes genéricos engañosos.

## Definition of Ready

Antes de implementar una funcionalidad:

- [ ] Problema identificado, alcance delimitado (incluye qué NO cubre)
- [ ] Criterios de aceptación escritos y testeables
- [ ] Contratos afectados identificados: schema → engine → runner →
      backend → mobile (el repo es multi-componente; un cambio que solo
      toca una capa deja el contrato partido)
- [ ] Impacto en replay/privacidad revisado (ver reglas no negociables)
- [ ] Si añade un comando/fase: transiciones y `isLegal` considerados

## Definition of Done

- [ ] Criterios de aceptación verificados con tests (feliz + error +
      autorización en + y − cuando aplique)
- [ ] **Determinismo**: todo cambio de estado del motor viaja en un
      evento con reducer idempotente — `replayFromSnapshot` reproduce
      el estado vivo bit a bit
- [ ] **Privacidad**: ningún broadcast ni proyección filtra info oculta
      (manos, orden de mazos, recompensas, trampas, pujas)
- [ ] Errores honestos: rechazos con `reason` real; nada falla en
      silencio en una acción de usuario
- [ ] `tools/test_all.*` en verde (o justificación explícita por suite)
- [ ] `CHANGELOG.md` actualizado si es visible para el jugador
- [ ] `AGENTS.md` (D###) y docs relevantes actualizados si el cambio
      toca una decisión o contrato
- [ ] Reversible o roll-forward documentado si toca persistencia

## Checklist de revisión

El revisor comprueba, en orden:

1. ¿Resuelve el requisito declarado? ¿Contratos cruzados completos
   (schema↔engine↔runner↔backend↔mobile↔docs)?
2. **Replay**: el evento nuevo tiene reducer y el fold reproduce el
   estado vivo (test que lo verifica)
3. **Privacidad**: proyección/broadcast sanitizado — `sanitizeEvent`/
   `projectForPlayer` revisados si el evento lleva info oculta
4. ¿El diseño es el más sencillo que funciona? ¿Duplica lógica de otra
   capa (isLegal vs execute vs UI)?
5. Concurrencia: locks en backend (select_for_update), dedup por cid,
   revisiones runner
6. Errores: límites de tamaño, timeouts, razones no-genéricas
7. ¿Rollback posible? ¿Coste operativo nuevo justificado?

Clasificación de comentarios: **bloqueante** (bug/seguridad/divergencia
de replay/diseño insostenible) · **importante** · **sugerencia** ·
**pregunta** · **nit**.

## Reportar errores

Usa la plantilla de incidencia (`bug_report`). Incluye contexto, resultado
actual vs. esperado, pasos de reproducción y el `cid`/`roomId` si aplica.

## Seguridad

Vulnerabilidades: ver `SECURITY.md` — nunca en una incidencia pública.
