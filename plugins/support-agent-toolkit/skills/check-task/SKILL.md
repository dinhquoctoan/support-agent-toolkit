---
name: check-task
description: Open or resume the Case File for one CRM support task, then gather enough context before concluding. Use when the user says "check task <link|key|number>" / "look at task X" / pastes a CRM task link. Creates or resumes <cases>/<KEY>/, reads the task + comments + support chat + domain history, OPENS CHROME (open-env) to inspect the customer's admin/Partner (read-only), the storefront (console, rules, real prices) and the chat, runs the native-first check, then gives a conclusion + proposed fix. Never deploys or posts at this step.
---

# Check task (Case File + real environment + native-first)

Tool: `C="${CLAUDE_PLUGIN_ROOT}/scripts/case.py"` (call `python3 "$C" ...`; cases live in `$SAT_CASES_DIR`, default
`~/support-cases`; `python3 "$C" where` shows the paths). A task key can be given as `TASK-5606`, a CRM link, or a bare
number `5606` (prefixed with `$SAT_TASK_PREFIX`).
CRM tools come from your CRM MCP server (`read_task`, `read_task_comments`, `add_task_comment`, ...); the per-shop
hotfix tools (`hotfix_read`, `hotfix_write`) usually come from the same server.

## 1. Resume or create
`python3 "$C" init <KEY>`:
- `[resume]` -> the case exists: read the output (meta + case.md + latest proof), tell the user **in one short
  paragraph where things stand**, and read only comments newer than `meta.updated`. If the site needs another look ->
  step 3 (only what is still missing).
- `[new]` -> step 2.

## 2. Read the task (sources that need no browser)
- `read_task(<KEY>, fields=["*"])` + `read_task_comments` (including attached images: open them with Read if downloadable).
- Support-chat link present -> `read_conversation_messages` (everything the customer said, images they sent).
- `python3 "$C" set <KEY> title="..." domain=... app=... storefront=...`; task says 403/expired access -> `access.partner=expired`.
- `python3 "$C" domain <domain>` -> earlier cases on the same domain: restate their "Notes for next time".
- `read_customer_tasks` (when a customer id exists) -> the same customer's earlier tasks as context.

**Token budget** (cost of one check ~ number of tool calls x context size; target <= 50 tool calls): no `take_snapshot`
(read the DOM with `evaluate_script` returning a compact object <= 2000 chars, batching several measurements in one
call; proof images still use `take_screenshot`, and before each batch of screenshots call
`select_page{..., bringToFront: true}` as in open-env, otherwise the screenshot can hang for 3 minutes); for code, use
`codegraph_explore` first (if available), Read with offset/limit <= 150 lines on the exact region, no `**/*` globs (narrow
patterns with `path` = repo), never re-read a file; read precedents/old cases once, do not open proof JSON; open the
customer's admin only when the task needs app/theme/embed settings (install, display bugs) - not for pure questions,
custom CSS or compatibility questions.

## 3. Open the environment and look for yourself (default whenever the task involves a store)
Run the `open-env` skill (read-only admin first -> storefront, unlocked with the password if known, otherwise via the
admin's theme Preview). Skip only for purely theoretical questions not tied to a store, or when the user says "no
Chrome yet".
Investigate exactly the reported symptom, read-only:
- **Storefront:** `window.Shopify.theme` (id/name), whether the app's storefront global (`window[APP_GLOBAL]`) exists,
  which features are enabled, the relevant live rules/config, console errors (`list_console_messages`), price/button DOM
  on exactly the page the customer reported. To see the page as a specific customer segment -> fake the customer
  according to the real rule (technique in the `proof` skill); never log into a real account unless the user provides one.
- **Customer admin:** live/draft theme, whether the app embed is enabled, the relevant app settings/rules (open the
  app page, screenshot), theme files when a missing template/snippet is suspected.
- **Partner / support chat in the browser:** only when MCP cannot read it (images, attachments).
- **Hotfix service:** `hotfix_read` (MCP) to see the shop's existing custom code before proposing new code.
Captcha -> follow the "Captcha" section of open-env (tell the user + wait for them to verify, never solve it). If
something cannot be reached (expired Partner access, captcha wait timed out, no password and no admin) -> record
`access.*`, keep investigating with what is left, and state clearly which facts the conclusion is missing. Never try
another way around the permission.
Write findings into the case immediately (`## Hypotheses` with evidence: rule id, console error, image in `proof/`).

## 4. Native-first (before proposing custom work)
Run the `native-check` skill on the task's request -> `## Native-first` section. If native features/config cover it ->
propose that first, custom is option 2.

## 5. Analysis
- **Request:** summarise in your own words (never paste HTML); skip empty description fields, do not guess.
  Split "Describe the issue" + "Expected behavior" into a `- [ ]` checklist, one sub-request per line, never merged.
- **Pure install task** (no error symptom) -> no root-cause digging; find the install pattern for this theme (old
  cases, `$SAT_KB_DIR` if set) and propose the steps.
- **Feature not running / not showing** with no matching precedent -> always check the 3 common causes before saying
  "unclear": (1) not installed correctly on this theme (missing code/hook), (2) theme incompatibility (heavily custom or
  unusual theme), (3) conflict with a third-party app.
- **Precedents:** `knowledge_search` (CRM MCP), old cases on the same domain, and `$SAT_KB_DIR` (if set) - try both
  feature names and symptom keywords, in the team's working language and in English.
- **Confidence** at the start of each hypothesis: 🟢 = seen/reproduced on the site (not just a precedent) · 🟡 = related
  precedent, needs verification · 🔴 = inference/generic checklist only. Never upgrade a level on your own.
- **Fixes from precedents:** old code often hard-codes a theme id/selector -> always re-check on the current store first.
Write `## Request`, `## Hypotheses`.
Conclude according to the "Content rules" of the `docs-task` skill: identify the right app first (if the vendor ships
several apps, match the exact email/template/tag wording to the app), commit to one main root cause with a confidence
level, the hypothesis must fit every fact in the task (timestamps, earlier orders worked / later ones fail); never stop
at a list of equally weighted hypotheses.

## 6. Output for the user (short)
1. Request summary + checklist · 2. What was seen on the site (evidence) · 3. Native-first verdict ·
4. Domain history (if any) · 5. Root-cause conclusion (🟢🟡🔴) + proposed fix · 6. What is missing / what the user must do.
Leave the Chrome tabs open for the fix/verify step.

## 7. Propose hotfix code (only when the fix needs custom JS/CSS: install, customisation, display fixes)
- Write it to `<case>/code/proposed.js` (or `proposed.css`); the first line is a comment `<KEY>` + a short description.
- `hotfix_read` first so you neither duplicate nor overwrite existing code; the code is only the ADDITION (the deploy
  step merges it into the current hotfix content), written for the storefront script version the shop runs.
- Prove the code works without deploying: on the storefront (Preview/password, fake customer via the `proof` skill
  when needed) inject the code temporarily with `evaluate_script` (or reload and inject before the app runs if
  needed), measure exactly the symptom before and after, save `before-*.png` / `after-*.png` into the case's `proof/`.
- Write `<case>/drafts/deploy-plan.md`: app handle, domain, support_key (short key like `js`, from
  `hotfix_read method=support_types`), merge position (top/bottom), content type (js/css), test result (PASS/FAIL per
  page), how to verify after deploy (page + PASS condition).
- Also save the `<case>/proof.json` scenario per the `proof` skill from the exact measurement just made (fake customer,
  page, `check` returning `{ok, actual}`; `"password": false` if the store is public). The deploy step verifies with the
  proof runner (0 tokens) and it can be re-run when the customer reports again. Password-locked store with no password
  -> set `"password": false` and note in deploy-plan that verification must be manual.
- Install/fix for a draft (unpublished) theme: wrap all code in
  `if (window.Shopify && Shopify.theme && Shopify.theme.id === <draft theme id>) { ... }` so the live theme is
  unaffected; record the theme id + reason in deploy-plan.md.
- No `hotfix_write` at the check step: writing the hotfix pushes straight to the customer's site, so it only happens
  in section 8 after the user approves. Draft comments read as "code prepared, temporary test OK, awaiting deploy".

## 8. Deploy the hotfix (only after the user approved the proposed code and said "deploy"; needs `hotfix_write` - without it stop at section 7)
1. Read `drafts/deploy-plan.md` and the proposed code.
2. `hotfix_read method=content` -> save it verbatim to `<case>/code/hotfix-before-<YYYYmmdd-HHMMSS>.<js|css>`;
   `hotfix_read method=history` -> record the current version for rollback.
3. Merge: keep the existing content unchanged, add the code inside a block `/* SAT <KEY> start */ ... /* SAT <KEY> end */`
   (if a block with the same key exists, replace exactly that block). Never touch code from other tasks.
4. `hotfix_write method=save` with the merged content -> `hotfix_read` again and compare it is exactly that content.
5. Verify. With `<case>/proof.json` -> do not verify by hand in Chrome: one `evaluate_script` on the main page to check
   the site is not broken (app global present, no new console errors from the app), then run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/proof/proof-run.mjs" <KEY>` (0 tokens) -> PASS/FAIL table + screenshots in
   `proof/run-<ts>/`. Without proof.json -> verify on the real storefront per deploy-plan (fake customer if needed), save
   `after-deploy-*.png` into `proof/`, and also check for new console errors from the app and that the main page's
   prices/buttons still render.
6. Site broken or verify/proof clearly FAILS -> `hotfix_write method=restore` to the version from step 2, then verify
   the site is back to its previous state.
7. Update the case: `## Deployed changes` (hotfix version, code file), `python3 "$C" log <KEY> ...`, status
   `verifying` (OK) or `fixing` (rolled back); update `drafts/comment.html` with the real result (Result with a
   page x result table) - do not post, posting is `docs-task`'s job.

## Keep the case accurate (throughout the session)
After each milestone, one short command, no need to ask:
- Hypothesis confirmed/ruled out -> edit its line in `## Hypotheses` (confirmed/ruled out + evidence).
- Deploy to hotfix/theme/admin -> save the code to `<case>/code/<name>.js`, record `## Deployed changes`,
  `python3 "$C" set <KEY> status=verifying`.
- Verified -> the `proof` skill saves the scenario; status `drafted`/`posted`/`waiting-customer`/`done`.
- Anything worth remembering about the domain/theme/access -> `## Notes for next time`.
- Every milestone -> `python3 "$C" log <KEY> "<one line>"`.
Never write passwords/tokens into case.md.
