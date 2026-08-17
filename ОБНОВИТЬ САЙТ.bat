@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === Step 1: Build index.html from source modules ===
set "SRC="
for /d %%D in ("%~dp0*") do if exist "%%~fD\01-shell.html" set "SRC=%%~fD"
if not defined SRC (
    echo ERROR: sources folder not found ^(01-shell.html^)
    pause
    exit /b 1
)
copy /b "%SRC%\01-shell.html" + "%SRC%\02-core.js" + "%SRC%\03-debts.js" + "%SRC%\04-import.js" + "%SRC%\05-calendar.js" + "%SRC%\06-sync.js" "index.html.tmp" >nul
if %errorlevel% neq 0 (
    echo ERROR at build - modules not found
    pause
    exit /b 1
)
(
    echo ^</script^>
    echo ^</body^>
    echo ^</html^>
) >> "index.html.tmp"
move /y "index.html.tmp" "index.html" >nul
for %%F in ("..\*.html") do copy /y "index.html" "%%~fF" >nul 2>&1
echo Done

echo.
echo === Step 2: Remove git lock files ===
if exist ".git\index.lock" (
    del /f ".git\index.lock"
    echo Done: index.lock removed
) else (
    echo OK: no index.lock found
)
if exist ".git\HEAD.lock" (
    del /f ".git\HEAD.lock"
    echo Done: HEAD.lock removed
) else (
    echo OK: no HEAD.lock found
)

echo.
echo === Step 3: Stage all changes ===
git add -A
echo Done
git status --short

echo.
echo === Step 4: Commit ===
git commit -m "Update site"
if %errorlevel% neq 0 ( echo Nothing new to commit, pushing existing commits... )

echo.
echo === Step 5: Push to GitHub ===
git push origin HEAD:main
if %errorlevel% neq 0 (
    echo ERROR at push - check internet/GitHub credentials
    pause
    exit /b 1
)

echo.
echo === DONE! Wait 1 min then press Ctrl+F5 on the site ===
echo https://rutasha2809-creator.github.io/Parus-2/
pause
