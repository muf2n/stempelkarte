// Playwright-Test für die Einstellungs-Zentrale (Update 10e) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8872 &   then   node tests/settings-hub-e2e.cjs [screenshot-dir]
// Öffnen (Zahnrad, Übersicht-Knopf, Seitenleiste am PC), jede Kategorie, Suche, Feld speichern, Zurück (Pfeil/Escape/Verlauf).
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8872/";
const OUT = process.argv[2] || require("os").tmpdir();
const CATS = ["konto", "arbeitszeit", "lehre", "taggeld", "schule", "orte", "benachrichtigungen", "aussehen", "geraete", "schutz", "assistent", "papierkorb", "hilfe"];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (/Content Security Policy|Refused to/.test(t)) errors.push("CSP: " + t);
    else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
  });
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name) => { await page.waitForTimeout(400); return page.screenshot({ path: path.join(OUT, name), fullPage: false }); };
  const local = () => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}"));
  const vis = (sel) => page.isVisible(sel);
  const level = () => page.$eval("#settings-hub", (e) => (e.hidden ? "closed" : e.dataset.level));

  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [], places: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 },
    }));
  });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForSelector("#settings-hub", { state: "attached" });

  /* ---------- Öffnen übers Zahnrad ---------- */
  await page.click("#btn-settings");
  await page.waitForSelector("#settings-hub .sh-list", { state: "visible" });
  ok(await level() === "list", "Zahnrad öffnet die Zentrale (Liste)");
  ok(await vis("#sh-q"), "Suchfeld oben");
  ok((await page.textContent("#settings-hub .sh-gh")).includes("Accounteinstellungen"), "Gruppen-Überschrift „Accounteinstellungen“");
  ok((await page.textContent('[data-val="aussehen"]')) === "Lila", "Wert rechts: Erscheinungsbild Lila");
  ok((await page.textContent('[data-val="arbeitszeit"]')) === "38,5 h/Woche", "Wert rechts: 38,5 h/Woche");
  ok((await page.textContent('[data-val="benachrichtigungen"]')) === "An", "Wert rechts: Benachrichtigungen An");
  ok(!(await vis("#sh-signout")), "Abmelden nur mit Konto (lokal ausgeblendet)");
  await shot("hub-390-dark.png");

  /* ---------- jede Kategorie öffnen, Pfeil zurück ---------- */
  for (const c of CATS) {
    await page.click(`#settings-hub .sh-row[data-cat="${c}"]`);
    await page.waitForSelector(`.sh-page[data-page="${c}"]`, { state: "visible" });
    ok(await level() === "page" && !(await vis("#sh-q")), `Kategorie „${c}“ öffnet als Unterseite`);
    await page.click(`.sh-page[data-page="${c}"] .sh-back`);
    await page.waitForFunction(() => document.getElementById("settings-hub").dataset.level === "list");
  }
  ok(true, "Pfeil zurück führt jeweils zur Liste");
  for (const [c, sel] of [["arbeitszeit", "#ov-target"], ["lehre", "#ap-start"], ["taggeld", "#allowance-panel .rm-head, #allowance-panel"], ["schule", "#school-panel"], ["orte", "#ov-radius"],
    ["benachrichtigungen", "#reminders-panel .rm-title"], ["aussehen", "[data-accent-pick]"], ["geraete", "#watch-panel"], ["papierkorb", "#ov-trash"], ["konto", "#ov-account"]]) {
    ok(await page.$eval(sel.split(",")[0].trim(), (e) => !!e.closest(".sh-page")) , `${sel.split(",")[0]} liegt in „${c}“`);
  }

  /* ---------- Suche ---------- */
  await page.fill("#sh-q", "radius");
  const shown = await page.$$eval("#settings-hub .sh-list .sh-row[data-cat]", (rs) => rs.filter((r) => !r.hidden).map((r) => r.dataset.cat));
  ok(shown.length === 1 && shown[0] === "orte", "Suche „radius“ → nur Orte & Fahrten (" + shown.join(",") + ")");
  ok((await page.textContent('.sh-row[data-cat="orte"] .sh-hit')).includes("Radius"), "Treffer-Zeile zeigt das Feld");
  await page.fill("#sh-q", "farbe");
  ok(await page.$eval('.sh-row[data-cat="aussehen"]', (r) => !r.hidden), "Suche „farbe“ findet Erscheinungsbild");
  await page.fill("#sh-q", "xyzqq");
  ok(await vis(".sh-empty"), "Nichts gefunden-Hinweis");
  await page.fill("#sh-q", "soll-stunden");
  await page.press("#sh-q", "Enter");
  await page.waitForSelector("#ov-target", { state: "visible" });
  ok(true, "Enter öffnet den ersten Treffer (Arbeitszeit)");

  /* ---------- Feld ändern → gespeichert ---------- */
  await page.fill("#ov-target", "40");
  await page.dispatchEvent("#ov-target", "change");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).settings.weeklyTarget === 40);
  ok(true, "Soll-Stunden 40 gespeichert");
  await page.click('#ov-workdays [data-wd="6"]');
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("stempelkarte.local.v1")).settings.workDays || []).includes(6));
  ok(true, "Arbeitstag Samstag gespeichert");

  /* ---------- Android-Zurück (Verlauf) ---------- */
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("settings-hub").dataset.level === "list");
  ok((await page.textContent('[data-val="arbeitszeit"]')) === "40 h/Woche", "Zurück → Liste, Wert aktualisiert (40 h/Woche)");
  await page.fill("#sh-q", "");
  await page.click('.sh-row[data-cat="aussehen"]');
  await page.click('[data-accent-pick="blau"]');
  await page.waitForFunction(() => document.documentElement.dataset.accent === "blau");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).settings.accent === "blau");
  ok(true, "Akzentfarbe Blau gespeichert");
  await page.emulateMedia({ colorScheme: "light" });
  await shot("hub-page-390-light.png");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("settings-hub").dataset.level === "list");
  ok((await page.textContent('[data-val="aussehen"]')) === "Blau", "Escape → eine Ebene hoch; Wert Blau");
  await shot("hub-390-light.png");
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("settings-hub").hidden);
  ok(true, "Zurück auf der Liste schließt die Zentrale");
  await page.emulateMedia({ colorScheme: "dark" });

  /* ---------- Übersicht-Knopf, Link-Zeilen ---------- */
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForSelector("#ov-open-settings", { state: "visible" });
  ok(!(await page.$("#view-uebersicht #ov-target")), "Übersicht hat keine lange Liste mehr");
  await page.click("#ov-open-settings");
  await page.click('.sh-row[data-cat="schutz"]');
  await page.click('[data-sh-act="privat"]');
  await page.waitForSelector(".sheet", { state: "visible" });
  ok((await page.textContent(".sheet h2")).includes("Privat-Modus"), "Privat-Modus-Einstellungen über der Zentrale");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".sheet", { state: "detached" });
  ok(await level() === "page", "Escape schließt erst das Blatt");
  await page.click('[data-sh-act="tresor"]');
  await page.waitForFunction(() => document.getElementById("settings-hub").hidden && location.hash === "#alltag/tresor");
  ok(true, "Tresor-Zeile schließt die Zentrale und öffnet Alltag › Tresor");

  /* ---------- Neu laden: alte Verlaufseinträge stören nicht ---------- */
  await page.click("#btn-settings");
  await page.click('.sh-row[data-cat="schule"]');
  await page.reload();
  await page.click("#btn-local").catch(() => {});
  await page.waitForSelector("#settings-hub", { state: "attached" });
  await page.click("#btn-settings");
  await page.click('.sh-row[data-cat="geraete"]');
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("settings-hub").hidden);
  ok(true, "Nach Neuladen: zweimal Escape schließt sauber");

  /* ---------- PC: zwei Spalten, Seitenleiste ---------- */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForTimeout(300);
  await page.click('.tabbar [data-settings], [data-settings="1"]');
  await page.waitForSelector("#settings-hub .sh-list", { state: "visible" });
  ok(await vis('.sh-page[data-page="konto"]'), "PC: Seitenleiste öffnet, rechts gleich das Konto");
  await page.click('.sh-row[data-cat="arbeitszeit"]');
  ok(await vis("#ov-target") && await vis("#sh-q"), "PC: Liste und Seite nebeneinander");
  ok(await page.$eval('.sh-row[data-cat="arbeitszeit"]', (r) => r.getAttribute("aria-current") === "page"), "PC: aktive Kategorie markiert");
  ok((await page.inputValue("#ov-target")) === "40", "Gespeicherter Wert im Feld");
  await shot("hub-1440-dark.png");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("settings-hub").hidden);
  ok(true, "PC: Escape schließt");
  const sx = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(sx, "kein waagrechtes Scrollen");

  ok(!errors.length, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
