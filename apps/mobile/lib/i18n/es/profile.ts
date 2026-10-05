/** Textos ES de «profile» — pantalla Perfil y accesibilidad. */
export default {
  profile: {
    title: 'Perfil y accesibilidad',
    saved: '✓ Preferencias guardadas',
    back: 'Volver',
    cancel: 'Cancelar',
    accept: 'Entendido',
    reset: 'Restablecer',
    import: 'Importar',
    always: '✓ Siempre',
    percentA11y: '{{value}} por ciento',

    /* Secciones */
    secProfile: 'Perfil',
    secText: 'Texto y visualización',
    secColor: 'Color y contraste',
    secMotion: 'Movimiento',
    secSound: 'Sonido y respuesta',
    secInteraction: 'Interacción',
    secGame: 'Partida',
    secScreenReader: 'Lector de pantalla',
    secActions: 'Acciones',
    secPortability: 'Portabilidad',
    secDiagnostics: 'Diagnóstico',

    /* Perfil */
    displayName: 'Nombre visible',
    displayNameHint: 'Se usa al unirte a salas online',
    namePlaceholder: 'Tu nombre',
    language: 'Idioma',
    langSystem: 'Sistema',
    langEs: 'Español',
    langEn: 'English',

    /* Texto y visualización */
    useSystemTextSize: 'Usar tamaño de texto del dispositivo',
    useSystemTextSizeHint: 'Sigue la configuración del sistema en vez de la opción elegida abajo',
    systemSizeOverride: 'Anulado por la configuración del dispositivo',
    fontSize: 'Tamaño del texto',
    fsDefault: 'Predeterminado · 100 %',
    fsLarge: 'Grande · 115 %',
    fsXlarge: 'Muy grande · 130 %',
    fsXxlarge: 'Extra grande · 150 %',
    fsMax: 'Máximo · 200 %',
    density: 'Densidad de la interfaz',
    densityHint: 'Controla el espacio entre los elementos y la cantidad de información visible',
    densityCompact: 'Compacta',
    densityStandard: 'Estándar',
    densityComfortable: 'Cómoda',
    densityWide: 'Muy amplia',
    boldText: 'Texto en negrita',
    boldTextHint: 'Aumenta el grosor del texto para mejorar su lectura',
    legibleFont: 'Fuente de alta legibilidad',
    legibleFontHint: 'Tipografía con formas más diferenciadas (I/l/1, O/0, rn/m)',
    extraSpacing: 'Aumentar espaciado del texto',
    extraSpacingHint: 'Añade espacio entre líneas, palabras y caracteres',
    previewLabel: 'Vista previa',

    /* Vista previa */
    previewCardTitle: 'Carta de ejemplo',
    previewCardBody:
      'Guardián del bosque — Ataque 8 · Defensa 6.\nObtiene +2 de defensa durante el siguiente turno.',
    previewButton: 'Acción principal',
    previewSecondary: 'Información secundaria',

    /* Color y contraste */
    highContrast: 'Alto contraste',
    highContrastHint:
      'Aumenta la diferencia entre el texto, los controles y el fondo para mejorar su legibilidad',
    notColorOnly: 'No depender únicamente del color',
    notColorOnlyHint:
      'Los estados importantes combinan color con iconos, bordes y texto. Siempre activo.',
    colorMode: 'Modo de color',
    colorModeHint: 'Ajusta la paleta semántica para deficiencias de color',
    cmDefault: 'Predeterminado',
    cmProtanopia: 'Protanopia',
    cmDeuteranopia: 'Deuteranopia',
    cmTritanopia: 'Tritanopia',
    cmMonochrome: 'Monocromático',

    /* Movimiento */
    reduceMotion: 'Reducir movimiento',
    reduceMotionHint:
      'Sustituye animaciones intensas por transiciones más sencillas y cambios directos',
    noFlashes: 'Evitar parpadeos y destellos',
    noFlashesHint:
      'No hay contenido con flashes peligrosos. La celebración se desactiva con "Reducir movimiento".',
    autoPlay: 'Reproducir animaciones automáticamente',
    autoPlayHint: 'Animaciones decorativas y de celebración',

    /* Sonido y respuesta */
    volMaster: 'Volumen general',
    volMusic: 'Volumen de música',
    volEffects: 'Volumen de efectos',
    vibration: 'Vibración',
    vibrationHint: 'Vibra al recibir alertas y durante determinados eventos',
    haptics: 'Respuesta háptica',
    hapticsHint: 'Vibración breve al seleccionar cartas, jugar o cometer un error',
    hapticIntensity: 'Intensidad de la respuesta háptica',
    hiOff: 'Desactivada',
    hiLight: 'Suave',
    hiMedium: 'Media',
    hiStrong: 'Intensa',
    testHaptics: 'Probar respuesta háptica',

    /* Interacción */
    controlSize: 'Tamaño de botones y controles',
    controlSizeHint: 'Aumenta el área táctil de botones, interruptores y controles',
    csNormal: 'Normal',
    csLarge: 'Grande',
    csXlarge: 'Muy grande',
    dragSensitivity: 'Sensibilidad de arrastre',
    dragSensitivityHint: 'Recorrido necesario para jugar una carta arrastrándola',
    dsLow: 'Baja',
    dsMedium: 'Media',
    dsHigh: 'Alta',
    holdToConfirm: 'Mantener pulsado para acciones importantes',
    holdToConfirmHint: 'Solicita mantener pulsado antes de acciones que no pueden deshacerse',
    gestureAlt: 'Mostrar siempre una alternativa a gestos',
    gestureAltHint:
      'Toda interacción de arrastrar ofrece también tocar para seleccionar y confirmar',

    /* Partida */
    orientation: 'Orientación en la mesa de juego',
    orientationHint:
      'Horizontal está recomendado para la mesa; puedes continuar en vertical si lo prefieres',
    orLandscape: 'Horizontal (recomendado)',
    orPortrait: 'Vertical',
    orAuto: 'Automática',
    followPhase: 'Cambiar a la pestaña de la fase actual',
    followPhaseHint:
      'En pantallas estrechas la mesa cambia de pestaña al cambiar de fase; si lo desactivas, la pestaña elegida se mantiene',
    hordeSummary: 'Resumen del ataque de la Horda',
    hordeSummaryHint: 'Cuándo abrir automáticamente el desglose del daño de la Horda',
    hsAlways: 'Siempre',
    hsModifiers: 'Solo si hay modificadores',
    hsNever: 'Nunca (botón manual)',
    shortcuts: 'Atajos de teclado (web)',
    shortcutsHint: '1-5 pestañas · H/E/C paneles · ← → seleccionar carta · Enter jugar · Esc cerrar',

    /* Lector de pantalla */
    srAnnounce: 'Anunciar cambios importantes',
    srAnnounceHint: 'Ej.: "Carta seleccionada", "Movimiento no permitido", "Tu turno"',
    srExpanded: 'Leer descripciones ampliadas',
    srExpandedHint: 'Las cartas anuncian tipo, clase y estadísticas completas',
    srPositions: 'Anunciar posiciones en listas',
    srPositionsHint: 'Ej.: "Carta 2 de 7" al navegar la mano o el historial',

    /* Acciones */
    applyRecommended: 'Aplicar configuración recomendada',
    applyRecommendedHint: 'Texto grande, alto contraste, poco movimiento y controles grandes',
    resetA11y: 'Restablecer ajustes de accesibilidad',
    resetA11yHint:
      'Devuelve texto, contraste, movimiento, sonido e interacción a sus valores. No toca tu perfil.',
    resetDesc:
      'Se restablecerán texto, contraste, movimiento, sonido e interacción. No afecta a partidas guardadas ni a tu perfil.',

    /* Portabilidad */
    exportSettings: 'Exportar ajustes',
    exportSettingsHint:
      'Guarda tus preferencias como fichero .json para llevarlas a otro dispositivo.',
    importSettings: 'Importar ajustes',
    importSettingsHint:
      'Aplica las preferencias de un fichero exportado. Verás un resumen antes de aplicar.',
    exported: 'Ajustes exportados',
    exportFailed: 'No se pudo exportar',
    importInvalid: 'Archivo no válido',
    importSummary: 'Se importarán {{count}} ajustes.',
    importMore: '\n… y {{count}} más',
    importErrorTitle: 'No se pudieron importar los ajustes',

    /* Almacenamiento: etiquetas de tamaño por categoría */
    szSavedGames: 'Partidas guardadas',
    szTrash: 'Papelera',
    szWorkshop: 'Contenido del Taller',
    szWorkshopHistory: 'Historial y versiones del Taller',
    szDrafts: 'Borradores de cartas',
    szCollection: 'Colección',
    szSettings: 'Ajustes',
    szHistory: 'Historial de partidas',
    szRoomSession: 'Sesión de sala',
    trashCountA11y: 'Vaciar la papelera ({{n}} partidas)',
    clearSavesA11y: 'Borrar todas las partidas guardadas ({{n}})',

    /* Diagnóstico */
    diagEngine: 'Motor de reglas',
    diagRuleset: 'Reglamento',
    diagCatalog: 'Catálogo',
    diagPlatform: 'Plataforma',
    diagConnection: 'Conexión',
    diagSaved: 'Partidas guardadas',
    diagSets: 'Sets personalizados',
    diagOnline: 'Online ({{room}})',
    diagRoom: 'sala',
    diagLocal: 'Local',
    copyDiag: 'Copiar diagnóstico',
    copyDiagA11y: 'Copiar diagnóstico (sin datos privados)',
    diagCopied: 'Diagnóstico copiado',

    /* Dev */
    showcase: 'Catálogo de componentes (dev)',
    showcaseA11y: 'Abrir catálogo de componentes',
  },
} as const;
