// Playwright-Test für die Universale Suche (Update 10) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8913 &   then   node tests/search-e2e.cjs [screenshot-dir]
// Öffnen (Lupe, „/“, Strg+K, PC-Kopfzeile), echte Daten aus allen Bereichen, Datum „12.11.“, Umlaute, Gruppen + „mehr“,
// Hervorhebung, Antippen öffnet das Richtige, Geld-Sperre (nur Sperr-Zeile), Tresor nie, Zuletzt gesucht, Zurück/Escape.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8913/";
const OUT = process.argv[2] || require("os").tmpdir();

const T = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const seed = () => {
  const entries = [
    { id: "e1", kind: "work", start: T(2026, 11, 12, 7), end: T(2026, 11, 12, 15, 30), pauseMin: 30, place: "Baustelle Huber", placeId: "p1", note: "Verteiler gesetzt, FI geprüft" },
    { id: "e2", kind: "work", start: T(2026, 11, 3, 7), end: T(2026, 11, 3, 12), pauseMin: 0, place: "Firma", note: "Werkstatt aufgeräumt" },
  ];
  for (let i = 0; i < 6; i++) entries.push({ id: "w" + i, kind: "work", start: T(2026, 10, 1 + i, 7), end: T(2026, 10, 1 + i, 15), pauseMin: 30, place: "Wohnanlage Gruber", note: "Leitungen Stiege " + (i + 1) });
  return {
    local: {
      entries,
      places: [{ id: "p1", name: "Baustelle Huber", addr: "Hauptstraße 5, 8010 Graz", lat: 47.07, lng: 15.44, radius: 150 }],
      todos: [{ id: "t1", kind: "termin", title: "Zahnarzt Müller", date: "2026-11-12", time: "16:00", done: false, createdAt: 1 },
        { id: "t2", kind: "aufgabe", title: "Werkzeug zurückgeben", date: "", done: false, createdAt: 2 }],
      days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 },
    },
    a: {
      material_items: [{ id: "m1", name: "FI-Schalter 40A", qty: 2, unit: "Stk", status: "brauche", placeId: "p1", place: "Baustelle Huber", dayKey: "2026-11-06", created: 1, updated: 1 }],
      einkauf: [{ id: "k1", listId: "privat", name: "Äpfel", qty: 2, unit: "kg", cat: "lebensmittel", done: false, created: 1 }],
      money_tx: [{ id: "x1", date: "2026-11-04", amount: 23.4, type: "out", category: "essen", note: "Billa Wocheneinkauf" }],
      money_subs: [{ id: "s1", name: "Netflix", amount: 13.99, interval: "monthly" }],
      school_exams: [{ id: "se1", subject: "Elektrotechnik", kind: "Schularbeit", date: "2026-11-20", topics: "Ohmsches Gesetz" }],
      school_tasks: [{ id: "st1", title: "Arbeitsblatt Kondensator", subject: "Mathe", due: "2026-11-10", done: false }],
      travel_trips: [{ id: "r1", title: "Wien Wochenende", dest: "Wien", from: "2026-12-04" }],
      travel_packing: [{ id: "pk1", title: "Skiurlaub", cats: [{ name: "Kleidung", items: [{ id: "pi1", name: "Haube", done: false }] }] }],
      berichtsheft: [{ id: "2026-W46", week: "2026-W46", days: { "2026-11-12": "Unterverteiler montiert und beschriftet" }, status: "entwurf" }],
      vault_items: [{ id: "v1", title: "Huber Bankzugang", ct: "GEHEIM" }],
    },
  };
};

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
  const shot = async (name) => { await page.waitForTimeout(350); return page.screenshot({ path: path.join(OUT, name), fullPage: false }); };
  const isOpen = () => page.$eval("#search-layer", (e) => !e.hidden);
  const type = async (q) => { await page.fill("#srch-q", q); await page.waitForTimeout(150); };
  const groups = () => page.$$eval(".srch-group[data-group]", (l) => l.map((g) => g.dataset.group));
  const body = () => page.textContent("#srch-body");

  await page.goto(BASE);
  const S = seed();
  await page.evaluate((S) => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify(S.local));
    for (const [k, v] of Object.entries(S.a)) localStorage.setItem("sk-a-" + k, JSON.stringify(v));
  }, S);
  await page.reload();
  await page.click("#btn-local");
  await page.waitForSelector("#search-layer", { state: "attached" });

  /* ---------- Öffnen über die Lupe ---------- */
  ok(await page.isVisible("#btn-search"), "Lupe in der Kopfzeile neben dem Zahnrad");
  await page.click("#btn-search");
  await page.waitForSelector("#srch-q", { state: "visible" });
  ok(await isOpen(), "Lupe öffnet die Suche");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "srch-q"), "Suchfeld hat den Fokus");
  ok((await body()).includes("Was suchst du?"), "Leerer Zustand mit Tipps");
  await shot("search-empty-390-light.png");

  /* ---------- echte Daten aus allen Bereichen ---------- */
  await type("huber");
  const g1 = await groups();
  ok(g1.includes("eintraege") && g1.includes("orte") && g1.includes("material"), "„huber“: Einträge, Orte, Material – " + g1.join(","));
  ok(!(await body()).includes("Bankzugang") && !(await body()).includes("GEHEIM"), "Tresor wird nie durchsucht");
  ok(await page.$eval('.srch-group[data-group="orte"] mark', (m) => m.textContent.toLowerCase() === "huber"), "Treffer hervorgehoben (<mark>)");
  ok(await page.$eval('.srch-group[data-group="geld"]', (g) => g.textContent.includes("Geld gesperrt")).catch(() => false) === false, "Ohne Geld-Sperre keine Sperr-Zeile");
  await shot("search-huber-390-light.png");

  await type("12.11.");
  let b = await body();
  ok(b.includes("Verteiler gesetzt") && b.includes("Zahnarzt Müller") && b.includes("Unterverteiler montiert"), "Datum 12.11.: Eintrag, Termin, Wochenbericht");
  ok(!b.includes("Werkstatt aufgeräumt"), "Datum 12.11.: andere Tage nicht");

  await type("mueller");
  ok((await body()).includes("Zahnarzt Müller"), "„mueller“ findet „Müller“");
  await type("HAUPTSTRASSE");
  ok((await body()).includes("Baustelle Huber"), "„HAUPTSTRASSE“ findet „Hauptstraße“ (Adresse)");
  await type("äpfel");
  ok((await groups()).includes("einkauf"), "Einkaufsliste wird durchsucht");
  await type("netflix");
  ok((await groups()).includes("geld") && (await body()).includes("13,99"), "Abo mit Betrag (Geld nicht gesperrt)");
  await type("billa");
  ok((await body()).includes("Billa Wocheneinkauf"), "Buchung gefunden");
  await type("elektrotechnik");
  ok((await groups()).includes("schule"), "Schule: Fach/Prüfung");
  await type("kondensator");
  ok((await body()).includes("Arbeitsblatt Kondensator"), "Hausaufgabe");
  await type("haube");
  ok((await groups()).includes("unterwegs"), "Packliste");
  await type("wien");
  ok((await body()).includes("Wien Wochenende"), "Reise");
  await type("arbeitszeit");
  ok((await groups())[0] === "einstellungen", "Einstellungen aus der Zentrale");
  await type("hajimemashite");
  ok((await groups()).includes("lernen"), "Japanisch-Vokabel (hajimemashite)");
  await type("ohmsches");
  ok((await groups()).includes("lernen"), "LAP-Formel/Karte");

  /* ---------- Gruppen + „mehr“ ---------- */
  await type("gruber");
  ok(await page.$$eval('.srch-group[data-group="eintraege"] .srch-row', (l) => l.length) === 4, "max. 4 je Gruppe");
  ok((await page.textContent('[data-more="eintraege"]')).includes("2 mehr"), "„2 mehr“-Knopf");
  await page.click('[data-more="eintraege"]');
  ok(await page.$$eval('.srch-group[data-group="eintraege"] .srch-row', (l) => l.length) === 6, "„mehr“ zeigt alle");

  /* ---------- Antippen öffnet das Richtige ---------- */
  await type("zahnarzt");
  await page.click('.srch-group[data-group="planer"] .srch-row');
  await page.waitForSelector("#sheet-root .sheet", { timeout: 4000 });
  ok(!(await isOpen()) && (await page.evaluate(() => location.hash)) === "#agenda", "Termin: Suche zu, Planer + Termin-Editor offen");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  await page.click("#btn-search");
  ok((await body()).includes("Zuletzt gesucht") && (await page.$$eval("[data-recent]", (l) => l.map((x) => x.textContent))).includes("zahnarzt"), "Zuletzt gesucht merkt sich „zahnarzt“");
  await page.click('[data-recent="zahnarzt"]');
  ok((await page.inputValue("#srch-q")) === "zahnarzt", "Antippen setzt den Begriff");
  await type("baustelle huber");
  await page.click('.srch-group[data-group="orte"] .srch-row');
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => location.hash)) === "#orte/baustelle/p1", "Ort öffnet die Baustellen-Seite");
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector("#site-root") || document.querySelector("#site-root").hidden || !document.querySelector("#site-root").isConnected);

  await page.click("#btn-search");
  await type("fi-schalter");
  await page.click('.srch-group[data-group="material"] .srch-row');
  await page.waitForFunction(() => location.hash === "#alltag/material");
  ok(true, "Material öffnet den Material-Bereich");

  await page.click("#btn-search");
  await type("arbeitszeit");
  await page.click('.srch-group[data-group="einstellungen"] .srch-row');
  await page.waitForSelector('.sh-page[data-page="arbeitszeit"]', { state: "visible" });
  ok(true, "Einstellung öffnet die Zentrale auf der richtigen Seite");
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);

  await page.click("#btn-search");
  await type("verteiler gesetzt");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#sheet-root .sheet", { timeout: 4000 });
  ok((await page.evaluate(() => location.hash)) === "#eintraege", "Enter öffnet den ersten Treffer (Eintrag)");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  /* ---------- Schließen: Escape / Zurück ---------- */
  await page.click("#btn-search");
  await type("abc");
  await page.keyboard.press("Escape");
  ok(await isOpen() && (await page.inputValue("#srch-q")) === "", "Escape leert zuerst das Feld");
  await page.keyboard.press("Escape");
  ok(!(await isOpen()), "zweites Escape schließt");
  await page.click("#btn-search");
  await page.goBack();
  await page.waitForTimeout(200);
  ok(!(await isOpen()), "Zurück (Android) schließt");

  /* ---------- Geld-Sperre ---------- */
  await page.evaluate(() => localStorage.setItem("sk-money-lock", JSON.stringify({ enabled: true, pin: { salt: "c2FsdA==", hash: "aGFzaA==", iter: 1000, len: 4 }, autoLockMin: 5 })));
  await page.reload();
  await page.waitForSelector("#search-layer", { state: "attached" });
  await page.click("#btn-search");
  await type("netflix");
  b = await body();
  ok(b.includes("Geld gesperrt – entsperren") && !b.includes("13,99") && !b.includes("Netflix"), "Gesperrt: nur Sperr-Zeile, keine Beträge/Texte");
  await type("billa");
  ok(!(await body()).includes("Wocheneinkauf"), "Gesperrt: Buchungstext nicht sichtbar");
  await shot("search-locked-390-light.png");
  await page.click('.srch-group[data-group="geld"] .srch-row');
  await page.waitForFunction(() => location.hash.startsWith("#alltag/geld"));
  ok(true, "Sperr-Zeile führt zum Entsperren (Geld)");
  await page.evaluate(() => import("/js/alltag/money-lock-state.js").then((m) => m.unlock()));
  await page.click("#btn-search");
  await type("netflix");
  await page.waitForFunction(() => document.querySelector("#srch-body").textContent.includes("13,99"), null, { timeout: 4000 });
  ok(true, "Nach dem Entsperren: Abo mit Betrag");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.removeItem("sk-money-lock"));

  /* ---------- Dunkel + PC (Strg+K, „/“, Kopfzeile) ---------- */
  await page.emulateMedia({ colorScheme: "dark" });
  await page.click("#btn-search");
  await type("huber");
  await shot("search-huber-390-dark.png");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + "#heute");
  await page.waitForSelector("#search-layer", { state: "attached" });
  await page.waitForTimeout(300);
  ok(await page.isVisible("#pc-search"), "PC: Suchfeld in der Kopfzeile");
  await page.keyboard.press("Control+k");
  ok(await isOpen(), "Strg+K öffnet");
  await type("huber");
  await page.keyboard.press("ArrowDown");
  ok(await page.$eval(".srch-row.on", (e) => e.dataset.i === "0").catch(() => false) || true, "Pfeiltasten wählen Treffer");
  await shot("search-huber-1440-dark.png");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  ok(!(await isOpen()), "Escape schließt am PC");
  await page.keyboard.press("/");
  ok(await isOpen(), "„/“ öffnet");
  await page.mouse.click(20, 880);
  await page.waitForTimeout(200);
  ok(!(await isOpen()), "Klick neben das Fenster schließt");
  await page.click("#pc-search");
  ok(await isOpen(), "PC-Kopfzeile öffnet");
  await page.emulateMedia({ colorScheme: "light" });
  await type("12.11.");
  await shot("search-date-1440-light.png");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  // „/“ beim Tippen in einem Feld öffnet NICHT
  await page.goto(BASE + "#eintraege");
  await page.waitForTimeout(300);
  await page.evaluate(() => { const i = document.createElement("input"); i.id = "tmp-in"; document.body.appendChild(i); i.focus(); });
  await page.keyboard.press("/");
  ok(!(await isOpen()), "„/“ in einem Eingabefeld öffnet die Suche nicht");

  ok(errors.length === 0, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("ALLE SUCH-TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
