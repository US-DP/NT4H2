/** English strings for 'lobby' — waiting room (app/(room)) and chat panel (ChatPanel). */
export default {
  lobby: {
    /** Default visible player name */
    player: 'Player',
    /** Sender of automatic room log entries */
    system: 'System',
    /** Alias for the current user in the optimistic chat echo */
    you: 'You',
    /** Suffix next to the host's name in the player list */
    hostSuffix: ' (Host)',
    /** Suffix next to the current player's name in the list */
    youSuffix: ' — you',
    /** Join form validation: empty room code */
    errRoomCode: 'Enter the room code',
    /** Join form validation: name too short */
    errPlayerName: 'Name must be at least 2 characters long',
    /** Error fetching the room state over REST */
    errLoadRoom: 'Could not load the room',
    /** Error requesting the ephemeral WebSocket ticket */
    errWsAuth: 'Could not authenticate the real-time connection',
    /** Generic lobby WebSocket error */
    errWs: 'WebSocket connection error',
    /** The backend rejects the join because the player is banned (D440) */
    errKicked: 'You have been kicked from this room',
    /** Fallback when joining the room without a server message */
    errJoin: 'Could not join',
    /** Fallback when starting the game without a server message */
    errStart: 'Could not start',
    /** Fallback when kicking a player without a server message */
    errKick: 'Could not kick',
    /** Fallback when lifting a kicked player's ban */
    errUnkick: 'Could not allow them back',
    /** Fallback when transferring the host role */
    errTransfer: 'Could not transfer',
    /** Fallback when closing the room */
    errClose: 'Could not close',
    /** Fallback when toggling the "ready" state */
    errReady: 'Could not update',
    /** Generic error when the exception carries no message */
    errGeneric: 'Error',
  errChatOffline: 'No connection — message not sent',
    /** Log entry: game command received via broadcast */
    // (sysCommand eliminada: el lobby ya no muestra eco de comandos)
    /** Toast when the user receives the host role */
    youAreHost: 'You are now the host',
    /** Placeholder for the name field when joining a room */
    namePlaceholder: 'Your name',
    /** Accessible label for a player's ⋯ moderation button */
    playerOptions: 'Options for {{name}}',
    /** Accessible hint for the ⋯ button (opens transfer/kick) */
    modMenuHint: 'Opens the moderation menu: transfer host or kick',
    /** Accessible hint for the start button: pending players */
    notReadyHint: '{{n}} players are not ready yet',
    /** Accessible hint for the "Close room" button */
    closeRoomHint: 'Closes the room for all players',
    /** Detail of a catalog mismatch with the host */
    catalogIssue: "host catalog {{host}} ≠ yours {{local}}",
    /** Label for the hero picker when joining a room */
    pickHero: 'Choose your hero',
    /** Label for the class (deck) picker when joining a room */
    pickClass: 'Choose your class (deck)',
    /** Second class picker label in multiclass rooms (join flow) */
    pickSecondClass: 'Choose your second class',
    pickCustomDeck: 'Or use a Workshop deck',
    classDeck: 'Class deck',
    /** Join-form error: no hero selected */
    errPickHero: 'Pick a hero to play',
    /** Workshop custom deck label next to the name in the roster */
    workshopDeck: 'Workshop',
    chat: {
      /** Panel header title */
      title: 'Chat',
      /** Accessible label for the panel close button */
      hideChat: 'Hide chat',
      /** Empty state with no messages */
      empty: 'No messages yet.',
      /** Label for the SYSTEM message type next to the sender */
      typeSystem: 'System',
      /** Label for the CONNECTION message type next to the sender */
      typeConnection: 'Connection',
      /** Label for the MODERATION message type next to the sender */
      typeModeration: 'Moderation',
      /** Delivery state: own message in flight */
      sending: 'Sending…',
      /** Accessible label for the retry button on a failed message */
      retryA11y: 'Retry message: {{text}}',
      /** Delivery state: failed own message with retry action */
      notSentRetry: 'Not sent — Retry',
      /** Accessible label for the discard message button */
      discardA11y: 'Discard message: {{text}}',
      /** Action to discard a pending/failed message */
      discard: 'Discard',
      /** Accessible label for the mute sender button */
      muteA11y: 'Mute {{sender}}',
      /** Action to mute a sender */
      mute: 'Mute',
      /** Accessible label for the quick messages row */
      quickRow: 'Quick messages',
      /** Accessible label for each quick message chip */
      sendQuickA11y: 'Send "{{text}}"',
      /** Placeholder for the chat text field */
      placeholder: 'Type a message...',
      /** Accessible label for the chat text field */
      inputA11y: 'Chat message',
      /** Accessible label for the send button */
      sendA11y: 'Send message',
      /** Send button text */
      send: 'Send',
      /** UI-189 notice: no attachments in the MVP */
      noAttachments: 'Attachments are not available in the MVP.',
      /** Tactical quick message */
      qmGoodLuck: 'Good luck',
      /** Tactical quick message */
      qmOnIt: "I've got that one",
      /** Tactical quick message */
      qmWaitTurn: 'Wait for my turn',
      /** Tactical quick message */
      qmNeedHeal: 'I need healing',
      /** Tactical quick message */
      qmHitLeader: 'Attack the one with most Glory',
      /** Tactical quick message */
      qmSaveForWarlord: 'Save cards for the Warlord',
      /** Contextual ping */
      qmWatchEnemy: 'Watch that enemy',
      /** Contextual ping */
      qmMarket: 'Check the market',
      /** Contextual ping */
      qmNicePlay: 'Nice play',
      /** Ping contextual */
      qmHelpMe: 'I need help here',
    },
  },
} as const;
