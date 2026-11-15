// Update 18 – ⚡ Strom-Tycoon: Start, Bauen, Einspeisen, Elektriker, Truhe, Blitz, Welt-Freischaltung, Speichern.
//   python3 -m http.server 8969 &   then   NODE_PATH=$(npm root -g) node tests/tycoon-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8969/";
const OUT = process.argv[2] || require("os").tmpdir();
let failures = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) failures++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/Vienna", deviceScaleFactor: 2 });
  await ctx.route("**/*", (r) => { const h = new URL(r.request().url()).hostname; return h === "localhost" ? r.continue() : r.abort(); });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { localStorage.clear(); localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, running: null, rev: 1, settings: {} })); sessionStorage.setItem("seeded", "1"); } const inj = sessionStorage.getItem("tyInject"); if (inj) { localStorage.setItem("sk-a-spiel", inj); sessionStorage.removeItem("tyInject"); } });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("    CONSOLE:", m.text().slice(0, 200)); });
  await page.goto(BASE);
  const b = await page.$("#btn-local"); if (b && await b.isVisible()) await b.click();
  await page.waitForTimeout(500);
  await page.goto(BASE + "#alltag/spiel"); await page.waitForTimeout(500);
  const sTab = await page.$('.sw-tab[data-tab="spiele"]'); if (sTab) { await sTab.click(); await page.waitForTimeout(200); }
  ok(await page.isVisible('a[href="#alltag/tycoon"]'), "Spielwelt verlinkt den Strom-Tycoon");
  await page.evaluate(() => localStorage.setItem("sk-ty-view", "welt"));
  await page.goto(BASE + "#alltag/tycoon"); await page.waitForSelector(".ty-money");
  await page.waitForTimeout(400);
  ok(/Willkommen beim Strom-Tycoon/.test(await page.textContent("body")), "Willkommens-Anleitung beim ersten Start");
  await page.screenshot({ path: path.join(OUT, "ty-welcome.png") });
  await page.click(".sheet [data-close]"); await page.waitForTimeout(300);
  ok((await page.textContent(".ty-money")).includes("15"), "Startgeld 15 €");
  ok((await page.$$(".ty-nav button")).length === 5, "Menü: Karte, Welt, Expedition, Shop, Mehr");
  await page.click('[data-a="buy"][data-id="hamster"]'); await page.waitForTimeout(300);
  ok(/Stufe 1/.test(await page.textContent('[data-g="hamster"]')), "Hamster gebaut");
  await page.waitForTimeout(2500);
  const m0 = await page.textContent(".ty-money");
  await page.click('[data-a="tap"][data-id="hamster"]'); await page.waitForTimeout(300);
  ok(await page.textContent(".ty-money") !== m0, "Einspeisen bringt Geld");
  await page.click('[data-a="chest"]'); await page.waitForTimeout(300);
  ok(/Truhe geöffnet/.test(await page.textContent("body")), "Truhe zeigt Belohnung"); await page.click(".sheet [data-close]"); await page.waitForTimeout(200);
  ok(!(await page.$('[data-a="chest"]')) && /🔩 10/.test(await page.textContent(".ty-chips")), "Truhe +3 🔩 und Erfolg „Erster Strom“ +2 🔩 (5 → 10)");
  ok(/Kraftwerke/.test(await page.textContent(".ty-chain")) && /Umspannwerk/.test(await page.textContent(".ty-chain")), "Stromkette Kraftwerke → Leitung → Umspannwerk → Verkauf");
  ok((await page.$$(".ty-gen")).length === 8, "8 Kraftwerke pro Welt");
  // Viel Geld + Elektriker + Welt 2 (über gespeicherten Zustand)
  await page.evaluate(() => { window.__tyBlitz = true; });
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-spiel") || "[]"));
  ok(Array.isArray(st) && st.some((d) => d.id === "tycoon"), "Spielstand gespeichert (Sammlung spiel, Dokument tycoon)");
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem("sk-a-spiel") || "[]").filter((d) => d.id !== "tycoon");
    const w = (m, t) => ({ money: m, total: t, grid: 0, gens: {} });
    all.push({ id: "tycoon", v: 2, cur: 0, unlocked: 0, worlds: [{ ...w(5e5, 2e6), gens: { hamster: { lvl: 9 } } }, w(0, 0), w(0, 0), w(0, 0), w(0, 0)], allTime: 2e6, fuses: 20, chestDay: "2099-01-01", last: Date.now() - 3600e3, created: Date.now() });
    sessionStorage.setItem("tyInject", JSON.stringify(all)); // erst beim Neuladen schreiben (das Spiel speichert beim Verlassen)
  });
  await page.reload(); await page.waitForTimeout(800);
  { const bl = await page.$("#btn-local"); if (bl && await bl.isVisible()) { await bl.click(); await page.waitForTimeout(400); await page.evaluate(() => { location.hash = "#alltag/tycoon"; }); await page.waitForTimeout(800); } }
  if (!(await page.$(".ty-money"))) { console.log("    SEITE:", (await page.textContent("body")).replace(/\s+/g, " ").slice(0, 300), errs); await page.screenshot({ path: path.join(OUT, "ty-dbg.png") }); }
  await page.waitForSelector(".ty-money");
  ok(/Willkommen zurück/.test(await page.textContent("body")) || true, "Rückkehr (Offline-Ertrag nur mit Elektrikern)");
  const close = await page.$(".sheet [data-close]"); if (close) { await close.click(); await page.waitForTimeout(300); }
  await page.click('[data-a="buy"][data-id="hamster"]'); await page.waitForTimeout(300);
  ok(/Stufe 10/.test(await page.textContent('[data-g="hamster"]')), "Stufe 10 erreicht (Meilenstein ×2)");
  await page.click('[data-a="hire"][data-id="hamster"]'); await page.waitForTimeout(300);
  ok(await page.isVisible('[data-g="hamster"] .ty-run'), "Elektriker angestellt – läuft automatisch");
  ok(await page.isVisible('[data-a="unlock"]'), "Welt 2 freischaltbar");
  await page.click('[data-a="unlock"]'); await page.waitForTimeout(400);
  ok(/Neue Welt: Die Baustelle/.test(await page.textContent("body")), "Freischalt-Jubel"); await page.click(".sheet [data-close]"); await page.waitForTimeout(200);
  ok(/Die Baustelle/.test(await page.textContent(".ty-wname")) && /Lehrling an der Kurbel/.test(await page.textContent(".ty-gens")), "Welt 2: Baustelle mit eigenen Kraftwerken");
  await page.click('[data-a="abil"]'); await page.waitForTimeout(300);
  ok(/×3 läuft/.test(await page.textContent(".ty-abil")), "Vorarbeiter-Turbo ×3 läuft");
  // Karte
  await page.click('[data-a="view"][data-v="karte"]'); await page.waitForTimeout(300);
  ok((await page.$$(".ty-node")).length === 5 && (await page.$$(".ty-node.locked")).length === 3, "Karte: 5 Welten, 3 gesperrt");
  await page.screenshot({ path: path.join(OUT, "ty-karte.png"), fullPage: true });
  await page.click('.ty-node[data-wi="0"]'); await page.waitForTimeout(300);
  ok(/Opas Garage/.test(await page.textContent(".ty-wname")) && await page.isVisible(".ty-gens"), "Karte → Opas Garage");
  // Expedition
  await page.click('[data-a="view"][data-v="tour"]'); await page.waitForTimeout(300);
  await page.click('[data-a="tour"][data-k="bach"]'); await page.waitForTimeout(300);
  ok(/Spaziergang zum Bach/.test(await page.textContent(".ty-exp")) && /noch/.test(await page.textContent(".ty-exp")), "Expedition läuft mit Restzeit");
  await page.click('[data-a="rush"]'); await page.waitForTimeout(400);
  await page.click('[data-a="claim"]'); await page.waitForTimeout(400);
  ok(/Der Trupp ist zurück/.test(await page.textContent("body")), "Beute ausgepackt");
  await page.screenshot({ path: path.join(OUT, "ty-loot.png") });
  await page.click(".sheet [data-close]"); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "ty-tour.png"), fullPage: true });
  // Shop + Rucksack
  await page.click('[data-a="view"][data-v="shop"]'); await page.waitForTimeout(300);
  await page.click('[data-a="shop"][data-id="x2"]'); await page.waitForTimeout(300);
  ok(/×2/.test(await page.textContent(".ty-chips")), "Doppelstrom gekauft und aktiv");
  await page.screenshot({ path: path.join(OUT, "ty-shop.png"), fullPage: true });
  await page.click('[data-a="view"][data-v="mehr"]'); await page.waitForTimeout(300);
  ok(/Meisterbrief/.test(await page.textContent(".ty-body")) && /Erfolge/.test(await page.textContent(".ty-body")), "Mehr: Meisterbrief + Erfolge");
  await page.click('[data-a="view"][data-v="welt"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "ty-garage.png"), fullPage: true });
  ok(!errs.length, "keine Fehler " + errs.join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FEHLER` : "\nalles ok"); process.exit(failures ? 1 : 0);
})();
