@echo off
rem Rotina diaria do Hermes: pesquisa leads e cadastra no CRM. Nao manda mensagem para ninguem.
rem Agendada no Agendador de Tarefas do Windows ("MKTech Prospeccao", todo dia 07:00).
rem O CRM decide meta, cidades e nichos (Configuracoes no painel). Se a rotina estiver pausada la, nada roda.
chcp 65001 >nul
cd /d "C:\Users\pmarc\mktech-prospeccao"
if not exist logs-rotina mkdir logs-rotina
echo. >> logs-rotina\rotina.log
echo ===== %date% %time% ===== >> logs-rotina\rotina.log
hermes -z "Use a skill mktech-prospeccao para a rotina diaria de prospeccao (start-run normal, sem --manual), respeitando a meta, as cidades, os nichos e os limites configurados no CRM. Faca a pesquisa completa com diagnostico de cada lead. Nunca envie mensagens nem contate ninguem." >> logs-rotina\rotina.log 2>&1
echo (fim, codigo %errorlevel%) >> logs-rotina\rotina.log
