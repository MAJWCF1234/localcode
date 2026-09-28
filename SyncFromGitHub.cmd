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

set "BACKUP_ROOT=.localcode-sync-backup"

echo [1/5] Fetching latest GitHub state...
git fetch origin main
if errorlevel 1 goto :fail

echo [2/5] Backing up local tracked edits...
for /f "delims=" %%F in ('git diff --name-only') do (
  if /I not "%%F"=="SyncFromGitHub.cmd" (
    echo [BACKUP] %%F
    for %%D in ("!BACKUP_ROOT!\%%F") do if not exist "%%~dpD" mkdir "%%~dpD" >nul 2>nul
    copy /y "%%F" "!BACKUP_ROOT!\%%F" >nul
    if errorlevel 1 (
      echo [ERROR] Could not back up %%F
      goto :fail
    )
    git restore --worktree -- "%%F"
    if errorlevel 1 (
      echo [ERROR] Could not restore tracked file %%F
      goto :fail
    )
  )
)

echo [3/5] Checking untracked-file collisions...
for /f "usebackq delims=" %%F in (`git diff --name-only --diff-filter=A HEAD..origin/main`) do (
  if exist "%%F" (
    git ls-files --error-unmatch "%%F" >nul 2>nul
    if errorlevel 1 (
      echo [BACKUP] Untracked local file would be overwritten: %%F
      for %%D in ("!BACKUP_ROOT!\%%F") do if not exist "%%~dpD" mkdir "%%~dpD" >nul 2>nul
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

echo [4/5] Fast-forwarding local source from GitHub...
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

echo [5/5] Done.
echo.
echo workspace\, localcode.settings.json, node_modules\, and other ignored
echo local data were left alone.
if exist "%BACKUP_ROOT%" (
  echo.
  echo Local source edits that had to be moved were preserved under:
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
