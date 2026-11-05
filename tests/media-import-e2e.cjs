// Playwright-Test: Kamera-Fotos übernehmen (Update 9, Agent W3) – Web-Import mit EXIF + App-Ablauf mit gefälschtem Capacitor.
//   cd <worktree> && python3 -m http.server 8864 &   then   node tests/media-import-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8864/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const exifDate = (d) => `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const at = (dayOffset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d; };

const MUSTERDORF = { lat: 47.01098, lng: 15.50511 };
const FIRMA = { lat: 47.0402, lng: 15.4089 };

function nominatimFor(lat, lng) {
  const near = (p, m) => Math.hypot((lat - p.lat) * 111320, (lng - p.lng) * 75900) < m;
  if (near(MUSTERDORF, 300)) return { address: { house_number: "1", road: "Erika-Muster-Straße", village: "Musterdorf", postcode: "8074" } };
  if (near(FIRMA, 300)) return { address: { house_number: "5", road: "Erfundene Straße", city: "Musterstadt", postcode: "8020" } };
  return { address: { village: "Irgendwo" } };
}

(async () => {
  const G = await import(path.resolve(__dirname, "../js/gallery-core.js"));
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };

  async function newPage(viewport = { width: 390, height: 844 }, init = null) {
    const ctx = await browser.newContext({ viewport, colorScheme: "light", permissions: ["geolocation"], geolocation: { latitude: 47.3, longitude: 15.1 } });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      if (u.hostname === "nominatim.openstreetmap.org") {
        const lat = Number(u.searchParams.get("lat")), lng = Number(u.searchParams.get("lon"));
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(nominatimFor(lat, lng)) });
      }
      return route.abort();
    });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
    return { ctx, page };
  }
  const helpers = (page) => ({
    shot: async (name, full = false) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(OUT, name), fullPage: full }); },
    idx: () => page.evaluate(() => import("/js/photos.js").then((m) => m.listIndex({ refresh: true }))),
    albums: () => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-photo_albums") || "[]")),
    imports: () => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-photo_imports") || "[]")),
    until: async (fn, msg, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("FEHLER (Zeit): " + msg); await page.waitForTimeout(120); } },
  });

  const seed = async (page, data) => {
    await page.evaluate(async (d) => {
      localStorage.clear();
      for (const [k, v] of Object.entries(d.ls)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      await new Promise((res) => { const r = indexedDB.deleteDatabase("stempelkarte-photos"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    }, data);
  };
  const FOLDERS = [
    { id: "f_bau", name: "Baustellen", emoji: "🏗️", color: "#d97706", order: 0, created: 1 },
    { id: "f_schule", name: "Berufsschule", emoji: "🏫", color: "#2563eb", order: 1, created: 2 },
    { id: "f_privat", name: "Privat", emoji: "🏠", color: "#16a34a", order: 2, created: 3 },
    { id: "fWohn", name: "Wohnungen", emoji: "🏠", color: "#7c3aed", order: 3, created: 4 },
  ];
  const PLACES = [{ id: "pF", name: "Firma Elektro Maier", addr: "Erfundene Straße 5, 8020 Musterstadt", lat: FIRMA.lat, lng: FIRMA.lng, radius: 150, photoFolderId: "fWohn" }];

  /* ======================= 1) Web: Import mit EXIF ======================= */
  let { page, ctx } = await newPage();
  let H = helpers(page);
  await page.goto(BASE);
  const jpeg = async (color, label) => Buffer.from((await page.evaluate(([c, l]) => {
    const cv = document.createElement("canvas"); cv.width = 800; cv.height = 600;
    const g = cv.getContext("2d"); g.fillStyle = c; g.fillRect(0, 0, 800, 600);
    g.fillStyle = "#fff"; g.font = "bold 84px sans-serif"; g.fillText(l, 40, 330);
    return cv.toDataURL("image/jpeg", 0.85);
  }, [color, label])).split(",")[1], "base64");
  const withExif = async (color, label, d, pos) => Buffer.from(G.injectExif(await jpeg(color, label), G.buildExifSegment({ date: exifDate(d), ...(pos || {}) })));
  // gestern: Arbeit 07:00–15:30 (07:00 Fahrt, 07:30 Arbeiten bei Firma, 15:00 Privatfahrt)
  const Y = (h, m) => at(-1, h, m).getTime();
  const entryY = { id: "eY", start: Y(7, 0), end: Y(15, 30), pauseMin: 30, placeId: "pF", place: "Firma Elektro Maier", note: "", people: [], inLoc: null, outLoc: null,
    segments: [
      { start: Y(7, 0), end: Y(7, 30), activity: "Autofahren", placeId: null, place: "", loc: { lat: 47.05, lng: 15.45 } },
      { start: Y(7, 30), end: Y(15, 0), activity: "Arbeiten", placeId: "pF", place: "Firma Elektro Maier", loc: null },
      { start: Y(15, 0), end: Y(15, 30), activity: "Autofahren", placeId: null, place: "", loc: null, private: true },
    ] };
  const F = {
    f1: await withExif("#0369a1", "09:15 Musterdorf", at(-1, 9, 15), MUSTERDORF),
    f2: await withExif("#047857", "10:30 ohne GPS", at(-1, 10, 30)),
    f3: await withExif("#be123c", "15:10 privat", at(-1, 15, 10), { lat: 47.2, lng: 15.6 }),
    f4: await withExif("#7c3aed", "19:45 Firma", at(-1, 19, 45), FIRMA),
    f5: await withExif("#b45309", "vorgestern", at(-2, 9, 0), MUSTERDORF),
  };
  const files = (names) => names.map((n) => ({ name: `IMG_${n}.jpg`, mimeType: "image/jpeg", buffer: F[n] }));
  await seed(page, { ls: {
    "stempelkarte.local.v1": { entries: [entryY], todos: [], days: {}, places: PLACES, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5, gallery: { foldersInit: true, activeFolderId: "f_bau", autoFolder: "f_bau" } } },
    "sk-a-photo_folders": FOLDERS,
  } });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(500);
  await page.evaluate(() => { location.hash = "alltag/galerie"; });
  await page.waitForSelector(".mi-card");
  ok(await page.isVisible(".mi-card .mi-pick"), "Galerie: Karte „📥 Fotos von heute importieren“ sichtbar");
  ok((await page.textContent('[data-mi="picklbl"]')).trim() === "Fotos von heute importieren", "Knopf-Text „Fotos von heute importieren“");
  ok(!(await page.$('[data-mi="native"]')), "Im Browser kein App-Knopf");
  await H.shot("mi-card-light.png");
  await page.click('[data-mi-day]:nth-child(2)');
  ok((await page.textContent('[data-mi="picklbl"]')).trim() === "Fotos von gestern importieren", "„Gestern“ gewählt → „Fotos von gestern importieren“");
  ok((await page.getAttribute(".mi-file", "accept")) === "image/*" && (await page.$eval(".mi-file", (e) => e.multiple)), "Mehrfachauswahl accept=image/*");

  await page.setInputFiles(".mi-file", files(["f1", "f2", "f3", "f4", "f5"]));
  await page.waitForSelector(".mi-sheet .mi-tile");
  const tiles = async () => page.$$eval(".mi-tile", (ts) => ts.map((t) => ({ on: t.getAttribute("aria-pressed") === "true", dis: t.disabled, cap: t.querySelector(".mi-cap").textContent, cls: t.className })));
  let tl = await tiles();
  ok(tl.length === 5, "Vorschau: 5 Fotos");
  const byCap = (re) => tl.find((t) => re.test(t.cap));
  ok(byCap(/^09:15/).on && byCap(/^10:30/).on, "09:15 und 10:30 (Arbeitszeit) vorausgewählt");
  ok(!byCap(/^15:10/).on && /privat/.test(byCap(/^15:10/).cap), "15:10 (Privatfahrt) ausgegraut „privat“");
  ok(!byCap(/^19:45/).on && /außerhalb der Arbeitszeit/.test(byCap(/^19:45/).cap), "19:45 ausgegraut „außerhalb der Arbeitszeit“");
  ok(!byCap(/^09:00/).on && /anderer Tag/.test(byCap(/^09:00/).cap), "Foto von vorgestern: „anderer Tag“, nicht ausgewählt");
  ok(/2 Fotos übernehmen/.test(await page.textContent('[data-mi="go"]')), "Knopf „📥 2 Fotos übernehmen“");
  ok(await page.isVisible(".mi-sheet .mi-hint") && /Standortinformationen speichern/.test(await page.textContent(".mi-sheet .mi-hint")), "Xiaomi-Hinweis (ein Foto ohne GPS)");
  await H.shot("mi-preview-light.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await H.shot("mi-preview-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  // Umschalten: 19:45 an, wieder aus
  await page.click(".mi-tile:has-text('19:45')");
  ok(/3 Fotos/.test(await page.textContent('[data-mi="go"]')), "Antippen wählt ausgegrautes Foto aus");
  await page.click(".mi-tile:has-text('19:45')");
  ok(/2 Fotos/.test(await page.textContent('[data-mi="go"]')), "… und wieder ab");
  // Fortschritt beobachten
  const progSeen = page.waitForSelector(".mi-prog", { timeout: 5000 }).then(() => true).catch(() => false);
  await page.click('[data-mi="go"]');
  ok(await progSeen, "Fortschritt wird angezeigt");
  await page.waitForSelector(".mi-sheet", { state: "detached", timeout: 30000 });
  let list = await H.until(async () => { const l = await H.idx(); return l.length === 2 && l.every((x) => x.albumIds.length) ? l : null; }, "2 Fotos importiert und einsortiert");
  const p1 = list.find((x) => new Date(x.ts).getHours() === 9);
  const p2 = list.find((x) => new Date(x.ts).getHours() === 10);
  ok(p1.dayKey === key(at(-1, 0)) && new Date(p1.ts).getMinutes() === 15, "ts = EXIF-Aufnahmezeit (gestern 09:15)");
  ok(Math.abs(p1.lat - MUSTERDORF.lat) < 1e-5, "lat/lng aus EXIF");
  ok(p2.placeId === "pF" && Math.abs(p2.lat - FIRMA.lat) < 1e-6, "ohne GPS: Ort + Position der Arbeitszeit (Firma)");
  let al = await H.albums();
  const aG = al.find((a) => /Musterdorf/.test(a.name));
  const aF = al.find((a) => a.kind === "place" && a.placeId === "pF");
  ok(aG && p1.albumIds.includes(aG.id), "Foto 09:15 → Adress-Album „Erika-Muster-Straße 1, Musterdorf“");
  ok(aF && p2.albumIds.includes(aF.id), "Foto 10:30 → Ort-Album „Firma Elektro Maier“");
  ok(aG.folderId === "fWohn", "Neues Adress-Album → Kategorie zur Aufnahmezeit (Ort-Vorgabe „Wohnungen“, nicht aktuell „Baustellen“)");
  ok(aF.folderId === "fWohn", "Ort-Album → Foto-Kategorie des Orts");
  ok((await H.imports()).length === 2, "2 Fingerabdrücke in a_photo_imports");

  // Re-Import: Doppelte gesperrt; Regel „an meinen Orten“ → 19:45 bei Firma vorausgewählt
  await page.evaluate(() => import("/js/media-import.js").then((m) => m.saveSettings({ rule: "work_or_place" })));
  await page.setInputFiles(".mi-file", files(["f1", "f2", "f4"]));
  await page.waitForSelector(".mi-sheet .mi-tile");
  tl = await tiles();
  ok(byCap(/^09:15/).dis && /schon übernommen/.test(byCap(/^09:15/).cap) && byCap(/^10:30/).dis, "Re-Import: schon übernommene Fotos gesperrt");
  ok(byCap(/^19:45/).on && /Firma/.test(byCap(/^19:45/).cap), "Regel „Arbeitszeit oder an meinen Orten“: 19:45 bei Firma vorausgewählt");
  await page.click(".mi-allnone [data-mi=\"all\"]");
  ok(/1 Foto übernehmen/.test(await page.textContent('[data-mi="go"]')), "„Alle“ wählt keine Doppelten");
  await page.click('[data-mi="go"]');
  await page.waitForSelector(".mi-sheet", { state: "detached", timeout: 30000 });
  list = await H.until(async () => { const l = await H.idx(); return l.length === 3 && l.every((x) => x.albumIds.length) ? l : null; }, "3. Foto importiert");
  ok(list.find((x) => new Date(x.ts).getHours() === 19).albumIds.includes(aF.id), "19:45 → Ort-Album Firma");
  // alles nochmal → nichts Neues
  await page.setInputFiles(".mi-file", files(["f1", "f2", "f4"]));
  await page.waitForSelector(".mi-sheet .mi-tile");
  ok(await page.$eval('[data-mi="go"]', (b) => b.disabled && /Nichts Neues/.test(b.textContent)), "Gleiche Fotos nochmal → „Nichts Neues“, keine Duplikate");
  await page.click('[data-mi="cancel"]');
  await page.waitForTimeout(300);
  ok((await H.idx()).length === 3 && (await H.imports()).length === 3, "Weiterhin 3 Fotos, 3 Fingerabdrücke");
  // Einstellungen (Browser)
  await page.click('[data-g="settings"]');
  await page.waitForSelector(".mi-set");
  ok(!(await page.$("[data-mi-perm]")) && (await page.$eval('[data-mi-s="rule"]', (s) => s.value)) === "work_or_place", "⚙: Regel-Auswahl (ohne App-Teile im Browser)");
  await page.selectOption('[data-mi-s="rule"]', "work");
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => import("/js/store.js").then((m) => m.get().settings.mediaImport.rule))) === "work", "Regel gespeichert");
  await page.click(".sheet .close");
  await page.waitForTimeout(200);
  await page.emulateMedia({ colorScheme: "dark" });
  await H.shot("mi-card-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  // PC-Ansicht
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setInputFiles(".mi-file", files(["f3", "f5"]));
  await page.waitForSelector(".mi-sheet .mi-tile");
  await H.shot("mi-preview-1440.png");
  await page.click('[data-mi="cancel"]');
  await ctx.close();

  /* ======================= 2) App: gefälschtes Capacitor ======================= */
  const thumbOf = async (buf) => "data:image/jpeg;base64," + buf.toString("base64");
  const now = Date.now();
  const runStart = now - 2 * 3600e3;
  const NI = [
    { id: 101, dateTaken: now - 3600e3, displayName: "IMG_101.jpg", size: F.f1.length, width: 800, height: 600, lat: MUSTERDORF.lat, lng: MUSTERDORF.lng, img: F.f1 },
    { id: 102, dateTaken: now - 1800e3, displayName: "IMG_102.jpg", size: F.f2.length, width: 800, height: 600, img: F.f2 },
    { id: 103, dateTaken: runStart - 600e3, displayName: "IMG_103.jpg", size: F.f3.length, width: 800, height: 600, lat: 47.2, lng: 15.6, img: F.f3 },
  ];
  const fake = { items: [] };
  for (const x of NI) { const { img, ...rest } = x; fake.items.push({ ...rest, thumb: await thumbOf(img), data: img.toString("base64") }); }
  const extra = (() => { const { img, ...rest } = { id: 104, dateTaken: now - 300e3, displayName: "IMG_104.jpg", size: F.f4.length, width: 800, height: 600, img: F.f4 }; return { ...rest, data: F.f4.toString("base64") }; })();
  extra.thumb = "data:image/jpeg;base64," + extra.data;
  const initNative = `(() => {
    const FAKE = ${JSON.stringify(fake)};
    const EXTRA = ${JSON.stringify(extra)};
    window.__mi = { calls: [], items: FAKE.items, listeners: {}, extra: EXTRA };
    const log = (m, a) => window.__mi.calls.push([m, a ? JSON.parse(JSON.stringify(a)) : null]);
    const StempelMedia = {
      status: async () => { log("status"); return { access: "full", location: true, notifications: true, sdk: 35 }; },
      requestPermission: async () => { log("requestPermission"); return { access: "full", location: true }; },
      listNew: async (a) => { log("listNew", a); const ids = new Set(window.__mi.marked || []); return { items: window.__mi.items.filter((x) => x.dateTaken >= a.since && !ids.has(String(x.id))).map(({ data, ...r }) => (a.thumbs ? r : { ...r, thumb: undefined })) }; },
      readImage: async (a) => { log("readImage", a); const x = window.__mi.items.find((i) => String(i.id) === String(a.id)); return { data: x.data, thumb: x.thumb, w: x.width, h: x.height }; },
      markImported: async (a) => { log("markImported", a); window.__mi.marked = [...(window.__mi.marked || []), ...(a.ids || []), ...(a.skipped || [])]; return {}; },
      configure: async (a) => { log("configure", a); return {}; },
      takePending: async () => { log("takePending"); return { open: false }; },
      openSettings: async () => { log("openSettings"); return {}; },
      addListener: (ev, cb) => { window.__mi.listeners[ev] = cb; return Promise.resolve({ remove() {} }); },
    };
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { StempelMedia } };
  })();`;
  ({ page, ctx } = await newPage({ width: 390, height: 844 }, initNative));
  H = helpers(page);
  await page.goto(BASE);
  const runSeg = { start: runStart, activity: "Arbeiten", placeId: "pF", place: "Firma Elektro Maier", loc: null };
  await seed(page, { ls: {
    "stempelkarte.local.v1": { entries: [], todos: [], days: {}, places: PLACES, running: { start: runStart, segments: [runSeg], placeId: "pF", place: "Firma Elektro Maier", note: "", people: [], pauseStart: null, pauseMs: 0, inLoc: null }, rev: Date.now(), settings: { weeklyTarget: 38.5, gallery: { foldersInit: true, activeFolderId: "f_bau", autoFolder: "f_bau" } } },
    "sk-a-photo_folders": FOLDERS,
    "sk-mi-since": String(now - 86400e3),
    "sk-mi-offered": String(now), // kein automatisches Anbieten beim Start (testen wir gezielt)
  } });
  await page.reload();
  await page.click("#btn-local");
  await H.until(() => page.evaluate(() => window.__mi.calls.some((c) => c[0] === "configure")), "configure() an die App");
  const cfg = await page.evaluate(() => window.__mi.calls.filter((c) => c[0] === "configure").pop()[1]);
  ok(cfg.running === runStart && cfg.rule === "work" && cfg.places.length === 1 && cfg.notify === true, "configure: laufende Schicht, Regel, Orte, Benachrichtigung");
  ok(await page.evaluate(() => typeof window.__mi.listeners.importRequested === "function"), "Listener „importRequested“ (Tippen auf Benachrichtigung)");
  await page.evaluate(() => { location.hash = "alltag/galerie?import=native"; });
  await page.waitForSelector(".mi-sheet .mi-tile", { timeout: 10000 });
  ok(page.url().endsWith("#alltag/galerie"), "?import=native wird aus der Adresse entfernt");
  let ntl = await page.$$eval(".mi-tile", (ts) => ts.map((t) => ({ on: t.getAttribute("aria-pressed") === "true", cap: t.querySelector(".mi-cap").textContent })));
  ok(ntl.length === 3 && ntl.filter((t) => t.on).length === 2, "App-Vorschau: 3 neue Kamera-Fotos, 2 (in der Schicht) vorausgewählt");
  ok(/außerhalb der Arbeitszeit/.test(ntl.find((t) => !t.on).cap), "Foto vor Schichtbeginn ausgegraut");
  ok(await page.isVisible('.mi-card [data-mi="native"]'), "Galerie-Karte: Knopf „📱 Neue Kamera-Fotos“ (nur App)");
  await H.shot("mi-native-preview-light.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await H.shot("mi-native-preview-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await page.click('[data-mi="go"]');
  await page.waitForSelector(".mi-sheet", { state: "detached", timeout: 30000 });
  list = await H.until(async () => { const l = await H.idx(); return l.length === 2 && l.every((x) => x.albumIds.length) ? l : null; }, "2 App-Fotos importiert + einsortiert");
  const calls = await page.evaluate(() => window.__mi.calls);
  const reads = calls.filter((c) => c[0] === "readImage");
  ok(reads.length === 2 && reads.every((c) => c[1].maxSide === 1280 && c[1].quality === 0.72), "readImage({id, maxSide:1280, quality:0.72}) je ausgewähltem Foto");
  const mk = calls.filter((c) => c[0] === "markImported").pop();
  ok(mk && mk[1].ids.sort().join() === "101,102" && mk[1].skipped.join() === "103", "markImported({ids:[101,102], skipped:[103]})");
  const n1 = list.find((x) => Math.abs(x.ts - NI[0].dateTaken) < 1000), n2 = list.find((x) => Math.abs(x.ts - NI[1].dateTaken) < 1000);
  ok(n1 && Math.abs(n1.lat - MUSTERDORF.lat) < 1e-6 && n2 && n2.placeId === "pF", "ts = DATE_TAKEN; GPS aus der App bzw. Ort der laufenden Schicht");
  al = await H.albums();
  const naG = al.find((a) => /Musterdorf/.test(a.name));
  ok(naG && n1.albumIds.includes(naG.id) && naG.folderId === "fWohn", "App-Foto → Adress-Album in Kategorie der laufenden Schicht (Ort-Vorgabe)");
  ok((await H.imports()).filter((d) => d.src === "native" && /^n:10[12]:/.test(d.fp)).length === 2, "Fingerabdrücke n:<_ID>:<DATE_TAKEN> gespeichert");
  // neues Foto + Benachrichtigung antippen
  await page.evaluate(() => { window.__mi.items.push(window.__mi.extra); window.__mi.listeners.importRequested({}); });
  await page.waitForSelector(".mi-sheet .mi-tile", { timeout: 10000 });
  ntl = await page.$$eval(".mi-tile", (ts) => ts.map((t) => t.getAttribute("aria-pressed") === "true"));
  ok(ntl.length === 1 && ntl[0], "Benachrichtigung → nur das neue Foto, vorausgewählt");
  await page.click('[data-mi="go"]');
  await page.waitForSelector(".mi-sheet", { state: "detached", timeout: 30000 });
  await H.until(async () => (await H.idx()).length === 3, "3. App-Foto");
  // nochmal: nichts Neues; Doppelte auch ohne markImported-Filter
  await page.evaluate(() => { window.__mi.marked = []; localStorage.setItem("sk-mi-since", String(Date.now() - 86400e3)); });
  await page.click('.mi-card [data-mi="native"]');
  await page.waitForSelector(".mi-sheet .mi-tile", { timeout: 10000 });
  ok(await page.$eval('[data-mi="go"]', (b) => b.disabled) && (await page.$$(".mi-tile[disabled]")).length === 3, "Erneut gelistet → schon übernommene gesperrt (Fingerabdruck)");
  await page.click('[data-mi="cancel"]');
  await page.waitForTimeout(300);
  ok((await H.idx()).length === 3, "Keine Duplikate");
  // Automatisch ohne Nachfrage
  await page.evaluate(async () => {
    const m = await import("/js/media-import.js"); await m.saveSettings({ auto: true });
    window.__mi.items.push({ ...window.__mi.extra, id: 105, dateTaken: Date.now() - 60e3, displayName: "IMG_105.jpg" });
    localStorage.setItem("sk-mi-since", String(Date.now() - 120e3));
    await m.openNativeImport({ silent: true });
  });
  await H.until(async () => (await H.idx()).length === 4, "still übernommen");
  ok(!(await page.$(".mi-sheet")), "„Automatisch übernehmen ohne Nachfrage“: ohne Vorschau übernommen");
  // Einstellungs-Karte (App)
  await page.click('[data-g="settings"]');
  await page.waitForSelector(".mi-set [data-mi-perm] .mi-pill");
  ok(/Kamera-Fotos automatisch übernehmen/.test(await page.textContent(".mi-set-h")) && /erlaubt/.test(await page.textContent("[data-mi-perm]")), "⚙ App: „Kamera-Fotos automatisch übernehmen“ mit Berechtigungs-Status");
  ok(await page.isChecked('[data-mi-s="auto"]') && await page.isChecked('[data-mi-s="notify"]'), "Schalter automatisch/Benachrichtigung");
  await page.uncheck('[data-mi-s="notify"]');
  await H.until(() => page.evaluate(() => { const c = window.__mi.calls.filter((x) => x[0] === "configure").pop(); return c && c[1].notify === false; }), "Benachrichtigung aus → configure");
  ok(true, "Benachrichtigung aus wird an die App gemeldet");
  await page.$eval(".mi-set", (e) => e.scrollIntoView());
  await H.shot("mi-settings-native-light.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await H.shot("mi-settings-native-dark.png");
  await ctx.close();

  /* ---------- Teil-Zugriff ---------- */
  ({ page, ctx } = await newPage({ width: 390, height: 844 }, initNative.replace('access: "full", location: true, notifications', 'access: "partial", location: false, notifications')));
  await page.goto(BASE);
  await page.click("#btn-local");
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = "alltag/galerie"; });
  await page.waitForSelector(".mi-card");
  await page.click('[data-g="settings"]');
  await page.waitForSelector('[data-mi-s="opensettings"]');
  ok(/nur ausgewählte Fotos/.test(await page.textContent("[data-mi-perm]")), "Teil-Zugriff: erklärt + „Einstellungen öffnen“");
  await page.click('[data-mi-s="opensettings"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => window.__mi.calls.some((c) => c[0] === "openSettings")), "openSettings() aufgerufen");
  await ctx.close();

  await browser.close();
  if (errors.length) { console.error("Konsolenfehler:\n" + errors.join("\n")); process.exit(1); }
  console.log("Alles gut – keine Konsolenfehler.");
})().catch((e) => { console.error(e); process.exit(1); });
