@echo off
rem Busca leads novos agora (execucao manual do Hermes). Nao manda mensagem para ninguem.
rem Deixe esta janela aberta ate aparecer "Terminou". Pode minimizar.
title Hermes buscando leads novos
chcp 65001 >nul
cd /d "C:\Users\pmarc\mktech-prospeccao"
if not exist logs-rotina mkdir logs-rotina
echo Hermes pesquisando 10 leads novos. Isso pode levar bastante tempo...
echo ===== manual %date% %time% ===== >> logs-rotina\rotina.log
hermes -z "Use a skill mktech-prospeccao: faca uma execucao manual (start-run --manual) e cadastre 10 leads NOVOS bem pesquisados, com diagnostico completo, nas cidades e nichos configurados no CRM. O servidor para sozinho quando a meta do dia for atingida. Nunca envie mensagens nem contate ninguem."
echo (fim, codigo %errorlevel%) >> logs-rotina\rotina.log
echo.
echo Terminou. Os leads novos ja estao no painel. Pode fechar.
pause
