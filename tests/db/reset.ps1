# Banco isolado de testes; nunca usa .env.local nem credenciais de produção.
$ErrorActionPreference = 'Stop'
$pgBin = if ($env:MKTECH_TEST_PG_BIN) { $env:MKTECH_TEST_PG_BIN } else { 'C:\Program Files\PostgreSQL\18\bin' }
$pgHostName = if ($env:PGHOST) { $env:PGHOST } else { '127.0.0.1' }
$pgTestPort = if ($env:PGPORT) { $env:PGPORT } else { '54329' }
if ($pgHostName -notin @('127.0.0.1','localhost') -or $pgTestPort -ne '54329') { throw 'Reset permitido apenas em localhost:54329.' }
$pgArgs = @('-h',$pgHostName,'-p',$pgTestPort,'-U','postgres','-v','ON_ERROR_STOP=1','-q')
& "$pgBin\psql.exe" @pgArgs -d postgres -c 'drop database if exists crm_test with (force)' -c 'create database crm_test'
if ($LASTEXITCODE -ne 0) { throw 'Falha criando banco isolado.' }
& "$pgBin\psql.exe" @pgArgs -d crm_test -f "$PSScriptRoot\supabase-shim.sql"
if ($LASTEXITCODE -ne 0) { throw 'Falha no shim.' }
Get-ChildItem -LiteralPath "$PSScriptRoot\..\..\supabase\migrations" -Filter '*.sql' | Sort-Object Name | ForEach-Object {
  & "$pgBin\psql.exe" @pgArgs -d crm_test -f $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Falha na migration $($_.Name)" }
}
Write-Output 'ok: crm_test local'
