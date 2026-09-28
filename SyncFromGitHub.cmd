@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo   LOCALCODE - SYNC FROM GITHUB
echo ============================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git is not installed or not in PATH.
  pause
  exit /b 1
)

if not exist ".git" (
  echo [ERROR] This folder is not a Git repository.
  echo Clone or publish LocalCode first.
  pause
  exit /b 1
)

for /f "delims=" %%I in ('git status --porcelain --untracked-files=no') do (
  echo [STOPPED] Tracked local changes exist.
  echo Commit or discard them before syncing so nothing is overwritten.
  echo.
  git status --short
  pause
  exit /b 1
)

echo [1/3] Fetching origin...
git fetch origin main
if errorlevel 1 goto :fail

echo [2/3] Fast-forwarding main...
git checkout main
if errorlevel 1 goto :fail

git merge --ff-only origin/main
if errorlevel 1 (
  echo.
  echo [STOPPED] Local main cannot be fast-forwarded safely.
  echo No reset or force operation was used.
  pause
  exit /b 1
)

echo [3/3] Done.
echo.
echo workspace, localcode.settings.json, node_modules, and other ignored
echo local data were left alone.
echo.
git status --short
pause
exit /b 0

:fail
echo.
echo [ERROR] Sync failed. Nothing was force-reset.
pause
exit /b 1
