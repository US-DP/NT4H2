/** Textos ES de «lobby» — sala de espera (app/(room)) y panel de chat (ChatPanel). */
export default {
  lobby: {
    /** Nombre visible por defecto de un jugador */
    player: 'Jugador',
    /** Remitente de las entradas automáticas del registro de sala */
    system: 'Sistema',
    /** Alias del propio usuario en el eco optimista del chat */
    you: 'Tú',
    /** Sufijo junto al nombre del anfitrión en la lista de jugadores */
    hostSuffix: ' (Anfitrión)',
    /** Sufijo junto al nombre del propio jugador en la lista */
    youSuffix: ' — tú',
    /** Validación del formulario de unirse: código de sala vacío */
    errRoomCode: 'Introduce el código de sala',
    /** Validación del formulario de unirse: nombre demasiado corto */
    errPlayerName: 'El nombre debe tener al menos 2 caracteres',
    /** Error al pedir el estado de la sala por REST */
    errLoadRoom: 'No se pudo cargar la sala',
    /** Error al pedir el ticket efímero del WebSocket del lobby */
    errWsAuth: 'No se pudo autenticar la conexión en tiempo real',
    /** Error genérico del WebSocket del lobby */
    errWs: 'Error de conexión WebSocket',
    /** El backend rechaza la unión porque el jugador está vetado (D440) */
    errKicked: 'Has sido expulsado de esta sala',
    /** Fallback al unirse a la sala sin mensaje del servidor */
    errJoin: 'No se pudo unir',
    /** Fallback al iniciar la partida sin mensaje del servidor */
    errStart: 'No se pudo iniciar',
    /** Fallback al expulsar a un jugador sin mensaje del servidor */
    errKick: 'No se pudo expulsar',
    /** Fallback al levantar el veto de un expulsado */
    errUnkick: 'No se pudo permitir el regreso',
    /** Fallback al transferir el rol de anfitrión */
    errTransfer: 'No se pudo transferir',
    /** Fallback al cerrar la sala */
    errClose: 'No se pudo cerrar',
    /** Fallback al cambiar el estado «preparado» */
    errReady: 'No se pudo actualizar',
    /** Error genérico cuando la excepción no trae mensaje */
    errGeneric: 'Error',
  errChatOffline: 'Sin conexión — el mensaje no se ha enviado',
    /** Entrada del registro: comando de juego recibido por broadcast */
    // (sysCommand eliminada: el lobby ya no muestra eco de comandos)
    /** Toast cuando el usuario recibe el rol de anfitrión */
    youAreHost: 'Ahora eres el anfitrión',
    /** Placeholder del campo de nombre al unirse a la sala */
    namePlaceholder: 'Tu nombre',
    /** Etiqueta accesible del botón ⋯ de moderación de un jugador */
    playerOptions: 'Opciones de {{name}}',
    /** Pista accesible del botón ⋯ (abre transferir/expulsar) */
    modMenuHint: 'Abre el menú de moderación: transferir anfitrión o expulsar',
    /** Pista accesible del botón iniciar: jugadores pendientes */
    notReadyHint: 'Faltan {{n}} jugadores por estar preparados',
    /** Pista accesible del botón «Cerrar sala» */
    closeRoomHint: 'Cierra la sala para todos los jugadores',
    /** Detalle de una incompatibilidad de catálogo con el anfitrión */
    catalogIssue: 'catálogo del anfitrión {{host}} ≠ el tuyo {{local}}',
    /** Etiqueta del selector de héroe al unirse a una sala */
    pickHero: 'Elige tu héroe',
    /** Etiqueta del selector de clase (mazo) al unirse a una sala */
    pickClass: 'Elige tu clase (mazo)',
    /** Segunda clase del modo multiclase (al unirse) */
    pickSecondClass: 'Elige tu segunda clase',
    pickCustomDeck: 'O usa un mazo del Taller',
    classDeck: 'Mazo de clase',
    /** Error del formulario de unirse: héroe no elegido */
    errPickHero: 'Elige un héroe para jugar',
    /** Etiqueta de mazo custom del Taller junto al nombre en el roster */
    workshopDeck: 'Taller',

    chat: {
      /** Título de la cabecera del panel */
      title: 'Chat',
      /** Etiqueta accesible del botón de cerrar el panel */
      hideChat: 'Ocultar chat',
      /** Estado vacío sin mensajes */
      empty: 'No hay mensajes.',
      /** Etiqueta del tipo de mensaje SYSTEM junto al remitente */
      typeSystem: 'Sistema',
      /** Etiqueta del tipo de mensaje CONNECTION junto al remitente */
      typeConnection: 'Conexión',
      /** Etiqueta del tipo de mensaje MODERATION junto al remitente */
      typeModeration: 'Moderación',
      /** Estado de entrega: mensaje propio en vuelo */
      sending: 'Enviando…',
      /** Etiqueta accesible del botón de reintentar un mensaje fallido */
      retryA11y: 'Reintentar mensaje: {{text}}',
      /** Estado de entrega: mensaje propio fallido con acción de reintento */
      notSentRetry: 'No enviado — Reintentar',
      /** Etiqueta accesible del botón de descartar un mensaje */
      discardA11y: 'Descartar mensaje: {{text}}',
      /** Acción de descartar un mensaje pendiente/fallido */
      discard: 'Descartar',
      /** Etiqueta accesible del botón de silenciar a un remitente */
      muteA11y: 'Silenciar a {{sender}}',
      /** Acción de silenciar a un remitente */
      mute: 'Silenciar',
      /** Etiqueta accesible de la fila de mensajes rápidos */
      quickRow: 'Mensajes rápidos',
      /** Etiqueta accesible de cada chip de mensaje rápido */
      sendQuickA11y: 'Enviar "{{text}}"',
      /** Placeholder del campo de texto del chat */
      placeholder: 'Escribe un mensaje...',
      /** Etiqueta accesible del campo de texto del chat */
      inputA11y: 'Mensaje de chat',
      /** Etiqueta accesible del botón de enviar */
      sendA11y: 'Enviar mensaje',
      /** Texto del botón de enviar */
      send: 'Enviar',
      /** Aviso UI-189: sin adjuntos en el MVP */
      noAttachments: 'Adjuntos no disponibles en el MVP.',
      /** Mensaje rápido táctico */
      qmGoodLuck: 'Buena suerte',
      /** Mensaje rápido táctico */
      qmOnIt: 'Yo me ocupo de ese',
      /** Mensaje rápido táctico */
      qmWaitTurn: 'Esperad mi turno',
      /** Mensaje rápido táctico */
      qmNeedHeal: 'Necesito curación',
      /** Mensaje rápido táctico */
      qmHitLeader: 'Atacad al de más Gloria',
      /** Mensaje rápido táctico */
      qmSaveForWarlord: 'Guardad cartas para el Señor',
      /** Ping contextual */
      qmWatchEnemy: 'Ojo a ese enemigo',
      /** Ping contextual */
      qmMarket: 'Mirad el mercado',
      /** Ping contextual */
      qmNicePlay: 'Buena jugada',
      /** Ping contextual */
      qmHelpMe: 'Necesito ayuda aquí',
    },
  },
} as const;
