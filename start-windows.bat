@echo off
title Astute Nexa
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Astute Nexa needs Node.js 22.5 or newer.
  echo Opening the download page. Install it, then double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: getting Astute Nexa ready. This takes a minute.
  call npm install --omit=dev
)
node bin\nexa.js
pause
