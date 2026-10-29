; Uso: CONSTRUIR_EXE.bat merced  y luego compilar este archivo con Inno Setup (genera Instalador\Geovisor_Setup.exe)
[Setup]
AppName=Geovisor
AppVersion=1.1
AppPublisher=Geovisor
; Con PrivilegesRequired=lowest {autopf} es la carpeta del usuario: la app puede escribir sus datos sin pedir administrador.
PrivilegesRequired=lowest
DefaultDirName={autopf}\Geovisor
DisableDirPage=no
UsePreviousAppDir=no
DefaultGroupName=Geovisor
SetupIconFile=icono.ico
UninstallDisplayIcon={app}\Geovisor.exe
OutputDir=Instalador
OutputBaseFilename=Geovisor_Setup
Compression=lzma2
SolidCompression=yes

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "icono"; Description: "Crear acceso directo en el escritorio"

[Files]
Source: "dist\Geovisor\*"; DestDir: "{app}"; Excludes: "clientes\*\datos\*"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "dist\Geovisor\clientes\merced\datos\*"; DestDir: "{app}\clientes\merced\datos"; Flags: recursesubdirs createallsubdirs onlyifdoesntexist

[Icons]
Name: "{group}\Geovisor"; Filename: "{app}\Geovisor.exe"
Name: "{autodesktop}\Geovisor"; Filename: "{app}\Geovisor.exe"; Tasks: icono

[Run]
Filename: "{app}\Geovisor.exe"; Description: "Abrir Geovisor"; Flags: nowait postinstall skipifsilent


