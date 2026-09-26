/**
 * Tipos del estado del juego, comandos y eventos.
 * El estado es un snapshot inmutable; los eventos son hechos inmutables.
 */

import type { CapabilityIcon, Zone, Reward, CardEffect, ContentSet } from './card.js';

// ============================================================================
// Fases del juego
// ============================================================================

export const PHASES = [
  'SETUP',
  'INITIAL_PLAYER_SELECTION',
  'TURN_START',
  'ATTACK_CHOICE',
  'PLAYER_ATTACK',
  'RESOLVING_CARD',
  'WAITING_FOR_CHOICE',
  'HORDE_ATTACK',
  'MARKET',
  'RESTORATION',
  'BATTLEFIELD_REPLENISHMENT',
  'SCENARIO_TRANSITION',
  'TURN_END',
  'GAME_END_CHECK',
  'FINISHED',
] as const;

export type Phase = (typeof PHASES)[number];

// ============================================================================
// Modos de juego
// ============================================================================

export type GameMode = 'STANDARD' | 'SOLO' | 'MULTICLASS';

// ============================================================================
// Carta en juego (instancia)
// ============================================================================

export interface CardInstance {
  instanceId: string;
  definitionId: string;
  ownerId: string;
  zone: Zone;
  /** Nombre de la carta (para búsquedas por nombre sin catálogo) */
  name?: string;
  /** Para cartas persistentes (Trampa), el disparador que las activa */
  persistentTrigger?: string;
}

// ============================================================================
// Modificador activo
// ============================================================================

export type ModifierLayer =
  | 'BASE_CHARACTERISTICS'
  | 'FORTITUDE_MODIFIERS'
  | 'DAMAGE_BONUS'
  | 'ENEMY_OUTGOING_DAMAGE'
  | 'PREVENTION'
  | 'CANCELLATION'
  | 'MARKET_COST';

export interface Modifier {
  id: string;
  sourceId: string; // carta o escenario que lo creo
  layer: ModifierLayer;
  timestamp: number; // contador monotonico
  duration: 'INSTANT' | 'UNTIL_END_OF_TURN' | 'HORDE_ATTACK' | 'NEXT_HORDE_ATTACK' | 'WHILE_SOURCE_ACTIVE' | 'PERMANENT';
  amount: number;
  targetId?: string; // enemigo o jugador especifico
  filter?: { name?: string };
  scope?: 'THIS_TURN' | 'NEXT_CARD';
  conditionMet?: boolean;
}

// ============================================================================
// Estado de un enemigo en el campo de batalla
// ============================================================================

export interface EnemyState {
  instanceId: string;
  definitionId: string;
  baseFortitude: number;
  effectiveFortitude?: number; // Calculado por applyModifiers
  wounds: number;
  reward: Reward | null; // null = no revelado
  modifiers: Modifier[];
  isWarlord: boolean;
  isOrc: boolean;
  specialIcons: string[];
  /** Enemigos cuyo dano esta deshabilitado este turno */
  damageDisabled: boolean;
  /** Estados aplicados (Marca, Veneno, Aturdimiento…). Ids libres del Taller;
   *  el motor da semántica a 'mark' (+N daño y se consume), 'stun' (salta el
   *  próximo ataque de la Horda) y 'poison' (tick de daño en la Horda). */
  statuses?: EnemyStatus[];
}

/** Instancia de estado sobre un enemigo */
export interface EnemyStatus {
  id: string;
  stacks: number;
  /** Duración: PERMANENT (hasta que se consuma/retire) o hasta el fin del turno */
  duration?: 'PERMANENT' | 'UNTIL_END_OF_TURN';
}

// ============================================================================
// Estado de un jugador
// ============================================================================

export interface PlayerState {
  playerId: string;
  heroId: string;
  heroFace: 'FEMALE' | 'MALE';
  heroUsesRemaining: number;
  heroMaxUses: number;
  glory: number;
  coins: number;
  wounds: number;
  maxWounds: number;
  capabilities: CapabilityIcon[];
  abilityDeck: CardInstance[];
  hand: CardInstance[];
  wearPile: CardInstance[];
  trophies: string[]; // instanceIds de enemigos derrotados
  shields: number;
  prevention: number; // dano prevenido pendiente
  /** Armadura (GRANT_ARMOR): reduce CADA instancia de daño en N hasta fin de turno */
  armor: number;
  /** Bloqueo (BLOCK_NEXT_DAMAGE): cancela hasta N del PRÓXIMO daño recibido */
  blockNext?: number;
  damageCancellation: boolean; // Aura Protectora
  /** playerId del heroe que intercepta el dano de este ataque (Valerys) */
  interceptedBy: string | null;
  /** D370: Cartas pujadas para la elección de Líder (instanceIds) */
  leaderBidCards?: string[];
  modifiers: Modifier[];
  /** Conteo de cartas jugadas este turno por nombre */
  cardsPlayedThisTurn: Record<string, number>;
  /** Conteo de cartas jugadas contra cada enemigo por nombre */
  cardsPlayedAgainstEnemy: Record<string, Record<string, number>>;
  /** Edad del jugador (para desempate del Líder) */
  playerAge?: number;
  /** Cartas persistentes frente al jugador (Trampa) */
  persistentCards: CardInstance[];
  /** Mazos de apoyo (modo solitario) */
  supportDecks: CardInstance[][];
  /** Numero de mazos de Apoyo abiertos (modo solitario) */
  supportDecksOpened?: number;
  /** Cartas robadas de Apoyo este turno (modo solitario) */
  supportCardsDrawnThisTurn?: number;
  /** Ficha de Evasión gastada (regla oficial: una vez por partida) */
  evasionTokenUsed?: boolean;
  /** Índice del mazo de Apoyo usado este turno (null = ninguno) */
  supportDeckIndexUsedThisTurn?: number | null;
  /** Cartas robadas de Apoyo que deben devolverse al mazo al final del turno (D349) */
  borrowedSupportCardIds?: string[];
  /** Ya se uso una carta de Apoyo este turno (spec §4.2: elegir 1 para usar) */
  supportCardUsedThisTurn?: boolean;
  /** Decisión de la Pericia de Feldon para el ataque de Horda en curso
   *  (spec §6.8: 1 uso discrecional). undefined = aún no preguntado */
  feldonDecision?: 'HALVE' | 'DECLINE';
}

// ============================================================================
// Estado completo del juego
// ============================================================================

export interface GameState {
  phase: Phase;
  mode: GameMode;
  activePlayerId: string;
  turnNumber: number;
  players: Record<string, PlayerState>;
  playerOrder: string[]; // orden de turnos
  battlefield: EnemyState[];
  hordeDeck: CardInstance[];
  market: CardInstance[];
  marketDeck: CardInstance[];
  scenario: CardInstance | null;
  scenarioDeck: CardInstance[];
  /** Monedas colocadas sobre el escenario activo (modo solitario) */
  scenarioCoins: number;
  warlordRevealed: boolean;
  warlordDefeated: boolean;
  /** D355: Número de Señores de la Guerra derrotados (multiclase: 2) */
  warlordsDefeatedCount: number;
  pendingChoices: PendingChoice[];
  eventLog: GameEvent[];
  monotonicCounter: number;
  rngState: { seed: string; state: number };
  /** Modificador global de coste de mercado (Mercado de Lotharion) */
  marketCostModifier: number;
  /** Indica si el escenario actual ignora recompensas de monedas (Planicie de Skaarg) */
  ignoreCoinRewards: boolean;
  /** Indica si el escenario actual ignora Gloria de recompensas (Ruinas de Brunmar) */
  ignoreGloryRewards: boolean;
  /** Bonus de fortaleza a orcos (Roghkiller) */
  orcFortitudeBonus: number;
  /** Número de cartas descartadas en la evasión actual (temporal, para EVASION_DISCARDED_COUNT) */
  evasionDiscardedCount?: number;
  /** Variables de partida del Taller (SET_VARIABLE scope GAME) */
  customVars?: Record<string, number>;
  /** Oyentes registrados por cartas (REGISTER_LISTENER): efectos que se
   *  disparan cuando ocurre un tipo de GameEvent. */
  listeners?: CardListener[];
}

/** Oyente de eventos registrado por una carta del Taller. */
export interface CardListener {
  id: string;
  /** Jugador dueño del oyente (sus efectos se resuelven con ese héroe como SELF) */
  playerId: string;
  /** Tipo de GameEvent que lo dispara (p.ej. 'ENEMY_DEFEATED', 'DAMAGE_DEALT') */
  trigger: string;
  /** Se retira tras la primera activación */
  once?: boolean;
  /** THIS_TURN se limpia al inicio del turno; GAME persiste toda la partida */
  duration?: 'THIS_TURN' | 'GAME';
  /** Etiqueta para REMOVE_LISTENER */
  tag?: string;
  effects: CardEffect[];
}

// ============================================================================
// Eleccion pendiente (decision del jugador)
// ============================================================================

export interface PendingChoice {
  choiceId: string;
  playerId: string;
  type: 'SELECT_ENEMY' | 'SELECT_CARD_FROM_HAND' | 'SELECT_CARD_FROM_WEAR' |
        'SELECT_HERO' | 'SELECT_ORDER' | 'CONFIRM' | 'SELECT_CARDS_FOR_LEADER' |
        'SEARCH_DECK' | 'SEARCH_MARKET_DECK' | 'SELECT_FROM_MARKET' | 'REACTION_WINDOW' |
        'SELECT_COINS_TO_STEAL' | 'CHOOSE_EFFECT';
  prompt: string;
  options: string[]; // instanceIds o ids validos
  minSelections: number;
  maxSelections: number;
  /** Contexto de resolucion que originó la eleccion */
  resolutionContext?: ResolutionContext;
  /** IDs de cartas relacionadas para elecciones multi-paso (ej: Aranel, Neddia) */
  relatedCardIds?: string[];
  /** La elección nació de la ventana de reacción de la Horda (D371):
   *  la fase espera a resolverla antes de procesar el ataque. Marca
   *  explícita — no depender de prefijos en choiceId. */
  fromReactionWindow?: boolean;
}

// ============================================================================
// Contexto de resolucion de una carta
// ============================================================================

export interface ResolutionContext {
  activePlayerId: string;
  currentCardId: string;
  currentCardName: string;
  currentCardInstanceId: string;
  selectedEnemyId: string | null;
  cardsPlayedThisTurn: Record<string, number>;
  cardsPlayedAgainstEnemy: Record<string, Record<string, number>>;
  drawnCardInstanceId: string | null;
  sourceZone: Zone;
  enemiesDefeatedThisResolution: string[];
  depth: number;
  /** Número de cartas descartadas en la evasión actual (para Taheral/condiciones) */
  evasionDiscardedCount?: number;
  /** Fortaleza del último enemigo derrotado (para ON_ENEMY_DEFEATED) */
  lastDefeatedEnemyFortitude?: number;
  /** ID del jugador que derrotó al último enemigo (para DEFEATING_HERO) */
  defeatingPlayerId?: string;
  /** Héroe elegido por el jugador en caso de empate (HERO_WITH_FEWEST_WOUNDS) */
  chosenHeroTarget?: string | null;
  /** Enemigo elegido por el jugador en caso de empate (ENEMY_WITH_MAX_FORTITUDE) */
  chosenEnemyTarget?: string | null;
  /** Carta del desgaste elegida por el jugador (SEARCH_WEAR_PILE_PUT_IN_HAND) */
  chosenWearCardId?: string | null;
  /** Contador mutable de operaciones resueltas (presupuesto anti-bucle, §18 Taller) */
  opsUsed?: number;
  /** Variables de resolución del Taller (SET_VARIABLE scope RESOLUTION) */
  variables?: Record<string, number>;
  /** Ramas de una eleccion CHOOSE_ONE pendiente (efectos por opcion) */
  choiceEffects?: CardEffect[][];
  /** Efectos restantes tras una eleccion CHOOSE_ONE (se ejecutan tras resolverla) */
  pendingEffects?: CardEffect[];
  /** Destino de la carta en juego (destinationAfterUse) — lo copia resolveCard
   *  para que RESOLVE_CHOICE no dependa de que la carta esté en el catálogo */
  destinationAfterUse?: 'WEAR_PILE' | 'REMOVED_FROM_GAME' | 'STAYS_IN_PLAY' | string;
  /** Héroe iterado por un nodo FOR_EACH (SELF dentro apunta aquí) */
  forEachHeroId?: string | null;
  /** Enemigos cuyo estado 'mark' ya se consumió en esta resolución */
  consumedMarks?: string[];
}

// ============================================================================
// Comandos (intenciones del jugador)
// ============================================================================

/** `actorId` — jugador al que se atribuye el comando en replay/event
 *  sourcing (p.ej. pericia reactiva de un jugador no activo). En modo
 *  online el transporte lo sobrescribe con el playerId autenticado: el
 *  cliente no puede usarlo para suplantar a otro jugador. */
export type Command =
  | { type: 'PLAY_CARD'; cid: string; actorId?: string; cardInstanceId: string; targetEnemyId?: string }
  | { type: 'END_ATTACK'; cid: string; actorId?: string }
  | { type: 'EVASION'; cid: string; actorId?: string; discardedCardInstanceIds: string[] }
  | { type: 'BUY_CARD'; cid: string; actorId?: string; marketCardInstanceId: string }
  | { type: 'END_TURN'; cid: string; actorId?: string }
  | { type: 'USE_HERO_ABILITY'; cid: string; actorId?: string; targetId?: string }
  | { type: 'CHOOSE_LEADER_CARDS'; cid: string; actorId?: string; cardInstanceIds: string[] }
  | { type: 'RESOLVE_CHOICE'; cid: string; actorId?: string; choiceId: string; selectedIds: string[] }
  | { type: 'PASS'; cid: string; actorId?: string }
  | { type: 'SWAP_STARTING_CARDS'; cid: string; actorId?: string; cardInstanceIds: string[] }
  | { type: 'ACCEPT_TURN_START_EFFECT'; cid: string; actorId?: string; accepted: boolean }
  | { type: 'OPEN_SUPPORT_DECK'; cid: string; actorId?: string; supportDeckIndex: number }
  | { type: 'BUY_SUPPORT_CARD'; cid: string; actorId?: string; supportDeckIndex: number; payment: { type: 'GLORY'; amount: number } | { type: 'COINS'; amount: number } };

// ============================================================================
// Configuracion de partida
// ============================================================================

export interface GameConfig {
  mode: GameMode;
  playerCount: number;
  seed: string;
  heroes: {
    playerId: string;
    heroId: string;
    heroFace: 'FEMALE' | 'MALE';
    deckId: string;
    secondDeckId?: string;
    playerAge?: number;
    /** Mazo personalizado (id dentro de customDecks). Si se indica, sustituye a deckId. */
    customDeckId?: string;
  }[];
  /** Mazos personalizados resolubles por customDeckId (snapshot en la config). */
  customDecks?: { id: string; cardDefinitionIds: string[] }[];
  useScenarios: boolean;
  /** IDs de cartas de escenario a usar (null = todas) */
  scenarioIds?: string[];
  /** IDs de cartas de mercado seleccionadas (modo solitario) */
  soloMarketCardIds?: string[];
  /** Mazos de apoyo (modo solitario) */
  soloSupportHeroIds?: string[];
  /** Pool de Huestes personalizado (ids de definición HORDE del catálogo
   *  fusionado). Si se indica, sustituye al pool oficial de 27 cartas. */
  hordeCardIds?: string[];
  /** Pool de Señores de la Guerra (ids WARLORD). Por defecto todos. */
  warlordIds?: string[];
  /** Pool de Mercado personalizado (ids MARKET). Por defecto todos. */
  marketCardIds?: string[];
  /** Conjuntos del Taller como snapshot: el servidor los valida y fusiona
   *  con el catálogo oficial solo para esta partida (partidas online). */
  customSets?: ContentSet[];
}

// ============================================================================
// Eventos (hechos inmutables)
// ============================================================================

export type GameEvent =
  | { type: 'CARD_PLAYED'; playerId: string; cardInstanceId: string; cardDefinitionId: string; cardName?: string; targetEnemyInstanceId?: string; seq: number }
  | { type: 'DAMAGE_DEALT'; targetId: string; amount: number; sourceCardInstanceId: string; seq: number }
  | { type: 'WOUND_PLACED'; enemyInstanceId: string; amount: number; seq: number }
  | { type: 'ENEMY_DEFEATED'; enemyInstanceId: string; enemyDefinitionId: string; defeatingPlayerId: string; reward: Reward; seq: number }
  | { type: 'CARDS_DRAWN'; playerId: string; count: number; cardInstanceIds: string[]; seq: number }
  | { type: 'CARDS_LOST'; playerId: string; count: number; cardInstanceIds: string[]; seq: number }
  | { type: 'CARDS_RECOVERED'; playerId: string; count: number; cardInstanceIds: string[]; toZone: Zone; seq: number }
  | { type: 'GLORY_GAINED'; playerId: string; amount: number; seq: number }
  | { type: 'GLORY_LOST'; playerId: string; amount: number; seq: number }
  | { type: 'COINS_GAINED'; playerId: string; amount: number; seq: number }
  | { type: 'COINS_STOLEN'; fromPlayerId: string; toPlayerId: string; amount: number; seq: number }
  | { type: 'WOUND_HEALED'; playerId: string; amount: number; seq: number }
  | { type: 'CARD_MOVED'; cardInstanceId: string; from: Zone; to: Zone; seq: number; toPlayerId?: string; playerId?: string }
  | { type: 'HORDE_DECK_REORDERED'; newOrder: string[]; seq: number }
  | { type: 'CARD_REMOVED_FROM_GAME'; cardInstanceId: string; seq: number }
  | { type: 'HORDE_ATTACKED'; playerId: string; totalDamage: number; seq: number }
  | { type: 'ENEMY_REVEALED'; enemyInstanceId: string; definitionId: string; fortitude: number; enemy?: EnemyState; seq: number }
  | { type: 'WARLORD_REVEALED'; warlordInstanceId: string; definitionId: string; seq: number }
  | { type: 'MARKET_PURCHASED'; playerId: string; cardInstanceId: string; cost: number; seq: number }
  | { type: 'MARKET_REPLENISHED'; cardInstanceId: string; seq: number }
  | { type: 'SCENARIO_REVEALED'; scenarioInstanceId: string; definitionId: string; seq: number }
  | { type: 'SCENARIO_DISCARDED'; scenarioInstanceId: string; seq: number }
  | { type: 'TURN_STARTED'; playerId: string; turnNumber: number; seq: number }
  | { type: 'TURN_ENDED'; playerId: string; seq: number }
  | { type: 'PHASE_CHANGED'; phase: Phase; seq: number }
  | { type: 'HERO_ABILITY_USED'; playerId: string; usesRemaining: number; seq: number }
  | { type: 'PREVENTION_APPLIED'; playerId: string; amount: number; seq: number }
  | { type: 'ENEMY_DAMAGE_DISABLED'; enemyInstanceId: string; seq: number }
  | { type: 'MODIFIER_ADDED'; modifierId: string; targetId: string; layer: string; amount?: number; sourceId?: string; duration?: string; filter?: { name?: string }; scope?: 'THIS_TURN' | 'NEXT_CARD'; seq: number }
  | { type: 'MODIFIER_EXPIRED'; modifierId: string; seq: number }
  | { type: 'HERO_WOUNDED'; playerId: string; woundCount: number; seq: number }
  | { type: 'DECK_EXHAUSTED'; playerId: string; seq: number }
  | { type: 'DECK_RESHUFFLED'; playerId: string; newDeckSize: number; newOrder?: string[]; seq: number }
  | { type: 'DECK_SHUFFLED'; playerId: string; deck: 'ABILITY' | 'MARKET' | 'HORDE'; newOrder: string[]; seq: number }
  | { type: 'GAME_ENDED'; winnerId: string | null; scores: Record<string, number>; seq: number }
  | { type: 'EVASION_PERFORMED'; playerId: string; discardedCardInstanceIds: string[]; seq: number }
  | { type: 'LEADER_DETERMINED'; playerId: string; seq: number }
  | { type: 'LEADER_TIE_BREAK'; tiedPlayerIds: string[]; winnerId: string; method: 'AGE' | 'RANDOM_SEEDED'; seq: number }
  | { type: 'VULNERABILITY_APPLIED'; enemyInstanceId: string; bonus: number; seq: number }
  | { type: 'SHIELD_PLACED'; playerId: string; amount: number; seq: number }
  | { type: 'SHIELD_TRANSFERRED'; fromPlayerId: string; toPlayerId: string; amount: number; targetEnemyId?: string; seq: number }
  | { type: 'CANCELLATION_ACTIVATED'; playerId: string; seq: number }
  | { type: 'PERSISTENT_CARD_PLACED'; playerId: string; cardInstanceId: string; cardDefinitionId: string; trigger: string; seq: number }
  | { type: 'PERSISTENT_CARD_REMOVED'; cardInstanceId: string; seq: number }
  | { type: 'ENEMY_SWAPPED'; oldEnemyInstanceId: string; newEnemyInstanceId: string; newEnemyDefinitionId: string; newEnemyFortitude: number; newEnemyReward: Reward | null; newEnemyIsOrc: boolean; newEnemyIsWarlord: boolean; newEnemySpecialIcons: string[]; seq: number }
  | { type: 'ENEMY_RETURNED_TO_HORDE'; enemyInstanceId: string; position: 'BOTTOM' | 'TOP'; seq: number }
  | { type: 'DAMAGE_INTERCEPTED'; interceptorPlayerId: string; originalTargetPlayerId: string; amount: number; seq: number }
  | { type: 'CARDS_REVEALED_TO_PLAYER'; playerId: string; cardInstanceIds: string[]; deck: 'HORDE' | 'ABILITY' | 'MARKET'; seq: number }
  | { type: 'SUPPORT_DECK_OPENED'; playerId: string; supportDeckIndex: number; seq: number }
  | { type: 'RESOLUTION_HALTED'; cardInstanceId?: string; reason: string; seq: number }
  // Extensiones del Taller (fase 1+)
  | { type: 'STATUS_APPLIED'; enemyInstanceId: string; status: string; stacks: number; duration?: 'PERMANENT' | 'UNTIL_END_OF_TURN'; seq: number }
  | { type: 'STATUS_REMOVED'; enemyInstanceId: string; status: string; seq: number }
  | { type: 'ARMOR_GRANTED'; playerId: string; amount: number; seq: number }
  | { type: 'HORDE_CARD_DISCARDED'; cardInstanceId: string; seq: number }
  | { type: 'ENEMY_SPAWNED'; enemyInstanceId: string; enemyDefinitionId: string; enemyFortitude: number; enemyReward: Reward | null; enemyIsOrc: boolean; enemyIsWarlord: boolean; enemySpecialIcons: string[]; seq: number }
  // Extensiones del Taller (fase 2)
  | { type: 'VARIABLE_SET'; name: string; value: number; seq: number }
  | { type: 'BLOCK_GRANTED'; playerId: string; amount: number; seq: number }
  | { type: 'BLOCK_CONSUMED'; playerId: string; seq: number }
  | { type: 'LISTENER_REGISTERED'; listener: CardListener; seq: number }
  | { type: 'LISTENER_REMOVED'; listenerId: string; seq: number }
  // Limpiezas de ciclo de vida: el reducer reproduce la misma transformación
  // determinista que el camino directo (event sourcing §51.12)
  | { type: 'EFFECTS_EXPIRED'; scope: 'HORDE_ATTACK_END' | 'RESTORATION' | 'TURN_END'; seq: number }
  | { type: 'PENDING_CHOICES_REMOVED'; choiceIds: string[]; seq: number }
  | { type: 'TROPHY_REMOVED'; playerId: string; trophyInstanceId: string; seq: number };
