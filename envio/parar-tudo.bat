@echo off
rem Para a ponte, o secretario, o pedido de busca, o enviador e o navegador interno do WhatsApp Web.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'mktech_envio.py|bridge.js|ponte-loop|enviador-loop|secretario-loop|pedido-loop|iniciar-tudo|wwebjs_auth' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
if /i not "%~1"=="silent" (echo Tudo parado. & pause)
