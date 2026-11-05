// Playwright-Test Privat / Arbeit (lokaler Modus, Port 8863).
//   cd <worktree> && python3 -m http.server 8863 &   then   node tests/privat-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Standort: navigator.geolocation wird per addInitScript ersetzt
// (window.__geoPush(lat, lng) schickt eine Probe an alle watchPosition-Beobachter), Zeit per page.clock.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8863/";
const OUT = process.argv[2] || require("os").tmpdir();

const BUERO = { lat: 47.0745, lng: 15.4010, addr: "Puchstraße 41, 8020 Graz" };
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
  const shot = async (page, name, full = false) => { await page.clock.runFor(300); await page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const closeSheets = async (page) => { for (let i = 0; i < 4 && await page.$(".sheet"); i++) { await page.keyboard.press("Escape"); await page.clock.runFor(250); } };
  const saldo = async (page) => {
    await page.evaluate(() => { location.hash = "#uebersicht"; });
    await page.clock.runFor(800);
    const t = await page.$eval("#ov-saldo", (e) => e.textContent.trim() + " / " + document.getElementById("ov-bal-week").textContent.trim());
    await page.evaluate(() => { location.hash = "#heute"; });
    await page.clock.runFor(500);
    return t;
  };

  /* =============== 1) Mi 04.11.2026 10:00 – Umschalten, Rückfrage, Fahrt, Fotos =============== */
  const { ctx, page } = await open({ time: T(11, 4, 10, 0), name: "werktag" });
  ok(await page.getAttribute('[data-pm="arbeit"]', "aria-checked") === "true", "Start: Arbeit aktiv");
  ok(await page.isHidden('[data-pm-r="banner"]'), "kein Privat-Banner");
  const saldo0 = await saldo(page);
  ok(/[+−-]?\d+:\d\d/.test(saldo0), `Überstundenkonto vorher ${saldo0}`);
  await shot(page, "privat-390-light-arbeit.png");

  // Privat einschalten (nicht eingestempelt)
  await page.click('[data-pm="privat"]');
  await flush(page);
  ok(await page.getAttribute('[data-pm="privat"]', "aria-checked") === "true", "Privat aktiv");
  ok(await page.isVisible('[data-pm-r="banner"]'), "Banner sichtbar");
  ok((await page.textContent('[data-pm-r="banner"]')).includes("Privat-Modus – nichts zählt als Arbeit"), "Banner-Text");
  ok(await page.evaluate(() => document.body.classList.contains("is-privat")), "body.is-privat (Akzent)");
  ok((await page.textContent('#view-heute [data-r="pill"]')).includes("Privat-Modus"), "Uhr-Pille „Privat-Modus“");
  ok(await page.isHidden('#view-heute [data-r="pre"]'), "Tätigkeit/Ort/Notiz ausgeblendet");
  let d = await data(page);
  ok(d.settings.mode.privat === true && d.settings.mode.until === null && d.settings.mode.source === "manual", "settings.mode gespeichert (bis ich es ausschalte)");
  ok(await page.getAttribute('[data-pmu="aus"]', "aria-pressed") === "true", "Pille „bis ich es ausschalte“ gedrückt");
  ok(d.settings.weeklyTarget === 38.5 && d.settings.balanceStart === "2026-11-02", "übrige Einstellungen erhalten");
  await shot(page, "privat-390-light-privat.png");

  // Zurück zu Arbeit am Arbeitsort → „Jetzt einstempeln“
  await page.evaluate(({ lat, lng }) => window.__geoSet(lat, lng), BUERO);
  await page.click('[data-pm="arbeit"]');
  await page.waitForSelector('.sheet [data-r="pm-in"]', { state: "visible" });
  ok((await page.textContent(".sheet")).includes("Büro"), "Angebot „Jetzt einstempeln“ bei Büro");
  await page.click('.sheet [data-r="pm-in"]');
  await page.clock.runFor(1500);
  d = await data(page);
  ok(d.running && d.running.placeId === "p-buero", "eingestempelt bei Büro");
  ok(d.settings.mode.privat === false, "Modus Arbeit");

  // Eingestempelt → Privat: Rückfrage, Abbrechen
  await page.clock.runFor(20 * 60000);
  await page.click('[data-pm="privat"]');
  await page.waitForSelector('.sheet [data-r="pm-out"]', { state: "visible" });
  ok((await page.textContent(".sheet h2")).includes("Ausstempeln und Privat starten?"), "Rückfrage „Ausstempeln und Privat starten?“");
  await page.click('.sheet [data-r="pm-no"]');
  await flush(page);
  d = await data(page);
  ok(d.running && !(d.settings.mode && d.settings.mode.privat), "Abbrechen: weiter eingestempelt, kein Privat");
  await page.click('[data-pm="privat"]');
  await page.waitForSelector('.sheet [data-r="pm-out"]', { state: "visible" });
  await shot(page, "privat-390-light-confirm.png");
  await page.click('.sheet [data-r="pm-out"]');
  await page.clock.runFor(1500);
  await closeSheets(page);
  d = await data(page);
  ok(!d.running && d.entries.length === 3 && d.settings.mode.privat === true, "Ausstempeln jetzt → Eintrag gespeichert, Privat an");
  const saldo1 = await saldo(page);

  // Simulierte Fahrt im Privat-Modus: Büro → Wiener Straße (≈ 4 km, ~50 km/h), dann Stillstand
  await page.evaluate(({ lat, lng }) => window.__geoSet(lat, lng), BUERO);
  await page.clock.runFor(3000);
  let watchers = await page.evaluate(() => window.__geo.cbs.size);
  ok(watchers >= 1, "Standort wird im Privat-Modus beobachtet (Fahrerkennung)");
  const N = 56;
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    await page.evaluate(([la, ln]) => window.__geoPush(la, ln), [BUERO.lat + (HOME.lat - BUERO.lat) * f, BUERO.lng + (HOME.lng - BUERO.lng) * f]);
    await page.clock.runFor(5000);
    if (i === 15) await shot(page, "privat-390-light-fahrt.png");
  }
  for (let i = 0; i < 24; i++) { await page.evaluate(([la, ln]) => window.__geoPush(la, ln), [HOME.lat, HOME.lng]); await page.clock.runFor(10000); }
  await page.clock.runFor(1500);
  d = await data(page);
  const pt = d.entries.find((e) => e.privateTrip);
  ok(pt && pt.tripOnly && pt.segments.length === 1 && pt.segments[0].private === true && pt.segments[0].activity === "Autofahren", "Privatfahrt als eigener tripOnly-Eintrag (private, Autofahren)");
  const durMin = Math.round((pt.end - pt.start) / 60000);
  ok(durMin >= 3 && durMin <= 7, `Dauer ${durMin} min (Start bis Ankunft)`);
  ok(await page.evaluate((e) => import("/js/util.js").then((u) => u.netMin(e)), pt) === 0, "netMin = 0 h");
  const saldo2 = await saldo(page);
  ok(saldo2 === saldo1, `Überstundenkonto unverändert (${saldo1} → ${saldo2})`);
  const todayRows = await page.$$eval("#view-heute .entry.ek-priv", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  ok(todayRows.length === 1 && todayRows[0].includes("🏠 Privat") && todayRows[0].includes("privat"), `Heute: gedämpfte Zeile „${todayRows[0]}“`);
  ok((await page.textContent('#view-heute [data-r="s-day"]')).trim() === "0:20", "Heute-Summe nur die 20 min Arbeit (Privatfahrt zählt nicht)");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(page, "privat-390-light-heute-liste.png");
  await page.evaluate(() => window.scrollTo(0, 0));

  // Einträge (Kalender-Liste): gedämpft, nicht in der Tagessumme
  await page.evaluate(() => { location.hash = "#eintraege"; });
  await page.clock.runFor(800);
  const er = await page.$$eval("#view-eintraege .entry.ek-priv", (els) => els.length);
  ok(er >= 1, "Einträge: Privatfahrt gedämpft mit 🏠-Chip");

  // Fahrtenbuch: privat, kein Kilometergeld, Filter
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.clock.runFor(600);
  await page.click('#trips-panel [data-tg-open="log"]');
  await page.waitForSelector("#fb-root .fb-list", { state: "visible" });
  await page.clock.runFor(600);
  const rows = await page.$$eval(".fb-row", (els) => els.map((r) => ({ priv: r.classList.contains("is-priv"), l2: r.querySelector(".fb-l2").textContent })));
  ok(rows.length === 1 && rows[0].priv && rows[0].l2.includes("privat"), "Fahrtenbuch: Fahrt als privat");
  ok(/privat\s*[\d,]+ km/.test(await page.textContent(".fb-split-l")) && /beruflich\s*0,0 km/.test(await page.textContent(".fb-split-l")), "Monatskopf: privat km, beruflich 0");
  await page.click('[data-fbart="biz"]'); await page.clock.runFor(300);
  ok((await page.$$(".fb-row")).length === 0, "Filter „nur beruflich“: keine Fahrt");
  await page.click('[data-fbart="priv"]'); await page.clock.runFor(300);
  ok((await page.$$(".fb-row")).length === 1, "Filter „nur privat“: 1 Fahrt");
  await shot(page, "privat-390-light-fahrtenbuch.png");
  await page.click('[data-fbart="all"]'); await page.clock.runFor(200);
  await page.click('[data-fb="close"]'); await page.clock.runFor(400);

  // Foto im Privat-Modus → Kategorie 🏠 Privat
  await page.evaluate(() => { location.hash = "#alltag/galerie"; });
  await page.waitForSelector('[data-g="active"] .ga-chip', { state: "visible", timeout: 8000 });
  await page.clock.runFor(1500);
  const chip = await page.textContent('[data-g="active"] .ga-chip');
  ok(chip.includes("Privat") && chip.includes("(Privat-Modus)"), `Chip „${chip.replace(/\s+/g, " ").trim()}“`);
  const act = await page.evaluate(() => import("/js/gallery-albums.js").then((m) => { const a = m.activeFolder(); return { id: a.id, source: a.source }; }));
  ok(act.id === "f_privat" && act.source === "privat", "aktive Kategorie f_privat (Quelle privat)");
  await shot(page, "privat-390-light-galerie.png");
  const jpg = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 64; c.height = 48; const g = c.getContext("2d"); g.fillStyle = "#2a9"; g.fillRect(0, 0, 64, 48); return c.toDataURL("image/jpeg", 0.8).split(",")[1]; });
  await page.evaluate(({ lat, lng }) => window.__geoSet(lat, lng), HOME);
  await page.setInputFiles('[data-in="cam"]', { name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpg, "base64") });
  for (let i = 0; i < 40 && !(await page.$('.sheet [data-ph="save"]:not([disabled])')); i++) await page.clock.runFor(250);
  const capChip = await page.textContent('.sheet [data-ph="active"]').catch(() => "");
  ok(capChip.includes("(Privat-Modus)"), "Aufnahme-Blatt: „Neue Fotos gehen nach 🏠 Privat (Privat-Modus)“");
  await shot(page, "privat-390-light-foto.png");
  await page.click('.sheet [data-ph="save"]');
  for (let i = 0; i < 30; i++) {
    await page.clock.runFor(500);
    const al = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-photo_albums") || "[]"));
    if (al.some((a) => a.folderId === "f_privat")) break;
  }
  await closeSheets(page);
  const albs = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-photo_albums") || "[]"));
  ok(albs.some((a) => a.kind === "address" && a.folderId === "f_privat"), "Foto → neues Album in 🏠 Privat");

  // Material im Privat-Modus: kein Ort vorbelegt (auch wenn ein Ort gewählt wäre)
  // „Privat bis 1 Stunde“ → Ablauf
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.clock.runFor(600);
  await page.click('[data-pmu="1h"]');
  await flush(page);
  d = await data(page);
  const now1 = await page.evaluate(() => Date.now());
  ok(Math.abs(d.settings.mode.until - (now1 + 3600000)) < 5000, "Privat bis 1 Stunde gespeichert");
  ok(await page.getAttribute('[data-pmu="1h"]', "aria-pressed") === "true", "Pille „1 Stunde“ gedrückt");
  ok(/bis \d\d:\d\d/.test(await page.textContent('[data-pm-r="sub"]')), "Banner zeigt „bis HH:MM“");
  await page.clock.runFor(59 * 60000);
  ok(await page.getAttribute('[data-pm="privat"]', "aria-checked") === "true", "nach 59 min noch Privat");
  await page.clock.runFor(2 * 60000);
  ok(await page.getAttribute('[data-pm="arbeit"]', "aria-checked") === "true" && await page.isHidden('[data-pm-r="banner"]'), "nach 1 h automatisch wieder Arbeit");
  ok(!(await page.evaluate(() => document.body.classList.contains("is-privat"))), "Akzent zurück");
  await ctx.close();

  /* =============== 2) Samstag 07.11.2026 11:00 – Zeitplan „automatisch privat“ =============== */
  {
    const { ctx, page } = await open({ time: T(11, 7, 11, 0), name: "samstag" });
    ok(await page.getAttribute('[data-pm="arbeit"]', "aria-checked") === "true", "Sa ohne Zeitplan: Arbeit");
    await page.click('[data-pm="settings"]');
    await page.waitForSelector('.sheet [data-r="pm-auto"]', { state: "visible" });
    await page.check('.sheet [data-r="pm-auto"]');
    await page.clock.runFor(600);
    ok(await page.isVisible('.sheet [data-r="pm-from"]'), "Von/Bis sichtbar");
    await shot(page, "privat-390-light-einstellungen.png");
    await closeSheets(page);
    const dd = await data(page);
    ok(dd.settings.modeSchedule.enabled === true && dd.settings.modeSchedule.from === "06:00" && dd.settings.modeSchedule.to === "17:00", "modeSchedule gespeichert (06:00–17:00)");
    ok(await page.getAttribute('[data-pm="privat"]', "aria-checked") === "true", "Samstag → automatisch Privat");
    const sub = await page.textContent('[data-pm-r="sub"]');
    ok(sub.includes("Automatisch außerhalb deiner Arbeitszeit") && sub.includes("bis Mo 06:00"), `Banner „${sub}“`);
    ok(await page.isVisible('[data-pm-r="auto"]'), "„Auto“-Kennzeichen am Umschalter");
    // Arbeit überstimmt bis zum nächsten Wechsel
    await page.click('[data-pm="arbeit"]');
    await page.clock.runFor(1500);
    await closeSheets(page);
    ok(await page.getAttribute('[data-pm="arbeit"]', "aria-checked") === "true", "„Arbeit“ überstimmt den Zeitplan");
    await ctx.close();
  }

  /* =============== 3) Dunkel: Screenshots =============== */
  {
    const seed = seedData({ mode: { privat: true, since: T(11, 4, 9, 0), until: T(11, 4, 20, 0), source: "manual" } });
    const { ctx, page } = await open({ time: T(11, 4, 10, 0), colorScheme: "dark", seed, name: "dunkel" });
    ok(await page.getAttribute('[data-pmu="abend"]', "aria-pressed") === "true", "dunkel: „bis 20:00“ gedrückt");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390: keine waagrechte Scrollleiste");
    await shot(page, "privat-390-dark-privat.png");
    await page.click('[data-pm="arbeit"]');
    await page.clock.runFor(1500);
    await closeSheets(page);
    await shot(page, "privat-390-dark-arbeit.png");
    await ctx.close();
  }

  /* =============== 4) PC 1440×900 =============== */
  {
    const seed = seedData({ mode: { privat: true, since: T(11, 4, 9, 0), until: null, source: "manual" } });
    const { ctx, page } = await open({ time: T(11, 4, 10, 0), seed, name: "pc", viewport: { width: 1440, height: 900 } });
    ok(await page.isVisible('[data-pm-r="banner"]'), "PC: Banner sichtbar");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "PC: keine waagrechte Scrollleiste");
    await shot(page, "privat-1440-light.png");
    await ctx.close();
  }

  await browser.close();
  if (errors.length) { console.log("Konsolenfehler:\n" + errors.join("\n")); process.exit(1); }
  console.log("Alles grün. Screenshots: " + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
