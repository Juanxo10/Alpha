@echo off
rem ==========================================================================
rem  Arrastre la ortofoto (.tif / .ecw / .jp2) sobre este archivo.
rem  La corta en teselas para el geovisor (puede tardar varios minutos).
rem ==========================================================================
title Agregar ortofoto al geovisor
cd /d "%~dp0"
if "%~1"=="" (
  echo Arrastre el archivo de la ortofoto sobre AGREGAR_ORTOFOTO.bat
  pause
  exit /b 1
)
set "QG=C:\Program Files\QGIS 3.40.2"
set "PATH=%QG%\bin;%QG%\apps\gdal\bin;%PATH%"
set "PYTHONHOME=%QG%\apps\Python312"
"%QG%\apps\Python312\python.exe" scripts\02_agregar_ortofoto.py "%~1"
pause
