/**
 * Sistema de trazabilidad entre reglas, implementacion y pruebas.
 *
 * Cada regla del juego tiene un identificador unico (RULE-*) que la vincula
 * con su fuente documental, implementacion en codigo y pruebas asociadas.
 *
 * Una regla oficial no puede marcarse como verificada si no tiene al menos
 * una prueba asociada.
 */

export type RuleCategory =
  | 'GENERAL'
  | 'CARD'
  | 'HERO'
  | 'SCENARIO'
  | 'WARLORD'
  | 'MARKET'
  | 'HORDE'
  | 'PHASE'
  | 'COMMAND'
  | 'PROJECTION'
  | 'REPLAY';

export type RuleStatus = 'VERIFIED' | 'PENDING' | 'BLOCKED' | 'DEPRECATED';

export interface RuleEntry {
  ruleId: string;
  category: RuleCategory;
  description: string;
  source: string;
  implementation: string;
  tests: string[];
  status: RuleStatus;
  notes?: string;
}

/**
 * Registro central de reglas.
 * Se mantiene como objeto para busqueda O(1) por ruleId.
 */
const ruleRegistry: Record<string, RuleEntry> = {};

export function registerRule(entry: Omit<RuleEntry, 'tests' | 'status'> & {
  tests?: string[];
  status?: RuleStatus;
}): void {
  ruleRegistry[entry.ruleId] = {
    ...entry,
    tests: entry.tests ?? [],
    status: entry.status ?? 'PENDING',
  };
}

export function addTestToRule(ruleId: string, testName: string): void {
  const rule = ruleRegistry[ruleId];
  if (!rule) {
    throw new Error(`Rule not found: ${ruleId}. Register it first.`);
  }
  if (!rule.tests.includes(testName)) {
    rule.tests.push(testName);
  }
  // Auto-promover a VERIFIED si tiene al menos una prueba
  if (rule.status === 'PENDING' && rule.tests.length > 0) {
    rule.status = 'VERIFIED';
  }
}

export function getRule(ruleId: string): RuleEntry | undefined {
  return ruleRegistry[ruleId];
}

export function getAllRules(): RuleEntry[] {
  return Object.values(ruleRegistry);
}

export function getRulesByCategory(category: RuleCategory): RuleEntry[] {
  return getAllRules().filter(r => r.category === category);
}

export function getRulesByStatus(status: RuleStatus): RuleEntry[] {
  return getAllRules().filter(r => r.status === status);
}

/**
 * Genera un informe de cobertura de reglas.
 */
export function ruleCoverageReport(): {
  total: number;
  verified: number;
  pending: number;
  blocked: number;
  byCategory: Record<string, { total: number; verified: number }>;
} {
  const rules = getAllRules();
  const byCategory: Record<string, { total: number; verified: number }> = {};
  let verified = 0;
  let pending = 0;
  let blocked = 0;

  for (const rule of rules) {
    const cat = rule.category;
    if (!byCategory[cat]) byCategory[cat] = { total: 0, verified: 0 };
    byCategory[cat].total++;
    if (rule.status === 'VERIFIED') {
      verified++;
      byCategory[cat].verified++;
    } else if (rule.status === 'PENDING') {
      pending++;
    } else if (rule.status === 'BLOCKED') {
      blocked++;
    }
  }

  return {
    total: rules.length,
    verified,
    pending,
    blocked,
    byCategory,
  };
}

// === Reglas generales (RULE-GENERAL-*) ===

registerRule({
  ruleId: 'RULE-GENERAL-ATTACK-001',
  category: 'GENERAL',
  description: 'El jugador activo puede jugar cartas de Habilidad durante PLAYER_ATTACK',
  source: 'ESPECIFICACION_MAESTRA.md §3.4',
  implementation: 'packages/engine/src/commands/execute.ts:isLegal PLAY_CARD',
});

registerRule({
  ruleId: 'RULE-GENERAL-ATTACK-002',
  category: 'GENERAL',
  description: 'El Ataque de la Horda se produce tras finalizar el ataque del jugador',
  source: 'ESPECIFICACION_MAESTRA.md §3.4',
  implementation: 'packages/engine/src/phases/engine.ts:processHordeAttack',
});

registerRule({
  ruleId: 'RULE-GENERAL-EVASION-001',
  category: 'GENERAL',
  description: 'Evasion: descartar 2 cartas de mano para evitar el Ataque de la Horda',
  source: 'ESPECIFICACION_MAESTRA.md §3.4',
  implementation: 'packages/engine/src/commands/execute.ts:EVASION',
});

registerRule({
  ruleId: 'RULE-GENERAL-MARKET-001',
  category: 'GENERAL',
  description: 'Durante la fase de Mercado se pueden comprar cartas con Monedas',
  source: 'ESPECIFICACION_MAESTRA.md §3.4',
  implementation: 'packages/engine/src/commands/execute.ts:BUY_CARD',
});

registerRule({
  ruleId: 'RULE-GENERAL-RESTORATION-001',
  category: 'GENERAL',
  description: 'El Restablecimiento roba cartas hasta tener 4 en mano',
  source: 'ESPECIFICACION_MAESTRA.md §3.4',
  implementation: 'packages/engine/src/phases/engine.ts:processRestoration',
});

registerRule({
  ruleId: 'RULE-GENERAL-RESTORATION-002',
  category: 'GENERAL',
  description: 'Si el mazo se agota al robar, se baraja la Pila de Desgaste',
  source: 'ESPECIFICACION_MAESTRA.md §3.4',
  implementation: 'packages/engine/src/phases/engine.ts:processRestoration DECK_RESHUFFLED',
});

registerRule({
  ruleId: 'RULE-GENERAL-DEFEAT-001',
  category: 'GENERAL',
  description: 'Un enemigo es derrotado cuando Heridas >= Fortaleza efectiva',
  source: 'ESPECIFICACION_MAESTRA.md §3.3',
  implementation: 'packages/engine/src/effects/resolver.ts:checkDefeat',
});

registerRule({
  ruleId: 'RULE-GENERAL-DEFEAT-002',
  category: 'GENERAL',
  description: 'Al derrotar un enemigo se revela el reverso (botin) y se otorga al jugador',
  source: 'ESPECIFICACION_MAESTRA.md §3.3',
  implementation: 'packages/engine/src/events/applyEvent.ts:ENEMY_DEFEATED',
});

registerRule({
  ruleId: 'RULE-GENERAL-HERO-DEFEAT-001',
  category: 'GENERAL',
  description: 'Un heroe queda eliminado al recibir su maxima Herida',
  source: 'ESPECIFICACION_MAESTRA.md §3.5',
  implementation: 'packages/engine/src/phases/engine.ts:processGameEndCheck',
});

registerRule({
  ruleId: 'RULE-GENERAL-GAME-END-001',
  category: 'GENERAL',
  description: 'La partida termina cuando se derrota al Senor de la Guerra y no quedan enemigos',
  source: 'ESPECIFICACION_MAESTRA.md §3.5',
  implementation: 'packages/engine/src/phases/engine.ts:processGameEndCheck',
});

registerRule({
  ruleId: 'RULE-GENERAL-DETERMINISM-001',
  category: 'REPLAY',
  description: 'El RNG es determinista: misma semilla + mismos comandos = mismo resultado',
  source: 'ESPECIFICACION_MAESTRA.md §20.6',
  implementation: 'packages/engine/src/rng/index.ts:DeterministicRng',
});

registerRule({
  ruleId: 'RULE-PROJECTION-PRIVATE-HAND-001',
  category: 'PROJECTION',
  description: 'Las manos de otros jugadores estan ocultas en la proyeccion',
  source: 'ESPECIFICACION_MAESTRA.md §51.11',
  implementation: 'packages/engine/src/projection/index.ts:projectState',
});

registerRule({
  ruleId: 'RULE-PROJECTION-PRIVATE-CHOICE-001',
  category: 'PROJECTION',
  description: 'Las pendingChoices solo son visibles para el jugador que las debe resolver',
  source: 'ESPECIFICACION_MAESTRA.md §51.11',
  implementation: 'packages/engine/src/projection/index.ts:projectState pendingChoices filter',
});

// === Reglas de cartas (RULE-CARD-*) ===

registerRule({
  ruleId: 'RULE-CARD-RAPID-SHOT-001',
  category: 'CARD',
  description: 'Disparo Rapido: roba hasta encontrar otra copia y la juega automaticamente',
  source: 'PDF Explorer - Disparo Rapido',
  implementation: 'packages/engine/src/effects/resolver.ts:resolveRapidShot',
});

registerRule({
  ruleId: 'RULE-CARD-TRAP-001',
  category: 'CARD',
  description: 'Trampa: se activa durante el Ataque de la Horda solo para el jugador activo',
  source: 'PDF Rogue - Trampa',
  implementation: 'packages/engine/src/effects/resolver.ts:Trampa trigger',
});

registerRule({
  ruleId: 'RULE-CARD-FIREBALL-001',
  category: 'CARD',
  description: 'Bola de Fuego: dana a todos los enemigos y otros heroes pierden 1 carta',
  source: 'PDF Mage - Bola de Fuego',
  implementation: 'packages/engine/src/effects/registry.ts:DEAL_DAMAGE_ALL_ENEMIES',
});

// === Reglas de heroes (RULE-HERO-*) ===

registerRule({
  ruleId: 'RULE-HERO-FELDON-001',
  category: 'HERO',
  description: 'Feldon: durante el Ataque de la Horda, solo pierde la mitad de cartas (redondeando hacia abajo)',
  source: 'PDF Heroes - Feldon',
  implementation: 'packages/engine/src/heroes/abilities.ts:Feldon',
});

registerRule({
  ruleId: 'RULE-HERO-IDRIL-001',
  category: 'HERO',
  description: 'Idril: mirar las 3 cartas inferiores del mazo de la Horda y reordenarlas',
  source: 'PDF Heroes - Idril',
  implementation: 'packages/engine/src/heroes/abilities.ts:Idril',
});

registerRule({
  ruleId: 'RULE-HERO-TAHERAL-001',
  category: 'HERO',
  description: 'Taheral: durante la Evasion, +2 Monedas por cada carta descartada a Desgaste',
  source: 'PDF Heroes - Taheral',
  implementation: 'packages/engine/src/heroes/abilities.ts:Taheral',
});

registerRule({
  ruleId: 'RULE-HERO-BELETH-IL-001',
  category: 'HERO',
  description: 'Beleth-Il: con Disparo Rapido, la primera carta fallada se recupera y roba otra',
  source: 'PDF Heroes - Beleth-Il',
  implementation: 'packages/engine/src/heroes/abilities.ts:BelethIl',
});

// === Reglas de escenarios (RULE-SCENARIO-*) ===

registerRule({
  ruleId: 'RULE-SCENARIO-SKAARG-001',
  category: 'SCENARIO',
  description: 'Planicie de Skaarg: ignora las Monedas del reverso de los enemigos',
  source: 'PDF Escenarios - Planicie de Skaarg',
  implementation: 'packages/engine/src/scenarios/index.ts:skaarg',
});

registerRule({
  ruleId: 'RULE-SCENARIO-BRUNMAR-001',
  category: 'SCENARIO',
  description: 'Ruinas de Brunmar: todos los enemigos -1 Fortaleza',
  source: 'PDF Escenarios - Ruinas de Brunmar',
  implementation: 'packages/engine/src/scenarios/index.ts:brunmar',
});

registerRule({
  ruleId: 'RULE-SCENARIO-ULTHAR-001',
  category: 'SCENARIO',
  description: 'Portal de Ulthar: pagar 1 Gloria o 2 Monedas, devolver Hueste y colocar trofeo',
  source: 'PDF Escenarios - Portal de Ulthar',
  implementation: 'packages/engine/src/scenarios/index.ts:ulthar',
});

// === Reglas de Senores de la Guerra (RULE-WARLORD-*) ===

registerRule({
  ruleId: 'RULE-WARLORD-GURDRUG-001',
  category: 'WARLORD',
  description: 'Gurdrug: al danarlo, el jugador pierde 1 carta del mazo de Habilidades',
  source: 'PDF Warlords - Gurdrug',
  implementation: 'packages/engine/src/effects/resolver.ts:Gurdrug',
});

registerRule({
  ruleId: 'RULE-WARLORD-ROGHKILLER-001',
  category: 'WARLORD',
  description: 'Roghkiller: orcos en campo reciben +1 Fortaleza mientras este vivo',
  source: 'PDF Warlords - Roghkiller',
  implementation: 'packages/engine/src/phases/engine.ts:Roghkiller bonus',
});

registerRule({
  ruleId: 'RULE-WARLORD-SHRIEKNIFER-001',
  category: 'WARLORD',
  description: 'Shriekknifer: al usar ataque impreso 1 contra el, se recupera 1 carta del Desgaste',
  source: 'PDF Warlords - Shriekknifer',
  implementation: 'packages/engine/src/effects/resolver.ts:Shriekknifer',
});
