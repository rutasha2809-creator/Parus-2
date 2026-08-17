@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo   PARUS - first time setup: link this folder to GitHub
echo   Run this ONCE. Then use OBNOVIT SAYT (update site).
echo ============================================================
echo.

git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: git not found. Install from https://git-scm.com/download/win
    pause
    exit /b 1
)

if exist ".git" (
    echo This folder is already linked. Use the update script instead.
    pause
    exit /b 0
)

echo This folder will become the content of repository Parus-2:
echo   %CD%
echo.
echo WARNING: current repository content on GitHub will be REPLACED.
echo Old commit history will be erased - this also removes the old
echo version that contained your email in the code.
echo.
echo Type Y and press Enter to continue. Just Enter = cancel.
echo.

set "OK="
set /p OK="Your choice: "
if /i "%OK%"=="y" goto run
if /i "%OK%"=="yes" goto run
echo.
echo Cancelled, nothing changed.
pause
exit /b 0

:run
echo.
echo === Step 1: Init repository ===
git init -q
if %errorlevel% neq 0 goto fail
echo Done

echo.
echo === Step 2: Configure encoding ===
git config i18n.commitEncoding utf-8
git config i18n.logOutputEncoding utf-8
git config core.quotepath false
echo Done

echo.
echo === Step 3: Link to GitHub ===
git remote remove origin >nul 2>&1
git remote add origin https://github.com/rutasha2809-creator/Parus-2.git
if %errorlevel% neq 0 goto fail
echo Done

echo.
echo === Step 4: Stage files ===
git add -A
if %errorlevel% neq 0 goto fail
echo Done

echo.
echo === Step 5: First commit ===
git commit -q -m "Parus: app, sources and docs"
if %errorlevel% neq 0 goto fail
echo Done

echo.
echo === Step 6: Push to GitHub ===
echo A GitHub login window may appear - this is normal.
git branch -M main
git push -u origin main --force
if %errorlevel% neq 0 goto fail

echo.
echo ============================================================
echo   DONE! Folder is linked to the repository.
echo   Site updates in about a minute:
echo   https://rutasha2809-creator.github.io/Parus-2/
echo.
echo   From now on use the update script.
echo ============================================================
pause
exit /b 0

:fail
echo.
echo ERROR at one of the steps - see the message above.
echo Common causes:
echo   - not logged in to GitHub (a browser window should open)
echo   - no internet connection
pause
exit /b 1
