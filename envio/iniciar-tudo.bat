@echo off
rem Sobe a ponte e o enviador em segundo plano (chamado pelo Windows ao ligar o PC).
cd /d "%~dp0"
start "" /b cmd /c "%~dp0ponte-loop.bat"
call "%~dp0enviador-loop.bat"
