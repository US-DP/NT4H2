# Especificación de Interfaz de Usuario — NT4H Digital

> Especificación completa y verificable de la UI del proyecto NT4H Digital.
> Cubre juego, comunicación, creación y gestión de contenido.
> Todos los requisitos son verificables y se mapean a componentes y tests en `TRAZABILIDAD_UI.md`.

---

## 1. Objetivo general de la interfaz

La interfaz deberá permitir que una persona pueda:

- Comprender rápidamente el estado de una partida.
- Identificar qué acciones puede realizar.
- Jugar cartas sin memorizar controles complejos.
- Consultar reglas y efectos sin abandonar la partida.
- Distinguir información pública, privada y oculta.
- Jugar desde escritorio, móvil o tableta.
- Crear y editar contenido mediante formularios visuales.
- Recuperarse fácilmente de errores o desconexiones.
- Utilizar la aplicación con teclado y tecnologías de asistencia.
- Diferenciar claramente contenido original, personalizado y experimental.

---

## 2. Principios generales de UI

### UI-P01. Claridad antes que decoración
La estética de fantasía no deberá reducir la legibilidad. Los marcos, fondos, animaciones e ilustraciones no podrán dificultar:
- La lectura del texto.
- La identificación de valores.
- La selección de objetivos.
- La diferenciación entre cartas disponibles y bloqueadas.
- La comprensión del turno.

### UI-P02. Estado visible
La interfaz deberá mostrar permanentemente:
- Jugador activo.
- Fase actual.
- Acción esperada.
- Resolución pendiente.
- Estado de conexión.
- Temporizador, cuando exista.
- Número de cartas de cada mazo relevante.

### UI-P03. Acciones contextuales
La interfaz solo ofrecerá como principales las acciones válidas en el contexto actual.
Por ejemplo, durante la fase de Mercado: Comprar, Inspeccionar objeto, Finalizar Mercado.
No deberían destacar acciones propias de la fase de Ataque.

### UI-P04. Prevención de errores
La interfaz deberá prevenir acciones inválidas antes de enviarlas, pero el servidor volverá a validarlas.

### UI-P05. Explicación de errores
No bastará con mostrar "Acción inválida". La aplicación deberá indicar:
- Qué acción falló.
- Por qué no puede realizarse.
- Qué requisito falta.
- Cómo puede corregirse.

Ejemplo: `No puedes comprar esta carta. Necesitas 5 monedas y actualmente tienes 3.`

### UI-P06. Coherencia multiplataforma
Web, Android e iOS compartirán: terminología, iconos, colores de estado, jerarquía visual, comportamiento de las cartas, flujo de navegación. La distribución podrá cambiar según el tamaño de pantalla.

### UI-P07. Divulgación progresiva
La interfaz mostrará primero la información necesaria y permitirá ampliar los detalles cuando el usuario lo desee.
Una carta de la mesa puede mostrar inicialmente: nombre, ataque/fortaleza, heridas, estado.
Al ampliarla mostrará: texto completo, efectos estructurados, fuente, historial, aclaraciones.

---

## 3. Sistema visual global

### 3.1 Colores

**UI-001** — Paleta consistente por elemento:
| Elemento | Tratamiento visual |
|---|---|
| Guerrero | Rojo o granate |
| Explorador | Verde |
| Pícaro | Morado o gris oscuro |
| Mago | Azul |
| Huestes | Marrón, ocre o negro |
| Mercado | Dorado |
| Escenarios | Turquesa o pergamino |
| Señor de la Guerra | Rojo oscuro |
| Gloria | Azul o verde brillante |
| Monedas | Dorado |
| Heridas | Rojo |
| Prevención y escudos | Azul claro |

**UI-002** — El color no será el único medio para diferenciar elementos. También se utilizarán: iconos, etiquetas, formas, bordes, texto, patrones visuales.

**UI-003** — Los estados de éxito, advertencia y error tendrán icono y texto: `✓ Válido`, `⚠ Requiere revisión`, `✕ Error bloqueante`.

### 3.2 Tipografía

**UI-004** — Tipografía decorativa únicamente para títulos cortos.
**UI-005** — Efectos, reglas, botones y mensajes usarán tipografía de alta legibilidad.
**UI-006** — La interfaz admitirá ampliación de texto sin provocar solapamientos, cortes, botones inaccesibles ni texto fuera de pantalla.
**UI-007** — Tamaño mínimo del texto funcional: 14 px en web, preferentemente 16 px para contenido principal.

### 3.3 Iconografía

**UI-008** — Cada recurso y acción frecuente tendrá un icono coherente.
**UI-009** — Todo icono dispondrá de: etiqueta visible, o texto emergente, o nombre accesible.
**UI-010** — Los iconos originales del juego se acompañarán de explicación al mantener pulsado, pasar el cursor o enfocar con teclado.

### 3.4 Espaciado y densidad

**UI-011** — Cuadrícula consistente.
**UI-012** — Áreas táctiles de al menos 44×44 puntos.
**UI-013** — Botones principales no excesivamente próximos para evitar activaciones accidentales.
**UI-014** — Densidad configurable en web: Cómoda, Compacta.

---

## 4. Navegación principal

**UI-020** — En escritorio se utilizará barra lateral o navegación superior estable.
**UI-021** — En móvil se utilizará navegación inferior para áreas principales y menús secundarios para funciones menos frecuentes.
**UI-022** — La navegación mostrará la ubicación actual mediante: título de página, elemento activo, migas de pan en el Estudio, botón Atrás coherente.
**UI-023** — Salir accidentalmente de una edición con cambios sin guardar deberá mostrar advertencia.
**UI-024** — Salir de una partida no equivaldrá a abandonarla. Se diferenciarán: Volver al inicio, Pausar, Salir temporalmente, Abandonar partida.

Estructura de navegación: Inicio, Jugar, Continuar, Salas, Estudio, Colección, Tutorial, Reglamento, Perfil, Ajustes.

---

## 5. Página de inicio

**UI-030** — La página de inicio priorizará: Continuar partida, Jugar offline, Jugar online, Entrar en el Estudio, Consultar tutorial o reglas.
**UI-031** — Si hay partida activa, "Continuar" tendrá mayor prioridad visual que "Nueva partida".
**UI-032** — Las partidas pendientes mostrarán: nombre, modo, fecha de última actividad, turno actual, estado, jugadores, conectividad, contenido personalizado utilizado.
**UI-033** — El inicio distinguirá: partidas locales, partidas online, partidas finalizadas, partidas que requieren una decisión, invitaciones.
**UI-034** — Sin conexión se mostrará un indicador no intrusivo: "Sin conexión. Las funciones online no están disponibles."
**UI-035** — La falta de conexión no bloqueará el acceso a: partidas offline, colección instalada, Estudio local, tutorial descargado, reglamento local.

---

## 6. Flujo para crear una partida

Pasos: 1. Modo, 2. Participantes, 3. Contenido, 4. Héroes y mazos, 5. Opciones, 6. Resumen.

**UI-040** — Cada modo se mostrará como tarjeta con: nombre, descripción breve, número de jugadores, necesidad de conexión, duración estimada, nivel de dificultad, estado de disponibilidad.
**UI-041** — Los modos incompatibles permanecerán visibles pero deshabilitados, explicando el motivo.
**UI-042** — El usuario podrá seleccionar un conjunto de juego.
**UI-043** — Cada conjunto mostrará: autor, versión, tipos de contenido, reglas adicionales, dependencias, estado de verificación, indicación de contenido personalizado.
**UI-044** — Antes de iniciar una partida con contenido personalizado se mostrará: "Esta partida utiliza cartas o reglas personalizadas."
**UI-045** — Los héroes se presentarán en una galería visual.
**UI-046** — Cada héroe mostrará: nombre, clase, límite de Heridas, habilidad especial resumida, mazo seleccionado, estado de disponibilidad.
**UI-047** — Al seleccionar un héroe se abrirá un panel lateral o inferior con detalles completos.
**UI-048** — Los héroes ya seleccionados por otro jugador se indicarán como ocupados si no pueden repetirse.
**UI-049** — Antes de comenzar se mostrará: modo, participantes, héroes, mazos, conjunto, escenarios, reglas opcionales, política de desconexión, temporizador, advertencias.
**UI-050** — Los errores se agruparán por sección y permitirán volver directamente al paso correspondiente.

---

## 7. Sala online

**UI-060** — El código de sala deberá poder copiarse con una sola acción.
**UI-061** — El estado de cada jugador será visible: Eligiendo héroe, Preparado, Desconectado, Falta contenido, Versión incompatible.
**UI-062** — El anfitrión se distinguirá mediante icono y etiqueta.
**UI-063** — El botón "Iniciar partida" explicará por qué está deshabilitado.
**UI-064** — Los cambios realizados por otros usuarios se mostrarán en tiempo real.
**UI-065** — Si falta un paquete, la interfaz ofrecerá: Ver contenido, Descargar (si está permitido), Cancelar la participación.
**UI-066** — El chat podrá contraerse para aumentar el espacio de configuración.

Distribución: Cabecera (nombre, código, privacidad, conexión), Participantes (jugador, héroe, mazo, estado preparado, conexión), Configuración (modo, conjunto, reglas, temporizador), Chat, Acciones (Preparado, Invitar, Copiar código, Iniciar).

---

## 8. Mesa de juego

Áreas: Cabecera de partida (fase, turno, conexión, temporizador, menú), Zona de jugadores, Zona de Horda, Escenario, Mercado, Mano propia, Acciones contextuales, Historial y chat.

### 8.2 Cabecera

**UI-070** — La cabecera mostrará permanentemente: nombre de la partida, jugador activo, fase, número de ronda, estado de conexión, botón de menú.
**UI-071** — La fase se representará mediante texto e indicador de progreso: `Ataque → Mercado → Restablecimiento`.
**UI-072** — La fase activa tendrá mayor contraste.
**UI-073** — Si la aplicación espera una acción del usuario, se mostrará una instrucción concreta: `Selecciona un enemigo para Disparo certero.` No se usarán instrucciones vagas como "Haz una acción".

---

## 9. Representación de jugadores y héroes

**UI-080** — Cada jugador dispondrá de un panel resumido con: nombre, héroe, heridas, gloria, monedas, escudos, número de cartas en mano, tamaño del mazo, tamaño de Desgaste, estado de conexión.
**UI-081** — El jugador activo tendrá un borde, marcador o halo de alto contraste.
**UI-082** — Los jugadores eliminados se mantendrán visibles, pero con estado inequívoco.
**UI-083** — Las manos ajenas mostrarán únicamente el número de cartas, salvo reglas particulares.
**UI-084** — Al pulsar un héroe se abrirá: habilidad, usos disponibles, capacidades, efectos activos, historial relevante.
**UI-085** — Los usos limitados se mostrarán explícitamente: `Poder del héroe: 1/2 usos restantes`.

---

## 10. Horda y enemigos

**UI-090** — Los enemigos se mostrarán en una zona central claramente separada.
**UI-091** — Cada enemigo mostrará: nombre/identificador, fortaleza efectiva, heridas acumuladas, resistencia restante, estados, modificadores, indicación de jefe.
**UI-092** — Si la Fortaleza ha sido modificada, se mostrará el valor base y el efectivo: `Fortaleza: 4 → 3`.
**UI-093** — Las Heridas se mostrarán numéricamente, no solo con fichas gráficas.
**UI-094** — La contribución prevista al ataque de la Horda podrá mostrarse como información calculada: `Daño aportado: 2`.
**UI-095** — Los enemigos válidos como objetivo se destacarán.
**UI-096** — Los enemigos inválidos permanecerán visibles pero atenuados.
**UI-097** — Al pulsar un enemigo se mostrarán sus efectos completos.
**UI-098** — La recompensa trasera permanecerá oculta hasta su derrota.
**UI-099** — No deberá incluirse la recompensa en el HTML, estado del cliente o texto accesible de usuarios no autorizados antes de revelarla.

---

## 11. Mano del jugador

**UI-100** — La mano ocupará una zona estable en la parte inferior en escritorio y móvil.
**UI-101** — El usuario podrá: desplazarse horizontalmente, seleccionar una carta, ampliarla, jugarla, consultar reglas, cancelar la selección.
**UI-102** — Las cartas jugables se diferenciarán de las no jugables.
**UI-103** — Una carta no jugable mostrará el motivo: fase incorrecta, coste insuficiente, sin objetivos, capacidad incompatible, efecto ya utilizado, resolución bloqueada.
**UI-104** — La selección no deberá jugar automáticamente la carta. El usuario deberá: seleccionar carta, elegir objetivos/decisiones, confirmar cuando la acción tenga consecuencias importantes. Para acciones simples podrá existir confirmación rápida configurable.
**UI-105** — En móvil, mantener pulsada una carta deberá ampliarla sin jugarla.
**UI-106** — La carta seleccionada deberá elevarse visualmente y mostrar su nombre.
**UI-107** — Si una carta necesita varios objetivos, la interfaz indicará el progreso: `Objetivos seleccionados: 1 de 2`.
**UI-108** — El usuario podrá desmarcar objetivos antes de confirmar.

---

## 12. Cartas ampliadas

**UI-110** — La ampliación de carta mostrará: imagen, nombre, tipo, clase, valores, texto, explicación de palabras clave, estados actuales, fuente del efecto cuando sea relevante.
**UI-111** — Las cartas personalizadas mostrarán: autor, expansión, versión, estado de verificación, etiqueta "Personalizada".
**UI-112** — La ampliación no deberá revelar información privada a usuarios no autorizados.
**UI-113** — Desde la vista ampliada podrá consultarse "Cómo se resuelve", con descripción estructurada. Ejemplo: `1. Inflige 3 de daño. 2. Pierdes una carta. 3. Finaliza tu ataque.`

---

## 13. Acciones contextuales

**UI-120** — Las acciones principales aparecerán en una barra contextual.
- Durante Ataque: Enfrentarse, Evasión, Jugar carta, Finalizar ataque, Usar poder, Usar escenario.
- Durante Mercado: Comprar, Inspeccionar, Finalizar Mercado.
- Durante Restablecimiento: Seleccionar descartes, Confirmar.

**UI-121** — Solo una acción se considerará primaria en cada momento.
**UI-122** — Los botones peligrosos (abandonar partida) no compartirán posición ni estilo con acciones ordinarias.
**UI-123** — Toda acción enviada mostrará uno de estos estados: Pendiente, Confirmada, Rechazada, Reintentando, Sin conexión.
**UI-124** — No se mostrarán resultados definitivos antes de que el servidor confirme la acción online.

---

## 14. Elecciones intermedias

**UI-130** — Toda elección bloqueante aparecerá en un diálogo o panel inequívoco.
**UI-131** — El panel indicará: carta o regla que originó la elección, persona que debe responder, instrucción, opciones permitidas, selecciones mínimas y máximas, posibilidad de omitir, tiempo restante si existe.
**UI-132** — Las elecciones privadas no se mostrarán al resto de usuarios.
**UI-133** — Los demás jugadores verán: `Esperando una decisión de Alejandro.` Sin mostrar opciones privadas.
**UI-134** — Una reconexión deberá restaurar el mismo panel de decisión.
**UI-135** — Si no existe ninguna opción legal, la interfaz no deberá quedar bloqueada. El motor deberá omitir el efecto o aplicar la alternativa definida.

---

## 15. Mercado

**UI-140** — Las cartas de Mercado se mostrarán en una fila o cuadrícula diferenciada.
**UI-141** — Cada artículo mostrará: coste base, coste efectivo, ataque, capacidades, disponibilidad, efecto resumido.
**UI-142** — Los descuentos se mostrarán visualmente: `Coste: 5 → 4`.
**UI-143** — Una capacidad incompatible se indicará mediante icono y explicación.
**UI-144** — Una penalización se mostrará antes de comprar: `Puedes utilizar esta arma, pero causará 1 punto menos de daño.`
**UI-145** — Después de una compra, la reposición deberá animarse o indicarse sin retrasar innecesariamente el juego.
**UI-146** — El usuario podrá revisar las cartas compradas durante la fase antes de ajustar su mano.

---

## 16. Escenarios

**UI-150** — El escenario activo ocupará una posición visible estable.
**UI-151** — Mostrará: nombre, ilustración, efecto resumido, acción disponible, límite de uso, estado de activación.
**UI-152** — Si el escenario permite una acción, aparecerá un botón contextual: `Usar Portal de Ulthar`.
**UI-153** — Los modificadores activos del escenario aparecerán también en el resumen de efectos globales.
**UI-154** — Al cambiar de escenario se mostrará: escenario descartado, escenario revelado, modificadores eliminados, modificadores añadidos.
**UI-155** — No deberá dependerse de que el jugador recuerde el texto del escenario.

---

## 17. Ataque de la Horda

**UI-160** — Antes de resolver el ataque, podrá mostrarse un resumen calculado: enemigo A: 2, enemigo B: 3, enemigo C: anulado, daño base: 5, prevención: 2, daño final: 3.
**UI-161** — El resumen distinguirá: daño base, modificadores, prevención, redirección, pérdida final.
**UI-162** — El usuario podrá ampliar la explicación de cálculo.
**UI-163** — Las animaciones representarán el resultado confirmado, no decidirlo.
**UI-164** — La animación podrá omitirse o acelerarse.

---

## 18. Historial de acciones

**UI-170** — El historial será independiente del chat.
**UI-171** — Cada entrada mostrará: actor, acción, carta, objetivo, resultado, momento. Ejemplo: `Alejandro jugó Disparo certero contra Orco 3. Infligió 3 de daño. Orco 3 fue derrotado. Alejandro perdió 1 carta. El ataque finalizó.`
**UI-172** — El historial podrá filtrarse por: turno, jugador, cartas, daño, recursos, errores, chat del sistema.
**UI-173** — Los detalles técnicos estarán disponibles en modo avanzado: ID de comando, versión, semilla, eventos, modificadores.
**UI-174** — No se mostrará información que era privada en el momento del evento, salvo cuando posteriormente sea legal revelarla.

---

## 19. Chat

**UI-180** — El chat se mostrará en un panel lateral en escritorio.
**UI-181** — En móvil se abrirá como panel completo o pestaña.
**UI-182** — Habrá indicación de mensajes sin leer.
**UI-183** — Las notificaciones no ocultarán información crítica del juego.
**UI-184** — Se diferenciarán: mensajes de usuario, mensajes del sistema, avisos de conexión, moderación.
**UI-185** — Cada mensaje mostrará un menú contextual con: Silenciar, Bloquear, Denunciar, Copiar, Eliminar (cuando proceda).
**UI-186** — El usuario podrá ocultar el chat sin ocultar el historial de acciones.
**UI-187** — El campo de texto limitará la longitud y mostrará el número restante cuando se acerque al límite.
**UI-188** — El envío repetido o bloqueado ofrecerá una explicación.
**UI-189** — El chat no permitirá adjuntos en el MVP.

---

## 20. Estado de conexión y reconexión

**UI-190** — El estado de conexión se mostrará mediante: Conectado, Reconectando, Sin conexión, Sincronizando, Error.
**UI-191** — Durante una desconexión online se deshabilitarán las acciones que requieran servidor.
**UI-192** — Las acciones no confirmadas se identificarán claramente.
**UI-193** — Al reconectar se mostrará: `Conexión restaurada. Sincronizando la partida.`
**UI-194** — Si el estado cambió durante la ausencia, se ofrecerá un resumen: `Durante tu desconexión: - El jugador 2 terminó su ataque. - Se compró una carta. - Ahora es tu turno.`
**UI-195** — Una incompatibilidad de versión ofrecerá recargar el estado sin borrar datos locales.

---

## 21. Modo offline

**UI-200** — La interfaz indicará claramente que la partida es local.
**UI-201** — El guardado automático mostrará un indicador discreto: Guardando, Guardado, Error al guardar.
**UI-202** — En hot seat, al cambiar de turno deberá aparecer una pantalla de privacidad: `Turno de Lucía. Entrega el dispositivo a Lucía. [Mostrar mi mano]`.
**UI-203** — Antes de mostrar la mano siguiente se ocultará completamente la anterior.
**UI-204** — En control de varios héroes no se utilizará pantalla de privacidad, pero se indicará claramente el héroe activo.
**UI-205** — Si falta espacio de almacenamiento se avisará antes de seguir acumulando cambios sin persistencia.

---

## 22. Pantalla final

**UI-210** — La pantalla de resultados mostrará: ganador, gloria final, posiciones, huestes derrotadas, monedas obtenidas, cartas jugadas, heridas recibidas, duración, número de turnos, señor derrotado.
**UI-211** — Los empates se explicarán: `Alejandro y Lucía tienen 14 de Gloria. Se aplicó el criterio de desempate X.`
**UI-212** — Acciones disponibles: Ver historial, Ver estadísticas, Guardar repetición, Jugar de nuevo, Volver al inicio, Compartir resultado (sin información privada).

---

## 23. Tutorial y ayuda contextual

**UI-220** — La primera partida podrá utilizar un tutorial paso a paso.
**UI-221** — El tutorial explicará acciones en el momento en que se necesitan.
**UI-222** — El usuario podrá: Saltar, Volver, Repetir, Desactivar ayudas, Reactivarlas desde Ajustes.
**UI-223** — La ayuda contextual estará disponible mediante un botón de información.
**UI-224** — Las palabras clave de las cartas tendrán explicación rápida.
**UI-225** — El reglamento permitirá buscar por: concepto, carta, fase, recurso, ejemplo.
**UI-226** — Desde un error de reglas se podrá abrir directamente la sección relevante.

---

## 24. Biblioteca y colección

**UI-230** — El catálogo ofrecerá: vista de cuadrícula, vista de lista, buscador, filtros, ordenación, paginación o carga progresiva.
**UI-231** — Filtros mínimos: tipo, clase, edición, autor, estado, verificación, oficial o personalizada, expansión, coste, ataque, fortaleza.
**UI-232** — Cada tarjeta del catálogo mostrará: miniatura, nombre, tipo, clase, versión, estado, origen.
**UI-233** — Las cartas archivadas o no compatibles se indicarán sin desaparecer del historial.
**UI-234** — El usuario podrá seleccionar varias cartas para operaciones masivas: añadir a conjunto, exportar, archivar borradores, cambiar etiquetas.

---

## 25. Estudio de creación

### 25.1. Navegación del Estudio

**UI-240** — El Estudio utilizará navegación secundaria: Resumen, Héroes, Habilidades, Mazos, Huestes, Jefes, Mercado, Escenarios, Reglas, Conjuntos, Pruebas, Versiones.
**UI-241** — Las migas de pan mostrarán la jerarquía: `Proyecto > Héroes > Explorador > Disparo rápido`.
**UI-242** — El sistema mostrará permanentemente el estado de guardado.
**UI-243** — Se permitirá guardar borradores incompletos.
**UI-244** — Los errores que impidan publicar no impedirán guardar.

---

## 26. Editor de héroes

**UI-250** — La vista de una clase de héroe mostrará: identidad, variantes, biblioteca, mazos, capacidades, apariencia, pruebas, versiones.
**UI-251** — Las variantes se representarán como tarjetas dentro de la clase.
**UI-252** — El botón "Crear variante" no duplicará automáticamente la biblioteca, salvo que el usuario solicite una bifurcación.
**UI-253** — Crear una clase nueva utilizará un asistente: Identidad, Capacidades, Variante inicial, Biblioteca, Mazo, Apariencia, Validación.
**UI-254** — El usuario podrá duplicar: solo la identidad, identidad y variantes, biblioteca, mazos, clase completa.
**UI-255** — La interfaz explicará qué elementos serán compartidos y cuáles independientes.

---

## 27. Constructor de mazos

**UI-260** — En escritorio: distribución de dos paneles `Biblioteca disponible | Mazo actual`.
**UI-261** — En móvil: ambos paneles serán pestañas.
**UI-262** — Cada carta mostrará controles para: añadir copia, quitar copia, ver detalles, probar, editar (si existe permiso).
**UI-263** — El contador del mazo será permanente: `15/15 cartas`.
**UI-264** — Los errores se mostrarán en tiempo real: faltan cartas, demasiadas cartas, copias excesivas, clase incompatible, dependencia ausente, versión archivada.
**UI-265** — El mazo válido mostrará un indicador positivo, pero no dependerá solo del color.
**UI-266** — El usuario podrá filtrar la biblioteca por: coste, daño, efecto, etiqueta, tipo de objetivo, número de copias.
**UI-267** — El sistema evitará perder cambios al cambiar de mazo.

---

## 28. Editor de cartas

**UI-270** — El formulario cambiará según el tipo de carta.
**UI-271** — No se mostrarán campos irrelevantes. Una Habilidad no necesita recompensa oculta; una Hueste no necesita clase propietaria salvo ampliación expresa.
**UI-272** — Las secciones del formulario serán: Identidad, Valores, Reglas, Diseño, Texto, Fuentes, Pruebas, Versiones.
**UI-273** — Los campos obligatorios mostrarán su condición antes de intentar publicar.
**UI-274** — Los cambios actualizarán la vista previa cuando sea posible.
**UI-275** — La vista previa indicará si es aproximada o coincide con el render final.
**UI-276** — El editor permitirá alternar entre frontal y reverso.
**UI-277** — El desbordamiento de texto se mostrará como error visual.
**UI-278** — El usuario podrá elegir entre: reducir texto, disminuir fuente dentro de límites, cambiar plantilla, permitir otra página (si el tipo lo admite).

En escritorio: `Panel de edición | Previsualización de carta`. En móvil: `Contenido | Reglas | Diseño | Vista previa | Pruebas`.

---

## 29. Editor visual de reglas

**UI-280** — Las reglas se mostrarán como bloques ordenados verticalmente. Ejemplo: `1. Aplicar ataque impreso: 3 / 2. Perder 1 carta / 3. Finalizar fase de Ataque`.
**UI-281** — Los bloques podrán: añadirse, duplicarse, reordenarse, deshabilitarse en borrador, eliminarse, anidarse cuando sea necesario.
**UI-282** — Cada bloque tendrá un formulario tipado.
**UI-283** — No se utilizarán campos JSON libres como interfaz principal.
**UI-284** — Las condiciones se expresarán en lenguaje comprensible: `SI el enemigo fue derrotado por esta carta ENTONCES gana 1 moneda`.
**UI-285** — La interfaz mostrará visualmente la jerarquía de condiciones y repeticiones.
**UI-286** — Las referencias entre cartas utilizarán un selector, no escritura manual de ID.
**UI-287** — Las referencias rotas se señalarán directamente en el bloque afectado.
**UI-288** — El editor advertirá de: ciclos, repeticiones sin límite, elecciones sin opciones, modificadores sin duración, destinos imposibles, efectos desconocidos.
**UI-289** — El usuario podrá consultar una descripción técnica opcional de la regla generada.

---

## 30. Editor visual de la carta

**UI-300** — La carta se compondrá mediante capas controladas: fondo, marco, ilustración, nombre, valores, texto, iconos, identificador, marca de expansión.
**UI-301** — El MVP utilizará plantillas con regiones predefinidas.
**UI-302** — El usuario podrá cambiar: ilustración, escala, encuadre, posición dentro del área, marco, color, iconos, tipografía permitida.
**UI-303** — El usuario no podrá colocar accidentalmente elementos fuera del área imprimible.
**UI-304** — Se mostrarán guías de: sangrado, corte, área segura, centro.
**UI-305** — La exportación indicará resolución, dimensiones y formato.

---

## 31. Sandbox

**UI-310** — El sandbox deberá parecerse a la mesa real, pero incluir controles de prueba.
**UI-311** — Permitirá configurar: fase, jugador activo, mano, mazo, desgaste, recursos, héroes, enemigos, heridas, mercado, escenario, semilla.
**UI-312** — Tendrá controles: Ejecutar, Paso a paso, Pausar, Reiniciar, Deshacer, Rehacer, Cambiar semilla, Guardar caso.
**UI-313** — La interfaz mostrará lado a lado: `Estado anterior | Eventos | Estado posterior`.
**UI-314** — Los campos modificados se resaltarán.
**UI-315** — Una prueba fallida mostrará: resultado esperado, resultado real, evento donde comenzó la divergencia, regla implicada, versión.

---

## 32. Versionado y publicación

**UI-320** — El estado del contenido aparecerá siempre: Borrador, En revisión, Cambios solicitados, Aprobado, Publicado, Archivado, Bloqueado.
**UI-321** — Publicar abrirá un resumen con: cambios, pruebas, advertencias, dependencias, licencia, versión propuesta.
**UI-322** — Las diferencias entre versiones se mostrarán por categorías: valores, reglas, texto, diseño, imágenes, dependencias.
**UI-323** — No se mostrarán únicamente diferencias JSON. Se ofrecerá una explicación legible: `Ataque cambió de 2 a 3. El efecto de prevención cambió de 1 a 2. Se añadió una condición de uso.`
**UI-324** — La interfaz explicará que una versión publicada no puede modificarse.
**UI-325** — "Crear nueva versión" y "Crear variante independiente" serán acciones diferentes.

---

## 33. Importación de contenido

**UI-330** — La importación utilizará un asistente: Seleccionar archivo, Inspeccionar, Dependencias, Conflictos, Pruebas, Resumen, Instalar.
**UI-331** — Antes de instalar se mostrará: autor, licencia, versión, contenido, tamaño, dependencias, reglas utilizadas, permisos solicitados, advertencias.
**UI-332** — Las reglas desconocidas se mostrarán como errores concretos.
**UI-333** — Los conflictos se resolverán individualmente o mediante una política común: Actualizar, Mantener ambas, Bifurcar, Omitir, Cancelar.
**UI-334** — Una importación no se mostrará como publicada automáticamente.
**UI-335** — El usuario podrá abrir contenido importado en el sandbox antes de activarlo.

---

## 34. Extracción de cartas desde PDF

**UI-340** — El flujo permitirá: seleccionar PDF, escoger páginas, configurar cuadrícula, previsualizar recortes, ajustar márgenes, clasificar cartas, asociar frontal y reverso, revisar OCR, generar borradores.
**UI-341** — Los límites de cada carta podrán ajustarse visualmente.
**UI-342** — Se mostrarán números de página, fila, columna y posición.
**UI-343** — La asociación frontal y reverso tendrá una vista comparativa.
**UI-344** — El usuario podrá probar transformaciones: misma posición, inversión horizontal, inversión vertical, rotación de 180 grados.
**UI-345** — El OCR se presentará como sugerencia editable, nunca como dato confirmado automáticamente.
**UI-346** — Cada campo tendrá estado: Detectado, Revisado, Confirmado, Dudoso, No encontrado.

---

## 35. Estados vacíos, carga y errores

### 35.1. Estado vacío
**UI-350** — Una biblioteca vacía mostrará: qué contenido debería aparecer, cómo crear el primero, cómo importar, enlace a ayuda.

### 35.2. Carga
**UI-351** — Se utilizarán esqueletos de carga para catálogos.
**UI-352** — Los procesos largos mostrarán progreso real cuando sea posible.
**UI-353** — Las operaciones en segundo plano podrán minimizarse.

### 35.3. Errores
**UI-354** — Los errores se clasificarán: validación, conexión, permisos, compatibilidad, servidor, almacenamiento, contenido.
**UI-355** — Todo error recuperable ofrecerá una acción: Reintentar, Corregir, Volver, Guardar borrador, Descargar informe, Contactar con soporte.
**UI-356** — Los errores técnicos no mostrarán trazas internas al usuario normal.

---

## 36. Accesibilidad

**UI-360** — La aplicación web tendrá como objetivo WCAG 2.2 AA.
**UI-361** — Toda función principal podrá realizarse con teclado.
**UI-362** — El foco será visible.
**UI-363** — Los diálogos atraparán correctamente el foco y lo devolverán al cerrarse.
**UI-364** — Las cartas tendrán nombres accesibles completos.
**UI-365** — Los cambios importantes se anunciarán mediante regiones accesibles: cambio de turno, carta jugada, daño, elección requerida, desconexión, error.
**UI-366** — El arrastre tendrá alternativa mediante botones: Subir efecto, Bajar efecto, Mover al principio, Mover al final.
**UI-367** — Las animaciones podrán reducirse o desactivarse.
**UI-368** — Los temporizadores no dependerán únicamente de cambios de color.
**UI-369** — La interfaz admitirá zoom al 200 % sin pérdida funcional.

---

## 37. Diseño responsive

**UI-370** — No se reducirá simplemente la versión de escritorio.
**UI-371** — Las acciones principales permanecerán accesibles sin depender de gestos ocultos.
**UI-372** — El giro de pantalla no perderá selecciones ni formularios.
**UI-373** — La mesa funcionará en orientación vertical.
**UI-374** — La orientación horizontal podrá ofrecer una distribución ampliada.

Escritorio: mesa completa, mano inferior, chat lateral, historial lateral alternativo, paneles flotantes, editor dividido.
Tableta: mesa central, paneles desplegables, mano desplazable, chat superpuesto, editor por pestañas o doble panel.
Móvil: zona principal prioritaria, mano inferior, jugadores en carrusel, mercado y escenario en paneles, chat en pantalla independiente, acciones fijas al alcance del pulgar, cartas ampliadas a pantalla completa.

---

## 38. Animaciones y respuesta visual

**UI-380** — Las animaciones deberán explicar cambios: robar, jugar, mover a Desgaste, infligir daño, obtener recursos, derrotar enemigo, cambiar escenario.
**UI-381** — Las animaciones no retrasarán el siguiente paso más de lo necesario.
**UI-382** — Las animaciones largas podrán acelerarse.
**UI-383** — El estado final se aplicará aunque una animación se interrumpa.
**UI-384** — No se usarán destellos intensos o movimientos innecesarios.
**UI-385** — Las respuestas inmediatas del cliente indicarán selección, no confirmación definitiva online.

---

## 39. Sonido y notificaciones

**UI-390** — El sonido será opcional.
**UI-391** — Controles separados para: música, efectos, notificaciones, chat.
**UI-392** — Eventos importantes podrán tener sonido: inicio del turno, elección requerida, mensaje, reconexión, fin de partida.
**UI-393** — La información no dependerá del sonido.
**UI-394** — Las notificaciones del SO no mostrarán cartas privadas.

---

## 40. Requisitos de consistencia textual

**UI-400** — Terminología uniforme: Habilidad, Hueste, Señor de la Guerra, Desgaste, Gloria, Mercado, Herida, Fortaleza, Evasión.
**UI-401** — No se alternarán sin motivo términos como: Descartes y Desgaste, Vida y Heridas, Jefe y Señor de la Guerra, Jugador y héroe.
**UI-402** — Los botones utilizarán verbos claros: Jugar carta, Comprar, Finalizar ataque, Confirmar selección, Realizar Evasión.
**UI-403** — Los mensajes evitarán lenguaje técnico cuando exista una explicación comprensible.

---

## 41. Requisitos de UI para seguridad y privacidad

**UI-410** — Las manos privadas no deberán renderizarse fuera del contexto autorizado.
**UI-411** — El modo espectador tendrá una vista específica.
**UI-412** — Las capturas compartidas desde la aplicación advertirán si contienen información privada.
**UI-413** — Las contraseñas de sala no se mostrarán después de escribirlas.
**UI-414** — Las acciones administrativas se diferenciarán visualmente de las ordinarias.
**UI-415** — Bloquear, denunciar, abandonar y borrar requerirán confirmación proporcional a su impacto.

---

## 42. Requisitos de UI para moderación

**UI-420** — La denuncia podrá iniciarse desde el contenido o mensaje correspondiente.
**UI-421** — El formulario de denuncia incluirá: motivo, descripción opcional, elemento denunciado, evidencia asociada.
**UI-422** — El usuario recibirá confirmación sin prometer un resultado concreto.
**UI-423** — El panel de moderación separará: chat, contenido, usuarios, paquetes, derechos de autor.
**UI-424** — Toda acción de moderación mostrará alcance y duración antes de confirmarse.

---

## 43. Requisitos verificables de calidad visual

La interfaz deberá superar estas comprobaciones:
1. Ningún texto se corta al 200 % de zoom.
2. Ningún botón principal queda fuera de pantalla.
3. Una carta seleccionada se distingue sin depender del color.
4. El jugador activo se identifica inmediatamente.
5. La fase actual aparece sin abrir menús.
6. Los objetivos válidos se reconocen.
7. Las cartas privadas no aparecen en vistas ajenas.
8. El chat no cubre una elección pendiente.
9. Una desconexión no hace parecer que una acción fue confirmada.
10. El editor avisa del texto desbordado.
11. El constructor muestra continuamente el tamaño del mazo.
12. Toda acción destructiva tiene una redacción inequívoca.
13. El usuario puede completar una partida mediante teclado.
14. La experiencia sigue siendo funcional con animaciones desactivadas.
15. Los estados vacíos indican el siguiente paso.

---

## 44. Pruebas específicas de UI

**Pruebas de componentes**: Carta, Enemigo, Panel de héroe, Contador de recursos, Indicador de fase, Botón de acción, Diálogo de elección, Mensaje de chat, Bloque de regla, Tarjeta de versión.

**Pruebas de interacción**: Seleccionar una carta, Cambiar objetivo, Confirmar, Cancelar, Abrir detalle, Comprar, Descartar, Reconectar, Reordenar efectos, Crear mazo.

**Pruebas responsive** (resoluciones mínimas): Móvil estrecho, Móvil grande, Tableta vertical, Tableta horizontal, Portátil, Monitor de escritorio.

**Regresión visual** (capturas de referencia): Inicio, Sala, Mesa, Mano, Mercado, Chat, Resultados, Biblioteca, Editor, Sandbox, Importación.

**Accesibilidad**: Navegación completa con teclado, Lectura mediante lector de pantalla, Contraste, Orden de foco, Zoom, Animación reducida, Alternativa al arrastre.

---

## 45. Priorización para el MVP

### Must have
Inicio claro, Creación y continuación de partidas, Sala online, Mesa adaptable, Mano propia, Horda, Mercado, Escenario, Fase y turno visibles, Objetivos legales, Decisiones intermedias, Historial, Chat básico, Reconexión, Guardado offline, Biblioteca, Editor básico, Constructor de mazos, Sandbox, Estados de validación, Accesibilidad básica, Responsive web y móvil.

### Should have
Tutorial contextual, Comparación de versiones, Importación guiada, Extracción desde PDF, Animaciones configurables, Vista avanzada de cálculos, Hoja imprimible, Moderación básica.

### Could have
Personalización de temas, Editor libre de plantillas, Atajos configurables, Estadísticas visuales avanzadas, Espectadores, Repetición visual turno a turno, Perfiles públicos de creadores.

### Fuera del MVP
Chat de voz, Vídeo, Editor gráfico profesional, Animaciones tridimensionales, Marketplace, Personalización completa de toda la mesa, Moderación automática avanzada.

---

## 46. Criterios de aceptación de UI del MVP

La UI del MVP podrá considerarse finalizada cuando:
1. Un usuario nuevo puede crear una partida sin ayuda externa.
2. Puede identificar el jugador y la fase activos.
3. Puede jugar una carta y seleccionar objetivos.
4. Comprende por qué una acción está deshabilitada.
5. Puede consultar una carta sin jugarla accidentalmente.
6. Puede completar una partida desde móvil y escritorio.
7. Una persona desconectada comprende el estado de reconexión.
8. Las manos privadas no se muestran a otros participantes.
9. El chat puede ocultarse sin perder el historial de juego.
10. Una persona puede crear una clase, una variante y un mazo.
11. El editor detecta una regla incompleta.
12. El constructor detecta un mazo inválido.
13. Una versión puede compararse con la anterior.
14. Las funciones principales son utilizables con teclado.
15. La interfaz funciona al 200 % de zoom.
16. Los textos no se solapan.
17. Las acciones destructivas no pueden pulsarse accidentalmente.
18. El estado offline se distingue del online.
19. El guardado y sincronización tienen indicadores visibles.
20. Los recorridos críticos superan las pruebas E2E.

---

## Conclusión

La interfaz se organizará alrededor de cuatro contextos diferenciados:
- **JUGAR**: Mesa, mano, Horda, Mercado, escenarios y decisiones.
- **COMUNICARSE**: Sala, presencia, chat, desconexiones e invitaciones.
- **CREAR**: Héroes, habilidades, mazos, cartas, reglas y diseño.
- **GESTIONAR**: Catálogo, versiones, conjuntos, importaciones y publicaciones.

Prioridad visual durante una partida: `Qué está ocurriendo → qué debe hacer el usuario → qué opciones son válidas → qué resultado produjo su acción`.

Prioridad en el Estudio: `Qué elemento está editando → qué cambios ha realizado → qué errores existen → cómo se verá → cómo se comportará → si está preparado para publicarse`.

---

## Recuento de requisitos

- Principios generales: 7 (UI-P01..P07)
- Requisitos numerados: 285 (UI-001..UI-424, con saltos por secciones)
- **Total**: 292 requisitos verificables
