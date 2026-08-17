@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === Build index.html from modules ===
copy /b "01-shell.html" + "02-core.js" + "03-debts.js" + "04-import.js" + "05-calendar.js" + "06-sync.js" "..\index.html.tmp" >nul
if %errorlevel% neq 0 (
    echo ERROR: could not join modules
    pause
    exit /b 1
)
(
    echo ^</script^>
    echo ^</body^>
    echo ^</html^>
) >> "..\index.html.tmp"
move /y "..\index.html.tmp" "..\index.html" >nul
for %%F in ("..\..\*.html") do copy /y "..\index.html" "%%~fF" >nul 2>&1

echo Done: index.html updated
echo.
echo To publish, run the update script one level up.
pause
