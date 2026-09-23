/**
 * @nt4h/schema — Tipos compartidos del motor de No Time for Heroes.
 *
 * Este paquete define:
 * - CardEffect: union discriminada de todos los efectos de carta.
 * - Condition: condiciones para efectos condicionales.
 * - ValueExpr: expresiones de valor (constantes, conteos, sumas).
 * - TargetSelector / HeroSelector: selectores de objetivos.
 * - CardDefinition: definicion completa de una carta.
 * - Schemas Zod para validacion en runtime.
 */

import { z } from 'zod';

// ============================================================================
// Zonas del juego
// ============================================================================

export const ZoneSchema = z.enum([
  'ABILITY_DECK',
  'HAND',
  'WEAR_PILE',
  'BATTLEFIELD',
  'MARKET',
  'MARKET_DECK',
  'TROPHY',
  'REMOVED_FROM_GAME',
  'IN_FRONT_OF_PLAYER',
  'HORDE_DECK',
  'SCENARIO_DECK',
  'SCENARIO_ACTIVE',
]);
export type Zone = z.infer<typeof ZoneSchema>;

// ============================================================================
// Duraciones de efectos
// ============================================================================

export const EffectDurationSchema = z.enum([
  'INSTANT',
  'UNTIL_END_OF_TURN',
  'HORDE_ATTACK',
  'NEXT_HORDE_ATTACK',
  'WHILE_SOURCE_ACTIVE',
  'PERMANENT',
]);
export type EffectDuration = z.infer<typeof EffectDurationSchema>;

// ============================================================================
// Tipos de carta
// ============================================================================

export const CardTypeSchema = z.enum([
  'ABILITY',
  'HERO',
  'HORDE',
  'WARLORD',
  'MARKET',
  'SCENARIO',
]);
export type CardType = z.infer<typeof CardTypeSchema>;

export const HeroClassSchema = z.enum([
  'WARRIOR',
  'EXPLORER',
  'ROGUE',
  'MAGE',
]);
export type HeroClass = z.infer<typeof HeroClassSchema>;

// ============================================================================
// Iconos de capacidad
// ============================================================================

export const CapabilityIconSchema = z.enum([
  'MELEE',
  'RANGED',
  'EXPERTISE',
  'MAGIC',
]);
export type CapabilityIcon = z.infer<typeof CapabilityIconSchema>;

// ============================================================================
// ValueExpr — expresiones de valor numerico
// ============================================================================

export const ValueExprSchema: z.ZodType<ValueExpr> = z.lazy((): z.ZodType<ValueExpr> =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('CONSTANT'), value: z.number().int() }),
    z.object({ kind: z.literal('COUNT_LIVING_ENEMIES') }),
    z.object({ kind: z.literal('COUNT_ENEMIES_IN_FIELD') }),
    z.object({ kind: z.literal('FORTITUDE_OF'), target: TargetSelectorSchema }),
    z.object({ kind: z.literal('SUM'), of: z.array(ValueExprSchema) }),
    z.object({ kind: z.literal('MULTIPLY'), factors: z.array(ValueExprSchema) }),
    z.object({ kind: z.literal('EVASION_DISCARDED_COUNT') }),
    z.object({
      kind: z.literal('FLOOR_DIV'),
      numerator: ValueExprSchema,
      denominator: z.number().int().positive(),
    }),
  ]),
);

export type ValueExpr =
  | { kind: 'CONSTANT'; value: number }
  | { kind: 'COUNT_LIVING_ENEMIES' }
  | { kind: 'COUNT_ENEMIES_IN_FIELD' }
  | { kind: 'FORTITUDE_OF'; target: TargetSelector }
  | { kind: 'SUM'; of: ValueExpr[] }
  | { kind: 'MULTIPLY'; factors: ValueExpr[] }
  | { kind: 'EVASION_DISCARDED_COUNT' }
  | { kind: 'FLOOR_DIV'; numerator: ValueExpr; denominator: number };

// ============================================================================
// TargetSelector — selectores de enemigos
// ============================================================================

export const EnemyFilterSchema = z.object({
  minFortitude: z.number().int().optional(),
  isOrc: z.boolean().optional(),
  isWarlord: z.boolean().optional(),
}).optional();

export type EnemyFilter = z.infer<typeof EnemyFilterSchema>;

export const TargetSelectorSchema: z.ZodType<TargetSelector> = z.lazy((): z.ZodType<TargetSelector> =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ONE_ENEMY'), filter: EnemyFilterSchema }),
    z.object({ kind: z.literal('ALL_ENEMIES') }),
    z.object({ kind: z.literal('ENEMY_WITH_MAX_FORTITUDE') }),
    z.object({ kind: z.literal('ENEMY_WITH_FEWEST_WOUNDS') }),
    z.object({ kind: z.literal('SELECTED_ENEMY') }),
  ]),
);

export type TargetSelector =
  | { kind: 'ONE_ENEMY'; filter?: EnemyFilter }
  | { kind: 'ALL_ENEMIES' }
  | { kind: 'ENEMY_WITH_MAX_FORTITUDE' }
  | { kind: 'ENEMY_WITH_FEWEST_WOUNDS' }
  | { kind: 'SELECTED_ENEMY' };

// ============================================================================
// HeroSelector — selectores de heroes
// ============================================================================

export const HeroSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SELF') }),
  z.object({ kind: z.literal('ALL_OTHERS') }),
  z.object({ kind: z.literal('EACH_OTHER') }),
  z.object({ kind: z.literal('HERO_WITH_FEWEST_WOUNDS') }),
  z.object({ kind: z.literal('OTHER_HERO') }),
]);

export type HeroSelector = z.infer<typeof HeroSelectorSchema>;

// ============================================================================
// Condition — condiciones para efectos condicionales
// ============================================================================

export const ConditionSchema: z.ZodType<Condition> = z.lazy((): z.ZodType<Condition> =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('FIRST_CARD_OF_NAME_THIS_TURN'), name: z.string() }),
    z.object({ kind: z.literal('ALREADY_USED_AGAINST_THIS_ENEMY'), name: z.string() }),
    z.object({ kind: z.literal('ENEMY_DEFEATED_BY_THIS_CARD') }),
    z.object({ kind: z.literal('HAS_CAPABILITY'), icon: CapabilityIconSchema }),
    z.object({ kind: z.literal('ENEMY_FORTITUDE_GTE'), value: z.number().int() }),
    z.object({ kind: z.literal('NOT'), condition: ConditionSchema }),
    z.object({ kind: z.literal('AND'), conditions: z.array(ConditionSchema) }),
    z.object({ kind: z.literal('OR'), conditions: z.array(ConditionSchema) }),
  ]),
);

export type Condition =
  | { kind: 'FIRST_CARD_OF_NAME_THIS_TURN'; name: string }
  | { kind: 'ALREADY_USED_AGAINST_THIS_ENEMY'; name: string }
  | { kind: 'ENEMY_DEFEATED_BY_THIS_CARD' }
  | { kind: 'HAS_CAPABILITY'; icon: CapabilityIcon }
  | { kind: 'ENEMY_FORTITUDE_GTE'; value: number }
  | { kind: 'NOT'; condition: Condition }
  | { kind: 'AND'; conditions: Condition[] }
  | { kind: 'OR'; conditions: Condition[] };

// ============================================================================
// CardEffect — union discriminada de efectos de carta
// ============================================================================

export const CardEffectSchema: z.ZodType<CardEffect> = z.lazy((): z.ZodType<CardEffect> =>
  z.discriminatedUnion('type', [
    // --- Dano ---
    z.object({
      type: z.literal('DEAL_DAMAGE'),
      amount: ValueExprSchema,
      target: TargetSelectorSchema,
      splittable: z.boolean().default(false),
    }),
    z.object({
      type: z.literal('DEAL_DAMAGE_ALL_ENEMIES'),
      amount: ValueExprSchema,
    }),
    z.object({
      type: z.literal('DEAL_DAMAGE_SPLIT'),
      amount: ValueExprSchema,
      targetCount: z.number().int().min(1),
      target: TargetSelectorSchema,
    }),
    z.object({
      type: z.literal('DEAL_DAMAGE_TO_HERO'),
      amount: ValueExprSchema,
      target: HeroSelectorSchema,
    }),
    z.object({
      type: z.literal('DEAL_DAMAGE_TO_OTHER_HEROES'),
      amount: ValueExprSchema,
    }),

    // --- Prevencion ---
    z.object({
      type: z.literal('PREVENT_DAMAGE'),
      amount: ValueExprSchema,
      duration: EffectDurationSchema,
    }),
    z.object({
      type: z.literal('PREVENT_ENEMY_DAMAGE'),
      target: TargetSelectorSchema,
      duration: EffectDurationSchema,
    }),
    z.object({
      type: z.literal('CANCEL_ALL_DAMAGE'),
      duration: EffectDurationSchema,
    }),
    z.object({ type: z.literal('SHIELD'), amount: ValueExprSchema }),

    // --- Cartas ---
    z.object({
      type: z.literal('DRAW_CARDS'),
      amount: ValueExprSchema,
      source: z.enum(['ABILITY_DECK', 'SUPPORT_DECK']).default('ABILITY_DECK'),
    }),
    z.object({
      type: z.literal('DRAW_AND_ADD_ATTACK'),
      amount: ValueExprSchema,
      source: z.enum(['ABILITY_DECK', 'SUPPORT_DECK']).default('ABILITY_DECK'),
    }),
    z.object({ type: z.literal('LOSE_CARDS'), amount: ValueExprSchema }),
    z.object({
      type: z.literal('RECOVER_CARDS'),
      amount: ValueExprSchema,
      from: z.enum(['WEAR_PILE']),
      to: z.enum(['BOTTOM_OF_DECK', 'HAND']),
    }),
    z.object({
      type: z.literal('RECOVER_CARD_BY_NAME'),
      name: z.string(),
      from: z.enum(['WEAR_PILE']),
      to: z.enum(['BOTTOM_OF_DECK', 'HAND']),
    }),
    z.object({
      type: z.literal('SEARCH_DECK'),
      filter: z.object({ name: z.string().optional(), definitionId: z.string().optional() }),
      action: z.enum(['SWAP_WITH_HAND', 'PUT_IN_HAND']),
      deck: z.enum(['ABILITY', 'MARKET', 'HORDE']).optional(),
      /** Número máximo de cartas a buscar (Neddia: hasta 2) */
      amount: z.number().int().min(1).optional(),
    }),
    z.object({
      type: z.literal('SHUFFLE_DECK'),
      deck: z.enum(['ABILITY', 'MARKET', 'HORDE']),
    }),
    z.object({
      type: z.literal('SEARCH_WEAR_PILE_PUT_IN_HAND'),
      amount: ValueExprSchema,
    }),

    // --- Recursos ---
    z.object({ type: z.literal('GAIN_GLORY'), amount: ValueExprSchema }),
    z.object({ type: z.literal('GAIN_COINS'), amount: ValueExprSchema, target: z.union([HeroSelectorSchema, z.enum(['DEFEATING_HERO', 'SELF'])]).optional() }),
    z.object({
      type: z.literal('STEAL_COINS'),
      amount: ValueExprSchema,
      from: HeroSelectorSchema,
    }),
    z.object({ type: z.literal('HEAL_WOUNDS'), amount: ValueExprSchema }),
    z.object({
      type: z.literal('COST'),
      resource: z.enum(['COINS', 'GLORY']),
      amount: ValueExprSchema,
    }),

    // --- Control de flujo ---
    z.object({
      type: z.literal('CONDITIONAL'),
      condition: ConditionSchema,
      then: z.array(z.lazy(() => CardEffectSchema)),
      else: z.array(z.lazy(() => CardEffectSchema)).optional(),
    }),
    z.object({
      type: z.literal('ON_DEFEAT'),
      effects: z.array(z.lazy(() => CardEffectSchema)),
    }),
    z.object({
      type: z.literal('ON_ENEMY_DEFEATED'),
      effects: z.array(z.lazy(() => CardEffectSchema)),
      condition: z.object({ fortitudeGte: z.number().int().optional() }).optional(),
    }),
    z.object({ type: z.literal('IGNORE_COIN_REWARDS') }),
    z.object({ type: z.literal('IGNORE_GLORY_REWARDS') }),
    z.object({
      type: z.literal('ON_HORDE_ATTACK'),
      effects: z.array(z.lazy(() => CardEffectSchema)),
    }),
    z.object({ type: z.literal('END_ATTACK') }),

    // --- Enemigos ---
    z.object({
      type: z.literal('DISABLE_ENEMY_DAMAGE'),
      target: TargetSelectorSchema,
      duration: EffectDurationSchema,
    }),
    z.object({
      type: z.literal('APPLY_VULNERABILITY'),
      target: TargetSelectorSchema,
      bonus: ValueExprSchema,
      duration: EffectDurationSchema,
    }),
    z.object({
      type: z.literal('DEFEAT_ENEMY'),
      target: TargetSelectorSchema,
      loot: z.boolean(),
    }),
    z.object({
      type: z.literal('SWAP_ENEMY'),
      target: TargetSelectorSchema,
      newFrom: z.literal('BOTTOM_OF_HORDE').optional(),
      new_from: z.literal('BOTTOM_OF_HORDE').optional(),
    }),
    z.object({
      type: z.literal('RETURN_TO_HORDE'),
      target: TargetSelectorSchema,
      position: z.enum(['BOTTOM']),
    }),

    // --- Modificadores ---
    z.object({
      type: z.literal('MODIFY_DAMAGE'),
      modifier: ValueExprSchema,
      scope: z.enum(['THIS_TURN', 'NEXT_CARD']),
      filter: z.object({ name: z.string().optional() }).optional(),
    }),
    z.object({
      type: z.literal('MODIFY_FORTITUDE'),
      modifier: ValueExprSchema,
      target: TargetSelectorSchema,
      duration: EffectDurationSchema,
    }),
    z.object({
      type: z.literal('MODIFY_MARKET_COST'),
      modifier: ValueExprSchema,
    }),

    // --- Especiales ---
    z.object({
      type: z.literal('DRAW_AND_CHECK'),
      amount: ValueExprSchema,
      /** ID de definición estable de la carta esperada (preferido sobre expectedName) */
      expectedCard: z.string().optional(),
      expectedName: z.string().optional(),
      expected_name: z.string().optional(), // alias snake_case (compatibilidad MD)
      onMatch: z.array(z.lazy(() => CardEffectSchema)).optional(),
      on_match: z.array(z.lazy(() => CardEffectSchema)).optional(), // alias
      onMismatch: z.array(z.lazy(() => CardEffectSchema)).optional(),
      on_mismatch: z.array(z.lazy(() => CardEffectSchema)).optional(), // alias
    }),
    z.object({
      type: z.literal('PLAY_IMMEDIATELY'),
      inheritTarget: z.boolean().default(false),
    }),
    z.object({
      type: z.literal('PLACE_PERSISTENT'),
      trigger: z.string(),
      effects: z.array(z.lazy(() => CardEffectSchema)),
    }),
    z.object({ type: z.literal('RECOVER_THIS_CARD'), to: z.enum(['HAND', 'BOTTOM_OF_DECK']) }),
    z.object({ type: z.literal('REMOVE_FROM_GAME') }),
    z.object({ type: z.literal('ALL_HEROES_RECOVER'), amount: ValueExprSchema }),
    z.object({ type: z.literal('OTHER_HEROES_RECOVER'), amount: ValueExprSchema }),
    z.object({
      type: z.literal('INTERCEPT_DAMAGE'),
      from: HeroSelectorSchema,
    }),
    z.object({
      type: z.literal('LOOK_AT_CARDS'),
      deck: z.literal('HORDE'),
      amount: ValueExprSchema,
      action: z.literal('REORDER'),
    }),
    z.object({
      type: z.literal('STEAL_COINS_MULTIPLE'),
      maxTotal: ValueExprSchema.optional(),
      maxPerHero: ValueExprSchema.optional(),
      max_total: ValueExprSchema.optional(),
      max_per_hero: ValueExprSchema.optional(),
    }),
    z.object({
      type: z.literal('PLAY_RANDOM_CARD_FROM_OTHER_HERO'),
      costGlory: ValueExprSchema.optional(),
      cost_glory: ValueExprSchema.optional(),
    }),
    z.object({
      type: z.literal('CUSTOM_SCENARIO'),
      handler: z.string(),
    }),
  ]),
);

export type CardEffect =
  // Dano
  | { type: 'DEAL_DAMAGE'; amount: ValueExpr; target: TargetSelector; splittable?: boolean }
  | { type: 'DEAL_DAMAGE_ALL_ENEMIES'; amount: ValueExpr }
  | { type: 'DEAL_DAMAGE_SPLIT'; amount: ValueExpr; targetCount: number; target: TargetSelector }
  | { type: 'DEAL_DAMAGE_TO_HERO'; amount: ValueExpr; target: HeroSelector }
  | { type: 'DEAL_DAMAGE_TO_OTHER_HEROES'; amount: ValueExpr }
  // Prevencion
  | { type: 'PREVENT_DAMAGE'; amount: ValueExpr; duration: EffectDuration }
  | { type: 'PREVENT_ENEMY_DAMAGE'; target: TargetSelector; duration: EffectDuration }
  | { type: 'CANCEL_ALL_DAMAGE'; duration: EffectDuration }
  | { type: 'SHIELD'; amount: ValueExpr }
  // Cartas
  | { type: 'DRAW_CARDS'; amount: ValueExpr; source?: 'ABILITY_DECK' | 'SUPPORT_DECK' }
  | { type: 'DRAW_AND_ADD_ATTACK'; amount: ValueExpr; source?: 'ABILITY_DECK' | 'SUPPORT_DECK' }
  | { type: 'LOSE_CARDS'; amount: ValueExpr }
  | { type: 'RECOVER_CARDS'; amount: ValueExpr; from: 'WEAR_PILE'; to: 'BOTTOM_OF_DECK' | 'HAND' }
  | { type: 'RECOVER_CARD_BY_NAME'; name: string; from: 'WEAR_PILE'; to: 'BOTTOM_OF_DECK' | 'HAND' }
  | { type: 'SEARCH_DECK'; filter: { name?: string; definitionId?: string }; action: 'SWAP_WITH_HAND' | 'PUT_IN_HAND'; deck?: 'ABILITY' | 'MARKET' | 'HORDE'; amount?: number }
  | { type: 'SHUFFLE_DECK'; deck: 'ABILITY' | 'MARKET' | 'HORDE' }
  | { type: 'SEARCH_WEAR_PILE_PUT_IN_HAND'; amount: ValueExpr }
  // Recursos
  | { type: 'GAIN_GLORY'; amount: ValueExpr }
  | { type: 'GAIN_COINS'; amount: ValueExpr; target?: HeroSelector | 'DEFEATING_HERO' | 'SELF' }
  | { type: 'STEAL_COINS'; amount: ValueExpr; from: HeroSelector }
  | { type: 'HEAL_WOUNDS'; amount: ValueExpr }
  | { type: 'COST'; resource: 'COINS' | 'GLORY'; amount: ValueExpr }
  // Control de flujo
  | { type: 'CONDITIONAL'; condition: Condition; then: CardEffect[]; else?: CardEffect[] }
  | { type: 'ON_DEFEAT'; effects: CardEffect[] }
  | { type: 'ON_ENEMY_DEFEATED'; effects: CardEffect[]; condition?: { fortitudeGte?: number } }
  | { type: 'ON_HORDE_ATTACK'; effects: CardEffect[] }
  | { type: 'IGNORE_COIN_REWARDS' }
  | { type: 'IGNORE_GLORY_REWARDS' }
  | { type: 'END_ATTACK' }
  // Enemigos
  | { type: 'DISABLE_ENEMY_DAMAGE'; target: TargetSelector; duration: EffectDuration }
  | { type: 'APPLY_VULNERABILITY'; target: TargetSelector; bonus: ValueExpr; duration: EffectDuration }
  | { type: 'DEFEAT_ENEMY'; target: TargetSelector; loot: boolean }
  | { type: 'SWAP_ENEMY'; target: TargetSelector; newFrom?: 'BOTTOM_OF_HORDE'; new_from?: 'BOTTOM_OF_HORDE' }
  | { type: 'RETURN_TO_HORDE'; target: TargetSelector; position: 'BOTTOM' }
  // Modificadores
  | { type: 'MODIFY_DAMAGE'; modifier: ValueExpr; scope: 'THIS_TURN' | 'NEXT_CARD'; filter?: { name?: string } }
  | { type: 'MODIFY_FORTITUDE'; modifier: ValueExpr; target: TargetSelector; duration: EffectDuration }
  | { type: 'MODIFY_MARKET_COST'; modifier: ValueExpr }
  // Especiales
  | { type: 'DRAW_AND_CHECK'; amount: ValueExpr; expectedCard?: string; expectedName?: string; expected_name?: string; onMatch?: CardEffect[]; on_match?: CardEffect[]; onMismatch?: CardEffect[]; on_mismatch?: CardEffect[] }
  | { type: 'PLAY_IMMEDIATELY'; inheritTarget?: boolean }
  | { type: 'PLACE_PERSISTENT'; trigger: string; effects: CardEffect[] }
  | { type: 'RECOVER_THIS_CARD'; to: 'HAND' | 'BOTTOM_OF_DECK' }
  | { type: 'REMOVE_FROM_GAME' }
  | { type: 'ALL_HEROES_RECOVER'; amount: ValueExpr }
  | { type: 'OTHER_HEROES_RECOVER'; amount: ValueExpr }
  | { type: 'INTERCEPT_DAMAGE'; from: HeroSelector }
  | { type: 'LOOK_AT_CARDS'; deck: 'HORDE'; amount: ValueExpr; action: 'REORDER' }
  | { type: 'STEAL_COINS_MULTIPLE'; maxTotal?: ValueExpr; maxPerHero?: ValueExpr; max_total?: ValueExpr; max_per_hero?: ValueExpr }
  | { type: 'PLAY_RANDOM_CARD_FROM_OTHER_HERO'; costGlory?: ValueExpr; cost_glory?: ValueExpr }
  | { type: 'CUSTOM_SCENARIO'; handler: string };

// ============================================================================
// Reward — recompensa de una Hueste en el reverso
// ============================================================================

export const RewardSchema = z.object({
  coins: z.number().int().min(0).default(0),
  glory: z.number().int().min(0).default(0),
});
export type Reward = z.infer<typeof RewardSchema>;

// ============================================================================
// CardDefinition — definicion completa de una carta
// ============================================================================

export const CardDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: CardTypeSchema,
  heroClass: HeroClassSchema.optional(),
  copies: z.number().int().min(1).default(1),
  printedAttack: z.number().int().min(0).optional(),
  printedFortitude: z.number().int().min(0).optional(),
  printedCost: z.number().int().min(0).optional(),
  maxWounds: z.number().int().min(1).optional(), // para heroes
  reward: RewardSchema.optional(), // para huestes
  capabilities: z.array(CapabilityIconSchema).optional(), // para heroes y mercado
  requiredCapabilities: z.array(CapabilityIconSchema).optional(), // para mercado
  penaltyCapabilities: z.array(z.object({
    icon: CapabilityIconSchema,
    damagePenalty: z.number().int(),
  })).optional(),
  effects: z.array(CardEffectSchema).default([]),
  destinationAfterUse: z.enum([
    'WEAR_PILE',
    'REMOVED_FROM_GAME',
    'IN_FRONT_OF_PLAYER',
    'HAND',
    'BOTTOM_OF_DECK',
  ]).default('WEAR_PILE'),
  heroAbility: z.object({
    uses: z.number().int().min(1),
    effects: z.array(CardEffectSchema),
  }).optional(),
  isOrc: z.boolean().optional(), // para huestes (Roghkiller)
  specialIcons: z.array(z.enum([
    'ANTI_MAGIC',
    'TEMPORARY_WOUNDS',
    'IMPROVED_LOOT',
  ])).optional(),
  /** Valor numerico para icono Anti-Magia (resta de Fortaleza al calcular dano) */
  antiMagicValue: z.number().int().min(1).default(1).optional(),
  sourceImage: z.string().optional(),
  /** Sistema de imagenes PNG — UI-PNG-001..011 */
  images: z.object({
    front: z.string().optional(),
    back: z.string().optional(),
    thumbnail: z.string().optional(),
    game: z.string().optional(),
    preview: z.string().optional(),
    mask: z.string().optional(),
    status: z.enum([
      'PENDING_EXTRACTION',
      'EXTRACTED',
      'CROP_REVIEW_REQUIRED',
      'CROP_VERIFIED',
      'FRONT_BACK_MAPPING_REQUIRED',
      'FRONT_BACK_MAPPING_VERIFIED',
      'OPTIMIZED',
      'READY_FOR_GAME',
      'REJECTED',
    ]).default('PENDING_EXTRACTION'),
    hash: z.string().optional(),
    pdfPage: z.number().int().optional(),
    pdfRow: z.number().int().optional(),
    pdfCol: z.number().int().optional(),
  }).optional(),
  verificationStatus: z.enum(['CONFIRMED', 'OCR', 'COLOR', 'INFERRED', 'REVISAR']).default('CONFIRMED'),
  author: z.string().default('official'),
  version: z.string().default('1.0.0'),
});

export type CardDefinition = z.infer<typeof CardDefinitionSchema>;

// ============================================================================
// CardSet — conjunto de cartas (expansion o edicion)
// ============================================================================

export const CardSetEntrySchema = z.object({
  cardId: z.string(),
  copies: z.number().int().min(1),
});

export const CardSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  version: z.string(),
  entries: z.array(CardSetEntrySchema),
});

export type CardSet = z.infer<typeof CardSetSchema>;
