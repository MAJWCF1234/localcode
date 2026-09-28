@echo off
setlocal EnableExtensions EnableDelayedExpansion

if /I "%~1"=="--handoff" goto :handoff

cd /d "%~dp0"
set "RESUME=0"
if /I "%~1"=="--resume" set "RESUME=1"

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

if "%RESUME%"=="0" (
  git diff --quiet -- SyncFromGitHub.cmd
  if errorlevel 1 (
    echo [SELF-UPDATE] Local SyncFromGitHub.cmd differs from GitHub-tracked state.
    echo [SELF-UPDATE] Handing off to a temporary updater...
    set "HELPER=%TEMP%\LocalCodeSync-%RANDOM%%RANDOM%.cmd"
    copy /y "%~f0" "!HELPER!" >nul
    if errorlevel 1 goto :fail
    start "" /wait cmd /c ""!HELPER!" --handoff "%CD%""
    exit /b %errorlevel%
  )
)

echo [2/5] Backing up local tracked edits...
for /f "delims=" %%F in ('git diff --name-only') do (
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

echo [3/5] Checking untracked-file collisions...
for /f "usebackq delims=" %%F in (`git diff --name-only --diff-filter=A HEAD..origin/main`) do (
  if exist "%%F" (
    git ls-files --error-unmatch "%%F" >nul 2>nul
    if errorlevel 1 (
      echo [BACKUP] Untracked local file would be overwritten: %%F
      for %%D in ("!BACKUP_ROOT!\%%F") do if not exist "%%~dpD" mkdir "%%~dpD" >nul 2>nul
      copy /y "%%F" "!BACKUP_ROOT!\%%F" >nul
      if errorlevel 1 goto :fail
      del /q "%%F"
      if errorlevel 1 goto :fail
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

:handoff
set "TARGET=%~2"
if not defined TARGET exit /b 1
timeout /t 1 /nobreak >nul
cd /d "%TARGET%" || exit /b 1
if not exist ".localcode-sync-backup" mkdir ".localcode-sync-backup" >nul 2>nul
if exist "SyncFromGitHub.cmd" copy /y "SyncFromGitHub.cmd" ".localcode-sync-backup\SyncFromGitHub.cmd.local-before-self-update" >nul
git restore --worktree -- SyncFromGitHub.cmd
if errorlevel 1 exit /b 1
call ".\SyncFromGitHub.cmd" --resume
set "RC=%errorlevel%"
del /q "%~f0" >nul 2>nul
exit /b %RC%

:fail
echo.
echo [ERROR] Sync failed. Nothing was force-reset.
pause
exit /b 1
