/** Textos ES de «flow» — cadenas extraídas de CreateGameFlow. */
export default {
  flow: {
    /** Fuente del pool personalizado (Horda/Señores/Mercado): contenido oficial */
    poolSourceOfficial: 'Oficial',
    /** Fuente del pool personalizado (Horda/Señores/Mercado): contenido del Taller */
    poolSourceCustom: 'Personalizado',
    /** Icono que precede al dato «jugadores» en la tarjeta de modo */
    iconPlayers: '👥',
    /** Icono que precede al dato «duración» en la tarjeta de modo */
    iconDuration: '◷',
    /** Punto relleno del indicador de complejidad (●●○) */
    complexityDotFilled: '●',
    /** Punto vacío del indicador de complejidad (●●○) */
    complexityDotEmpty: '○',
    /** Botón que quita un participante */
    countDecrement: '−',
    /** Botón que añade un participante */
    countIncrement: '+',
    /** Marcador cuando un valor del resumen aún no tiene contenido */
    noValue: '—',
    /** Separador «etiqueta: valor» (p. ej. «P1: Dunar») */
    labelSeparator: ': ',
    /** Separador con punto medio entre fragmentos del resumen/stepper */
    dotSeparator: ' · ',
    /** Separador entre la clase principal y la segunda clase (multiclase) */
    plusSeparator: ' + ',
    /** Flecha que precede a «Cancelar» en la cabecera del asistente */
    backArrow: '←',
    /** Marca de paso completado en el stepper */
    stepDone: '✓',
    /** Icono que precede al error del paso actual */
    warningIcon: '⚠',
    /** Separador entre dos frases en etiquetas de accesibilidad */
    sentenceSeparator: '. ',
    /** Punto final añadido a cada motivo de validación del resumen */
    sentenceEnd: '.',
    /** Contador «copias actuales/tamaño requerido» de un mazo incompleto */
    deckCount: '{{total}}/{{size}}',
  },
} as const;
