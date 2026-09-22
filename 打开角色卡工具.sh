#!/usr/bin/env sh
# TavernCardStudio 启动器（Linux / macOS / WSL）
# 用法：在仓库根目录运行 sh 打开角色卡工具.sh，或先 chmod +x 再双击运行。
# 环境检查与依赖安装都由 tools/setup.mjs 负责；本脚本保留并显示它的完整输出。

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
cd "$SCRIPT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未找到 Node.js。请先安装 Node.js 24（或满足 package.json 要求的版本），再重新运行本文件。" >&2
  echo "       下载地址：https://nodejs.org/" >&2
  if [ -t 0 ]; then printf '%s' "按回车键关闭..." >&2; read -r _ || true; fi
  exit 1
fi

node tools/setup.mjs --ensure
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "[错误] 环境准备未完成，已停止启动。请按上面的提示处理，然后重新运行本文件。" >&2
  if [ -t 0 ]; then printf '%s' "按回车键关闭..." >&2; read -r _ || true; fi
  exit "$STATUS"
fi

node tools/studio.mjs --open
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "[错误] 工具未能正常启动，请查看上方完整报错。" >&2
  if [ -t 0 ]; then printf '%s' "按回车键关闭..." >&2; read -r _ || true; fi
  exit "$STATUS"
fi
