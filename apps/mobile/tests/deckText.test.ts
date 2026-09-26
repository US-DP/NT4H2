/**
 * Importación de mazos desde texto plano (parser tipo Untap/Cockatrice).
 */

import { describe, it, expect } from 'vitest';
import { parseDeckText, cardNameIndex, normalizeCardName } from '../lib/deckText';
import type { CardDefinition } from '@nt4h/schema';

const mk = (id: string, name: string, heroClass = 'EXPLORER', type = 'ABILITY') =>
  ({ id, name, type, heroClass }) as unknown as CardDefinition;

const index = cardNameIndex([
  mk('explorer.espadazo', 'Espadazo'),
  mk('explorer.ballesta', 'Ballesta Ligera'),
  mk('explorer.daga', 'Daga Élfica'),
  mk('horda.orco', 'Orco Merodeador', '', 'ENEMY'), // no-ABILITY: fuera del índice
]);

describe('parseDeckText', () => {
  it('acepta "N nombre", "Nx nombre", "nombre xN" y nombre a secas', () => {
    const r = parseDeckText(
      '4 Espadazo\n2x Ballesta Ligera\nDaga Élfica x3\nDaga Élfica',
      index,
    );
    expect(r.cards['explorer.espadazo']).toBe(4);
    expect(r.cards['explorer.ballesta']).toBe(2);
    expect(r.cards['explorer.daga']).toBe(4); // 3 + 1 se suman
    expect(r.total).toBe(10);
    expect(r.unknown).toEqual([]);
    expect(r.classes).toEqual(['EXPLORER']);
  });

  it('ignora comentarios y líneas vacías', () => {
    const r = parseDeckText('# mi mazo\n\n// otra nota\n1 Espadazo', index);
    expect(r.total).toBe(1);
    expect(r.unknown).toEqual([]);
  });

  it('es insensible a mayúsculas y tildes', () => {
    const r = parseDeckText('1 DAGA ELFICA\n1 espadazo', index);
    expect(r.cards['explorer.daga']).toBe(1);
    expect(r.cards['explorer.espadazo']).toBe(1);
    expect(r.unknown).toEqual([]);
  });

  it('reporta nombres desconocidos y cartas no-ABILITY', () => {
    const r = parseDeckText('1 Espada Legendaria\n2 Orco Merodeador', index);
    expect(r.unknown).toEqual(['Espada Legendaria', 'Orco Merodeador']);
    expect(r.total).toBe(0);
  });
});

describe('normalizeCardName', () => {
  it('elimina tildes, signos y espacios extra', () => {
    expect(normalizeCardName('  Daga  Élfica!! ')).toBe('daga elfica');
    expect(normalizeCardName('Tizón Ardiente')).toBe('tizon ardiente');
  });
});
