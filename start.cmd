@echo off
setlocal
cd /d "%~dp0"
title ASMS - Ark Server Management Suite

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed or not on your PATH.
  echo   Grab the LTS build from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies, this only happens once...
  call npm install || goto :failed
)

call node scripts\build-if-stale.mjs || goto :failed

echo.
echo   Starting ASMS. Leave this window open - closing it stops ASMS,
echo   though your ARK servers keep running.
echo.
node apps\server\dist\index.js
goto :eof

:failed
echo.
echo   Something went wrong during setup. The output above says what.
echo.
pause
exit /b 1
