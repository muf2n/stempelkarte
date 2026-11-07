// Playwright-Test für Alltag › 🧰 Werkzeug-Register (Update 10) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8931 &   then   node tests/werkzeug-e2e.cjs [screenshot-dir]
// Kachel + Route, leeres Register, Anlegen (Kategorie → Intervall), Detail per Hash, Ausgeben/Zurück (Verlauf), Defekt/Repariert,
// Prüfung eintragen, Foto + Standort Auto, Ansichten Fällig/Ausgeliehen/Defekt, Suche, QR-Sticker, Druckbogen (Druckansicht),
// Scanner (Hinweis ohne BarcodeDetector, Link einfügen, simulierter Scan), Deep-Link nach Neuladen, globale Suche, Dashboard.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8931/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shifted = (months, days = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + months); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(new Date().getDate(), last)); d.setDate(d.getDate() + days); return key(d); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (/Content Security Policy|Refused to/.test(t)) errors.push("CSP: " + t);
    else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
  });
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name) => { await page.waitForTimeout(350); return page.screenshot({ path: path.join(OUT, name), fullPage: true }); };
  const A = (n) => page.evaluate((n) => JSON.parse(localStorage.getItem("sk-a-" + n) || "[]"), n);
  const sheet = ".sheet:last-child";
  const save = async () => { await page.click(`${sheet} [data-save]`); await page.waitForTimeout(250); };

  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [{ id: "p1", name: "Baustelle Muster", addr: "Musterweg 1", lat: 47, lng: 15, radius: 150 }], todos: [], days: {}, running: null, rev: Date.now(),
      settings: { weeklyTarget: 38.5, people: ["Max Muster", "Erika Beispiel"], vehicles: [{ id: "v1", name: "Firmenbus", plate: "XX-123AB", type: "firma" }], trips: { defaultVehicleId: "v1" } } }));
  });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(300);

  /* ---------- Kachel + leeres Register ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="werkzeug"]');
  ok((await page.textContent('.al-tile[data-id="werkzeug"]')).includes("Werkzeug"), "Kachel „🧰 Werkzeug“ auf der Alltag-Seite");
  await page.click('.al-tile[data-id="werkzeug"]');
  await page.waitForSelector(".wz-empty");
  ok((await page.evaluate(() => location.hash)) === "#alltag/werkzeug", "Route #alltag/werkzeug");
  ok((await page.textContent(".wz-empty")).includes("noch leer"), "Leeres Register mit freundlichem Hinweis");
  await shot("werkzeug-empty-390-light.png");

  /* ---------- Anlegen ---------- */
  await page.click('.wz-acts [data-wz="new"]');
  await page.waitForSelector("#wz-f-name");
  ok((await page.inputValue("#wz-f-months")) === "12", "Akkuwerkzeug schlägt 12 Monate vor");
  await page.click(`${sheet} [data-fcat="hand"]`);
  ok((await page.inputValue("#wz-f-months")) === "", "Handwerkzeug → kein Intervall");
  await page.click(`${sheet} [data-fcat="mess"]`);
  ok((await page.inputValue("#wz-f-months")) === "12" && (await page.getAttribute("#wz-f-clabel", "placeholder")) === "Kalibrierung", "Messgerät → 12 Monate Kalibrierung");
  await page.fill("#wz-f-name", "Installationstester");
  await page.fill("#wz-f-brand", "Testmarke IT-1");
  await page.fill("#wz-f-sn", "sn-0001");
  const soonLast = shifted(-12, 10);
  await page.fill("#wz-f-last", soonLast);
  await page.fill("#wz-f-notes", "Mit Prüfspitzen und Tasche");
  await shot("werkzeug-form-390-light.png");
  await save();
  await page.waitForSelector(".wz-det");
  let tools = await A("werkzeug");
  ok(tools.length === 1 && tools[0].cat === "mess" && tools[0].serial === "SN-0001" && tools[0].checkMonths === 12 && tools[0].lastCheck === soonLast, "Werkzeug gespeichert (Kategorie, SN groß, Intervall, letzte Prüfung)");
  const id1 = tools[0].id;
  ok((await page.evaluate(() => location.hash)) === "#alltag/werkzeug/" + id1, "Nach dem Anlegen: Detail-Route #alltag/werkzeug/<id>");
  ok((await page.textContent(".wz-hero")).includes("in 10 Tagen fällig"), "Status-Abzeichen „in 10 Tagen fällig“");
  await shot("werkzeug-detail-390-light.png");

  /* ---------- Ausgeben / Zurück ---------- */
  await page.click('[data-wz="lend"]');
  await page.click(`${sheet} [data-p="Max Muster"]`);
  ok((await page.inputValue("#wz-l-who")) === "Max Muster", "Person aus settings.people per Chip");
  await page.fill("#wz-l-note", "für Baustelle Muster");
  await save();
  ok((await page.textContent(".wz-hero")).includes("bei Max Muster"), "Abzeichen „bei Max Muster“");
  ok((await A("werkzeug"))[0].holder === "Max Muster", "holder gespeichert");
  await page.click('[data-wz="return"]');
  await page.waitForTimeout(250);
  tools = await A("werkzeug");
  ok(tools[0].holder === "" && tools[0].history.map((h) => h.op).join(",") === "aus,rueck", "Zurückgegeben – Verlauf aus, rueck");
  ok((await page.textContent(".wz-hist")).includes("Zurück von Max Muster"), "Verlauf zeigt Rückgabe");

  /* ---------- Defekt / Repariert ---------- */
  await page.click('[data-wz="defect"]');
  await page.fill("#wz-d-note", "Display flackert");
  await save();
  ok((await page.textContent(".wz-defect")).includes("Display flackert"), "Defektmeldung sichtbar");
  await shot("werkzeug-defekt-390-light.png");
  await page.click('[data-wz="fixed"]');
  await page.waitForTimeout(250);
  ok(!(await page.$(".wz-defect")) && (await A("werkzeug"))[0].defect === false, "Repariert → Defekt weg");

  /* ---------- Prüfung eintragen ---------- */
  await page.click('[data-wz="check"]');
  await save();
  tools = await A("werkzeug");
  const todayKey = key(new Date());
  ok(tools[0].lastCheck === todayKey, "Geprüft heute");
  ok((await page.textContent(".wz-info")).includes("nächste am"), "Nächste Prüfung in einem Jahr");

  /* ---------- Bearbeiten: Foto + Standort Auto ---------- */
  const png = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 640; c.height = 480; const g = c.getContext("2d"); g.fillStyle = "#c2410c"; g.fillRect(0, 0, 640, 480); g.fillStyle = "#fde68a"; g.fillRect(160, 120, 320, 240); return c.toDataURL("image/png").split(",")[1]; });
  await page.click('[data-wz="edit"]');
  await page.setInputFiles("#wz-f-photo", { name: "tester.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.waitForSelector(`${sheet} .wz-photo-prev img`);
  await page.click(`${sheet} [data-floc="auto"]`);
  await page.selectOption("#wz-f-veh", "v1");
  await save();
  await page.waitForSelector(".wz-hero img.wz-img");
  tools = await A("werkzeug");
  ok(tools[0].photoId === "tool_" + id1 && tools[0].loc.kind === "auto" && tools[0].loc.vehicleId === "v1", "Foto (eigene Bildablage) + Standort Fahrzeug gespeichert");
  ok((await page.textContent(".wz-info")).includes("Firmenbus (XX-123AB)"), "Standort zeigt Fahrzeug mit Kennzeichen");
  await shot("werkzeug-detail-photo-390-light.png");

  /* ---------- zweites + drittes Werkzeug (vorbereitet) ---------- */
  await page.evaluate(([over]) => {
    const l = JSON.parse(localStorage.getItem("sk-a-werkzeug") || "[]");
    l.push({ id: "w2", name: "Stehleiter 6 Stufen", cat: "leiter", checkMonths: 12, lastCheck: over, loc: { kind: "baustelle", placeId: "p1" }, holder: "Erika Beispiel", history: [], created: 1, updated: 1 });
    l.push({ id: "w3", name: "Seitenschneider", cat: "hand", loc: { kind: "firma", text: "Regal 3" }, history: [], created: 1, updated: 1 });
    localStorage.setItem("sk-a-werkzeug", JSON.stringify(l));
  }, [shifted(-13)]);
  await page.goto(BASE + "#alltag");
  await page.reload();
  await page.waitForSelector('.al-tile[data-id="werkzeug"]');
  await page.click('.al-tile[data-id="werkzeug"]');
  await page.waitForSelector(".wz-card");
  ok((await page.$$(".wz-card")).length === 3, "Liste zeigt 3 Werkzeuge");
  ok((await page.$eval(".wz-card", (b) => b.dataset.id)) === "w2", "Überfällige Leiter steht oben");
  ok((await page.textContent('.wz-card[data-id="w2"]')).includes("überfällig"), "Leiter: überfällig");
  ok((await page.textContent('[data-view="faellig"]')).includes("1") && (await page.textContent('[data-view="aus"]')).includes("1"), "Zähler Fällig 1 / Ausgeliehen 1");
  await shot("werkzeug-list-390-light.png");
  await page.click('[data-view="aus"]');
  ok((await page.$$eval(".wz-card", (l) => l.map((x) => x.dataset.id))).join() === "w2", "Ansicht Ausgeliehen");
  await page.click('[data-view="defekt"]');
  ok((await page.textContent(".wz-list-wrap")).includes("Nichts defekt"), "Ansicht Defekt leer – freundlicher Text");
  await page.click('[data-view="alle"]');
  await page.click('.wz-cats [data-cat="hand"]');
  ok((await page.$$eval(".wz-card", (l) => l.map((x) => x.dataset.id))).join() === "w3", "Kategorie-Filter Handwerkzeug");
  await page.click('.wz-cats [data-cat=""]');
  await page.fill("#wz-q", "sn-0001");
  ok((await page.$$eval(".wz-card", (l) => l.map((x) => x.dataset.id))).join() === id1, "Suche nach Seriennummer");
  await page.fill("#wz-q", "");

  /* ---------- QR-Sticker ---------- */
  await page.click(`.wz-card[data-id="${id1}"]`);
  await page.waitForSelector(".wz-det");
  await page.click('[data-wz="qr"]');
  await page.waitForSelector(".wz-qr-box svg");
  const qrUrl = await page.textContent(".wz-qr-url");
  ok(qrUrl.endsWith("#alltag/werkzeug/" + id1) && qrUrl.startsWith(BASE.replace(/\/$/, "")), "QR-Code kodiert App-Adresse + #alltag/werkzeug/<id>");
  await shot("werkzeug-qr-390-light.png");
  await page.click(`${sheet} [data-q="copy"]`);
  ok((await page.evaluate(() => navigator.clipboard.readText())) === qrUrl, "Link kopiert");
  await page.click(`${sheet} .close`);

  /* ---------- Druckbogen ---------- */
  await page.click('[data-wz="back"]');
  await page.waitForSelector(".wz-card");
  await page.click('.wz-acts [data-wz="print"]');
  await page.waitForSelector("#wz-print-root .wz-st");
  ok((await page.$$("#wz-print-root .wz-st svg")).length === 3, "Druckbogen: 3 Sticker mit QR");
  await page.click('#wz-print-root .wz-st[data-id="w3"] input');
  ok((await page.textContent(".wz-pr-n")).includes("2 von 3"), "Auswahl 2 von 3");
  await shot("werkzeug-print-390-light.png");
  await page.emulateMedia({ media: "print" });
  const vis = await page.evaluate(() => ({
    app: getComputedStyle(document.querySelector("#app") || document.body.firstElementChild).display,
    off: getComputedStyle(document.querySelector('.wz-st[data-id="w3"]')).display,
    on: getComputedStyle(document.querySelector('.wz-st[data-id="w2"]')).display,
    bar: getComputedStyle(document.querySelector("#wz-print-root .rp-bar")).display,
  }));
  ok(vis.off === "none" && vis.on !== "none" && vis.bar === "none", "Druckansicht: nur ausgewählte Sticker, ohne Bedienleiste");
  await page.screenshot({ path: path.join(OUT, "werkzeug-print-media.png"), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  await page.click('#wz-print-root [data-p="close"]');
  await page.waitForTimeout(200);
  ok(!(await page.$("#wz-print-root")), "Druckbogen schließt");

  /* ---------- Scanner ---------- */
  await page.evaluate(() => { try { delete window.BarcodeDetector; } catch { window.BarcodeDetector = undefined; } });
  await page.click('.wz-acts [data-wz="scan"]');
  await page.waitForSelector(".wz-scan");
  ok(!!(await page.$(".wz-scan-hint")) && (await page.textContent(".wz-scan-hint")).includes("Kamera-App"), "Ohne BarcodeDetector: Hinweis auf die Kamera-App");
  await shot("werkzeug-scan-hint-390-light.png");
  await page.fill("#wz-s-in", "kein link!");
  await page.click(`${sheet} [data-go]`);
  ok(!!(await page.$(".wz-scan")), "Ungültiger Text → bleibt offen");
  await page.fill("#wz-s-in", BASE + "#alltag/werkzeug/w2");
  await page.click(`${sheet} [data-go]`);
  await page.waitForFunction(() => location.hash === "#alltag/werkzeug/w2");
  await page.waitForSelector(".wz-det");
  ok((await page.textContent(".wz-hero")).includes("Stehleiter"), "Link einfügen öffnet das Werkzeug");
  // simulierter Scanner (BarcodeDetector + Kamera)
  await page.evaluate((url) => {
    window.BarcodeDetector = class { constructor() { this.n = 0; } async detect() { this.n++; return this.n > 2 ? [{ rawValue: url }] : []; } };
    navigator.mediaDevices.getUserMedia = async () => { const c = document.createElement("canvas"); c.width = 320; c.height = 320; const g = c.getContext("2d"); g.fillStyle = "#333"; g.fillRect(0, 0, 320, 320); const s = c.captureStream(10); window.__wzStream = s; return s; };
  }, qrUrl);
  await page.click('[data-wz="back"]');
  await page.waitForSelector(".wz-card");
  await page.click('.wz-acts [data-wz="scan"]');
  await page.waitForSelector(".wz-scan video");
  await page.waitForFunction((id) => location.hash === "#alltag/werkzeug/" + id, id1, { timeout: 5000 });
  await page.waitForSelector(".wz-det");
  ok(!(await page.$(".wz-scan")), "Simulierter Scan öffnet das Werkzeug, Scanner schließt");
  ok(await page.evaluate(() => window.__wzStream.getTracks().every((t) => t.readyState === "ended")), "Kamera wird nach dem Scan gestoppt");

  /* ---------- Deep-Link nach Neuladen (wie vom Sticker) ---------- */
  await page.goto(BASE + "#alltag/werkzeug/w3");
  await page.reload();
  await page.waitForSelector(".wz-det");
  ok((await page.textContent(".wz-hero")).includes("Seitenschneider") && (await page.textContent(".wz-info")).includes("Regal 3"), "Deep-Link #alltag/werkzeug/<id> öffnet direkt das Werkzeug");
  await page.goto(BASE + "#alltag/werkzeug/gibtsnicht");
  await page.waitForSelector(".wz-detail-wrap .wz-empty");
  ok((await page.textContent(".wz-detail-wrap")).includes("nicht gefunden"), "Unbekannte ID → freundlicher Hinweis");

  /* ---------- globale Suche ---------- */
  await page.goto(BASE + "#heute");
  await page.waitForTimeout(300);
  await page.click("#btn-search");
  await page.fill("#srch-q", "stehleiter");
  await page.waitForTimeout(300);
  ok((await page.$$eval(".srch-group[data-group]", (l) => l.map((g) => g.dataset.group))).includes("werkzeug"), "Universale Suche findet Werkzeug");
  await page.click('.srch-group[data-group="werkzeug"] .srch-row');
  await page.waitForFunction(() => location.hash === "#alltag/werkzeug/w2");
  await page.waitForSelector(".wz-det");
  ok(true, "Suchtreffer öffnet das Werkzeug");

  /* ---------- Dashboard ---------- */
  await page.goto(BASE + "#heute");
  await page.waitForSelector('[data-w="faellig"]', { timeout: 5000 });
  ok((await page.textContent('[data-w="faellig"]')).includes("Stehleiter"), "Dashboard: „Werkzeug & Auto fällig“ zeigt die Leiter");

  /* ---------- dunkel + PC ---------- */
  await page.goto(BASE + "#alltag/werkzeug");
  await page.waitForSelector(".wz-card");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("werkzeug-list-390-dark.png");
  await page.goto(BASE + "#alltag/werkzeug/" + id1);
  await page.waitForSelector(".wz-det");
  await shot("werkzeug-detail-390-dark.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot("werkzeug-detail-1440-dark.png");
  await page.goto(BASE + "#alltag/werkzeug");
  await page.waitForSelector(".wz-card");
  await shot("werkzeug-list-1440-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await shot("werkzeug-list-1440-light.png");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, "Kein waagrechtes Scrollen");

  ok(errors.length === 0, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("ALLE WERKZEUG-TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
