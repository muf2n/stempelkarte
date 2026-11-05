// Playwright-Test für Alltag › Material (lokaler Modus).
//   cd <worktree> && python3 -m http.server 8857 &   then   node tests/material-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Testdaten: zwei Orte + laufende Schicht an „Teststraße 15“.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:8857/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = key(new Date());
const TODAY_DE = TODAY.split("-").reverse().join(".");

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: false, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await ctx.addInitScript(() => {
    window.__shared = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: (d) => { window.__shared.push(d); return Promise.resolve(); } });
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); }); // abgefangene fremde Domains
  page.on("requestfailed", (r) => { const u = new URL(r.url()); if (u.hostname === "localhost") errors.push("lokal fehlgeschlagen: " + r.url()); });
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name, full = true) => { await page.waitForTimeout(450); return page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const txt = (s) => page.textContent(s);
  const items = () => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-material_items") || "[]"));
  const tab = async (id) => { await page.click(`.mt-tab[data-tab="${id}"]`); await page.waitForTimeout(150); };
  const closeSheet = async () => { await page.click(".sheet .close"); await page.waitForTimeout(150); };

  await page.goto(BASE);
  await page.evaluate(() => {
    const d = new Date(); d.setHours(7, 0, 0, 0);
    const s = Math.min(d.getTime(), Date.now() - 60000);
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [], todos: [], days: {},
      places: [{ id: "p1", name: "Teststraße 15", addr: "Teststraße 15, Linz", lat: 48.3, lng: 14.28, radius: 150 }, { id: "p2", name: "Firma Elektro Maier", radius: 150 }],
      running: { start: s, segments: [{ start: s, activity: "Arbeiten", placeId: "p1", place: "Teststraße 15", loc: null }], placeId: "p1", place: "Teststraße 15", note: "", people: [], pauseStart: null, pauseMs: 0, inLoc: null },
      rev: Date.now(),
      settings: { weeklyTarget: 38.5, apprentice: { name: "Florian", trade: "Elektrotechnik", company: "Elektro Maier", start: "2025-09-01", years: 3.5, notes: {} } },
    }));
    for (const k of Object.keys(localStorage)) if (k.startsWith("sk-a-material") || k === "sk-mt-tab") localStorage.removeItem(k);
  });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(500);

  /* ---------- Heute: Knopf neben dem Foto-Knopf, Vorbelegung ---------- */
  await page.waitForSelector("[data-mt=today]", { state: "visible" });
  ok((await txt("[data-mt=today]")).includes("Material"), "„🧰 Material“-Knopf in „Heute“ (eingestempelt)");
  ok(await page.evaluate(() => { const b = document.querySelector("[data-mt=today]"); return b.parentElement.querySelector(".ph-cam") !== null; }), "Knopf sitzt neben „Foto aufnehmen“");
  await page.click("[data-mt=today]");
  await page.waitForSelector("#mt-q");
  ok(await page.inputValue("#mt-place") === "p1", "Baustelle = aktueller Ort (eingestempelt)");
  ok(await page.inputValue("#mt-day") === TODAY, "Tag = heute");
  ok(await page.getAttribute('.sheet [data-status="verbaut"]', "aria-pressed") === "true", "Status vorbelegt: verbaut");
  await page.fill("#mt-q", "3x1,5");
  await page.waitForTimeout(100);
  ok((await txt(".mt-sugg .mt-sg")).includes("NYM-J 3×1,5"), "Unscharfe Suche: „3x1,5“ → NYM-J 3×1,5");
  await shot("mt-quickadd-390.png", false);
  await page.click(".mt-sugg .mt-sg");
  ok(await page.getAttribute('.mt-unit[data-unit="m"]', "aria-pressed") === "true", "Einheit aus dem Katalog: m");
  await page.fill("#mt-qty", "25");
  await page.click('.sheet [data-m="save"]');
  await page.waitForTimeout(250);
  ok((await txt("[data-mt=today]")).replace(/\s+/g, " ").includes("🧰 1 heute"), "Knopf zeigt „🧰 1 heute“");
  await page.click("[data-mt=today]");
  await page.fill("#mt-q", "schuko");
  await page.waitForTimeout(80);
  await page.keyboard.press("Enter"); // erster Vorschlag
  ok(await page.inputValue("#mt-q") === "Schuko-Steckdose", "Enter übernimmt ersten Vorschlag");
  await page.click('.sheet [data-m="plus"]');
  ok(await page.inputValue("#mt-qty") === "2", "+ erhöht die Menge");
  await page.click('.sheet [data-m="save"]');
  await page.waitForTimeout(250);
  ok((await txt("[data-mt=today]")).replace(/\s+/g, " ").includes("🧰 2 heute"), "Knopf zeigt „🧰 2 heute“");
  let it = await items();
  ok(it.length === 2 && it.every((x) => x.placeId === "p1" && x.place === "Teststraße 15" && x.dayKey === TODAY && x.status === "verbaut" && x.doneAt), "Gespeichert mit Ort, Tag und Status verbaut");
  ok(it.find((x) => x.name === "NYM-J 3×1,5").catalogId === "nym-j-3x1-5", "catalogId gesetzt");
  await shot("mt-today-390.png", false);

  /* ---------- Modulseite ---------- */
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector('.al-tile[data-id="material"]');
  ok((await txt('.al-tile[data-id="material"]')).includes("Brauche ich · verbaut · pro Baustelle"), "Kachel „Material“");
  await page.click('.al-tile[data-id="material"]');
  await page.waitForSelector(".mt-tabs");
  ok((await page.$$(".mt-tab")).length === 4, "4 Unterreiter");
  ok((await txt(".mt-page")).includes("Einkaufsliste ist leer"), "Leerer Zustand „Brauche ich“");

  // Einkaufsliste anlegen (Speichern & weiter)
  await page.click(".mt-fab");
  await page.waitForSelector("#mt-q");
  ok(await page.getAttribute('.sheet [data-status="brauche"]', "aria-pressed") === "true", "Status Standard: brauche");
  await page.fill("#mt-q", "wago 413");
  await page.waitForTimeout(80);
  await page.click(".mt-sugg .mt-sg");
  ok(await page.inputValue("#mt-q") === "Wago 221-413", "Wago 221-413 gewählt");
  await page.click('.sheet [data-m="more"]');
  await page.waitForTimeout(200);
  ok(await page.inputValue("#mt-q") === "", "„Speichern & weiter“ leert das Feld, Blatt bleibt offen");
  await page.fill("#mt-q", "lusterklemme");
  await page.waitForTimeout(80);
  ok((await txt(".mt-sugg .mt-sg")).includes("Lüsterklemme"), "Umlaut-unabhängig: „lusterklemme“ → Lüsterklemme");
  await page.click(".mt-sugg .mt-sg");
  await page.fill("#mt-qty", "3");
  await page.click('.sheet [data-m="more"]');
  await page.waitForTimeout(200);
  // freie Baustelle
  await page.fill("#mt-q", "Rauchmeldr");
  await page.waitForTimeout(80);
  await page.click(".mt-sugg .mt-sg");
  await page.selectOption("#mt-place", "__free");
  ok(await page.isVisible("#mt-free"), "Freitext-Baustelle einblendbar");
  await page.fill("#mt-free", "Oma Huber");
  await page.fill("#mt-note", "Schlafzimmer");
  await page.click('.sheet [data-m="save"]');
  await page.waitForTimeout(250);
  // eigenes Material (nicht im Katalog)
  await page.click(".mt-fab");
  await page.fill("#mt-q", "Gira E2 Rahmen anthrazit");
  await page.waitForTimeout(80);
  ok((await txt(".mt-sugg")).includes("übernehmen"), "Unbekannt → „… übernehmen“");
  await page.click('.sheet [data-m="save"]');
  await page.waitForTimeout(250);
  it = await items();
  ok(it.length === 6, "6 Materialzeilen");
  ok(it.find((x) => x.name === "Rauchmelder").place === "Oma Huber" && !it.find((x) => x.name === "Rauchmelder").placeId, "Freitext-Ort gespeichert");
  const cat = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-material_catalog") || "[]"));
  ok(cat.some((c) => c.own && c.name === "Gira E2 Rahmen anthrazit"), "Eigenes Material im Katalog gemerkt");
  ok(cat.find((c) => c.id === "b_nym-j-3x1-5").count === 1, "Zähler für Katalog-Eintrag");

  // Brauche ich: gruppiert nach Baustelle
  const groups = await page.$$eval(".mt-card h3", (h) => h.map((x) => x.textContent.trim()));
  ok(groups.join("|") === "Oma Huber|Teststraße 15", "Gruppiert nach Baustelle: " + groups.join(", "));
  ok((await txt(".mt-bar-t")).includes("4 noch zu besorgen"), "Zähler „4 noch zu besorgen“");
  await shot("mt-brauche-390.png");
  const wago = it.find((x) => x.name === "Wago 221-413").id;
  const lus = it.find((x) => x.name === "Lüsterklemme").id;
  await page.click(`.mt-line[data-id="${wago}"] [data-a="plus"]`);
  await page.waitForTimeout(150);
  ok((await items()).find((x) => x.id === wago).qty === 2, "Menge + in der Liste");
  await page.click(`.mt-line[data-id="${wago}"] [data-a="minus"]`);
  await page.waitForTimeout(150);
  ok((await items()).find((x) => x.id === wago).qty === 1, "Menge − in der Liste");
  await page.click(`.mt-line[data-id="${wago}"] .mt-check`);
  await page.waitForTimeout(150);
  ok((await items()).find((x) => x.id === wago).status === "besorgt", "Abhaken → besorgt");
  ok(await page.getAttribute(`.mt-line[data-id="${wago}"] .mt-check`, "aria-checked") === "true", "Haken sichtbar");
  // Wischen nach rechts: Lüsterklemme → besorgt
  const box = await page.locator(`.mt-line[data-id="${lus}"] .mt-l-main`).boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 20 + i * 16, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(250);
  ok((await items()).find((x) => x.id === lus).status === "besorgt", "Wischen nach rechts → besorgt");
  ok(!(await page.$(".sheet")), "Wischen öffnet kein Bearbeiten-Blatt");
  // Teilen Einkaufsliste (Baustelle Teststraße 15)
  await page.click('.mt-card[data-pk="p:p1"] [data-x="share"]');
  await page.waitForSelector(".mt-preview");
  ok((await txt(".mt-preview")) === `Materialliste Teststraße 15 (${TODAY_DE}):\n• 1× Gira E2 Rahmen anthrazit`, "Teilen „Brauche ich“: besorgte Zeilen sind nicht mehr auf der Einkaufsliste");
  await closeSheet();
  // Alles Besorgte als verbaut
  ok((await txt('.mt-card[data-pk="p:p1"] .mt-allin')).includes("Alles Besorgte als verbaut markieren"), "Knopf „Alles Besorgte als verbaut markieren“");
  await shot("mt-brauche-besorgt-390.png");
  await page.click('.mt-card[data-pk="p:p1"] .mt-allin');
  ok((await txt('.mt-card[data-pk="p:p1"] .mt-allin')).includes("wirklich"), "Rückfrage");
  await page.click('.mt-card[data-pk="p:p1"] .mt-allin');
  await page.waitForTimeout(250);
  it = await items();
  ok(it.filter((x) => x.placeId === "p1" && x.status === "verbaut").length === 4, "Alles Besorgte an Teststraße 15 ist verbaut");
  ok(it.find((x) => x.id === wago).doneAt > 0, "doneAt gesetzt");

  /* ---------- Verbaut ---------- */
  await tab("verbaut");
  ok((await txt(".mt-day h3")).includes(TODAY_DE), "Verbaut nach Tag");
  ok((await txt(".mt-day .mt-sub-h")).includes("Teststraße 15"), "… und Baustelle");
  await shot("mt-verbaut-390.png");
  // zurück auf besorgt und wieder verbaut (Status-Fluss rückwärts)
  await page.click(`.mt-line[data-id="${lus}"] [data-a="prev"]`);
  await page.waitForTimeout(150);
  ok((await items()).find((x) => x.id === lus).status === "besorgt", "↩ zurück auf besorgt");
  await tab("brauche");
  await page.click(`.mt-line[data-id="${lus}"] [data-a="next"]`);
  await page.waitForTimeout(150);
  ok((await items()).find((x) => x.id === lus).status === "verbaut", "Knopf „Verbaut“");
  await tab("verbaut");
  // Teilen: Tag
  await page.click('.mt-day [data-x="share"]');
  await page.waitForSelector(".mt-preview");
  const dayText = await txt(".mt-preview");
  ok(dayText === `Verbautes Material Teststraße 15 (${TODAY_DE}):\n• 3× Lüsterklemme\n• 25 m NYM-J 3×1,5\n• 2× Schuko-Steckdose\n• 1× Wago 221-413`, "Teilen-Text Tag:\n" + dayText);
  await page.click('.sheet [data-s="share"]');
  await page.waitForTimeout(150);
  const shared = await page.evaluate(() => window.__shared);
  ok(shared.length === 1 && shared[0].text === dayText, "navigator.share mit dem Text");
  // Filter: brauche
  await page.click('.sheet [data-mode="brauche"]');
  ok((await txt(".mt-preview")) === `Materialliste (${TODAY_DE}):\n\nOma Huber:\n• 1× Rauchmelder\n\nTeststraße 15:\n• 1× Gira E2 Rahmen anthrazit`, "Filter „Brauche ich“ (alle Baustellen)");
  await page.selectOption("#mt-sh-place", "t:oma huber");
  ok((await txt(".mt-preview")) === `Materialliste Oma Huber (${TODAY_DE}):\n• 1× Rauchmelder`, "Filter Baustelle");
  await page.selectOption("#mt-sh-place", "");
  await page.click('.sheet [data-mode="woche"]');
  ok((await txt(".mt-preview")).startsWith("Verbautes Material Teststraße 15 ("), "Filter „Woche“");
  // Kopieren-Fallback ohne navigator.share
  await page.evaluate(() => { Object.defineProperty(navigator, "share", { configurable: true, value: undefined }); });
  await page.click('.sheet [data-mode="tag"]');
  await page.click('.sheet [data-s="share"]');
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip === dayText, "Fallback: Text in der Zwischenablage");
  await shot("mt-share-390.png", false);
  await closeSheet();
  // CSV
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-x="csv"]')]);
  const csvPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, "utf8");
  ok(dl.suggestedFilename() === `Material-verbaut-${TODAY.slice(0, 7)}.csv`, "CSV-Dateiname " + dl.suggestedFilename());
  ok(csv.startsWith("﻿Datum;Baustelle;Material;Menge;Einheit;Status;Notiz") && csv.includes(`${TODAY_DE};Teststraße 15;NYM-J 3×1,5;25;m;Verbaut;`) && csv.trim().split("\r\n").length === 5, "CSV-Inhalt (4 verbaute Zeilen)");

  /* ---------- Nach Baustelle ---------- */
  await tab("orte");
  const sumTxt = await txt(".mt-sum");
  ok(sumTxt.includes("Teststraße 15") && sumTxt.includes("25 m") && sumTxt.includes("NYM-J 3×1,5") && sumTxt.includes("Oma Huber") && sumTxt.includes("1 zu besorgen"), "Zusammenfassung pro Baustelle");
  await shot("mt-orte-390.png");

  /* ---------- Katalog ---------- */
  await tab("katalog");
  await page.fill("#mt-cat-q", "5x2,5");
  await page.waitForTimeout(150);
  ok((await page.$$eval(".mt-cat-n b", (b) => b.map((x) => x.textContent)))[0] === "NYM-J 5×2,5", "Katalog-Suche");
  await page.click('.mt-cat [data-c="fav"]');
  await page.waitForTimeout(150);
  await page.fill("#mt-cat-q", "");
  await page.click('[data-x="favonly"]');
  ok((await page.$$eval(".mt-cat-n b", (b) => b.map((x) => x.textContent))).join() === "NYM-J 5×2,5", "Favoriten-Filter");
  await page.click('[data-x="favonly"]');
  await page.click('[data-x="own"]');
  await page.fill("#mt-own-n", "Busch-Jaeger Taster");
  await page.click("#mt-own-s");
  await page.waitForTimeout(200);
  ok((await txt(".mt-cat-list")).includes("Busch-Jaeger Taster"), "Eigenes Material im Katalog");
  await shot("mt-katalog-390.png");
  await page.click('.mt-cat-n:has-text("Busch-Jaeger Taster")');
  await page.waitForSelector("#mt-q");
  ok(await page.inputValue("#mt-q") === "Busch-Jaeger Taster", "Katalog → Schnell-Erfassen vorbelegt");
  await closeSheet();

  /* ---------- Dunkel + PC ---------- */
  await tab("brauche");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("mt-brauche-390-dark.png");
  await tab("verbaut");
  await shot("mt-verbaut-390-dark.png");
  await page.click(".mt-fab");
  await page.fill("#mt-q", "fi");
  await shot("mt-quickadd-390-dark.png", false);
  await closeSheet();
  await page.setViewportSize({ width: 1440, height: 900 });
  await tab("orte");
  await shot("mt-orte-1440-dark.png", false);
  await page.emulateMedia({ colorScheme: "light" });
  await tab("brauche");
  await shot("mt-brauche-1440.png", false);
  await tab("katalog");
  await shot("mt-katalog-1440.png", false);
  await page.setViewportSize({ width: 390, height: 844 });

  /* ---------- Ort-Blatt ---------- */
  await page.evaluate(() => { location.hash = "#orte"; });
  await page.waitForSelector('.place-item[data-id="p1"]');
  await page.click('.place-item[data-id="p1"]');
  await page.waitForSelector(".sheet .mt-place");
  const pt = await txt(".sheet .mt-place");
  ok(pt.includes("Material hier") && pt.includes("25 m") && pt.includes("NYM-J 3×1,5") && pt.includes("Schuko-Steckdose"), "Ort-Blatt: „Material hier“ mit Summen");
  await page.locator(".sheet .mt-place").scrollIntoViewIfNeeded();
  await shot("mt-place-390.png", false);
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("mt-place-390-dark.png", false);
  await page.emulateMedia({ colorScheme: "light" });
  await closeSheet();

  /* ---------- Berichtsheft ---------- */
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForSelector("#ap-report", { timeout: 8000 });
  await page.click("#ap-report");
  await page.waitForSelector(".rp-mat", { timeout: 5000 });
  const rp = await txt(".rp-mat");
  ok(rp === "Material: 3× Lüsterklemme, 25 m NYM-J 3×1,5, 2× Schuko-Steckdose, 1× Wago 221-413", "Berichtsheft-Zeile: " + rp);
  ok((await page.$$(".rp-mat")).length === 1, "Nur am heutigen Tag");
  await page.click('[data-rp="copy"]');
  await page.waitForTimeout(200);
  const rtxt = await page.evaluate(() => navigator.clipboard.readText());
  ok(rtxt.includes("Material: 3× Lüsterklemme, 25 m NYM-J 3×1,5"), "Material auch im Kopier-Text");
  await page.locator(".rp-mat").scrollIntoViewIfNeeded();
  await shot("mt-report-390.png", false);
  await page.click('[data-rp="close"]');

  /* ---------- Ausgestempelt: kein Knopf ---------- */
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForTimeout(300);
  ok(await page.isVisible("[data-mt=today]"), "Eingestempelt: Knopf sichtbar");

  ok(errors.length === 0, "Keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("\nAlles OK – Screenshots in " + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
