@echo off
rem Prepara mensagens dos leads aptos e escreve as do estilo "lendo a resposta". O CRM valida e o enviador respeita a chave e os horarios.
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set "CRM=%LOCALAPPDATA%\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py"
if not exist "%~dp0logs" mkdir "%~dp0logs"
:loop
py "%CRM%" envio-pendentes --count 1 2>nul | findstr /c:"\"lead_id\"" /c:"\"business_name\"" >nul
if not errorlevel 1 (
  echo ===== %date% %time% ===== >> "%~dp0logs\preparador.log"
  hermes -z "Use a skill mktech-prospeccao no modo envio automatico. Leia references/metodo-abordagem.md e prepare um lote de ate 5 leads de envio-pendentes. Grave cada mensagem com envio-salvar seguindo as evidencias, o diagnostico e todas as regras de validacao. Nao pesquise novos leads. Nao contate ninguem por outro meio. Ao terminar o lote, encerre." >> "%~dp0logs\preparador.log" 2>&1
)
rem Estilo "lendo a resposta": a pessoa respondeu a saudacao e o texto ainda nao foi escrito.
py "%CRM%" envio-leitura-pendentes --count 1 2>nul | findstr /c:"\"message_id\"" >nul
if not errorlevel 1 (
  echo ===== %date% %time% leitura ===== >> "%~dp0logs\preparador.log"
  hermes -z "Use a skill mktech-prospeccao no modo leitura da resposta. Leia references/metodo-abordagem.md, pegue envio-leitura-pendentes e, para cada mensagem, leia o que a pessoa respondeu e grave o texto com envio-leitura-salvar seguindo o diagnostico e todas as regras de validacao. Nao pesquise novos leads. Nao contate ninguem por outro meio. Ao terminar, encerre." >> "%~dp0logs\preparador.log" 2>&1
)
ping -n 121 127.0.0.1 >nul
goto loop
