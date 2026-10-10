@echo off
rem Instala as dependencias da ponte do WhatsApp Web (so na primeira vez).
cd /d "%~dp0whatsapp-web"
call npm install
pause
