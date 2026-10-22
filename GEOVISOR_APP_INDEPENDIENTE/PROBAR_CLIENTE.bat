@echo off
rem ==========================================================================
rem  Abre en ESTE equipo el geovisor de un cliente, para revisarlo antes de subirlo al servidor.
rem  Uso: PROBAR_CLIENTE.bat merced      (el nombre es la carpeta dentro de clientes\)
rem ==========================================================================
cd /d "%~dp0"
if "%~1"=="" (
  echo Escriba el cliente. Ejemplo:  PROBAR_CLIENTE.bat merced
  dir /b clientes
  pause
  exit /b 1
)
title Geovisor de prueba - %~1
set "PY=C:\Program Files\QGIS 3.40.2\apps\Python312\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" app\servir.py --cliente "clientes\%~1"
if errorlevel 1 pause
