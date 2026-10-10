@echo off
rem Liga o painel no Docker e abre no navegador. Ele continua ligado ate rodar parar-painel.bat.
cd /d "%~dp0"
if not exist .env.local (
  echo Falta o arquivo .env.local com as chaves do Supabase. Veja o README.
  pause
  exit /b 1
)
docker info >nul 2>&1 || (
  echo O Docker Desktop nao esta aberto. Abra o Docker Desktop e rode de novo.
  pause
  exit /b 1
)
git pull --ff-only
docker compose --env-file .env.local up -d --build || (pause & exit /b 1)
echo.
echo Painel ligado em http://localhost:3000
start "" http://localhost:3000
timeout /t 5 >nul
