#!/usr/bin/env sh
# TavernCardStudio launcher (Linux / macOS / WSL)
# Usage: run sh Open-TavernCardStudio.sh from the repository root, or chmod +x then double-click.
# tools/setup.mjs checks the environment and installs dependencies; preserve its complete output.

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
cd "$SCRIPT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install Node.js 24 (or a version satisfying package.json), then run this file again." >&2
  echo "       Download: https://nodejs.org/" >&2
  if [ -t 0 ]; then printf '%s' "Press Enter to close..." >&2; read -r _ || true; fi
  exit 1
fi

node tools/setup.mjs --ensure
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "[ERROR] Environment preparation incomplete; startup stopped. Follow the guidance above, then run this file again." >&2
  if [ -t 0 ]; then printf '%s' "Press Enter to close..." >&2; read -r _ || true; fi
  exit "$STATUS"
fi

node tools/studio.mjs --open
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "[ERROR] The tool could not start. Read the full error above." >&2
  if [ -t 0 ]; then printf '%s' "Press Enter to close..." >&2; read -r _ || true; fi
  exit "$STATUS"
fi
