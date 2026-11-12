// Update 17 – „Wie lange war ich wo?“: Heute-Karte, Zeile je Tag in Einträge, Balken in Übersicht (Woche/Monat).
//   python3 -m http.server 8968 &   then   NODE_PATH=$(npm root -g) node tests/dayline-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8968/";
const OUT = process.argv[2] || require("os").tmpdir();
const T = (d, h, mi = 0) => new Date(2026, 10, d, h, mi).getTime();
const SEED = {
  entries: [
    { id: "w1", kind: "work", start: T(10, 7), end: T(10, 16), pauseMin: 30, placeId: null, place: "Baustelle Jauk", note: "", inLoc: null, outLoc: null,
      segments: [{ start: T(10, 7), end: T(10, 7, 45), activity: "Autofahren", place: "Firma" }, { start: T(10, 7, 45), end: T(10, 16), activity: "Arbeiten", place: "Baustelle Jauk" }] },
    { id: "w2", kind: "work", start: T(12, 7), end: null, pauseMin: 0, placeId: "p1", place: "", note: "", inLoc: null, outLoc: null },
  ],
  places: [{ id: "p1", name: "Firma Huber" }], todos: [], days: {}, rev: 1,
  running: { id: "w2", kind: "work", start: T(12, 7), placeId: "p1", place: "", segments: [{ start: T(12, 7), activity: "Arbeiten", placeId: "p1" }] },
  settings: { workDays: [1, 2, 3, 4, 5], weeklyTarget: 38.5, holidays: true },
};
let failures = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) failures++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/Vienna" });
  await ctx.route("**/*", (r) => { const h = new URL(r.request().url()).hostname; return h === "localhost" ? r.continue() : r.abort(); });
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem("seeded")) { localStorage.clear(); localStorage.setItem("stempelkarte.local.v1", JSON.stringify(s)); sessionStorage.setItem("seeded", "1"); } }, SEED);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.clock.install({ time: new Date("2026-11-12T11:30:00") });
  await page.goto(BASE);
  const b = await page.$("#btn-local"); if (b && await b.isVisible()) await b.click();
  await page.waitForTimeout(800);
  const dl = await page.locator('[data-r="dayline"]').innerText().catch(() => "");
  ok(/Wo warst du heute/.test(dl), "Heute: Karte da");
  ok(/Firma Huber/.test(dl) && /4 h 30/.test(dl), "Heute: Firma Huber 4 h 30 (läuft)");
  await page.screenshot({ path: path.join(OUT, "dl-heute.png") });
  await page.goto(BASE + "#entries"); await page.waitForTimeout(700);
  const ek = await page.locator(".ek-dl").allInnerTexts();
  ok(ek.some((t) => /Baustelle Jauk/.test(t) && /7 h 45/.test(t) && /Fahrten/.test(t) && /45 min/.test(t)), "Einträge: Jauk 7 h 45 + Fahrten 45 min");
  await page.goto(BASE + "#overview"); await page.waitForTimeout(700);
  const wk = await page.locator("#ov-week-places").innerText(); console.log("    Woche:", wk.replace(/\n/g, " · "));
  ok(/Baustelle Jauk/.test(wk) && /Firma Huber/.test(wk), "Übersicht Woche: Balken je Ort");
  const mo = await page.locator("#ov-month-places").innerText();
  ok(/Baustelle Jauk/.test(mo) && /1 Tag/.test(mo), "Übersicht Monat: Balken je Ort mit Tagen");
  await page.screenshot({ path: path.join(OUT, "dl-overview.png"), fullPage: true });
  ok(!errs.length, "keine Fehler " + errs.join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FEHLER` : "\nalles ok"); process.exit(failures ? 1 : 0);
})();
