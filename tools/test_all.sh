#!/usr/bin/env bash
# test_all.sh — una orden verifica todo el monorepo.
set -u
fail=0
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

gate() { echo "=== $1 ==="; shift; "$@" || fail=$((fail+1)); }

gate 'engine: typecheck'     pnpm --filter @nt4h/engine typecheck
gate 'engine: tests'         pnpm --filter @nt4h/engine test
gate 'engine-runner: typecheck' pnpm --filter @nt4h/engine-runner typecheck
gate 'engine-runner: tests'  pnpm --filter @nt4h/engine-runner test
gate 'mobile: typecheck'     pnpm --filter mobile typecheck
gate 'mobile: tests'         pnpm --filter mobile test
gate 'backend: Django tests' bash -c "cd apps/backend && python manage.py test"
gate 'backend: ruff'         bash -c "cd apps/backend && ruff check ."
gate 'backend: black'        bash -c "cd apps/backend && black --check -l 120 ."
gate 'yamllint'              yamllint .

if [ "$fail" -eq 0 ]; then echo "== SUITE COMPLETA: OK =="
else echo "== $fail gates en rojo =="; fi
exit $fail
