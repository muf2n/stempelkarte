// Playwright-Test für Alltag › 🛒 Einkaufsliste (Update 10) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8914 &   then   node tests/einkauf-e2e.cjs [screenshot-dir]
// Schnell-Eingabe (Menge/Einheit, Kategorie raten), Vorschläge aus dem Verlauf, abhaken (rutscht nach unten),
// „Erledigte löschen“ zweistufig, Bearbeiten, Listen anlegen/wechseln, „Material fehlt“ live verknüpft (abhaken = besorgt),
// Teilen (Zwischenablage), Dashboard-Widget, Suche findet Artikel.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8914/";
const OUT = process.argv[2] || require("os").tmpdir();

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
  const add = async (text) => { await page.fill("#ek-in", text); await page.press("#ek-in", "Enter"); await page.waitForTimeout(120); };
  const rowsText = () => page.$$eval(".ek-page .ek-row .ek-name", (l) => l.map((x) => x.textContent.trim()));

  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [{ id: "p1", name: "Baustelle Huber", addr: "Hauptstraße 5", lat: 47, lng: 15, radius: 150 }], todos: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 } }));
    localStorage.setItem("sk-a-material_items", JSON.stringify([
      { id: "m1", name: "FI-Schalter 40A", qty: 2, unit: "Stk", status: "brauche", placeId: "p1", place: "Baustelle Huber", dayKey: "2026-11-06", created: 1, updated: 1 },
      { id: "m2", name: "NYM-J 3×1,5", qty: 50, unit: "m", status: "verbaut", placeId: "p1", place: "Baustelle Huber", dayKey: "2026-11-05", created: 1, updated: 1 },
    ]));
  });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(300);

  /* ---------- Kachel + Route ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="einkauf"]');
  ok((await page.textContent('.al-tile[data-id="einkauf"]')).includes("Einkaufsliste"), "Kachel „🛒 Einkaufsliste“ auf der Alltag-Seite");
  await page.click('.al-tile[data-id="einkauf"]');
  await page.waitForSelector("#ek-in");
  ok((await page.evaluate(() => location.hash)) === "#alltag/einkauf", "Route #alltag/einkauf");
  ok((await page.$$eval(".ek-lt[data-list]", (l) => l.map((x) => x.dataset.list))).join(",") === "privat,baustelle,material", "Standardlisten Privat, Baustelle + Material fehlt");
  ok((await page.textContent(".ek-page")).includes("Noch leer"), "Leere Liste mit freundlichem Hinweis");
  await shot("einkauf-empty-390-light.png");

  /* ---------- Schnell-Eingabe ---------- */
  await page.fill("#ek-in", "2 kg Äpfel");
  await page.waitForTimeout(80);
  ok((await page.textContent(".ek-guess")).includes("Lebensmittel"), "Kategorie-Vorschau beim Tippen");
  await page.press("#ek-in", "Enter");
  await page.waitForTimeout(150);
  await add("Zahnpasta");
  await add("Milch 2");
  await add("3x Wago 221");
  let items = await A("einkauf");
  ok(items.length === 4, "4 Artikel gespeichert");
  const ap = items.find((x) => x.name === "Äpfel");
  ok(ap && ap.qty === 2 && ap.unit === "kg" && ap.cat === "lebensmittel" && ap.listId === "privat", "„2 kg Äpfel“ → Menge, Einheit, Lebensmittel");
  ok(items.find((x) => x.name === "Zahnpasta").cat === "drogerie", "Zahnpasta → Drogerie");
  ok(items.find((x) => x.name === "Wago 221").cat === "baumarkt", "Wago → Baumarkt/Elektro");
  ok((await page.$$eval(".ek-gh", (l) => l.map((x) => x.textContent))).some((t) => t.includes("Lebensmittel")), "Gruppen mit Emoji-Überschrift");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "ek-in"), "Fokus bleibt im Eingabefeld");
  await add("1 kg Äpfel");
  items = await A("einkauf");
  ok(items.length === 4 && items.find((x) => x.name === "Äpfel").qty === 3, "Gleicher Artikel → Menge zusammengezählt statt doppelt");

  /* ---------- abhaken ---------- */
  await page.click('.ek-row:has-text("Zahnpasta") .ek-check');
  await page.waitForTimeout(200);
  const names = await rowsText();
  ok(names[names.length - 1].includes("Zahnpasta"), "Abgehakt rutscht nach unten");
  ok((await page.textContent(".ek-done")).includes("Erledigt"), "Bereich „Erledigt“");
  ok((await A("einkauf")).find((x) => x.name === "Zahnpasta").done === true, "done gespeichert");
  await shot("einkauf-list-390-light.png");

  /* ---------- Vorschläge aus dem Verlauf ---------- */
  await page.fill("#ek-in", "zah");
  await page.waitForTimeout(100);
  ok(await page.isVisible('[data-sugg="Zahnpasta"]'), "Vorschlag „Zahnpasta“ aus dem Verlauf");
  await page.fill("#ek-in", "");

  /* ---------- Erledigte löschen (zweistufig) ---------- */
  await page.click('[data-x="cleardone"]');
  ok((await page.textContent('[data-x="cleardone"]')).includes("Wirklich"), "Erster Tipp fragt nach");
  ok((await A("einkauf")).length === 4, "noch nichts gelöscht");
  await page.click('[data-x="cleardone"]');
  await page.waitForTimeout(200);
  ok((await A("einkauf")).length === 3 && !(await page.isVisible(".ek-done")), "Zweiter Tipp löscht Erledigte");
  await page.fill("#ek-in", "zahn");
  await page.waitForTimeout(80);
  ok(await page.isVisible('[data-sugg="Zahnpasta"]'), "Verlauf bleibt nach dem Löschen");
  await page.click('[data-sugg="Zahnpasta"]');
  await page.waitForTimeout(150);
  ok((await A("einkauf")).some((x) => x.name === "Zahnpasta" && !x.done && x.cat === "drogerie"), "Vorschlag antippen fügt hinzu");

  /* ---------- bearbeiten ---------- */
  await page.click('.ek-row:has-text("Milch") .ek-txt');
  await page.waitForSelector("#sheet-root .ek-form");
  await page.fill('#sheet-root input[name="qty"]', "3");
  await page.selectOption('#sheet-root select[name="unit"]', "l");
  await page.fill('#sheet-root input[name="note"]', "Bio");
  await page.selectOption('#sheet-root select[name="list"]', "baustelle");
  await page.click('#sheet-root button[type="submit"]');
  await page.waitForTimeout(200);
  const milk = (await A("einkauf")).find((x) => x.name === "Milch");
  ok(milk.qty === 3 && milk.unit === "l" && milk.note === "Bio" && milk.listId === "baustelle", "Bearbeiten: Menge, Einheit, Notiz, Liste");

  /* ---------- Listen ---------- */
  await page.click('.ek-lt[data-list="baustelle"]');
  ok((await rowsText()).some((t) => t.includes("Milch")), "Liste Baustelle zeigt verschobenen Artikel");
  await page.click('[data-x="newlist"]');
  await page.fill('#sheet-root input[name="name"]', "Party");
  await page.click('#sheet-root [data-e="🎉"]');
  await page.click('#sheet-root button[type="submit"]');
  await page.waitForTimeout(250);
  ok((await page.textContent('.ek-lt[aria-selected="true"]')).includes("Party"), "Neue Liste „Party“ angelegt und offen");
  await add("Chips");
  ok((await A("einkauf")).find((x) => x.name === "Chips").listId !== "privat", "Artikel landet in der neuen Liste");

  /* ---------- Teilen ---------- */
  await page.click('.ek-lt[data-list="privat"]');
  await page.evaluate(() => { try { delete Navigator.prototype.share; } catch {} navigator.share = undefined; });
  await page.click('[data-x="share"]');
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip.startsWith("🏠 Privat") && clip.includes("🥕 Lebensmittel\n• 3 kg Äpfel") && clip.includes("🔌 Baumarkt/Elektro\n• 3× Wago 221"), "Teilen kopiert Text: " + JSON.stringify(clip.slice(0, 60)));

  /* ---------- Material fehlt (live, verknüpft) ---------- */
  await page.click('.ek-lt[data-list="material"]');
  ok((await page.textContent('.ek-lt[data-list="material"]')).includes("1"), "Zähler am Reiter „Material fehlt“");
  ok((await page.textContent(".ek-page")).includes("FI-Schalter 40A") && !(await page.textContent(".ek-page")).includes("NYM"), "Nur fehlendes Material (brauche), nicht verbautes");
  await shot("einkauf-material-390-light.png");
  await page.click('[data-mid="m1"] .ek-check');
  await page.waitForTimeout(200);
  let mat = await A("material_items");
  ok(mat.find((x) => x.id === "m1").status === "besorgt" && mat.length === 2, "Abhaken setzt Material auf „besorgt“ (keine Kopie)");
  ok((await page.textContent(".ek-page")).includes("Gerade besorgt"), "Besorgtes bleibt kurz abgehakt sichtbar");
  await page.click('[data-mid="m1"] .ek-check');
  await page.waitForTimeout(200);
  mat = await A("material_items");
  ok(mat.find((x) => x.id === "m1").status === "brauche", "Zurücknehmen → wieder „brauche“");
  ok((await A("einkauf")).every((x) => !/FI-Schalter/.test(x.name)), "Material wird nie in die Einkaufsliste kopiert");

  /* ---------- Suche findet Artikel ---------- */
  await page.click("#btn-search");
  await page.fill("#srch-q", "äpfel");
  await page.waitForTimeout(200);
  ok((await page.$$eval(".srch-group[data-group]", (l) => l.map((g) => g.dataset.group))).includes("einkauf"), "Universale Suche findet Einkauf-Artikel");
  await page.click('.srch-group[data-group="einkauf"] .srch-row');
  await page.waitForTimeout(300);
  ok((await page.textContent('.ek-lt[aria-selected="true"]')).includes("Privat"), "Suchtreffer öffnet die richtige Liste");

  /* ---------- Dashboard-Widget ---------- */
  await page.goto(BASE + "#heute");
  await page.waitForSelector('[data-w="einkauf"]', { timeout: 5000 });
  const w = await page.textContent('[data-w="einkauf"]');
  ok(/\d+\s*offen/.test(w) && w.includes("Material fehlt"), "Dashboard: 🛒 Einkauf – N offen + Material");

  /* ---------- dunkel + PC ---------- */
  await page.goto(BASE + "#alltag/einkauf");
  await page.waitForSelector("#ek-in");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("einkauf-list-390-dark.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await shot("einkauf-list-1440-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await shot("einkauf-list-1440-light.png");

  ok(errors.length === 0, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("ALLE EINKAUF-TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
