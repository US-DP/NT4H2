# Soporte

## Antes de abrir una incidencia

1. Revisa [`docs/`](docs/) — arquitectura, API y operación están
   documentados.
2. Comprueba las **limitaciones conocidas** del README y el registro
   de deuda en [`docs/TECH_DEBT.md`](docs/TECH_DEBT.md).
3. Consulta la sección **Solución de problemas** del README.

## Canales

| Necesitas | Dónde |
|---|---|
| Reportar un bug | [GitHub Issues](https://github.com/US-DP/NT4H2/issues) — plantilla *Bug report* |
| Pedir una feature | [GitHub Issues](https://github.com/US-DP/NT4H2/issues) — plantilla *Feature request* |
| Reportar una vulnerabilidad | [`SECURITY.md`](SECURITY.md) — **nunca** en un issue público |
| Duda de uso/reglas | Issue con la etiqueta `question` |

## Qué incluir en un bug report

- Versión/commit y cómo lo ejecutas (web local, sala online, Docker).
- Pasos para reproducir y resultado esperado vs obtenido.
- Para partidas: el eventLog o el save — el motor es determinista y
  permite rejugabilidad exacta.
- Logs relevantes (backend, runner o consola del navegador).

## Alcance

El soporte es best-effort: el proyecto está en desarrollo activo
pre-1.0 y lo mantiene una organización pequeña.
