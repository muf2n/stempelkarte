// Update 10 E – gemeinsamer Playwright-Rahmen für die Akten-Tests (vertraege/inventar/kontakte/finanz-sim).
// Lokaler Modus, nur localhost erreichbar, Konsolenfehler/CSP-Verstöße werden gesammelt, /chat gestubbt.
const { chromium } = require("playwright");
const path = require("path");
const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
const shiftMonths = (k, n) => { const [y, m, d] = k.split("-").map(Number); const x = new Date(y, m - 1 + n, 1); const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(d, last)); return key(x); };

async function harness(BASE, OUT) {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  async function newPage(scheme = "light", width = 390, height = 844) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800, acceptDownloads: true });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (/Content Security Policy|Refused to/.test(t)) errors.push("CSP: " + t);
      else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
    return page;
  }
  async function boot(page, { store = {}, alltag = {}, extra = {} } = {}) {
    await page.goto(BASE);
    await page.evaluate(({ store, alltag, extra }) => {
      localStorage.clear();
      localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 }, ...store }));
      for (const [k, v] of Object.entries(alltag)) localStorage.setItem("sk-a-" + k, JSON.stringify(v));
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    }, { store, alltag, extra });
    await page.reload();
    await page.click("#btn-local");
    await page.waitForTimeout(300);
  }
  const shot = async (page, name) => { await page.waitForTimeout(350); return page.screenshot({ path: path.join(OUT, name), fullPage: true }); };
  const A = (page, n) => page.evaluate((n) => JSON.parse(localStorage.getItem("sk-a-" + n) || "[]"), n);
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  return { browser, errors, ok, newPage, boot, shot, A, noOverflow, sheet: ".sheet:last-child" };
}
module.exports = { harness, key, inDays, shiftMonths };
