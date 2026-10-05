# Documentación — NT4H Digital

Índice de la documentación técnica del proyecto. Cada documento indica
su propósito; los ADR están ordenados cronológicamente en
[`decisions/`](decisions/).

## Fundamentos

- [ARCHITECTURE.md](ARCHITECTURE.md) — arquitectura del sistema (motor
  event-sourced, backend Django, runner separado, UI).
- [DATA_MODEL.md](DATA_MODEL.md) — modelo de datos y persistencia.
- [GLOSARIO.md](GLOSARIO.md) — glosario unificado de términos del dominio.
- [api/api.md](api/api.md) — contrato de la API (endpoints, eventos WS).

## Interfaz de usuario

- [ESPECIFICACION_UI.md](ESPECIFICACION_UI.md) — especificación de la UI.
- [TRAZABILIDAD_UI.md](TRAZABILIDAD_UI.md) — trazabilidad
  requisito → componente → test.
- Capturas en [assets/screenshots/](assets/screenshots/), enlazadas
  desde el [README principal](../README.md).

## Calidad y pruebas

- [REQUIREMENTS.md](REQUIREMENTS.md) — requisitos funcionales y no
  funcionales.
- [GOVERNANCE.md](GOVERNANCE.md) — roles y proceso de decisión.
- [QUALITY.md](QUALITY.md) — atributos de calidad y presupuestos.
- [ESTRATEGIA_PRUEBAS.md](ESTRATEGIA_PRUEBAS.md) — estrategia maestra
  de pruebas.
- [ANALISIS_BRECHA_PRUEBAS.md](ANALISIS_BRECHA_PRUEBAS.md) — análisis de
  brecha entre la estrategia y la cobertura real.
- [TECH_DEBT.md](TECH_DEBT.md) — registro de deuda técnica.
- [DEPRECATION.md](DEPRECATION.md) — política de deprecación.
- [MATURITY.md](MATURITY.md) — autoevaluación de madurez por dimensión.
- [DEPENDENCIES.md](DEPENDENCIES.md) — inventario y política de dependencias.

## Seguridad y privacidad

- [THREAT_MODEL.md](THREAT_MODEL.md) — modelo de amenazas (STRIDE).
- [PRIVACY.md](PRIVACY.md) — inventario de datos personales.

## Auditorías

- [AUDITORIA_OFICIAL.md](AUDITORIA_OFICIAL.md) — auditoría oficial del
  catálogo de cartas.
- [audits/](audits/) — informes de auditorías de código por fecha.

## Operaciones

- [OPERATIONS.md](OPERATIONS.md) — índice operativo.
- [operations/deployment.md](operations/deployment.md) — despliegue y
  operación.
- [operations/incidents.md](operations/incidents.md) — respuesta a
  incidentes.
- [operations/slo.md](operations/slo.md) — objetivos operativos
  (SLI/SLO).
- [operations/production-readiness.md](operations/production-readiness.md) —
  revisión de preparación para producción.

## Decisiones

- [decisions/](decisions/) — ADR-001 a ADR-004 (ver
  [índice](decisions/README.md)).

## Propuestas

- [LOGROS_Y_ESTADISTICAS.md](LOGROS_Y_ESTADISTICAS.md) — investigación y
  propuesta del sistema de logros y estadísticas.
