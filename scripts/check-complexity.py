"""check-complexity — informe de tamaño y complejidad del monorepo.

Mide, por archivo fuente (excluye node_modules, dist, .expo, coverage,
migraciones y ficheros generados):

  - LOC (líneas totales)
  - Puntos de decisión (if/for/while/case/catch/&&/||/?) — heurística
    de complejidad ciclomática para TS/TSX y `radon`-lite para Python.

Umbrales (ratchet — no subir sin refactor):
  - WARN: archivo > 800 LOC o densidad > 0.15 decisiones/línea
  - FAIL: archivo > 1500 LOC  → exit 1

Uso:  python scripts/check-complexity.py [--fail]
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXCLUDE_DIRS = {
    'node_modules', '.git', 'dist', 'build', '.expo', 'coverage',
    '__pycache__', '.venv', 'venv', 'migrations', '.next', 'out',
}
EXCLUDE_SUFFIX = ('.d.ts', '.test.ts', '.test.tsx', '.test.py')
EXCLUDE_FILES = {'tests.py'}  # Django: fichero de tests, no codigo de produccion
# Datos declarativos intencionalmente grandes (tablas, i18n, catálogos JSON).
ALLOWLIST = {
    os.path.join('apps', 'mobile', 'lib', 'i18n.ts'),
    os.path.join('apps', 'mobile', 'lib', 'i18n'),
}

WARN_LOC = 800
WARN_DENSITY = 0.15
FAIL_LOC = 1500

BRANCH_TS = re.compile(r'\b(if|for|while|case|catch|else if)\b|&&|\|\||\?(?!\.)')
BRANCH_PY = re.compile(r'\b(if|elif|for|while|except|with)\b|\band\b|\bor\b')


def iter_sources():
    for root, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if f in EXCLUDE_FILES:
                continue
            if f.endswith(('.ts', '.tsx', '.py')) and not f.endswith(EXCLUDE_SUFFIX):
                yield os.path.join(root, f)


def measure(path: str) -> tuple[int, int] | None:
    rel = os.path.relpath(path, ROOT)
    if any(rel.startswith(a.rstrip(os.sep) + os.sep) or rel == a.rstrip(os.sep)
           for a in ALLOWLIST):
        return None
    try:
        text = open(path, encoding='utf-8').read()
    except (OSError, UnicodeDecodeError):
        return None
    loc = text.count('\n') + 1
    rx = BRANCH_PY if path.endswith('.py') else BRANCH_TS
    branches = len(rx.findall(text))
    return loc, branches


def main() -> int:
    rows: list[tuple[int, int, str]] = []
    for p in iter_sources():
        m = measure(p)
        if m:
            rows.append((m[0], m[1], p))
    rows.sort(reverse=True)

    total = sum(r[0] for r in rows)
    print(f'Total: {total} LOC en {len(rows)} archivos fuente\n')
    print('Top 20 por LOC:')
    fails, warns = [], []
    for i, (loc, br, p) in enumerate(rows):
        rel = os.path.relpath(p, ROOT)
        density = br / loc if loc else 0
        mark = ''
        if loc > FAIL_LOC:
            mark = '  **FAIL**'
            fails.append(rel)
        elif loc > WARN_LOC or density > WARN_DENSITY:
            mark = '  (warn)' if loc > WARN_LOC else '  (denso)'
            warns.append(rel)
        if i < 20:
            print(f'  {loc:6}  {br:4}  {density:.2f}  {rel}{mark}')

    over_warn = [r for r in rows if r[0] > WARN_LOC]
    dense = [r for r in rows if r[0] <= WARN_LOC and (r[1] / r[0]) > WARN_DENSITY]
    if over_warn:
        print(f'\nArchivos > {WARN_LOC} LOC: {len(over_warn)}')
        for loc, br, p in over_warn:
            print(f'    {loc:6}  {os.path.relpath(p, ROOT)}')
    if dense:
        print('\nArchivos densos (>0.15 decisiones/linea):')
        for loc, br, p in dense:
            print(f'    {loc:6}  {br/loc:.2f}  {os.path.relpath(p, ROOT)}')

    if fails:
        print(f'\nFAIL: {len(fails)} archivo(s) superan {FAIL_LOC} LOC — refactorizar.')
        return 1 if '--fail' in sys.argv else 0
    print(f'\nOK: ningún archivo supera {FAIL_LOC} LOC.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
