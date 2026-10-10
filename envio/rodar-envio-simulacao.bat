@echo off
rem Enviador do envio automatico (modo simulacao: nao manda nada a ninguem).
cd /d "%~dp0"
py mktech_envio.py rodar --transporte simulacao
pause
