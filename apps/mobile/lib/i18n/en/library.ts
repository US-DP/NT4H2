/** English strings for 'library' — Collection screen (gallery, filters, detail). */
export default {
  library: {
    title: 'Collection',
    back: 'Back',
    cardCount: '{{total}} cards',
    loadingCatalog: 'Loading catalog…',

    search: {
      placeholder: 'Search by name, type, class or keyword…',
      a11y: 'Search card',
      clearA11y: 'Clear search',
    },

    categories: {
      label: 'CATEGORY',
      a11y: 'Collection category',
      cards: 'Cards',
      decks: 'Decks',
      sets: 'Sets',
    },

    filters: {
      type: 'TYPE',
      class: 'CLASS',
      more: 'MORE',
      origin: 'ORIGIN',
      originA11y: 'Card origin',
      spoilers: 'SPOILERS',
      spoilersA11y: 'Undiscovered cards',
      allTypes: 'All',
      allClasses: 'All',
      favorites: '★ Favorites',
      undiscovered: '🔒 Undiscovered',
      clear: 'Clear filters',
      clearA11y: 'Clear filters',
      clearAll: 'Clear search and filters',
    },

    types: {
      ABILITY: 'Ability',
      HERO: 'Hero',
      HORDE: 'Horde',
      WARLORD: 'Warlord',
      MARKET: 'Market',
      SCENARIO: 'Scenario',
    },

    classes: {
      WARRIOR: 'Warrior',
      EXPLORER: 'Explorer',
      ROGUE: 'Rogue',
      MAGE: 'Mage',
    },

    sorts: {
      name: 'Name',
      type: 'Type',
      damage: 'Damage',
      cost: 'Cost',
    },

    origins: {
      all: 'All',
      official: 'Official',
      custom: 'Custom',
    },

    spoilerModes: {
      hide: 'Hide',
      silhouette: 'Silhouettes',
      show: 'Show',
    },

    results_one: '{{count}} result',
    results_other: '{{count}} results',
    activeFilters_one: ' · {{count}} filter',
    activeFilters_other: ' · {{count}} filters',

    views: {
      gridA11y: 'Grid view',
      listA11y: 'List view',
    },

    empty: {
      query: 'No cards found for "{{query}}".',
      filters: 'No cards match the filters.',
      suggestion: 'Did you mean "{{suggestion}}"?',
      suggestionA11y: 'Search {{suggestion}}',
    },

    badges: {
      custom: 'CUSTOM',
      customMark: ' · ★',
      official: 'OFFICIAL',
      undiscovered: 'UNDISCOVERED',
      undiscoveredA11y: 'Undiscovered card',
      deckReady: 'READY',
      deckIncomplete: 'INCOMPLETE',
    },

    cardA11y: {
      undiscovered: ' Undiscovered.',
      custom: ' Custom.',
      favorite: ' Favorite.',
    },

    decks: {
      officialName: '{{class}} deck',
      officialMeta: '{{n}} cards · Official',
      cardCount: '{{total}}/{{size}} cards',
      edit: 'Edit',
      editA11y: 'Edit {{name}} in the Workshop',
      empty: 'No custom decks — create them in the Workshop.',
    },

    sets: {
      baseGame: 'Base game',
      officialDefs: '{{n}} official definitions',
      meta: '{{cards}} cards · {{decks}} decks · v{{version}} · {{author}}',
      empty: 'No custom sets — publish them from the Workshop.',
    },

    detail: {
      heading: 'DETAIL',
      position: ' · {{current}}/{{total}}',
      closeA11y: 'Close card detail',
      zoomInA11y: 'Zoom in on the card',
      zoomOutA11y: 'Reset card zoom',
      zoomInHint: 'Tap to zoom in',
      zoomOutHint: 'Tap to reset zoom',
      favAddA11y: 'Mark as favorite',
      favRemoveA11y: 'Remove from favorites',
      cardText: 'CARD TEXT',
      effect: 'EFFECT',
      capabilities: 'CAPABILITIES',
      rulesLink: 'View related rules →',
      prevA11y: 'Previous card',
      prev: '← Previous',
      nextA11y: 'Next card',
      next: 'Next →',
      peritiaUses_one: '{{count}} use',
      peritiaUses_other: '{{count}} uses',

      fields: {
        damage: 'Damage',
        fortitude: 'Fortitude',
        cost: 'Cost',
        costValue: '{{n}} coins',
        maxWounds: 'Max wounds',
        reward: 'Reward',
        rewardGlory: '{{n}} Glory',
        rewardCoins: '{{n}} coins',
        copies: 'Copies',
        usage: 'Usage',
        singleUse: 'Single use (removed)',
        requires: 'Requires',
        peritia: 'Feat',
        icons: 'Icons',
        origin: 'Origin',
        set: 'Set',
        author: 'Author',
        version: 'Version',
      },

      customStatus: {
        CUSTOM: 'Custom',
        COMMUNITY: 'Community',
        DRAFT: 'Draft',
        fallback: 'Custom',
      },
    },
  },
} as const;
