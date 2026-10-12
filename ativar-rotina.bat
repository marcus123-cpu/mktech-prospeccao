@echo off
rem Cria (ou recria) a tarefa diaria das 07:00 que roda a pesquisa do Hermes
rem e remove a tarefa antiga de mensagens (aba Abordagem, desativada).
title Ativar rotina diaria do Hermes
schtasks /create /tn "MKTech Prospeccao" /tr "C:\Users\pmarc\mktech-prospeccao\rotina-hermes.bat" /sc daily /st 07:00 /f
schtasks /delete /tn "MKTech Abordagem" /f >nul 2>&1
echo.
schtasks /query /tn "MKTech Prospeccao"
echo.
echo Se apareceu "MKTech Prospeccao" com 07:00 acima, esta pronto. Pode fechar.
pause
