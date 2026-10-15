# Copia a skill do Hermes do projeto para a pasta do Hermes, sem perguntas.
# Só sobrescreve os arquivos versionados; mantém o .env e os arquivos gerados.
$ErrorActionPreference = 'Stop'
$proj = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$hermes = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
$dst = Join-Path $hermes 'skills\mktech\mktech-prospeccao'
if (-not (Test-Path $dst)) { Write-Output 'Skill ainda nao instalada; rode hermes\instalar-skill.ps1 uma vez.'; exit 0 }
$prefix = 'hermes/skills/mktech-prospeccao/'
$n = 0
foreach ($f in (git -C $proj ls-files $prefix.TrimEnd('/'))) {
  $d = Join-Path $dst $f.Substring($prefix.Length)
  New-Item -ItemType Directory -Force -Path (Split-Path $d) | Out-Null
  Copy-Item -LiteralPath (Join-Path $proj $f) -Destination $d -Force
  $n++
}
Write-Output "Skill do Hermes atualizada ($n arquivos)."
