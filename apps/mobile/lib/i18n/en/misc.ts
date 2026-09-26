/** English strings for 'misc' — assorted screens (_layout, content, showcase, home). */
export default {
  misc: {
    back: 'Back',
    cancel: 'Cancel',
    confirm: 'Confirm',

    /* _layout: Stack screen titles */
    screen: {
      index: 'No Time for Heroes',
      play: 'Play',
      create: 'New game',
      game: 'Game',
      rulebook: 'Rulebook',
      content: 'Content',
      stats: 'Stats',
      library: 'Collection',
      profile: 'Profile',
      room: 'Room',
      study: 'Workshop',
      showcase: 'Component showcase',
    },

    /* (content): installed content */
    installedTitle: 'Installed content',
    baseTitle: 'No Time for Heroes — Base game',
    baseMeta: '{{count}} definitions · official · {{size}}',
    baseNote: 'Always present — it cannot be removed or modified.',
    noSets:
      'No custom sets installed. Create them in the Workshop or import them from an invite.',
    published: 'Published',
    draft: 'Draft',
    setMeta: 'v{{version}} · {{author}} · {{cards}} cards · {{decks}} decks · {{size}}',
    versionsPublished: 'Published versions: {{count}}',
    versionsLatest: 'Latest: v{{version}}',
    export: 'Export',
    exportSet: 'Export {{name}}',
    exported: 'Set exported',
    exportFailed: 'Could not export',
    restoreSetA11y: 'Restore {{name}} to version {{version}}',
    restoreVersion: 'Restore v{{version}}',
    restored: 'Restored to v{{version}}',
    restoreFailed: 'Could not restore',
    confirmUninstallA11y: 'Confirm uninstall of {{name}}',
    uninstalled: 'Set uninstalled',
    uninstallSet: 'Uninstall {{name}}',
    uninstall: 'Uninstall',

    /* index (home): leftover hardcoded strings */
    loadGameA11y: 'Load game {{name}}',
    compatSnapshot: 'Snapshot: {{from}} → {{to}}',
    compatEngine: 'Engine: {{from}} → {{to}}',
    compatCatalog: 'Catalogue: {{from}} → {{to}}',

    /* (dev)/showcase: component showcase */
    showcase: {
      devOnlyTitle: 'Development builds only',
      devOnlyDesc: 'The component showcase is not part of the published app.',
      backA11y: 'Back to the previous screen',
      title: 'Component showcase',

      btnPrimary: 'Primary',
      btnSecondary: 'Secondary',
      btnDanger: 'Danger',
      btnGhost: 'Ghost',
      btnSmall: 'Small',
      btnLarge: 'Large',
      btnDisabled: 'Disabled',

      badgeNeutral: 'Neutral',
      badgeSuccess: 'Success',
      badgeWarning: 'Warning',
      badgeDanger: 'Danger',
      badgeInfo: 'Info',
      badgeAccent: 'Accent',

      panelSurface: 'Surface panel with border',
      panelModal: 'Modal-level panel',

      inputHero: 'Hero name',
      inputHeroPlaceholder: 'E.g. Lisavette',
      inputErrorLabel: 'With error',
      inputErrorValue: 'Deck of 14 cards',
      inputErrorMsg: 'The deck must have 15 cards',

      radioLabel: 'Game mode',
      modeSolo: 'Solo',
      modeSoloDesc: 'You against the hordes',
      modeLocal: 'Local',
      modeLocalDesc: 'Hot-seat on this device',
      modeOnline: 'Online',
      modeOnlineDesc: 'Room with other players',

      openDialog: 'Open dialog',
      openDialogA11y: 'Open sample dialog',
      dialogTitle: 'Leave the game',
      dialogDesc: 'Unsaved progress will be lost. Continue?',
      dialogLeave: 'Leave',

      openSheet: 'Open bottom sheet',
      openSheetA11y: 'Open sample bottom sheet',
      sheetTitle: 'Sample sheet',
      sheetBody: 'Non-critical content: filters, card detail, history, index.',

      showToast: 'Show notice',
      showToastA11y: 'Show sample toast notice',
      toastMsg: 'Game saved',
      toastUndo: 'Undo',

      errSendAction: 'Send message',
      errSendReason: 'Connection to the room was lost',
      errSendFix: 'Check your network and retry',
      retry: 'Retry',
      errJoinAction: 'Join the room',
      errJoinReason: 'The engine version differs',
      errJoinFix: 'Update the app',

      emptyTitle: 'No saved games',
      emptyDesc: 'When you save a game it will appear here.',
      emptyNew: 'New game',
      emptyRules: 'View rulebook',

      cardAttack: 'True Strike',
      cardArmor: 'Leather Armour',
      cardOrc: 'Orc Lancer',

      bannerMessage: 'Action not allowed in this phase',
      bannerInstruction: 'Play cards against the enemies on the field',

      chatSenderSystem: 'System',
      chatMsg1: 'Hi team',
      chatSystem: 'Ben was kicked',
      chatYou: 'You',
      chatFail: 'A sample failure',
    },
  },
} as const;
