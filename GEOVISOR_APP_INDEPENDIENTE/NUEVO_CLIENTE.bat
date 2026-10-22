@echo off
rem ==========================================================================
rem  Crea un cliente nuevo (empresa) a partir de su GeoPackage, su ortofoto y su logo.
rem  Ejemplo:
rem    NUEVO_CLIENTE.bat --id sauces --empresa "Inversiones Los Sauces" --proyecto "Los Sauces" --ciudad "Acacias, Meta" --gpkg "D:\sauces\LOTEO.gpkg" --ortofoto "D:\sauces\orto.tif" --logo "D:\sauces\logo.png"
rem  Al final imprime el CODIGO DE INSTALACION que se le entrega solo al dueno de la empresa.
rem ==========================================================================
cd /d "%~dp0"
set "QG=C:\Program Files\QGIS 3.40.2"
set "PATH=%QG%\bin;%QG%\apps\gdal\bin;%QG%\apps\qgis-ltr\bin;%PATH%"
set "PYTHONHOME=%QG%\apps\Python312"
set "PROJ_DATA=%QG%\share\proj"
"%QG%\apps\Python312\python.exe" herramientas\nuevo_cliente.py %*
pause
