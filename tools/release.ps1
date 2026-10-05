# release.ps1 <x.y.z> — prepara y taggea una release semver.
# Exige sección [vx.y.z] en CHANGELOG.md y suite completa en verde.
# Uso: powershell tools/release.ps1 1.2.0  (sin la 'v')
param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$tag = "v$Version"
if (-not ($Version -match '^\d+\.\d+\.\d+$')) {
    Write-Error "Version '$Version' no es semver x.y.z"
}

$changelog = Get-Content CHANGELOG.md -Raw -Encoding utf8
if (-not $changelog.Contains("[$tag]")) {
    Write-Error "Falta la sección [$tag] en CHANGELOG.md"
}

git rev-parse -q --verify "refs/tags/$tag" *> $null
if ($LASTEXITCODE -eq 0) { Write-Error "El tag $tag ya existe" }

Write-Output "== suite completa =="
& "$root\tools\test_all.ps1"
if ($LASTEXITCODE -ne 0) { Write-Error "Suite en rojo — no se taggea" }

git tag -a $tag -m "Release $tag"
Write-Output "Tag $tag creado. Publicar con: git push origin $tag"
Write-Output "El workflow .github/workflows/release.yml corre el gate + build + GH Release."
