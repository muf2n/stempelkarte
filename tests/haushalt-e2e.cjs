// Playwright-Test für Alltag › 🏡 Haushalt (Update 10 C) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8983 &   then   node tests/haushalt-e2e.cjs [screenshot-dir]
// Kachel + Route, leerer Putzplan, Vorschlag anlegen, eigene Aufgabe (alle N Tage, zuletzt erledigt → überfällig),
// Abhaken + Zurücknehmen, Verlauf, Wartung (monatlich, bald fällig), Raum-Filter, Mitteilungen, Dashboard, Suche, dunkel/PC.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8983/";
const OUT = process.argv[2] || require("os").tmpdir();
const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };
const monthsAgo = (m, plusDays) => { const d = new Date(); d.setMonth(d.getMonth() - m); d.setDate(d.getDate() + plusDays); return key(d); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true });
  await ctx.route("**/*", (route) => { const u = new URL(route.request().url()); return (u.hostname === "localhost" || u.hostname === "127.0.0.1") ? route.continue() : route.abort(); });
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

  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 } }));
  });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(300);

  /* ---------- Kachel + leer ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="haushalt"]');
  await page.click('.al-tile[data-id="haushalt"]');
  await page.waitForSelector(".hh-empty");
  ok((await page.evaluate(() => location.hash)) === "#alltag/haushalt", "Route #alltag/haushalt");
  ok((await page.textContent(".hh-empty")).includes("Putzplan ist noch leer"), "Leerer Putzplan mit freundlichem Hinweis");
  await shot("haushalt-empty-390-light.png");

  /* ---------- Vorschlag ---------- */
  await page.click('.hh-presets [data-i="1"]'); // Bad putzen
  await page.waitForSelector("#hh-f-title");
  ok((await page.inputValue("#hh-f-title")) === "Bad putzen" && (await page.inputValue("#hh-f-room")) === "Bad", "Vorschlag füllt das Formular");
  ok((await page.getAttribute(`${sheet} [data-fint="woechentlich"]`, "aria-pressed")) === "true", "Vorschlag: wöchentlich");
  await page.fill("#hh-f-last", daysAgo(10));
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".hh-item");
  let tasks = await A("haushalt");
  ok(tasks.length === 1 && tasks[0].unit === "w" && tasks[0].n === 1 && tasks[0].last === daysAgo(10) && tasks[0].history.length === 1, "Gespeichert (Intervall, zuletzt erledigt, Verlauf)");
  ok((await page.textContent(".hh-item")).includes("seit 3 Tagen fällig"), "Überfällig-Abzeichen");
  ok((await page.getAttribute(".hh-item", "class")).includes("is-ueber"), "Überfällig markiert");
  ok((await page.textContent(".hh-tab-n")).trim() === "1", "Reiter zeigt 1 fällig");

  /* ---------- eigene Aufgabe: alle N Tage ---------- */
  await page.click('[data-hh="new"]');
  await page.waitForSelector("#hh-f-title");
  await page.fill("#hh-f-title", "Pflanzen gießen");
  await page.fill("#hh-f-room", "Wohnzimmer");
  await page.click(`${sheet} [data-fint="tage"]`);
  ok(!(await page.$eval(`${sheet} [data-nf]`, (x) => x.hidden)), "„alle N Tage“ zeigt das Zahlenfeld");
  await page.fill("#hh-f-n", "4");
  await page.fill("#hh-f-last", daysAgo(1));
  await shot("haushalt-form-390-light.png");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(300);
  tasks = await A("haushalt");
  const pfl = tasks.find((t) => t.title === "Pflanzen gießen");
  ok(pfl && pfl.unit === "d" && pfl.n === 4, "Alle 4 Tage gespeichert");
  ok((await page.$$(".hh-item")).length === 2, "Zwei Aufgaben");
  ok((await page.$$eval(".hh-item b", (l) => l.map((x) => x.textContent)))[0] === "Bad putzen", "Überfälliges steht oben");
  ok((await page.$$(".hh-rooms .chip")).length === 3, "Raum-Filter erscheint (Alle, Bad, Wohnzimmer)");
  await page.click('.hh-rooms [data-room="Wohnzimmer"]');
  ok((await page.$$(".hh-item")).length === 1, "Raum-Filter wirkt");
  await page.click('.hh-rooms [data-room=""]');

  /* ---------- Abhaken + Zurücknehmen ---------- */
  const bad = tasks.find((t) => t.title === "Bad putzen");
  await page.click(`.hh-tick[data-id="${bad.id}"]`);
  await page.waitForTimeout(300);
  tasks = await A("haushalt");
  ok(tasks.find((t) => t.id === bad.id).last === key(new Date()) && tasks.find((t) => t.id === bad.id).history.length === 2, "Abhaken: zuletzt erledigt = heute, Verlauf +1");
  ok((await page.textContent(`.hh-tick[data-id="${bad.id}"]`)).includes("erledigt"), "Knopf zeigt „erledigt“");
  ok(!(await page.$(".hh-tab-n")), "Keine fälligen mehr");
  await shot("haushalt-list-390-light.png");
  await page.click(`.hh-tick[data-id="${bad.id}"]`);
  await page.waitForTimeout(300);
  tasks = await A("haushalt");
  ok(tasks.find((t) => t.id === bad.id).last === daysAgo(10), "Zurücknehmen stellt den alten Stand her");
  await page.click(`.hh-tick[data-id="${bad.id}"]`);
  await page.waitForTimeout(300);

  /* ---------- Verlauf ---------- */
  await page.click('[data-tab="verlauf"]');
  await page.waitForSelector(".hh-log");
  ok((await page.$$(".hh-log-row")).length === 3, "Verlauf zeigt 3 Einträge");
  ok((await page.textContent(".hh-log")).includes("Bad putzen"), "Verlauf mit Titel");

  /* ---------- Wartung ---------- */
  await page.click('[data-tab="wartung"]');
  await page.waitForSelector(".hh-empty");
  ok((await page.textContent(".hh-empty")).includes("Wartung"), "Wartung leer");
  await page.click('.hh-presets [data-i="0"]'); // Rauchmelder
  await page.waitForSelector("#hh-f-title");
  ok((await page.getAttribute(`${sheet} [data-fint="monatlich"]`, "aria-pressed")) === "true", "Rauchmelder: monatlich");
  await page.fill("#hh-f-last", monthsAgo(1, 3));
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".hh-item");
  ok((await page.textContent(".hh-item")).includes("in 3 Tagen fällig"), "Wartung: „in 3 Tagen fällig“ (bald)");
  await page.click('.hh-card');
  await page.waitForSelector("#hh-f-pause");
  ok((await page.textContent(`${sheet} .hh-fhist`)).includes("beim Anlegen"), "Formular zeigt Verlauf");
  await page.click(`${sheet} .close`);

  /* ---------- Mitteilungen ---------- */
  // Bad wieder überfällig machen
  await page.evaluate((id) => { const a = JSON.parse(localStorage.getItem("sk-a-haushalt")); const t = a.find((x) => x.id === id); t.last = "2026-01-01"; t.history = []; localStorage.setItem("sk-a-haushalt", JSON.stringify(a)); }, bad.id);
  await page.goto(BASE + "#heute");
  await page.reload();
  await page.waitForTimeout(600);
  await page.click("#btn-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  await page.waitForSelector('#nt-body .nt-item[data-id^="hh:"]', { timeout: 5000 });
  const nt = await page.$$eval('#nt-body .nt-item[data-id^="hh:"]', (l) => l.map((x) => x.textContent));
  ok(nt.some((t) => t.includes("Bad putzen")) && nt.some((t) => t.includes("Rauchmelder")), "Mitteilungen: Bad überfällig + Rauchmelder bald");
  await page.click('#nt-body .nt-item[data-id^="hh:' + bad.id + '"] .nt-go');
  await page.waitForFunction(() => location.hash === "#alltag/haushalt");
  ok(true, "Mitteilung öffnet Haushalt");

  /* ---------- Dashboard ---------- */
  await page.goto(BASE + "#heute");
  await page.waitForSelector('[data-w="haushalt"]', { timeout: 5000 });
  ok((await page.textContent('[data-w="haushalt"]')).includes("Bad putzen"), "Dashboard-Widget „Haushalt & Gewohnheiten“");

  /* ---------- Suche ---------- */
  await page.click("#btn-search");
  await page.fill("#srch-q", "rauchmelder");
  await page.waitForTimeout(300);
  ok((await page.$$eval(".srch-group[data-group]", (l) => l.map((g) => g.dataset.group))).includes("haushalt"), "Universale Suche findet Haushalt");
  await page.click('.srch-group[data-group="haushalt"] .srch-row');
  await page.waitForFunction(() => location.hash === "#alltag/haushalt");
  await page.waitForSelector(".hh-item");

  /* ---------- dunkel + PC ---------- */
  await page.click('[data-tab="putz"]');
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("haushalt-list-390-dark.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot("haushalt-list-1440-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await shot("haushalt-list-1440-light.png");
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "Kein waagrechtes Scrollen");

  ok(errors.length === 0, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("ALLE HAUSHALT-TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
