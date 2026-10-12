@echo off
rem Secretario: a cada 2 minutos pergunta ao CRM se alguma cliente escreveu e,
rem se sim, chama o Hermes para responder (skill mktech-prospeccao, modo secretario).
rem Com o secretario desligado no painel o CRM nao devolve nada e o Hermes nem abre.
rem O Hermes so grava a resposta no CRM; quem envia e o enviador, no horario de atendimento.
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set "CRM=%LOCALAPPDATA%\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py"
if not exist "%~dp0logs" mkdir "%~dp0logs"
:loop
py "%CRM%" secretario-pendentes --count 1 2>nul | findstr /c:"\"lead_id\"" >nul
if not errorlevel 1 (
  echo ===== %date% %time% ===== >> "%~dp0logs\secretario.log"
  hermes -z "Use a skill mktech-prospeccao no modo secretario: responda as conversas pendentes (secretario-pendentes e secretario-salvar), seguindo o metodo e as regras de passar para o Marcos. Nao contate ninguem por outro meio." >> "%~dp0logs\secretario.log" 2>&1
)
ping -n 121 127.0.0.1 >nul
goto loop
