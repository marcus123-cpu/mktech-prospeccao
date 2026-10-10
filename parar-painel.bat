@echo off
rem Desliga o painel do Docker.
cd /d "%~dp0"
docker compose --env-file .env.local down
echo Painel desligado.
timeout /t 3 >nul
