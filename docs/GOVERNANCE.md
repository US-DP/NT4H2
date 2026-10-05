# Gobernanza — NT4H2

## Roles

- **Mantenedor** (`@owner` en `.github/CODEOWNERS`): revisa PRs,
  decide la hoja de ruta, corta releases y firma los paquetes.
- **Contribuidor**: issues y PRs contra `main`.

## Proceso de cambios

- PR obligatorio con CI verde: `engine-ci`, `backend-ci`, `ui-ci`,
  `docs-ci` según el área tocada + `security` y `scorecard`.
- Cambios de reglas del juego: requieren actualizar
  `packages/catalog` + verificación de cartas + entrada en
  `docs/rules-traceability.json`.
- Cambios de esquema compartido (`packages/schema`): versión
  bump coordinada móvil↔backend en el mismo PR.
- Decisiones arquitectónicas: ADR en `docs/decisions/` — no se
  borran, se marcan *Superseded*.

## Calidad

- Tests por paquete obligatorios en CI; el motor mantiene cobertura
  de reglas completa (ver `ESTRATEGIA_PRUEBAS.md`).
- Auditorías de UI periódicas documentadas en `docs/audits/`.

## Seguridad

- Canal privado de `SECURITY.md` para vulnerabilidades.
- Tickets WS, secrets de CI y claves de firma gestionados por el
  mantenedor únicamente.

## Licencia

Código propietario (ver `LICENSE`) — las contribuciones requieren
acuerdo previo con el mantenedor.
