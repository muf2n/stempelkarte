// Playwright-Test für die Baustellen-Projektseiten (Update 10d, lokaler Modus).
//   cd <worktree> && python3 -m http.server 8881 &   then   node tests/sites-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Nur erfundene Testdaten („Musterstraße 1, 8000 Musterstadt“).
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8881/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d.getTime(); };
const TODAY = key(new Date());

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await ctx.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (/Content.Security.Policy/i.test(t)) errors.push("CSP: " + t);
    else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
  });
  page.on("requestfailed", (r) => { const u = new URL(r.url()); if (u.hostname === "localhost") errors.push("lokal fehlgeschlagen: " + r.url()); });
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name, full = false) => { await page.waitForTimeout(400); return page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const txt = (s) => page.textContent(s);
  const closeSheet = async () => { await page.click("#sheet-root .sheet .close"); await page.waitForTimeout(150); };

  await page.goto(BASE);
  await page.evaluate(({ e1s, e1e, e2s, e2e, e3s, e3e }) => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("sk-a-")) localStorage.removeItem(k);
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [
        { id: "e1", start: e1s, end: e1e, pauseMin: 30, placeId: "p1", place: "Baustelle Muster", people: ["Max Muster"], note: "Verteiler gesetzt" },
        { id: "e2", start: e2s - 1800000, end: e2e, pauseMin: 0, placeId: "p1", place: "Baustelle Muster", people: [],
          segments: [{ start: e2s - 1800000, activity: "Autofahren", placeId: null, place: "" }, { start: e2s, activity: "Arbeiten", placeId: "p1", place: "Baustelle Muster" }] },
        { id: "e3", start: e3s, end: e3e, pauseMin: 0, placeId: "p3", place: "Altbau Beispielgasse" },
      ],
      todos: [{ id: "t1", title: "Zählerplatz vorbereiten", kind: "todo", placeId: "p1", done: false, createdAt: 1 }],
      days: {},
      places: [
        { id: "p1", name: "Baustelle Muster", addr: "Musterstraße 1, 8000 Musterstadt", lat: 47.07, lng: 15.44, radius: 150 },
        { id: "p2", name: "Firma Beispiel", addr: "Beispielweg 3, 8000 Musterstadt", radius: 150 },
        { id: "p3", name: "Altbau Beispielgasse", addr: "Beispielgasse 2, 8000 Musterstadt", radius: 150, siteStatus: "abgeschlossen", siteEnd: "2026-10-01" },
      ],
      running: null,
      rev: Date.now(),
      settings: { weeklyTarget: 38.5, people: ["Max Muster", "Eva Beispiel"] },
    }));
    localStorage.setItem("sk-a-material_items", JSON.stringify([
      { id: "m1", name: "FI-Schalter", qty: 1, unit: "Stk", status: "brauche", placeId: "p1", place: "Baustelle Muster", dayKey: "2026-11-02", created: e1s + 3600000, updated: e1s + 3600000 },
      { id: "m2", name: "NYM-J 3×1,5", qty: 25, unit: "m", status: "verbaut", placeId: "p1", place: "Baustelle Muster", dayKey: "2026-11-02", created: e1s + 1800000, doneAt: e1s + 7200000, updated: e1s },
    ]));
  }, { e1s: daysAgo(3, 7), e1e: daysAgo(3, 15, 30), e2s: daysAgo(2, 7), e2e: daysAgo(2, 11), e3s: daysAgo(60, 7), e3e: daysAgo(60, 9) });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(500);

  /* ---------- Orte-Liste ---------- */
  await page.evaluate(() => { location.hash = "#orte"; });
  await page.waitForSelector('.place-item[data-id="p1"]');
  ok(await page.$$eval("#view-orte .place-row", (r) => r.length) === 3, "Drei Orte als Zeilen (Ort-Knopf + Projekt-Knopf)");
  ok((await txt(".site-history summary")).includes("Abgeschlossene Baustellen (1)"), "Abgeschlossene Baustellen als eigene Liste");
  await page.click('.place-item[data-id="p1"]');
  await page.waitForSelector(".sheet .mt-place");
  ok(true, "Ort-Knopf öffnet weiterhin das Bearbeiten-Blatt (mit Material)");
  ok(await page.$('.sheet [data-r="site"]') !== null, "Bearbeiten-Blatt: „Baustellen-Seite öffnen“");
  await page.click('.sheet [data-r="site"]');
  await page.waitForSelector("#site-root .st-hero");
  ok(await page.evaluate(() => location.hash) === "#orte/baustelle/p1", "Adresse #orte/baustelle/p1");
  ok((await txt(".st-hero")).includes("Baustelle Muster") && (await txt(".st-badge")).includes("Aktiv"), "Kopf: Name + Status Aktiv");
  const stats = await txt(".st-stats");
  ok(stats.includes("12:00 h") && stats.includes("2 Tage"), "Arbeitszeit-Summe 12:00 h an 2 Tagen (" + stats.replace(/\s+/g, " ") + ")");
  ok((await txt("#st-work")).includes("Verteiler gesetzt") && (await txt("#st-work")).includes("Max Muster"), "Arbeitszeiten-Liste mit Notiz und Kolleg:in");
  ok((await txt(".st-fehlt")).includes("FI-Schalter"), "Material: fehlt → FI-Schalter");
  ok((await txt("#st-mat")).includes("NYM-J 3×1,5"), "Material dieser Baustelle (verbaut)");
  ok((await txt("#st-todos")).includes("Zählerplatz vorbereiten"), "Aufgabe der Baustelle");
  const tl = await txt("#st-timeline");
  ok(tl.includes("Eingestempelt") && tl.includes("Ausgestempelt") && tl.includes("Material erfasst") && tl.includes("Verbaut: 25 m NYM-J 3×1,5") && tl.includes("Abschnitt: Arbeiten"), "Zeitleiste aus echten Daten");
  ok((await txt("#st-trips")).includes("Fahrt") || (await txt("#st-trips")).includes("Fahrten"), "Fahrten-Bereich");

  /* ---------- Projektdaten ---------- */
  await page.click('[data-st="edit"]');
  await page.waitForSelector("#st-contact");
  await page.fill("#st-contact", "Frau Muster");
  await page.fill("#st-phone", "+43 660 1234567");
  await page.fill("#st-start", key(new Date(daysAgo(5, 8))));
  await page.fill("#st-notes", "Schlüssel beim Hausmeister 🔑");
  await page.click('.sheet [data-f="crew"] [data-n="Eva Beispiel"]');
  await page.click('.sheet [data-f="save"]');
  await page.waitForTimeout(300);
  const hero = await txt(".st-hero");
  ok(hero.includes("Frau Muster") && hero.includes("+43 660 1234567") && hero.includes("Eva Beispiel") && hero.includes("Schlüssel beim Hausmeister"), "Projektdaten im Kopf");
  ok(await page.getAttribute(".st-call", "href") === "tel:+436601234567", "Telefon als tel:-Link");
  ok(await page.evaluate(() => getComputedStyle(document.querySelector(".st-phone")).userSelect !== "none"), "Telefon als markierbarer Text");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).places.find((p) => p.id === "p1"));
  ok(saved.contact === "Frau Muster" && saved.siteStatus === "aktiv" && saved.crew.join() === "Eva Beispiel" && saved.radius === 150 && saved.lat === 47.07, "Felder am Ort gespeichert, Orts-Felder unverändert");

  /* ---------- Tagebuch-Eintrag ---------- */
  await page.click('[data-st="addlog"]');
  await page.waitForSelector("#sl-text");
  await page.fill("#sl-text", "08:15 Leitungen verlegt");
  ok(await page.inputValue("#sl-time") === "08:15", "Uhrzeit aus dem Text übernommen");
  await page.click('.sheet [data-l="save"]');
  await page.waitForTimeout(300);
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-site_log") || "[]"));
  ok(log.length === 1 && log[0].placeId === "p1" && log[0].text === "Leitungen verlegt", "Eintrag in Sammlung site_log mit placeId");
  ok((await txt(".st-ev.k-log")).includes("08:15") && (await txt(".st-ev.k-log")).includes("Leitungen verlegt"), "Eintrag in der Zeitleiste");

  /* ---------- Fotos + Vorher/Nachher ---------- */
  await page.evaluate(async (pid) => {
    const P = await import("./js/photos.js");
    const mk = (col) => { const c = document.createElement("canvas"); c.width = 160; c.height = 120; const g = c.getContext("2d"); g.fillStyle = col; g.fillRect(0, 0, 160, 120); return c.toDataURL("image/jpeg", 0.7); };
    const a = mk("#b45309"), b = mk("#15803d");
    await P.addPhoto(null, { processed: { data: a, thumb: a, w: 160, h: 120 }, placeId: pid, place: "Baustelle Muster", ts: Date.now() - 86400000, note: "Rohbau" });
    await P.addPhoto(null, { processed: { data: b, thumb: b, w: 160, h: 120 }, placeId: pid, place: "Baustelle Muster", note: "Fertig" });
  }, "p1");
  await page.waitForFunction(() => document.querySelectorAll("#st-photos .st-th").length === 2);
  ok(true, "Zwei Fotos als Vorschaubilder");
  // neuestes zuerst → [0] = „Fertig“, [1] = „Rohbau“
  await page.click("#st-photos .st-th >> nth=1");
  await page.waitForSelector('.sheet [data-ph="vorher"]');
  await page.click('.sheet [data-ph="vorher"]');
  await page.waitForTimeout(250);
  await closeSheet();
  await page.click("#st-photos .st-th >> nth=0");
  await page.waitForSelector('.sheet [data-ph="nachher"]');
  await page.click('.sheet [data-ph="nachher"]');
  await page.waitForTimeout(250);
  await closeSheet();
  await page.waitForSelector(".st-ba-grid figure");
  ok((await txt(".st-ba")).includes("Vorher") && (await txt(".st-ba")).includes("Nachher"), "Vorher/Nachher nebeneinander");
  ok((await txt("#st-timeline")).includes("Foto (Vorher): Rohbau"), "Foto in der Zeitleiste");

  /* ---------- Aufgabe zuordnen ---------- */
  await page.click('[data-st="addtodo"]');
  await page.waitForSelector('.sheet [data-r="placeid"]');
  ok(await page.inputValue('.sheet [data-r="placeid"]') === "p1", "Aufgaben-Formular: Baustelle vorbelegt");
  await page.fill('.sheet [data-r="title"]', "Abnahme vorbereiten");
  await page.click('.sheet [data-r="save"]');
  await page.waitForTimeout(300);
  ok((await txt("#st-todos")).includes("Abnahme vorbereiten"), "Neue Aufgabe auf der Baustellen-Seite");
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).todos.find((t) => t.title === "Abnahme vorbereiten").placeId === "p1"), "todo.placeId gespeichert");

  await shot("st-page-390.png");
  await shot("st-page-390-full.png", true);

  /* ---------- QR + Bericht ---------- */
  await page.click('[data-st="qr"]');
  await page.waitForSelector(".st-qr-box svg");
  ok((await txt(".st-qr-url")).endsWith("#orte/baustelle/p1"), "QR-Code-Adresse öffnet die Baustellen-Seite");
  await shot("st-qr-390.png");
  await closeSheet();
  await page.click('[data-st="report"]');
  await page.waitForSelector("#sr-root .sr-paper");
  const rep = await txt("#sr-root .sr-paper");
  ok(rep.includes("Baustellenbericht") && rep.includes("12:00") && rep.includes("NYM-J 3×1,5") && rep.includes("Leitungen verlegt") && rep.includes("Frau Muster"), "Bericht mit Stunden, Material, Tagebuch, Ansprechpartner");
  ok(await page.$$eval("#sr-root .sr-ba-row img", (i) => i.length) === 2, "Bericht: Vorher/Nachher-Bilder");
  await page.click('#sr-root [data-sr="print"]');
  ok(await page.evaluate(() => window.__printed) === 1, "Drucken / als PDF");
  await page.emulateMedia({ media: "print" });
  ok(await page.evaluate(() => getComputedStyle(document.getElementById("site-root")).display) === "none", "Druckansicht: nur der Bericht");
  await page.emulateMedia({ media: "screen" });
  await shot("st-report-390.png");
  await page.click('#sr-root [data-sr="close"]');
  await page.waitForTimeout(200);
  ok(await page.$("#sr-root") === null && await page.$("#site-root") !== null, "Bericht zu, Baustellen-Seite noch offen");

  /* ---------- Dunkel ---------- */
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("st-page-390-dark.png");
  await page.emulateMedia({ colorScheme: "light" });

  /* ---------- Status über das Abzeichen ---------- */
  await page.click('[data-st="status"]');
  await page.click('.sheet [data-v="pausiert"]');
  await page.waitForTimeout(250);
  ok((await txt(".st-badge")).includes("Pausiert"), "Status über das Abzeichen geändert");

  /* ---------- Schließen ---------- */
  await page.click('#site-root [data-st="close"]');
  await page.waitForTimeout(250);
  ok(await page.$("#site-root") === null, "Seite geschlossen");
  ok(await page.evaluate(() => location.hash) === "#orte", "Zurück auf #orte");
  ok((await txt('.place-row[data-status="pausiert"] .site-go')).includes("⏸️"), "Liste zeigt Status-Emoji");

  /* ---------- Direkt per Adresse (QR) ---------- */
  await page.goto(BASE + "#orte/baustelle/p1");
  await page.waitForSelector("#site-root .st-hero");
  ok((await txt(".st-hero")).includes("Baustelle Muster"), "Direktaufruf per Adresse (wie QR-Scan) öffnet die Seite");
  await page.click('#site-root [data-st="close"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => location.hash) === "#orte", "Direktaufruf: Zurück → #orte");
  await page.goto(BASE + "#orte/baustelle/gibtsnicht");
  await page.waitForSelector("#site-root .empty");
  ok((await txt("#site-root")).includes("nicht gefunden"), "Unbekannte Baustelle: freundlicher Hinweis");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok(await page.$("#site-root") === null, "Escape schließt");

  /* ---------- Abschließen → Verlauf ---------- */
  await page.click('.site-go[data-site="p1"]');
  await page.waitForSelector("#site-root .st-hero");
  await page.click('[data-st="edit"]');
  await page.click('.sheet [data-f="status"] [data-v="abgeschlossen"]');
  await page.fill("#st-end", TODAY);
  await page.click('.sheet [data-f="save"]');
  await page.waitForTimeout(300);
  await page.click('#site-root [data-st="close"]');
  await page.waitForTimeout(250);
  ok((await txt(".site-history summary")).includes("(2)") && await page.$('.site-history .place-item[data-id="p1"]') !== null, "Abgeschlossene Baustelle im Verlauf");
  await page.click(".site-history summary");
  await shot("st-orte-390.png", true);

  /* ---------- Dashboard-Widget ---------- */
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForSelector('[data-w="site"] .dw-more[data-hash^="#orte/baustelle/"]');
  ok(await page.getAttribute('[data-w="site"] .dw-h .dw-more', "data-hash") === "#orte/baustelle/p1", "Dashboard: „Aktuelle Baustelle“ → Projektseite");
  ok(await page.$('[data-w="site"] .dw-site-mat[data-hash="#alltag/material"]') !== null, "Dashboard: Materialliste weiter erreichbar");
  await page.click('[data-w="site"] .dw-h .dw-more');
  await page.waitForSelector("#site-root .st-hero");
  ok(true, "Dashboard öffnet die Projektseite");
  await page.click('#site-root [data-st="close"]');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => location.hash) === "#heute", "Zurück → wieder Heute");

  /* ---------- PC 1440 ---------- */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { location.hash = "#orte/baustelle/p1"; });
  await page.waitForSelector("#site-root .st-hero");
  ok(await page.evaluate(() => getComputedStyle(document.querySelector(".st-cols")).gridTemplateColumns.split(" ").length) === 2, "PC: zwei Spalten");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Kein waagrechtes Scrollen");
  await shot("st-page-1440.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("st-page-1440-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.getElementById("site-root").scrollWidth <= window.innerWidth + 1), "390: kein waagrechtes Scrollen");

  ok(errors.length === 0, "Keine Konsolenfehler / CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("\nAlle Baustellen-Tests bestanden.");
})().catch((e) => { console.error(e); process.exit(1); });
