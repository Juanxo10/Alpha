@echo off
rem Copia el backend de escritorio al servidor movil (nucleo + main.py). No toca servidor.py, Dockerfile, fly.toml ni clientes.
set RAIZ=%~dp0..
xcopy /Y /Q "%RAIZ%\backend\nucleo\*.py" "%RAIZ%\movil\servidor\backend\nucleo\"
copy /Y "%RAIZ%\backend\main.py" "%RAIZ%\movil\servidor\backend\main.py"
