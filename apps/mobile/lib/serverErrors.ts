/**
 * serverErrors — traduce los mensajes de error del backend.
 *
 * La API devuelve textos en inglés ("Room is full"). Antes de pintarlos
 * se mapean a claves i18n; los mensajes ya traducidos (Error lanzado con
 * t()) y los desconocidos pasan sin cambios para no perder información.
 */

type TFunction = (key: string, options?: Record<string, unknown>) => string;

const EXACT: Record<string, string> = {
  'Room is full': 'roomFull',
  'Room is not open': 'roomNotOpen',
  'Room is not in play': 'roomNotInPlay',
  'Room not found': 'roomNotFound',
  'Could not allocate room': 'roomAllocFailed',
  'Not enough players': 'notEnoughPlayers',
  'Not all players are ready': 'notAllReady',
  'All players must choose a hero': 'allMustPickHero',
  'Only the player can leave mid-game': 'onlySelfLeave',
  'Player not found': 'playerNotFound',
  'Player is not a member of this room': 'notMember',
  'Invalid player token': 'invalidPlayerToken',
  'Player was kicked': 'playerKicked',
  'Player is not kicked': 'playerNotKicked',
  'Target player is not connected': 'targetOffline',
  'targetId is required and cannot be the host': 'invalidTarget',
  'Too many requests': 'tooManyRequests',
  'Engine runner unavailable': 'engineUnavailable',
  'Engine unavailable': 'engineUnavailable',
  'Engine error': 'engineError',
  'customDeck id belongs to another player': 'customDeckNotYours',
  'Too many custom decks in room': 'tooManyCustomDecks',
  'Invalid customDeck': 'invalidCustomDeck',
  'Invalid game config': 'invalidGameConfig',
  'Join failed': 'joinFailed',
  'That name belongs to a registered account — log in to use it': 'nameRegistered',
  'name is required': 'nameRequired',
  'No active player': 'noActivePlayer',
};

const PREFIXES: [RegExp, string][] = [
  [/^Only the host can\b/, 'hostOnly'],
  [/^Invalid\b/, 'invalidData'],
  [/too large$/i, 'payloadTooLarge'],
  [/^too many /i, 'tooMany'],
];

const NETWORK =
  /Network request failed|Failed to fetch|fetch failed|was aborted|aborted/i;

/** Devuelve el texto listo para UI; nunca devuelve la clave sin resolver. */
export function serverErrorText(message: string, t: TFunction): string {
  const key = EXACT[message];
  if (key) return t(`misc.srvErr.${key}`);
  for (const [re, k] of PREFIXES) {
    if (re.test(message)) return t(`misc.srvErr.${k}`);
  }
  if (NETWORK.test(message)) return t('misc.srvErr.network');
  return message;
}
