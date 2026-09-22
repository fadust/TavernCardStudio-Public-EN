@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title TavernCardStudio

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js。请先安装 Node.js 24（或满足 package.json 要求的版本），再重新双击本文件。
  echo        下载地址：https://nodejs.org/
  pause
  exit /b 1
)

rem 环境检查与依赖安装都由 tools/setup.mjs 负责：Node 版本、pnpm 版本、依赖缺失或漂移。
node "%~dp0tools\setup.mjs" --ensure
if errorlevel 1 (
  echo.
  echo [错误] 环境准备未完成，已停止启动。请按上面的提示处理，然后重新双击本文件。
  pause
  exit /b 1
)

node "%~dp0tools\studio.mjs" --open
if errorlevel 1 (
  echo.
  echo [错误] 工具未能正常启动，请查看上方完整报错；这个窗口会保留。
  pause
  exit /b 1
)

endlocal
