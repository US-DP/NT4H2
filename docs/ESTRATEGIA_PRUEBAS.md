# Estrategia Maestra de Pruebas — NT4H Digital

## 1. Objetivos de la estrategia de pruebas

La estrategia debe comprobar que:

1. Las reglas generales funcionan correctamente.
2. Cada carta reproduce exactamente el comportamiento de los PDF.
3. Las combinaciones de cartas no generan estados imposibles.
4. El resultado es idéntico en offline y online.
5. El servidor rechaza acciones ilegales.
6. Las partidas pueden guardarse y recuperarse.
7. Las desconexiones no provocan duplicados ni pérdida de acciones.
8. El chat no revela información privada.
9. El editor genera definiciones válidas.
10. Las versiones publicadas son inmutables.
11. Las importaciones no ejecutan contenido peligroso.
12. La interfaz resulta accesible y utilizable.
13. El sistema soporta múltiples partidas simultáneas.
14. Los errores pueden reproducirse a partir de la semilla y del historial.

## 2. Pirámide de pruebas

```text
                   Pruebas exploratorias
                Pruebas de aceptación UAT
                   Pruebas E2E
                 Pruebas de sistema completas
              Pruebas de integración y contratos
             Pruebas de componentes y del motor
                    Pruebas unitarias
          Validación estática de datos y del código
```

La mayor cantidad estará en los niveles inferiores:

- Muchas pruebas unitarias.
- Bastantes pruebas de integración.
- Un conjunto seleccionado de pruebas E2E.
- Pocas pruebas manuales, pero bien dirigidas.

Las pruebas E2E no deben intentar cubrir todas las combinaciones posibles de cartas. Las combinaciones del motor se comprueban principalmente con pruebas unitarias, parametrizadas y basadas en propiedades.

## 3. Nivel 0: Validación estática

### 3.1. Calidad del código

#### Frontend y motor TypeScript

- TypeScript en modo estricto.
- ESLint.
- Prettier.
- Detección de dependencias circulares.
- Detección de imports no utilizados.
- Comprobación de esquemas.
- Verificación de traducciones.

#### Backend Django

- Ruff.
- mypy.
- Comprobaciones de Django.
- Migraciones pendientes.
- Dependencias vulnerables.
- Análisis de configuraciones inseguras.

### 3.2. Validación del catálogo de cartas

Cada carta debe comprobar automáticamente:

- Identificador único.
- Tipo válido.
- Versión de esquema conocida.
- Nombre no vacío.
- Número de copias positivo.
- Ataque dentro del rango admitido.
- Coste no negativo.
- Objetivos compatibles.
- Efectos registrados.
- Parámetros completos.
- Duraciones válidas.
- Destino válido.
- Referencias existentes.
- Fuente documental registrada.
- Estado de verificación válido.

### 3.3. Validación de imágenes

Para cada recurso gráfico:

- El archivo existe.
- Es una imagen válida.
- Sus dimensiones están dentro de los límites.
- La relación de aspecto es correcta.
- No está completamente vacío.
- No contiene dos cartas recortadas juntas.
- El frontal y el reverso están asociados.
- La miniatura puede generarse.
- El identificador de la imagen coincide con la definición.

## 4. Nivel 1: Pruebas unitarias

### 4.1. Cálculos básicos

- Fortaleza efectiva.
- Daño restante.
- Ataque de la Horda.
- Coste efectivo del Mercado.
- Número de cartas que deben perderse.
- Cantidad de Gloria.
- Cantidad de monedas.
- Límites de mano.
- Redondeos.
- Modificadores acumulativos.

### 4.2. Movimiento de cartas

- Mazo a mano.
- Mano a resolución.
- Resolución a Desgaste.
- Desgaste a mazo.
- Mercado a mano.
- Campo a trofeos.
- Trofeos a campo.
- Carta a retirada del juego.
- Carta revelada al fondo del mazo.

**Invariante esencial**: Una instancia de carta debe pertenecer exactamente a una zona.

### 4.3. Desgaste y agotamiento

- El jugador pierde una carta con suficientes cartas en el mazo.
- Pierde exactamente las cartas restantes.
- Necesita perder más cartas de las disponibles.
- El mazo se agota al robar.
- El Desgaste está vacío al agotarse el mazo.
- El héroe recibe una Herida.
- La operación continúa después de reconstruir el mazo.
- El héroe queda eliminado durante la pérdida.
- Una prevención reduce la pérdida a cero.
- Feldon reduce una cantidad impar y redondea hacia abajo.

### 4.4. Objetivos

Selectores a probar:

- Un enemigo vivo.
- Dos enemigos distintos.
- Todos los enemigos.
- Enemigo con mayor Fortaleza.
- Héroe con menos Heridas.
- Otro héroe.
- Carta del Desgaste.
- Carta con nombre concreto.
- Trofeo del jugador.
- Artículo disponible en el Mercado.

Empates:

- Dos enemigos tienen la mayor Fortaleza → el sistema solicita una elección si la regla no establece desempate.

## 5. Nivel 2: Pruebas unitarias de cada efecto

| Efecto | Comprobaciones principales |
|--------|---------------------------|
| Infligir daño | Cantidad, objetivo, modificadores, daño cero |
| Robar cartas | Cantidad, agotamiento, privacidad |
| Perder cartas | Desgaste, Heridas, eliminación |
| Recuperar | Origen, destino, selección, cantidad disponible |
| Obtener Gloria | Cantidad, condición, receptor |
| Transferir recursos | Disponibilidad, límites, varios jugadores |
| Prevenir daño | Cantidad, duración, consumo |
| Anular enemigo | Objetivo, duración, desaparición al morir |
| Modificar Fortaleza | Aplicación, retirada, derrota inmediata |
| Finalizar fase | Resolución completa antes de avanzar |
| Barajar | Determinismo con la misma semilla |
| Elegir opción | Opciones válidas, cancelación, reconexión |
| Reacción | Ventana válida, prioridad, límite de usos |
| Retirar del juego | Destino permanente y referencias |
| Modificar recompensa | Fuente afectada y recursos no afectados |

## 6. Nivel 3: Pruebas del motor de reglas

### 6.1. Comandos válidos

- Elegir enfrentamiento.
- Realizar Evasión.
- Jugar una carta.
- Elegir objetivo.
- Resolver una decisión.
- Finalizar ataque.
- Comprar objeto.
- Finalizar Mercado.
- Ajustar mano.
- Activar poder de héroe.
- Activar acción de escenario.
- Utilizar apoyo.

### 6.2. Comandos inválidos

- Jugar fuera del turno.
- Jugar una carta ajena.
- Jugar una carta que no está en la mano.
- Seleccionar enemigo derrotado.
- Seleccionar demasiados objetivos.
- Pagar sin recursos.
- Usar una habilidad agotada.
- Comprar un objeto incompatible.
- Responder a una elección de otro jugador.
- Reutilizar un comando procesado.
- Actuar durante una resolución pendiente.
- Jugar una versión de carta distinta a la instalada.

### 6.3. Atomicidad

Si un comando falla, el estado debe permanecer intacto.

## 7. Nivel 4: Pruebas individuales de todas las cartas

Cada definición distinta tendrá un archivo de prueba.

### 7.1. Plantilla de pruebas por carta

Cada carta deberá comprobar:

- Valores impresos.
- Número de copias.
- Fase permitida.
- Objetivos.
- Costes.
- Orden de resolución.
- Efectos.
- Destino.
- Condición verdadera.
- Condición falsa.
- Interacción con derrota.
- Interacción con mazo agotado.
- Interacción con Señor de la Guerra.
- Interacción con modificadores.
- Idempotencia.
- Fuente documental.

### 7.2-7.6. Casos específicos

**Disparo certero**: Inflige 3 daño, pierde carta, finaliza ataque, no permite otra habilidad, mazo agotado, último enemigo.

**Disparo rápido**: Encadena copias, se agota el mazo, sin objetivo, carta fallida, Beleth-Il, no bucle infinito.

**Espadazo**: Primero roba, segundo no roba, otro jugador, contador reinicia, copia jugada vía otra habilidad.

**Bola de fuego**: Daña todos, otros héroes pierden carta, lanzador inmune, derrota múltiples, recompensas, Gurdrug, eventos separados, inmunes.

**Trampa**: Permanece, se activa, derrota mayor Fortaleza, empate, sin botín, reduce ataque, mueve a Desgaste, no se activa dos veces, un enemigo, Señor de la Guerra.

## 8. Nivel 5: Pruebas de héroes

Cada héroe necesita comprobar:

- Número máximo de Heridas.
- Clase.
- Capacidades.
- Momento de activación.
- Número de usos.
- Costes.
- Resultado.
- Persistencia del contador.
- Interacciones online.

**Idril**: Mira 3 cartas inferiores, reordena, privado, 2 usos, persistencia tras guardar.

**Feldon**: Reduce 5→2, 4→2, 1→0, 1 uso, no después de aplicar, con prevención y cancelación.

**Valèrys**: Solo otro héroe, redirige, +1 Gloria, consume uso, historial, prevención.

## 9. Nivel 6: Pruebas de escenarios y jefes

### 9.1. Escenarios

Cada escenario: activación, efecto, expiración, nueva oleada, recompensas, guardado.

**Planicie de Skaàrg**: Anula monedas del reverso, no Campo de batalla, no habilidades, no Gloria, expira al cambiar.

**Ruinas de Brunmar**: -1 Fortaleza, derrota inmediata, anula Gloria reverso, no Proyectil ígneo, restaura al desaparecer, no revive.

**Portal de Ulthar**: Pagar Gloria, pagar monedas, no mezclar, devuelve Hueste, retira trofeo, coloca como enemigo, limpia, no duplica.

### 9.2. Señores de la Guerra

**Gurdrug**: Daño→pérdida, múltiples impactos→1 pérdida, cartas distintas→2 pérdidas, daño cero no activa, Gloria una vez por carta.

**Rochkiller**: +Fortaleza orcos, desaparece al morir, recalcula derrotas, no duplica por reconexión.

**Shriekknifer**: Ataque 1 activa, ataque 2 reducido a 1, ataque 1 aumentado a 2, daño cero, interpretación documentada.

## 10. Nivel 7: Pruebas basadas en propiedades

### 10.1. Invariantes

Después de cualquier comando válido:

- Cada carta existe en exactamente una zona.
- Ningún identificador de instancia está duplicado.
- Las monedas no son negativas.
- La Gloria no es negativa.
- Las Heridas no son negativas.
- Una carta retirada no vuelve sin regla explícita.
- Un enemigo derrotado no permanece atacable.
- Una recompensa no se entrega dos veces.
- La versión del estado aumenta exactamente una vez.
- La semilla avanza de manera determinista.
- Una elección pendiente tiene opciones válidas.
- El jugador activo pertenece a la partida.
- Una partida finalizada no admite comandos.
- Todas las referencias apuntan a versiones disponibles.

### 10.2. Secuencias aleatorias completas

Buscar: bloqueos, decisiones sin salida, bucles, cartas desaparecidas, partidas que no pueden continuar, recompensas duplicadas, fases imposibles, excepciones no controladas.

## 11. Nivel 8: Pruebas metamórficas y diferenciales

### 11.1. Determinismo

Mismo estado + semilla + comandos + versiones = resultado idéntico.

### 11.2. Comparación offline y online

Misma secuencia en local vs servidor → comparar estado final, eventos, orden, selecciones, resultado.

### 11.3. Serialización

estado → serializar → deserializar → mismo estado.
partida guardada → cerrar → restaurar → continuar → mismo resultado.

## 12. Nivel 9: Pruebas de integración del backend

### 12.1. Base de datos

Creación de usuarios, proyectos, versiones, referencias protegidas, transacciones, migraciones, archivado, restricciones únicas, eliminación de borradores.

### 12.2. Publicación

Borrador → validación → revisión → publicación → versión inmutable.
Casos: válida, efecto desconocido, referencia ausente, mazo incompleto, prueba fallida, dependencia incompatible, editar publicada, eliminar utilizada.

### 12.3. API

Respuestas válidas, errores normalizados, autenticación, autorización, paginación, filtros, control de versiones, carga de archivos, límites.

### 12.4. Permisos

Matriz propietario/colaborador/revisor/jugador externo para cada acción.

## 13. Nivel 10: Pruebas de contratos

### 13.1. Contrato de tarjeta

Backend produce esquema correcto, frontend lo interpreta, motor acepta definición, propiedad desconocida se rechaza, versión incompatible se rechaza.

### 13.2. Contrato WebSocket

Eventos: game.started, game.snapshot, game.events, game.choice_requested, game.command_rejected, player.disconnected, player.reconnected, chat.message, game.finished.
Para cada mensaje: tipo, versión, campos obligatorios, campos privados, compatibilidad, orden.

### 13.3. Vistas privadas del estado

Jugador A recibe su mano, B no recibe mano de A, espectador no recibe manos, admin no recibe info privada innecesaria, registro público no contiene orden de mazos.

## 14. Nivel 11: Pruebas del modo online

### 14.1. Salas

Crear pública/privada, acceder con código, rechazar código incorrecto, sala completa, jugador duplicado, transferencia de anfitrión, preparación, inicio con no preparados, configuración incompatible, contenido no instalado.

### 14.2. Concurrencia

Dos usuarios mismo héroe, dos comandos misma versión, doble compra, reenvío al reconectar, finalizar turno + reacción, cerrar sala + unirse, chat misma marca temporal, desconexión durante decisión.
Resultado: solo una operación se acepta, la otra recibe error, estado consistente.

### 14.3. Reconexión

Desconexión: antes de empezar, turno propio, turno ajeno, eligiendo objetivo, tras enviar comando, durante animación, durante chat, al finalizar.
Restaurar: estado, mano propia, historial, fase, temporizador, elección pendiente, conexión de participantes, últimos mensajes.

### 14.4. Condiciones de red

Latencia alta, paquetes duplicados, mensajes retrasados, fuera de orden, corte total, reconexiones repetidas, Wi-Fi a móvil, segundo plano.

## 15. Nivel 12: Pruebas del modo offline

### 15.1. Persistencia

Guardado automático, manual, restauración, varios guardados, eliminación, exportación, importación, migración de esquema, guardado corrupto, falta de imágenes, falta de espacio.

### 15.2. Hot seat

Ocultar mano al cambiar, pantalla privacidad, confirmación, no mostrar info anterior, limpiar selecciones, mantener efectos públicos, recuperar partida.

### 15.3. Igualdad con online

Misma partida, semilla y comandos → resultado offline = resultado online.

### 15.4. PWA y móvil

Sin conexión, recursos esenciales, catálogo local, actualización, datos conservados, segundo plano, cierre forzado, restauración.

## 16. Nivel 13: Pruebas del chat

### 16.1. Funcionales

Enviar, recibir, ordenar, historial, eliminar, editar, silenciar, bloquear, denunciar, sistema, cambio de sala, reconexión.

### 16.2. Privacidad

Mensaje no aparece en otra sala, espectador solo canal permitido, bloqueado no salta bloqueo, no detalles de cartas ocultas, backend no incluye datos privados.

### 16.3. Seguridad

HTML como texto, scripts no ejecutan, URLs seguras, longitud limitada, spam limitado, unicode no rompe, no suplantación del sistema, denuncia conserva evidencia.

## 17. Nivel 14: Pruebas del editor

### 17.1. Creación de héroe

Crear clase, variante, estadísticas, poder, biblioteca, habilidades, mazo, validar, probar, publicar, usar en partida.

### 17.2. Casos inválidos

Clase sin nombre, héroe sin límite, poder sin momento, mazo de 14, carta de otra clase, efecto sin objetivo, duración ausente, ID duplicado, referencia eliminada, regla desconocida, bucle automático, carta sin destino, imagen corrupta.

### 17.3. Versionado

Publicar v1, crear borrador de v1, editar, publicar v2, conservar v1, partida con v1, partida con v2, comportamientos independientes, archivar v1 sin romper.

### 17.4. Previsualización y PNG

Texto corto/largo, varias líneas, acentuados, resoluciones, ilustración vertical/horizontal, ausencia, iconos múltiples, frontal, reverso, coincidencia.

## 18. Nivel 15: Pruebas de importación y exportación

### 18.1. Paquete válido

Carta individual, héroe completo, mazo, expansión, traducción, plantilla, reglas declarativas.

### 18.2. Dependencias

Todas disponibles, una ausente, versión antigua, versión nueva, circular, incompatibles.

### 18.3. Conflictos

ID existente, misma carta y versión, misma ID contenido diferente, actualización legítima, bifurcación, omisión, cancelación.

### 18.4. Seguridad de archivos

Rechazar: ../../archivo, script.py, install.sh, plugin.dll, enlace simbólico, imagen extensión falsa, comprimido excesivo, JSON profundidad extrema, millones de archivos.

### 18.5. Atomicidad

99 válidos + 1 inválido → no publicar parcialmente, cuarentena, informe reproducible, cancelación limpia.

### 18.6. Ida y vuelta

exportar → importar → definiciones equivalentes.

## 19. Nivel 16: Pruebas E2E

- E2E-01: Partida offline completa.
- E2E-02: Guardar y continuar.
- E2E-03: Sala online.
- E2E-04: Reconexión.
- E2E-05: Chat.
- E2E-06: Crear héroe personalizado.
- E2E-07: Editar sin romper partidas.

## 20. Nivel 17: Pruebas de rendimiento

### 20.1. Motor

| Operación | Objetivo |
|-----------|----------|
| Efecto simple local | < 10 ms |
| Comando ordinario | < 100 ms |
| Resolución en servidor | < 300 ms |
| Creación de instantánea | < 200 ms |
| Recuperación de partida | < 2 s |
| Actualización visual online | < 1 s |

### 20.2. Backend

10, 100, 500 salas simultáneas, acciones/segundo, reconexiones masivas, historiales largos, catálogos grandes, descarga de imágenes.

### 20.3. Chat

Ráfagas, muchas salas, historial extenso, bloqueados, moderación concurrente, rate limiting.

### 20.4. Editor

10.000 cartas, búsqueda, filtros, previsualización, exportación PNG, importación grande, hojas imprimibles.

## 21. Nivel 18: Pruebas de seguridad

### Autenticación

Contraseña incorrecta, sesión expirada, token manipulado, restablecimiento, revocación, intentos repetidos.

### Autorización

Proyecto ajeno, edición sin permiso, publicación sin permiso, partida privada, mano ajena, acción como otro, moderación sin rol.

### API

Inyección, datos malformados, parámetros excesivos, enumeración de IDs, archivos maliciosos, manipulación de versiones, reenvío de comandos.

### WebSocket

Conexión sin auth, unión a partida ajena, suplantación, mensajes desconocidos, frecuencia excesiva, payload sobredimensionado, sesión revocada.

### Información oculta

Inspeccionar todos los payloads a cada actor (Jugador A, B, espectador, externo, moderador).
Fallar si encuentra: cartas ajenas, orden de mazos, recompensas ocultas, elecciones secretas, info de Idril.

## 22. Nivel 19: Accesibilidad y usabilidad

### Accesibilidad automática

Contraste, etiquetas, roles, orden de foco, botones sin nombre, encabezados, formularios, diálogos, navegación por teclado.

### Accesibilidad manual

Jugar sin ratón, seleccionar objetivo con teclado, lector de pantalla, comprender iconos, animaciones reducidas, ampliar texto, distinguir estados sin color, acceder al chat.

### Usabilidad

Crear partida offline, unirse con código, entender por qué carta no se puede jugar, consultar escenario, crear héroe, añadir cartas al mazo, resolver error de validación, importar expansión.
Métricas: tiempo, errores, retrocesos, uso de ayuda, abandono, comprensión.

## 23. Nivel 20: Pruebas de recuperación y resiliencia

Simular: reinicio backend, caída Redis, caída PostgreSQL, worker detenido, exportación interrumpida, importación interrumpida, WebSocket cortado, app cerrada durante guardado, almacenamiento lleno, versiones parcialmente descargadas.

Comprobaciones: no se pierden comandos confirmados, no se duplican, estado estable, mensaje comprensible, puede reintentarse, trabajos interrumpidos tienen estado, importaciones incompletas no se publican.

## 24. Nivel 21: Pruebas de migración y compatibilidad

### Bases de datos

Aplicar migración anterior, revertir, mantener versiones, conservar relaciones, detectar inconsistentes.

### Esquemas de cartas

CardSchema 1.0 → 1.1 → definición equivalente.

### Guardados offline

Abrir guardado antiguo, migrar, validar, continuar, conservar copia si falla.

### Paquetes

Importar antiguo compatible, rechazar demasiado nuevo, explicar, migrar si existe migración segura.

## 25. Pruebas de regresión visual

Capturas de: página principal, biblioteca, carta ampliada, mesa, mano, mercado, chat, editor, previsualización, resultado final, vista móvil.

Comprobar: posición, solapamientos, desbordamiento, fuentes, iconos, cartas cortadas, texto ilegible, temas claro/oscuro, tamaños de pantalla.

## 26. Pruebas manuales y exploratorias

### Exploración de reglas

Combinar cartas de diferentes clases, escenarios que alteran recompensas, jefes con modificadores, agotar mazo repetidamente, forzar empates, contenido extraño pero válido.

### Exploración de UX

Jugar sin instrucciones, cambiar mesa/chat, móvil con una mano, interrumpir acciones, conexión lenta, mensajes de error.

### Exploración del editor

Carta con muchos efectos, duplicar, cambiar tipo, archivar dependencias, importar y bifurcar, publicar y volver a editar.

## 27. Datos de prueba

### Fixtures mínimos

Héroe simple, carta de ataque simple, carta sin ataque, carta con coste, carta con elección, carta con reacción, hueste sin efectos, hueste con recompensa, jefe con modificador, escenario sin efecto, escenario con modificador, objeto consumible, objeto recuperable.

### Partidas preparadas

GAME_EMPTY_BATTLEFIELD, GAME_ONE_ENEMY, GAME_WARLORD_ACTIVE, GAME_PLAYER_NEAR_EXHAUSTION, GAME_PENDING_CHOICE, GAME_MARKET_EMPTY, GAME_ALL_PLAYERS_LOW_HEALTH, GAME_FINAL_TURN.

### Semillas fijas

seed-rapid-shot-chain, seed-market-purchase, seed-warlord-final, seed-solo-support, seed-reconnection-choice.

## 28. Trazabilidad entre reglas, cartas y pruebas

Cada regla tendrá un identificador:

- RULE-GENERAL-ATTACK-001
- RULE-HERO-FELDON-001
- RULE-CARD-RAPID-SHOT-001
- RULE-SCENARIO-SKAARG-001

Cada prueba indicará qué regla cubre.

Matriz de trazabilidad: Regla | Fuente | Implementación | Prueba | Estado.

Una regla oficial no podrá marcarse como terminada si no tiene al menos una prueba asociada.

## 29. Cobertura requerida

### Objetivos

- Motor de reglas: 95% de ramas.
- Validadores: 95%.
- Operaciones declarativas: 100% de tipos.
- Cartas oficiales: 100% con prueba nominal.
- Escenarios: 100% con activación y expiración.
- Jefes: 100% con Pericia.
- API crítica: 90%.
- UI: cobertura centrada en interacciones.
- E2E: todos los recorridos críticos.

### Cobertura funcional

- Reglas generales verificadas: X/Y
- Cartas verificadas: X/Y
- Interacciones críticas: X/Y
- Escenarios verificados: 12/12
- Héroes verificados: 8/8
- Jefes verificados: 3/3
- Mercado verificado: X/14
- Huestes verificadas: X/27

## 30. Ejecución en integración continua

### En cada commit

Formato, lint, tipado, validación de esquemas, pruebas unitarias, motor, catálogo.

### En cada pull request

Todo lo anterior + integración con DB, contratos API, E2E críticos, regresión visual, análisis de seguridad, informe de cobertura, validación de migraciones.

### Ejecución nocturna

Propiedades con muchas iteraciones, partidas aleatorias, rendimiento, concurrencia, reconexiones, importaciones maliciosas, todos los navegadores, matriz de dispositivos.

### Antes de publicar

Suite completa, aceptación, migración sobre copia de producción, restauración de backup, carga, seguridad, accesibilidad, partida manual.

## 31. Criterios de bloqueo de una versión

Una versión no podrá publicarse si:

1. Falla una prueba del motor.
2. Falla una carta oficial.
3. Existe divergencia online-offline.
4. Una mano ajena puede filtrarse.
5. Una versión publicada puede modificarse.
6. Un comando puede ejecutarse dos veces.
7. Una importación puede ejecutar código.
8. Una partida no puede restaurarse.
9. Existe una migración destructiva no controlada.
10. Un recorrido E2E crítico falla.
11. Existe una ambigüedad crítica no documentada.

Una advertencia visual menor podrá permitirse, pero quedará registrada.

## 32. Criterios de aceptación globales

La aplicación estará preparada para una versión estable cuando:

1. Todas las cartas originales publicadas estén verificadas.
2. Todas tengan pruebas nominales.
3. Las interacciones críticas tengan pruebas.
4. Offline y online produzcan resultados idénticos.
5. Las partidas se puedan guardar y restaurar.
6. La reconexión funcione durante decisiones pendientes.
7. El chat no revele información privada.
8. El servidor rechace acciones ilegales.
9. Los comandos sean idempotentes.
10. El editor genere contenido válido.
11. Las versiones antiguas sigan funcionando.
12. Las importaciones sean seguras.
13. La interfaz pueda utilizarse con teclado.
14. Los flujos críticos E2E funcionen.
15. Se haya completado una prueba de carga satisfactoria.
16. Se haya verificado la restauración desde copias de seguridad.

## Priorización para el MVP

### Obligatorias antes del MVP

1. Validación estática.
2. Unitarias del motor.
3. Pruebas por carta incluida.
4. Integración del guardado.
5. E2E de partida offline.
6. E2E de sala online.
7. Reconexión.
8. Privacidad de manos.
9. Chat básico.
10. Versionado del editor.
11. Seguridad de importación.
12. Determinismo online-offline.

### Posteriores al MVP

1. Carga extrema.
2. Compatibilidad con muchos paquetes históricos.
3. Todas las combinaciones comunitarias.
4. Simulación masiva de equilibrio.
5. Moderación avanzada.
6. Pruebas completas de espectador.
7. Matriz extensa de dispositivos móviles.

## Conclusión

La estructura recomendada:

```text
Regla documentada
→ identificador de regla
→ implementación
→ prueba unitaria
→ prueba de interacción
→ caso E2E cuando sea crítico
→ estado de verificación
```

Así, cuando una carta o interpretación cambie, será posible saber exactamente qué código, pruebas, mazos y partidas pueden verse afectados.
