@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   ПРОВЕРКА ПРИЛОЖЕНИЯ «ПАРУС»
echo ============================================
echo.

rem --- Node.js установлен? ---
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Не найден Node.js — без него тесты не запустятся.
    echo.
    echo Скачайте и установите отсюда: https://nodejs.org
    echo Берите версию LTS, настройки менять не нужно.
    echo После установки закройте это окно и запустите файл заново.
    echo.
    pause
    exit /b 1
)

rem --- Приложение собрано? ---
if not exist "..\index.html" (
    echo Не найден index.html.
    echo Сначала запустите «ОБНОВИТЬ САЙТ.bat» в папке выше — он соберёт приложение.
    echo.
    pause
    exit /b 1
)

rem --- Библиотека для тестов на месте? ---
if not exist "node_modules\jsdom" (
    echo Первый запуск: устанавливаю библиотеку для тестов.
    echo Это займёт полминуты и делается один раз.
    echo.
    call npm install jsdom --silent
    if %errorlevel% neq 0 (
        echo.
        echo Не удалось установить. Проверьте интернет и попробуйте снова.
        pause
        exit /b 1
    )
    echo Готово.
    echo.
)

rem --- Запуск ---
node "тесты.js"
set RESULT=%errorlevel%

echo.
if %RESULT% equ 0 (
    echo Можно обновлять сайт.
) else (
    echo Что-то сломалось — смотрите список выше. Обновлять сайт пока не стоит.
)
echo.
pause
exit /b %RESULT%
