#!/usr/bin/env node
// Proof Pack runner - re-runs a task's saved verify scenario at zero token cost.
//   node proof-run.mjs <KEY> [--only <scenario|page>] [--mobile] [--isolated [--headed]]
// Reads $SAT_CASES_DIR/<KEY>/proof.json, writes <KEY>/proof/run-<ts>/{results.md,results.json,*.png}.
// Default: runs in the SHARED Chrome (9222) -> reuses the session where the user already passed captchas; only opens/closes its own tabs.
// --isolated = a separate headless Chrome (dev stores, fast runs). On a captcha -> keeps the tab, prints "CAPTCHA <url>", exit 3.
// Safety: the fake customer lives only in the tab's JS memory; never checks out; never solves or bypasses captchas.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SHARED_URL, SHARED_START, challengeOf, loadPuppeteer } from "./challenge.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES = process.env.SAT_CASES_DIR ? path.resolve(process.env.SAT_CASES_DIR.replace(/^~/, os.homedir())) : path.join(os.homedir(), "support-cases");
const PREFIX = process.env.SAT_TASK_PREFIX || "TASK";
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
let key = args.find((a) => !a.startsWith("--") && a !== val("--only"));
if (!key || flag("--help")) { console.error("usage: proof-run.mjs <TASK_KEY> [--only x] [--mobile] [--isolated [--headed]]"); process.exit(2); }
if (/^\d+$/.test(key)) key = `${PREFIX}-${key}`;
key = (key.toUpperCase().match(/\b[A-Z][A-Z0-9]*-\d+\b/) || [key])[0];

const puppeteer = await loadPuppeteer();
const caseDir = path.join(CASES, key);
const spec = JSON.parse(fs.readFileSync(path.join(caseDir, "proof.json"), "utf8"));
const base = spec.base_url.replace(/\/$/, "");
// Name of the app's storefront global (window[APP_GLOBAL]) whose shopData.customer gets faked.
const APP_GLOBAL = spec.app_global || process.env.SAT_APP_GLOBAL || "APP_GLOBAL";
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const outDir = path.join(caseDir, "proof", `run-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

function password() {
  if (spec.password === false) return null;
  try {
    return execFileSync("python3", [path.join(HERE, "..", "case.py"), "secret", spec.domain || base], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
}

// Validated fake-customer technique: override shopData.customer on the app global, poll with setTimeout (NOT microtasks).
const fakeScript = (customer, waitExpr) => `(() => {
  var start = Date.now(), fake = ${JSON.stringify(customer)};
  function loop(){
    var B = window[${JSON.stringify(APP_GLOBAL)}];
    if (B && fake) { B.shopData = B.shopData || {}; B.shopData.customer = Object.assign({}, B.shopData.customer, fake); }
    try { if (B && (${waitExpr || "false"})) return; } catch(e) {}
    if (Date.now() - start > 20000) return;
    setTimeout(loop, 0);
  }
  loop();
})();`;

async function unlock(page) {
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
  if (!/\/password/.test(page.url()) && !(await page.$('form[action*="password"] input[type="password"]'))) return "public";
  const pw = password();
  if (!pw) return "locked-no-password";
  await page.type('input[type="password"]', pw);
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {}), page.keyboard.press("Enter")]);
  return /\/password/.test(page.url()) ? "wrong-password" : "unlocked";
}

const shared = !flag("--isolated");
let browser;
if (shared) {
  try { execFileSync(SHARED_START, ["start"], { stdio: "ignore" }); } catch {}
  browser = await puppeteer.connect({ browserURL: SHARED_URL, defaultViewport: null });
} else {
  const exe = process.env.SAT_CHROME_BIN || ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
  browser = await puppeteer.launch({ executablePath: exe, headless: !flag("--headed"), args: ["--no-sandbox"] });
}
const mine = new Set(); // tabs opened by the runner - only these get closed
const open = async () => { const p = await browser.newPage(); mine.add(p); return p; };
let captchaPage = null;
const isChallenged = async (pg) => { const k = await challengeOf(pg); if (k) captchaPage = pg; return k; };
const results = [];
let stop = false;
try {
  const page = await open();
  await page.setViewport(flag("--mobile") ? { width: 390, height: 844, isMobile: true } : { width: 1366, height: 900 });
  const access = await unlock(page);
  if (await isChallenged(page)) throw new Error("anti-bot captcha on the home page - the user must verify by hand in the shared Chrome, then re-run");
  if (access.startsWith("locked") || access === "wrong-password") throw new Error(`Storefront is locked (${access}) - add the password to SAT_SECRETS_FILE (see case.py where)`);
  const only = val("--only");
  for (const sc of spec.scenarios) {
    for (const pg of sc.pages) {
      if (stop) break;
      if (only && only !== sc.name && only !== pg.name) continue;
      const row = { scenario: sc.name, page: pg.name, url: base + pg.path, ok: false, actual: null, note: "" };
      const p2 = await open();
      await p2.setViewport(page.viewport());
      const injected = await p2.evaluateOnNewDocument(fakeScript(sc.fake_customer || null, sc.wait_for));
      try {
        await p2.goto(row.url, { waitUntil: "domcontentloaded", timeout: 60000 });
        if (await isChallenged(p2)) throw new Error("anti-bot captcha - stopping, the user must verify by hand");
        if (sc.wait_for) await p2.waitForFunction(sc.wait_for, { timeout: 25000 }).catch(() => (row.note = "wait_for timeout; "));
        await new Promise((r) => setTimeout(r, pg.settle_ms ?? 2500));
        for (const step of pg.before || []) await p2.evaluate(step); // e.g. open the cart drawer / change qty - NEVER checkout
        if (pg.before?.length) await new Promise((r) => setTimeout(r, 1500));
        const out = await p2.evaluate(`(async () => { ${pg.check} })()`);
        Object.assign(row, { ok: !!out?.ok, actual: out?.actual ?? null, note: row.note + (out?.note || "") });
      } catch (e) {
        row.note += "ERROR: " + e.message.split("\n")[0];
        if (/captcha/.test(e.message)) stop = true;
      }
      if (pg.screenshot !== false) {
        const file = `${sc.name}-${pg.name}`.replace(/[^\w.-]+/g, "_") + ".png";
        await p2.bringToFront().catch(() => {}); // shared Chrome: a background tab makes screenshots hang up to 180s
        const el = pg.selector ? await p2.$(pg.selector).catch(() => null) : null;
        await (el ? el.screenshot({ path: path.join(outDir, file) }) : p2.screenshot({ path: path.join(outDir, file) })).catch(() => {});
        row.screenshot = file;
      }
      await p2.removeScriptToEvaluateOnNewDocument(injected.identifier).catch(() => {});
      if (p2 !== captchaPage) { await p2.close().catch(() => {}); mine.delete(p2); }
      results.push(row);
      console.log(`${row.ok ? "PASS" : "FAIL"}  ${sc.name} / ${pg.name}  ${row.actual ?? ""} ${row.note}`);
    }
  }
} catch (e) {
  console.error("ABORT:", e.message);
  results.push({ scenario: "-", page: "-", ok: false, note: "ABORT: " + e.message });
} finally {
  if (shared) {
    for (const p of mine) if (p !== captchaPage) await p.close().catch(() => {});
    if (captchaPage) await captchaPage.bringToFront().catch(() => {});
    await browser.disconnect();
  } else await browser.close();
}

const pass = results.filter((r) => r.ok).length;
const md = [
  `# Proof ${key} · ${stamp}`, "", `Domain: ${base} · ${pass}/${results.length} PASS`, "",
  "| Scenario | Page | Result | Actual value | Note | Screenshot |", "|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.scenario} | ${r.page} | ${r.ok ? "✅" : "❌"} | ${String(r.actual ?? "").replace(/\|/g, "/")} | ${String(r.note || "").replace(/\|/g, "/")} | ${r.screenshot || ""} |`),
].join("\n");
fs.writeFileSync(path.join(outDir, "results.md"), md + "\n");
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ key, stamp, base, results }, null, 2));
console.log(`\n${pass}/${results.length} PASS -> ${path.relative(CASES, outDir)}/results.md`);
if (captchaPage) {
  const u = shared ? captchaPage.url() : "(isolated - re-run without --isolated so the user can verify in the shared Chrome)";
  console.log(`CAPTCHA ${u}`);
  process.exit(3);
}
process.exit(pass === results.length && results.length ? 0 : 1);
