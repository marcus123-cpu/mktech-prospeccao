@echo off
rem Sobe a ponte, o secretario, o pedido de busca e o enviador em segundo plano (chamado pelo Windows ao ligar o PC).
cd /d "%~dp0"
start "" /b cmd /c "%~dp0ponte-loop.bat"
start "" /b cmd /c "%~dp0secretario-loop.bat"
start "" /b cmd /c "%~dp0pedido-loop.bat"
call "%~dp0enviador-loop.bat"
