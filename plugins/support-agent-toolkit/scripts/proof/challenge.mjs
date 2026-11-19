// Detect anti-bot pages (only to STOP and ask the user to verify by hand — never solve/bypass).
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SHARED_URL = `http://127.0.0.1:${process.env.SAT_CHROME_PORT || 9222}`;
export const SHARED_START = path.resolve(HERE, "..", "chrome-shared.sh");
export const DEPS_DIR = process.env.SAT_DEPS || path.join(os.homedir(), ".cache", "support-agent", "node");

// puppeteer-core: local node_modules first, then the per-user deps dir (scripts/setup.sh installs it there).
export async function loadPuppeteer() {
  try { return (await import("puppeteer-core")).default; } catch {}
  try {
    const mod = createRequire(path.join(DEPS_DIR, "noop.js"))("puppeteer-core");
    return mod.default ?? mod;
  } catch {
    console.error(`puppeteer-core not found — run: bash ${path.resolve(HERE, "..", "setup.sh")}`);
    process.exit(2);
  }
}

// Runs in the page: non-empty string if blocked by a captcha/challenge.
export const DETECT_JS = `(() => {
  const t = (document.title + " " + (document.body ? document.body.innerText.slice(0, 3000) : "")).toLowerCase();
  if (/just a moment|verify you are human|your connection needs to be verified|checking your browser|attention required/.test(t)) return "cloudflare";
  if (/\\/challenge(\\b|\\/|\\?)/.test(location.pathname + location.search) || document.querySelector('form[action*="/challenge"]')) return "shopify-challenge";
  if (document.querySelector('iframe[src*="challenges.cloudflare.com"]')) return "turnstile";
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 50 && r.height > 50; };
  const box = [...document.querySelectorAll('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"], iframe[src*="hcaptcha.com"]')]
    .find((f) => !/size=invisible/.test(f.src) && vis(f));
  if (box) return "recaptcha";
  return "";
})()`;

export async function challengeOf(page) {
  try { return await page.evaluate(DETECT_JS); } catch { return ""; }
}
