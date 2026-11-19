---
name: open-env
description: Open the whole task environment in Chrome (chrome-devtools MCP) in one go - CRM task tab, storefront (auto-unlocks the password page), the customer's Shopify admin (with a READ-ONLY guard that blocks write requests), support chat. Use when the user says "open chrome for testing", "open the environment for task X", "open the customer's admin/storefront", or before a verify step. The customer admin is view-only by default.
---

# Open env

Tool: `C="${CLAUDE_PLUGIN_ROOT}/scripts/case.py"` · guard: `${CLAUDE_PLUGIN_ROOT}/scripts/readonly-guard.js` ·
Chrome: `${CLAUDE_PLUGIN_ROOT}/scripts/chrome-shared.sh`.

## 0. Shared Chrome
Every Claude session connects to the SAME Chrome via debug port `$SAT_CHROME_PORT` (default 9222, profile
`$SAT_CHROME_PROFILE`, default `~/.cache/support-agent/chrome-profile` - keeps Partner/CRM logins). The plugin's
`chrome-devtools` MCP runs `scripts/chrome-mcp.sh` (starts Chrome if needed, then `--browserUrl`).
- Always open a NEW tab (`new_page`) for the task; never close or navigate tabs of other sessions or tabs the user is using.
- Chrome tools cannot connect -> `bash "${CLAUDE_PLUGIN_ROOT}/scripts/chrome-shared.sh" start` and retry; still failing -> `... status` and tell the user.
- Close the task's tabs when done, never the whole Chrome (other sessions share it).

## 1. Gather info
`python3 "$C" show <KEY>` (no case yet -> run `check-task` steps 1-2 first to get domain/storefront/chat link).
`readonly` is **true** by default; false only when the user explicitly allows actions in the admin.

## 2. Open tabs (each `new_page` with `background: true`, except the last)
1. **CRM task**: `meta.crm_url`.
2. **Support chat**: the chat link in the task description (if any).
3. **Customer admin** (open BEFORE the storefront): `new_page("about:blank")` then `navigate_page(url="https://admin.shopify.com/store/<handle>", initScript=<contents of readonly-guard.js>)`
   (`<handle>` = the part before `.myshopify.com`; read the guard file with Bash and pass it verbatim). A red
   "READ-ONLY" banner bottom-left = guard active.
   - Log in through the Partner link in the task first: `https://dev.shopify.com/dashboard/<org>/stores/<shop_id>`
     -> the "Log in" button = `.../stores/<shop_id>/collaborator_login` ("Collaborator access granted ..." means access is
     still valid). Going straight to admin.shopify.com without this step reports "doesn't have permission" even when
     access is still valid.
   - Still bounced to login / "You don't have access" via Partner -> `python3 "$C" set <KEY> access.partner=expired`,
     tell the user collaborator access must be requested again. Never try another way in.
   - Got in -> `access.partner=ok`.
4. **Storefront** (last, foreground): `meta.storefront` or `https://<domain>`. On a `/password` page:
   1. Password available (`python3 "$C" secret <domain>`, the user's private secrets file) -> type it + Enter.
   2. No password but the admin is accessible -> open via **Preview from the admin**: admin tab ->
      `https://admin.shopify.com/store/<handle>/themes` -> click **Preview** / **View your store** for the theme to
      test (live or the draft named in the task). This is a view-only action, the guard does not block it. The staff
      session in Chrome shows the storefront without a password (draft themes too, URL with `preview_theme_id`). Save
      the preview URL with `python3 "$C" set <KEY> storefront=<url>`, record `access.fe_password=via-admin-preview`.
   3. Neither -> `access.fe_password=missing`, ask the user for the password, then suggest adding a line
      `domain: password` to `$SAT_SECRETS_FILE` (default `~/.config/support-agent/store-passwords.md`, NEVER commit it).
   The proof runner (headless, no admin session) cannot use admin Preview -> for a password-locked store with no
   password: verify through Chrome MCP, or use a **Share preview** link (`*.shopifypreview.com`) if the user created one,
   as `base_url` in proof.json.

## 3. Report back (1-3 lines)
Which tabs are open/unlocked, which need the user to log in or request access. `python3 "$C" log <KEY> "open-env: ..."`.

## When the user asks you to change something in the admin
The admin is read-only by default, but when the user assigns a task that needs a write (change a setting/rule, add
theme code, create a tag...), do it without asking again:
1. `evaluate_script`: `window.__satAllowWrite = true` on the admin tab (the guard lets writes through).
2. Do EXACTLY the assigned scope, nothing else. Screenshot before/after for settings.
3. Done -> `window.__satAllowWrite = false` immediately, record it in the case: `## Deployed changes` + `python3 "$C" log <KEY> "admin write: ..."`.
The permission covers only the assigned action; the next write needs a new request from the user.

## Read-only rules (when no write is assigned)
- The guard blocks GraphQL mutations / PUT / PATCH / DELETE / REST create / form POST in the admin main frame (tested).
  It does **not** cover embedded app iframes (cross-origin) and is lost after the tab reloads into a new document
  without `navigate_page{initScript}` -> keep the rule yourself: in the admin only `navigate_page`, `take_snapshot`,
  `take_screenshot`, `evaluate_script` for reading; never `click`/`fill`/`press_key` on Save/Delete/Install/Enable.
  Reloading the admin tab -> navigate again with initScript.
- **Screenshots:** the shared Chrome has a UI; when the tab is not on top, `take_screenshot` hangs 120-180s
  (reproduced: tab in background > 20s, brought to front 0.1s). Always switch tabs with `select_page{pageId, bringToFront: true}`;
  before each batch of screenshots call `select_page{..., bringToFront: true}` again for your own tab (another session may have opened a tab on top).
- `window.__satBlocked` (evaluate_script) lists blocked requests - report them to the user if any.
- Storefront: faking a customer / adding to cart for testing is fine; never click checkout/payment (that creates real orders on the customer's store).
- Anti-bot captcha -> see "Captcha" below. Never solve it, never use a captcha-solving service, never change the UA/flags.

## Captcha - ask the user to verify, then continue
1. Stop all actions on that tab. Tell the user "<KEY>: captcha on <host> - please verify in the shared Chrome" (use the
   `PushNotification` tool if available).
2. Bash `run_in_background`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/proof/captcha-wait.mjs" "<substring of the tab URL>" --timeout 300` - brings the tab
   to the front and waits until the captcha is gone (prints `CLEARED`, exit 0) or 5 minutes pass (`TIMEOUT`). Meanwhile, continue with work that does not need that tab.
3. `CLEARED` -> continue on that same tab (the verification cookie lives in the shared profile; other tabs on the same
   domain are usually not challenged again). `TIMEOUT` -> do not wait longer: record `access.fe_captcha=blocked`, switch
   to Preview from the admin (step 2.4.2) / Share preview and continue, tell the user in one line.
4. Stores that often show captchas -> limit page loads; suggest CS ask the customer to allowlist the team's IP if they run their own Cloudflare.
