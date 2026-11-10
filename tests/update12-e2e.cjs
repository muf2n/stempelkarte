// Playwright-Test Update 12: Kochen, Karriere, Leben, Spiel, Tiere, Kleider, Gruppen, Wohnen (Port 8965).
//   cd <worktree> && python3 -m http.server 8965 &   then   node tests/privat-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Standort: navigator.geolocation wird per addInitScript ersetzt
// (window.__geoPush(lat, lng) schickt eine Probe an alle watchPosition-Beobachter), Zeit per page.clock.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8965/";
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
  const { ctx, page } = await open({ time: T(11, 10, 19), name: "u12" });
  const go = async (h, sel) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForSelector(sel, { timeout: 8000 }); await flush(page); };
  const noScroll = async (n) => ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), n + ": kein horizontales Scrollen");
  const shot = (n) => page.screenshot({ path: path.join(OUT, `u12-${n}.png`), fullPage: true });
  const sheet = (q) => page.waitForSelector(`.sheet ${q}`);
  const save = async () => { await page.click(".sheet [data-save]"); await flush(page); };

  // 🍳 Kochen: Rezept importieren, Portionen, Timer, Plan, Einkaufsliste
  await go("#alltag/kochen", ".kc");
  await page.click('[data-kc="import"]');
  await sheet("#kc-paste");
  await page.fill("#kc-paste", "Spaghetti Bolognese\nFür 2 Portionen\nZutaten\n250 g Spaghetti\n300 g Faschiertes\n1 Zwiebel\nSalz\nZubereitung\n1. Zwiebel anbraten\n2. Sauce 20 Minuten köcheln");
  await page.click(".sheet [data-go]");
  await sheet("#kc-title");
  ok((await page.inputValue("#kc-title")) === "Spaghetti Bolognese", "Import füllt das Rezept");
  await save();
  await page.waitForSelector(".kc-detail");
  ok((await page.textContent(".kc-ings")).includes("250 g Spaghetti"), "Zutaten angezeigt");
  await page.click('[data-sv="1"]'); await page.click('[data-sv="1"]');
  ok((await page.textContent(".kc-ings")).includes("500 g Spaghetti"), "Portionen 2 → 4 rechnet um");
  await page.click("[data-timer]");
  await page.waitForSelector(".kc-tm");
  ok((await page.textContent(".kc-tm")).includes("20:00"), "Koch-Timer aus „20 Minuten“");
  await page.click("[data-tstop]");
  await page.click('[data-kc="toshop"]'); await flush(page);
  ok(/Faschiertes/.test(await page.evaluate(() => localStorage.getItem("sk-a-einkauf") || "")), "Zutaten auf der Einkaufsliste (ohne Salz)");
  ok(!/"Salz"/.test(await page.evaluate(() => localStorage.getItem("sk-a-einkauf") || "")), "Salz nicht auf der Liste");
  await noScroll("Kochen"); await shot("kochen");
  await page.click('[data-kc="back"]');
  await page.click('[data-tab="plan"]');
  await page.click('.kc-meal[data-meal="mittag"]');
  await sheet("#km-rec");
  await page.selectOption("#km-rec", { index: 1 });
  await save();
  ok((await page.textContent(".kc-plan")).includes("Spaghetti"), "Essensplan: Rezept eingeplant");

  // 💼 Karriere
  await go("#alltag/karriere", ".kr2");
  await page.click('[data-tab="certs"]');
  await page.click('[data-kr="cert"]'); await sheet("#f-title");
  await page.fill("#f-title", "Erste-Hilfe-Kurs"); await page.fill("#f-exp", "2026-12-01"); await save();
  ok((await page.textContent(".kr2-list")).includes("läuft bald ab"), "Zertifikat mit Ablauf-Warnung");
  await page.click('[data-tab="jobs"]');
  await page.click('[data-kr="job"]'); await sheet("#f-co");
  await page.fill("#f-co", "Elektro Muster"); await page.click('.sheet [data-prep="0"]'); await save();
  ok((await page.textContent(".kr2-pipe")).includes("1"), "Bewerbung in der Übersicht");
  await page.click('[data-tab="cv"]');
  await page.click('[data-kr="station"]'); await sheet("#f-title");
  await page.fill("#f-title", "Polytechnische Schule"); await page.selectOption("#f-kind", "schule"); await page.fill("#f-from", "2023-09"); await page.fill("#f-to", "2024-06"); await save();
  ok((await page.textContent(".kr2-cv")).includes("Polytechnische"), "Lebenslauf-Station");
  await noScroll("Karriere"); await shot("karriere");

  // 📊 Mein Leben: Freigabe, Statistik, Jahresrückblick
  await go("#alltag/leben", ".lb");
  await page.click('[data-tab="twin"]');
  await page.waitForSelector(".lb-consent");
  ok(true, "Digital Twin fragt zuerst nach Freigabe");
  await page.click('[data-lb="allareas"]'); await page.click('[data-lb="consent"]'); await flush(page);
  await page.waitForSelector(".lb-areas");
  ok((await page.$$(".lb-areas li")).length === 7, "Twin zeigt 7 freigegebene Bereiche");
  await page.click('[data-tab="stats"]'); await page.waitForSelector(".lb-chart");
  ok((await page.textContent(".lb-tbl")).includes("Arbeit"), "Statistik-Tabelle");
  await page.click('[data-kind="year"]'); await flush(page);
  await page.click('[data-tab="jahr"]'); await page.waitForSelector(".lb-hero");
  ok((await page.textContent(".lb")).includes("gearbeitet"), "Jahresrückblick mit Arbeitsstunden");
  await noScroll("Leben"); await shot("leben");

  // 🎮 Spielwelt
  await go("#alltag/spiel", ".sw-head");
  ok((await page.textContent(".sw-head")).includes("Level"), "Level angezeigt");
  await page.click('[data-tab="quests"]');
  ok((await page.$$(".sw-q li")).length === 6, "3 Tages- + 3 Wochenquests");
  await page.click('[data-sw="pet"]'); await flush(page);
  ok((await page.textContent(".sw-pet")).includes("gefüttert"), "Haustier gefüttert");
  await page.click('[data-tab="spiele"]');
  await page.click('[data-sw="challenge"]');
  ok(!(await page.textContent(".sw-body")).includes("Tipp auf den Knopf"), "Zufalls-Challenge");
  await page.click('[data-sw="ohm"]'); await page.waitForSelector("#sw-ohm");
  ok(true, "Ohm-Blitz startet");
  await page.click('[data-tab="erfolge"]');
  ok((await page.textContent(".sw-ach")).includes("???"), "Geheime Erfolge versteckt");
  await noScroll("Spielwelt"); await shot("spiel");

  // 🐾 Haustiere
  await go("#alltag/tiere", ".xu");
  await page.click('[data-x="new"]'); await sheet("#xf-name");
  await page.fill("#xf-name", "Bello"); await page.selectOption("#xf-art", "hund"); await save();
  await page.waitForSelector(".xu-hero");
  ok((await page.textContent(".xu-hero")).includes("Bello"), "Tierprofil angelegt");
  ok((await page.textContent(".xu")).includes("Krallen schneiden"), "Pflege-Vorlagen für Hunde");
  await page.click('[data-add="meds"]'); await sheet("#xf-name");
  await page.fill("#xf-name", "Wurmkur"); await page.fill("#xf-times", "8:00"); await save();
  ok((await page.textContent(".xu")).includes("Wurmkur"), "Medikament mit Uhrzeit");
  await noScroll("Tiere"); await shot("tiere");

  // 👕 Kleiderschrank
  await go("#alltag/kleider", ".xu");
  for (const [n, cat] of [["Hoodie schwarz", "pulli"], ["Jeans", "hose"]]) {
    await page.click('[data-x="new"]'); await sheet("#xf-name");
    await page.fill("#xf-name", n); await page.selectOption("#xf-cat", cat); await save();
  }
  ok((await page.$$(".xu-grid .xu-tile")).length === 2, "2 Teile im Schrank");
  await page.click('[data-tab="outfits"]');
  await page.click('[data-x="newoutfit"]'); await sheet("[data-pick]");
  await page.click('.sheet [data-pick] [data-pid]'); await page.fill("#xf-name", "Chillig"); await save();
  ok((await page.textContent(".xu-list")).includes("Chillig"), "Outfit gespeichert");
  await page.click('[data-tab="packen"]');
  ok((await page.textContent(".xu-check")).includes("Unterwäsche"), "Packassistent");
  await noScroll("Kleider"); await shot("kleider");

  // 👥 Gruppen
  await go("#alltag/gruppen", ".xu");
  await page.click('[data-x="new"]'); await sheet("#xf-name");
  await page.fill("#xf-name", "WG"); await page.fill("#xf-people", "Anna\nBen"); await save();
  await page.waitForSelector(".xu-hero");
  await page.click('[data-tab="kosten"]');
  await page.click('[data-add="expense"]'); await sheet("#xf-amount");
  await page.fill("#xf-what", "Pizza"); await page.fill("#xf-amount", "30"); await save();
  ok(/Anna → Du: 10,00\s€/.test(await page.textContent(".xu")), "Kosten aufgeteilt: Anna schuldet 10 €");
  await page.click('[data-tab="aufgaben"]');
  await page.fill("#gt-text", "Getränke"); await page.click('[data-f="task"] button[type=submit]'); await flush(page);
  ok((await page.textContent(".xu-check")).includes("Getränke"), "Gruppen-Aufgabe");
  await noScroll("Gruppen"); await shot("gruppen");

  // 🏠 Wohnen
  await go("#alltag/wohnen", ".xu");
  await page.click('[data-tab="orte"]');
  await page.click('[data-add="ort"]'); await sheet("#xf-what");
  await page.fill("#xf-what", "Reisepass"); await page.fill("#xf-where", "Schreibtisch, 2. Lade"); await save();
  await page.fill("#wo-q", "pass"); await flush(page);
  ok((await page.textContent("[data-list]")).includes("Schreibtisch"), "Wo liegt was: gefunden");
  await page.click('[data-tab="umzug"]'); await page.fill("#mv-date", "2026-12-01"); await page.click('[data-x="movestart"]'); await flush(page);
  ok((await page.textContent(".xu-check")).includes("Meldezettel"), "Umzugs-Checkliste");
  await page.click('[data-tab="kosten"]'); await page.click('[data-preset="Strom"]'); await sheet("#xf-amount");
  await page.fill("#xf-amount", "150"); await page.selectOption("#xf-every", "3"); await save();
  ok(/50,00\s€/.test(await page.textContent(".xu-kpis")), "Nebenkosten pro Monat");
  await noScroll("Wohnen"); await shot("wohnen");

  // Alltag-Kacheln + Suche
  await go("#alltag", ".al-home");
  const tiles = await page.textContent(".al-home");
  ok(["Kochen", "Karriere", "Mein Leben", "Spielwelt", "Haustiere", "Kleiderschrank", "Gruppen", "Wohnen"].every((t) => tiles.includes(t)), "Alle 8 neuen Kacheln da");
  await page.click("#btn-search"); await page.fill("#srch-q", "Reisepass"); await page.waitForTimeout(200);
  ok(await page.$('.srch-group[data-group="wohnen"]') != null, "Suche findet „Wo liegt was“");
  await ctx.close();
  await browser.close();
  if (errors.length) { console.log(errors.join("\n")); throw new Error("Konsolenfehler"); }
  console.log("Update 12: alles grün ✔");
})().catch((e) => { console.error(e); process.exit(1); });
