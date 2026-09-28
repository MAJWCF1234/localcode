@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo   LOCALCODE - CREATE + PUBLISH GITHUB REPOSITORY
echo ============================================================
echo.

where git >nul 2>nul || (
  echo [ERROR] Git is not installed or not in PATH.
  exit /b 1
)

where gh >nul 2>nul || (
  echo [*] GitHub CLI not found. Installing with winget...
  winget install --id GitHub.cli -e --source winget
  if errorlevel 1 (
    echo [ERROR] GitHub CLI installation failed.
    exit /b 1
  )
  echo.
  echo [INFO] GitHub CLI was installed. Close and reopen this terminal,
  echo        then run PublishGitHub.cmd again.
  exit /b 0
)

gh auth status >nul 2>nul || (
  echo [*] GitHub CLI is not signed in yet.
  gh auth login
  if errorlevel 1 exit /b 1
)

if not exist .git (
  git init -b main
  git add .
  git commit -m "Initial LocalCode release"
  if errorlevel 1 exit /b 1
)

echo [*] Creating MAJWCF1234/localcode and pushing main...
gh repo create MAJWCF1234/localcode --public --source . --remote origin --push
if errorlevel 1 (
  echo.
  echo [ERROR] Could not create/push the repository.
  echo If the repository already exists, run:
  echo   git remote add origin https://github.com/MAJWCF1234/localcode.git
  echo   git push -u origin main
  exit /b 1
)

echo.
echo [OK] Published: https://github.com/MAJWCF1234/localcode
pause
