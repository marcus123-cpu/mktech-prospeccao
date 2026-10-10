@echo off
rem Cria o arquivo .env a partir do modelo e abre no Bloco de Notas para colar o token.
cd /d "%~dp0"
if not exist ".env" copy "env-exemplo.txt" ".env" >nul
echo Cole o token em MKTECH_ENVIO_TOKEN (crie em Envio automatico no painel), salve e feche o Bloco de Notas.
notepad ".env"
