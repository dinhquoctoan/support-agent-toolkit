#!/usr/bin/env node
// Wait for the user to solve a captcha by hand in the shared Chrome (port 9222). NEVER solves or bypasses it.
//   node captcha-wait.mjs <substring of the tab URL> [--timeout 300]
// Brings that tab to the front, polls every 3s. Prints "CLEARED <url>" exit 0 | "TIMEOUT" exit 4 | "NO_TAB" exit 5 | "NO_CHROME" exit 6.
// Never closes the tab or Chrome (only disconnects).
import { SHARED_URL, challengeOf, loadPuppeteer } from "./challenge.mjs";

const args = process.argv.slice(2);
const needle = args.find((a) => !a.startsWith("--"));
const ti = args.indexOf("--timeout");
const timeout = (ti >= 0 ? +args[ti + 1] : 300) * 1000;
if (!needle) { console.error("usage: captcha-wait.mjs <url-substring> [--timeout sec]"); process.exit(2); }

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.connect({ browserURL: SHARED_URL, defaultViewport: null }).catch(() => {
  console.log(`NO_CHROME ${SHARED_URL} — run chrome-shared.sh start`); process.exit(6);
});
const findTab = async () => (await browser.pages()).find((p) => p.url().includes(needle));
let page = await findTab();
if (!page) { console.log("NO_TAB " + needle); await browser.disconnect(); process.exit(5); }
await page.bringToFront().catch(() => {});
const end = Date.now() + timeout;
let code = 4;
while (Date.now() < end) {
  page = (await findTab()) || page;
  if (!page.isClosed() && !(await challengeOf(page))) { code = 0; break; }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(code === 0 ? `CLEARED ${page.url()}` : "TIMEOUT");
await browser.disconnect();
process.exit(code);
