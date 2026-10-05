# test_all.ps1 — una orden verifica todo el monorepo.
# Uso: powershell tools/test_all.ps1
$ErrorActionPreference = 'Continue'
$fail = 0
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Gate($name, $block) {
    Write-Output "=== $name ==="
    & $block
    if ($LASTEXITCODE -ne 0) { $script:fail++ }
}

Gate 'engine: typecheck + tests' { pnpm --filter @nt4h/engine typecheck; pnpm --filter @nt4h/engine test }
Gate 'engine-runner: typecheck + tests' { pnpm --filter @nt4h/engine-runner typecheck; pnpm --filter @nt4h/engine-runner test }
Gate 'mobile: typecheck' { pnpm --filter mobile typecheck }
Gate 'mobile: tests' { pnpm --filter mobile test }
Gate 'backend: Django tests' {
    $py = Join-Path $root 'apps/backend/.venv/Scripts/python.exe'
    & $py (Join-Path $root 'apps/backend/manage.py') test
    if ($LASTEXITCODE -ne 0) { $fail++ }
}
Gate 'backend: ruff' { Set-Location (Join-Path $root 'apps/backend'); ruff check .; Set-Location $root }
Gate 'backend: black' { Set-Location (Join-Path $root 'apps/backend'); black --check -l 120 .; Set-Location $root }
Gate 'yamllint' { yamllint . }

if ($fail -eq 0) { Write-Output '== SUITE COMPLETA: OK ==' }
else { Write-Output "== $fail gates en rojo ==" }
exit $fail
