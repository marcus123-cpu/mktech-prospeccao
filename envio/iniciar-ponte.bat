@echo off
rem Abre a ponte do WhatsApp Web. Na primeira vez, escaneie o QR code com o chip de prospeccao.
rem Deixe esta janela aberta enquanto o envio estiver ligado.
rem Encerra uma ponte antiga que ainda esteja aberta na porta 3799 (a sessao do WhatsApp continua salva).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "127.0.0.1:3799" ^| findstr LISTENING') do taskkill /PID %%p /T /F >nul 2>&1
cd /d "%~dp0whatsapp-web"
set ENVIO_SO_PARA=5517992250729
if exist "%~dp0.env" for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0.env") do if "%%a"=="ENVIO_SO_PARA" set ENVIO_SO_PARA=%%b
node bridge.js
pause
