/**
 * Regresión: cartas que necesitan objetivo enemigo.
 *
 * checkCardPlayable evalúa PLAY_CARD sin targetEnemyId; el motor
 * responde TARGET_REQUIRED (E-13). Eso NO significa "injugable":
 * la carta se selecciona y el objetivo se elige después en el campo.
 * Si la mano la marca bloqueada, 21 de las 33 pericias del catálogo
 * no se pueden jugar desde la UI (ni tap ni drag).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { getCardTargeting } from '../lib/targeting';
import type { GameConfig } from '@nt4h/schema';

// Solitario: sin puja de Líder; el mazo explorer contiene pericias
// que exigen objetivo (Disparo Certero, Compañero Lodo…).
const config: GameConfig = {
  mode: 'SOLO',
  playerCount: 1,
  seed: 'playability-001',
  heroes: [
    { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
  ],
  useScenarios: false,
};

const initialState = useGameStore.getState();

// Cartas del catálogo que el motor exige con targetEnemyId
// (printedAttack sin reparto o efecto SELECTED_ENEMY/ONE_ENEMY).
const SPECIAL = new Set([
  'DEAL_DAMAGE_SPLIT', 'DEAL_DAMAGE_ALL_ENEMIES',
  'DEAL_DAMAGE_TO_HERO', 'DEAL_DAMAGE_TO_OTHER_HEROES',
]);
// Misma regla que isLegal (execute.ts E-13): printedAttack sin daño
// especial o selector SELECTED_ENEMY/ONE_ENEMY en efectos de nivel 1.
function needsTarget(def: { printedAttack?: number; effects?: { type: string; target?: unknown }[] }): boolean {
  const types = new Set((def.effects ?? []).map(e => e.type));
  const special = [...types].some(t => SPECIAL.has(t));
  const sel = (def.effects ?? []).some(e => {
    const t = e.target;
    return typeof t === 'object' && t !== null
      && ['SELECTED_ENEMY', 'ONE_ENEMY'].includes((t as { kind?: string }).kind ?? '');
  });
  return ((def.printedAttack ?? 0) > 0 && !special) || sel;
}

describe('checkCardPlayable — cartas con objetivo', () => {
  beforeEach(() => {
    useGameStore.setState(initialState, true);
    useGameStore.getState().newGame(config);
  });

  it('una pericia que exige enemigo es seleccionable (ok), no bloqueada', () => {
    const s = useGameStore.getState();
    const state = s.gameState!;
    const catalog = s.catalog!;
    const player = state.players[state.activePlayerId];
    // El jugador activo en turno 1 debe tener enemigos en el campo
    expect(state.battlefield.length).toBeGreaterThan(0);
    // Buscar en mano una carta que necesite objetivo
    const targetCard = player.hand.find(c => {
      const def = catalog.byId.get(c.definitionId);
      return def && needsTarget(def);
    });
    if (!targetCard) {
      // Si no cayó en mano, moverla desde el mazo
      const inDeck = player.abilityDeck.find(c => {
        const def = catalog.byId.get(c.definitionId);
        return def && needsTarget(def);
      });
      expect(inDeck).toBeDefined();
      useGameStore.setState((st) => {
        const p = st.gameState!.players[state.activePlayerId];
        st.gameState!.players[state.activePlayerId].hand.push(inDeck!);
        p.abilityDeck.splice(p.abilityDeck.indexOf(inDeck!), 1);
      });
    }
    const card = useGameStore.getState().gameState!.players[state.activePlayerId]
      .hand.find(c => needsTarget(catalog.byId.get(c.definitionId)!))!;
    const check = useGameStore.getState().checkCardPlayable(card.instanceId);
    expect(check.ok, `carta ${card.definitionId} bloqueada: ${check.reason}`).toBe(true);
  });

  it('getCardTargeting pide enemigo para printedAttack sin selector (regla del motor)', () => {
    const catalog = useGameStore.getState().catalog!;
    // Espadazo: printedAttack 1, sin selector enemigo — la UI debe pedir
    // objetivo o el motor rechaza el PLAY_CARD sin targetEnemyId.
    const sword = catalog.byId.get('warrior.sword-strike');
    expect(sword).toBeDefined();
    expect(getCardTargeting(sword).mode).toBe('enemy');
    // Toda carta que el motor marca needsTarget debe pedir enemigo en la UI
    for (const def of catalog.byId.values()) {
      if (def.type !== 'ABILITY' && def.type !== 'MARKET') continue;
      if (needsTarget(def)) {
        expect(getCardTargeting(def).mode, `${def.id} no pide objetivo en la UI`).toBe('enemy');
      }
    }
  });

  it('flujo completo: seleccionar carta + enemigo + confirmar la juega', () => {
    const catalog = useGameStore.getState().catalog!;
    const state = useGameStore.getState().gameState!;
    const player = state.players[state.activePlayerId];
    const card = player.hand.find(c => {
      const def = catalog.byId.get(c.definitionId);
      return def && needsTarget(def);
    });
    expect(card, 'la mano inicial no trajo ninguna pericia de objetivo').toBeDefined();

    // Igual que HandView: selectCard → selectEnemy → playCard(id, target)
    useGameStore.getState().selectCard(card!.instanceId);
    const enemy = state.battlefield[0];
    useGameStore.getState().selectEnemy(enemy.instanceId);
    useGameStore.getState().playCard(card!.instanceId, enemy.instanceId);

    const after = useGameStore.getState();
    expect(after.ui.message, `jugada rechazada: ${after.ui.message}`).not.toMatch(/fall|error|inválid/i);
    const hand = after.gameState!.players[state.activePlayerId].hand;
    expect(hand.some(c => c.instanceId === card!.instanceId)).toBe(false);
    expect(after.ui.selectedCardInstanceId).toBeNull();
  });

  it('sin enemigos en el campo la carta sigue sin ser jugable', () => {
    const s = useGameStore.getState();
    const catalog = s.catalog!;
    // Vaciar el campo de batalla
    useGameStore.setState((st) => { st.gameState!.battlefield = []; });
    const state = useGameStore.getState().gameState!;
    const player = state.players[state.activePlayerId];
    const card = player.hand.find(c => needsTarget(catalog.byId.get(c.definitionId)!));
    if (card) {
      const check = useGameStore.getState().checkCardPlayable(card.instanceId);
      expect(check.ok).toBe(false);
    }
  });
});
