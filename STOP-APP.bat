@echo off
setlocal enabledelayedexpansion
title CPI AI Control Center - Stop
echo Stopping SAP CPI AI Control Center...
echo.

set found=0

rem netstat prints the state AFTER the addresses, so filter on the port
rem first and the state second. Token 5 is the owning PID.
for %%P in (8082 5175) do (
    for /f "tokens=5" %%I in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
        echo Stopping port %%P ^(PID %%I^)
        taskkill /PID %%I /F >nul 2>&1
        set found=1
    )
)

taskkill /FI "WINDOWTITLE eq CPI Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq CPI Frontend*" /F >nul 2>&1

echo.
if "!found!"=="0" (
    echo Nothing was listening on 8082 or 5175 - already stopped.
) else (
    echo Stopped.
)
echo.
pause
