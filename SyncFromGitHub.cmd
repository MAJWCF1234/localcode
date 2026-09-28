@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo   LOCALCODE - SYNC FROM GITHUB
echo ============================================================
echo.
echo Repository : MAJWCF1234/localcode
echo Branch     : main
echo Workspace  : %CD%\workspace  (preserved)
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

echo [1/4] Fetching latest GitHub state...
git fetch origin main
if errorlevel 1 goto :fail

echo [2/4] Checking for untracked-file collisions...
set "BACKUP_ROOT=.localcode-sync-backup"

for /f "usebackq delims=" %%F in (`git diff --name-only --diff-filter=A HEAD..origin/main`) do (
  if exist "%%F" (
    git ls-files --error-unmatch "%%F" >nul 2>nul
    if errorlevel 1 (
      echo [BACKUP] Untracked local file would be overwritten: %%F
      if not exist "!BACKUP_ROOT!" mkdir "!BACKUP_ROOT!" >nul 2>nul
      for %%D in ("%%F") do if not exist "!BACKUP_ROOT!\%%~dpD" mkdir "!BACKUP_ROOT!\%%~dpD" >nul 2>nul
      copy /y "%%F" "!BACKUP_ROOT!\%%F" >nul
      if errorlevel 1 (
        echo [ERROR] Could not back up %%F
        goto :fail
      )
      del /q "%%F"
      if errorlevel 1 (
        echo [ERROR] Could not move conflicting untracked file out of the way: %%F
        goto :fail
      )
    )
  )
)

echo [3/4] Fast-forwarding local source from GitHub...
git checkout main >nul
if errorlevel 1 goto :fail

git merge --ff-only origin/main
if errorlevel 1 (
  echo.
  echo [STOPPED SAFELY] A fast-forward sync was not possible.
  echo No reset or force operation was performed.
  echo Run "git status" to inspect the repository state.
  pause
  exit /b 1
)

echo [4/4] Done.
echo.
echo workspace\, localcode.settings.json, node_modules\, and other ignored
echo local data were left alone.
if exist "%BACKUP_ROOT%" (
  echo Any conflicting untracked files were preserved under:
  echo   %CD%\%BACKUP_ROOT%
)
echo.
git status --short
pause
exit /b 0

:fail
echo.
echo [ERROR] Sync failed. Nothing was force-reset.
pause
exit /b 1
