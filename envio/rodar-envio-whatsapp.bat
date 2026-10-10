@echo off
rem Enviador em modo real (WhatsApp Web). Use com a ponte aberta e ENVIO_SO_PARA no .env durante o teste.
cd /d "%~dp0"
py mktech_envio.py rodar --transporte whatsappweb
pause
