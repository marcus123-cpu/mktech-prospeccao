$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$logDirectory = Join-Path $projectRoot 'envio\logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$batchPath = Join-Path $projectRoot 'TUDO.bat'
Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /c ""' + $batchPath + '" --background"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'inicializacao.log') -RedirectStandardError (Join-Path $logDirectory 'inicializacao.err')
