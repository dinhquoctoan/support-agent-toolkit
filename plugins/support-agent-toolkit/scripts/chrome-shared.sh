#!/usr/bin/env bash
# One shared Chrome for every Claude session, exposed on a local debug port (default 9222).
# The profile keeps Partner/admin/CRM logins between sessions.
#   chrome-shared.sh start | status | stop
# All output goes to stderr (called from the MCP wrapper, stdout must stay clean).
set -uo pipefail
PORT=${SAT_CHROME_PORT:-9222}
PROFILE=${SAT_CHROME_PROFILE:-$HOME/.cache/support-agent/chrome-profile}
log() { echo "[chrome-shared] $*" >&2; }
up() { curl -s --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; }

chrome_bin() {
  if [ -n "${SAT_CHROME_BIN:-}" ]; then echo "$SAT_CHROME_BIN"; return; fi
  for c in google-chrome google-chrome-stable chromium chromium-browser \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    command -v "$c" >/dev/null 2>&1 && { command -v "$c"; return; }
    [ -x "$c" ] && { echo "$c"; return; }
  done
}

start() {
  up && return 0
  if pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null && ! pgrep -f -- "--remote-debugging-port=$PORT" >/dev/null; then
    log "Profile is held by another Chrome without a debug port — close that window and retry."
    return 1
  fi
  local bin; bin=$(chrome_bin)
  [ -n "$bin" ] || { log "Chrome/Chromium not found — set SAT_CHROME_BIN."; return 1; }
  mkdir -p "$PROFILE"
  local mode=()
  if [ "$(uname)" != Darwin ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    mode=(--headless=new); log "No DISPLAY → headless."
  fi
  local launcher=(); command -v setsid >/dev/null && launcher=(setsid)
  "${launcher[@]}" "$bin" --remote-debugging-port="$PORT" --remote-debugging-address=127.0.0.1 \
    --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check "${mode[@]}" about:blank \
    >/dev/null 2>&1 < /dev/null &
  for _ in $(seq 1 30); do up && { log "Shared Chrome running (port $PORT)."; return 0; }; sleep 0.5; done
  log "Could not start Chrome on port $PORT."; return 1
}

status() {
  if up; then log "Shared Chrome: running (port $PORT, profile $PROFILE)"; else log "Shared Chrome: NOT running"; fi
}

stop() {
  pkill -f -- "--remote-debugging-port=$PORT --remote-debugging-address=127.0.0.1 --user-data-dir=$PROFILE" && log "stopped" || log "no shared Chrome running"
}

case "${1:-start}" in start) start ;; status) status ;; stop) stop ;; *) echo "usage: $0 start|status|stop" >&2; exit 2 ;; esac
