---
name: proof
description: Proof Pack - turn one verification into a re-runnable scenario for a task. "proof save <task>" stores the scenario (fake customer + pages + PASS conditions) in <case>/proof.json after verifying; "proof run <task>" (or "re-test task X", "run the proof again") runs it headless via a script at zero token cost and produces a PASS/FAIL table + a screenshot per page to attach to the comment. Use after a fix/deploy, when the customer reports again, or when CS asks "is it still working".
---

# Proof Pack

Runner: `node "${CLAUDE_PLUGIN_ROOT}/scripts/proof/proof-run.mjs" <KEY> [--only <scenario|page>] [--mobile] [--isolated [--headed]]`
-> `$SAT_CASES_DIR/<KEY>/proof/run-<ts>/{results.md, results.json, *.png}`. Exit 0 = all PASS · 1 = some FAIL · 3 = captcha hit.
By default it runs in the **shared Chrome** (port 9222, opens/closes only its own tabs) -> reuses the session the user already verified.
First time: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"` (installs puppeteer-core into `~/.cache/support-agent/node`); run it whenever the runner reports it missing.
`--isolated` = a separate headless Chrome (dev stores, no session needed).

## save - store the scenario (after a real verification in this session)
Write `$SAT_CASES_DIR/<KEY>/proof.json`:
```json
{
  "domain": "example-store.myshopify.com",  // to get the storefront password via case.py secret; "password": false if public
  "base_url": "https://example-store.com",
  "app_global": "APP_GLOBAL",               // name of the app's storefront global (or set SAT_APP_GLOBAL)
  "scenarios": [{
    "name": "pricing-rule-384-tag-wholesale",
    "fake_customer": {"id": 1, "tags": ["wholesale"]},          // null = guest
    "wait_for": "window.APP_GLOBAL && window.APP_GLOBAL.config", // JS expression, wait until the app is ready
    "pages": [{
      "name": "product", "path": "/products/<handle>",
      "check": "<async function body, return {ok, actual, note}>",
      "before": ["<optional JS: open the cart drawer, change qty - never checkout>"],
      "selector": ".price (optional: screenshot only this area)", "settle_ms": 2500
    }]
  }]
}
```
Rules for writing `check` (taken from exactly what was verified in the session, never guessed):
- Fake the customer according to the real rule's targeting, never invented: customer tags -> `tags` exactly as the rule
  lists them; specific customer ids -> `id` = one id from the rule; logged-in -> any positive `id`; guests only -> `id`
  null; company/location targeting -> `current_company`/`current_location` = `{id:1}` (lower confidence, say so); all
  customers -> no targeting fields needed.
  Rules limited to certain products -> pick a real matching product (`/products.json`, `/products/<handle>.js`).
  Inject by polling with `setTimeout` (NOT Promise microtasks - that has hung pages before); the runner already does this.
- When the app exposes its rule/pricing engine on the global, check through the engine (e.g. "which rules apply to
  this customer" contains rule 384) rather than trusting the rendered price: the app may not re-render the DOM after
  the customer is faked.
- Check the DOM (price selector, a button, a badge...) when the DOM itself is what the customer reported - take a
  baseline first if you need to compare.
- `actual` = the number/string read (price, rule id) so the proof table means something to CS.
- One page per thing to prove; for a pricing install cover all price surfaces (product / collection / quick view /
  search / mini cart / cart).
After saving: run `run` once to make sure the scenario PASSes, then `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/case.py" log <KEY> "proof saved: N pages"`.

## run
Run the runner, read `results.md`, report the table to the user. FAIL -> open that page's screenshot (Read the png) to diagnose.
The result is used as the Result section + proof images for `docs-task` (upload images via `request_task_attachment_upload`, never base64).

## Limits / safety
- Fake customers only (faked in the tab's memory). Needs a real logged-in account -> verify via Chrome MCP (`open-env`).
- Exit 3 / a `CAPTCHA <url>` line: the runner kept the captcha tab open in the shared Chrome -> follow the "Captcha"
  section of `open-env` exactly (tell the user + run `captcha-wait.mjs "<url>"` in the background), `CLEARED` -> run the
  runner once more. Never loop runs against a customer store (it gets blocked after ~8 consecutive runs - this has
  happened); never change the user agent, never use a captcha-solving service.
- Never checkout/pay, never write anything to the store.
