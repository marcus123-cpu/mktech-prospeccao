@echo off
rem Mantem a ponte do WhatsApp Web no ar, sem janela. Se cair, sobe de novo em 15 segundos.
cd /d "%~dp0whatsapp-web"
set ENVIO_SO_PARA=5517992250729
if exist "%~dp0.env" for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0.env") do if "%%a"=="ENVIO_SO_PARA" set ENVIO_SO_PARA=%%b
if not exist "%~dp0logs" mkdir "%~dp0logs"
:loop
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "127.0.0.1:3799" ^| findstr LISTENING') do taskkill /PID %%p /T /F >nul 2>&1
node bridge.js >> "%~dp0logs\ponte.log" 2>&1
ping -n 16 127.0.0.1 >nul
goto loop
