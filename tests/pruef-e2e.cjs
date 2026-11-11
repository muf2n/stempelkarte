// Playwright-Test Prüfprotokoll (lokaler Modus, Port 8966).
//   cd <worktree> && python3 -m http.server 8966 &   then   node tests/privat-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Standort: navigator.geolocation wird per addInitScript ersetzt
// (window.__geoPush(lat, lng) schickt eine Probe an alle watchPosition-Beobachter), Zeit per page.clock.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8966/";
const OUT = process.argv[2] || require("os").tmpdir();

const BUERO = { lat: 47.0745, lng: 15.4010, addr: "Musterstraße 41, 8020 Musterstadt" };
const HOME = { lat: 47.1093, lng: 15.4118 };
const T = (m, d, h, mi = 0) => new Date(2026, m - 1, d, h, mi).getTime();

const GEO_INIT = () => {
  const G = window.__geo = { pos: null, cbs: new Map(), id: 0 };
  const mk = (p) => ({ coords: { latitude: p.lat, longitude: p.lng, accuracy: p.acc || 8, speed: null, altitude: null, heading: null, altitudeAccuracy: null }, timestamp: Date.now() });
  const fake = {
    getCurrentPosition(ok, err) { if (!G.pos) { if (err) setTimeout(() => err({ code: 2, message: "kein Standort" }), 5); return; } setTimeout(() => ok(mk(G.pos)), 5); },
    watchPosition(ok) { const id = ++G.id; G.cbs.set(id, ok); return id; },
    clearWatch(id) { G.cbs.delete(id); },
  };
  try { Object.defineProperty(Navigator.prototype, "geolocation", { configurable: true, get: () => fake }); } catch (e) { /* egal */ }
  window.__geoSet = (lat, lng) => { G.pos = { lat, lng, acc: 8 }; };
  window.__geoPush = (lat, lng) => { G.pos = { lat, lng, acc: 8 }; for (const cb of G.cbs.values()) cb(mk(G.pos)); return G.cbs.size; };
};

function seedData(extraSettings = {}) {
  const W = (d, h1, h2) => ({ id: "w" + d, kind: "work", start: T(11, d, h1), end: T(11, d, h2), pauseMin: 30, placeId: "p-buero", place: "Büro", note: "", people: [],
    inLoc: BUERO, outLoc: BUERO, segments: [{ start: T(11, d, h1), end: T(11, d, h2), activity: "Arbeiten", placeId: "p-buero", place: "Büro", loc: BUERO }] });
  return {
    entries: [W(2, 7, 16), W(3, 7, 15)], todos: [], days: {},
    places: [{ id: "p-buero", name: "Büro", addr: BUERO.addr, lat: BUERO.lat, lng: BUERO.lng, radius: 150 }],
    running: null, rev: 1,
    settings: { weeklyTarget: 38.5, workDays: [1, 2, 3, 4, 5], balanceStart: "2026-11-02", askNoteOnOut: false, ...extraSettings },
  };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };

  async function open({ time, colorScheme = "light", seed = seedData(), name = "", viewport = { width: 390, height: 844 } }) {
    const ctx = await browser.newContext({ viewport, colorScheme, timezoneId: "Europe/Vienna", locale: "de-AT", permissions: ["geolocation"] });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.addInitScript(GEO_INIT);
    await ctx.addInitScript((data) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.clear();
        localStorage.setItem("stempelkarte.local.v1", JSON.stringify(data));
        sessionStorage.setItem("seeded", "1");
      }
    }, seed);
    const page = await ctx.newPage();
    page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource|Firebase|firestore|gstatic/i.test(msg.text())) errors.push(name + ": " + msg.text()); });
    page.on("pageerror", (e) => errors.push(name + " pageerror: " + e.message));
    await page.clock.install({ time });
    await page.goto(BASE + "#heute");
    const b = await page.waitForSelector("#btn-local", { state: "visible", timeout: 8000 }).catch(() => null);
    if (b) await b.click();
    await page.waitForSelector('#view-heute [data-pm="privat"]', { state: "visible" });
    await page.clock.runFor(1500);
    return { ctx, page };
  }
  const data = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")));
  const flush = async (page) => { await page.clock.runFor(600); };
  const { ctx, page } = await open({ time: T(11, 11, 20), name: "pruef" });
  const sheet = (q) => page.waitForSelector(`.sheet ${q}`);
  const save = async () => { await page.click(".sheet [data-save]"); await flush(page); };
  await page.evaluate(() => { location.hash = "#alltag/pruefung"; });
  await page.waitForSelector(".pp-intro");
  await page.click('[data-x="limits"]'); await sheet(".pp-lim");
  ok((await page.textContent(".pp-lim")).includes("2,88 Ω"), "Grenzwert-Tabelle (B16 ≤ 2,88 Ω)");
  await page.keyboard.press("Escape"); await flush(page);
  await page.click('[data-x="new"]'); await sheet("#xf-kunde");
  await page.fill("#xf-kunde", "Fam. Huber"); await page.fill("#xf-adresse", "Bachweg 9, 8074 Raaba"); await page.fill("#xf-geraet", "Fluke 1664 FC"); await save();
  await page.waitForSelector(".pp");
  ok((await page.textContent(".pp")).includes("Fam. Huber"), "Protokoll angelegt und geöffnet");
  await page.click('[data-x="bulk"]'); await sheet("#xf-lines");
  await page.fill("#xf-lines", "1 Licht Küche B10 1,5\n2 Steckdosen Küche C16 2,5 FI30");
  await save();
  ok((await page.$$(".pp-c")).length === 2, "2 Stromkreise aus der Liste");
  // Messwerte Stromkreis 2 mit zu hohem Zs
  await (await page.$$(".pp-c"))[1].click(); await sheet("#xf-riso");
  await page.fill("#xf-riso", "200"); await page.fill("#xf-rpe", "0,3"); await page.fill("#xf-zs", "1,7"); await page.fill("#xf-rcdT", "24");
  await page.waitForTimeout(100);
  const live = await page.textContent(".sheet [data-live]");
  ok(/Schleifenimpedanz Zs: 1,7 Ω.*≤ 1,44 Ω/.test(live) && live.includes("❌"), "Live-Bewertung: Zs über Grenzwert");
  await save();
  ok((await page.$$(".pp-c.fehler")).length === 1, "Stromkreis als Mangel markiert");
  ok((await page.textContent(".pp .pp-st")).includes("Mangel"), "Gesamt: Mangel hat Vorrang vor offenen Messungen");
  ok((await page.textContent(".pp")).includes("⏳ 1"), "1 Stromkreis noch offen");
  await (await page.$$(".pp-c"))[0].click(); await sheet("#xf-riso");
  await page.fill("#xf-riso", "500"); await page.fill("#xf-rpe", "0,2"); await page.fill("#xf-zs", "0,9"); await save();
  ok((await page.textContent(".pp .pp-st")).includes("Mangel"), "Gesamt: Mangel");
  await page.click('[data-vis="schutzart"]'); await flush(page);
  ok((await page.textContent(".pp")).includes("1/10"), "Besichtigung abgehakt");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Kein horizontales Scrollen");
  await page.screenshot({ path: path.join(OUT, "pruef-390.png"), fullPage: true });
  // Druckansicht
  await page.evaluate(() => { window.print = () => { window.__printed = document.getElementById("pp-print") && document.getElementById("pp-print").textContent; }; });
  await page.click('[data-x="print"]'); await page.waitForTimeout(150);
  const pr = await page.evaluate(() => window.__printed || "");
  ok(pr.includes("Prüfprotokoll") && pr.includes("Steckdosen Küche") && pr.includes("MANGEL") && pr.includes("Fluke 1664 FC"), "Druckansicht mit Messtabelle");
  await page.click('[data-x="back"]'); await flush(page);
  ok((await page.textContent(".xu-list")).includes("Fam. Huber"), "Liste zeigt Protokoll");
  await ctx.close();
  await browser.close();
  if (errors.length) { console.log(errors.join("\n")); throw new Error("Konsolenfehler"); }
  console.log("Prüfprotokoll: alles grün ✔");
})().catch((e) => { console.error(e); process.exit(1); });
