$ErrorActionPreference = 'Stop'
$taskLoop = Join-Path $PSScriptRoot 'preparador-loop.bat'
$taskRunning = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'cmd.exe' -and $_.CommandLine -like "*$taskLoop*"
}
if (-not $taskRunning) {
  Start-Process -FilePath $env:ComSpec -ArgumentList '/c', ('"' + $taskLoop + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
}
