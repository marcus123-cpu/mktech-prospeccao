@echo off
rem Rotina diaria do Codex: pesquisa leads e cadastra no CRM. Nao manda mensagem.
rem Agendada no Agendador de Tarefas do Windows ("MKTech Prospeccao", todo dia 07:00).
rem O CRM decide meta, cidades e nichos (Configuracoes no painel). Se a rotina estiver pausada la, nada roda.
chcp 65001 >nul
cd /d "C:\Users\pmarc\mktech-prospeccao"
if not exist logs-rotina mkdir logs-rotina
echo. >> logs-rotina\rotina.log
echo ===== %date% %time% ===== >> logs-rotina\rotina.log
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\rodar-pesquisa-codex.ps1" -Modo diaria >> logs-rotina\rotina.log 2>&1
echo (fim, codigo %errorlevel%) >> logs-rotina\rotina.log
