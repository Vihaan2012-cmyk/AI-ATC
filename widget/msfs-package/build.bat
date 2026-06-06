@echo off
REM Build the AI ATC toolbar panel package with the MSFS 2024 SDK.
REM Output goes to .\Packages\msfs-ai-atc-panel\ — copy that into your Community folder.
set "SDK=C:\MSFS 2024 SDK"
if not exist "%SDK%\Tools\bin\fspackagetool.exe" (
  echo Could not find fspackagetool at "%SDK%\Tools\bin\fspackagetool.exe"
  echo Edit SDK path in this file if your SDK is elsewhere.
  pause
  exit /b 1
)
"%SDK%\Tools\bin\fspackagetool.exe" "%~dp0ai-atc-panel.xml"
echo.
echo Done. Look under "%~dp0Packages\" for the built package.
pause
