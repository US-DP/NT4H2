/**
 * Handlers de horda: aparicion, intercambio, retorno y escenario custom.
 * Extraido de registry.ts (split por dominio).
 */

import {
  resolveTarget,
  type EffectRegistry,
} from '../registry.js';

export function registerEnemiesEffects(registry: EffectRegistry): void {
  registry.register('CUSTOM_SCENARIO', (_eff, _ctx, _state) => {
    // Los handlers reales estan en scenarios/index.ts (applyScenarioEffects, onTurnStart, etc.)
    return [];
  });
  registry.register('SWAP_ENEMY', (eff, ctx, state) => {
    // Nota: el resolver intercepta SWAP_ENEMY antes de llegar aqui para acceder al catalogo.
    // Este handler es fallback si el resolver no lo intercepta.
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId || state.hordeDeck.length === 0) return [];
    const newEnemyCard = state.hordeDeck[state.hordeDeck.length - 1];
    return [
      {
        type: 'ENEMY_SWAPPED' as const,
        oldEnemyInstanceId: targetId,
        newEnemyInstanceId: newEnemyCard.instanceId,
        newEnemyDefinitionId: newEnemyCard.definitionId,
        newEnemyFortitude: 1,
        newEnemyReward: null,
        newEnemyIsOrc: false,
        newEnemyIsWarlord: false,
        newEnemySpecialIcons: [],
        seq: registry.nextSeq(),
      },
    ];
  });
  registry.register('RETURN_TO_HORDE', (eff, ctx, state) => {
    const targetId = resolveTarget(eff.target, ctx, state);
    if (!targetId) return [];
    return [{
      type: 'ENEMY_RETURNED_TO_HORDE',
      enemyInstanceId: targetId,
      position: eff.position,
      seq: registry.nextSeq(),
    }];
  });
  registry.register('SPAWN_ENEMY', (_eff, _ctx, _state) => []);

  // DISCARD_HORDE_CARD: elimina N cartas del mazo de la Horda
  registry.register('DISCARD_HORDE_CARD', (eff, _ctx, state) => {
    const fromTop = eff.from === 'TOP';
    const cards = fromTop
      ? state.hordeDeck.slice(0, eff.count)
      : state.hordeDeck.slice(-eff.count);
    return cards.map(c => ({
      type: 'HORDE_CARD_DISCARDED' as const,
      cardInstanceId: c.instanceId,
      seq: registry.nextSeq(),
    }));
  });
  registry.register('MOVE_HORDE_CARDS', (eff, _ctx, state) => {
    const deck = state.hordeDeck;
    if (deck.length === 0) return [];
    const n = Math.min(eff.count, deck.length);
    // Se roba desde el FONDO (fin del array)
    const drawn = deck.slice(-n);
    const rest = deck.slice(0, deck.length - n);
    const newDeck = eff.to === 'TOP' ? [...drawn, ...rest] : [...rest, ...drawn];
    return [{
      type: 'HORDE_DECK_REORDERED' as const,
      newOrder: newDeck.map(c => c.instanceId),
      seq: registry.nextSeq(),
    }];
  });
}
