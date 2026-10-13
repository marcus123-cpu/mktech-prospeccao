@echo off
rem Painel MKTech: atualiza do GitHub, monta se precisar e deixa ligado em http://localhost:3000.
rem Roda sozinho quando o Windows liga (atalho na pasta Inicializar). Fechar esta janela desliga o painel.
title Painel MKTech (nao feche)
cd /d "C:\Users\pmarc\mktech-prospeccao"
if not exist .env.local (
  echo Falta o arquivo .env.local com as chaves do Supabase.
  pause
  exit /b 1
)
rem Garante a rotina diaria do Hermes no Agendador de Tarefas (todo dia 07:00).
schtasks /query /tn "MKTech Prospeccao" >nul 2>&1 || (
  schtasks /create /tn "MKTech Prospeccao" /tr "C:\Users\pmarc\mktech-prospeccao\rotina-hermes.bat" /sc daily /st 07:00 /f >nul
  echo Rotina diaria do Hermes agendada para as 07:00.
)
for /f %%i in ('git rev-parse HEAD') do set ANTES=%%i
echo Buscando atualizacoes...
rem o npm install pode mexer no package-lock.json; descarta isso para o git pull nao travar
git checkout -- package-lock.json >nul 2>&1
git pull --ff-only
if errorlevel 1 (
  echo.
  echo Nao consegui atualizar pelo GitHub. Mande um print desta janela para o Claude.
  pause
)
for /f %%i in ('git rev-parse HEAD') do set DEPOIS=%%i
set PRECISA=0
if not "%ANTES%"=="%DEPOIS%" set PRECISA=1
if not exist ".next\BUILD_ID" set PRECISA=1

set PID3000=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do set PID3000=%%p
if defined PID3000 (
  if "%PRECISA%"=="0" (
    echo O painel ja esta ligado e atualizado em http://localhost:3000
    timeout /t 8 >nul
    exit /b 0
  )
  echo Desligando o painel antigo para atualizar...
  taskkill /PID %PID3000% /T /F >nul 2>&1
  timeout /t 3 >nul
)

if "%PRECISA%"=="1" (
  echo Atualizando o painel, aguarde alguns minutos...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
  call npm run build || (pause & exit /b 1)
)
echo.
echo Painel ligado em http://localhost:3000  ^(minimize esta janela, nao feche^)
rem Desliga o "modo de selecao" desta janela: um clique nela nao congela mais o servidor.
powershell -NoProfile -Command "$s='[DllImport(\"kernel32.dll\")]public static extern IntPtr GetStdHandle(int h);[DllImport(\"kernel32.dll\")]public static extern bool GetConsoleMode(IntPtr h,out int m);[DllImport(\"kernel32.dll\")]public static extern bool SetConsoleMode(IntPtr h,int m);';$k=Add-Type -MemberDefinition $s -Name K -Namespace W -PassThru;$h=$k::GetStdHandle(-10);$m=0;[void]$k::GetConsoleMode($h,[ref]$m);[void]$k::SetConsoleMode($h,(($m -band -65) -bor 128))" >nul 2>&1
call npm run start
echo.
echo O painel parou. Se foi erro, mande um print desta janela para o Claude.
pause
