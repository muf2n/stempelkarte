// Update 22 – Events: Tycoon-Event-Insel (alle 3 Wochen) + Schach-Wochen-Event (5 Bots, links leicht → rechts schwer).
//   python3 -m http.server 8973 &   then   NODE_PATH=$(npm root -g) node tests/events-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const OUT = process.argv[2] || require("os").tmpdir();
let failures = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) failures++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: "Europe/Vienna" });
  await ctx.route("**/*", (r) => (new URL(r.request().url()).hostname === "localhost" ? r.continue() : r.abort()));
  await ctx.addInitScript(() => { if (sessionStorage.getItem("s")) return; sessionStorage.setItem("s", 1); localStorage.clear(); localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, running: null, rev: 1, settings: {} })); localStorage.setItem("sk-ty-view", "karte"); });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.clock.install({ time: new Date("2026-11-17T18:00:00") }); // Event-Woche (ab Mo 16.11.)
  await p.goto("http://localhost:8973/"); const bl = await p.$("#btn-local"); if (bl && await bl.isVisible()) await bl.click();
  await p.evaluate(() => { location.hash = "#alltag/tycoon"; }); await p.waitForSelector(".ty-ocean");
  const c = await p.$(".sheet [data-close]"); if (c) await c.click(); await p.waitForTimeout(300);
  ok(await p.isVisible(".ty-evspot.on"), "Event-Insel auf der Karte");
  await p.click(".ty-evspot.on"); await p.waitForSelector(".ty-evhead");
  ok(/Event endet in 5 T/.test(await p.textContent(".ty-evhead")), "Countdown bis Sonntag");
  await p.click('[data-a="evbuy"]'); await p.waitForTimeout(300);
  ok(/Stufe 1/.test(await p.textContent(".ty-mine")), "Erstes Event-Kraftwerk gebaut");
  await p.locator(".ty-evhead").screenshot({ path: path.join(OUT, "ev-tycoon.png") });
  // Schach
  await p.evaluate(() => { location.hash = "#alltag/schach"; }); await p.waitForSelector(".sc-ev");
  const elos = await p.$$eval(".sc-evbot small", (xs) => xs.map((x) => Number(x.textContent)));
  ok(elos.length === 5 && elos.every((v, i) => !i || v >= elos[i - 1]), "Schach-Event: 5 Bots, aufsteigend " + elos.join("/"));
  ok(/💵 5/.test(await p.textContent(".sc-evbots")) && /💵 30/.test(await p.textContent(".sc-evbots")), "Belohnung 5 … 30 💵");
  await p.click(".sc-evbot >> nth=0"); await p.waitForTimeout(200);
  ok(/Event · 💵 5/.test(await p.textContent(".sc-pick")), "Event-Bot wählbar");
  await p.locator(".sc-ev").screenshot({ path: path.join(OUT, "ev-schach.png") });
  ok(!errs.length, "keine Fehler " + errs.join(" | "));
  await b.close(); console.log(failures ? `\n${failures} FEHLER` : "\nalles ok"); process.exit(failures ? 1 : 0);
})();
