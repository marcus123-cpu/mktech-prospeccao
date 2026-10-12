@echo off
rem Pedido de busca: a cada 2 minutos pergunta ao CRM se o Marcos pediu, na aba
rem Pesquisas do Hermes, mais leads qualificados. Se sim, chama o Hermes, que abre
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
  hermes -z "Use a skill mktech-prospeccao no modo pedido do painel: abra a execucao com start-run --routine pedido-painel e siga o procedimento ate bater a meta de qualificados do pedido, sem passar do limite de buscas. Nao contate ninguem." >> "%~dp0logs\pedido.log" 2>&1
)
ping -n 121 127.0.0.1 >nul
goto loop
