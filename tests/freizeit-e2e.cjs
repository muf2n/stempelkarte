// Playwright-Test Freizeit-Stempeluhr (lokaler Modus, Port 8890).
//   cd <worktree> && python3 -m http.server 8890 &   then   node tests/privat-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Standort: navigator.geolocation wird per addInitScript ersetzt
// (window.__geoPush(lat, lng) schickt eine Probe an alle watchPosition-Beobachter), Zeit per page.clock.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8890/";
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
  const fz = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-freizeit") || "[]"));
  const SHOTS = OUT;

  // Arbeit-Modus: Freizeit-Karte versteckt
  let { ctx, page } = await open({ time: T(11, 7, 10), name: "arbeit" });
  ok(await page.isHidden('[data-r="freizeit"]'), "Arbeit-Modus: Freizeit-Stempeluhr ausgeblendet");
  await ctx.close();

  // Privat-Modus: Chips sichtbar, starten, Uhr läuft, stoppen mit km
  ({ ctx, page } = await open({ time: T(11, 7, 10), name: "privat", seed: seedData({ mode: { privat: true, until: null, source: "manual" } }) }));
  await page.waitForSelector('[data-r="freizeit"] [data-start="rad"]', { state: "visible" });
  ok(await page.isVisible('[data-start="aufraeumen"]'), "Sport- und Zuhause-Chips sichtbar");
  await page.click('[data-start="rad"]');
  await page.waitForSelector('[data-fz="clock"]');
  await page.clock.runFor(42 * 60e3);
  ok((await page.textContent('[data-fz="clock"]')).startsWith("0:42"), "Uhr läuft (0:42)");
  let d = await data(page);
  ok(!d.running && d.entries.length === 2, "Keine Arbeitszeit erfasst");
  await page.screenshot({ path: path.join(SHOTS, "fz-run-390.png") });
  await page.click('[data-fz="stop"]');
  await page.fill("#fz-km", "12,5");
  await page.fill("#fz-note", "Murradweg");
  await page.click('[data-fz="stopform"] button[type="submit"]');
  await page.waitForSelector('[data-r="freizeit"] .fz-today');
  let f = await fz(page);
  ok(f.length === 1 && f[0].end && f[0].km === 12.5 && f[0].note === "Murradweg" && f[0].cat === "sport", "Gespeichert mit km und Notiz");
  ok((await page.textContent('[data-r="freizeit"] .fz-week')).includes("12,5 km"), "Wochenübersicht mit Strecke");

  // Eigene Aktivität (Zuhause), dann verwerfen
  await page.click('[data-fz="own"]');
  await page.fill("#fz-own", "Auto putzen");
  await page.selectOption("#fz-owncat", "zuhause");
  await page.click('[data-fz="ownform"] button[type="submit"]');
  await page.waitForSelector('[data-fz="clock"]');
  ok((await page.textContent('[data-r="freizeit"] .fz-run')).includes("Auto putzen"), "Eigene Aktivität läuft");
  await page.click('[data-fz="cancel"]');
  await page.click('[data-fz="cancel"]');
  await page.waitForSelector('[data-start="rad"]');
  f = await fz(page);
  ok(f.length === 1, "Verwerfen (zweistufig) entfernt die laufende Aktivität");

  // Löschen zweistufig
  await page.click(".fz-del");
  await page.click(".fz-del");
  await page.waitForFunction(() => !document.querySelector(".fz-today"));
  ok((await fz(page)).length === 0, "Eintrag gelöscht");
  await page.screenshot({ path: path.join(SHOTS, "fz-idle-390.png"), fullPage: false });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(sw, "Kein horizontales Scrollen bei 390 px");
  await ctx.close();

  // Dunkel
  ({ ctx, page } = await open({ time: T(11, 7, 18), colorScheme: "dark", name: "dunkel", seed: seedData({ mode: { privat: true, until: null, source: "manual" } }) }));
  await page.waitForSelector('[data-start="rad"]', { state: "visible" });
  await page.locator('[data-r="freizeit"]').screenshot({ path: path.join(SHOTS, "fz-dark-390.png") });
  await ctx.close();

  await browser.close();
  if (errors.length) { console.log(errors.join("\n")); throw new Error("Konsolenfehler"); }
  console.log("Freizeit: alles grün ✔");
})().catch((e) => { console.error(e); process.exit(1); });
