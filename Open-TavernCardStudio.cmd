@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title TavernCardStudio

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 24 (or a version satisfying package.json), then double-click this file again.
  echo        Download: https://nodejs.org/
  pause
  exit /b 1
)

rem tools/setup.mjs checks Node, pnpm, and missing or outdated dependencies.
node "%~dp0tools\setup.mjs" --ensure
if errorlevel 1 (
  echo.
  echo [ERROR] Environment preparation incomplete; startup stopped. Follow the guidance above, then double-click this file again.
  pause
  exit /b 1
)

node "%~dp0tools\studio.mjs" --open
if errorlevel 1 (
  echo.
  echo [ERROR] The tool could not start. Read the full error above; this window will remain open.
  pause
  exit /b 1
)

endlocal
