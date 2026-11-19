#!/usr/bin/env bash
# SessionStart: print one line when the machine lacks something the plugin needs. Silent when all is fine (no context cost).
miss=()
DEPS=${SAT_DEPS:-$HOME/.cache/support-agent/node}
[ -d "$DEPS/node_modules/puppeteer-core" ] || miss+=("puppeteer-core (proof runner)")
[ -d "${SAT_CASES_DIR:-$HOME/support-cases}" ] || miss+=("cases directory")
command -v python3 >/dev/null || miss+=("python3")
command -v node >/dev/null || miss+=("node")
chrome=""; for c in "$SAT_CHROME_BIN" /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do [ -n "$c" ] && [ -x "$c" ] && chrome=1 && break; done
[ -n "$chrome" ] || miss+=("Google Chrome")
if [ ${#miss[@]} -gt 0 ]; then
  echo "support-agent-toolkit: missing on this machine: $(IFS=,; echo "${miss[*]}" | sed "s/,/, /g"). Run: bash \"${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh\" (install Chrome/node/python by hand)."
fi
exit 0
