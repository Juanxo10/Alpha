@echo off
rem Arranca la plataforma con los clientes de ..\movil\servidor\clientes (Merced, base en Supabase). Abrir http://localhost:8090
cd /d "%~dp0"
set CLIENTES_DIR=..\movil\servidor\clientes
set PORT=8090
python servidor.py
pause
