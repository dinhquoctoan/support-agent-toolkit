#!/usr/bin/env bash
# MCP command for chrome-devtools: make sure the shared Chrome is up, then attach to it.
# Extra args are ignored (the browser already exists).
# SAT_CHROME_AUTOSTART=0: only attach if Chrome is already running, never launch it.
HERE=$(cd "$(dirname "$0")" && pwd)
PORT=${SAT_CHROME_PORT:-9222}
[ "${SAT_CHROME_AUTOSTART:-1}" = 0 ] || "$HERE/chrome-shared.sh" start || true
exec npx -y chrome-devtools-mcp@1.6.0 --browserUrl "http://127.0.0.1:$PORT"
