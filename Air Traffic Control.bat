@echo off
title Air Traffic Control - launcher
cd /d "%~dp0"
echo ============================================
echo   Air Traffic Control
echo ============================================
echo Starting the brain (SimConnect + AI) ...
start "ATC Brain" /min cmd /k "npm run server"
echo Waiting for it to come up ...
timeout /t 5 /nobreak >nul
echo Launching the widget ...
cd /d "%~dp0app"
set "ELECTRON_RUN_AS_NODE="
call npm start
echo.
echo Widget closed. You can close the minimized "ATC Brain" window too.
pause
