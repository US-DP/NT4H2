/**
 * rules — contenido del reglamento oficial de No Time for Heroes.
 *
 * Extraído y estructurado fielmente desde los PDFs oficiales:
 *   - manual-no-time-for-heroes-es.pdf (Libro de Reglas, 8 págs.)
 *   - nt4h-modo-solitario.pdf (3 págs.)
 *   - nt4h-multiclase-reglas.pdf (2 págs.)
 * (c) Holocubierta Ediciones S.L., 2015.
 *
 * Cada sección usa Markdown: párrafos, listas, notas (*...*) y ejemplos.
 */

export interface RuleSection {
  id: string;
  /** Categoría para la navegación por pestañas */
  category: 'base' | 'solo' | 'multiclass';
  title: string;
  /** Cuerpo en Markdown */
  body: string;
  keywords: string[];
}

export const RULES: RuleSection[] = [
  // ==================== REGLAS BASE ====================
  {
    id: 'intro',
    category: 'base',
    title: 'Hace mucho tiempo...',
    body: `El Reino de **Isilendor** está en peligro. El ataque de Krantor y sus hordas es inminente, y los defensores de la humanidad tendrán que demostrar su valía una vez más... La guardia de la ciudad comienza a prepararse para el ataque, pero la supervivencia depende de una misión en tierra hostil: algunos héroes irán más allá de las líneas enemigas para interceptar a uno de los más importantes generales de Krantor y acabar con él.

En **No Time for Heroes** encarnas a un héroe (**Mago, Pícaro, Guerrero o Explorador**) que junto con sus compañeros se enfrenta a una horda de enemigos en una batalla sin cuartel.

Los héroes de este juego no combatirán solo para acabar con el enemigo, sino también para obtener **gloria personal** que les permita lograr el favor de **Los Siete**, los soberanos de Isilendor, que gobiernan desde su castillo en Amaarent.

Para vencer en batalla cada héroe dispondrá de una serie de habilidades únicas, ¡pero cuidado!, el uso de estas, y los furibundos ataques de los enemigos, irán desgastándolos hasta dejarlos fuera de combate… Mide bien tus fuerzas, escoge tus batallas y álzate con la victoria.`,
    keywords: ['historia', 'isilendor', 'krantor', 'héroe', 'mago', 'pícaro', 'guerrero', 'explorador', 'gloria', 'los siete', 'amaarent'],
  },
  {
    id: 'card-types',
    category: 'base',
    title: 'Tipos de cartas',
    body: `**Cartas de Héroe**

*Cada carta de Héroe posee dos caras; cada jugador debe escoger cuál de los dos héroes que hay en la carta empleará durante la partida.* Contienen: habilidad especial (Pericia), iconos de capacidad y puntos de vida.

**Cartas de Habilidad**

Contienen: valor de ataque, icono de clase y efecto de la carta.

**Carta de Escenario**

Establece condiciones especiales de juego.

**Cartas de Horda**

Contienen: valor de ataque, gloria y condiciones especiales. Divididas en **Huestes** y el **Señor de la Guerra**. Nuevos enemigos llegan al campo de batalla desde su mazo.

**Cartas de Mercado**

Contienen: coste, efecto de la carta y restricciones, e iconos de capacidades necesarias para su uso.`,
    keywords: ['carta', 'héroe', 'habilidad', 'escenario', 'horda', 'hueste', 'señor de la guerra', 'mercado', 'tipo'],
  },
  {
    id: 'setup-horde',
    category: 'base',
    title: 'Preparación — Reuniendo la Horda',
    body: `El mazo de enemigos está compuesto por un determinado número de cartas; para construirlo deben seguirse los siguientes pasos:

1. **El Señor de la Guerra**: escoge al azar uno de los Señores disponibles.
2. **Las Huestes**: baraja todas las cartas de Huestes y haz un mazo con ellas. El número de cartas que compondrá el mazo dependerá del número de jugadores:
   - 4 jugadores: **27** cartas.
   - 3 jugadores: **23** cartas.
   - 2 jugadores: **19** cartas.
3. **La Horda**: baraja las Huestes y coloca el mazo sobre la mesa con la parte trasera mirando hacia abajo. Una vez hecho esto, coloca la carta de Señor de la Guerra sobre el montón, dejando hacia arriba (visible) la parte trasera. El mazo de la Horda está listo para ser utilizado: de aquí saldrán los enemigos a los que los Héroes deberán enfrentarse.

*Durante el juego, las cartas de la Horda deberán robarse de la **parte inferior** del mazo, siendo visible solo el frontal de la carta.*`,
    keywords: ['horda', 'mazo', 'huestes', 'señor de la guerra', 'preparación', 'jugadores', '27', '23', '19'],
  },
  {
    id: 'setup-heroes',
    category: 'base',
    title: 'Preparación — Agrupando a los Héroes',
    body: `Cada jugador realiza los siguientes pasos:

1. Coge una carta de Héroe y elige cuál de los dos héroes incluidos en ella utilizará durante la partida.
2. Coge el mazo de Habilidades correspondiente a su Héroe, lo baraja y lo sitúa cerca, dejando un espacio para la pila de **Desgaste**.
3. Roba **4 cartas** del mazo de Habilidades; esta será su mano inicial.`,
    keywords: ['héroe', 'mazo', 'habilidades', 'desgaste', 'mano inicial', 'preparación'],
  },
  {
    id: 'setup-market-scenario',
    category: 'base',
    title: 'Preparación — Tiendas, región y la Horda se aproxima',
    body: `**Instalando las tiendas**: se barajan las cartas de Mercado y se colocan **5 cartas boca arriba**, situando junto a ellas la reserva de Monedas y de Gloria.

**Cartografiando la región (opcional)**: se barajan las cartas de Escenario y se sitúa a la vista de todos la primera carta del mazo resultante.

**La Horda se aproxima**: se roban **3 cartas** de la parte inferior del mazo de la Horda y se colocan en el centro de la mesa boca arriba.

*¡Ten cuidado! El reverso de la carta debe permanecer oculto: la recompensa que acompaña a cada enemigo es secreta hasta que sea derrotado.*`,
    keywords: ['mercado', 'tiendas', 'escenario', 'horda', 'monedas', 'gloria', 'recompensa'],
  },
  {
    id: 'setup-leader',
    category: 'base',
    title: 'Preparación — Escogiendo al Líder',
    body: `El **Líder** (jugador inicial) se decidirá mediante una **puja** con las cartas de Habilidad.

Cada jugador escoge **una o dos cartas** de su mano y la/s sitúa boca abajo en el centro de la mesa; una vez estén todas, se muestran y comparan sus valores de **Daño** (sumándolos en caso de haber jugado dos cartas).

El jugador que haya pujado con más valor de Daño será el que comience a jugar. **En caso de empate, comenzará el jugador de más edad.**

Una vez elegido el Líder, todas las cartas empleadas en la puja se sitúan en el fondo de sus respectivos mazos de Habilidades, y cada jugador roba cartas hasta tener **4** en su mano.`,
    keywords: ['líder', 'puja', 'jugador inicial', 'daño', 'empate', 'edad'],
  },
  {
    id: 'damage-wounds',
    category: 'base',
    title: 'Heridas y Desgaste',
    body: `Los **Daños sufridos por los Héroes** se contabilizan **Perdiendo cartas**, esto es, poniendo las cartas de la parte superior del mazo de Habilidades en la pila de Desgaste.

Cuando el mazo de Habilidades no tenga más cartas y sea necesario seguir robando o Perdiendo, el jugador tendrá que:

1. Poner **una Herida** sobre su carta de Héroe.
2. Barajar las cartas en su pila de Desgaste y crear con ellas un nuevo mazo de Habilidades.
3. Perder o robar las cartas que quedaron pendientes.`,
    keywords: ['daño', 'herida', 'desgaste', 'perder cartas', 'barajar', 'mazo'],
  },
  {
    id: 'turn-phases',
    category: 'base',
    title: 'En el fragor de la batalla — Las 3 fases',
    body: `Los jugadores deberán realizar sus turnos en **sentido horario**, comenzando con el Líder. El turno se compondrá de las siguientes **3 fases**:

1. **Ataque**
2. **Mercado**
3. **Restablecimiento**

Cuando un jugador termina su turno, este pasa al jugador sentado a su izquierda. La partida continúa de esta manera hasta que aparezca el **Señor de la Guerra**, ¡el enfrentamiento final!

Cuando todos los enemigos son derrotados, la partida se da por concluida: cada jugador cuenta la Gloria obtenida y aquel que más haya conseguido es declarado vencedor.`,
    keywords: ['turno', 'fases', 'ataque', 'mercado', 'restablecimiento', 'sentido horario'],
  },
  {
    id: 'attack-phase',
    category: 'base',
    title: 'Fase de Ataque — Enfrentarse a la Horda',
    body: `El jugador podrá escoger entre dos opciones: **Enfrentarse a la Horda** (tras lo cual recibirá el Ataque de la Horda) o realizar una maniobra de **Evasión**.

**Enfrentarse a la Horda**: los héroes utilizarán sus Habilidades para derrotar a la Horda. Cada jugador podrá, durante su turno, utilizar **tantas cartas de Habilidad de su mano como desee**. Cada carta empleada debe resolverse por completo y descartarse en la pila de Desgaste antes de utilizar la siguiente. Cuando el jugador termine de jugar cartas, el Héroe recibirá el envite de los enemigos que todavía queden en pie.

**Procedimiento:**

1. **Muestra una carta de Habilidad.**
   a. **Aplica su Daño** (si lo tuviera): el jugador decide cuál de los enemigos recibirá el daño indicado. El daño **NO puede repartirse** entre dos o más cartas de Hueste. Si la carta no posee valor de daño, salta este paso.
   b. **Resuelve sus Efectos**: aplica, de arriba a abajo, todos los efectos que contenga la carta.
   c. **Descártala**: deja la carta en la pila de Desgaste.
2. Muestra una nueva carta y repite los tres pasos, o termina el enfrentamiento y resuelve el **Ataque de la Horda**.

*Cuando un enemigo recibe daño se sitúan sobre su carta tantas fichas de **Herida** como Daño haya recibido. Si las Heridas igualan o superan la **Fortaleza** del enemigo, este será derrotado.*

*Cada vez que un enemigo sea derrotado, el jugador que lo eliminó recogerá la carta de Hueste como **trofeo**; además, recibirá el **botín** (Monedas y/o Gloria) indicado en su parte trasera.*

*Algunas cartas previenen al Héroe de recibir cierta cantidad de daño. Para recordarlo se emplean las **Fichas de Escudo**.*

*Si alguna carta posee un efecto que contradice alguno de estos pasos, deberá resolverse atendiendo a lo que indica la carta.*`,
    keywords: ['ataque', 'horda', 'daño', 'efectos', 'desgaste', 'herida', 'fortaleza', 'trofeo', 'botín', 'escudo'],
  },
  {
    id: 'evasion',
    category: 'base',
    title: 'Fase de Ataque — Maniobra de Evasión',
    body: `Los jugadores pueden optar por esta acción. Con ella, el Héroe tratará de buscar una posición de ventaja sobre sus enemigos, aprovechando el apoyo de sus compañeros.

Cuando el Héroe realice esta maniobra **descarta su Ficha de Evasión**. Gracias a ello **NO recibirá daño este turno**, pero tendrá que **descartar un mínimo de 2 cartas** de su mano en la Pila de Desgaste.

*Esta maniobra implica que el Héroe no se enfrenta a la Horda este turno, por lo que **no podrá jugar ninguna carta de Habilidad** de su mano.*`,
    keywords: ['evasión', 'maniobra', 'ficha', 'descartar', '2 cartas'],
  },
  {
    id: 'horde-attack',
    category: 'base',
    title: 'Fase de Ataque — La Horda responde',
    body: `**Ataque de la Horda**: tras recibir la acometida de los Héroes, ¡es el turno de devolver el golpe!

El jugador deberá **Perder tantas cartas como la Fortaleza de todas las cartas de Horda** que queden todavía en la mesa, **restando las Heridas** que tengan dichos enemigos. Para ello, descartará el número indicado de cartas de la parte superior de su mazo de Habilidad a la pila de Desgaste.

*En caso de que el Héroe utilizara su maniobra de **Evasión**, ignorará todo el daño que la Horda provoque este turno.*

**Ejemplo:** al final del turno de Valerys, sobre la mesa quedan dos orcos. Uno tiene 3 puntos de Fortaleza intactos. El otro tiene 4 puntos de Fortaleza, pero ha recibido dos heridas. Valerys debe descartar **5 cartas**: 3 por la fortaleza del primero + 4 por la del segundo − 2 heridas que tiene este último.`,
    keywords: ['ataque de la horda', 'fortaleza', 'heridas', 'perder cartas', 'daño', 'ejemplo'],
  },
  {
    id: 'market-phase',
    category: 'base',
    title: 'Fase de Mercado',
    body: `En esta fase los jugadores podrán **comprar una o más cartas del mercado** con las Monedas conseguidas hasta el momento.

Cuando un jugador compra una carta de Mercado **la pone en su mano**. Estas cartas se emplearán como si se tratara de una nueva carta de Habilidad: aplicando su daño, resolviendo sus efectos y descartándolas en la pila de Desgaste, como se indicó en la Fase de Ataque.

*La **poción de curación** funciona de forma ligeramente diferente: como indica su símbolo, debe **retirarse del juego** tras ser usada, por lo que no se descarta en la pila de Desgaste.*

Siempre que se adquiera una carta del Mercado se repondrá con otra nueva: **el Mercado siempre debe tener 5 cartas disponibles** para su compra (mientras queden cartas en el mazo de Mercado).

**Iconos de capacidad**: algunas cartas de mercado son específicas para héroes con ciertas capacidades y estarán marcadas con los iconos apropiados:

- **Melee**
- **A distancia**
- **Pericia**
- **Magia**`,
    keywords: ['mercado', 'comprar', 'monedas', 'poción', 'curación', 'reponer', 'iconos', 'melee', 'distancia', 'pericia', 'magia'],
  },
  {
    id: 'market-restrictions',
    category: 'base',
    title: 'Fase de Mercado — Restricciones y penalizaciones',
    body: `Antes de adquirir la carta de Mercado, el Héroe debe comprobar que **no tiene restricciones**, o que **posee el Icono apropiado**; de lo contrario no podrá comprarla.

Si posee el Icono pero tiene una **penalización asociada** a él, tendrá que tener en cuenta que, cuando la utilice, el **Daño de la carta (y solo el Daño) se verá reducido** en la cantidad indicada, dado que no se trata de una especialidad del Héroe.

*De esta manera, los Pícaros podrán utilizar armas a distancia pero deberán restar 1 del daño de la carta.*

*No se aplicará esta penalización si Héroe y Objeto comparten **otro** símbolo de capacidad sin penalización.*`,
    keywords: ['restricciones', 'penalización', 'icono', 'capacidad', 'pícaro', 'daño reducido'],
  },
  {
    id: 'recovery-phase',
    category: 'base',
    title: 'Fase de Restablecimiento',
    body: `Este es el momento de restablecerse y preparar la mesa para el siguiente jugador:

**En primer lugar**, el jugador comprueba cuántas cartas tiene en la mano y **roba de su mazo de Habilidades o se descarta** en su pila de Desgaste, hasta tener **4 cartas** en su mano.

*En caso de haber comprado alguna carta en el Mercado, estas van directamente a la mano.*

**En segundo lugar**, comprueba cuántos enemigos quedan en la mesa:

- **Si no queda ninguno**: roba **3 nuevos enemigos** de la parte inferior del mazo de la Horda. *Si se están utilizando los escenarios, descarta el escenario actual y muestra uno nuevo que estará activo a partir de ahora.*
- **Si quedan 3 enemigos**: no se roban nuevas cartas.
- **Si quedan 1 o 2 enemigos**: roba **una carta** del mazo de Horda.

Durante esta fase aparecen nuevos enemigos en el campo de batalla. A medida que la partida avanza, el mazo de la Horda irá reduciendo su número hasta que sea el momento de robar la última carta: ¡el Señor de la Guerra!`,
    keywords: ['restablecimiento', 'mano', '4 cartas', 'enemigos', 'escenario', 'reponer', 'robar'],
  },
  {
    id: 'warlord',
    category: 'base',
    title: '¡Llega el Señor de la Guerra!',
    body: `Cuando el **Señor de la Guerra** entra en el campo de batalla, el juego continúa de la forma normal.

La carta del Señor de la Guerra es similar a la del resto de enemigos, con la salvedad de que **posee una Pericia** y **no concede Puntos de Victoria fijos**. Cada carta de Habilidad empleada por un jugador que cause **uno o más Daños** al Señor de la Guerra otorga **1 punto de Gloria** a dicho jugador.`,
    keywords: ['señor de la guerra', 'pericia', 'gloria', 'enfrentamiento final'],
  },
  {
    id: 'end-game',
    category: 'base',
    title: 'Fin de la partida — Cómputo de Gloria',
    body: `Cuando ningún enemigo queda en pie, la batalla se da por terminada. Al final de la partida cada jugador contabiliza la **Gloria** que ha acumulado. Para ello se suma lo siguiente:

- **Fichas de Gloria**.
- **Valor de Gloria de los enemigos abatidos**: cada carta de Hueste tiene un valor de Gloria asociado.
- **Monedas**: por cada **3 Monedas** se obtiene 1 punto de Gloria.

**Tenaz**: cada Héroe que logre llegar al final de la partida **sin heridas** conseguirá **1 punto de Gloria adicional**.

El jugador con más Gloria será el ganador, ¡alzándose con el favor de Los Siete!

*En caso de empate, ganará el jugador con más número de cartas de enemigos derrotados.*`,
    keywords: ['fin', 'gloria', 'puntos', 'monedas', 'tenaz', 'empate', 'ganador', 'victoria'],
  },
  {
    id: 'hero-feats',
    category: 'base',
    title: 'Pericias de los Héroes',
    body: `Cada carta de Héroe tiene una **capacidad exclusiva** de ese personaje, que tendrá **uno o dos usos por partida**. Las únicas limitaciones para su uso son las establecidas en el texto que las definen.

Si se trata de una Pericia con **dos usos**, pondremos la carta **en horizontal** cuando gastemos el primero. Cuando hayamos agotado el último (o único) uso, colocaremos la carta de héroe **cabeza abajo** para recordar que ya no disponemos de su Pericia.`,
    keywords: ['pericia', 'héroe', 'usos', 'horizontal', 'cabeza abajo', 'capacidad exclusiva'],
  },
  {
    id: 'scenarios',
    category: 'base',
    title: 'El Escenario (uso opcional)',
    body: `*Estas cartas, a pesar de no ser necesarias para jugar a No Time for Heroes, introducen un componente temático que hace el juego aún más divertido con cada nueva partida. Siéntete libre de agregarlas a tus partidas cuando lo creas conveniente.*

Nada más comenzar la partida habrá **una carta de Escenario activa**. Sus efectos y condiciones se aplicarán a lo largo de los turnos hasta que sea sustituida por una nueva carta de Escenario, que se robará de su mazo.

Esto sucederá **cada vez que durante la fase de Restablecimiento el campo de batalla esté vacío** y sea necesario robar 3 nuevas cartas del mazo de la Horda.

**Cuando el Señor de la Guerra entre al campo de batalla, la carta de Escenario será descartada y no se sustituirá por ninguna otra.**`,
    keywords: ['escenario', 'opcional', 'efectos', 'restablecimiento', 'señor de la guerra', 'descartar'],
  },
  {
    id: 'enemy-icons',
    category: 'base',
    title: 'Las señales del enemigo (Iconos)',
    body: `Los iconos sobre las cartas de enemigo y de habilidad señalan reglas especiales:

- **Icono de regeneración**: al final de la fase de Restablecimiento, descarta todas las Heridas que queden sobre los enemigos con este icono.
- **Icono de uso único**: las cartas de Habilidad y Mercado marcadas con este icono se deberán **retirar del juego** una vez utilizadas; solo podrán usarse una vez por partida.
- **Icono de resistencia a la Magia**: el enemigo marcado con este icono provoca menos Daño a los personajes con la capacidad "Magia": **resta el valor indicado** en el icono de la Fortaleza del enemigo al calcular el daño que produce.
- **Icono de botín**: estos enemigos tienen más probabilidades de tener un suculento botín.`,
    keywords: ['iconos', 'regeneración', 'uso único', 'magia', 'resistencia', 'botín', 'señales'],
  },
  {
    id: 'glossary',
    category: 'base',
    title: 'El lenguaje de la guerra (Glosario)',
    body: `**Daño**: los héroes acusarán el daño descartando ese mismo número de cartas de su mazo de Habilidades a la pila de Desgaste.

**Finaliza el ataque**: al resolver este efecto, se termina el Enfrentamiento con la Horda; no podrán jugarse más cartas de Habilidad y se pasa directamente al Ataque de la Horda.

**Heridas**: las heridas se contabilizarán situando Fichas de Herida sobre el personaje afectado. Los enemigos recibirán heridas debido a los ataques de los Héroes. Los Héroes recibirán **1 herida cada vez que tengan que barajar su pila de Desgaste** para formar un nuevo mazo de Habilidad.

**Perder (cartas)**: cuando en alguna carta se habla de la pérdida de una o más cartas, el jugador que la juegue deberá descartar ese número de cartas de su mazo de Habilidades a la Pila de Desgaste. **NUNCA se "perderán" cartas de la mano.**

**Recuperar (cartas)**: la acción de recuperar cartas se llevará a cabo colocando el número de cartas indicado de la **parte inferior de la pila de Desgaste** en la parte inferior del mazo de Habilidades. En algunos casos se pedirá "Recuperar" una carta en concreto (de la mano, por ejemplo), en cuyo caso será esa carta la que colocaremos en la parte inferior del mazo.

**Una vez por turno**: cuando una carta indica que su efecto se realiza "una vez por turno", quiere decir que aunque se utilicen varias cartas iguales, solo se ejecutará el efecto con la primera de ellas.`,
    keywords: ['glosario', 'daño', 'finaliza el ataque', 'heridas', 'perder', 'recuperar', 'una vez por turno'],
  },
  {
    id: 'credits',
    category: 'base',
    title: 'Créditos',
    body: `**Dirección Editorial**: Ismael De Felipe, Rodrigo González y Juan Emilio Herranz
**Diseño**: Rodrigo González
**Ilustraciones y diseño gráfico**: Israel Pato
**Maquetación del manual y caja**: Francisco Solier
**Manual de Instrucciones**: Rodrigo González y Juan Emilio Herranz
**Editorial**: Holocubierta Ediciones S.L.

Holocubierta Ediciones S.L. — Copyright 2015 — Todos los derechos reservados`,
    keywords: ['créditos', 'holocubierta', 'autor', 'editorial'],
  },

  // ==================== MODO SOLITARIO ====================
  {
    id: 'solo-intro',
    category: 'solo',
    title: 'Introducción al modo solitario',
    body: `En este modo **un solo jugador** se enfrentará a las tropas de Krantor. Esto no significa que el héroe esté solo, pues podrá obtener el **apoyo del resto de héroes** durante las batallas.

A continuación encontrarás todos los cambios y variaciones con respecto a las reglas originales de No Time for Heroes.`,
    keywords: ['solitario', 'un jugador', 'apoyos'],
  },
  {
    id: 'solo-setup',
    category: 'solo',
    title: 'Solitario — Preparación',
    body: `**Reuniendo a la Horda**: retira del mazo todas las cartas de Hueste con **valor de fortaleza 2** y baraja el resto (22). Añade al Señor de la Guerra de la forma habitual.

**Agrupando a los Héroes**:
1. Escoge una carta de Héroe — ten presente que **las habilidades del mismo no se utilizarán** en este modo. Coge **6 monedas de oro**.
2. Coge el mazo de habilidad del héroe seleccionado.
3. Roba las **4 cartas** que serán tu mano inicial.

**Instalando las tiendas**: escoge **5 cartas de Mercado, las que quieras**, pero máximo 1 copia de cada. *¡En este modo las cartas compradas **no se reponen**! ¡Escoge sabiamente!*

**Cartografiando la región**: extrae del mazo de Escenario **"Lágrimas de Aradiel"** y **"Yermo de Cemenmar"** — no serán parte del juego. Baraja el mazo de Escenarios, revela uno y sitúa **1 moneda de oro sobre él**.

**La Horda se aproxima**: roba 3 cartas y ponlas en el Campo de Batalla de la forma habitual. Ahora tienes la posibilidad de **descartar hasta 2 cartas** de tu mano y robar ese mismo número. Luego **recupera** (sitúa en el fondo del mazo de habilidades) las dos cartas descartadas.`,
    keywords: ['solitario', 'preparación', 'huestes', 'fortaleza 2', '6 monedas', 'mercado', 'lágrimas de aradiel', 'yermo de cemenmar'],
  },
  {
    id: 'solo-allies',
    category: 'solo',
    title: 'Solitario — Reuniendo aliados',
    body: `Es el momento de escoger los **apoyos** que te respaldarán durante esta dura misión. Cada apoyo permitirá recurrir a cartas de otros mazos de Habilidad durante la partida.

- El primer mazo de Apoyo costará **3 monedas de oro**.
- El apoyo de otro Héroe adicional: **+2 monedas**.
- El apoyo de los 3 héroes: **+1 moneda extra**.

*Ej: el jugador, que escogió el Guerrero, decide que quiere el apoyo del Mago y el Pícaro, por lo que paga 5 monedas de sus fondos iniciales.*

Los mazos de habilidad de los héroes por los que haya pagado permanecerán boca abajo en el área de juego (frente al Mercado) durante la partida.

*NOTA: las cartas de Héroe no se utilizarán pero pueden servir, situadas al lado de cada mazo, para recordar a quién pertenece cada uno.*`,
    keywords: ['solitario', 'apoyos', 'aliados', 'monedas', 'mazo de apoyo'],
  },
  {
    id: 'solo-support',
    category: 'solo',
    title: 'Solitario — Apoyos en la Fase de Ataque',
    body: `Esta fase se desarrolla de forma normal, salvo por la posibilidad de **solicitar Apoyos una vez por turno**.

En cualquier momento de esta fase, puedes escoger **un mazo (y solo uno) de Apoyo** para robar cartas de él:

- **2 puntos de Gloria** (fichas) o **5 monedas** por robar 1 carta.
- **+1 Punto de Gloria** adicional o **+2 monedas** por cada carta adicional que desees robar.

Entre las cartas robadas **elige una** para utilizarla durante el turno actual, de forma normal, como si perteneciera a tu propio mazo. Una vez aplicada, **devuelve la carta al fondo de su mazo**. Puedes decidir no usar la carta de Apoyo, de forma que se descarta al final del turno.

*NOTA: cuando una carta de apoyo se refiera a la pérdida, recuperación o robo de cartas, el jugador deberá aplicarlo sobre **su propio mazo**, no sobre el de apoyo (ver Excepciones).*`,
    keywords: ['solitario', 'apoyo', 'fase de ataque', 'robar', 'gloria', 'monedas'],
  },
  {
    id: 'solo-market-scenario',
    category: 'solo',
    title: 'Solitario — Mercado y Escenarios',
    body: `**Fase de Mercado**: se desarrolla igual que en el modo normal, salvo que **no se repondrán cartas** tras adquirir una de las disponibles.

**Fase de Restablecimiento**: en el caso de tener que cambiar de escenario (cuando se han eliminado todos los enemigos en el campo de batalla), descarta el escenario activo, **coge la moneda de oro** que había sobre él y coloca un nuevo escenario, con otra moneda de oro sobre él.

*NOTA: al finalizar la partida, tras limpiar el campo de batalla por completo, recoge la moneda de oro sobre el último escenario.*`,
    keywords: ['solitario', 'mercado', 'escenario', 'moneda', 'restablecimiento'],
  },
  {
    id: 'solo-end',
    category: 'solo',
    title: 'Solitario — Fin del juego y puntuación',
    body: `El objetivo del juego solitario es **terminar con todos los enemigos antes de recibir tantas heridas como vida tenga tu Héroe** (en cuyo caso quedas eliminado). Con esto, podrás considerarte un héroe "a la altura".

Aún así, al final de tu partida podrás comprobar hasta qué punto has conseguido triunfar en la contienda. Contabiliza los puntos sumando:

- **+1 punto** por cada carta sobrante en tu mano y en el mazo de habilidades.
- **+1 punto** por cada **2 puntos de Gloria** (solo fichas) que atesores al finalizar la partida.
- **+1 punto** por cada **5 monedas** de oro.
- Por cada **herida sin recibir**, tantos puntos como cartas tenga tu mazo de habilidades al final de la partida.`,
    keywords: ['solitario', 'fin', 'puntuación', 'heridas', 'gloria', 'monedas', 'objetivo'],
  },
  {
    id: 'solo-titles',
    category: 'solo',
    title: 'Solitario — Reconocimiento',
    body: `Si llegaste con vida al final de la batalla, mereces un reconocimiento. Este título acompañará a tu nombre mientras el reino de Isilendor siga en pie:

- **Cazador audaz**: entre 1 y 10 puntos
- **Guardián de los justos**: entre 11 y 20 puntos
- **Terror de la Horda**: entre 21 y 40
- **Caudillo de Isilendor**: 41 o más puntos`,
    keywords: ['solitario', 'reconocimiento', 'título', 'cazador audaz', 'guardián', 'terror de la horda', 'caudillo'],
  },
  {
    id: 'solo-exceptions',
    category: 'solo',
    title: 'Solitario — Excepciones',
    body: `**Excepciones generales**:

- Las cartas de Mercado que utilices desde tu mano **no podrán aplicarse a cartas de Apoyo** si el héroe al que pertenecen no cuenta con las capacidades (Melee, A distancia, Pericia o Magia) necesarias para utilizar dicha carta. *(Ej: la carta "Piedra de Amolar" no añadirá su +1 al daño a las cartas de apoyo que vengan del mazo del Mago/a.)*

**Excepciones en cartas**:

- Las cartas de Habilidad que causen daño al resto de héroes **solo lo harán cuando se usen desde el mazo de Apoyo**.
- Las cartas de Habilidad que permitan **Recuperar** cartas al resto de héroes **solo lo harán cuando se usen desde el mazo de Apoyo**.
- La carta **Robar Bolsillos** del Pícaro/a permitirá al jugador robar **1 moneda de oro de la reserva**.
- Las cartas **Disparo Rápido** del Explorador provocarán el robo de cartas del propio mazo de habilidad del arquero, aún cuando actúe como mazo de Apoyo.
- El efecto del escenario **Lodazal de Kalern** lo resolverá el propio jugador.

*Estas secciones podrán sufrir variaciones en futuras versiones de este modo de juego.*`,
    keywords: ['solitario', 'excepciones', 'robar bolsillos', 'disparo rápido', 'lodazal de kalern', 'piedra de amolar'],
  },

  // ==================== MODO MULTICLASE ====================
  {
    id: 'multi-intro',
    category: 'multiclass',
    title: 'Multiclase — Creación de Personaje',
    body: `En este modo debes **elegir dos clases**: Mago, Guerrero, Explorador o Pícaro. A partir de ellas crearás un nuevo personaje único con un mazo de habilidades hecho a tu medida (por ejemplo: Mago-Guerrero o Pícaro-Arquero).

El juego del modo Multiclase es muy similar al modo normal. Tan solo habrá que seguir unas indicaciones a la hora de crear el nuevo mazo de habilidades y el mazo de la Horda.

*Es recomendable que todos los jugadores utilicen mazos multiclase en este tipo de partidas, pero nada impide a un jugador emplear un héroe básico.*

**Construcción del mazo:**

1. Selecciona dos Héroes y coge sus dos mazos de habilidad.
2. Revisa las cartas de habilidad de los dos mazos y coge aquellas que más te gusten para construir un nuevo mazo. ¡Pero cuidado! Tienes que respetar las siguientes normas:
   - Tendrás que escoger **al menos 5 cartas de cada mazo**.
   - El nuevo mazo deberá tener **15 cartas exactamente**.
3. La carta de Héroe elegida será la que establezca **la habilidad (Pericia)** de la que disfrutarás, pero el **tipo de cartas de mercado** que podrás usar lo establecerán **las dos clases** de las que dispones. *(A modo de recordatorio, podrás situar bajo tu carta de Héroe una carta de héroe de tu clase alternativa, de modo que se vean los iconos de capacidad inferiores.)*`,
    keywords: ['multiclase', 'clases', 'mazo', '15 cartas', '5 cartas', 'pericia', 'mercado'],
  },
  {
    id: 'multi-horde',
    category: 'multiclass',
    title: 'Multiclase — Preparación del mazo de la Horda',
    body: `El mazo de la Horda varía según el número de jugadores:

- **2 jugadores**: **23 cartas** de Huestes más una carta de Señor de la Guerra.
- **3 jugadores**: **27 cartas** de Huestes más una carta de Señor de la Guerra.
- **4 jugadores**: **27 cartas** de Huestes, entre las que se baraja **un Señor de la Guerra** (*), y una carta de Señor de la Guerra más que se situará al final, de la forma habitual.

*(*) El Señor de la Guerra barajado entre el mazo, en el modo a 4 jugadores, se tratará de la misma forma que el Señor de la Guerra que aparece al final de la partida.*

Diseñado por: Rodrigo González y Juan Emilio Herranz`,
    keywords: ['multiclase', 'horda', 'huestes', 'señor de la guerra', 'jugadores', '23', '27'],
  },

  // ==================== SECCIONES DE AYUDA (síntesis de navegación) ====================
  // No provienen de un único apartado del PDF: resumen condensan reglas
  // dispersas para facilitar el aprendizaje y la consulta rápida.
  {
    id: 'quick-start',
    category: 'base',
    title: 'La partida en un minuto',
    body: `El objetivo del grupo es derrotar a la Horda y al **Señor de la Guerra**. El objetivo individual es terminar con **más Gloria** que el resto de los héroes.

Cada turno, en resumen:

1. **Ataca** a los enemigos utilizando cartas de Habilidad.
2. Resuelve el **ataque de los enemigos** supervivientes (desgasta tu mazo).
3. **Compra** equipamiento en el Mercado.
4. **Recupera** tu mano y repón la Horda.
5. Cuando aparezca, derrota al **Señor de la Guerra**.
6. Consigue **más Gloria** que el resto de los héroes.

El mazo de Habilidad también es tu energía: si se agota y hay que reconstruirlo, sufres **1 Herida**.`,
    keywords: ['resumen', 'objetivo', 'cómo se juega', 'turno', 'gloria', 'empezar'],
  },
  {
    id: 'setup-checklist',
    category: 'base',
    title: 'Comprobación final de la preparación',
    body: `Antes de empezar la primera ronda, verifica:

- ✓ Cada héroe tiene su **mazo de Habilidad** (15 cartas) barajado y **4 cartas** en mano.
- ✓ El **mazo de Horda** está preparado con el Señor de la Guerra al final (ver *Preparar la Horda*).
- ✓ La **primera oleada** de enemigos está revelada sobre la mesa.
- ✓ El **Mercado** muestra 5 cartas de equipamiento.
- ✓ El **Escenario** inicial está revelado (si jugáis con escenarios).
- ✓ El **Líder** ha sido elegido por puja de cartas.

En la aplicación, todo esto se prepara automáticamente al crear la partida.`,
    keywords: ['preparación', 'checklist', 'comprobación', 'empezar', 'oleada', 'líder'],
  },
  {
    id: 'wear-flow',
    category: 'base',
    title: 'El mazo como energía',
    body: `El mazo de Habilidad tiene una doble función: proporciona las cartas jugables **y** representa la resistencia del héroe.

Cuando la Horda ataca:

1. Se calcula el **Desgaste** (suma de la Fortaleza restante de los enemigos).
2. Los **Escudos** absorben primero.
3. El resto se aplica como **cartas del mazo al Desgaste**.
4. Si el mazo se **agota**, se reconstruye barajando el Desgaste… **y el héroe sufre 1 Herida**.

*Por eso jugar muchas cartas tiene un coste oculto: cada carta jugada acerca al héroe a agotar su mazo y herirse.*`,
    keywords: ['mazo', 'energía', 'desgaste', 'herida', 'reconstruir', 'escudo', 'vida'],
  },
  {
    id: 'turn-summary',
    category: 'base',
    title: 'Resumen del turno',
    body: `**1. Fase de Ataque**
Juega cartas de Habilidad contra los enemigos en mesa. Opcionalmente, usa la Maniobra de Evasión (descartar ≥2 cartas) para evitar la respuesta de la Horda.

**2. Ataque de la Horda**
Los enemigos supervivientes desgastan tu mazo: Desgaste = Fortaleza restante − Escudos.

**3. Fase de Mercado**
Compra equipamiento con Monedas. Las cartas compradas van directamente a la mano.

**4. Restablecimiento**
Roba hasta 4 cartas, repón la Horda y pasa el turno al siguiente héroe.`,
    keywords: ['turno', 'resumen', 'fases', 'ataque', 'mercado', 'restablecimiento', 'evasión'],
  },
  {
    id: 'faq',
    category: 'base',
    title: 'Preguntas frecuentes',
    body: `**¿Puedo repartir el daño de una carta entre varios enemigos?**
No. El daño de una carta se asigna a un único objetivo.

**¿Qué pasa si mi mazo se agota?**
Se baraja el Desgaste para reconstruirlo y el héroe sufre 1 Herida.

**¿Las cartas del Mercado van a la mano o al mazo?**
Directamente a la mano, y el hueco del Mercado se repone al instante.

**¿En qué se diferencian Gloria y Monedas?**
La Gloria decide al ganador; las Monedas compran equipamiento y cada 3 suman 1 Gloria al final.

**¿Cuándo termina la partida?**
Al derrotar al Señor de la Guerra (o cuando todos los héroes caen).`,
    keywords: ['dudas', 'preguntas', 'faq', 'daño', 'mazo', 'mercado', 'gloria', 'monedas'],
  },
  {
    id: 'card-anatomy',
    category: 'base',
    title: 'Anatomía de las cartas',
    body: `Cada tipo de carta imprime su información en las mismas zonas. Elige un tipo arriba para ver una carta real del catálogo con sus partes señaladas.`,
    keywords: ['anatomía', 'partes', 'carta', 'fortaleza', 'gloria', 'coste', 'iconos', 'leer carta'],
  },
  {
    id: 'alpha-index',
    category: 'base',
    title: 'Índice alfabético',
    body: `Todas las secciones del reglamento ordenadas alfabéticamente. Toca una entrada para abrirla.`,
    keywords: ['índice', 'alfabético', 'todas', 'lista'],
  },
  {
    id: 'version',
    category: 'base',
    title: 'Versión del reglamento',
    body: `**Reglamento digital · NT4H Digital**

Contenido transcrito íntegramente de los documentos oficiales:

- *Manual de Reglas* (Holocubierta Ediciones, 2015)
- *Modo Solitario*
- *Modo Multiclase*

La aplicación aplica estas reglas de forma automática; esta pantalla sirve para consultarlas.`,
    keywords: ['versión', 'reglamento', 'cambios', 'fuente', 'pdf'],
  },
];

// ============================================================================
// Índice del reglamento — capítulos funcionales que agrupan las secciones.
// Los títulos narrativos se conservan dentro del contenido; el índice usa
// nombres claros y predecibles.
// ============================================================================

export interface RulebookItem {
  /** id de RuleSection en RULES */
  ruleId: string;
  /** Etiqueta del índice (funcional, no narrativa) */
  label: string;
}

export interface RulebookChapter {
  id: string;
  num: number;
  title: string;
  items: RulebookItem[];
}

export const BASE_CHAPTERS: RulebookChapter[] = [
  {
    id: 'ch-intro', num: 1, title: 'Introducción',
    items: [
      { ruleId: 'intro', label: 'Hace mucho tiempo…' },
      { ruleId: 'quick-start', label: 'La partida en un minuto' },
    ],
  },
  {
    id: 'ch-components', num: 2, title: 'Componentes',
    items: [{ ruleId: 'card-types', label: 'Tipos de cartas y fichas' }],
  },
  {
    id: 'ch-setup', num: 3, title: 'Preparación',
    items: [
      { ruleId: 'setup-horde', label: 'Preparar la Horda' },
      { ruleId: 'setup-heroes', label: 'Preparar a los Héroes' },
      { ruleId: 'setup-market-scenario', label: 'Mercado y Escenario' },
      { ruleId: 'setup-leader', label: 'Escoger al Líder' },
      { ruleId: 'setup-checklist', label: 'Comprobación final' },
    ],
  },
  {
    id: 'ch-gameplay', num: 4, title: 'Desarrollo de la partida',
    items: [
      { ruleId: 'turn-phases', label: 'Estructura del turno' },
      { ruleId: 'attack-phase', label: 'Fase de Ataque' },
      { ruleId: 'evasion', label: 'Maniobra de Evasión' },
      { ruleId: 'horde-attack', label: 'Respuesta de la Horda' },
      { ruleId: 'market-phase', label: 'Fase de Mercado' },
      { ruleId: 'market-restrictions', label: 'Restricciones y penalizaciones' },
      { ruleId: 'recovery-phase', label: 'Fase de Restablecimiento' },
    ],
  },
  {
    id: 'ch-life', num: 5, title: 'Vida, Heridas y Desgaste',
    items: [
      { ruleId: 'damage-wounds', label: 'Heridas y Desgaste' },
      { ruleId: 'wear-flow', label: 'El mazo como energía' },
    ],
  },
  {
    id: 'ch-end', num: 6, title: 'Final de la batalla',
    items: [
      { ruleId: 'warlord', label: 'Señor de la Guerra' },
      { ruleId: 'end-game', label: 'Cómputo de Gloria y desempates' },
    ],
  },
  {
    id: 'ch-heroes', num: 7, title: 'Héroes y Pericias',
    items: [{ ruleId: 'hero-feats', label: 'Pericias de los Héroes' }],
  },
  {
    id: 'ch-scenarios', num: 8, title: 'Escenarios y reglas opcionales',
    items: [{ ruleId: 'scenarios', label: 'Escenarios (opcional)' }],
  },
  {
    id: 'ch-reference', num: 9, title: 'Referencia',
    items: [
      { ruleId: 'turn-summary', label: 'Resumen del turno' },
      { ruleId: 'enemy-icons', label: 'Iconos y símbolos' },
      { ruleId: 'card-anatomy', label: 'Anatomía de las cartas' },
      { ruleId: 'glossary', label: 'Glosario' },
      { ruleId: 'faq', label: 'Preguntas frecuentes' },
      { ruleId: 'alpha-index', label: 'Índice alfabético' },
    ],
  },
  {
    id: 'ch-info', num: 10, title: 'Información',
    items: [
      { ruleId: 'credits', label: 'Créditos' },
      { ruleId: 'version', label: 'Versión del reglamento' },
    ],
  },
];

/** Solitario: solo las diferencias respecto a las reglas base */
export const SOLO_ITEMS: RulebookItem[] = [
  { ruleId: 'solo-intro', label: 'Resumen del modo' },
  { ruleId: 'solo-setup', label: 'Cambios en la preparación' },
  { ruleId: 'solo-allies', label: 'Preparación de aliados' },
  { ruleId: 'solo-support', label: 'Apoyos en la Fase de Ataque' },
  { ruleId: 'solo-market-scenario', label: 'Mercado y Escenarios' },
  { ruleId: 'solo-end', label: 'Puntuación final' },
  { ruleId: 'solo-titles', label: 'Rangos de victoria' },
  { ruleId: 'solo-exceptions', label: 'Excepciones' },
];

/** Multiclase: solo las diferencias respecto a las reglas base */
export const MULTI_ITEMS: RulebookItem[] = [
  { ruleId: 'multi-intro', label: 'Creación del personaje' },
  { ruleId: 'multi-horde', label: 'Mazo de la Horda' },
];

/** Referencia rápida: secciones mostradas expandidas en la pestaña homónima */
export const QUICKREF_IDS = ['turn-summary', 'end-game', 'enemy-icons', 'faq'];
