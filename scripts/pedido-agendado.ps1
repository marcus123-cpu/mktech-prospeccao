$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$crm = Join-Path $env:LOCALAPPDATA 'hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py'
$runner = Join-Path $PSScriptRoot 'rodar-pesquisa-codex.ps1'
$log = Join-Path $project 'envio\logs\pedido.log'

try {
  if (-not (Test-Path $crm)) { throw 'Cliente CRM não encontrado.' }
  $response = & py $crm pedido-pendente 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Consulta do pedido falhou: $response" }
  $request = ($response | Out-String | ConvertFrom-Json)
  if ($request.status -notin @('pendente', 'retomar')) { exit 0 }
  Add-Content -LiteralPath $log -Value "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') · pedido $($request.pedido_id) ====="
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -Modo pedido *>> $log
  exit $LASTEXITCODE
} catch {
  Add-Content -LiteralPath $log -Value "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') · falha no acionamento: $($_.Exception.Message) ====="
  exit 1
}
