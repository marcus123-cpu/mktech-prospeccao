@echo off
rem Mantem o enviador rodando, sem janela. Com a chave desligada no painel ele nao envia nada.
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if not exist "%~dp0logs" mkdir "%~dp0logs"
ping -n 31 127.0.0.1 >nul
:loop
py mktech_envio.py rodar --transporte whatsappweb >> "%~dp0logs\enviador.log" 2>&1
ping -n 16 127.0.0.1 >nul
goto loop
