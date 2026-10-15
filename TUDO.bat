@echo off
rem TUDO EM UM: para a ponte e o enviador, baixa as atualizacoes do GitHub, atualiza a skill do Hermes,
rem religa a ponte do WhatsApp e o enviador e liga o painel em http://localhost:3000.
rem Para reiniciar tudo: feche esta janela e abra o TUDO.bat de novo.
title MKTech - TUDO (nao feche)
cd /d "C:\Users\pmarc\mktech-prospeccao"

echo [1/5] Parando ponte e enviador...
call "envio\parar-tudo.bat" silent
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do taskkill /PID %%p /T /F >nul 2>&1
timeout /t 3 >nul

echo [2/5] Baixando atualizacoes do GitHub...
for /f %%i in ('git rev-parse HEAD') do set ANTES=%%i
git checkout -- package-lock.json >nul 2>&1
git pull --ff-only
for /f %%i in ('git rev-parse HEAD') do set DEPOIS=%%i
rem Se mudou algo, apaga o marcador da montagem para o painel remontar.
if not "%ANTES%"=="%DEPOIS%" if exist ".next\BUILD_ID" del ".next\BUILD_ID" >nul 2>&1

echo [3/5] Atualizando a skill do Hermes...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\sincronizar-skill.ps1"

echo [4/5] Ligando ponte do WhatsApp e enviador (janela minimizada)...
start "MKTech Envio" /min cmd /c "C:\Users\pmarc\mktech-prospeccao\envio\iniciar-tudo.bat"
timeout /t 5 >nul

echo [5/5] Ligando o painel...
call "painel-auto.bat"
