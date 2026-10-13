@echo off
chcp 65001 >nul
title MKTech - criar rodada das 13h do Hermes
echo.
echo  Vai criar a rodada das 13h (segunda a sexta) da prospeccao do Hermes.
echo  Ela repoe o estoque de leads depois da janela de envio.
echo  NAO envia mensagem para ninguem.
echo.
where hermes >nul 2>nul
if errorlevel 1 (
  echo  ERRO: o comando "hermes" nao foi encontrado neste computador.
  echo  Abra o terminal onde o Hermes funciona e rode este arquivo la.
  echo.
  pause
  exit /b 1
)
echo  Agendamentos atuais:
hermes cron list
echo.
hermes cron list | findstr /C:"mktech-prospeccao-tarde" >nul 2>nul
if not errorlevel 1 (
  echo  A rodada "mktech-prospeccao-tarde" ja existe. Nada foi criado.
  echo.
  pause
  exit /b 0
)
echo  Criando "mktech-prospeccao-tarde"...
hermes cron create "0 13 * * 1-5" "Use a skill mktech-prospeccao para a prospecção diária. Não envie mensagens a ninguém." --skill mktech-prospeccao --name mktech-prospeccao-tarde --deliver local
if errorlevel 1 (
  echo.
  echo  ERRO ao criar. Mande uma foto desta tela para o Claude.
  pause
  exit /b 1
)
echo.
echo  Agendamentos agora:
hermes cron list
echo.
echo  Pronto. Lembre: o agendador do Hermes so roda com o gateway ligado (hermes gateway).
echo  Para pausar: hermes cron pause mktech-prospeccao-tarde
echo.
pause
