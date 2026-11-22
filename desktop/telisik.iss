; Telisik for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Telisik> /DOutputDir=<dist> /DIconFile=<build\telisik.ico> telisik.iss
; Installs to %LOCALAPPDATA%\Programs\Telisik, adds Telisik to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\Telisik, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Telisik"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\telisik.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=Telisik
AppVersion={#AppVersion}
AppVerName=Telisik {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/telisik/
AppSupportURL=https://github.com/juw12/telisik
DefaultDirName={autopf}\Telisik
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Telisik-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Telisik.exe
UninstallDisplayName=Telisik
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Telisik"; Filename: "{app}\Telisik.exe"; Comment: "Ask 23 public sources at once"
Name: "{userdesktop}\Telisik"; Filename: "{app}\Telisik.exe"; Comment: "Ask 23 public sources at once"; Tasks: desktopicon

[Run]
Filename: "{app}\Telisik.exe"; Description: "{cm:LaunchProgram,Telisik}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Telisik.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopTelisik"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Telisik window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Telisik.exe')) then
    Exec(ExpandConstant('{app}\Telisik.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
