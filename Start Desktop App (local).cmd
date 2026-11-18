@echo off
rem Opens the InterviewWin desktop app against your LOCAL website (http://127.0.0.1:3001).
rem Start the local website first with "Start InterviewWin.cmd".
rem Once the website is deployed, open InterviewWin normally from the Start menu instead.
cd /d "%~dp0"
set "IW_APP_URL=http://127.0.0.1:3001"
set "ELECTRON_RUN_AS_NODE="
taskkill /im InterviewWin.exe /f >nul 2>&1
if exist "%ProgramFiles%\InterviewWin\InterviewWin.exe" (
  start "" "%ProgramFiles%\InterviewWin\InterviewWin.exe"
) else (
  start "" "%~dp0desktop\dist\win-unpacked\InterviewWin.exe"
)
