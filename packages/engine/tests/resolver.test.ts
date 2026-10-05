import { describe, it, expect, beforeEach } from 'vitest';
import { DeterministicRng } from '../src/rng/index.js';
import { EffectRegistry, registerCoreEffects } from '../src/effects/registry.js';
import { resolveCard, processHordeAttackTriggers, resetResolveSeq } from '../src/effects/resolver.js';
import { setupGame, startFirstTurn, resetInstanceCounter } from '../src/phases/setup.js';
import { resetPhaseSeq } from '../src/phases/engine.js';
import { loadCatalog } from '@nt4h/catalog';
import type { GameState, CardInstance, CardDefinition, Zone } from '@nt4h/schema';

describe('CardResolver — efectos especiales', () => {
  let catalog: ReturnType<typeof loadCatalog>;
  let registry: EffectRegistry;
  let rng: DeterministicRng;

  beforeEach(() => {
    resetInstanceCounter();
    resetPhaseSeq();
    resetResolveSeq();
    catalog = loadCatalog();
    registry = new EffectRegistry();
    registerCoreEffects(registry);
    rng = new DeterministicRng('test-resolver-001');
  });

  function makeSetupState(): GameState {
    const config = {
      mode: 'STANDARD' as const,
      playerCount: 2,
      seed: 'test-resolver-001',
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
      ],
      useScenarios: false,
    };
    // D427: resolver la puja de Líder para que activePlayerId esté definido
    const setup = setupGame(config, catalog);
    return startFirstTurn(setup.state, new DeterministicRng('test-resolver-001'), catalog).state;
  }

  function makeCardInstance(defId: string, ownerId: string): CardInstance {
    return {
      instanceId: `test-${defId}-${Math.random().toString(36).slice(2, 8)}`,
      definitionId: defId,
      ownerId,
      zone: 'HAND' as Zone,
    };
  }

  it('resuelve una carta de dano simple (Espadazo)', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('warrior.sword-strike', 'p1');
    const cardDef = catalog.byId.get('warrior.sword-strike')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe haber un evento DAMAGE_DEALT
    expect(result.events.some(e => e.type === 'DAMAGE_DEALT')).toBe(true);
    // El dano debe ser 1 (Espadazo = ataque 1)
    const dmgEvent = result.events.find(e => e.type === 'DAMAGE_DEALT');
    if (dmgEvent && dmgEvent.type === 'DAMAGE_DEALT') {
      expect(dmgEvent.amount).toBe(1);
    }
  });

  it('resuelve Bola de Fuego con dano a todos los enemigos', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('mage.fireball', 'p1');
    const cardDef = catalog.byId.get('mage.fireball')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe haber dano al enemigo objetivo (ataque impreso 2)
    const dmgEvents = result.events.filter(e => e.type === 'DAMAGE_DEALT');
    expect(dmgEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('resuelve GANAR_GLORY (Proyectil Igneo)', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('mage.fire-bolt', 'p1');
    const cardDef = catalog.byId.get('mage.fire-bolt')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe ganar 1 Gloria
    const gloryEvent = result.events.find(e => e.type === 'GLORY_GAINED');
    expect(gloryEvent).toBeDefined();
    if (gloryEvent && gloryEvent.type === 'GLORY_GAINED') {
      expect(gloryEvent.amount).toBe(1);
    }
  });

  it('derrota un enemigo cuando el dano supera la fortaleza', () => {
    const state = makeSetupState();
    const player = state.players.p1;

    // Buscar el enemigo con menor fortaleza
    const enemy = state.battlefield.reduce((min, e) =>
      e.baseFortitude < min.baseFortitude ? e : min
    );

    // Usar Ataque Brutal (dano 3) contra un enemigo de fortaleza 2
    const card = makeCardInstance('warrior.brutal-attack', 'p1');
    const cardDef = catalog.byId.get('warrior.brutal-attack')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Si el enemigo tenia fortaleza <= 3, debe ser derrotado
    if (enemy.baseFortitude <= 3) {
      expect(result.enemiesDefeated).toContain(enemy.instanceId);
      expect(result.events.some(e => e.type === 'ENEMY_DEFEATED')).toBe(true);
    }
  });

  it('resuelve Disparo Rapido con cadena', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];

    // Colocar varios Disparos Rapidos al top del mazo
    const rapidShotDef = catalog.byId.get('explorer.rapid-shot')!;
    const deckCards: CardInstance[] = [];
    for (let i = 0; i < 3; i++) {
      deckCards.push({
        instanceId: `deck-rapid-${i}`,
        definitionId: 'explorer.rapid-shot',
        ownerId: 'p1',
        zone: 'ABILITY_DECK' as Zone,
      });
    }
    // Anadir una carta final (no Disparo Rapido) para terminar la cadena
    deckCards.push({
      instanceId: 'deck-final',
      definitionId: 'warrior.sword-strike',
      ownerId: 'p1',
      zone: 'ABILITY_DECK' as Zone,
    });

    const modifiedState: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          abilityDeck: deckCards,
        },
      },
    };

    const card = makeCardInstance('explorer.rapid-shot', 'p1');
    const result = resolveCard(modifiedState, card, rapidShotDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe haber jugado cartas adicionales (los Disparos Rapidos encadenados)
    expect(result.additionalCardsPlayed.length).toBeGreaterThan(0);
  });

  it('resuelve Trampa (PLACE_PERSISTENT)', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('rogue.trap', 'p1');
    const cardDef = catalog.byId.get('rogue.trap')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe colocar la carta persistente
    expect(result.events.some(e => e.type === 'PERSISTENT_CARD_PLACED')).toBe(true);
    // NO debe mover a desgaste
    expect(result.events.some(e =>
      e.type === 'CARD_MOVED' && e.to === 'WEAR_PILE'
    )).toBe(false);
  });

  it('la Trampa se activa durante el ataque de la Horda', () => {
    const state = makeSetupState();
    void state.players.p1;

    // Colocar una Trampa persistente frente al jugador
    const trapInstance: CardInstance = {
      instanceId: 'trap-active',
      definitionId: 'rogue.trap',
      ownerId: 'p1',
      zone: 'IN_FRONT_OF_PLAYER' as Zone,
      persistentTrigger: 'HORDE_ATTACK',
    };

    const modifiedState: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          persistentCards: [trapInstance],
        },
      },
    };

    const result = processHordeAttackTriggers(modifiedState, rng, registry, catalog);

    // La Trampa debe generar eventos (derrota al enemigo con mayor fortaleza)
    expect(result.events.length).toBeGreaterThan(0);
    // Debe remover la carta persistente
    expect(result.events.some(e => e.type === 'PERSISTENT_CARD_REMOVED')).toBe(true);
  });

  it('resuelve Supervivencia (SWAP_ENEMY): cambia el enemigo por el del fondo de la Horda', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('explorer.survival', 'p1');
    const cardDef = catalog.byId.get('explorer.survival')!;
    const expectedNew = state.hordeDeck[state.hordeDeck.length - 1];

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    const swap = result.events.find(e => e.type === 'ENEMY_SWAPPED');
    expect(swap).toBeDefined();
    if (swap && swap.type === 'ENEMY_SWAPPED') {
      expect(swap.oldEnemyInstanceId).toBe(enemy.instanceId);
      expect(swap.newEnemyInstanceId).toBe(expectedNew.instanceId);
      // La recompensa impresa viaja en el evento (la proyección la
      // redacta en el campo de batalla); con null el sustituto pagaba
      // {0,0} al ser derrotado — bug de auditoría.
      const newDef = catalog.byId.get(expectedNew.definitionId)!;
      expect(swap.newEnemyReward).toEqual(newDef.reward ?? null);
    }
    // Y al plegar, el enemigo sustituto conserva la recompensa para que
    // ENEMY_DEFEATED la pague.
    if (result.newState) {
      const swapped = result.newState.battlefield.find(
        e => e.instanceId === expectedNew.instanceId,
      );
      const newDef = catalog.byId.get(expectedNew.definitionId)!;
      expect(swapped?.reward ?? null).toEqual(newDef.reward ?? null);
    }
  });

  it('OVERKILL_DAMAGE: el exceso incluye bonus/marcas del golpe primario (E-12)', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    // Primario: Fortaleza 3, +2 daño recibido (modificador DAMAGE_BONUS).
    // Secundario: Fortaleza 5, sin modificadores.
    state.battlefield = [
      {
        ...state.battlefield[0],
        instanceId: 'e-over',
        baseFortitude: 3,
        wounds: 0,
        modifiers: [{
          id: 'vuln-1', sourceId: 'test', layer: 'DAMAGE_BONUS',
          timestamp: 1, duration: 'PERMANENT', amount: 2,
        }],
      },
      {
        ...state.battlefield[1],
        instanceId: 'e-spill',
        baseFortitude: 5,
        wounds: 0,
        modifiers: [],
      },
    ];
    const card = makeCardInstance('test.overkill', 'p1');
    const cardDef = {
      id: 'test.overkill', name: 'Test Overkill', type: 'ABILITY',
      effects: [{
        type: 'OVERKILL_DAMAGE',
        amount: { kind: 'CONSTANT', value: 5 },
        target: { kind: 'SELECTED_ENEMY' },
        spill: { kind: 'OTHER_ENEMY' },
      }],
    } as unknown as CardDefinition;

    const result = resolveCard(state, card, cardDef, 'e-over', player, rng, registry, catalog);

    const hits = result.events.filter(e => e.type === 'DAMAGE_DEALT');
    const primary = hits.find(e => e.type === 'DAMAGE_DEALT' && e.targetId === 'e-over');
    const spill = hits.find(e => e.type === 'DAMAGE_DEALT' && e.targetId === 'e-spill');
    // Golpe primario: 5 base + 2 de vulnerabilidad = 7; quedan 3 → exceso 4.
    // Con el bug el exceso se calculaba solo con la base (5-3=2).
    expect(primary?.type === 'DAMAGE_DEALT' ? primary.amount : 0).toBe(7);
    expect(spill?.type === 'DAMAGE_DEALT' ? spill.amount : 0).toBe(4);
  });

  it('resuelve Recoger Flechas (RECOVER_CARD_BY_NAME + SHUFFLE_DECK + GAIN_COINS)', () => {
    const state = makeSetupState();
    // Dejar un "Disparo Rápido" en el Desgaste de p1
    const spent: CardInstance = {
      instanceId: 'spent-rapid-shot',
      definitionId: 'explorer.rapid-shot',
      ownerId: 'p1',
      zone: 'WEAR_PILE' as Zone,
      name: 'Disparo Rápido',
    };
    const withWear: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, wearPile: [...state.players.p1.wearPile, spent] },
      },
    };
    const player = withWear.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('explorer.collect-arrows', 'p1');
    const cardDef = catalog.byId.get('explorer.collect-arrows')!;

    const result = resolveCard(withWear, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // El Disparo Rápido vuelve al mazo de habilidad
    expect(result.events.some(e =>
      e.type === 'CARD_MOVED' && e.cardInstanceId === 'spent-rapid-shot'
      && e.from === 'WEAR_PILE' && e.to === 'ABILITY_DECK'
    )).toBe(true);
    // El mazo se baraja después
    expect(result.events.some(e => e.type === 'DECK_SHUFFLED' && (e as { deck?: string }).deck === 'ABILITY')).toBe(true);
    // Y se gana 1 Moneda
    expect(result.events.some(e => e.type === 'COINS_GAINED')).toBe(true);
  });

  it('resuelve Aura Protectora (CANCEL_ALL_DAMAGE)', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('mage.protective-aura', 'p1');
    const cardDef = catalog.byId.get('mage.protective-aura')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe activar cancelacion de dano
    expect(result.events.some(e => e.type === 'CANCELLATION_ACTIVATED')).toBe(true);
  });

  it('resuelve Escudo (PREVENT_ENEMY_DAMAGE)', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('warrior.shield', 'p1');
    const cardDef = catalog.byId.get('warrior.shield')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe deshabilitar el dano del enemigo
    expect(result.events.some(e => e.type === 'ENEMY_DAMAGE_DISABLED')).toBe(true);
  });

  it('resuelve Compañero Lobo (PREVENT_DAMAGE)', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('explorer.companion-wolf', 'p1');
    const cardDef = catalog.byId.get('explorer.companion-wolf')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe aplicar prevencion de 2 de dano
    const preventEvent = result.events.find(e => e.type === 'PREVENTION_APPLIED');
    expect(preventEvent).toBeDefined();
    if (preventEvent && preventEvent.type === 'PREVENTION_APPLIED') {
      expect(preventEvent.amount).toBe(2);
    }
  });

  it('resuelve Saqueo (GAIN_COINS proporcional a enemigos vivos)', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('rogue.plunder-a', 'p1');
    const cardDef = catalog.byId.get('rogue.plunder-a')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe ganar monedas (2 por enemigo vivo, hay 3 enemigos)
    const coinsEvent = result.events.find(e => e.type === 'COINS_GAINED');
    expect(coinsEvent).toBeDefined();
    if (coinsEvent && coinsEvent.type === 'COINS_GAINED') {
      expect(coinsEvent.amount).toBe(6); // 2 * 3 enemigos
    }
  });

  it('resuelve Robar Bolsillos (STEAL_COINS de otros heroes)', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('rogue.pickpocket', 'p1');
    const cardDef = catalog.byId.get('rogue.pickpocket')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe robar 1 moneda de cada otro heroe
    const stealEvents = result.events.filter(e => e.type === 'COINS_STOLEN');
    expect(stealEvents.length).toBe(1); // 1 otro jugador
  });

  it('resuelve Todo o Nada (roba y recupera)', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('warrior.all-or-nothing', 'p1');
    const cardDef = catalog.byId.get('warrior.all-or-nothing')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe robar 1 carta
    expect(result.events.some(e => e.type === 'CARDS_DRAWN')).toBe(true);
  });

  it('Golpe de Baston hace 2 de dano si ya se uso contra el mismo enemigo', () => {
    const state = makeSetupState();
    const enemy = state.battlefield[0];

    // Simular que ya se uso Golpe de Baston contra este enemigo
    const modifiedState: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          cardsPlayedAgainstEnemy: {
            [enemy.instanceId]: { 'Golpe de Bastón': 1 },
          },
        },
      },
    };

    const player = modifiedState.players.p1;
    const card = makeCardInstance('mage.staff-strike', 'p1');
    const cardDef = catalog.byId.get('mage.staff-strike')!;

    const result = resolveCard(modifiedState, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    const dmgEvent = result.events.find(e => e.type === 'DAMAGE_DEALT');
    if (dmgEvent && dmgEvent.type === 'DAMAGE_DEALT') {
      expect(dmgEvent.amount).toBe(2); // dano aumentado
    }
  });

  it('Piedra de Amolar anade modificador de dano', () => {
    const state = makeSetupState();
    const player = state.players.p1;
    const enemy = state.battlefield[0];
    const card = makeCardInstance('market.whetstone', 'p1');
    const cardDef = catalog.byId.get('market.whetstone')!;

    const result = resolveCard(state, card, cardDef, enemy.instanceId, player, rng, registry, catalog);

    // Debe anadir un modificador
    expect(result.events.some(e => e.type === 'MODIFIER_ADDED')).toBe(true);
    // El estado debe tener el modificador
    expect(result.newState.players.p1.modifiers.length).toBeGreaterThan(0);
  });
});
