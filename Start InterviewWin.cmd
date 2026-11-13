@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\stop-local.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-local.ps1"
if %errorlevel%==0 start "" http://localhost:3001
echo.
pause
