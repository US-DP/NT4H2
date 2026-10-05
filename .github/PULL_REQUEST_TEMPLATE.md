## Qué cambia y por qué

<!-- Describe la intención, no la mecánica línea a línea. -->

## Incidencia / decisión vinculada

<!-- Closes #NNN · decisión D### si aplica -->

## Checklist

- [ ] `pnpm typecheck` / `pnpm lint` limpios en los paquetes tocados
- [ ] Tests nuevos/actualizados cubren el cambio (`pnpm test`)
- [ ] Si toca el motor: fold(eventLog) ≡ estado vivo verificado
- [ ] Si toca privacidad: la proyección no filtra info oculta al viewer
- [ ] Cadenas visibles por i18n (es + en)
- [ ] Sin secretos ni `.env` reales
- [ ] `AGENTS.md` actualizado si cambia una decisión documentada
- [ ] `CHANGELOG.md` actualizado si el cambio es visible al usuario

## Cómo verificarlo

<!-- Pasos concretos para probar la PR. -->

## Riesgos / rollback

<!-- Qué puede romper y cómo se revierte. -->
