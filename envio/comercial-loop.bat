@echo off
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if not exist "%~dp0logs" mkdir "%~dp0logs"
py comercial-loop.py >> "%~dp0logs\comercial.log" 2>&1
