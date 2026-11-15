// Update 20 – 🧾 Steuer-Helfer: Lohnzettel, Pendeltage aus Einträgen, Werbungskosten aus Geld, Kennzahlen.
//   python3 -m http.server 8971 &   then   NODE_PATH=$(npm root -g) node tests/steuer-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8971/";
const OUT = process.argv[2] || require("os").tmpdir();
let failures = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) failures++; };
const T = (m, d) => new Date(2025, m, d, 7).getTime();
const entries = [];
for (let d = 1; d <= 12; d++) entries.push({ id: "j" + d, kind: "work", start: T(0, d + 1), end: T(0, d + 1) + 8 * 36e5, pauseMin: 30 });
for (let d = 1; d <= 9; d++) entries.push({ id: "f" + d, kind: "work", start: T(1, d + 2), end: T(1, d + 2) + 8 * 36e5, pauseMin: 30 });
for (let d = 1; d <= 5; d++) entries.push({ id: "s" + d, kind: "schule", start: T(2, d + 2), end: T(2, d + 2) });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route("**/*", (r) => (new URL(r.request().url()).hostname === "localhost" ? r.continue() : r.abort()));
  await ctx.addInitScript((E) => { if (sessionStorage.getItem("s")) return; sessionStorage.setItem("s", 1); localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: E, places: [], todos: [], days: {}, running: null, rev: 1, settings: {} }));
    localStorage.setItem("sk-a-money_tx", JSON.stringify([{ id: "t1", type: "out", date: "2025-04-02", category: "werkzeug", amount: 189.9, note: "Wera Schraubendreher-Set" }, { id: "t2", type: "out", date: "2025-05-02", category: "essen", amount: 30 }]));
    localStorage.setItem("sk-steuer-year", "2025"); }, entries);
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE); const bl = await page.$("#btn-local"); if (bl && await bl.isVisible()) await bl.click();
  await page.evaluate(() => { location.hash = "#alltag/steuer"; }); await page.waitForSelector(".st-result");
  ok(/\? €/.test(await page.textContent(".st-result")), "Ohne Lohnzettel: Hinweis");
  const days = await page.$$eval(".st-months [data-day]", (xs) => xs.map((x) => Number(x.value)));
  ok(days[0] === 12 && days[1] === 9 && days[2] === 0, "Pendeltage aus Einträgen (Jän 12, Feb 9, Berufsschule zählt nicht)");
  ok(/Wera/.test(await page.textContent(".st-tx")) && !/30,00/.test(await page.textContent(".st-tx")), "Werkzeug aus Geld übernommen");
  for (const [f, v] of [["kz245", "11.000,00"], ["sv", "1600"], ["lst", "0"], ["km", "25"]]) { await page.fill(`[data-f="${f}"]`, v); await page.press(`[data-f="${f}"]`, "Tab"); await page.waitForTimeout(150); }
  await page.click('[data-a="gross"][data-v="1"]'); await page.waitForTimeout(300);
  const res = await page.textContent(".st-result");
  ok(/Gutschrift/.test(res) && /880,00/.test(res), "Geschätzte Gutschrift 880 € (SV-Rückerstattung)");
  const kz = await page.textContent(".st-kz");
  ok(/KZ 718/.test(kz) && /205,00/.test(kz) && /6,94/.test(kz) && /KZ 916/.test(kz) && /KZ 719/.test(kz) && /189,90/.test(kz), "Kennzahlen 718 (Jän voll 123 + Feb ⅔ 82), 916 (2 € × 25 km × 1⅔/12), 719");
  await page.screenshot({ path: path.join(OUT, "steuer.png"), fullPage: true });
  ok(!errs.length, "keine Fehler " + errs.join(" | "));
  await browser.close(); console.log(failures ? `\n${failures} FEHLER` : "\nalles ok"); process.exit(failures ? 1 : 0);
})();
