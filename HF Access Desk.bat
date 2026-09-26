@echo off
setlocal
title HF Access Desk Launcher
cd /d "%~dp0"

if not exist "node_modules\.bin\electron.cmd" (
  echo HF Access Desk needs to be installed first.
  echo Run the npm install command in this folder, then try again.
  echo.
pause
exit /b 1
)

start "HF Access Desk" "node_modules\.bin\electron.cmd" .
endlocal
