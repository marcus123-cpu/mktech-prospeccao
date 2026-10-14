param([ValidateSet('diaria','pedido')][string]$Modo = 'diaria', [switch]$DryRun, [datetime]$DataTeste)

$ErrorActionPreference = 'Stop'
$projeto = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$agoraSP = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([datetimeoffset]::UtcNow, 'E. South America Standard Time')
if ($PSBoundParameters.ContainsKey('DataTeste') -and -not $DryRun) { throw 'DataTeste exige DryRun.' }
$dataPesquisa = if ($PSBoundParameters.ContainsKey('DataTeste')) { $DataTeste.Date } else { $agoraSP.Date }
$usarGemini = $dataPesquisa -ge [datetime]'2026-10-15'
if ($usarGemini) {
  $researcher = Join-Path $PSScriptRoot 'pesquisa-gemini.py'
  if (-not (Test-Path $researcher)) { throw 'Pesquisador Gemini não encontrado.' }
  if ($DryRun) { Write-Output "Gemini 3.1 programado; modo=$Modo; nenhuma execução iniciada."; exit 0 }
  $ready = & py $researcher --modo $Modo --ready
  if ($LASTEXITCODE -eq 0) {
    $env:PYTHONIOENCODING = 'utf-8'
    & py $researcher --modo $Modo
    exit $LASTEXITCODE
  }
  Write-Output 'Gemini sem cota ou indisponível; pesquisa segue pelo Codex.'
}
$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codex) {
  $codex = Get-ChildItem (Join-Path $env:USERPROFILE '.vscode\extensions') -Filter 'codex.exe' -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'openai\.chatgpt-' } |
    Sort-Object FullName -Descending | Select-Object -First 1
}
if (-not $codex) { throw 'Codex CLI não encontrado; pesquisa não iniciada.' }
$codexPath = if ($codex -is [System.IO.FileInfo]) { $codex.FullName } else { $codex.Source }

$skill = Join-Path $projeto 'hermes\skills\mktech-prospeccao\SKILL.md'
$crm = Join-Path $env:LOCALAPPDATA 'hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py'
if (-not (Test-Path $crm)) { throw 'Cliente CRM da pesquisa não encontrado.' }
if ($DryRun) {
  Write-Output "Codex encontrado; modo=$Modo; skill e cliente CRM encontrados. Nenhuma execução iniciada."
  exit 0
}

$instrucoes = if ($Modo -eq 'diaria') {
  'Execute a rotina diária com start-run normal, sem --manual. Obedeça à meta, cidades, nichos, limite de buscas e tempo retornados pelo CRM.'
} else {
  'Execute somente o pedido pendente do painel: start-run --routine pedido-painel. Obedeça à meta e ao limite do pedido.'
}
$prompt = @"
Você é o agente de PESQUISA da MKTech Dev. Leia $skill e siga somente as seções de pesquisa, diagnóstico, deduplicação e cadastro de candidatos. O cliente CRM é $crm (use o Python do sistema); o arquivo .env dele contém as credenciais. $instrucoes
Pesquise na web e registre cada candidato com fonte verificável e diagnóstico honesto. Não execute modos de envio, leitura, secretário nem chamadas diretas ao WhatsApp. Não escreva mensagens comerciais; o motor V6 separado decide isso. Encerre a execução no CRM e informe números reais de buscas, cadastrados, descartados e erros.
"@

& $codexPath exec --approve-for-me -c sandbox_workspace_write.network_access=true -C $projeto $prompt
exit $LASTEXITCODE
