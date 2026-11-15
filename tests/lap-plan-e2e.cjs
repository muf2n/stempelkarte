// Update 21 – 🎓 LAP-Countdown: Termin eintragen → Lernplan mit Tagesration, Themen-Sicherheit, Plan übernehmen.
//   python3 -m http.server 8972 &   then   NODE_PATH=$(npm root -g) node tests/lap-plan-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const OUT = process.argv[2] || require("os").tmpdir();
let failures = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) failures++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route("**/*", (r) => (new URL(r.request().url()).hostname === "localhost" ? r.continue() : r.abort()));
  await ctx.addInitScript(() => { if (sessionStorage.getItem("s")) return; sessionStorage.setItem("s", 1); localStorage.clear(); localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, running: null, rev: 1, settings: {} })); });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8972/"); const bl = await p.$("#btn-local"); if (bl && await bl.isVisible()) await bl.click();
  await p.evaluate(() => { location.hash = "#alltag/lap"; }); await p.waitForSelector(".lap-plan-set");
  ok(true, "Knopf „LAP-Termin eintragen“");
  await p.click(".lap-plan-set"); const d = new Date(Date.now() + 90 * 864e5); const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await p.fill("#lap-ed", v); await p.click(".sheet [data-save]"); await p.waitForSelector(".lap-plan-card");
  const t = await p.textContent(".lap-plan-card");
  ok(/LAP in 90 Tagen/.test(t) && /neue Karten/.test(t) && /Sicherheit je Thema/.test(t), "Countdown 90 Tage + Tagesration + Themen");
  await p.click('[data-plan="apply"]'); await p.waitForTimeout(300);
  ok(!(await p.$('[data-plan="apply"]')), "Plan übernommen (Tagesziel gesetzt)");
  await p.evaluate(() => document.querySelector(".lap-plan-topics").open = true);
  await p.locator(".lap-plan-card").screenshot({ path: path.join(OUT, "lap-plan.png") });
  ok(!errs.length, "keine Fehler " + errs.join(" | "));
  await b.close(); console.log(failures ? `\n${failures} FEHLER` : "\nalles ok"); process.exit(failures ? 1 : 0);
})();
