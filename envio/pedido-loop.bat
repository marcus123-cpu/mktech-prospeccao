@echo off
rem Pedido de busca: a cada 2 minutos pergunta ao CRM se o Marcos pediu, na aba
rem Pesquisas, mais leads qualificados. Se sim, chama o Codex, que abre
rem a execucao "pedido-painel" (o CRM entrega a meta e o limite de buscas) e busca
rem ate bater a meta. Buscar lead nao envia nada a ninguem.
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set "CRM=%LOCALAPPDATA%\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py"
if not exist "%~dp0logs" mkdir "%~dp0logs"
:loop
py "%CRM%" pedido-pendente 2>nul | findstr /c:"\"pedido_id\"" >nul
if not errorlevel 1 (
  echo ===== %date% %time% ===== >> "%~dp0logs\pedido.log"
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\rodar-pesquisa-codex.ps1" -Modo pedido >> "%~dp0logs\pedido.log" 2>&1
)
ping -n 121 127.0.0.1 >nul
goto loop
