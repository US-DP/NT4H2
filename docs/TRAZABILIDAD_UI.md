# Trazabilidad UI-* — Requisitos → Componentes → Tests

Matriz de trazabilidad para los requisitos de interfaz de usuario (UI-*).
Cada requisito se mapea a componentes existentes o planificados y a pruebas.

## Leyenda de estados

| Estado | Significado |
|--------|-------------|
| OK | Implementado y verificado |
| ~ | Implementado parcialmente, pendiente de mejora |
| P | Especificado, no implementado |
| T | Test existe |
| - | Test pendiente |

## 1. Principios generales (UI-P01..UI-P07)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-P01 Claridad | Todos | ~ | - |
| UI-P02 Estado visible | PlayerPanel, Battlefield, PhaseIndicator | ~ | components.test |
| UI-P03 Acciones contextuales | ContextualActions | P | - |
| UI-P04 Prevención errores | MarketView (canAfford) | ~ | interactions.test |
| UI-P05 Explicación errores | ErrorMessage | P | - |
| UI-P06 Coherencia multiplataforma | Todos | ~ | responsive.test |
| UI-P07 Divulgación progresiva | CardView (compact), CardZoom | ~ | components.test |

## 2. Sistema visual (UI-001..UI-014)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-001 Paleta colores | CardView CLASS_COLORS | OK | components.test |
| UI-002 No solo color | CardView (iconos+texto) | ~ | components.test |
| UI-003 Estados con icono+texto | (pendiente) | P | - |
| UI-004 Tipografía decorativa títulos | (pendiente) | P | - |
| UI-005 Tipografía legible | (pendiente) | ~ | - |
| UI-006 Ampliación texto sin solapamientos | (pendiente) | P | - |
| UI-007 Tamaño mínimo 14px | (pendiente) | ~ | - |
| UI-008 Iconos coherentes | (pendiente) | P | - |
| UI-009 Iconos con etiqueta | (pendiente) | P | - |
| UI-010 Iconos con explicación | (pendiente) | P | - |
| UI-011 Cuadrícula consistente | (pendiente) | ~ | - |
| UI-012 Áreas táctiles 44x44 | (pendiente) | P | - |
| UI-013 Botones no próximos | (pendiente) | ~ | - |
| UI-014 Densidad configurable | (pendiente) | P | - |

## 3. Navegación (UI-020..UI-024)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-020 Barra lateral escritorio | AppNav | OK | - |
| UI-021 Navegación inferior móvil | AppNav | OK | - |
| UI-022 Ubicación actual | AppNav | OK | - |
| UI-023 Advertencia salir edición | (pendiente) | P | - |
| UI-024 Salir partida vs abandonar | ExitGameDialog | ~ | - |

## 4. Página de inicio (UI-030..UI-035)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-030 Priorizar Continuar | HomeScreen | OK | flow.test |
| UI-031 Continuar > Nueva | HomeScreen | OK | flow.test |
| UI-032 Info partidas pendientes | HomeScreen | OK | flow.test |
| UI-033 Distinguir tipos partidas | HomeScreen | ~ | - |
| UI-034 Indicador offline | ConnectionStatus | P | - |
| UI-035 Acceso offline | HomeScreen | OK | flow.test |

## 5. Crear partida (UI-040..UI-050)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-040 Tarjetas de modo | CreateGameFlow | OK | - |
| UI-041 Modos incompatibles | CreateGameFlow | OK | - |
| UI-042 Selección conjunto | CreateGameFlow | ~ | - |
| UI-043 Info conjunto | CreateGameFlow | ~ | - |
| UI-044 Advertencia personalizado | CreateGameFlow | ~ | - |
| UI-045 Galería héroes | CreateGameFlow | OK | - |
| UI-046 Info héroe | CreateGameFlow | OK | - |
| UI-047 Panel detalles héroe | CreateGameFlow | ~ | - |
| UI-048 Héroes ocupados | CreateGameFlow | ~ | - |
| UI-049 Resumen pre-inicio | CreateGameFlow | OK | - |
| UI-050 Errores por sección | CreateGameFlow | OK | - |

## 6. Sala online (UI-060..UI-066)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-060 Copiar código sala | RoomScreen | P | - |
| UI-061 Estado jugadores | RoomScreen | P | - |
| UI-062 Anfitrión distinguible | RoomScreen | P | - |
| UI-063 Botón iniciar explicado | RoomScreen | P | - |
| UI-064 Cambios tiempo real | RoomScreen | P | - |
| UI-065 Falta paquete | RoomScreen | P | - |
| UI-066 Chat contraíble | RoomScreen | P | - |

## 7. Mesa de juego (UI-070..UI-073)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-070 Cabecera permanente | GameHeader | OK | flow.test |
| UI-071 Indicador de fase | PhaseIndicator | OK | ui-components.test |
| UI-072 Fase activa contraste | PhaseIndicator | OK | ui-components.test |
| UI-073 Instrucción concreta | GameHeader | OK | flow.test |

## 8. Jugadores y héroes (UI-080..UI-085)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-080 Panel resumido | PlayerPanel | OK | components.test |
| UI-081 Borde jugador activo | PlayerPanel | OK | components.test |
| UI-082 Eliminados visibles | PlayerPanel | OK | components.test |
| UI-083 Manos ajenas ocultas | HandView, PrivacyScreen | OK | privacy.test |
| UI-084 Detalle héroe | HeroDetail | P | - |
| UI-085 Usos limitados | PlayerPanel | OK | components.test |

## 9. Horda y enemigos (UI-090..UI-099)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-090 Zona central | Battlefield | OK | components.test |
| UI-091 Info enemigo | Battlefield | OK | components.test |
| UI-092 Fortaleza base→efectivo | Battlefield | OK | components.test |
| UI-093 Heridas numéricas | Battlefield | OK | components.test |
| UI-094 Daño aportado | Battlefield | OK | components.test |
| UI-095 Objetivos válidos | Battlefield | OK | interactions.test |
| UI-096 Enemigos inválidos atenuados | Battlefield | OK | interactions.test |
| UI-097 Efectos completos | EnemyDetail | P | - |
| UI-098 Recompensa oculta | Battlefield | OK | privacy.test |
| UI-099 No en HTML/estado | Battlefield | OK | privacy.test |

## 10. Mano (UI-100..UI-108)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-100 Zona inferior estable | HandView | OK | components.test |
| UI-101 Acciones mano | HandView | ~ | interactions.test |
| UI-102 Jugables vs no jugables | HandView | OK | interactions.test |
| UI-103 Motivo bloqueo | HandView | OK | interactions.test |
| UI-104 Confirmar antes de jugar | HandView | OK | interactions.test |
| UI-105 Mantener pulsado amplía | HandView | OK | components.test |
| UI-106 Carta elevada | HandView | OK | components.test |
| UI-107 Progreso objetivos | HandView | OK | interactions.test |
| UI-108 Desmarcar objetivos | HandView | OK | interactions.test |

## 11. Cartas ampliadas (UI-110..UI-113)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-110 Ampliación completa | CardZoom | OK | ui-components.test |
| UI-111 Cartas personalizadas | CardZoom | OK | ui-components.test |
| UI-112 No revelar info privada | CardZoom | OK | ui-components.test |
| UI-113 Cómo se resuelve | CardZoom | OK | ui-components.test |

## 12. Acciones contextuales (UI-120..UI-124)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-120 Barra contextual | ContextualActions | OK | ui-components.test |
| UI-121 Una acción primaria | ContextualActions | OK | ui-components.test |
| UI-122 Botones peligrosos | ContextualActions | OK | ui-components.test |
| UI-123 Estado de acción | ContextualActions | OK | ui-components.test |
| UI-124 No resultados antes de confirmar | ContextualActions | OK | ui-components.test |

## 13. Elecciones intermedias (UI-130..UI-135)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-130 Diálogo elección | ChoiceDialog | OK | ui-components.test |
| UI-131 Info panel elección | ChoiceDialog | OK | ui-components.test |
| UI-132 Elecciones privadas | ChoiceDialog | OK | ui-components.test |
| UI-133 Esperando decisión | ChoiceDialog | OK | ui-components.test |
| UI-134 Restaurar al reconectar | ChoiceDialog | ~ | - |
| UI-135 No bloquear sin opción | ChoiceDialog | OK | ui-components.test |

## 14. Mercado (UI-140..UI-146)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-140 Fila/cuadrícula mercado | MarketView | OK | components.test |
| UI-141 Info artículo | MarketView | OK | components.test |
| UI-142 Descuentos visuales | MarketView | OK | components.test |
| UI-143 Capacidad incompatible | MarketView | OK | components.test |
| UI-144 Penalización | MarketView | OK | components.test |
| UI-145 Reposición animada | MarketView | ~ | - |
| UI-146 Revisar compradas | MarketView | ~ | - |

## 15. Escenarios (UI-150..UI-155)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-150 Posición visible | ScenarioView | OK | components.test |
| UI-151 Info escenario | ScenarioView | OK | components.test |
| UI-152 Botón usar escenario | ScenarioView | OK | components.test |
| UI-153 Modificadores globales | ScenarioView | ~ | - |
| UI-154 Cambio de escenario | ScenarioView | ~ | - |
| UI-155 No depender memoria | ScenarioView | OK | components.test |

## 16. Ataque Horda (UI-160..UI-164)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-160 Resumen calculado | HordeAttackSummary | OK | ui-components.test |
| UI-161 Distinguir componentes | HordeAttackSummary | OK | ui-components.test |
| UI-162 Ampliar cálculo | HordeAttackSummary | OK | ui-components.test |
| UI-163 Animación resultado | HordeAttackSummary | ~ | - |
| UI-164 Omitir/acelerar | HordeAttackSummary | OK | ui-components.test |

## 17. Historial (UI-170..UI-174)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-170 Independiente del chat | ActionHistory | OK | ui-components.test |
| UI-171 Info entrada | ActionHistory | OK | ui-components.test |
| UI-172 Filtros | ActionHistory | OK | ui-components.test |
| UI-173 Modo avanzado | ActionHistory | OK | ui-components.test |
| UI-174 No info privada | ActionHistory | OK | ui-components.test |

## 18. Chat (UI-180..UI-189)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-180 Panel lateral escritorio | ChatPanel | P | - |
| UI-181 Panel completo móvil | ChatPanel | P | - |
| UI-182 Mensajes sin leer | ChatPanel | P | - |
| UI-183 No ocultar info crítica | ChatPanel | P | - |
| UI-184 Tipos de mensaje | ChatPanel | P | - |
| UI-185 Menú contextual | ChatPanel | P | - |
| UI-186 Ocultar chat | ChatPanel | P | - |
| UI-187 Límite longitud | ChatPanel | P | - |
| UI-188 Envío bloqueado | ChatPanel | P | - |
| UI-189 Sin adjuntos MVP | ChatPanel | P | - |

## 19. Conexión (UI-190..UI-195)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-190 Estado conexión | ConnectionStatus | OK | ui-components.test |
| UI-191 Deshabilitar sin servidor | ConnectionStatus | OK | ui-components.test |
| UI-192 Acciones no confirmadas | ConnectionStatus | ~ | - |
| UI-193 Reconectar | ConnectionStatus | OK | ui-components.test |
| UI-194 Resumen cambios | ConnectionStatus | OK | ui-components.test |
| UI-195 Incompatibilidad versión | ConnectionStatus | ~ | - |

## 20. Offline (UI-200..UI-205)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-200 Indicar local | HomeScreen | OK | flow.test |
| UI-201 Indicador guardado | SaveIndicator | P | - |
| UI-202 Pantalla privacidad hot-seat | PrivacyScreen | OK | privacy.test |
| UI-203 Ocultar mano anterior | PrivacyScreen | OK | privacy.test |
| UI-204 Control varios héroes | (pendiente) | P | - |
| UI-205 Falta almacenamiento | (pendiente) | P | - |

## 21. Pantalla final (UI-210..UI-212)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-210 Resultados completos | FinishedScreen | OK | flow.test |
| UI-211 Explicar empates | FinishedScreen | OK | flow.test |
| UI-212 Acciones post-partida | FinishedScreen | OK | flow.test |

## 22. Tutorial (UI-220..UI-226)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-220 Tutorial paso a paso | Tutorial | P | - |
| UI-221 Explicar en contexto | Tutorial | P | - |
| UI-222 Controles tutorial | Tutorial | P | - |
| UI-223 Botón ayuda | HelpButton | P | - |
| UI-224 Palabras clave | KeywordTooltip | P | - |
| UI-225 Buscar reglamento | RulebookScreen | P | - |
| UI-226 Error → regla | RulebookScreen | P | - |

## 23. Biblioteca (UI-230..UI-234)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-230 Vistas/filtros | LibraryScreen | P | - |
| UI-231 Filtros mínimos | LibraryScreen | P | - |
| UI-232 Info tarjeta | LibraryScreen | P | - |
| UI-233 Archivadas visibles | LibraryScreen | P | - |
| UI-234 Operaciones masivas | LibraryScreen | P | - |

## 24. Estudio (UI-240..UI-244)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-240 Navegación Estudio | StudioNav | P | - |
| UI-241 Migas de pan | StudioBreadcrumbs | P | - |
| UI-242 Estado guardado | SaveIndicator | P | - |
| UI-243 Borradores incompletos | Studio | P | - |
| UI-244 Errores no bloquean guardar | Studio | P | - |

## 25. Editor héroes (UI-250..UI-255)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-250 Vista clase héroe | HeroEditor | P | - |
| UI-251 Variantes tarjetas | HeroEditor | P | - |
| UI-252 Crear variante | HeroEditor | P | - |
| UI-253 Asistente clase nueva | HeroEditor | P | - |
| UI-254 Duplicar | HeroEditor | P | - |
| UI-255 Compartido vs independiente | HeroEditor | P | - |

## 26. Constructor mazos (UI-260..UI-267)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-260 Dos paneles escritorio | DeckBuilder | P | - |
| UI-261 Pestañas móvil | DeckBuilder | P | - |
| UI-262 Controles carta | DeckBuilder | P | - |
| UI-263 Contador permanente | DeckBuilder | P | - |
| UI-264 Errores tiempo real | DeckBuilder | P | - |
| UI-265 Indicador válido | DeckBuilder | P | - |
| UI-266 Filtros biblioteca | DeckBuilder | P | - |
| UI-267 No perder cambios | DeckBuilder | P | - |

## 27. Editor cartas (UI-270..UI-278)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-270 Formulario por tipo | CardEditor | P | - |
| UI-271 Sin campos irrelevantes | CardEditor | P | - |
| UI-272 Secciones formulario | CardEditor | P | - |
| UI-273 Obligatorios visibles | CardEditor | P | - |
| UI-274 Vista previa en vivo | CardEditor | P | - |
| UI-275 Indicar aproximada | CardEditor | P | - |
| UI-276 Alternar frontal/reverso | CardEditor | P | - |
| UI-277 Desbordamiento texto | CardEditor | P | - |
| UI-278 Opciones desbordamiento | CardEditor | P | - |

## 28. Editor reglas (UI-280..UI-289)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-280 Bloques ordenados | RuleEditor | P | - |
| UI-281 Operaciones bloques | RuleEditor | P | - |
| UI-282 Formulario tipado | RuleEditor | P | - |
| UI-283 No JSON libre | RuleEditor | P | - |
| UI-284 Lenguaje comprensible | RuleEditor | P | - |
| UI-285 Jerarquía visual | RuleEditor | P | - |
| UI-286 Selector referencias | RuleEditor | P | - |
| UI-287 Referencias rotas | RuleEditor | P | - |
| UI-288 Advertencias | RuleEditor | P | - |
| UI-289 Descripción técnica | RuleEditor | P | - |

## 29. Editor visual carta (UI-300..UI-305)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-300 Capas controladas | CardVisualEditor | P | - |
| UI-301 Plantillas | CardVisualEditor | P | - |
| UI-302 Cambios | CardVisualEditor | P | - |
| UI-303 No salir área | CardVisualEditor | P | - |
| UI-304 Guías | CardVisualEditor | P | - |
| UI-305 Exportación | CardVisualEditor | P | - |

## 30. Sandbox (UI-310..UI-315)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-310 Mesa + controles | Sandbox | P | - |
| UI-311 Configuración | Sandbox | P | - |
| UI-312 Controles | Sandbox | P | - |
| UI-313 Lado a lado | Sandbox | P | - |
| UI-314 Resaltar cambios | Sandbox | P | - |
| UI-315 Prueba fallida | Sandbox | P | - |

## 31. Versionado (UI-320..UI-325)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-320 Estado contenido | VersionBadge | P | - |
| UI-321 Resumen publicar | PublishDialog | P | - |
| UI-322 Diferencias por categoría | VersionDiff | P | - |
| UI-323 Explicación legible | VersionDiff | P | - |
| UI-324 Publicada no modificable | VersionBadge | P | - |
| UI-325 Nueva versión vs variante | VersionActions | P | - |

## 32. Importación (UI-330..UI-335)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-330 Asistente importación | ImportWizard | P | - |
| UI-331 Info pre-instalación | ImportWizard | P | - |
| UI-332 Reglas desconocidas | ImportWizard | P | - |
| UI-333 Conflictos | ImportWizard | P | - |
| UI-334 No auto-publicada | ImportWizard | P | - |
| UI-335 Abrir en sandbox | ImportWizard | P | - |

## 33. Extracción PDF (UI-340..UI-346)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-340 Flujo extracción | PdfExtractor | P | - |
| UI-341 Ajustar límites | PdfExtractor | P | - |
| UI-342 Números página/fila/col | PdfExtractor | P | - |
| UI-343 Vista comparativa | PdfExtractor | P | - |
| UI-344 Transformaciones | PdfExtractor | P | - |
| UI-345 OCR sugerencia editable | PdfExtractor | P | - |
| UI-346 Estado por campo | PdfExtractor | P | - |

## 34. Estados vacíos/carga/errores (UI-350..UI-356)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-350 Estado vacío | EmptyState | OK | ui-components.test |
| UI-351 Esqueletos carga | LoadingSkeleton | P | - |
| UI-352 Progreso real | ProgressBar | P | - |
| UI-353 Minimizar segundo plano | (pendiente) | P | - |
| UI-354 Clasificar errores | ErrorMessage | OK | ui-components.test |
| UI-355 Acción recuperable | ErrorMessage | OK | ui-components.test |
| UI-356 No trazas internas | ErrorMessage | OK | ui-components.test |

## 35. Accesibilidad (UI-360..UI-369)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-360 WCAG 2.2 AA | Todos | ~ | accessibility.test |
| UI-361 Teclado | Todos | ~ | accessibility.test |
| UI-362 Foco visible | (pendiente) | P | - |
| UI-363 Foco en diálogos | (pendiente) | P | - |
| UI-364 Nombres accesibles | CardView | OK | accessibility.test, png.test |
| UI-365 Regiones accesibles | (pendiente) | P | - |
| UI-366 Alternativa arrastre | (pendiente) | P | - |
| UI-367 Reducir animaciones | (pendiente) | P | - |
| UI-368 Temporizadores no solo color | (pendiente) | P | - |
| UI-369 Zoom 200% | (pendiente) | P | - |

## 36. Responsive (UI-370..UI-374)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-370 No reducir escritorio | Todos | ~ | responsive.test |
| UI-371 Acciones accesibles | (pendiente) | P | - |
| UI-372 Giro no pierde selecciones | (pendiente) | P | - |
| UI-373 Vertical funcional | Todos | ~ | responsive.test |
| UI-374 Horizontal ampliado | (pendiente) | P | - |

## 37. Animaciones (UI-380..UI-385)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-380 Animaciones explican | (pendiente) | P | - |
| UI-381 No retrasar | (pendiente) | P | - |
| UI-382 Acelerar | (pendiente) | P | - |
| UI-383 Estado final garantizado | (pendiente) | P | - |
| UI-384 No destellos | (pendiente) | P | - |
| UI-385 Selección no confirmación | (pendiente) | P | - |

## 38. Sonido (UI-390..UI-394)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-390 Opcional | (pendiente) | P | - |
| UI-391 Controles separados | (pendiente) | P | - |
| UI-392 Eventos con sonido | (pendiente) | P | - |
| UI-393 No depender de sonido | (pendiente) | P | - |
| UI-394 Notificaciones sin privacidad | (pendiente) | P | - |

## 39. Consistencia textual (UI-400..UI-403)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-400 Terminología uniforme | Todos | ~ | accessibility.test |
| UI-401 No alternar términos | Todos | ~ | - |
| UI-402 Verbos claros | Todos | ~ | - |
| UI-403 No lenguaje técnico | Todos | ~ | - |

## 40. Seguridad/privacidad UI (UI-410..UI-415)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-410 Manos privadas no renderizadas | HandView, PrivacyScreen | OK | privacy.test |
| UI-411 Modo espectador | (pendiente) | P | - |
| UI-412 Advertir capturas | (pendiente) | P | - |
| UI-413 Contraseñas ocultas | (pendiente) | P | - |
| UI-414 Acciones admin diferenciadas | (pendiente) | P | - |
| UI-415 Confirmación proporcional | (pendiente) | P | - |

## 41. Moderación (UI-420..UI-424)

| Requisito | Componente | Estado | Test |
|-----------|-----------|--------|------|
| UI-420 Denunciar desde contenido | (pendiente) | P | - |
| UI-421 Formulario denuncia | (pendiente) | P | - |
| UI-422 Confirmación sin promesa | (pendiente) | P | - |
| UI-423 Panel moderación | (pendiente) | P | - |
| UI-424 Alcance y duración | (pendiente) | P | - |

## Resumen

- **Principios generales**: 7 (UI-P01..P07)
- **Requisitos numerados**: 285 (UI-001..UI-424)
- **Total**: 292 requisitos
- **Implementados (OK)**: ~20
- **Parciales (~)**: ~25
- **Planificados (P)**: ~247
