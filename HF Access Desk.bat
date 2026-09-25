@echo off
setlocal
title HF Access Desk Launcher
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js or add node.exe to PATH.
  pause
  exit /b 1
)

curl.exe --silent --fail --max-time 2 "http://127.0.0.1:7860/api/health" >nul 2>nul
if errorlevel 1 (
  powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath 'node.exe' -ArgumentList 'server.mjs' -WorkingDirectory '%~dp0'"
)

for /l %%I in (1,1,30) do (
  curl.exe --silent --fail --max-time 2 "http://127.0.0.1:7860/api/health" >nul 2>nul
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo HF Access Desk did not start within 30 seconds.
echo Check that port 7860 is available, then try again.
pause
exit /b 1

:ready
start "" "http://127.0.0.1:7860/"
endlocal
