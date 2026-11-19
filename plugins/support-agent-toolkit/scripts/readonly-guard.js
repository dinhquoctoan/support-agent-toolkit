// Read-only guard for the customer's admin tab (Shopify admin / Partner). Injected via navigate_page{initScript}.
// Blocks WRITE requests (GraphQL mutations, PUT/PATCH/DELETE, admin REST POST, form submit) in the main frame,
// shows a red banner and logs to window.__satBlocked. Read requests (GraphQL queries) go through normally.
// LIMITS: does not cover cross-origin iframes (apps embedded in the admin) and is lost when the tab hard-reloads
// into a new document without navigate_page + initScript - the agent must still keep its own "look, don't touch" rule.
(() => {
  if (window.__satReadonly) return;
  window.__satReadonly = true;
  window.__satBlocked = [];
  const WRITE_OP = /"operationName"\s*:\s*"[^"]*(Create|Update|Delete|Remove|Save|Set|Add|Publish|Archive|Activate|Deactivate|Enable|Disable|Install|Uninstall|Assign|Approve|Reject|Cancel|Refund|Fulfill|Upsert|Bulk)/i;
  const bodyText = (b) => {
    try {
      if (!b) return "";
      if (typeof b === "string") return b;
      if (b instanceof URLSearchParams) return b.toString();
      if (b instanceof FormData) return [...b.entries()].map(([k, v]) => k + "=" + v).join("&");
    } catch (e) {}
    return "";
  };
  // The user allows one specific write -> evaluate_script `window.__satAllowWrite = true`, then set it back to false.
  const isWrite = (method, url, body) => {
    if (window.__satAllowWrite === true) return false;
    method = String(method || "GET").toUpperCase();
    if (method === "PUT" || method === "PATCH" || method === "DELETE") return true;
    if (method !== "POST") return false;
    const u = String(url), b = bodyText(body);
    if (/[?&]type=mutation\b/i.test(u)) return true;
    if (/(^|[\s{"])mutation[\s({]/.test(b)) return true;
    if (WRITE_OP.test(b)) return true;
    if (/\/admin\/(api\/[\w-]+\/)?(?!graphql)[\w/]+\.json/i.test(u)) return true;  // admin REST POST = create
    return false;
  };
  const block = (kind, method, url) => {
    window.__satBlocked.push({ kind, method, url: String(url).slice(0, 200), at: new Date().toISOString() });
    console.warn("[SAT READ-ONLY] blocked", kind, method, url);
    const n = document.getElementById("__sat_ro_count");
    if (n) n.textContent = String(window.__satBlocked.length);
  };
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const method = (init && init.method) || (input && input.method) || "GET";
    if (isWrite(method, url, init && init.body)) {
      block("fetch", method, url);
      return Promise.reject(new TypeError("support-agent read-only guard: write request blocked"));
    }
    return origFetch.apply(this, arguments);
  };
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    if (isWrite(this.__m, this.__u, body)) {
      block("xhr", this.__m, this.__u);
      setTimeout(() => { this.dispatchEvent(new ProgressEvent("error")); this.dispatchEvent(new ProgressEvent("loadend")); }, 0);
      return;
    }
    return XS.apply(this, arguments);
  };
  document.addEventListener("submit", (e) => {
    const f = e.target;
    if (f && window.__satAllowWrite !== true && String(f.method || "get").toLowerCase() !== "get") { e.preventDefault(); e.stopImmediatePropagation(); block("form", f.method, f.action); }
  }, true);
  const banner = () => {
    if (document.getElementById("__sat_ro")) return;
    const d = document.createElement("div");
    d.id = "__sat_ro";
    d.style.cssText = "position:fixed;z-index:2147483647;bottom:8px;left:8px;background:#c62828;color:#fff;font:600 12px/1.4 system-ui;padding:6px 10px;border-radius:6px;pointer-events:none;opacity:.92";
    d.innerHTML = 'READ-ONLY · support-agent · blocked: <span id="__sat_ro_count">0</span>';
    (document.body || document.documentElement).appendChild(d);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", banner); else banner();
})();
