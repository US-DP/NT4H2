/** Textos ES de «misc» — pantallas varias (_layout, content, showcase, home). */
export default {
  misc: {
    back: 'Volver',
    cancel: 'Cancelar',
    confirm: 'Confirmar',

    /* _layout: títulos de las pantallas del Stack */
    screen: {
      index: 'No Time for Heroes',
      play: 'Jugar',
      create: 'Nueva partida',
      game: 'Partida',
      rulebook: 'Reglamento',
      content: 'Contenido',
      stats: 'Estadísticas',
      library: 'Colección',
      profile: 'Perfil',
      room: 'Sala',
      study: 'Taller',
      showcase: 'Catálogo de componentes',
    },

    /* (content): contenido instalado */
    installedTitle: 'Contenido instalado',
    baseTitle: 'No Time for Heroes — Juego base',
    baseMeta: '{{count}} definiciones · oficial · {{size}}',
    baseNote: 'Siempre presente — no se puede quitar ni modificar.',
    noSets:
      'No hay conjuntos personalizados instalados. Créalos en el Taller o impórtalos desde una invitación.',
    published: 'Publicado',
    draft: 'Borrador',
    setMeta: 'v{{version}} · {{author}} · {{cards}} cartas · {{decks}} mazos · {{size}}',
    versionsPublished: 'Versiones publicadas: {{count}}',
    versionsLatest: 'Última: v{{version}}',
    export: 'Exportar',
    exportSet: 'Exportar {{name}}',
    exported: 'Conjunto exportado',
    exportFailed: 'No se pudo exportar',
    restoreSetA11y: 'Restaurar {{name}} a la versión {{version}}',
    restoreVersion: 'Restaurar v{{version}}',
    restored: 'Restaurado a v{{version}}',
    restoreFailed: 'No se pudo restaurar',
    confirmUninstallA11y: 'Confirmar desinstalación de {{name}}',
    uninstalled: 'Conjunto desinstalado',
    uninstallSet: 'Desinstalar {{name}}',
    uninstall: 'Desinstalar',

    /* index (home): restos hardcodeados */
    loadGameA11y: 'Cargar partida {{name}}',
    compatSnapshot: 'Snapshot: {{from}} → {{to}}',
    compatEngine: 'Motor: {{from}} → {{to}}',
    compatCatalog: 'Catálogo: {{from}} → {{to}}',

    /* (dev)/showcase: catálogo de componentes */
    showcase: {
      devOnlyTitle: 'Disponible solo en desarrollo',
      devOnlyDesc: 'El catálogo de componentes no forma parte de la app publicada.',
      backA11y: 'Volver a la pantalla anterior',
      title: 'Catálogo de componentes',

      btnPrimary: 'Primario',
      btnSecondary: 'Secundario',
      btnDanger: 'Peligro',
      btnGhost: 'Ghost',
      btnSmall: 'Pequeño',
      btnLarge: 'Grande',
      btnDisabled: 'Deshabilitado',

      badgeNeutral: 'Neutral',
      badgeSuccess: 'Éxito',
      badgeWarning: 'Aviso',
      badgeDanger: 'Peligro',
      badgeInfo: 'Info',
      badgeAccent: 'Acento',

      panelSurface: 'Panel surface con borde',
      panelModal: 'Panel nivel modal',

      inputHero: 'Nombre del héroe',
      inputHeroPlaceholder: 'Ej. Lisavette',
      inputErrorLabel: 'Con error',
      inputErrorValue: 'Mazo de 14 cartas',
      inputErrorMsg: 'El mazo debe tener 15 cartas',

      radioLabel: 'Modo de partida',
      modeSolo: 'Solitario',
      modeSoloDesc: 'Tú contra las hordas',
      modeLocal: 'Local',
      modeLocalDesc: 'Hot-seat en este dispositivo',
      modeOnline: 'Online',
      modeOnlineDesc: 'Sala con otros jugadores',

      openDialog: 'Abrir diálogo',
      openDialogA11y: 'Abrir diálogo de ejemplo',
      dialogTitle: 'Abandonar la partida',
      dialogDesc: 'El progreso no guardado se perderá. ¿Continuar?',
      dialogLeave: 'Abandonar',

      openSheet: 'Abrir hoja inferior',
      openSheetA11y: 'Abrir hoja inferior de ejemplo',
      sheetTitle: 'Hoja de ejemplo',
      sheetBody: 'Contenido no crítico: filtros, detalle de carta, historial, índice.',

      showToast: 'Mostrar aviso',
      showToastA11y: 'Mostrar aviso toast de ejemplo',
      toastMsg: 'Partida guardada',
      toastUndo: 'Deshacer',

      errSendAction: 'Enviar mensaje',
      errSendReason: 'Se perdió la conexión con la sala',
      errSendFix: 'Comprueba tu red y reintenta',
      retry: 'Reintentar',
      errJoinAction: 'Unirse a la sala',
      errJoinReason: 'La versión del motor difiere',
      errJoinFix: 'Actualiza la aplicación',

      emptyTitle: 'Sin partidas guardadas',
      emptyDesc: 'Cuando guardes una partida aparecerá aquí.',
      emptyNew: 'Nueva partida',
      emptyRules: 'Ver reglamento',

      cardAttack: 'Golpe Certero',
      cardArmor: 'Armadura de Cuero',
      cardOrc: 'Orco Lancero',

      bannerMessage: 'Acción no válida en esta fase',
      bannerInstruction: 'Juega cartas contra los enemigos del campo',

      chatSenderSystem: 'Sistema',
      chatMsg1: 'Hola equipo',
      chatSystem: 'Ben fue expulsado',
      chatYou: 'Tú',
      chatFail: 'Un fallo de ejemplo',
    },
  },
} as const;
