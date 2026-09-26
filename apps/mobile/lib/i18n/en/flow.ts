/** English strings for 'flow' — extracted from CreateGameFlow. */
export default {
  flow: {
    /** Custom pool source (Horde/Warlords/Market): official content */
    poolSourceOfficial: 'Official',
    /** Custom pool source (Horde/Warlords/Market): Workshop content */
    poolSourceCustom: 'Custom',
    /** Icon shown before the "players" datum on a mode card */
    iconPlayers: '👥',
    /** Icon shown before the "duration" datum on a mode card */
    iconDuration: '◷',
    /** Filled dot of the complexity indicator (●●○) */
    complexityDotFilled: '●',
    /** Empty dot of the complexity indicator (●●○) */
    complexityDotEmpty: '○',
    /** Button that removes a participant */
    countDecrement: '−',
    /** Button that adds a participant */
    countIncrement: '+',
    /** Placeholder when a summary value has no content yet */
    noValue: '—',
    /** "label: value" separator (e.g. "P1: Dunar") */
    labelSeparator: ': ',
    /** Middle-dot separator between summary/stepper fragments */
    dotSeparator: ' · ',
    /** Separator between the main class and the second class (multiclass) */
    plusSeparator: ' + ',
    /** Arrow shown before "Cancel" in the wizard header */
    backArrow: '←',
    /** Completed-step mark in the stepper */
    stepDone: '✓',
    /** Icon shown before the current step error */
    warningIcon: '⚠',
    /** Separator between two sentences in accessibility labels */
    sentenceSeparator: '. ',
    /** Trailing period appended to each validation reason in the summary */
    sentenceEnd: '.',
    /** "current copies/required size" counter of an incomplete deck */
    deckCount: '{{total}}/{{size}}',
  },
} as const;
