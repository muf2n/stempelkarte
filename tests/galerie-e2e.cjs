// Playwright-Test für Alltag › Galerie (lokaler Modus).
//   cd <worktree> && python3 -m http.server 8860 &   then   node tests/galerie-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen, Nominatim wird per page.route nachgebildet, die Position per Kontext-Geolocation.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8860/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = key(new Date());

const GRAMBACH = { latitude: 47.01098, longitude: 15.50511 };
const LIEBENAU = { latitude: 47.01098 + 2000 / 111320, longitude: 15.50511 };     // 2 km nördlich
const FIRMA = { latitude: 47.0402, longitude: 15.4089 };                            // gespeicherter Ort
const SEIERSBERG = { lat: 47.0062, lng: 15.4028 };                                  // EXIF-GPS

function nominatimFor(lat, lng) {
  const near = (p, m) => Math.hypot((lat - p.latitude) * 111320, (lng - p.longitude) * 75900) < m;
  if (near(GRAMBACH, 300)) return { display_name: "1, Thomas-Arbesser-Straße, Grambach, Bezirk Graz-Umgebung, Steiermark, 8074, Österreich", address: { house_number: "1", road: "Thomas-Arbesser-Straße", village: "Grambach", municipality: "Grambach", postcode: "8074", state: "Steiermark", country: "Österreich" } };
  if (near(LIEBENAU, 300)) return { address: { house_number: "24", road: "Liebenauer Hauptstraße", suburb: "Liebenau", city: "Graz", postcode: "8041" } };
  if (Math.hypot((lat - SEIERSBERG.lat) * 111320, (lng - SEIERSBERG.lng) * 75900) < 300) return { address: { house_number: "10", road: "Am Seiersberg", town: "Seiersberg-Pirka", postcode: "8055" } };
  return { address: { village: "Irgendwo" } };
}

(async () => {
  const G = await import(path.resolve(__dirname, "../js/gallery-core.js"));
  const browser = await chromium.launch();
  const errors = [];
  const nomi = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, colorScheme: "light", acceptDownloads: true,
    permissions: ["geolocation"], geolocation: GRAMBACH,
  });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await ctx.addInitScript(() => {
    window.__shared = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: (d) => { window.__shared.push({ n: (d.files || []).length, title: d.title }); return Promise.resolve(); } });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (d) => !!(d && d.files) });
  });
  const page = await ctx.newPage();
  await page.route("https://nominatim.openstreetmap.org/**", (route) => {
    const u = new URL(route.request().url());
    const lat = Number(u.searchParams.get("lat")), lng = Number(u.searchParams.get("lon"));
    nomi.push({ t: Date.now(), lat, lng });
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(nominatimFor(lat, lng)) });
  });
  page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on("requestfailed", (r) => { const u = new URL(r.url()); if (u.hostname === "localhost") errors.push("lokal fehlgeschlagen: " + r.url()); });
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name, full = true, p = page) => { await p.waitForTimeout(450); return p.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const txt = (s) => page.textContent(s);
  const albums = () => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-photo_albums") || "[]"));
  const albumByName = async (re) => (await albums()).find((a) => re.test(a.name));
  const idx = () => page.evaluate(() => import("/js/photos.js").then((m) => m.listIndex({ refresh: true })));
  const until = async (fn, msg, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("FEHLER (Zeit): " + msg); await page.waitForTimeout(120); } };
  const closeSheet = async () => { await page.click(".sheet .close"); await page.waitForTimeout(150); };

  // Testbilder (JPEG aus einem Canvas, mit/ohne EXIF)
  await page.goto(BASE);
  const jpeg = async (color, label) => Buffer.from((await page.evaluate(([c, l]) => {
    const cv = document.createElement("canvas"); cv.width = 640; cv.height = 480;
    const g = cv.getContext("2d"); g.fillStyle = c; g.fillRect(0, 0, 640, 480);
    g.fillStyle = "#fff"; g.font = "bold 90px sans-serif"; g.fillText(l, 40, 280);
    return cv.toDataURL("image/jpeg", 0.8);
  }, [color, label])).split(",")[1], "base64");
  const IMG = { p1: await jpeg("#0369a1", "Foto 1"), p2: await jpeg("#047857", "Foto 2"), p3: await jpeg("#b45309", "Foto 3"), p4: await jpeg("#7c3aed", "Firma"), p5: await jpeg("#be123c", "Ohne GPS") };
  const exifBuf = Buffer.from(G.injectExif(await jpeg("#334155", "EXIF"), G.buildExifSegment({ date: "2026:10:14 09:41:07", lat: SEIERSBERG.lat, lng: SEIERSBERG.lng })));
  const plainBuf = await jpeg("#a16207", "Import");

  // Startdaten: laufende Schicht (ohne Ort), gespeicherter Ort „Firma“, ein altes Foto (ohne Index) mit placeId
  await page.evaluate(async ([firma]) => {
    const d = new Date(); d.setHours(7, 0, 0, 0);
    const s = Math.min(d.getTime(), Date.now() - 60000);
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [], todos: [], days: {},
      places: [{ id: "pF", name: "Firma Elektro Maier", addr: "Wiener Straße 5, 8020 Graz", lat: firma.latitude, lng: firma.longitude, radius: 150 }],
      running: { start: s, segments: [{ start: s, activity: "Arbeiten", placeId: null, place: "", loc: null }], placeId: null, place: "", note: "", people: [], pauseStart: null, pauseMs: 0, inLoc: null },
      rev: Date.now(), settings: { weeklyTarget: 38.5 },
    }));
    await new Promise((res) => { const r = indexedDB.deleteDatabase("stempelkarte-photos"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    // alte Datenbank (Version 1, ohne Index-Store) mit einem alten Foto
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 48; const g = cv.getContext("2d"); g.fillStyle = "#64748b"; g.fillRect(0, 0, 64, 48);
    const url = cv.toDataURL("image/jpeg", 0.8);
    await new Promise((res, rej) => {
      const r = indexedDB.open("stempelkarte-photos", 1);
      r.onupgradeneeded = () => { const os = r.result.createObjectStore("photos", { keyPath: "id" }); os.createIndex("dayKey", "dayKey"); os.createIndex("placeId", "placeId"); };
      r.onsuccess = () => {
        const tx = r.result.transaction("photos", "readwrite");
        tx.objectStore("photos").put({ id: "old1", ts: new Date(2026, 8, 3, 10).getTime(), dayKey: "2026-09-03", placeId: "pF", place: "Firma Elektro Maier", entryId: null, note: "Altes Foto", w: 64, h: 48, data: url, thumb: url });
        tx.oncomplete = () => { r.result.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
      r.onerror = () => rej(r.error);
    });
  }, [FIRMA]);
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(600);

  /* ---------- Heute: Foto 1 + 2 in Grambach, Foto 3 nach 2 km ---------- */
  await page.waitForSelector("[data-r=photo] .ph-cam", { state: "visible" });
  const takeHeute = async (buf, name, note) => {
    await page.setInputFiles("[data-r=photo] label[data-ph-cam] input.ph-file", { name, mimeType: "image/jpeg", buffer: buf });
    await page.waitForSelector('.sheet [data-ph="save"]:not([disabled])');
    if (note) await page.fill('.sheet [data-ph="note"]', note);
    await page.click('.sheet [data-ph="save"]');
    await page.waitForSelector(".sheet", { state: "detached" });
  };
  await takeHeute(IMG.p1, "p1.jpg", "Verteiler vorher");
  const a1 = await until(() => albumByName(/Grambach/), "Album für Grambach angelegt");
  ok(a1.name === "Thomas-Arbesser-Straße 1, Grambach" && a1.kind === "address" && a1.radius === 80, "Foto 1 in Grambach → Album „Thomas-Arbesser-Straße 1, Grambach“ (Adresse, 80 m)");
  let list = await until(async () => { const l = await idx(); return l.length && l.find((x) => x.note === "Verteiler vorher" && x.albumIds.includes(a1.id)) ? l : null; }, "Foto 1 im Album");
  const ph1 = list.find((x) => x.note === "Verteiler vorher");
  ok(Math.abs(ph1.lat - GRAMBACH.latitude) < 1e-6 && ph1.addr === "Thomas-Arbesser-Straße 1, 8074 Grambach", "Position + Adresse am Foto gespeichert");
  ok(!("data" in ph1) && ph1.thumb.startsWith("data:image/jpeg"), "Index enthält nur das Vorschaubild");
  await page.waitForTimeout(300);
  await ctx.setGeolocation({ latitude: GRAMBACH.latitude + 0.0002, longitude: GRAMBACH.longitude }); // ≈ 22 m daneben
  await takeHeute(IMG.p2, "p2.jpg", "");
  await until(async () => (await idx()).filter((x) => x.albumIds.includes(a1.id)).length === 2, "Foto 2 im selben Album");
  ok((await albums()).length === 1, "Foto 2 an derselben Adresse → kein neues Album");
  await ctx.setGeolocation(LIEBENAU);
  await takeHeute(IMG.p3, "p3.jpg", "Zählerkasten");
  const a3 = await until(() => albumByName(/Liebenauer/), "neues Album nach 2 km");
  ok(a3.name === "Liebenauer Hauptstraße 24, Graz", "Foto 3 nach 2 km → neues Album „Liebenauer Hauptstraße 24, Graz“");
  await until(async () => (await idx()).filter((x) => x.albumIds.includes(a3.id)).length === 1, "Foto 3 im neuen Album");
  // Ort hat Vorrang
  await ctx.setGeolocation({ latitude: FIRMA.latitude + 0.0005, longitude: FIRMA.longitude });
  await takeHeute(IMG.p4, "p4.jpg", "Lager");
  const aF = await until(async () => (await albums()).find((a) => a.kind === "place" && a.placeId === "pF"), "Ort-Album");
  ok(aF.name === "Firma Elektro Maier", "Foto an gespeichertem Ort → Ort-Album „Firma Elektro Maier“ (Vorrang vor Adresse)");
  ok(nomi.length === 2, `Nominatim nur für neue Adressen gefragt (${nomi.length}×)`);
  ok(nomi.every((n, i) => !i || n.t - nomi[i - 1].t >= 1000), "Nominatim höchstens 1×/s");
  await shot("gl-heute-390.png", false);
  await page.locator("[data-r=photo]").screenshot({ path: path.join(OUT, "gl-heute-bar-390.png") });

  /* ---------- Mein Tag: Streifen mit Galerie-Knopf ---------- */
  await page.waitForSelector('[data-md="photos"] [data-ps="gal"]');
  ok(await page.isVisible('[data-md="photos"] [data-ps="gal"]'), "„Galerie“-Knopf am Foto-Streifen in Mein Tag");
  await page.click('[data-md="photos"] [data-ps="gal"]');
  await page.waitForSelector(".gl-agrid");
  ok(page.url().endsWith("#alltag/galerie"), "Knopf öffnet Alltag › Galerie");

  /* ---------- Alben + Migration ---------- */
  await until(async () => (await idx()).some((x) => x.id === "old1" && x.albumIds.includes(aF.id)), "altes Foto nachgetragen + Ort-Album");
  ok(true, "Altes Foto (ohne Index, mit placeId) → Index nachgetragen und ins Ort-Album");
  await page.waitForTimeout(300);
  const cards = await page.$$eval(".gl-acard[data-album]", (b) => b.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  ok(cards.length === 3, "3 Album-Karten: " + cards.join(" | "));
  ok(cards.some((c) => c.includes("Thomas-Arbesser-Straße 1, Grambach") && c.includes("2 Fotos")), "Karte Grambach: 2 Fotos");
  ok(cards.some((c) => c.includes("Firma Elektro Maier") && c.includes("2 Fotos")), "Karte Firma: 2 Fotos (neu + migriert)");
  ok((await page.$$(".gl-acard .gl-acov img")).length === 3, "Titelbilder als Vorschaubilder");
  await shot("gl-alben-390.png");

  /* ---------- Album: umbenennen, Symbol, zusammenführen ---------- */
  await page.click(`.gl-acard[data-album="${a3.id}"]`);
  await page.waitForSelector(".gl-ahead");
  ok(page.url().includes(`#alltag/galerie/a/${a3.id}`), "Album-Ansicht über eigenen Hash");
  ok((await txt(".gl-ahead")).includes("Umkreis 80 m"), "Album zeigt Art + Umkreis");
  ok((await page.getAttribute('[data-g="maps"]', "href")).startsWith("https://www.google.com/maps/search/?api=1&query=47.0"), "„In Google Maps öffnen“-Link");
  await page.click('[data-g="amenu"]');
  await page.fill('.sheet [data-m="name"]', "Baustelle Liebenau");
  await page.click('.sheet [data-emoji="🏗️"]');
  await page.click('.sheet [data-rad="150"]');
  await page.click('.sheet [data-m="save"]');
  await page.waitForTimeout(250);
  ok((await txt('[data-g="aname"]')) === "Baustelle Liebenau", "Album umbenannt");
  let al3 = (await albums()).find((a) => a.id === a3.id);
  ok(al3.emoji === "🏗️" && al3.radius === 150, "Symbol 🏗️ und Umkreis 150 m gespeichert");
  await page.click('[data-g="amenu"]');
  await page.click('.sheet [data-m="merge"]');
  await page.waitForSelector(`.sheet [data-pick="${a1.id}"]`);
  ok((await txt(`.sheet [data-pick="${a1.id}"]`)).includes("km entfernt"), "Zusammenführen: Entfernung angezeigt");
  await page.click(`.sheet [data-pick="${a1.id}"]`);
  await page.click('.sheet [data-c="ok"]');
  await page.waitForSelector(".sheet", { state: "detached" });
  await page.waitForTimeout(300);
  ok(!(await albums()).some((a) => a.id === a1.id), "Grambach-Album nach dem Zusammenführen entfernt");
  ok((await page.$$(".gl-th")).length === 3, "Album „Baustelle Liebenau“ hat jetzt 3 Fotos");
  ok((await page.$$(".gl-day")).length >= 1 && (await txt(".gl-dh")).includes("Heute"), "Gitter nach Tagen gruppiert");
  await shot("gl-album-390.png");

  /* ---------- Vollbild: Wischen, Notiz, Album-Chips ---------- */
  await page.click(".gl-th >> nth=0");
  await page.waitForSelector(".ph-view");
  ok((await txt(".ph-v-n")) === "1 / 3", "Vollbild 1 / 3");
  await until(() => page.evaluate(() => { const v = document.querySelector(".ph-v-stage img").src || ""; const t = document.querySelector(".gl-th img").src; return v.length > t.length * 1.5; }), "großes Bild nachgeladen");
  ok(true, "Großes Bild wird erst im Vollbild geladen");
  ok((await txt(".ph-v-meta")).includes("Liebenauer Hauptstraße 24, 8041 Graz"), "Vollbild zeigt Datum, Uhrzeit und Adresse");
  const swipe = (dx) => page.evaluate((dx) => {
    const st = document.querySelector(".ph-v-stage");
    const mk = (x) => new Touch({ identifier: 1, target: st, clientX: x, clientY: 400 });
    st.dispatchEvent(new TouchEvent("touchstart", { touches: [mk(200)], changedTouches: [mk(200)], bubbles: true }));
    st.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [mk(200 + dx)], bubbles: true }));
  }, dx);
  await swipe(-160);
  ok((await txt(".ph-v-n")) === "2 / 3", "Wischen nach links → nächstes Foto");
  await swipe(160);
  ok((await txt(".ph-v-n")) === "1 / 3", "Wischen nach rechts → voriges Foto");
  await page.fill(".ph-v-note textarea", "Zählerkasten offen");
  await page.click('[data-v="save"]');
  await page.waitForTimeout(250);
  ok((await idx()).some((x) => x.note === "Zählerkasten offen"), "Notiz im Vollbild geändert (Foto + Index)");
  ok((await page.$$(".gl-vchip-go")).length === 1 && (await txt(".gl-vchip-go")) === "Baustelle Liebenau", "Album als Chip im Vollbild");
  await page.click("[data-vadd]");
  await page.waitForSelector(".sheet .gl-pick");
  ok(await page.evaluate(() => getComputedStyle(document.querySelector(".sheet:last-child")).zIndex === "57"), "Album-Auswahl liegt über dem Vollbild");
  await page.fill('.sheet [data-p="name"]', "Verteiler");
  await page.click('.sheet [data-p="create"]');
  await page.waitForTimeout(300);
  ok((await page.$$eval(".gl-vchip-go", (b) => b.map((x) => x.textContent))).join() === "Baustelle Liebenau,Verteiler", "Neues Album „Verteiler“ aus dem Vollbild angelegt + Chip");
  await shot("gl-viewer-390.png", false);
  await page.click(".gl-vchip-x >> nth=1");
  await page.waitForTimeout(250);
  ok((await page.$$(".gl-vchip-go")).length === 1, "Chip ✕ entfernt das Foto aus dem Album");
  await page.click('[data-v="dl"]');
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".ph-view", { state: "detached" });

  /* ---------- Mehrfachauswahl: Zu Album, Verschieben, Löschen ---------- */
  const longPress = async (sel) => {
    const b = await page.$(sel); const r = await b.boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
    await page.waitForTimeout(150);
  };
  await longPress(".gl-th >> nth=0");
  ok(await page.isVisible('[data-g="selbar"]') && (await txt('[data-g="selcount"]')) === "1 ausgewählt", "Langes Drücken startet die Auswahl");
  await page.click(".gl-th >> nth=1");
  ok((await txt('[data-g="selcount"]')) === "2 ausgewählt", "Tippen wählt weitere");
  await shot("gl-select-390.png", false);
  await page.click('[data-s="add"]');
  await page.waitForSelector(".sheet [data-pick]");
  const verteiler = await albumByName(/^Verteiler$/);
  await page.click(`.sheet [data-pick="${verteiler.id}"]`);
  await page.waitForTimeout(300);
  ok((await idx()).filter((x) => x.albumIds.includes(verteiler.id)).length === 2, "2 Fotos zu „Verteiler“ hinzugefügt");
  ok(!(await page.isVisible('[data-g="selbar"]')), "Auswahl danach beendet");
  // Teilen mehrerer
  await page.click('[data-g="select"]');
  await page.click(".gl-th >> nth=0"); await page.click(".gl-th >> nth=2");
  await page.click('[data-s="share"]');
  await until(() => page.evaluate(() => window.__shared.length), "geteilt");
  ok((await page.evaluate(() => window.__shared[0].n)) === 2, "2 Fotos auf einmal geteilt (navigator.share mit Dateien)");
  // Verschieben: Foto 3 (nth=2) von Liebenau nach Verteiler
  await page.click('[data-s="move"]');
  await page.click(`.sheet [data-pick="${verteiler.id}"]`);
  await page.waitForTimeout(300);
  ok((await page.$$(".gl-th")).length === 1, "Verschieben: 2 Fotos weg aus „Baustelle Liebenau“");
  // Löschen mit Bestätigung
  await page.click('[data-g="select"]');
  await page.click(".gl-th >> nth=0");
  await page.click('[data-s="del"]');
  await page.waitForSelector('.sheet [data-c="ok"]');
  ok((await txt(".sheet h2")) === "1 Foto löschen?", "Löschen fragt nach (mit Anzahl)");
  await page.click('.sheet [data-c="no"]');
  ok((await page.$$(".gl-th")).length === 1, "Abbrechen löscht nichts");
  await page.click('[data-s="del"]');
  await page.click('.sheet [data-c="ok"]');
  await page.waitForSelector(".sheet", { state: "detached" });
  await page.waitForTimeout(300);
  ok((await idx()).length === 4, "1 Foto gelöscht (4 übrig)");
  ok(await page.isVisible(".gl-empty"), "Album leer");
  await page.click('[data-g="back"]');
  await page.waitForSelector(".gl-agrid");
  ok(page.url().endsWith("#alltag/galerie"), "Zurück → Alben (Verlauf)");

  /* ---------- Import mit EXIF ---------- */
  await page.setInputFiles('.gl-head input[data-in="imp"]', [{ name: "IMG_20261014.jpg", mimeType: "image/jpeg", buffer: exifBuf }]);
  const aS = await until(() => albumByName(/Seiersberg/), "Album aus EXIF-GPS");
  ok(aS.name === "Am Seiersberg 10, Seiersberg-Pirka", "Import mit EXIF-GPS → Album „Am Seiersberg 10, Seiersberg-Pirka“");
  const imp = await until(async () => (await idx()).find((x) => x.albumIds.includes(aS.id)), "importiertes Foto");
  ok(imp.dayKey === "2026-10-14" && new Date(imp.ts).getHours() === 9, "EXIF-Aufnahmezeit übernommen (14.10.2026, 09:41)");
  // Import ohne EXIF in „Verteiler“
  await page.click(`.gl-acard[data-album="${verteiler.id}"]`);
  await page.waitForSelector(".gl-ahead");
  await page.setInputFiles('.gl-aacts input[data-in="imp"]', [{ name: "a.jpg", mimeType: "image/jpeg", buffer: plainBuf }, { name: "b.jpg", mimeType: "image/jpeg", buffer: plainBuf }]);
  await until(async () => (await idx()).filter((x) => x.albumIds.includes(verteiler.id)).length === 4, "2 importiert in Verteiler");
  ok(true, "Mehrere Dateien ohne EXIF ins Album importiert (heute, ohne Ort)");
  const impToday = (await idx()).filter((x) => x.albumIds.includes(verteiler.id) && x.dayKey === TODAY).length;
  ok(impToday === 4, "Ohne EXIF: aktuelle Zeit");
  await page.click('[data-g="back"]');
  await page.waitForSelector(".gl-agrid");
  ok((await txt(".gl-agrid")).includes("Ohne Ort"), "Virtuelles Album „Ohne Ort“ für Fotos ohne Standort");

  /* ---------- Alle Fotos: Filter & Suche ---------- */
  await page.click('.gl-tab[data-tab="alle"]');
  await page.waitForSelector(".gl-filters");
  const count = async () => (await txt('[data-g="count"]')).trim();
  ok((await count()) === "7 Fotos", "Alle Fotos: 7");
  ok((await page.$$eval(".gl-mh", (h) => h.map((x) => x.textContent))).join() === "November 2026,Oktober 2026,September 2026", "Nach Monaten gruppiert");
  await page.fill('[data-g="q"]', "seiersberg");
  await page.waitForTimeout(350);
  ok((await count()) === "1 Foto gefunden", "Suche „seiersberg“ (Adresse) → 1");
  await page.fill('[data-g="q"]', "zaehlerkasten");
  await page.waitForTimeout(350);
  ok((await count()) === "1 Foto gefunden", "Suche umlaut-unabhängig über die Notiz → 1");
  await page.fill('[data-g="q"]', "");
  await page.waitForTimeout(350);
  await page.click(`.gl-chip[data-fa="${aF.id}"]`);
  ok((await count()) === "2 Fotos gefunden", "Album-Filter „Firma“ → 2");
  await page.fill('[data-g="from"]', TODAY);
  await page.dispatchEvent('[data-g="from"]', "change");
  ok((await count()) === "1 Foto gefunden", "+ Zeitraum ab heute → 1");
  await shot("gl-alle-390.png");
  await page.click('[data-g="clear"]');
  ok((await count()) === "7 Fotos", "Filter zurücksetzen");
  await page.fill('[data-g="to"]', "2026-10-31");
  await page.dispatchEvent('[data-g="to"]', "change");
  ok((await count()) === "2 Fotos gefunden", "Zeitraum bis 31.10. → 2");
  await page.click('[data-g="clear"]');

  /* ---------- Album löschen: Fotos behalten / mitlöschen ---------- */
  await page.click('.gl-tab[data-tab="alben"]');
  await page.click(`.gl-acard[data-album="${verteiler.id}"]`);
  await page.click('[data-g="amenu"]');
  await page.click('.sheet [data-m="del"]');
  await page.waitForSelector('.sheet [data-c="ok"]');
  await page.click('.sheet [data-c="ok"]');
  ok((await txt('.sheet [data-c="ok"]')) === "Wirklich löschen?", "Album löschen: zweiter Tipp nötig");
  await page.click('.sheet [data-c="ok"]');
  await page.waitForSelector(".gl-agrid");
  ok(!(await albums()).some((a) => a.id === verteiler.id) && (await idx()).length === 7, "„Verteiler“ gelöscht, Fotos bleiben (7)");
  await page.click(`.gl-acard[data-album="${aS.id}"]`);
  await page.click('[data-g="amenu"]');
  await page.click('.sheet [data-m="del"]');
  await page.check('.sheet input[value="all"]');
  ok((await txt('.sheet [data-c="ok"]')).includes("1 Foto löschen"), "Option „Fotos auch löschen“ zeigt Anzahl");
  await page.click('.sheet [data-c="ok"]'); await page.click('.sheet [data-c="ok"]');
  await page.waitForSelector(".gl-agrid");
  await page.waitForTimeout(300);
  ok(!(await albums()).some((a) => a.id === aS.id) && (await idx()).length === 6, "Album + Foto gelöscht (6 übrig)");

  /* ---------- Neues Album, Einstellungen, GPS verweigert ---------- */
  await page.click('.gl-anew');
  await page.fill('.sheet [data-n="name"]', "Vorher / Nachher");
  await page.click('.sheet [data-emoji="⭐"]');
  await page.click('.sheet [data-n="ok"]');
  await page.waitForSelector(".gl-ahead");
  ok((await txt('[data-g="aname"]')) === "Vorher / Nachher" && (await txt(".gl-ahead-ic")).includes("⭐"), "„+ Neues Album“ mit Emoji");
  await page.click('[data-g="back"]');
  await page.click('[data-g="settings"]');
  ok(await page.isChecked('.sheet [data-s="auto"]'), "Einstellung „automatisch nach Adresse“ standardmäßig an");
  await page.click('.sheet [data-rad="300"]');
  await page.click('.sheet [data-s="save"]');
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => import("/js/store.js").then((m) => m.get().settings.gallery))).radius === 300, "Umkreis 300 m in settings.gallery gespeichert");
  // GPS verweigert → Ohne Ort
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, err) => setTimeout(() => err({ code: 1, message: "denied" }), 10); });
  await page.evaluate(() => import("/js/gallery-albums.js").then((m) => m.forgetPosition()));
  await page.setInputFiles('.gl-head input[data-in="cam"]', { name: "x.jpg", mimeType: "image/jpeg", buffer: IMG.p5 });
  await page.waitForSelector('.sheet [data-ph="save"]:not([disabled])');
  await page.click('.sheet [data-ph="save"]');
  await page.waitForTimeout(900);
  const ohne = (await idx()).filter((x) => !x.albumIds.length && x.lat === null);
  ok(ohne.length >= 3, "GPS verweigert → Foto ohne Album (Ohne Ort)");

  /* ---------- Karte (fremde Domains gesperrt → Liste) ---------- */
  await page.click('.gl-tab[data-tab="karte"]');
  await page.waitForTimeout(600);
  ok((await txt('[data-g="mapnote"]')).includes("Karte konnte nicht geladen werden") && (await page.$$(".gl-mrow")).length >= 2, "Karte ohne Netz → Hinweis + Liste der Alben");
  await page.click('.gl-tab[data-tab="alben"]');

  /* ---------- Bestehende Foto-Funktionen: Ort-Blatt + Tages-Blatt ---------- */
  await page.evaluate(() => { location.hash = "#orte"; });
  await page.waitForTimeout(500);
  await page.click(".place-item[data-id=pF]");
  await page.waitForSelector(".sheet [data-r=photos] .ph-th");
  ok((await page.$$(".sheet [data-r=photos] .ph-th")).length === 2, "Ort-Blatt zeigt weiter die Fotos des Orts (2)");
  await ctx.setGeolocation(LIEBENAU);
  await page.setInputFiles(".sheet [data-r=photos] input.ph-file", { name: "o.jpg", mimeType: "image/jpeg", buffer: IMG.p2 });
  await page.waitForSelector('.sheet [data-ph="save"]:not([disabled])');
  await page.click('.sheet [data-ph="save"]');
  await page.waitForTimeout(400);
  ok((await page.$$(".sheet [data-r=photos] .ph-th")).length === 3, "Ort-Blatt „+ Foto“ funktioniert");
  await closeSheet();
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForTimeout(400);
  await page.click('[data-pb="count"]');
  await page.waitForSelector(".sheet .ph-th");
  ok((await page.$$(".sheet .ph-th")).length >= 4, "„📷 heute“ öffnet weiter das Tages-Blatt");
  await page.click(".sheet [data-ph-gal]");
  await page.waitForSelector(".gl-agrid");
  ok(!(await page.$(".sheet")), "Tages-Blatt → „Alle Fotos in der Galerie“");

  /* ---------- Screenshots ---------- */
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector('.al-tile[data-id="galerie"]');
  ok((await txt('.al-tile[data-id="galerie"]')).includes("Fotos nach Baustelle & Adresse"), "Kachel „Galerie“ im Alltag");
  await page.click('.al-tile[data-id="galerie"]');
  await page.waitForSelector(".gl-agrid");
  await shot("gl-alben2-390.png");
  const state = await page.evaluate(() => ({ ls: { ...localStorage } }));

  for (const [scheme, vp, name] of [["dark", { width: 390, height: 844 }, "390-dark"], ["light", { width: 1440, height: 900 }, "1440"], ["dark", { width: 1440, height: 900 }, "1440-dark"]]) {
    const c2 = await browser.newContext({ viewport: vp, colorScheme: scheme, permissions: ["geolocation"], geolocation: GRAMBACH });
    await c2.route("**/*", (route) => { const u = new URL(route.request().url()); return (u.hostname === "localhost") ? route.continue() : route.abort(); });
    const p2 = await c2.newPage();
    p2.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    p2.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    await p2.goto(BASE);
    await p2.evaluate((ls) => { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }, state.ls);
    // Fotos liegen in IndexedDB des ersten Kontexts → hier über die App neu anlegen
    await p2.reload();
    await p2.waitForTimeout(400);
    if (await p2.isVisible("#btn-local")) await p2.click("#btn-local");
    await p2.waitForTimeout(500);
    await p2.evaluate(async (imgs) => {
      const photos = await import("/js/photos.js");
      const A = await import("/js/gallery-albums.js");
      const als = A.albums();
      const toFile = (b64, n) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], n, { type: "image/jpeg" }); };
      let i = 0;
      for (const a of als) for (let k = 0; k < 3; k++) {
        const b64 = imgs[i++ % imgs.length];
        await photos.addPhoto(toFile(b64, "f.jpg"), { albumIds: [a.id], ts: Date.now() - i * 3600e3 * 7, note: k === 0 ? "Notiz" : "", lat: a.lat, lng: a.lng, addr: a.addr || "" });
      }
    }, Object.values(IMG).map((b) => b.toString("base64")));
    await p2.evaluate(() => { location.hash = "#alltag/galerie"; });
    await p2.waitForSelector(".gl-agrid");
    await p2.waitForTimeout(400);
    await shot(`gl-alben-${name}.png`, true, p2);
    await p2.click('.gl-tab[data-tab="alle"]');
    await p2.waitForSelector(".gl-th");
    await shot(`gl-alle-${name}.png`, true, p2);
    await p2.click(".gl-th >> nth=1");
    await p2.waitForSelector(".ph-view");
    await shot(`gl-viewer-${name}.png`, false, p2);
    await p2.keyboard.press("Escape");
    await p2.click('.gl-tab[data-tab="alben"]');
    await p2.click(".gl-acard[data-album] >> nth=0");
    await p2.waitForSelector(".gl-ahead");
    await p2.click('[data-g="select"]');
    await p2.click(".gl-th >> nth=0");
    await shot(`gl-album-${name}.png`, false, p2);
    if (name === "390-dark") {
      await p2.click('[data-s="done"]');
      await p2.evaluate(() => { location.hash = "#heute"; });
      await p2.waitForTimeout(500);
      await shot(`gl-heute-${name}.png`, false, p2);
    }
    await c2.close();
  }

  ok(errors.length === 0, "keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("ALLES OK");
})().catch((e) => { console.error(e); process.exit(1); });
