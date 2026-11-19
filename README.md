# support-agent-toolkit

A Claude Code plugin that turns a technical-support ticket into an investigated root cause, a verified fix and a
customer-ready report. It gives Claude a repeatable workflow - persistent case files, a read-only view of the
customer's store, a native-first feature check, browser-proven fixes, guarded deploys and zero-token regression
re-runs - so an agent can work a ticket end to end while a human keeps control of every write. It is a generalised,
sanitised copy of a toolkit I built and use daily for a Shopify-app support team.

## How it works

```
ticket (CRM)
  -> case file          persistent folder per task; resumes across sessions
  -> environment        shared Chrome: CRM tab, customer admin behind a read-only guard, storefront
  -> native-first       can the app already do this? native / config / custom / not possible, with sources
  -> root cause         one committed cause with a confidence level (🟢 seen · 🟡 inferred · 🔴 hypothesis)
  -> proposed fix       hotfix code injected temporarily in the browser, before/after screenshots
  -> approved deploy    backup, marked block merge, verify, automatic restore on failure
  -> proof re-run       saved scenario replayed headless with Puppeteer, PASS/FAIL table, 0 tokens
  -> comment            CS summary / Root Cause / Solution / Technical Details / Result, posted with images
```

## Safety by design

- **Read-only by default.** A guard script injected into the customer's admin tab blocks GraphQL mutations,
  PUT/PATCH/DELETE, admin REST POSTs and form submits, shows a red banner and logs what it blocked. A write needs an
  explicit per-action allow flag set only when the user assigns that action.
- **Deploys only after explicit approval.** The current hotfix content is saved before any write, new code goes inside
  `/* SAT <KEY> start/end */` markers, the result is read back and verified, and the previous version is restored if
  the site breaks or the proof fails.
- **Captchas are never solved.** Scripts detect anti-bot pages, stop, and wait for a human to verify in the shared
  browser.
- **No real transactions.** Customer behaviour is faked in tab memory only; nothing ever checks out or pays.
- **Secrets stay out of case files.** Storefront passwords live in a separate per-user file outside the repo.
- **Comments are evidence-based.** Content rules forbid leaking internal names, require one committed root cause with a
  confidence level, and keep unverified work out of the Result section. Edits the user makes to posted comments are
  turned into proposed rules, applied only after approval.
- **Token budget.** Skills cap tool calls, prefer compact `evaluate_script` reads over DOM snapshots, and move
  re-verification into a script that costs no tokens.

## Skills

| Skill | Trigger | What it does |
|---|---|---|
| `check-task` | "check task 5606", a CRM link | Creates/resumes the case file, reads task + comments + chat, opens the environment, runs native-check, concludes root cause with confidence and proposes a fix. Deploys only after approval. |
| `open-env` | "open the environment for task X" | Opens CRM, support chat, customer admin (read-only guard) and storefront (auto password unlock or admin Preview); handles captchas by waiting for the user. |
| `native-check` | "can the app do X?" | Matrix: ✅ Native / ⚙️ Config / 🛠 Custom / ⛔ Not possible, with sources (changelog, docs, KB, code). |
| `proof` | "proof save X", "re-test task X" | Saves a verify scenario (fake customer + pages + PASS checks) and re-runs it headless: PASS/FAIL table + screenshots. |
| `docs-task` | "docs task X" | Writes and posts the structured comment with proof images; learns rules from user edits. |

## Scripts (`plugins/support-agent-toolkit/scripts/`)

| Script | Purpose |
|---|---|
| `case.py` | Case File CLI: init/resume, show, set, log, domain history, posted-comment tracking, secret lookup. |
| `readonly-guard.js` | Init script that blocks write requests in the admin tab. |
| `chrome-shared.sh`, `chrome-mcp.sh` | One shared Chrome on debug port 9222; MCP wrapper for `chrome-devtools-mcp`. |
| `proof/proof-run.mjs` | Headless Puppeteer runner for saved proof scenarios. |
| `proof/captcha-wait.mjs`, `proof/challenge.mjs` | Captcha detection and wait-for-human loop. |
| `session-check.sh` | SessionStart hook: one line if dependencies are missing, silent otherwise. |
| `setup.sh` | Installs `puppeteer-core` into a per-user directory. |

## Requirements

- Claude Code with plugin support (`/plugin`).
- Node.js 18+ (with `npx`), Python 3.9+, `curl`, Google Chrome or Chromium.
- An MCP server for your CRM exposing tools such as `read_task`, `read_task_comments`, `add_task_comment`,
  `update_task_comment`, `request_task_attachment_upload`, `knowledge_search`, `read_customer_tasks`,
  `read_conversation_messages`, and for deploys a per-shop hotfix service (`hotfix_read` / `hotfix_write` with
  `method` = `save | restore | history | content`). These are not included; the skills expect your own server.
- A one-time login (Shopify Partner, CRM) inside the shared Chrome profile: run `scripts/chrome-shared.sh start` with a
  display and sign in; the profile keeps the session.

## Install

```
/plugin marketplace add <github-url>
/plugin install support-agent-toolkit@support-agent
```
Restart Claude Code, then run once:
```
bash ~/.claude/plugins/cache/support-agent/support-agent-toolkit/*/scripts/setup.sh
```
The plugin registers a `chrome-devtools` MCP server (`.mcp.json` -> `scripts/chrome-mcp.sh`) that starts the shared
Chrome and attaches `chrome-devtools-mcp --browserUrl http://127.0.0.1:9222`.

## Environment variables (all optional)

| Variable | Default | Meaning |
|---|---|---|
| `SAT_CASES_DIR` | `~/support-cases` | Case files (`<KEY>/meta.json, case.md, code/, proof/, drafts/`). Contains customer data. |
| `SAT_SECRETS_FILE` | `~/.config/support-agent/store-passwords.md` | Storefront passwords, one `domain: password` per line. |
| `SAT_TASK_PREFIX` | `TASK` | Prefix for bare numbers (`5606` -> `TASK-5606`). |
| `SAT_CRM_TASK_URL` | `https://crm.example.com/tasks/{key}` | Task URL template stored in the case. |
| `SAT_APP_GLOBAL` | `APP_GLOBAL` | The app's storefront global used to fake the customer in proof runs (or `app_global` in proof.json). |
| `SAT_CHROME_PORT` | `9222` | Shared Chrome debug port. |
| `SAT_CHROME_PROFILE` | `~/.cache/support-agent/chrome-profile` | Shared Chrome profile (keeps logins). |
| `SAT_CHROME_BIN` | auto-detect | Chrome/Chromium binary. |
| `SAT_CHROME_AUTOSTART` | `1` | `0` = only attach to an already running Chrome. |
| `SAT_DEPS` | `~/.cache/support-agent/node` | Where `setup.sh` installs `puppeteer-core`. |
| `SAT_KB_DIR` | (none) | Optional local knowledge base (past ticket notes, release-notes digest, theme-fix registry). |
| `SAT_APP_REPO` | (none) | Optional path to the app's source for native-check code lookups. |

`python3 scripts/case.py where` prints the active paths.
