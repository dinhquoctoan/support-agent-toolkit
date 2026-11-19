#!/usr/bin/env bash
# One-time setup: install puppeteer-core for the proof runner into a per-user dir
# (outside the plugin cache, so plugin updates don't wipe it).
set -euo pipefail
DEPS=${SAT_DEPS:-$HOME/.cache/support-agent/node}
mkdir -p "$DEPS" "${SAT_CASES_DIR:-$HOME/support-cases}" "$(dirname "${SAT_SECRETS_FILE:-$HOME/.config/support-agent/store-passwords.md}")"
npm install --prefix "$DEPS" --no-audit --no-fund puppeteer-core@^23.11.1
echo "ok: puppeteer-core in $DEPS"
