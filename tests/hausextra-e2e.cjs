// Playwright-Test Haushalt › Müll & Vorrat (lokaler Modus, Port 8962).
//   cd <worktree> && python3 -m http.server 8962 &   then   node tests/privat-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Standort: navigator.geolocation wird per addInitScript ersetzt
// (window.__geoPush(lat, lng) schickt eine Probe an alle watchPosition-Beobachter), Zeit per page.clock.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8962/";
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
  const { ctx, page } = await open({ time: T(11, 10, 19), name: "hausextra" });
  await page.evaluate(() => { location.hash = "#alltag/haushalt/muell"; });
  await page.waitForSelector(".hx-empty");
  ok((await page.textContent(".hh-tab[aria-selected=true]")).includes("Müll"), "Direktlink öffnet den Müll-Tab");
  await page.click('.hx-empty [data-kind="rest"]');
  await page.waitForSelector("#hx-every");
  await page.selectOption("#hx-every", "2");
  await page.fill("#hx-start", "2026-11-11");
  await page.click("[data-save]");
  await page.waitForSelector(".hx-next");
  await flush(page);
  ok((await page.textContent(".hx-next")).includes("Morgen"), "Nächste Abholung: morgen");
  ok((await page.$$(".hx-days li")).length >= 3, "Termine der nächsten Wochen");
  // Termin verschieben
  await page.click(".hx-days .hx-pill");
  await page.fill("#hx-move", "2026-11-12");
  await page.click("[data-move]");
  await flush(page);
  ok((await page.textContent(".hx-next")).includes("In 2 Tagen"), "Termin verschoben auf Do");
  // Vorrat
  await page.click('.hh-tab[data-tab="vorrat"]');
  await page.waitForSelector(".hx-empty");
  await page.click('.hx-empty [data-hx="new"]');
  await page.fill("#hv-name", "Milch");
  await page.fill("#hv-qty", "2");
  await page.selectOption("#hv-unit", "l");
  await page.fill("#hv-min", "1");
  await page.fill("#hv-best", "2026-11-12");
  await page.click("[data-save]");
  await page.waitForSelector(".hx-stock");
  await flush(page);
  ok((await page.textContent(".hx-stock")).includes("MHD bald"), "MHD-Warnung");
  ok(!(await page.$('[data-hx="toshop"]')), "Noch nicht knapp");
  await page.click('[data-hx="minus"]');
  await flush(page);
  ok((await page.textContent(".hx-q")).trim() === "1 l", "Minus-Knopf: 1 l");
  ok((await page.textContent(".hx-stock")).includes("knapp"), "Jetzt knapp");
  await page.click('[data-hx="toshop"]');
  await flush(page);
  const shop = await page.evaluate(() => Object.keys(localStorage).filter((k) => /einkauf/.test(k)).map((k) => localStorage.getItem(k)).join(""));
  ok(/Milch/.test(shop), "Milch auf der Einkaufsliste");
  await page.click('[data-hx="toshop"]');
  await flush(page);
  const shop2 = await page.evaluate(() => Object.keys(localStorage).filter((k) => /einkauf/.test(k)).map((k) => localStorage.getItem(k)).join(""));
  ok((shop2.match(/Milch/g) || []).length === (shop.match(/Milch/g) || []).length, "Kein doppelter Eintrag");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Kein horizontales Scrollen");
  await page.screenshot({ path: path.join(OUT, "vorrat-390.png"), fullPage: true });
  await page.click('.hh-tab[data-tab="muell"]');
  await page.waitForSelector(".hx-next");
  await page.screenshot({ path: path.join(OUT, "muell-390.png"), fullPage: true });
  await page.click('.hh-tab[data-tab="putz"]');
  await flush(page);
  ok(!(await page.$(".hx")), "Zurück zum Putzplan räumt den Tab auf");
  // Mitteilung
  await page.click("#btn-notify, [data-open=notify], .hdr-bell").catch(() => {});
  await ctx.close();
  await browser.close();
  if (errors.length) { console.log(errors.join("\n")); throw new Error("Konsolenfehler"); }
  console.log("Müll & Vorrat: alles grün ✔");
})().catch((e) => { console.error(e); process.exit(1); });
