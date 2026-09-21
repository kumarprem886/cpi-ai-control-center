@echo off
setlocal
title CPI AI Control Center - Launcher
cd /d "%~dp0"

echo ==========================================
echo   SAP CPI AI Control Center
echo ==========================================
echo.

if not exist "BackEnd\node_modules" (
    echo Installing backend dependencies, this takes a minute...
    pushd BackEnd
    call npm install
    popd
)

if not exist "FrontEnd\node_modules" (
    echo Installing frontend dependencies, this takes a minute...
    pushd FrontEnd
    call npm install
    popd
)

if not exist "BackEnd\.env" (
    echo WARNING: BackEnd\.env is missing.
    echo Copy BackEnd\.env.example to BackEnd\.env and fill in your
    echo CPI credentials, or the app will start but cannot reach CPI.
    echo.
)

echo Starting backend on port 8082...
start "CPI Backend" /min /d "%~dp0BackEnd" cmd /c node server.js

echo Starting frontend on port 5175...
start "CPI Frontend" /min /d "%~dp0FrontEnd" cmd /c npm run dev

echo.
echo Waiting for the app to come up...

rem Vite binds 127.0.0.1 only; polling "localhost" resolves to ::1 first and
rem always fails. A single PowerShell call also avoids depending on
rem timeout.exe resolving to the Windows one rather than a shell built-in.
powershell -NoProfile -Command "$end=(Get-Date).AddSeconds(90); while((Get-Date) -lt $end){ try{ Invoke-WebRequest -Uri http://127.0.0.1:5175 -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 }catch{ Start-Sleep -Seconds 2 } }; exit 1"
if errorlevel 1 goto timedout

echo.
echo Ready. Opening browser...
start "" http://localhost:5175
echo.
echo The app is running in two minimised windows named
echo "CPI Backend" and "CPI Frontend".
echo Run STOP-APP.bat to shut both down.
echo.
pause
exit /b 0

:timedout
echo.
echo The app did not respond after 90 seconds.
echo Check the minimised "CPI Backend" and "CPI Frontend" windows
echo for an error message - the usual cause is a port already in use.
echo.
pause
exit /b 1
