@echo off
setlocal EnableExtensions
cd /d "%~dp0"
where npm >nul 2>nul || (
  echo [ERROR] Node.js/npm is required.
  pause
  exit /b 1
)
if not exist node_modules (
  echo [*] Installing dependencies...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
call npm run dev
