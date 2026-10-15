param([ValidateSet('diaria','pedido')][string]$Modo = 'diaria', [switch]$DryRun)

$ErrorActionPreference = 'Stop'
$projeto = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
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
  'Execute somente o pedido pendente do painel: start-run --routine pedido-painel. Pesquise apenas o nicho e a localização (Brasil, estado ou cidade) devolvidos no start-run, até a meta de leads novos ou o limite de buscas/tempo do pedido.'
}
$prompt = @"
Você é o agente de PESQUISA da MKTech Dev. Leia $skill e siga somente as seções de pesquisa, diagnóstico, deduplicação e cadastro de candidatos. O cliente CRM é $crm (use o Python do sistema); o arquivo .env dele contém as credenciais. $instrucoes
Pesquise na web com triagem de presença digital e atividade antes de aprofundar cada nome. Priorize negócios ativos sem site, landing page ou portfólio; descarte cedo quem já tem site. Cadastre candidatos mesmo com dados incompletos (telefone fixo ou celular, sem WhatsApp confirmado, nota baixa), registrando o que falta em pending_items; nunca afirme ausência de site sem confirmar. Descarte apenas duplicados, negócios fora do nicho ou da localização, encerrados e quem já tem site próprio sem lacuna comprovada. Se uma cidade ou consulta repetir apenas negócios com site, troque de nicho, bairro ou cidade antes de gastar todo o orçamento. Registre cada candidato com fontes verificáveis e diagnóstico honesto. Não execute modos de envio, leitura, secretário nem chamadas diretas ao WhatsApp. Não escreva mensagens comerciais; o motor V6 separado decide isso. Encerre a execução no CRM com --discard-reason "motivo=N" para cada motivo de descarte e informe números reais de buscas, cadastrados, descartados e erros; se ficar abaixo da meta, explique o motivo em --end-reason.
"@

& $codexPath exec --approve-for-me -c sandbox_workspace_write.network_access=true -C $projeto $prompt
exit $LASTEXITCODE
