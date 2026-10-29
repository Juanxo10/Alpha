@echo off
rem Genera dist\Geovisor\Geovisor.exe  (uso: CONSTRUIR_EXE.bat merced)
rem Requiere: pip install -r backend\requirements.txt  y  npm install en frontend\
cd /d "%~dp0"
if "%~1"=="" (echo Indique el cliente, ej: CONSTRUIR_EXE.bat merced & exit /b 1)
tasklist /fi "imagename eq Geovisor.exe" | find /i "Geovisor.exe" >nul && (echo Cierre Geovisor.exe antes de construir: tiene la base abierta. & exit /b 1)
python preparar_marca.py "..\GEOVISOR_APP_INDEPENDIENTE\clientes\%~1" || exit /b 1
pushd frontend & call npm run build || exit /b 1 & popd
python -m PyInstaller --noconfirm --windowed --name Geovisor --icon icono.ico --paths backend --collect-submodules uvicorn ^
  --add-data "frontend\dist;web" escritorio.py || exit /b 1
rem Los datos del cliente quedan fuera del exe: la base contable debe poder guardarse y respaldarse.
xcopy /e /i /y "..\GEOVISOR_APP_INDEPENDIENTE\clientes\%~1" "dist\Geovisor\clientes\%~1" >nul
rem La base contable vive en Supabase: cada cliente necesita su datos\supabase.json (host, port, dbname, user, password).
rd /s /q build 2>nul
del /q Geovisor.spec 2>nul
echo Listo: dist\Geovisor\Geovisor.exe
