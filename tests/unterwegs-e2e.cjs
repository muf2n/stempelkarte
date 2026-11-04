// Playwright-Test für Alltag › Unterwegs (lokaler Modus).
//   cd <worktree> && python3 -m http.server 8853 &   then   node tests/unterwegs-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen, Geolocation über den Kontext mit fester (dann wandernder) Position.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8853/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n) => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + n); return key(d); };
const CAR = { latitude: 48.16, longitude: 14.03, accuracy: 8 };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", geolocation: CAR, permissions: ["geolocation", "notifications", "clipboard-read", "clipboard-write"] });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await ctx.addInitScript(() => {
    window.__notes = [];
    const rec = (t, o) => window.__notes.push({ t, body: o && o.body });
    if (window.ServiceWorkerRegistration) ServiceWorkerRegistration.prototype.showNotification = function (t, o) { rec(t, o); return Promise.resolve(); };
    const N = window.Notification;
    if (N) { const F = function (t, o) { rec(t, o); }; F.permission = "granted"; F.requestPermission = () => Promise.resolve("granted"); window.Notification = F; void N; }
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name, full = true) => { await page.waitForTimeout(450); return page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const txt = (s) => page.textContent(s);
  const ls = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), k);
  const tab = async (id) => { await page.click(`.uw-tab[data-tab="${id}"]`); await page.waitForTimeout(150); };

  await page.goto(BASE);
  await page.click("#btn-local");
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector('.al-tile[data-id="unterwegs"]');
  ok((await txt('.al-tile[data-id="unterwegs"]')).includes("Reisen, Packlisten, Parkplatz, Tanken"), "Kachel „Unterwegs“ auf der Alltag-Seite");
  await shot("uw-tiles-390.png");
  await page.click('.al-tile[data-id="unterwegs"]');
  await page.waitForSelector(".uw-tabs");
  ok((await page.$$(".uw-tab")).length === 5, "5 Unterreiter");
  ok((await txt(".uw-page")).includes("Noch keine Reisen"), "Leerer Zustand Reisen");

  /* ---------- Reise + Titelbild ---------- */
  await page.click("[data-uw=newtrip]");
  await page.fill("#uw-t-title", "Sommer in Kroatien");
  await page.fill("#uw-t-dest", "Split");
  await page.fill("#uw-t-from", inDays(23));
  await page.dispatchEvent("#uw-t-from", "change");
  await page.fill("#uw-t-to", inDays(32));
  await page.dispatchEvent("#uw-t-to", "change");
  ok((await txt(".uw-t-nights")) === "9 Nächte", "Nächte werden berechnet");
  await page.fill("#uw-t-budget", "800");
  // großes Testbild (4000×3000, Rauschen → schwer komprimierbar)
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 4000; c.height = 3000;
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 4000, 3000); grd.addColorStop(0, "#f59e0b"); grd.addColorStop(.5, "#0ea5e9"); grd.addColorStop(1, "#1e3a8a");
    g.fillStyle = grd; g.fillRect(0, 0, 4000, 3000);
    for (let i = 0; i < 25000; i++) { g.fillStyle = `hsl(${Math.random() * 360},70%,${30 + Math.random() * 50}%)`; g.fillRect(Math.random() * 4000, Math.random() * 3000, 14, 14); }
    return c.toDataURL("image/jpeg", 0.95).split(",")[1];
  });
  const big = Buffer.from(b64, "base64");
  ok(big.length > 1500000, `Testbild ist groß (${Math.round(big.length / 1024)} kB)`);
  await page.setInputFiles("#uw-t-img", { name: "florenz.jpg", mimeType: "image/jpeg", buffer: big });
  await page.waitForFunction(() => document.querySelector(".uw-img-info") && document.querySelector(".uw-img-info").dataset.w, null, { timeout: 15000 });
  const info = await page.evaluate(() => ({ ...document.querySelector(".uw-img-info").dataset }));
  ok(Number(info.w) <= 1280 && Number(info.w) >= 640 && Math.abs(Number(info.w) / Number(info.h) - 4 / 3) < 0.01, `Bild auf ≤ 1280 px verkleinert, Seitenverhältnis bleibt (${info.w}×${info.h})`);
  ok(Number(info.bytes) < 300 * 1024, `Bild < 300 kB (${Math.round(info.bytes / 1024)} kB)`);
  await page.click(".sheet [data-save]");
  await page.waitForSelector(".uw-hero.has-img", { timeout: 5000 });
  ok((await txt(".uw-hero")).includes("noch 23 Tage"), "Countdown „noch 23 Tage“");
  ok((await txt(".uw-hero")).includes("9 Nächte"), "Nächte im Kopf");
  const trips = await ls("sk-a-travel_trips");
  ok(trips.length === 1 && trips[0].imageId && !JSON.stringify(trips[0]).includes("data:image"), "Bild liegt nicht im Reise-Dokument (eigene Ablage)");
  const inIdb = await page.evaluate((id) => new Promise((res) => { const r = indexedDB.open("stempelkarte-unterwegs", 1); r.onsuccess = () => { const q = r.result.transaction("images").objectStore("images").get(id); q.onsuccess = () => res(q.result ? q.result.data.length : 0); }; }), trips[0].imageId);
  ok(inIdb > 10000, "Bild in travel_images (lokal IndexedDB)");

  /* ---------- Packliste der Reise aus Vorlage ---------- */
  await page.click('[data-pk=fortrip][data-tpl=sommer]');
  await page.waitForSelector(".uw-trip-pack .uw-pack");
  const prog = () => page.getAttribute(".uw-trip-pack .uw-prog", "data-pct");
  ok((await txt(".uw-trip-pack .uw-prog")).includes("50 Gegenstände"), "Vorlage „Urlaub Sommer“: 50 Gegenstände");
  ok(await prog() === "0", "Fortschritt 0 %");
  const firstCat = ".uw-trip-pack .uw-cats > .uw-pc:first-child";
  ok(!!(await page.$(firstCat + ".open")), "erste Kategorie aufgeklappt");
  ok((await txt(`${firstCat} .uw-pc-cnt`)).trim() === "0/6", "Zähler 0/6");
  await page.click(`${firstCat} .uw-it:nth-child(1) [data-pk=check]`);
  await page.click(`${firstCat} .uw-it:nth-child(2) [data-pk=check]`);
  await page.waitForTimeout(100);
  ok((await txt(`${firstCat} .uw-pc-cnt`)).trim() === "2/6", "Zähler 2/6 nach zwei Häkchen");
  ok(await prog() === "4", "Fortschritt 4 % (2/50)");
  await page.fill(`${firstCat} .uw-add input[name=n]`, "Reisepass-Kopie");
  await page.fill(`${firstCat} .uw-add input[name=q]`, "2");
  await page.press(`${firstCat} .uw-add input[name=n]`, "Enter");
  await page.waitForTimeout(150);
  ok((await txt(`${firstCat} .uw-pc-cnt`)).trim() === "2/7", "Gegenstand hinzugefügt (2/7)");
  ok((await txt(`${firstCat} .uw-it:last-child`)).includes("×2"), "Menge ×2");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.name === "n"), "Fokus bleibt im Hinzufügen-Feld");
  await page.click(`${firstCat} .uw-it:last-child [data-pk=qplus]`);
  await page.waitForTimeout(120);
  ok((await txt(`${firstCat} .uw-it:last-child`)).includes("×3"), "Menge erhöhen");
  // andere Kategorie aufklappen
  await page.click('.uw-trip-pack .uw-pc:nth-child(3) [data-pk=toggle]');
  ok((await page.$$(".uw-trip-pack .uw-pc.open")).length === 2, "Kategorie aufklappen");
  await shot("uw-trip-390-light.png");
  // Bearbeiten: umsortieren + löschen
  await page.click(".uw-trip-pack [data-pk=edit]");
  const names = () => page.$$eval(`${firstCat} .uw-it-name`, (els) => els.map((e) => e.value));
  const before = await names();
  await page.click(`${firstCat} .uw-it:nth-child(2) [data-pk=iup]`);
  await page.waitForTimeout(120);
  const after = await names();
  ok(after[0] === before[1] && after[1] === before[0], "Umsortieren mit ▲");
  await page.click(`${firstCat} .uw-it:last-child [data-pk=idel]`);
  await page.waitForTimeout(120);
  ok((await names()).length === 6, "Gegenstand entfernt");
  await page.click(".uw-trip-pack [data-pk=edit]");
  // Teilen als Text (Zwischenablage)
  await page.evaluate(() => { try { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); } catch {} });
  await page.click(".uw-trip-pack [data-pk=share]");
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip.includes("☑") && clip.includes("Wichtiges (2/6)"), "Packliste als Text geteilt");
  // Zurücksetzen (zweimal tippen)
  await page.click(".uw-trip-pack [data-pk=reset]");
  await page.click(".uw-trip-pack [data-pk=reset]");
  await page.waitForTimeout(100);
  ok(await prog() === "0", "Alles zurücksetzen → 0 %");

  /* ---------- Budget + Geld ---------- */
  await page.click("[data-uw=newexp]");
  await page.fill("#uw-e-amt", "120,50");
  await page.click('.sheet [data-q="Unterkunft"]');
  await page.check("#uw-e-book");
  await page.click(".sheet [data-save]");
  await page.waitForTimeout(250);
  ok((await txt(".uw-budget")).includes("120,50 €") && (await txt(".uw-budget")).includes("679,50 €"), "Budget: ausgegeben 120,50 €, übrig 679,50 €");
  const tx = await ls("sk-a-money_tx");
  ok(tx.some((t) => t.category === "reisen" && t.amount === 120.5 && t.type === "out"), "Ausgabe in Geld gebucht (Kategorie Reisen)");

  /* ---------- Reiseplan ---------- */
  await page.click('.uw-plan .uw-h-row [data-uw=newplan]');
  await page.fill("#uw-p-time", "10:00");
  await page.fill("#uw-p-place", "Diokletianpalast, Split");
  await page.fill("#uw-p-note", "Tickets online");
  await page.click(".sheet [data-save]");
  await page.waitForTimeout(150);
  const href = await page.getAttribute(".uw-plan .uw-maps", "href");
  ok(href === "https://www.google.com/maps/search/?api=1&query=Diokletianpalast%2C%20Split", "„In Google Maps öffnen“-Link");
  ok((await txt(".uw-plan")).includes("Tag 1"), "Reiseplan Tag für Tag");
  await page.fill("#uw-t-docs", "Pass in der Lade, Buchung ABC123");
  await page.dispatchEvent("#uw-t-docs", "change");
  await page.waitForTimeout(150);
  ok((await ls("sk-a-travel_trips"))[0].docs.includes("ABC123"), "Dokumente-Hinweis gespeichert");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("uw-trip-full-390-light.png");

  await page.click("[data-uw=closetrip]");
  ok(!!(await page.$(".uw-trip.has-img")), "Reise-Karte mit Titelbild");
  await shot("uw-reisen-390-light.png");

  /* ---------- Packlisten-Reiter ---------- */
  await tab("packen");
  ok((await page.$$(".uw-tpl")).length >= 5, "Vorlagen: Wochenende, Urlaub Sommer, Skiurlaub, Montage + leer");
  ok((await txt(".uw-page")).includes("Sommer in Kroatien") && (await txt(".uw-page")).includes("Reise · 0/50 gepackt"), "Reise-Liste in Übersicht");
  await page.click('[data-pk=fromtpl][data-tpl=montage]');
  await page.waitForSelector(".uw-pack-head");
  ok((await txt(".uw-pack-head")).includes("Montage (Arbeit)"), "Liste aus Vorlage „Montage“");
  await page.click('.uw-pc:nth-child(3) [data-pk=toggle]');
  ok((await txt(".uw-pack")).includes("Zweipoliger Spannungsprüfer"), "Montage-Vorlage enthält Werkzeug");
  await shot("uw-packen-390-light.png");
  await page.click("[data-pk=savetpl]");
  await page.fill("#uw-tpl-name", "Meine Montage");
  await page.click(".sheet [data-save]");
  await page.waitForTimeout(150);
  await page.click("[data-uw=closelist]");
  ok((await txt(".uw-page")).includes("Eigene Vorlagen") && (await txt(".uw-page")).includes("Meine Montage"), "Eigene Vorlage gespeichert");
  for (const k of ["wochenende", "ski"]) {
    await page.click(`[data-pk=fromtpl][data-tpl=${k}]`);
    await page.waitForSelector(".uw-pack-head");
    await page.click("[data-uw=closelist]");
  }
  ok((await page.$$(".uw-listrow")).length === 5, "Listen aus allen Vorlagen angelegt");

  /* ---------- Parkplatz ---------- */
  await tab("parken");
  ok((await txt(".uw-park")).includes("Hier geparkt"), "Knopf „Hier geparkt“");
  await page.click("[data-pa=here]");
  await page.waitForSelector(".uw-park-card");
  const park = (await ls("sk-a-travel_parking"))[0];
  ok(Math.abs(park.lat - CAR.latitude) < 1e-6 && park.acc === 8 && park.active, "Position mit Genauigkeit gespeichert");
  ok((await page.getAttribute("[data-pa=nav]", "href")) === "https://www.google.com/maps/dir/?api=1&destination=48.160000,14.030000&travelmode=walking", "Navigation starten → Google Maps zu Fuß");
  await page.waitForTimeout(400);
  ok((await txt(".uw-park-dist b")) === "Du bist da!", "Am Auto: „Du bist da!“");
  // weggehen: 300 m südlich
  await ctx.setGeolocation({ latitude: 48.16 - 0.0027, longitude: 14.03, accuracy: 6 });
  await page.waitForFunction(() => { const d = document.querySelector(".uw-park-dist"); return d && Number(d.dataset.m) > 250; }, null, { timeout: 8000 });
  let m = Number(await page.getAttribute(".uw-park-dist", "data-m"));
  ok(m > 280 && m < 320, `Entfernung ≈ 300 m (${m} m)`);
  ok((await txt(".uw-park-dist")).includes("Richtung Norden"), "Richtung Norden");
  const rot = await page.$eval(".uw-park-arrow", (e) => e.style.transform);
  ok(/rotate\((0|0\.0|360|359\.\d)/.test(rot) || rot === "rotate(0deg)", "Pfeil zeigt nach Norden (" + rot + ")");
  // weiter: östlich
  await ctx.setGeolocation({ latitude: 48.16, longitude: 14.03 - 0.006, accuracy: 6 });
  await page.waitForFunction(() => document.querySelector(".uw-park-dist") && document.querySelector(".uw-park-dist").textContent.includes("Osten"), null, { timeout: 8000 });
  m = Number(await page.getAttribute(".uw-park-dist", "data-m"));
  ok(m > 400 && m < 480, `Position wandert → ≈ 446 m Richtung Osten (${m} m)`);
  // Kompass simulieren: nach Osten schauen → Pfeil zeigt geradeaus
  await page.evaluate(() => { const e = new Event("deviceorientationabsolute"); Object.assign(e, { absolute: true, alpha: 270 }); window.dispatchEvent(e); });
  const rot2 = await page.$eval(".uw-park-arrow", (e) => e.style.transform);
  const deg = Number(/rotate\((-?[\d.]+)deg\)/.exec(rot2)[1]);
  ok(Math.abs(((deg % 360) + 360) % 360) < 2 || Math.abs(((deg % 360) + 360) % 360 - 360) < 2, `Kompass: Pfeil relativ zur Blickrichtung (${rot2})`);
  // Details
  await page.click("[data-pa=edit]");
  await page.fill("#uw-p-level", "−2");
  await page.fill("#uw-p-spot", "B 47");
  await page.fill("#uw-p-note", "neben dem Lift");
  const tiny = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1600; c.height = 1200; const g = c.getContext("2d"); g.fillStyle = "#64748b"; g.fillRect(0, 0, 1600, 1200); g.fillStyle = "#fde047"; g.font = "bold 300px sans-serif"; g.fillText("B47", 300, 700); return c.toDataURL("image/png").split(",")[1]; });
  await page.setInputFiles("#uw-p-photo", { name: "p.png", mimeType: "image/png", buffer: Buffer.from(tiny, "base64") });
  await page.waitForSelector(".sheet .uw-photo-prev img");
  await page.click(".sheet [data-save]");
  await page.waitForSelector(".uw-park-photo img");
  ok((await txt(".uw-park-facts")).includes("B 47"), "Ebene/Stellplatz/Notiz/Foto gespeichert");
  // Timer: 30 min
  await page.click('[data-pa=timer][data-min="30"]');
  await page.waitForSelector(".uw-park-timer-top");
  ok((await txt(".uw-park-left")).startsWith("noch 30 min") || (await txt(".uw-park-left")).startsWith("noch 29 min"), "Parkschein-Timer läuft (noch 30 min)");
  ok((await txt(".uw-park-timer")).includes("Erinnerung 10 Min vorher"), "Erinnerung geplant");
  ok((await page.evaluate(() => window.__notes.length)) === 0, "noch keine Benachrichtigung");
  // Timer auf in 9 Minuten → Erinnerung sofort fällig
  await page.click("[data-pa=timeroff]");
  await page.click("[data-pa=timerat]");
  const t9 = await page.evaluate(() => { const d = new Date(Date.now() + 9 * 60000 + 30000); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); });
  await page.fill("#uw-pt", t9);
  await page.click(".sheet [data-save]");
  await page.waitForFunction(() => window.__notes.length > 0, null, { timeout: 5000 });
  const note = await page.evaluate(() => window.__notes[0]);
  ok(/^Parkschein läuft in (9|10) Min ab$/.test(note.t), `Benachrichtigung „${note.t}“`);
  ok(note.body.includes("neben dem Lift"), "Benachrichtigung mit Notiz");
  await shot("uw-parken-390-light.png");
  await page.click("[data-pa=leave]");
  await page.click("[data-pa=leave]");
  await page.waitForSelector(".uw-park-empty");
  ok((await page.$$(".uw-park-hist li")).length === 1, "Verlauf: 1 Eintrag");
  // 11× parken → nur 10 im Verlauf
  for (let i = 0; i < 11; i++) {
    await ctx.setGeolocation({ latitude: 48.2 + i * 0.001, longitude: 14.03, accuracy: 10 });
    await page.click("[data-pa=here]");
    await page.waitForSelector(".uw-park-card");
    await page.waitForTimeout(60);
  }
  ok((await ls("sk-a-travel_parking")).length === 10, "Nur die letzten 10 Parkplätze bleiben");
  ok((await ls("sk-a-travel_parking")).filter((p) => p.active).length === 1, "Genau ein aktiver Parkplatz");

  /* ---------- Tanken ---------- */
  await tab("tanken");
  ok((await txt(".uw-page")).includes("Noch keine Tankungen"), "Leerer Zustand Tanken");
  const fills = [
    [inDays(-60), "40", "60", "10000", true, false, "OMV Wels"],
    [inDays(-45), "20", "30", "10400", false, false, "BP"],
    [inDays(-30), "20", "32", "10800", true, true, "Shell"],
    [inDays(-1), "35", "56,00", "11.300", true, false, "OMV Wels"],
  ];
  for (const [d, l, e, km, full, book, st] of fills) {
    await page.click(".uw-fab");
    await page.fill("#uw-f-date", d);
    await page.fill("#uw-f-l", l);
    await page.fill("#uw-f-e", e);
    await page.fill("#uw-f-km", km);
    await page.fill("#uw-f-st", st);
    await page.setChecked("#uw-f-full", full);
    await page.setChecked("#uw-f-book", book);
    await page.click(".sheet [data-save]");
    await page.waitForTimeout(150);
  }
  // Ø = (20+20+35) l / 1300 km = 5,77 → „5,8“
  ok((await txt(".uw-fuel-hero")).includes("5,8"), "Ø Verbrauch 5,8 l/100 km");
  ok((await txt(".uw-fuel-hero")).includes("über 1.300 km"), "über 1.300 km");
  const st = await page.evaluate(() => window.__uwTest.C.fuelStats(JSON.parse(localStorage.getItem("sk-a-travel_fuel"))));
  ok(Math.abs(st.avgL100 - 5.769) < 0.01 && Math.abs(st.eurKm - 118 / 1300) < 0.001, "Berechnung l/100 km und €/km");
  const cons = await page.$$eval(".uw-cons", (els) => els.map((e) => Number(e.dataset.l100)));
  ok(cons.length >= 1 && cons.some((v) => Math.abs(v - 7) < 0.01), "Einzelverbrauch 7,0 l/100 km bei der letzten Volltankung");
  ok(!!(await page.$(".uw-fuel .uw-chart")), "SVG-Diagramm");
  ok((await ls("sk-a-money_tx")).some((t) => t.category === "auto" && t.amount === 32), "Tankung in Geld gebucht (Auto)");
  await page.click("[data-fu=mprev]");
  ok((await page.$$(".uw-fill")).length >= 1, "Monat zurück zeigt ältere Tankungen");
  await page.click("[data-fu=mnext]");
  await shot("uw-tanken-390-light.png");

  /* ---------- Adressen ---------- */
  await tab("adressen");
  const places = [
    ["Dr. Huber (Hausarzt)", "arzt", "Hauptstraße 12, 4600 Wels", "+43 7242 123456", "Mo–Fr 8–12"],
    ["Werkstatt Müller", "werkstatt", "Industriestraße 5, 4600 Wels", "07242 98765", ""],
    ["Oma Gerti", "familie", "Linzer Straße 3, 4070 Eferding", "+43 664 1112233", "Sonntag Mittagessen"],
  ];
  for (const [n, c, a, p, no] of places) {
    await page.click(".uw-fab");
    await page.fill("#uw-a-name", n);
    await page.click(`.sheet [data-k=${c}]`);
    await page.fill("#uw-a-addr", a);
    await page.fill("#uw-a-tel", p);
    await page.fill("#uw-a-notes", no);
    await page.click(".sheet [data-save]");
    await page.waitForTimeout(120);
  }
  ok((await page.$$(".uw-place")).length === 3, "3 Adressen");
  ok((await page.getAttribute('.uw-place:has-text("Huber") a[href^="tel:"]', "href")) === "tel:+437242123456", "Tippen zum Anrufen (tel:)");
  ok((await page.getAttribute('.uw-place:has-text("Huber") a[href*="maps/dir"]', "href")).includes("Hauptstra%C3%9Fe%2012"), "Route → Google Maps");
  await page.fill("#uw-pl-q", "muller");
  await page.waitForTimeout(100);
  ok((await page.$$(".uw-place")).length === 1 && (await txt(".uw-place")).includes("Müller"), "Suche ohne Umlaut findet „Müller“");
  await page.fill("#uw-pl-q", "wels");
  await page.waitForTimeout(100);
  ok((await page.$$(".uw-place")).length === 2, "Suche nach Ort");
  await page.fill("#uw-pl-q", "1112233");
  await page.waitForTimeout(100);
  ok((await page.$$(".uw-place")).length === 1 && (await txt(".uw-place")).includes("Oma"), "Suche nach Telefonnummer");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "uw-pl-q"), "Fokus bleibt im Suchfeld");
  await page.fill("#uw-pl-q", "");
  await page.click('[data-pl=cat][data-cat=arzt]');
  ok((await page.$$(".uw-place")).length === 1, "Kategorie-Filter");
  await page.click('[data-pl=cat][data-cat=""]');
  await shot("uw-adressen-390-light.png");

  /* ---------- Geld zeigt Kategorie „Reisen“ ---------- */
  await page.evaluate(() => { location.hash = "#alltag/geld"; });
  await page.waitForSelector(".mn-tabs");
  await page.click('.mn-tab[data-tab="buchungen"]');
  await page.waitForTimeout(300);
  const geld = await txt(".mn-page");
  ok(geld.includes("Reisen") && !geld.includes("Ohne Kategorie"), "Geld zeigt Buchung mit Kategorie „Reisen“");

  /* ---------- Dunkel + PC ---------- */
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => { location.hash = "#alltag/unterwegs"; });
  await page.waitForSelector(".uw-tabs");
  for (const t of ["reisen", "packen", "parken", "tanken", "adressen"]) { await tab(t); await shot(`uw-${t}-390-dark.png`); }
  await tab("reisen");
  await page.click(".uw-trip");
  await page.waitForSelector(".uw-hero");
  await shot("uw-trip-390-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot("uw-trip-1440.png");
  for (const t of ["packen", "parken", "tanken", "adressen"]) { await tab(t); await shot(`uw-${t}-1440.png`); }
  await tab("reisen"); await page.click("[data-uw=closetrip]").catch(() => {}); await shot("uw-reisen-1440.png");

  // horizontales Überlaufen am Handy?
  await page.setViewportSize({ width: 390, height: 844 });
  for (const t of ["reisen", "packen", "parken", "tanken", "adressen"]) {
    await tab(t);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(ov <= 0, `kein horizontales Scrollen (${t})`);
  }

  const real = errors.filter((e) => !/ERR_FAILED|net::|Failed to load resource/.test(e));
  if (errors.length) console.log("Konsole (gefiltert):", errors);
  ok(real.length === 0, "keine Konsolenfehler");
  await browser.close();
  console.log("ALLES OK");
})().catch((e) => { console.error(e); process.exit(1); });
