@echo off
rem ==========================================================================
rem  Geovisor de ventas y cartera del loteo  -  doble clic para abrir.
rem  Inicia el servidor local (solo este equipo) y abre el navegador.
rem  Deje abierta la ventana negra mientras usa el geovisor.
rem ==========================================================================
title Geovisor de ventas y cartera
cd /d "%~dp0"
set "PY=C:\Program Files\QGIS 3.40.2\apps\Python312\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" servir.py
if errorlevel 1 pause
