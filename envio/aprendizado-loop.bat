@echo off
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if not exist "%~dp0logs" mkdir "%~dp0logs"
py aprendizado-loop.py >> "%~dp0logs\aprendizado.log" 2>&1
