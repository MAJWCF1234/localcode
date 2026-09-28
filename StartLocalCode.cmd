@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title LocalCode Launcher

echo ============================================================
echo   LOCALCODE - START
echo ============================================================
echo.
echo Root      : %CD%
echo Workspace : %CD%\workspace
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install Node.js 20 or newer, then run this again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not available.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json is missing from this folder.
  pause
  exit /b 1
)

if not exist "workspace" mkdir "workspace"

if not exist "node_modules\electron\package.json" (
  echo [1/3] Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
) else (
  echo [1/3] Dependencies already installed.
)

echo [2/3] Building LocalCode...
call npm run build
if errorlevel 1 goto :fail

if not exist "dist\index.html" (
  echo [ERROR] Build completed without creating dist\index.html.
  goto :fail
)

echo [3/3] Launching desktop app...
echo.
call npm start
if errorlevel 1 goto :fail

exit /b 0

:fail
echo.
echo ============================================================
echo   LOCALCODE FAILED TO START
echo ============================================================
echo.
echo The error above is the important part.
echo Copy it here and I can fix the exact failure.
echo.
pause
exit /b 1
