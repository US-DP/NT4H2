/** English strings for 'profile' — Profile & accessibility screen. */
export default {
  profile: {
    title: 'Profile & accessibility',
    saved: '✓ Preferences saved',
    back: 'Back',
    cancel: 'Cancel',
    accept: 'OK',
    reset: 'Reset',
    import: 'Import',
    always: '✓ Always',
    percentA11y: '{{value}} percent',

    /* Sections */
    secProfile: 'Profile',
    secText: 'Text & display',
    secColor: 'Colour & contrast',
    secMotion: 'Motion',
    secSound: 'Sound & feedback',
    secInteraction: 'Interaction',
    secGame: 'Game',
    secScreenReader: 'Screen reader',
    secActions: 'Actions',
    secPortability: 'Portability',
    secDiagnostics: 'Diagnostics',

    /* Profile */
    displayName: 'Display name',
    displayNameHint: 'Used when you join online rooms',
    namePlaceholder: 'Your name',
    language: 'Language',
    langSystem: 'System',
    langEs: 'Español',
    langEn: 'English',

    /* Text & display */
    useSystemTextSize: 'Use device text size',
    useSystemTextSizeHint: 'Follows the system setting instead of the option chosen below',
    systemSizeOverride: 'Overridden by the device setting',
    fontSize: 'Text size',
    fsDefault: 'Default · 100 %',
    fsLarge: 'Large · 115 %',
    fsXlarge: 'Very large · 130 %',
    fsXxlarge: 'Extra large · 150 %',
    fsMax: 'Maximum · 200 %',
    density: 'Interface density',
    densityHint: 'Controls the spacing between elements and how much information is shown',
    densityCompact: 'Compact',
    densityStandard: 'Standard',
    densityComfortable: 'Comfortable',
    densityWide: 'Extra wide',
    boldText: 'Bold text',
    boldTextHint: 'Increases text weight to improve readability',
    legibleFont: 'High-legibility font',
    legibleFontHint: 'Typeface with more distinct shapes (I/l/1, O/0, rn/m)',
    extraSpacing: 'Increase text spacing',
    extraSpacingHint: 'Adds space between lines, words and characters',
    previewLabel: 'Preview',

    /* Preview */
    previewCardTitle: 'Sample card',
    previewCardBody:
      'Forest Guardian — Attack 8 · Defence 6.\nGains +2 defence during the next turn.',
    previewButton: 'Primary action',
    previewSecondary: 'Secondary information',

    /* Colour & contrast */
    highContrast: 'High contrast',
    highContrastHint:
      'Increases the difference between text, controls and background to improve legibility',
    notColorOnly: 'Do not rely on colour alone',
    notColorOnlyHint:
      'Important states combine colour with icons, borders and text. Always on.',
    colorMode: 'Colour mode',
    colorModeHint: 'Adjusts the semantic palette for colour deficiencies',
    cmDefault: 'Default',
    cmProtanopia: 'Protanopia',
    cmDeuteranopia: 'Deuteranopia',
    cmTritanopia: 'Tritanopia',
    cmMonochrome: 'Monochrome',

    /* Motion */
    reduceMotion: 'Reduce motion',
    reduceMotionHint:
      'Replaces intense animations with simpler transitions and direct changes',
    noFlashes: 'Avoid flicker and flashes',
    noFlashesHint:
      'There is no content with dangerous flashes. The celebration is disabled with "Reduce motion".',
    autoPlay: 'Play animations automatically',
    autoPlayHint: 'Decorative and celebration animations',

    /* Sound & feedback */
    volMaster: 'Master volume',
    volMusic: 'Music volume',
    volEffects: 'Effects volume',
    vibration: 'Vibration',
    vibrationHint: 'Vibrates on alerts and during certain events',
    haptics: 'Haptic feedback',
    hapticsHint: 'Brief vibration when selecting cards, playing or making a mistake',
    hapticIntensity: 'Haptic feedback intensity',
    hiOff: 'Off',
    hiLight: 'Light',
    hiMedium: 'Medium',
    hiStrong: 'Strong',
    testHaptics: 'Test haptic feedback',

    /* Interaction */
    controlSize: 'Button and control size',
    controlSizeHint: 'Increases the touch area of buttons, switches and controls',
    csNormal: 'Normal',
    csLarge: 'Large',
    csXlarge: 'Extra large',
    dragSensitivity: 'Drag sensitivity',
    dragSensitivityHint: 'Distance needed to play a card by dragging it',
    dsLow: 'Low',
    dsMedium: 'Medium',
    dsHigh: 'High',
    holdToConfirm: 'Hold for important actions',
    holdToConfirmHint: 'Requires press-and-hold before actions that cannot be undone',
    gestureAlt: 'Always show an alternative to gestures',
    gestureAltHint:
      'Every drag interaction also offers tap-to-select and confirm',

    /* Game */
    orientation: 'Orientation on the game board',
    orientationHint:
      'Landscape is recommended for the board; you can continue in portrait if you prefer',
    orLandscape: 'Landscape (recommended)',
    orPortrait: 'Portrait',
    orAuto: 'Automatic',
    followPhase: 'Switch to the current phase tab',
    followPhaseHint:
      'On narrow screens the board switches tabs when the phase changes; if disabled, the chosen tab is kept',
    hordeSummary: 'Horde attack summary',
    hordeSummaryHint: 'When to automatically open the Horde damage breakdown',
    hsAlways: 'Always',
    hsModifiers: 'Only with modifiers',
    hsNever: 'Never (manual button)',
    shortcuts: 'Keyboard shortcuts (web)',
    shortcutsHint: '1-5 tabs · H/E/C panels · ← → select card · Enter play · Esc close',

    /* Screen reader */
    srAnnounce: 'Announce important changes',
    srAnnounceHint: 'E.g.: "Card selected", "Move not allowed", "Your turn"',
    srExpanded: 'Read expanded descriptions',
    srExpandedHint: 'Cards announce type, class and full stats',
    srPositions: 'Announce positions in lists',
    srPositionsHint: 'E.g.: "Card 2 of 7" when browsing the hand or history',

    /* Actions */
    applyRecommended: 'Apply recommended settings',
    applyRecommendedHint: 'Large text, high contrast, reduced motion and large controls',
    resetA11y: 'Reset accessibility settings',
    resetA11yHint:
      'Restores text, contrast, motion, sound and interaction to their defaults. Does not touch your profile.',
    resetDesc:
      'Text, contrast, motion, sound and interaction will be reset. Saved games and your profile are not affected.',

    /* Portability */
    exportSettings: 'Export settings',
    exportSettingsHint:
      'Saves your preferences as a .json file to take them to another device.',
    importSettings: 'Import settings',
    importSettingsHint:
      'Applies the preferences from an exported file. You will see a summary before applying.',
    exported: 'Settings exported',
    exportFailed: 'Could not export',
    importInvalid: 'Invalid file',
    importSummary: '{{count}} settings will be imported.',
    importMore: '\n… and {{count}} more',
    importErrorTitle: 'Could not import settings',

    /* Storage: per-category size labels */
    szSavedGames: 'Saved games',
    szTrash: 'Trash',
    szWorkshop: 'Workshop content',
    szWorkshopHistory: 'Workshop history & versions',
    szDrafts: 'Card drafts',
    szCollection: 'Collection',
    szSettings: 'Settings',
    szHistory: 'Match history',
    szRoomSession: 'Room session',
    trashCountA11y: 'Empty the trash ({{n}} games)',
    clearSavesA11y: 'Delete all saved games ({{n}})',

    /* Diagnostics */
    diagEngine: 'Rules engine',
    diagRuleset: 'Ruleset',
    diagCatalog: 'Catalogue',
    diagPlatform: 'Platform',
    diagConnection: 'Connection',
    diagSaved: 'Saved games',
    diagSets: 'Custom sets',
    diagOnline: 'Online ({{room}})',
    diagRoom: 'room',
    diagLocal: 'Local',
    copyDiag: 'Copy diagnostics',
    copyDiagA11y: 'Copy diagnostics (no private data)',
    diagCopied: 'Diagnostics copied',

    /* Dev */
    showcase: 'Component showcase (dev)',
    showcaseA11y: 'Open component showcase',
  },
} as const;
