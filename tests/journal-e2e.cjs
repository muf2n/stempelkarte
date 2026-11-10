// Playwright-Test Reisetagebuch (lokaler Modus, Port 8963).
//   cd <worktree> && python3 -m http.server 8963 &   then   node tests/privat-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Standort: navigator.geolocation wird per addInitScript ersetzt
// (window.__geoPush(lat, lng) schickt eine Probe an alle watchPosition-Beobachter), Zeit per page.clock.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8963/";
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
  const { ctx, page } = await open({ time: T(11, 10, 19), name: "journal" });
  // Reise direkt in die lokale Sammlung legen
  await page.evaluate(() => localStorage.setItem("sk-a-travel_trips", JSON.stringify([{ id: "t1", title: "Wien-Trip", dest: "Wien", emoji: "🎡", from: "2026-11-08", to: "2026-11-11", expenses: [], plan: [] }])));
  await page.evaluate(() => { location.hash = "#alltag/unterwegs"; });
  await page.waitForSelector('[data-uw="opentrip"]');
  await page.click('[data-uw="opentrip"]');
  await page.waitForSelector(".uw-journal");
  ok((await page.textContent(".uw-journal")).includes("Halte fest"), "Leeres Tagebuch mit Hinweis");
  await page.click('[data-jr="new"]');
  await page.waitForSelector("#jr-day");
  ok((await page.inputValue("#jr-day")) === "2026-11-10", "Datum: heute (während der Reise)");
  await page.click('[data-mood="🤩"]');
  await page.fill("#jr-title", "Prater");
  await page.fill("#jr-text", "Riesenrad gefahren und Langos gegessen.");
  // 1x1-PNG als Foto
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.setInputFiles("#jr-file", { name: "a.png", mimeType: "image/png", buffer: png });
  await page.waitForSelector('[data-r="ph"] .uw-jr-img', { timeout: 8000 });
  ok(true, "Foto hinzugefügt");
  await page.click("[data-save]");
  await page.waitForSelector(".uw-jr-e");
  await flush(page);
  const t = await page.textContent(".uw-jr-e");
  ok(t.includes("Tag 3") && t.includes("🤩") && t.includes("Prater") && t.includes("Langos"), "Eintrag mit Tag, Stimmung, Text");
  await page.waitForSelector(".uw-jr-e .uw-jr-img img", { timeout: 5000 });
  ok(true, "Foto-Vorschau im Tagebuch");
  // Foto liegt auch in der Galerie an dem Tag
  const inGal = await page.evaluate(async () => { const P = await import("./js/photos.js"); return (await P.listByDay("2026-11-10")).length; });
  ok(inGal === 1, "Foto ist auch in der Galerie");
  // bearbeiten
  await page.click('[data-jr="edit"]');
  await page.fill("#jr-title", "Prater 🎡");
  await page.click("[data-save]");
  await flush(page);
  ok((await page.textContent(".uw-jr-e")).includes("Prater 🎡"), "Bearbeiten klappt");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Kein horizontales Scrollen");
  await (await page.$(".uw-journal")).screenshot({ path: path.join(OUT, "journal-390.png") });
  // Zeitleiste
  await page.evaluate(() => { location.hash = "#alltag/zeitleiste"; });
  await page.waitForTimeout(400); await flush(page);
  ok((await page.textContent("body")).includes("Prater 🎡"), "Eintrag erscheint in der Zeitleiste");
  await ctx.close();
  await browser.close();
  if (errors.length) { console.log(errors.join("\n")); throw new Error("Konsolenfehler"); }
  console.log("Reisetagebuch: alles grün ✔");
})().catch((e) => { console.error(e); process.exit(1); });
