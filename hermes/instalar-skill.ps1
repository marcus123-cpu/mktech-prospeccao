<#
.SYNOPSIS
  Instala a skill mktech-prospeccao no Hermes Agent (Windows) sem tocar no config.yaml.

.DESCRIPTION
  Copia a pasta skills\mktech-prospeccao para <HERMES_HOME>\skills\mktech\mktech-prospeccao
  e cria o arquivo .env da skill com a URL do CRM e o token de integração.
  Não sobrescreve uma instalação existente sem -Force. Não cria rotina agendada.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\hermes\instalar-skill.ps1
  powershell -ExecutionPolicy Bypass -File .\hermes\instalar-skill.ps1 -HermesHome "C:\Users\voce\AppData\Local\hermes"
#>
param(
  [string]$HermesHome,
  [string]$CrmUrl = "http://localhost:3000",
  [switch]$Force
)
$ErrorActionPreference = "Stop"

function Find-HermesHome {
  $candidates = @($env:HERMES_HOME, (Join-Path $env:LOCALAPPDATA "hermes"), (Join-Path $HOME ".hermes")) |
    Where-Object { $_ -and (Test-Path $_) }
  # Prefere a pasta que já tem skills ou config do Hermes.
  foreach ($c in $candidates) {
    if ((Test-Path (Join-Path $c "skills")) -or (Test-Path (Join-Path $c "auth.json"))) { return $c }
  }
  return $candidates | Select-Object -First 1
}

if (-not $HermesHome) { $HermesHome = Find-HermesHome }
if (-not $HermesHome -or -not (Test-Path $HermesHome)) {
  throw "Não achei a pasta do Hermes. Rode 'hermes status' para ver o HERMES_HOME e passe -HermesHome."
}
Write-Host "Pasta do Hermes: $HermesHome"
$answer = Read-Host "Confirma esta pasta? (s/n)"
if ($answer -notmatch '^[sS]') { throw "Cancelado. Passe -HermesHome com a pasta certa." }

$source = Join-Path $PSScriptRoot "skills\mktech-prospeccao"
$target = Join-Path $HermesHome "skills\mktech\mktech-prospeccao"
$envFile = Join-Path $target "scripts\.env"

if (Test-Path $target) {
  if (-not $Force) { throw "A skill já existe em $target. Use -Force para atualizar (o .env existente é mantido)." }
  $savedEnv = if (Test-Path $envFile) { Get-Content -Raw $envFile } else { $null }
  Remove-Item -Recurse -Force $target
}
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
Copy-Item -Recurse $source $target
Get-ChildItem -Recurse -Force $target -Include "__pycache__", "*.log" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

if ($savedEnv) {
  Set-Content -NoNewline -Encoding UTF8 -Path $envFile -Value $savedEnv
  Write-Host ".env anterior mantido."
} else {
  $url = Read-Host "URL do CRM [$CrmUrl]"
  if (-not $url) { $url = $CrmUrl }
  $secure = Read-Host "Token de integração (mkt_..., criado em Configurações do painel)" -AsSecureString
  $token = [System.Net.NetworkCredential]::new("", $secure).Password
  if ($token -notmatch '^mkt_[a-f0-9]{64}$') { throw "Token em formato inesperado. Nada foi gravado no .env." }
  Set-Content -Encoding UTF8 -Path $envFile -Value "MKTECH_CRM_URL=$url`nMKTECH_CRM_TOKEN=$token"
  # Só o usuário atual lê o .env.
  icacls $envFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  $token = $null
}

# Compatível com o Windows PowerShell 5.1 (sem o operador ??).
$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
if ($python) {
  Write-Host "Testando conexão com o CRM..."
  & $python.Source (Join-Path $target "scripts\mktech_crm.py") selftest
  if ($LASTEXITCODE -eq 0) { Write-Host "Conexão OK." } else { Write-Warning "selftest falhou (código $LASTEXITCODE). Veja a mensagem acima." }
} else {
  Write-Warning "Python não encontrado no PATH. Rode depois: python `"$target\scripts\mktech_crm.py`" selftest"
}

Write-Host ""
Write-Host "Skill instalada em $target"
Write-Host "Nenhuma rotina foi criada. Veja o README (seção Hermes) para o teste manual e a rotina pausada."
