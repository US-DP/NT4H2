/** Textos ES de «library» — pantalla Colección (galería, filtros, detalle). */
export default {
  library: {
    title: 'Colección',
    back: 'Volver',
    cardCount: '{{total}} cartas',
    loadingCatalog: 'Cargando catálogo…',

    search: {
      placeholder: 'Buscar por nombre, tipo, clase o palabra clave…',
      a11y: 'Buscar carta',
      clearA11y: 'Limpiar búsqueda',
    },

    categories: {
      label: 'CATEGORÍA',
      a11y: 'Categoría de colección',
      cards: 'Cartas',
      decks: 'Mazos',
      sets: 'Conjuntos',
    },

    filters: {
      type: 'TIPO',
      class: 'CLASE',
      more: 'MÁS',
      origin: 'ORIGEN',
      originA11y: 'Origen de las cartas',
      spoilers: 'SPOILERS',
      spoilersA11y: 'Cartas sin descubrir',
      allTypes: 'Todos',
      allClasses: 'Todas',
      favorites: '★ Favoritas',
      undiscovered: '🔒 Sin descubrir',
      clear: 'Limpiar filtros',
      clearA11y: 'Limpiar filtros',
      clearAll: 'Limpiar búsqueda y filtros',
    },

    types: {
      ABILITY: 'Habilidad',
      HERO: 'Héroe',
      HORDE: 'Hueste',
      WARLORD: 'Señor de la Guerra',
      MARKET: 'Mercado',
      SCENARIO: 'Escenario',
    },

    classes: {
      WARRIOR: 'Guerrero',
      EXPLORER: 'Explorador',
      ROGUE: 'Pícaro',
      MAGE: 'Mago',
    },

    sorts: {
      name: 'Nombre',
      type: 'Tipo',
      damage: 'Daño',
      cost: 'Coste',
    },

    origins: {
      all: 'Todas',
      official: 'Oficiales',
      custom: 'Personalizadas',
    },

    spoilerModes: {
      hide: 'Ocultar',
      silhouette: 'Siluetas',
      show: 'Mostrar',
    },

    results_one: '{{count}} resultado',
    results_other: '{{count}} resultados',
    activeFilters_one: ' · {{count}} filtro',
    activeFilters_other: ' · {{count}} filtros',

    views: {
      gridA11y: 'Vista de cuadrícula',
      listA11y: 'Vista de lista',
    },

    empty: {
      query: 'No encontramos cartas para "{{query}}".',
      filters: 'No hay cartas que coincidan con los filtros.',
      suggestion: '¿Querías buscar "{{suggestion}}"?',
      suggestionA11y: 'Buscar {{suggestion}}',
    },

    badges: {
      custom: 'PERSONALIZADA',
      customMark: ' · ★',
      official: 'OFICIAL',
      undiscovered: 'SIN DESCUBRIR',
      undiscoveredA11y: 'Carta sin descubrir',
      deckReady: 'LISTO',
      deckIncomplete: 'INCOMPLETO',
    },

    cardA11y: {
      undiscovered: ' Sin descubrir.',
      custom: ' Personalizada.',
      favorite: ' Favorita.',
    },

    decks: {
      officialName: 'Mazo de {{class}}',
      officialMeta: '{{n}} cartas · Oficial',
      cardCount: '{{total}}/{{size}} cartas',
      edit: 'Editar',
      editA11y: 'Editar {{name}} en el Taller',
      empty: 'Sin mazos personalizados — créalos en el Taller.',
    },

    sets: {
      baseGame: 'Juego base',
      officialDefs: '{{n}} definiciones oficiales',
      meta: '{{cards}} cartas · {{decks}} mazos · v{{version}} · {{author}}',
      empty: 'Sin conjuntos personalizados — publícalos desde el Taller.',
    },

    detail: {
      heading: 'DETALLE',
      position: ' · {{current}}/{{total}}',
      closeA11y: 'Cerrar detalle de la carta',
      zoomInA11y: 'Ampliar la carta',
      zoomOutA11y: 'Restablecer zoom de la carta',
      zoomInHint: 'Tocar para ampliar',
      zoomOutHint: 'Tocar para restablecer zoom',
      favAddA11y: 'Marcar como favorita',
      favRemoveA11y: 'Quitar de favoritas',
      cardText: 'TEXTO DE LA CARTA',
      effect: 'EFECTO',
      capabilities: 'CAPACIDADES',
      rulesLink: 'Consultar reglas relacionadas →',
      prevA11y: 'Carta anterior',
      prev: '← Anterior',
      nextA11y: 'Carta siguiente',
      next: 'Siguiente →',
      peritiaUses_one: '{{count}} uso',
      peritiaUses_other: '{{count}} usos',

      fields: {
        damage: 'Daño',
        fortitude: 'Fortaleza',
        cost: 'Coste',
        costValue: '{{n}} monedas',
        maxWounds: 'Heridas máx.',
        reward: 'Recompensa',
        rewardGlory: '{{n}} Gloria',
        rewardCoins: '{{n}} monedas',
        copies: 'Copias',
        usage: 'Uso',
        singleUse: 'Un solo uso (se retira)',
        requires: 'Requiere',
        peritia: 'Pericia',
        icons: 'Iconos',
        origin: 'Origen',
        set: 'Conjunto',
        author: 'Autor',
        version: 'Versión',
      },

      customStatus: {
        CUSTOM: 'Personalizada',
        COMMUNITY: 'Comunidad',
        DRAFT: 'Borrador',
        fallback: 'Personalizada',
      },
    },
  },
} as const;
