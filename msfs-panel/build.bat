@echo off
REM Build the AI ATC in-game panel into an .spb that MSFS 2020 can load, then refresh layout.json.
REM Requires the MSFS SDK installed (sets the MSFS_SDK environment variable).
REM Run this from the msfs-panel folder:  build.bat

if "%MSFS_SDK%"=="" (
  echo ERROR: MSFS_SDK is not set. Install the MSFS SDK first ^(it sets MSFS_SDK^).
  echo Typical path: C:\MSFS SDK
  pause
  exit /b 1
)

REM 1) Regenerate the panel HTML from the desktop widget (keeps the panel in sync).
where node >nul 2>nul && node build-panel.mjs

REM 2) Compile the .spb (this is what registers the toolbar button).
"%MSFS_SDK%\Tools\bin\fspackagetool.exe" "Build\atc-panel.xml" -nomirroring

REM 3) Copy the built .spb into the package's InGamePanels folder.
copy /Y "Build\Packages\ai-atc-ingamepanel\Build\InGamePanel_ATCPanel.spb" "InGamePanels\"

echo.
echo Done. Now copy this entire msfs-panel folder into your MSFS Community folder,
echo make sure the AI ATC desktop app is running, and launch MSFS.
pause
