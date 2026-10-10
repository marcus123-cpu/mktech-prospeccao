@echo off
rem Passo unico: faz a ponte e o enviador ligarem sozinhos com o Windows, sem janelas.
cd /d "%~dp0"
call "%~dp0parar-tudo.bat" silent
set "ST=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
echo Set sh = CreateObject("WScript.Shell") > "%ST%\mktech-envio.vbs"
echo sh.Run """%~dp0iniciar-tudo.bat""", 0, False >> "%ST%\mktech-envio.vbs"
wscript "%ST%\mktech-envio.vbs"
echo.
echo Pronto. A ponte e o enviador ja estao rodando em segundo plano e vao ligar sozinhos sempre que o PC ligar.
echo Nao e preciso abrir mais nada. Registro em: %~dp0logs
pause
