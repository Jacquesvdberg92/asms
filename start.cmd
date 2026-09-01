@echo off
setlocal
cd /d "%~dp0"
title ASMS - Ark Server Management Suite

if not exist "package.json" goto :notunpacked

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

:notunpacked
echo.
echo   ASMS cannot start from this folder - package.json is not next to
echo   start.cmd, so the rest of ASMS is not here either.
echo.
echo   Ran from:
echo     %~dp0
echo.
echo   This almost always means start.cmd was double-clicked from inside the
echo   downloaded zip. Windows lets you browse a zip like a folder, but running
echo   a file from there copies out only that one file, to a temporary folder,
echo   and leaves everything else behind.
echo.
echo   Close this window. Right-click the zip in File Explorer, choose
echo   "Extract All...", pick somewhere permanent such as C:\ASMS, and run
echo   start.cmd from the extracted folder.
echo.
pause
exit /b 1

:failed
echo.
echo   Something went wrong during setup. The output above says what.
echo.
pause
exit /b 1
