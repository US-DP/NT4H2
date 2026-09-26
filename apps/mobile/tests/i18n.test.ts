/* eslint-disable security/detect-non-literal-fs-filename -- el test escanea directorios de fuentes a propósito */
/**
 * i18n — paridad y cobertura de claves.
 *
 * 1. Paridad es↔en: los dos árboles de recursos tienen exactamente las
 *    mismas claves (un key falta → t() muestra la clave cruda).
 * 2. Cobertura: toda clave literal `t('a.b.c')` usada en app/, components/,
 *    store/ y lib/ existe en ambos idiomas.
 * 3. Sanidad: los valores no son la propia clave ni están vacíos.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import i18n from '../lib/i18n';

type Tree = Record<string, unknown>;

function flatten(tree: Tree, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      for (const sub of flatten(v as Tree, key)) out.add(sub);
    } else {
      out.add(key);
    }
  }
  return out;
}

const es = i18n.getResourceBundle('es', 'translation') as Tree;
const en = i18n.getResourceBundle('en', 'translation') as Tree;
const esKeys = flatten(es);
const enKeys = flatten(en);

describe('i18n — paridad de claves es/en', () => {
  it('español e inglés tienen las mismas claves', () => {
    const onlyEs = [...esKeys].filter(k => !enKeys.has(k));
    const onlyEn = [...enKeys].filter(k => !esKeys.has(k));
    expect(onlyEs, `solo en es: ${onlyEs.join(', ')}`).toEqual([]);
    expect(onlyEn, `solo en en: ${onlyEn.join(', ')}`).toEqual([]);
  });

  it('ningún valor traducido queda vacío ni repite la clave', () => {
    const bad: string[] = [];
    for (const k of esKeys) {
      const v = i18n.getResource('es', 'translation', k) as string;
      if (typeof v !== 'string' || v.trim() === '' || v === k) bad.push(`es:${k}`);
    }
    for (const k of enKeys) {
      const v = i18n.getResource('en', 'translation', k) as string;
      if (typeof v !== 'string' || v.trim() === '' || v === k) bad.push(`en:${k}`);
    }
    expect(bad).toEqual([]);
  });
});

// ============================================================================
// Cobertura: claves literales usadas en el código fuente
// ============================================================================

const ROOT = resolve(__dirname, '..');
const SRC_DIRS = ['app', 'components', 'store', 'lib'];

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'tests') continue;
      out.push(...collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('i18n — cobertura de claves usadas en el código', () => {
  const files = SRC_DIRS.flatMap(d => collectFiles(join(ROOT, d)));
  const keyRe = /\bt\(\s*['"]([a-zA-Z][a-zA-Z0-9_.]*)['"]/g;
  const used = new Map<string, string[]>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(keyRe)) {
      const list = used.get(m[1]) ?? [];
      list.push(f.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, ''));
      used.set(m[1], list);
    }
  }

  it('toda clave usada existe en es y en', () => {
    // i18next resuelve plurales a <key>_one/_other/_zero/_few/_many — una
    // clave "encontrada" existe tal cual o en su forma plural.
    const existsIn = (lng: 'es' | 'en', key: string) =>
      ['', '_one', '_other', '_zero', '_few', '_many'].some(
        s => i18n.getResource(lng, 'translation', `${key}${s}`) !== undefined,
      );
    const missing: string[] = [];
    for (const [key, where] of used) {
      const inEs = existsIn('es', key);
      const inEn = existsIn('en', key);
      if (!inEs || !inEn) {
        missing.push(`${key} (${!inEs ? 'es ' : ''}${!inEn ? 'en ' : ''}— ${where[0]})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
