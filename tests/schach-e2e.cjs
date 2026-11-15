// Update 19 – ♟️ Schach: Bot wählen, Partie (Zug + Bot-Antwort über Worker), Tipp, Aufgeben, Verlauf, Rätsel.
//   python3 -m http.server 8970 &   then   NODE_PATH=$(npm root -g) node tests/schach-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8970/";
const OUT = process.argv[2] || require("os").tmpdir();
let failures = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) failures++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route("**/*", (r) => (new URL(r.request().url()).hostname === "localhost" ? r.continue() : r.abort()));
  await ctx.addInitScript(() => { if (sessionStorage.getItem("s")) return; sessionStorage.setItem("s", 1); localStorage.clear(); localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, running: null, rev: 1, settings: {} })); });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE); const bl = await page.$("#btn-local"); if (bl && await bl.isVisible()) await bl.click();
  await page.evaluate(() => { location.hash = "#alltag/schach"; }); await page.waitForSelector(".sc-bots");
  ok((await page.$$(".sc-bot")).length === 10, "10 Bots in Kategorien");
  await page.click('.sc-bot[data-v="hugo"]'); await page.waitForTimeout(200);
  ok(/Hamster Hugo/.test(await page.textContent(".sc-pick")) && /Quiek/.test(await page.textContent(".sc-bubble")), "Bot gewählt, Sprechblase");
  await page.click('[data-a="tcopen"]'); await page.waitForTimeout(150);
  ok((await page.$$(".sc-tcg button")).length === 13, "13 Bedenkzeiten (Ohne Uhr, Bullet, Blitz, Schnellschach)");
  await page.click('[data-a="tc"][data-v="5"]'); await page.waitForTimeout(200);
  await page.click('[data-a="color"][data-v="w"]'); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, "sc-bots.png"), fullPage: true });
  await page.click('[data-a="play"]'); await page.waitForSelector(".sc-board");
  ok((await page.$$(".sc-board .sq")).length === 64 && (await page.$$(".sc-board .pc")).length === 32, "Brett mit 32 Figuren");
  ok(/5:00/.test(await page.textContent(".sc-pl.me")), "Uhr 5:00");
  await page.click('[data-sq="e2"]'); await page.waitForTimeout(100);
  ok((await page.$$(".sq i.dot")).length === 2, "e2: 2 Zielfelder markiert");
  await page.click('[data-sq="e4"]');
  await page.waitForFunction(() => document.querySelectorAll(".sc-moves span").length >= 1 && /1\. e4 \S+/.test(document.querySelector(".sc-moves").textContent), null, { timeout: 8000 });
  ok(true, "Zug e4 + Antwort vom Bot (Worker)");
  await page.click('[data-a="hint"]'); await page.waitForTimeout(1600);
  ok((await page.$$(".sq.hint")).length === 2, "Tipp markiert einen Zug");
  await page.screenshot({ path: path.join(OUT, "sc-game.png") });
  await page.reload(); const bl2 = await page.$("#btn-local"); if (bl2 && await bl2.isVisible()) await bl2.click();
  await page.evaluate(() => { location.hash = "#alltag/schach"; }); await page.waitForSelector(".sc");
  ok(await page.isVisible('[data-a="resume"]'), "Laufende Partie bleibt gespeichert");
  await page.click('[data-a="resume"]'); await page.waitForSelector(".sc-board");
  await page.click('[data-a="resign"]'); await page.click(".sheet [data-yes]"); await page.waitForTimeout(300);
  ok(/Verloren/.test(await page.textContent(".sc-over")) && /Elo/.test(await page.textContent(".sc-over")), "Aufgeben → Verloren mit Elo-Änderung");
  await page.click('[data-a="home"]'); await page.click('[data-a="tab"][data-v="partien"]'); await page.waitForTimeout(200);
  ok(/Niederlage/.test(await page.textContent(".sc-hist")), "Partie im Verlauf");
  await page.click(".sc-hist button"); await page.click('[data-a="rv"][data-v="999"]'); await page.waitForTimeout(150);
  ok(/2\/2/.test(await page.textContent(".sc-pzbar")), "Partie nachspielen");
  await page.click('[data-a="home"]'); await page.click('[data-a="tab"][data-v="taktik"]'); await page.waitForTimeout(200);
  await page.click('[data-a="daily"]'); await page.waitForTimeout(1200);
  const p = await page.evaluate(async () => (await import("./js/alltag/schach-puzzles.js")).PUZZLES);
  const ids = p.map((x) => x.id);
  // tägliches Rätsel lösen (Lösung aus der Datei)
  const pid = Number((await page.textContent(".sc-game .note")).match(/Aufgabe (\d+)/)[1]); const P = p.find((x) => x.id === pid);
  for (let k = 0; k < P.sol.length; k += 2) { const u = P.sol[k]; await page.click(`[data-sq="${u.slice(0, 2)}"]`); await page.click(`[data-sq="${u.slice(2, 4)}"]`); await page.waitForTimeout(900); if (u[4]) { await page.click(`.sheet [data-p="${u[4]}"]`); await page.waitForTimeout(700); } }
  ok(/Richtig/.test(await page.textContent(".sc-say")), "Tägliches Rätsel gelöst (" + ids.length + " Aufgaben)");
  await page.screenshot({ path: path.join(OUT, "sc-puzzle.png") });
  ok(!errs.length, "keine Fehler " + errs.join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FEHLER` : "\nalles ok"); process.exit(failures ? 1 : 0);
})();
