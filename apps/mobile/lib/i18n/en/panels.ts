/** English strings for 'panels' — panel, dialog and wizard components. */
export default {
  panels: {
    // Shared
    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    pass: 'Pass',
    help: 'Help',

    // ActionHistory
    historyTitle: 'History',
    historyHideTechnical: 'Hide technical details',
    historyShowTechnical: 'Show technical details',
    historyBasic: 'Basic',
    historyAdvanced: 'Advanced',
    historyFilterAll: 'All',
    historyFilterTurn: 'Current turn',
    historyFilterPlayer: 'By player',
    historyFilterCards: 'Cards',
    historyFilterDamage: 'Damage',
    historyFilterResources: 'Resources',
    historyFilterErrors: 'Errors',
    historyFilterByPlayer: 'Filter by {{name}}',
    historyEmpty: 'No events in this filter.',
    historyGlobal: 'Global',
    historyTurnShort: 'T{{turn}}',
    historyPrivate: 'Private action — details hidden',
    historyCard: 'Card: {{card}}',
    historyTarget: 'Target: {{target}}',
    historyViewHorde: 'View the Horde attack breakdown',
    historyViewDetail: 'View details',
    historyViewBreakdownLink: 'View breakdown →',
    historyViewDetailLink: 'View details →',
    historyCmd: 'CMD: {{id}}',
    historyVersion: 'v{{version}}',
    historySeed: 'seed: {{seed}}',

    // Pending choices (shared ChoiceView/PendingChoiceView)
    choiceWaiting: 'Waiting for a decision from {{decider}}.',
    choiceHandOver: 'Pass the device to {{decider}}',
    choiceNoOptions: 'No valid options available.',
    choiceContinue: 'Continue game',

    // PendingChoiceView
    pendingCardAttack: '{{name}} (Atk {{value}})',
    pendingCardCost: '{{name}} ({{value}} coins)',
    pendingCardFort: '{{name}} (Fort {{value}})',
    pendingHero: 'Hero: {{hero}}',
  yes: 'Yes',
  no: 'No',
    pendingUseAbility: 'Use ability',
    pendingPayGlory: 'Pay 1 Glory',
    pendingPayCoins: 'Pay 2 Coins',
    pendingChooseExact: 'Choose {{n}}',
    pendingChooseRange: 'Choose {{min}}-{{max}}',
    pendingBid: 'Bid ({{selected}}/{{max}})',
    pendingConfirm: 'Confirm ({{selected}}/{{max}})',
    pendingConfirmA11y: 'Confirm selection',

    // SaveGameModal
    saveTitle: 'Save game',
    saveNamePlaceholder: 'Game name',

    // ExitGameDialog
    exitTitle: 'Exit game',
    exitUnsaved: 'You have unsaved changes. What do you want to do?',
    exitSure: 'Are you sure you want to exit?',
    exitShortcuts: 'Keyboard shortcuts',
    exitShortcutZone: 'Switch zone',
    exitShortcutPanels: 'History · Status · Chat',
    exitShortcutClose: 'Close or cancel',
    exitSaveAndExit: 'Save and exit',
    exitWithoutSaving: 'Exit without saving',
    exitPlain: 'Exit',
    exitAbandon: 'Abandon game',

    // SaveIndicator
    saving: 'Saving...',
    saved: 'Saved',
    saveFailed: 'Save failed',
    savedAtTime: ' at {{time}}',

    // DeckPanel
    deckAbilityA11y: 'Ability deck: {{count}} cards',
    deckRebuildWarn: '. Rebuilding will cost 1 wound.',
    deckTitle: 'Deck',
    deckWoundWarn: '−1 wound',
    discardA11y: 'Discard pile: {{count}} cards',
    discardTitle: 'Discard',

    // KeywordTooltip
    keywordA11y: 'Keyword: {{keyword}}',

    // Tutorial
    tutorialStep: 'Step {{current}} of {{total}}',
    tutorialPrev: 'Previous',
    tutorialNext: 'Next',
    tutorialFinish: 'Finish',
    tutorialClose: 'Close tutorial',

    // ModeCard
    modeCardA11y: '{{title}}. {{meta}}. {{description}}',

    // GuidedSetup
    setupModeStandard: 'Standard',
    setupModeSolo: 'Solo',
    setupModeMulticlass: 'Multiclass',
    setupMode: 'Mode',
    setupPlayers: 'Players',
    setupProgress: '{{done}}/{{total}} steps completed',
    setupReset: 'Reset',
    setupResetA11y: 'Reset setup checklist',
    setupStepA11y: 'Step {{n}}: {{step}}',
    setupAutoNote:
      'The app prepares all of this automatically when creating the game; this list explains what each player would do with the physical cards.',
    setupStepWarlord: 'Take a random Warlord card.',
    setupStepHorde:
      'Shuffle the {{hordes}} Horde cards and form the Horde deck with the Warlord on top (back side up).',
    setupStepMarket:
      'Shuffle the 15 Market cards and place them face down; reveal the first 4 next to the deck.',
    setupStepSoloHero:
      'Choose your main Hero and prepare the 3 allies (cards 1-6 of each class + special card).',
    setupStepSoloScenarios:
      'Separate the scenarios with the "solo cooperative" icon from the Scenario deck.',
    setupStepMulticlassHero:
      'Each player chooses a Hero and two Ability decks from different classes; combine them.',
    setupStepBaseHero: 'Each player chooses a Hero and their 15-card Ability deck.',
    setupStepDraw: 'Each player draws 5 cards from their Ability deck.',
    setupStepShields: 'Give 2 Shields to each player.',
    setupStepTokens: 'Place the tokens from the bag within reach (of everyone).',
    setupStepCoins: 'Prepare 10 pain-status Coins and 4 Glory tokens.',
  },
} as const;
