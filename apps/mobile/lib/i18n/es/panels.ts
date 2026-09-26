/** Textos ES de «panels» — componentes de paneles, diálogos y asistentes. */
export default {
  panels: {
    // Compartidos
    cancel: 'Cancelar',
    close: 'Cerrar',
    save: 'Guardar',
    pass: 'Pasar',
    help: 'Ayuda',

    // ActionHistory
    historyTitle: 'Historial',
    historyHideTechnical: 'Ocultar detalles técnicos',
    historyShowTechnical: 'Mostrar detalles técnicos',
    historyBasic: 'Básico',
    historyAdvanced: 'Avanzado',
    historyFilterAll: 'Todo',
    historyFilterTurn: 'Turno actual',
    historyFilterPlayer: 'Por jugador',
    historyFilterCards: 'Cartas',
    historyFilterDamage: 'Daño',
    historyFilterResources: 'Recursos',
    historyFilterErrors: 'Errores',
    historyFilterByPlayer: 'Filtrar por {{name}}',
    historyEmpty: 'No hay eventos en este filtro.',
    historyGlobal: 'Global',
    historyTurnShort: 'T{{turn}}',
    historyPrivate: 'Acción privada — detalles ocultos',
    historyCard: 'Carta: {{card}}',
    historyTarget: 'Objetivo: {{target}}',
    historyViewHorde: 'Ver desglose del ataque de la Horda',
    historyViewDetail: 'Ver detalle',
    historyViewBreakdownLink: 'Ver desglose →',
    historyViewDetailLink: 'Ver detalle →',
    historyCmd: 'CMD: {{id}}',
    historyVersion: 'v{{version}}',
    historySeed: 'seed: {{seed}}',

    // ChoiceDialog
    choicePrivate: 'Privada',
    choiceWaiting: 'Esperando una decisión de {{decider}}.',
    choiceDecider: 'Decisión de: {{decider}}',
    choiceTimer: '⏱ {{seconds}}s',
    choiceSelect_one: 'Selecciona {{range}} opción.',
    choiceSelect_other: 'Selecciona {{range}} opciones.',
    choiceNoOptions: 'No hay opciones válidas disponibles.',
    choiceContinue: 'Continuar partida',
    choiceSkip: 'Omitir',
    choiceConfirm: 'Confirmar ({{selected}}/{{min}})',

    // PendingChoiceView
    pendingCardAttack: '{{name}} (Atq {{value}})',
    pendingCardCost: '{{name}} ({{value}} monedas)',
    pendingCardFort: '{{name}} (Fort {{value}})',
    pendingHero: 'Héroe: {{hero}}',
  yes: 'Sí',
  no: 'No',
    pendingUseAbility: 'Usar pericia',
    pendingPayGlory: 'Pagar 1 Gloria',
    pendingPayCoins: 'Pagar 2 Monedas',
    pendingChooseExact: 'Elige {{n}}',
    pendingChooseRange: 'Elige {{min}}-{{max}}',
    pendingBid: 'Pujar ({{selected}}/{{max}})',
    pendingConfirm: 'Confirmar ({{selected}}/{{max}})',
    pendingConfirmA11y: 'Confirmar selección',

    // SaveGameModal
    saveTitle: 'Guardar partida',
    saveNamePlaceholder: 'Nombre de la partida',

    // ExitGameDialog
    exitTitle: 'Salir de la partida',
    exitUnsaved: 'Tienes cambios sin guardar. ¿Qué quieres hacer?',
    exitSure: '¿Seguro que quieres salir?',
    exitShortcuts: 'Atajos de teclado',
    exitShortcutZone: 'Cambiar de zona',
    exitShortcutPanels: 'Historial · Estado · Chat',
    exitShortcutClose: 'Cerrar o cancelar',
    exitSaveAndExit: 'Guardar y salir',
    exitWithoutSaving: 'Salir sin guardar',
    exitPlain: 'Salir',
    exitAbandon: 'Abandonar partida',

    // SaveIndicator
    saving: 'Guardando...',
    saved: 'Guardado',
    saveFailed: 'Error al guardar',
    savedAtTime: ' a las {{time}}',

    // DeckPanel
    deckAbilityA11y: 'Mazo de habilidades: {{count}} cartas',
    deckRebuildWarn: '. Reconstruir costará 1 herida.',
    deckTitle: 'Mazo',
    deckWoundWarn: '−1 herida',
    discardA11y: 'Pila de descartes: {{count}} cartas',
    discardTitle: 'Descartes',

    // KeywordTooltip
    keywordA11y: 'Palabra clave: {{keyword}}',

    // Tutorial
    tutorialStep: 'Paso {{current}} de {{total}}',
    tutorialPrev: 'Anterior',
    tutorialNext: 'Siguiente',
    tutorialFinish: 'Finalizar',
    tutorialClose: 'Cerrar tutorial',

    // ModeCard
    modeCardA11y: '{{title}}. {{meta}}. {{description}}',

    // GuidedSetup
    setupModeStandard: 'Estándar',
    setupModeSolo: 'Solitario',
    setupModeMulticlass: 'Multiclase',
    setupMode: 'Modo',
    setupPlayers: 'Jugadores',
    setupProgress: '{{done}}/{{total}} pasos completados',
    setupReset: 'Reiniciar',
    setupResetA11y: 'Reiniciar lista de preparación',
    setupStepA11y: 'Paso {{n}}: {{step}}',
    setupAutoNote:
      'La app prepara todo esto automáticamente al crear la partida; esta lista sirve para entender qué haría cada jugador con las cartas físicas.',
    setupStepWarlord: 'Coge una carta de Señor de la Guerra al azar.',
    setupStepHorde:
      'Baraja los {{hordes}} Huestes y forma el mazo de la Horda con el Señor de la Guerra encima (reverso visible).',
    setupStepMarket:
      'Baraja las 15 cartas de Mercado y colócalas boca abajo; muestra las 4 primeras al lado del mazo.',
    setupStepSoloHero:
      'Elige tu Héroe principal y prepara los 3 aliados (cartas 1-6 de cada clase + carta especial).',
    setupStepSoloScenarios:
      'Separa los escenarios con el icono de "solo cooperativos" del mazo de Escenarios.',
    setupStepMulticlassHero:
      'Cada jugador elige un Héroe y dos mazos de Habilidades de clases distintas; combínalos.',
    setupStepBaseHero: 'Cada jugador elige un Héroe y su mazo de Habilidades de 15 cartas.',
    setupStepDraw: 'Cada jugador roba 5 cartas de su mazo de Habilidades.',
    setupStepShields: 'Entrega 2 Escudos a cada jugador.',
    setupStepTokens: 'Coloca los tokens de la bolsa a mano (al alcance de todos).',
    setupStepCoins: 'Prepara 10 Monedas de estado de dolor y 4 fichas de Gloria.',
  },
} as const;
