// Playwright-Test für Alltag › Galerie (lokaler Modus) inkl. Hauptkategorien (Agent T).
//   cd <worktree> && python3 -m http.server 8862 &   then   node tests/galerie-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen, Nominatim wird per page.route nachgebildet, die Position per Kontext-Geolocation.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8862/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = key(new Date());

const MUSTERDORF = { latitude: 47.01098, longitude: 15.50511 };
const PROBENAU = { latitude: 47.01098 + 2000 / 111320, longitude: 15.50511 };     // 2 km nördlich
const FIRMA = { latitude: 47.0402, longitude: 15.4089 };                            // gespeicherter Ort
const TESTHEIM = { lat: 47.0062, lng: 15.4028 };                                  // EXIF-GPS
const LBS = { latitude: 47.0905, longitude: 15.4040 };                              // gespeicherter Ort Berufsschule

// Update 9 (Agent U) – wechselnde Wohnungen (je ≈ 550 m auseinander)
const W = [0, 1, 2, 3, 4, 5].map((i) => ({ latitude: 47.0600 + i * 0.005, longitude: 15.4500 }));
const WSTR = ["Musterstraße 5", "Mustergasse 12", "Testplatz 3", "Testerstraße 40", "Fiktivstraße 8", "Beispielhofstraße 2"];

function nominatimFor(lat, lng) {
  const near = (p, m) => Math.hypot((lat - p.latitude) * 111320, (lng - p.longitude) * 75900) < m;
  for (let i = 0; i < W.length; i++) if (near(W[i], 200)) { const [road, hn] = WSTR[i].split(/ (?=\d)/); return { address: { road, house_number: hn, city: "Musterstadt", postcode: "8020" } }; }
  if (near(MUSTERDORF, 300)) return { display_name: "1, Erika-Muster-Straße, Musterdorf, Bezirk Musterstadt-Umgebung, Steiermark, 8074, Österreich", address: { house_number: "1", road: "Erika-Muster-Straße", village: "Musterdorf", municipality: "Musterdorf", postcode: "8074", state: "Steiermark", country: "Österreich" } };
  if (near(PROBENAU, 300)) return { address: { house_number: "24", road: "Probenauer Hauptstraße", suburb: "Probenau", city: "Musterstadt", postcode: "8041" } };
  if (Math.hypot((lat - TESTHEIM.lat) * 111320, (lng - TESTHEIM.lng) * 75900) < 300) return { address: { house_number: "10", road: "Am Testheim", town: "Testheim-Au", postcode: "8055" } };
  return { address: { village: "Irgendwo" } };
}

(async () => {
  const G = await import(path.resolve(__dirname, "../js/gallery-core.js"));
  const browser = await chromium.launch();
  const errors = [];
  const nomi = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, colorScheme: "light", acceptDownloads: true,
    permissions: ["geolocation"], geolocation: MUSTERDORF,
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
  const folders = () => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-photo_folders") || "[]"));
  const gset = () => page.evaluate(() => import("/js/store.js").then((m) => m.get().settings.gallery || {}));
  const albumOf = async (id) => (await albums()).find((a) => a.id === id);
  const goHash = async (h, sel) => { await page.evaluate((h) => { location.hash = h; }, h); if (sel) await page.waitForSelector(sel); await page.waitForTimeout(150); };
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
  const exifBuf = Buffer.from(G.injectExif(await jpeg("#334155", "EXIF"), G.buildExifSegment({ date: "2026:10:14 09:41:07", lat: TESTHEIM.lat, lng: TESTHEIM.lng })));
  const plainBuf = await jpeg("#a16207", "Import");

  // Startdaten: laufende Schicht (ohne Ort), gespeicherter Ort „Firma“, ein altes Foto (ohne Index) mit placeId
  await page.evaluate(async ([firma, lbs]) => {
    const d = new Date(); d.setHours(7, 0, 0, 0);
    const s = Math.min(d.getTime(), Date.now() - 60000);
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [], todos: [], days: {},
      places: [{ id: "pF", name: "Firma Elektro Maier", addr: "Erfundene Straße 5, 8020 Musterstadt", lat: firma.latitude, lng: firma.longitude, radius: 150 },
        { id: "pS", name: "Landesberufsschule Musterstadt 4", addr: "Hans-Muster-Gasse 6, 8010 Musterstadt", lat: lbs.latitude, lng: lbs.longitude, radius: 150 }],
      running: { start: s, segments: [{ start: s, activity: "Arbeiten", placeId: null, place: "", loc: null }], placeId: null, place: "", note: "", people: [], pauseStart: null, pauseMs: 0, inLoc: null },
      rev: Date.now(), settings: { weeklyTarget: 38.5 },
    }));
    // Alben aus der Zeit vor den Hauptkategorien (Adresse, Berufsschul-Ort, eigenes)
    localStorage.setItem("sk-a-photo_albums", JSON.stringify([
      { id: "alOld", kind: "address", name: "Testerstraße 3, Musterstadt", lat: 47.0712, lng: 15.4300, radius: 80, addr: "Testerstraße 3, 8020 Musterstadt", created: 1 },
      { id: "alLbs", kind: "place", placeId: "pS", name: "Landesberufsschule Musterstadt 4", lat: lbs.latitude, lng: lbs.longitude, radius: 150, created: 2 },
      { id: "alCust", kind: "custom", name: "Ideen", emoji: "💡", radius: 80, created: 3 },
    ]));
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
  }, [FIRMA, LBS]);
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(600);

  /* ---------- Heute: Foto 1 + 2 in Musterdorf, Foto 3 nach 2 km ---------- */
  await page.waitForSelector("[data-r=photo] .ph-cam", { state: "visible" });
  const takeHeute = async (buf, name, note) => {
    await page.setInputFiles("[data-r=photo] label[data-ph-cam] input.ph-file", { name, mimeType: "image/jpeg", buffer: buf });
    await page.waitForSelector('.sheet [data-ph="save"]:not([disabled])');
    if (note) await page.fill('.sheet [data-ph="note"]', note);
    await page.click('.sheet [data-ph="save"]');
    await page.waitForSelector(".sheet", { state: "detached" });
  };
  await takeHeute(IMG.p1, "p1.jpg", "Verteiler vorher");
  const a1 = await until(() => albumByName(/Musterdorf/), "Album für Musterdorf angelegt");
  ok(a1.name === "Erika-Muster-Straße 1, Musterdorf" && a1.kind === "address" && a1.radius === 80, "Foto 1 in Musterdorf → Album „Erika-Muster-Straße 1, Musterdorf“ (Adresse, 80 m)");
  /* Hauptkategorien: erster Start */
  let fl = await folders();
  ok(fl.map((f) => f.id).sort().join() === "f_bau,f_privat,f_schule", "Erster Start: Standard-Kategorien 🏗️ Baustellen, 🏫 Berufsschule, 🏠 Privat angelegt");
  ok(fl.find((f) => f.id === "f_bau").emoji === "🏗️" && fl.find((f) => f.id === "f_bau").name === "Baustellen", "Baustellen mit 🏗️");
  ok((await gset()).foldersInit === true, "Flag foldersInit gesetzt");
  ok(a1.folderId === "f_bau", "Neues Adress-Album landet automatisch in „Baustellen“");
  ok((await albumOf("alOld")).folderId === "f_bau", "Bestehendes Adress-Album → Baustellen (Migration)");
  ok((await albumOf("alLbs")).folderId === "f_schule", "Ort-Album der Berufsschule (LBS) → Berufsschule");
  ok(!(await albumOf("alCust")).folderId, "Eigenes Album bleibt ohne Kategorie");
  let list = await until(async () => { const l = await idx(); return l.length && l.find((x) => x.note === "Verteiler vorher" && x.albumIds.includes(a1.id)) ? l : null; }, "Foto 1 im Album");
  const ph1 = list.find((x) => x.note === "Verteiler vorher");
  ok(Math.abs(ph1.lat - MUSTERDORF.latitude) < 1e-6 && ph1.addr === "Erika-Muster-Straße 1, 8074 Musterdorf", "Position + Adresse am Foto gespeichert");
  ok(!("data" in ph1) && ph1.thumb.startsWith("data:image/jpeg"), "Index enthält nur das Vorschaubild");
  await page.waitForTimeout(300);
  await ctx.setGeolocation({ latitude: MUSTERDORF.latitude + 0.0002, longitude: MUSTERDORF.longitude }); // ≈ 22 m daneben
  await takeHeute(IMG.p2, "p2.jpg", "");
  await until(async () => (await idx()).filter((x) => x.albumIds.includes(a1.id)).length === 2, "Foto 2 im selben Album");
  ok((await albums()).length === 4, "Foto 2 an derselben Adresse → kein neues Album (3 alte + 1)");
  await ctx.setGeolocation(PROBENAU);
  await takeHeute(IMG.p3, "p3.jpg", "Zählerkasten");
  const a3 = await until(() => albumByName(/Probenauer/), "neues Album nach 2 km");
  ok(a3.name === "Probenauer Hauptstraße 24, Musterstadt", "Foto 3 nach 2 km → neues Album „Probenauer Hauptstraße 24, Musterstadt“");
  await until(async () => (await idx()).filter((x) => x.albumIds.includes(a3.id)).length === 1, "Foto 3 im neuen Album");
  // Ort hat Vorrang
  await ctx.setGeolocation({ latitude: FIRMA.latitude + 0.0005, longitude: FIRMA.longitude });
  await takeHeute(IMG.p4, "p4.jpg", "Lager");
  const aF = await until(async () => (await albums()).find((a) => a.kind === "place" && a.placeId === "pF"), "Ort-Album");
  ok(aF.name === "Firma Elektro Maier", "Foto an gespeichertem Ort → Ort-Album „Firma Elektro Maier“ (Vorrang vor Adresse)");
  ok(aF.folderId === "f_bau" && (await albumOf(a3.id)).folderId === "f_bau", "Neues Ort-/Adress-Album → Baustellen");
  ok((await folders()).length === 3, "Standard-Kategorien nur einmal angelegt");
  ok(nomi.length === 2, `Nominatim nur für neue Adressen gefragt (${nomi.length}×)`);
  ok(nomi.every((n, i) => !i || n.t - nomi[i - 1].t >= 1000), "Nominatim höchstens 1×/s");
  await shot("gl-heute-390.png", false);
  await page.locator("[data-r=photo]").screenshot({ path: path.join(OUT, "gl-heute-bar-390.png") });

  /* ---------- Mein Tag: Streifen mit Galerie-Knopf ---------- */
  await page.waitForSelector('[data-md="photos"] [data-ps="gal"]');
  ok(await page.isVisible('[data-md="photos"] [data-ps="gal"]'), "„Galerie“-Knopf am Foto-Streifen in Mein Tag");
  await page.click('[data-md="photos"] [data-ps="gal"]');
  await page.waitForSelector(".gl-fgrid");
  ok(page.url().endsWith("#alltag/galerie"), "Knopf öffnet Alltag › Galerie (Hauptkategorien)");

  /* ---------- Alben + Migration ---------- */
  await until(async () => (await idx()).some((x) => x.id === "old1" && x.albumIds.includes(aF.id)), "altes Foto nachgetragen + Ort-Album");
  ok(true, "Altes Foto (ohne Index, mit placeId) → Index nachgetragen und ins Ort-Album");
  await page.waitForTimeout(300);
  const fcards = await page.$$eval(".gl-fcard[data-folder]", (b) => b.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  ok(fcards.length === 4 && /Baustellen/.test(fcards[0]) && /Berufsschule/.test(fcards[1]) && /Privat/.test(fcards[2]) && /Ohne Kategorie/.test(fcards[3]), "Kategorie-Karten in Reihenfolge + „Ohne Kategorie“: " + fcards.join(" | "));
  ok(/4 Alben · 5 Fotos/.test(fcards[0]) && /zuletzt/.test(fcards[0]), "Baustellen: 4 Alben · 5 Fotos, letztes Datum");
  ok((await page.$$('.gl-fcard[data-folder="f_bau"] .gl-fmos img')).length === 4 && await page.$('.gl-fcard[data-folder="f_bau"] .gl-fmos.n4'), "2×2-Cover-Mosaik (Album-Titelbilder + neueste Fotos)");
  ok(await page.$('.gl-fcard[data-folder="f_schule"] .gl-fmos.n0'), "Leere Kategorie: großes Emoji statt Mosaik");
  ok(/1 Album · 0 Fotos/.test(fcards[1]), "Berufsschule: 1 Album");
  await shot("gl-kat-390.png");
  await page.click('.gl-fcard[data-folder="f_bau"]');
  await page.waitForSelector(".gl-fhead");
  ok(page.url().endsWith("#alltag/galerie/k/f_bau") && (await txt('[data-g="fname"]')) === "Baustellen", "Tippen öffnet die Kategorie (eigener Hash)");
  const cards = await page.$$eval(".gl-acard[data-album]", (b) => b.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  ok(cards.length === 4, "4 Album-Karten in Baustellen: " + cards.join(" | "));
  ok(cards.some((c) => c.includes("Erika-Muster-Straße 1, Musterdorf") && c.includes("2 Fotos")), "Karte Musterdorf: 2 Fotos");
  ok(cards.some((c) => c.includes("Firma Elektro Maier") && c.includes("2 Fotos")), "Karte Firma: 2 Fotos (neu + migriert)");
  ok((await page.$$(".gl-acard .gl-acov img")).length === 3, "Titelbilder als Vorschaubilder");
  await shot("gl-alben-390.png");
  await shot("gl-kat-bau-390.png");

  /* ---------- Album: umbenennen, Symbol, zusammenführen ---------- */
  await page.click(`.gl-acard[data-album="${a3.id}"]`);
  await page.waitForSelector(".gl-ahead");
  ok(page.url().includes(`#alltag/galerie/a/${a3.id}`), "Album-Ansicht über eigenen Hash");
  ok((await txt('[data-g="back"]')).trim() === "Baustellen" && (await txt('[data-g="afolder"]')).includes("Baustellen"), "Album zeigt „← Baustellen“ und seine Kategorie");
  ok((await txt(".gl-ahead")).includes("Umkreis 80 m"), "Album zeigt Art + Umkreis");
  ok((await page.getAttribute('[data-g="maps"]', "href")).startsWith("https://www.google.com/maps/search/?api=1&query=47.0"), "„In Google Maps öffnen“-Link");
  await page.click('[data-g="amenu"]');
  await page.fill('.sheet [data-m="name"]', "Baustelle Probenau");
  await page.click('.sheet [data-emoji="🏗️"]');
  await page.click('.sheet [data-rad="150"]');
  await page.click('.sheet [data-m="save"]');
  await page.waitForTimeout(250);
  ok((await txt('[data-g="aname"]')) === "Baustelle Probenau", "Album umbenannt");
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
  ok(!(await albums()).some((a) => a.id === a1.id), "Musterdorf-Album nach dem Zusammenführen entfernt");
  ok((await page.$$(".gl-th")).length === 3, "Album „Baustelle Probenau“ hat jetzt 3 Fotos");
  ok((await page.$$(".gl-day")).length >= 1 && (await txt(".gl-dh")).includes("Heute"), "Gitter nach Tagen gruppiert");
  await shot("gl-album-390.png");

  /* ---------- Vollbild: Wischen, Notiz, Album-Chips ---------- */
  await page.click(".gl-th >> nth=0");
  await page.waitForSelector(".ph-view");
  ok((await txt(".ph-v-n")) === "1 / 3", "Vollbild 1 / 3");
  await until(() => page.evaluate(() => { const v = document.querySelector(".ph-v-stage img").src || ""; const t = document.querySelector(".gl-th img").src; return v.length > t.length * 1.5; }), "großes Bild nachgeladen");
  ok(true, "Großes Bild wird erst im Vollbild geladen");
  ok((await txt(".ph-v-meta")).includes("Probenauer Hauptstraße 24, 8041 Musterstadt"), "Vollbild zeigt Datum, Uhrzeit und Adresse");
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
  ok((await page.$$(".gl-vchip-go")).length === 1 && (await txt(".gl-vchip-go")) === "Baustelle Probenau", "Album als Chip im Vollbild");
  await page.click("[data-vadd]");
  await page.waitForSelector(".sheet .gl-pick");
  ok(await page.evaluate(() => getComputedStyle(document.querySelector(".sheet:last-child")).zIndex === "57"), "Album-Auswahl liegt über dem Vollbild");
  await page.fill('.sheet [data-p="name"]', "Verteiler");
  await page.click('.sheet [data-p="create"]');
  await page.waitForTimeout(300);
  ok((await page.$$eval(".gl-vchip-go", (b) => b.map((x) => x.textContent))).join() === "Baustelle Probenau,Verteiler", "Neues Album „Verteiler“ aus dem Vollbild angelegt + Chip");
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
    const b = await page.$(sel); await b.scrollIntoViewIfNeeded(); const r = await b.boundingBox();
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
  // Verschieben: Foto 3 (nth=2) von Probenau nach Verteiler
  await page.click('[data-s="move"]');
  await page.click(`.sheet [data-pick="${verteiler.id}"]`);
  await page.waitForTimeout(300);
  ok((await page.$$(".gl-th")).length === 1, "Verschieben: 2 Fotos weg aus „Baustelle Probenau“");
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
  await page.waitForSelector(".gl-fhead");
  ok(page.url().endsWith("#alltag/galerie/k/f_bau"), "Zurück → Kategorie (Verlauf)");
  await page.click('[data-g="back"]');
  await page.waitForSelector(".gl-fgrid");
  ok(page.url().endsWith("#alltag/galerie"), "Zurück → Kategorien (Verlauf)");

  /* ---------- Import mit EXIF ---------- */
  await page.setInputFiles('.gl-head input[data-in="imp"]', [{ name: "IMG_20261014.jpg", mimeType: "image/jpeg", buffer: exifBuf }]);
  const aS = await until(() => albumByName(/Testheim/), "Album aus EXIF-GPS");
  ok(aS.name === "Am Testheim 10, Testheim-Au", "Import mit EXIF-GPS → Album „Am Testheim 10, Testheim-Au“");
  ok(aS.folderId === "f_bau", "Neues Adress-Album aus Import → Baustellen");
  const imp = await until(async () => (await idx()).find((x) => x.albumIds.includes(aS.id)), "importiertes Foto");
  ok(imp.dayKey === "2026-10-14" && new Date(imp.ts).getHours() === 9, "EXIF-Aufnahmezeit übernommen (14.10.2026, 09:41)");
  // Import ohne EXIF in „Verteiler“ (eigenes Album → Ohne Kategorie)
  ok(!verteiler.folderId, "Eigenes Album „Verteiler“ ohne Kategorie");
  await page.click(`.gl-fcard[data-folder="${G.OHNE_KAT}"]`);
  await page.waitForSelector(".gl-fhead");
  await page.click(`.gl-acard[data-album="${verteiler.id}"]`);
  await page.waitForSelector(".gl-ahead");
  await page.setInputFiles('.gl-aacts input[data-in="imp"]', [{ name: "a.jpg", mimeType: "image/jpeg", buffer: plainBuf }, { name: "b.jpg", mimeType: "image/jpeg", buffer: plainBuf }]);
  await until(async () => (await idx()).filter((x) => x.albumIds.includes(verteiler.id)).length === 4, "2 importiert in Verteiler");
  ok(true, "Mehrere Dateien ohne EXIF ins Album importiert (heute, ohne Ort)");
  const impToday = (await idx()).filter((x) => x.albumIds.includes(verteiler.id) && x.dayKey === TODAY).length;
  ok(impToday === 4, "Ohne EXIF: aktuelle Zeit");
  await page.click('[data-g="back"]');
  await page.waitForSelector(".gl-agrid");
  ok((await txt(".gl-agrid")).includes("Ohne Ort"), "Virtuelles Album „Ohne Ort“ (in „Ohne Kategorie“) für Fotos ohne Standort");
  await page.click('[data-g="back"]');
  await page.waitForSelector(".gl-fgrid");

  /* ---------- Alle Fotos: Filter & Suche ---------- */
  await page.click('.gl-tab[data-tab="alle"]');
  await page.waitForSelector(".gl-filters");
  const count = async () => (await txt('[data-g="count"]')).trim();
  ok((await count()) === "7 Fotos", "Alle Fotos: 7");
  ok((await page.$$eval(".gl-mh", (h) => h.map((x) => x.textContent))).join() === "November 2026,Oktober 2026,September 2026", "Nach Monaten gruppiert");
  await page.fill('[data-g="q"]', "testheim");
  await page.waitForTimeout(350);
  ok((await count()) === "1 Foto gefunden", "Suche „testheim“ (Adresse) → 1");
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
  // Kategorie-Filter
  const expectF = async (fid) => { const als = await albums(); const ids = new Set((await folders()).map((f) => f.id)); return G.filterItems(await idx(), { folderId: fid }, new Map(als.map((a) => [a.id, G.normAlbum(a)])), ids).length; };
  ok((await page.$$eval(".gl-fchip", (b) => b.map((x) => x.textContent.trim()))).join("|") === "Alle Kategorien|🏗️Baustellen|🏫Berufsschule|🏠Privat|🗂️Ohne Kategorie", "Kategorien als Filter-Chips");
  await page.click('.gl-fchip[data-ff="f_bau"]');
  const nBau = await expectF("f_bau");
  ok(nBau === 3 && (await count()) === `${nBau} Fotos gefunden`, `Kategorie-Filter „Baustellen“ → ${nBau}`);
  ok(!(await page.$(`.gl-chip[data-fa="${verteiler.id}"]`)) && await page.$(`.gl-chip[data-fa="${aF.id}"]`), "Album-Chips nur aus der gewählten Kategorie");
  await page.click(`.gl-chip[data-fa="${aF.id}"]`);
  ok((await count()) === "2 Fotos gefunden", "Kategorie + Album kombiniert → 2");
  await page.click(`.gl-fchip[data-ff="${G.OHNE_KAT}"]`);
  ok((await count()) === `${await expectF(G.OHNE_KAT)} Fotos gefunden`, "Filter „Ohne Kategorie“");
  await page.click('.gl-fchip[data-ff="f_bau"]');
  await shot("gl-alle-kat-390.png");
  await page.click('[data-g="clear"]');
  ok((await count()) === "7 Fotos", "Filter zurücksetzen (auch Kategorie)");
  await page.fill('[data-g="to"]', "2026-10-31");
  await page.dispatchEvent('[data-g="to"]', "change");
  ok((await count()) === "2 Fotos gefunden", "Zeitraum bis 31.10. → 2");
  await page.click('[data-g="clear"]');

  /* ---------- Album löschen: Fotos behalten / mitlöschen ---------- */
  await page.click('.gl-tab[data-tab="alben"]');
  await goHash(`#alltag/galerie/a/${verteiler.id}`, ".gl-ahead");
  await page.click('[data-g="amenu"]');
  await page.click('.sheet [data-m="del"]');
  await page.waitForSelector('.sheet [data-c="ok"]');
  await page.click('.sheet [data-c="ok"]');
  ok((await txt('.sheet [data-c="ok"]')) === "Wirklich löschen?", "Album löschen: zweiter Tipp nötig");
  await page.click('.sheet [data-c="ok"]');
  await page.waitForSelector(".gl-fgrid, .gl-agrid");
  ok(!(await albums()).some((a) => a.id === verteiler.id) && (await idx()).length === 7, "„Verteiler“ gelöscht, Fotos bleiben (7)");
  await goHash(`#alltag/galerie/a/${aS.id}`, ".gl-ahead");
  await page.click('[data-g="amenu"]');
  await page.click('.sheet [data-m="del"]');
  await page.check('.sheet input[value="all"]');
  ok((await txt('.sheet [data-c="ok"]')).includes("1 Foto löschen"), "Option „Fotos auch löschen“ zeigt Anzahl");
  await page.click('.sheet [data-c="ok"]'); await page.click('.sheet [data-c="ok"]');
  await page.waitForSelector(".gl-fgrid, .gl-agrid");
  await page.waitForTimeout(300);
  ok(!(await albums()).some((a) => a.id === aS.id) && (await idx()).length === 6, "Album + Foto gelöscht (6 übrig)");

  /* ---------- Neues Album, Einstellungen, GPS verweigert ---------- */
  await goHash("#alltag/galerie", ".gl-fgrid");
  await page.click('.gl-tools [data-g="newalbum"]');
  await page.fill('.sheet [data-n="name"]', "Vorher / Nachher");
  await page.click('.sheet [data-emoji="⭐"]');
  ok((await page.inputValue('.sheet [data-n="folder"]')) === "", "Neues Album: Kategorie-Auswahl (Standard „Ohne Kategorie“)");
  await page.selectOption('.sheet [data-n="folder"]', "f_privat");
  await page.click('.sheet [data-n="ok"]');
  await page.waitForSelector(".gl-ahead");
  ok((await txt('[data-g="aname"]')) === "Vorher / Nachher" && (await txt(".gl-ahead-ic")).includes("⭐"), "„+ Neues Album“ mit Emoji");
  const vn = await albumByName(/^Vorher \/ Nachher$/);
  ok(vn.folderId === "f_privat" && (await txt('[data-g="afolder"]')).includes("Privat"), "Neues Album gleich in Kategorie „Privat“");
  // Neues Album aus der Kategorie-Ansicht: Kategorie vorausgewählt
  await goHash("#alltag/galerie/k/f_schule", ".gl-fhead");
  await page.click('.gl-aacts [data-g="newalbum"]');
  ok((await page.inputValue('.sheet [data-n="folder"]')) === "f_schule", "Neues Album in Kategorie-Ansicht: Kategorie vorausgewählt");
  await closeSheet();
  await goHash("#alltag/galerie", ".gl-fgrid");
  await page.click('[data-g="settings"]');
  ok(await page.isChecked('.sheet [data-s="auto"]'), "Einstellung „automatisch nach Adresse“ standardmäßig an");
  ok((await page.inputValue('.sheet [data-s="autofolder"]')) === "f_bau", "„Neue Adress-Alben automatisch in Kategorie …“ = Baustellen (Standard)");
  await page.click('.sheet [data-rad="300"]');
  await page.click('.sheet [data-s="save"]');
  await page.waitForTimeout(200);
  ok((await gset()).radius === 300 && (await gset()).foldersInit === true && (await gset()).autoFolder === "f_bau", "Umkreis 300 m in settings.gallery gespeichert (Flag + Auto-Kategorie bleiben)");
  // GPS verweigert → Ohne Ort
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, err) => setTimeout(() => err({ code: 1, message: "denied" }), 10); });
  await page.evaluate(() => import("/js/gallery-albums.js").then((m) => m.forgetPosition()));
  await page.waitForTimeout(500); // Neuzeichnen nach dem Speichern abwarten (sonst trifft das change-Ereignis ein altes Feld)
  await page.setInputFiles('.gl-head input[data-in="cam"]', { name: "x.jpg", mimeType: "image/jpeg", buffer: IMG.p5 });
  await page.waitForSelector('.sheet [data-ph="save"]:not([disabled])');
  await page.click('.sheet [data-ph="save"]');
  await page.waitForTimeout(900);
  const ohne = (await idx()).filter((x) => !x.albumIds.length && x.lat === null);
  ok(ohne.length >= 3, "GPS verweigert → Foto ohne Album (Ohne Ort)");

  /* ---------- Hauptkategorien: anlegen, umbenennen, ordnen, Alben verschieben, löschen ---------- */
  const nPhotos = (await idx()).length;
  await goHash("#alltag/galerie", ".gl-fgrid");
  await page.click(".gl-fnew");
  await page.fill('.sheet [data-k="name"]', "Werkzeug & Material");
  await page.click('.sheet [data-emoji="🔧"]');
  await page.click('.sheet [data-color="#0d9488"]');
  ok((await txt('.sheet [data-k="pname"]')) === "Werkzeug & Material" && (await txt('.sheet [data-k="pemo"]')) === "🔧", "Blatt „+ Hauptkategorie“: Vorschau mit Name + Emoji");
  await shot("gl-kat-neu-390.png", false);
  await page.click('.sheet [data-k="ok"]');
  await page.waitForSelector(".sheet", { state: "detached" });
  const wz = (await folders()).find((f) => f.name === "Werkzeug & Material");
  ok(wz && wz.emoji === "🔧" && wz.color === "#0d9488" && wz.order === 3, "Hauptkategorie „🔧 Werkzeug & Material“ angelegt (Farbe, ans Ende)");
  await page.waitForSelector(`.gl-fcard[data-folder="${wz.id}"]`);
  ok(true, "Neue Kategorie-Karte erscheint");
  await page.click(`.gl-fcard[data-folder="${wz.id}"]`);
  await page.waitForSelector(".gl-fhead");
  ok((await txt(".gl-page .gl-empty")).includes("Noch keine Alben"), "Leere Kategorie: freundlicher Hinweis");
  await page.click(".gl-albar [data-fedit]");
  await page.fill('.sheet [data-k="name"]', "Werkzeug + Material");
  await page.click('.sheet [data-k="ok"]');
  await page.waitForSelector(".sheet", { state: "detached" });
  await page.waitForTimeout(150);
  ok((await txt('[data-g="fname"]')) === "Werkzeug + Material" && (await folders()).find((f) => f.id === wz.id).name === "Werkzeug + Material", "Kategorie umbenannt");
  await page.click(".gl-albar [data-fedit]");
  ok((await txt('.sheet [data-k="pos"]')) === "Platz 4 von 4" && await page.isDisabled('.sheet [data-k="down"]'), "Bearbeiten: Platz 4 von 4, „Nach unten“ gesperrt");
  await page.click('.sheet [data-k="up"]');
  await page.waitForTimeout(150);
  ok((await txt('.sheet [data-k="pos"]')) === "Platz 3 von 4", "„Nach oben“ im Blatt → Platz 3");
  await closeSheet();
  await page.click('[data-g="back"]');
  await page.waitForSelector(".gl-fgrid");
  const order = () => page.$$eval("[data-fsec], .gl-fcard[data-folder]", (b) => b.map((x) => x.dataset.fsec || x.dataset.folder));
  ok((await order()).join() === `f_bau,f_schule,${wz.id},f_privat,${G.OHNE_KAT}`, "Reihenfolge der Karten geändert");
  await page.click('[data-amode="liste"]');
  await page.waitForSelector(".gl-flist");
  ok((await page.$$(".gl-fsec")).length === 5 && (await page.$$(".gl-arow[data-album]")).length >= 6, "„Alles aufklappen“: Kategorien mit ihren Alben als Liste");
  ok(await page.isDisabled('[data-fsec="f_bau"] [data-fmove="-1"]') && await page.isDisabled('[data-fsec="f_privat"] [data-fmove="1"]'), "Erste kann nicht hoch, letzte nicht runter");
  await page.click(`[data-fsec="${wz.id}"] [data-fmove="-1"]`);
  await page.waitForTimeout(200);
  ok((await order()).join() === `f_bau,${wz.id},f_schule,f_privat,${G.OHNE_KAT}`, "↑ in der Liste: Werkzeug vor Berufsschule");
  ok((await folders()).find((f) => f.id === wz.id).order === 1, "Reihenfolge gespeichert");
  await shot("gl-liste-390.png");
  // einzeln: Album-Menü → Kategorie ändern
  await goHash(`#alltag/galerie/a/${vn.id}`, ".gl-ahead");
  await page.click('[data-g="amenu"]');
  await page.click('.sheet [data-m="folder"]');
  await page.waitForSelector(`.sheet [data-pickf="${wz.id}"]`);
  ok((await page.getAttribute('.sheet [data-pickf="f_privat"]', "aria-pressed")) === "true", "Kategorie-Auswahl zeigt die aktuelle (Privat)");
  await page.click(`.sheet [data-pickf="${wz.id}"]`);
  await page.waitForTimeout(200);
  ok((await albumOf(vn.id)).folderId === wz.id && (await txt('[data-g="afolder"]')).includes("Werkzeug"), "Album einzeln nach „Werkzeug + Material“ verschoben");
  // über den Kategorie-Knopf im Album
  await page.click('[data-g="afolder"]');
  await page.click('.sheet [data-pickf="f_bau"]');
  await page.waitForTimeout(200);
  ok((await albumOf(vn.id)).folderId === "f_bau", "Kategorie-Knopf im Album → Baustellen");
  await page.click('[data-g="afolder"]');
  await page.click(`.sheet [data-pickf="${wz.id}"]`);
  await page.waitForTimeout(200);
  // mehrere: langes Drücken in der Liste
  await goHash("#alltag/galerie", ".gl-flist");
  await longPress('.gl-arow[data-album="alOld"]');
  ok(await page.isVisible('[data-g="selbar"]') && (await txt('[data-g="selcount"]')) === "1 Album ausgewählt", "Langes Drücken auf ein Album startet die Alben-Auswahl");
  await page.click(`.gl-arow[data-album="${a3.id}"]`);
  ok((await txt('[data-g="selcount"]')) === "2 Alben ausgewählt" && page.url().endsWith("#alltag/galerie"), "Tippen wählt weitere Alben (öffnet nicht)");
  await shot("gl-asel-390.png", false);
  await page.click('[data-s="afolder"]');
  await page.click('.sheet [data-pickf="f_privat"]');
  await page.waitForTimeout(250);
  ok((await albumOf("alOld")).folderId === "f_privat" && (await albumOf(a3.id)).folderId === "f_privat", "2 Alben auf einmal „In Kategorie verschieben“ → Privat");
  ok(!(await page.isVisible('[data-g="selbar"]')), "Alben-Auswahl danach beendet");
  // Auswahl in der Kategorie-Ansicht (Karten): Langes Drücken + „Alle“
  await goHash("#alltag/galerie/k/f_privat", ".gl-fhead");
  await longPress(`.gl-acard[data-album="${a3.id}"]`);
  await page.click('[data-s="aall"]');
  ok((await txt('[data-g="selcount"]')) === "2 Alben ausgewählt", "Kategorie-Ansicht: langes Drücken + „Alle“ (2)");
  await page.click('[data-s="done"]');
  // Löschen 1: Privat → Ohne Kategorie
  await page.click(".gl-albar [data-fedit]");
  await page.click('.sheet [data-k="del"]');
  await page.waitForSelector('.sheet [data-c="ok"]');
  ok((await txt(".sheet")).includes("Fotos und Alben werden dabei nie gelöscht") && await page.isChecked('.sheet input[value="none"]'), "Kategorie löschen: Hinweis + Standard „Ohne Kategorie“");
  await page.click('.sheet [data-c="ok"]');
  ok((await txt('.sheet [data-c="ok"]')) === "Wirklich löschen?", "Kategorie löschen: zweiter Tipp nötig");
  await page.click('.sheet [data-c="ok"]');
  await page.waitForSelector(".gl-flist, .gl-fgrid");
  await page.waitForTimeout(200);
  ok(!(await folders()).some((f) => f.id === "f_privat"), "Kategorie „Privat“ gelöscht");
  ok(!(await albumOf("alOld")).folderId && !(await albumOf(a3.id)).folderId && (await idx()).length === nPhotos, "Ihre Alben → Ohne Kategorie, kein Foto gelöscht");
  // Löschen 2: Werkzeug → Baustellen
  await goHash(`#alltag/galerie/k/${wz.id}`, ".gl-fhead");
  await page.click(".gl-albar [data-fedit]");
  await page.click('.sheet [data-k="del"]');
  await page.waitForSelector('.sheet [data-d="target"]');
  await page.check('.sheet input[value="move"]');
  await page.selectOption('.sheet [data-d="target"]', "f_bau");
  await shot("gl-kat-del-390.png", false);
  await page.click('.sheet [data-c="ok"]'); await page.click('.sheet [data-c="ok"]');
  await page.waitForSelector(".gl-flist, .gl-fgrid");
  await page.waitForTimeout(200);
  ok(!(await folders()).some((f) => f.id === wz.id) && (await albumOf(vn.id)).folderId === "f_bau" && (await idx()).length === nPhotos, "Kategorie gelöscht, Alben in „Baustellen“ verschoben, Fotos bleiben");
  // Standard-Kategorie Berufsschule löschen → kommt nicht wieder
  await goHash("#alltag/galerie/k/f_schule", ".gl-fhead");
  await page.click(".gl-albar [data-fedit]");
  await page.click('.sheet [data-k="del"]');
  await page.click('.sheet [data-c="ok"]'); await page.click('.sheet [data-c="ok"]');
  await page.waitForSelector(".gl-flist, .gl-fgrid");
  ok(!(await albumOf("alLbs")).folderId, "Berufsschule gelöscht → Album ohne Kategorie");
  await page.reload();
  await page.waitForTimeout(600);
  if (await page.isVisible("#btn-local")) await page.click("#btn-local");
  await page.waitForTimeout(400);
  await goHash("#alltag/galerie", ".gl-flist");
  await page.waitForTimeout(600);
  ok((await folders()).map((f) => f.id).join() === "f_bau" && (await page.$$(".gl-fsec")).length === 2, "Nach Neuladen: gelöschte Standard-Kategorien kommen nicht wieder");
  await page.click('[data-amode="karten"]');
  await page.waitForSelector(".gl-fgrid");

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
  await ctx.setGeolocation(PROBENAU);
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
  await page.waitForSelector(".gl-fgrid");
  ok(!(await page.$(".sheet")), "Tages-Blatt → „Alle Fotos in der Galerie“");

  /* ---------- Update 9 (Agent U): aktive Kategorie „Neue Fotos gehen nach …“ ---------- */
  const waName = (i) => `${WSTR[i]}, Musterstadt`;
  const chipTxt = async (sel) => (await page.innerText(sel)).replace(/\s+/g, " ").trim();
  const gaToast = async (re) => until(async () => { const t = await page.evaluate(() => { const e = document.getElementById("ga-toast"); return e && !e.hidden ? e.textContent : ""; }); return re.test(t) ? t : null; }, "Toast " + re);
  const openCam = async (buf, name) => {
    await page.setInputFiles("[data-r=photo] label[data-ph-cam] input.ph-file", { name, mimeType: "image/jpeg", buffer: buf });
    await page.waitForSelector('.sheet [data-ph="save"]:not([disabled])');
  };
  const noDrive = () => page.evaluate(() => { const e = document.getElementById("drive-toast"); if (e) e.hidden = true; });
  const saveCam = async () => { await page.click('.sheet [data-ph="save"]'); await page.waitForSelector(".sheet", { state: "detached" }); };
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForSelector("[data-r=photo] .ph-cam", { state: "visible" });
  // 1) Kategorie „Wohnungen“ direkt im Aufnahme-Blatt anlegen
  await ctx.setGeolocation(W[0]);
  await openCam(IMG.p1, "w1.jpg");
  ok(/Kategorie: 🏗️ Baustellen/.test(await chipTxt('.sheet [data-ga="chip"]')), "Aufnahme-Blatt: Chip „📂 Kategorie: 🏗️ Baustellen ▾“");
  await noDrive();
  await shot("ga-capture-390.png", false);
  await page.click('.sheet [data-ga="chip"]');
  await page.waitForSelector('.sheet [data-gp="new"]');
  ok((await page.$$('.sheet [data-gpick]')).length === 2, "Auswahl: alle Hauptkategorien + „Keine Kategorie“");
  await page.click('.sheet [data-gp="new"]');
  await page.fill('.sheet [data-gp="name"]', "Wohnungen");
  await page.click('.sheet [data-gemo="🏠"]');
  await noDrive();
  await shot("ga-picker-390.png", false);
  await page.click('.sheet [data-gp="create"]');
  await page.waitForFunction(() => document.querySelectorAll(".sheet").length === 1);
  const fW = await until(async () => (await folders()).find((f) => f.name === "Wohnungen"), "Kategorie Wohnungen angelegt");
  ok(fW.emoji === "🏠" && (await gset()).activeFolderId === fW.id, "„+ Neue Hauptkategorie“ im Aufnahme-Blatt: 🏠 Wohnungen angelegt und aktiv (settings.gallery.activeFolderId)");
  await page.waitForTimeout(150);
  ok(/Kategorie: 🏠 Wohnungen/.test(await chipTxt('.sheet [data-ga="chip"]')), "Chip im Aufnahme-Blatt zeigt sofort 🏠 Wohnungen");
  await saveCam();
  // 2) drei Fotos an drei Adressen → drei Alben in Wohnungen
  const t1 = await gaToast(/Wohnungen › Musterstraße 5, Musterstadt/);
  ok(t1.includes("In „Wohnungen › Musterstraße 5, Musterstadt“ gespeichert") && t1.includes("Ändern"), "Toast: „In „Wohnungen › Musterstraße 5, Musterstadt“ gespeichert“ + Ändern");
  await noDrive();
  await shot("ga-toast-390.png", false);
  for (const i of [1, 2]) {
    await ctx.setGeolocation(W[i]);
    await page.waitForTimeout(300);
    await openCam(IMG.p2, `w${i + 1}.jpg`);
    await saveCam();
    await gaToast(new RegExp(`Wohnungen › ${WSTR[i]}`));
  }
  const wAlb = [];
  for (const i of [0, 1, 2]) wAlb.push(await until(async () => (await albums()).find((a) => a.name === waName(i)), "Album " + i));
  ok(wAlb.every((a) => a.folderId === fW.id && a.kind === "address") && new Set(wAlb.map((a) => a.id)).size === 3, "3 Fotos an 3 Adressen → 3 Alben, alle in 🏠 Wohnungen");
  // 3) Foto an bekannter Adresse → Album bleibt, wo es ist
  const nAlb0 = (await albums()).length;
  const liebFolder = (await albumOf(a3.id)).folderId || null;
  await ctx.setGeolocation(PROBENAU);
  await page.waitForTimeout(300);
  await openCam(IMG.p3, "lieb.jpg");
  await saveCam();
  await gaToast(/Baustelle Probenau/);
  ok((await albums()).length === nAlb0 && ((await albumOf(a3.id)).folderId || null) === liebFolder, "Foto an bestehender Album-Adresse → kein neues Album, Kategorie bleibt");
  await ctx.setGeolocation(W[1]);
  await page.waitForTimeout(300);
  await openCam(IMG.p3, "w2b.jpg");
  await saveCam();
  await gaToast(/Wohnungen › Mustergasse 12/);
  ok((await albums()).length === nAlb0, "Zurück an Adresse 2 → dasselbe Album in Wohnungen");
  // 4) in der Galerie (Kopf) auf Baustellen umschalten → nächste neue Adresse dorthin
  await goHash("#alltag/galerie", ".gl-active [data-ga=chip]");
  ok(/Neue Fotos gehen nach.*🏠 Wohnungen/.test(await chipTxt(".gl-active")), "Galerie-Kopf: „Neue Fotos gehen nach 📂 Kategorie: 🏠 Wohnungen ▾“");
  ok((await txt(".gl-hint")).includes("🏠 Wohnungen"), "Alben-Reiter: Hinweis nennt die aktive Kategorie");
  await page.click(".gl-active [data-ga=chip]");
  await page.click('.sheet [data-gpick="f_bau"]');
  await page.waitForSelector(".sheet", { state: "detached" });
  await page.waitForTimeout(150);
  ok((await gset()).activeFolderId === "f_bau" && /🏗️ Baustellen/.test(await chipTxt(".gl-active")), "Umgeschaltet auf 🏗️ Baustellen");
  await ctx.setGeolocation(W[3]);
  await page.waitForTimeout(300);
  await page.setInputFiles('.gl-head input[data-in="cam"]', { name: "w4.jpg", mimeType: "image/jpeg", buffer: IMG.p4 });
  await page.waitForSelector('.sheet [data-ph="save"]:not([disabled])');
  ok(/🏗️ Baustellen/.test(await chipTxt('.sheet [data-ga="chip"]')), "Aufnahme aus der Galerie: Chip zeigt Baustellen");
  await saveCam();
  await gaToast(/Baustellen › Testerstraße 40/);
  const w4 = await until(async () => (await albums()).find((a) => a.name === waName(3)), "Album 4");
  ok(w4.folderId === "f_bau", "Nächste neue Adresse → Baustellen");
  ok((await albumOf(wAlb[0].id)).folderId === fW.id, "Frühere Wohnungen-Alben bleiben in Wohnungen");
  // 5) Einstellung bleibt nach Neuladen
  await page.click(".gl-active [data-ga=chip]");
  await page.click(`.sheet [data-gpick="${fW.id}"]`);
  await page.waitForSelector(".sheet", { state: "detached" });
  await page.reload();
  await page.waitForTimeout(600);
  if (await page.isVisible("#btn-local")) await page.click("#btn-local");
  await goHash("#alltag/galerie", ".gl-active [data-ga=chip]");
  await page.waitForTimeout(300);
  ok((await gset()).activeFolderId === fW.id && /🏠 Wohnungen/.test(await chipTxt(".gl-active")), "Nach Neuladen: aktive Kategorie 🏠 Wohnungen gemerkt");
  await page.click('[data-g="settings"]');
  ok((await page.inputValue('.sheet [data-s="autofolder"]')) === fW.id, "Einstellungen zeigen dieselbe aktive Kategorie (eine Quelle)");
  await closeSheet();
  // 6) Ort-Vorgabe: Firma → Foto-Kategorie Baustellen
  await page.evaluate(() => { location.hash = "#orte"; });
  await page.waitForTimeout(500);
  await page.click(".place-item[data-id=pF]");
  await page.waitForSelector("#pf-photofolder option[value=f_bau]", { state: "attached" });
  await page.selectOption("#pf-photofolder", "f_bau");
  await noDrive();
  await shot("ga-place-390.png", false);
  await page.click(".sheet [data-r=save]");
  await page.waitForSelector(".sheet", { state: "detached" });
  ok(await page.evaluate(() => import("/js/store.js").then((m) => m.get().places.find((p) => p.id === "pF").photoFolderId)) === "f_bau", "Ort „Firma“: Foto-Kategorie gespeichert");
  await page.evaluate(() => import("/js/store.js").then((m) => { const r = m.get().running; return m.setRunning({ ...r, placeId: "pF", place: "Firma Elektro Maier", segments: r.segments.map((x) => ({ ...x, placeId: "pF", place: "Firma Elektro Maier" })) }); }));
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForSelector("[data-r=photo] .ph-cam", { state: "visible" });
  await ctx.setGeolocation(W[4]);
  await page.waitForTimeout(300);
  await openCam(IMG.p5, "w5.jpg");
  const pc = await chipTxt('.sheet [data-ga="chip"]');
  ok(/🏗️ Baustellen/.test(pc) && pc.includes("(von Ort Firma Elektro Maier)"), "Eingestempelt bei Firma: Chip „🏗️ Baustellen (von Ort Firma Elektro Maier)“");
  await noDrive();
  await shot("ga-capture-place-390.png", false);
  await saveCam();
  await gaToast(/Baustellen › Fiktivstraße 8/);
  ok((await albums()).find((a) => a.name === waName(4)).folderId === "f_bau" && (await gset()).activeFolderId === fW.id, "Neue Adresse während Ort-Schicht → Baustellen, eigene Wahl bleibt Wohnungen");
  await page.evaluate(() => import("/js/store.js").then((m) => { const r = m.get().running; return m.setRunning({ ...r, placeId: null, place: "", segments: r.segments.map((x) => ({ ...x, placeId: null, place: "" })) }); }));
  // 7) Einsatz-Banner (einmal pro Tag)
  await page.evaluate(async (today) => { const A = await import("/js/gallery-albums.js"); await A.setActiveFolder("f_bau"); const m = await import("/js/store.js"); await m.saveTodo({ kind: "einsatz", title: "Wohnungen Musterviertel", date: today }); }, TODAY);
  await goHash("#alltag/galerie", ".gl-active .ga-ez");
  ok((await chipTxt(".gl-active .ga-ez")).includes("Heute Einsatz „Wohnungen Musterviertel“ – Fotos nach 🏠 Wohnungen?"), "Banner: „Heute Einsatz „Wohnungen Musterviertel“ – Fotos nach 🏠 Wohnungen?“");
  await noDrive();
  await shot("ga-banner-390.png", false);
  await page.click('.gl-active [data-ga="ezno"]');
  await page.waitForTimeout(150);
  ok(!(await page.$(".gl-active .ga-ez")) && (await gset()).activeFolderId === "f_bau", "✕ blendet aus, Kategorie bleibt");
  await page.reload();
  await page.waitForTimeout(600);
  if (await page.isVisible("#btn-local")) await page.click("#btn-local");
  await goHash("#alltag/galerie", ".gl-active [data-ga=chip]");
  await page.waitForTimeout(300);
  ok(!(await page.$(".gl-active .ga-ez")), "Heute nicht noch einmal vorgeschlagen");
  await page.evaluate(() => localStorage.removeItem("sk-ga-ez"));
  await goHash("#heute", "[data-r=photo]"); await goHash("#alltag/galerie", ".gl-active .ga-ez");
  await page.click('.gl-active [data-ga="ezyes"]');
  await page.waitForTimeout(200);
  ok((await gset()).activeFolderId === fW.id && !(await page.$(".gl-active .ga-ez")) && /🏠 Wohnungen/.test(await chipTxt(".gl-active")), "„Ja“ schaltet auf 🏠 Wohnungen, Banner weg");
  // 8) „Ändern“ im Toast: neues Album in andere Kategorie, Foto in anderes Album
  await ctx.setGeolocation(W[5]);
  await page.waitForTimeout(300);
  await page.setInputFiles('.gl-head input[data-in="cam"]', { name: "w6.jpg", mimeType: "image/jpeg", buffer: IMG.p1 });
  await page.waitForSelector('.sheet [data-ph="save"]:not([disabled])');
  await saveCam();
  await gaToast(/Wohnungen › Beispielhofstraße 2/);
  const w6 = await until(async () => (await albums()).find((a) => a.name === waName(5)), "Album 6");
  await page.click("#ga-toast .ga-toast-b");
  await page.waitForSelector('.sheet [data-gcf="f_bau"]');
  ok((await txt('.sheet [data-gc="dest"]')) === "Wohnungen › Beispielhofstraße 2, Musterstadt", "„Ändern“ öffnet „Foto einsortieren“ mit Ziel");
  await noDrive();
  await shot("ga-change-390.png", false);
  await page.click('.sheet [data-gcf="f_bau"]');
  await page.waitForTimeout(200);
  ok((await albumOf(w6.id)).folderId === "f_bau" && (await txt('.sheet [data-gc="dest"]')) === "Baustellen › Beispielhofstraße 2, Musterstadt", "Neues Album per „Ändern“ nach Baustellen verschoben");
  const ph6 = (await idx()).find((x) => x.albumIds.includes(w6.id));
  await page.click(`.sheet [data-gca="${wAlb[0].id}"]`);
  await page.waitForSelector(".sheet", { state: "detached" });
  await until(async () => (await idx()).find((x) => x.id === ph6.id && x.albumIds.includes(wAlb[0].id) && !x.albumIds.includes(w6.id)), "Foto verschoben");
  ok(!(await albums()).some((a) => a.id === w6.id), "Foto per „Ändern“ in anderes Album, leeres neues Album entfernt");
  // 9) Schnell-Korrektur: Alben der letzten 14 Tage aus anderen Kategorien holen
  await goHash(`#alltag/galerie/k/${fW.id}`, ".gl-fhead");
  await page.click('[data-g="pull"]');
  await page.waitForSelector(`.sheet [data-pull="${w4.id}"]`);
  ok(!(await page.$(`.sheet [data-pull="${wAlb[0].id}"]`)), "Holen-Liste: nur Alben anderer Kategorien");
  await page.click(`.sheet [data-pull="${w4.id}"]`);
  ok((await txt('.sheet [data-pl="ok"]')) === "1 Album hierher holen", "Auswahl zählt mit");
  await noDrive();
  await shot("ga-pull-390.png", false);
  await page.click('.sheet [data-pl="ok"]');
  await page.waitForSelector(".sheet", { state: "detached" });
  await page.waitForTimeout(200);
  ok((await albumOf(w4.id)).folderId === fW.id && !!(await page.$(`.gl-acard[data-album="${w4.id}"]`)), "„Alben aus anderer Kategorie hierher holen“ → Testerstraße 40 jetzt in Wohnungen");
  await shot("ga-kat-wohnungen-390.png");

  /* ---------- Screenshots ---------- */
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector('.al-tile[data-id="galerie"]');
  ok((await txt('.al-tile[data-id="galerie"]')).includes("Fotos nach Baustelle & Adresse"), "Kachel „Galerie“ im Alltag");
  await page.click('.al-tile[data-id="galerie"]');
  await page.waitForSelector(".gl-fgrid");
  await shot("gl-alben2-390.png");
  const state = await page.evaluate(() => ({ ls: { ...localStorage } }));

  for (const [scheme, vp, name] of [["dark", { width: 390, height: 844 }, "390-dark"], ["light", { width: 1440, height: 900 }, "1440"], ["dark", { width: 1440, height: 900 }, "1440-dark"]]) {
    const c2 = await browser.newContext({ viewport: vp, colorScheme: scheme, permissions: ["geolocation"], geolocation: MUSTERDORF });
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
      // für die Screenshots wieder ein paar Kategorien
      const fS = await A.createFolder({ name: "Berufsschule", emoji: "🏫", color: "#2563eb" });
      const fW = await A.createFolder({ name: "Werkzeug & Material", emoji: "🔧", color: "#0d9488" });
      await A.createFolder({ name: "Privat", emoji: "🏠", color: "#16a34a" });
      const by = (re) => A.albums().filter((a) => re.test(a.name)).map((a) => a.id);
      await A.setAlbumsFolder(by(/Landesberufsschule/), fS.id);
      await A.setAlbumsFolder(by(/Vorher/), fW.id);
      await A.setAlbumsFolder(by(/Ideen/), fW.id);
      const als = A.albums();
      const toFile = (b64, n) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], n, { type: "image/jpeg" }); };
      let i = 0;
      for (const a of als) for (let k = 0; k < 3; k++) {
        const b64 = imgs[i++ % imgs.length];
        await photos.addPhoto(toFile(b64, "f.jpg"), { albumIds: [a.id], ts: Date.now() - i * 3600e3 * 7, note: k === 0 ? "Notiz" : "", lat: a.lat, lng: a.lng, addr: a.addr || "" });
      }
    }, Object.values(IMG).map((b) => b.toString("base64")));
    await p2.evaluate(() => { location.hash = "#alltag/galerie"; });
    await p2.waitForSelector(".gl-fgrid");
    await p2.waitForTimeout(400);
    await shot(`gl-alben-${name}.png`, true, p2);
    await p2.click('[data-amode="liste"]');
    await p2.waitForSelector(".gl-flist");
    await shot(`gl-liste-${name}.png`, true, p2);
    await p2.click('[data-amode="karten"]');
    await p2.click('.gl-fcard[data-folder="f_bau"]');
    await p2.waitForSelector(".gl-fhead");
    await shot(`gl-kat-${name}.png`, true, p2);
    await p2.click('[data-g="back"]');
    await p2.waitForSelector(".gl-fgrid");
    await p2.click('.gl-tab[data-tab="alle"]');
    await p2.waitForSelector(".gl-th");
    await p2.click('.gl-fchip[data-ff="f_bau"]');
    await shot(`gl-alle-${name}.png`, true, p2);
    await p2.click('[data-g="clear"]');
    await p2.click(".gl-th >> nth=1");
    await p2.waitForSelector(".ph-view");
    await shot(`gl-viewer-${name}.png`, false, p2);
    await p2.keyboard.press("Escape");
    await p2.click('.gl-tab[data-tab="alben"]');
    await p2.click('.gl-fcard[data-folder="f_bau"]');
    await p2.waitForSelector(".gl-fhead");
    await p2.click(".gl-acard[data-album] >> nth=0");
    await p2.waitForSelector(".gl-ahead");
    await p2.click('[data-g="select"]');
    await p2.click(".gl-th >> nth=0");
    await shot(`gl-album-${name}.png`, false, p2);
    if (name === "390-dark") {
      await p2.click('[data-s="done"]');
      // Update 9 (Agent U) – aktive Kategorie dunkel: Galerie-Kopf + Auswahl + Aufnahme-Blatt
      await p2.evaluate(() => { localStorage.removeItem("sk-ga-ez"); location.hash = "#alltag/galerie"; });
      await p2.waitForSelector(".gl-active [data-ga=chip]");
      await p2.evaluate(() => import("/js/gallery-albums.js").then((A) => A.setActiveFolder("f_bau")));
      await p2.waitForSelector(".gl-active .ga-ez");
      await shot(`ga-banner-${name}.png`, false, p2);
      await p2.click(".gl-active [data-ga=chip]");
      await p2.click('.sheet [data-gp="new"]');
      await shot(`ga-picker-${name}.png`, false, p2);
      await p2.click(".sheet .close");
      await p2.evaluate(() => { location.hash = "#heute"; });
      await p2.waitForSelector("[data-r=photo] .ph-cam", { state: "visible" });
      await p2.setInputFiles("[data-r=photo] label[data-ph-cam] input.ph-file", { name: "d.jpg", mimeType: "image/jpeg", buffer: IMG.p2 });
      await p2.waitForSelector('.sheet [data-ph="save"]:not([disabled])');
      await shot(`ga-capture-${name}.png`, false, p2);
      await p2.click(".sheet .close");
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
