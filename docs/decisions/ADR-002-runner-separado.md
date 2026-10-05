# ADR-002: Runner Node separado del backend Django

**Estado**: aceptada

## Contexto

El motor es TypeScript; el backend (auth, salas, persistencia) es Django.
Ejecutar TS dentro de Django o reimplementar el motor en Python duplicaría
o rompería el determinismo.

## Decisión

`apps/engine-runner` es un servicio Node independiente que aloja una
instancia del motor por sala. El backend lo invoca por HTTP con un secreto
compartido (`X-Engine-Token`) y nunca ejecuta reglas del juego él mismo.

## Alternativas

- Backend en Node: descartado (Django aporta auth/admin/migraciones maduros).
- Motor portado a Python: doble implementación = doble fuente de verdad.

## Consecuencias

- Contrato HTTP estricto (`/create`, `/command`, `/state`, `/full-state`,
  `/restore`, `/health`) que debe mantenerse en ambos lados.
- El runner puede escalar independientemente del backend.
- Fallos de red → idempotencia por `cid` + `stale_revision` + retry único.
- Deploy del runner empaquetado en Docker (`apps/engine-runner/Dockerfile`,
  contexto raíz por los paquetes workspace).
