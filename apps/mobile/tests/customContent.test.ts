/**
 * Taller: historial de deshacer y versiones publicadas inmutables.
 */

import { describe, it, expect } from 'vitest';
import { useCustomContent } from '../lib/customContent';
import type { CardDefinition } from '@nt4h/schema';

const card: CardDefinition = {
  id: 'custom.test-card',
  name: 'Carta de prueba',
  type: 'ABILITY',
  heroClass: 'EXPLORER',
  copies: 1,
  printedAttack: 1,
  effects: [],
  destinationAfterUse: 'WEAR_PILE',
  verificationStatus: 'CONFIRMED',
  author: 'test',
  version: '1.0.0',
  officialStatus: 'CUSTOM',
  setId: 'set.taller-local',
} as CardDefinition;

describe('customContent — undo + publicación', () => {
  it('upsertCard registra historial y undo lo revierte', () => {
    const s = useCustomContent.getState();
    s.upsertCard(card);
    let sets = useCustomContent.getState().sets;
    const set = sets.find(x => x.id === 'set.taller-local');
    expect(set?.cards.map(c => c.id)).toContain('custom.test-card');

    expect(useCustomContent.getState().undo('set.taller-local')).toBe(true);
    sets = useCustomContent.getState().sets;
    expect(sets.find(x => x.id === 'set.taller-local')?.cards ?? []).toHaveLength(0);
    // Segundo undo sin historial → false
    expect(useCustomContent.getState().undo('set.taller-local')).toBe(false);
  });

  it('publish crea versión inmutable con checksum y patch+1', () => {
    useCustomContent.getState().upsertCard(card);
    const errors = useCustomContent.getState().publish('set.taller-local');
    expect(errors).toEqual([]);
    const published = useCustomContent.getState().published['set.taller-local'];
    expect(published).toHaveLength(1);
    expect(published[0].version).toBe('1.0.1');
    expect(published[0].checksum).toMatch(/^[0-9a-f]{8}$/);

    // La segunda publicación incrementa el patch
    useCustomContent.getState().publish('set.taller-local');
    const v2 = useCustomContent.getState().published['set.taller-local'];
    expect(v2).toHaveLength(2);
    expect(v2[1].version).toBe('1.0.2');
  });

  it('restoreVersion recupera un snapshot como borrador (revertible)', () => {
    const published = useCustomContent.getState().published['set.taller-local'];
    expect(published.length).toBeGreaterThan(0);
    const ok = useCustomContent.getState().restoreVersion('set.taller-local', published[0].version);
    expect(ok).toBe(true);
    const set = useCustomContent.getState().sets.find(s => s.id === 'set.taller-local');
    expect(set?.status).toBe('DRAFT');
    expect(set?.cards.map(c => c.id)).toContain('custom.test-card');
    // Revertible: undo restaura el estado previo
    expect(useCustomContent.getState().undo('set.taller-local')).toBe(true);
  });
});

describe('customContent — papelera y fragmentos', () => {
  it('removeCard mueve la carta a la papelera y restoreCard la recupera con su borrador', () => {
    const s = useCustomContent.getState();
    s.upsertCard(card);
    s.saveCardDraft(card.id, { draftVersion: 2, name: 'Borrador' });
    s.removeCard(card.id);

    let st = useCustomContent.getState();
    expect(st.sets.flatMap(x => x.cards).find(c => c.id === card.id)).toBeUndefined();
    expect(st.trash[card.id]?.card.id).toBe(card.id);
    expect(st.trash[card.id]?.draft).toEqual({ draftVersion: 2, name: 'Borrador' });

    expect(st.restoreCard(card.id)).toBe(true);
    st = useCustomContent.getState();
    expect(st.sets.flatMap(x => x.cards).find(c => c.id === card.id)).toBeDefined();
    expect(st.trash[card.id]).toBeUndefined();
    expect(st.cardDrafts[card.id]).toEqual({ draftVersion: 2, name: 'Borrador' });
    // Restaurar algo que no está → false
    expect(st.restoreCard('custom.inexistente')).toBe(false);
  });

  it('purgeTrash vacía la papelera', () => {
    useCustomContent.getState().removeCard(card.id);
    expect(Object.keys(useCustomContent.getState().trash).length).toBeGreaterThan(0);
    useCustomContent.getState().purgeTrash();
    expect(Object.keys(useCustomContent.getState().trash)).toHaveLength(0);
  });

  it('saveFragment guarda y removeFragment elimina', () => {
    const s = useCustomContent.getState();
    s.saveFragment('mi combo', [{ key: 1, kind: 'ACTION', actionType: 'GAIN_COINS' }]);
    const frags = useCustomContent.getState().fragments;
    expect(frags.length).toBeGreaterThan(0);
    const frag = frags.find(f => f.name === 'mi combo');
    expect(frag?.nodes).toHaveLength(1);
    useCustomContent.getState().removeFragment(frag!.id);
    expect(useCustomContent.getState().fragments.find(f => f.id === frag!.id)).toBeUndefined();
  });
});
