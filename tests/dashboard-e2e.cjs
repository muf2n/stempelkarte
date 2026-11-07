// Playwright-Test für das Smart Dashboard im Reiter Heute (Update 10b), lokaler Modus, feste Uhrzeit (page.clock).
//   cd <worktree> && python3 -m http.server 8873 &   then   node tests/dashboard-e2e.cjs [screenshot-dir]
// Kontext-Reihenfolge (Arbeit/Schule/Freizeit/Tag), echte Daten in Widgets, Geld-Sperre, Anpassen: aus/ein, hoch/runter, speichern.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8873/";
const OUT = process.argv[2] || require("os").tmpdir();

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const MON_10 = at(2026, 11, 9, 10);   // Montag
const MON_19 = at(2026, 11, 9, 19);
const SAT_11 = at(2026, 11, 7, 11);   // Samstag
const H = 3600e3;

function seed({ now, running = false, dashboard = null }) {
  const past = now - 3 * 24 * H;
  const data = {
    entries: [{ id: "e1", start: past, end: past + 8 * H, pauseMin: 30, kind: "work", placeId: "p1", place: "Baustelle Hauptstraße" }],
    places: [{ id: "p1", name: "Baustelle Hauptstraße", lat: 48.2, lng: 16.37, radius: 150 }],
    todos: [
      { id: "t1", kind: "termin", title: "Zahnarzt", date: "2026-11-10", time: "15:30", created: 1 },
      { id: "t2", title: "Werkzeug zurückgeben", date: "2026-11-09", created: 2 },
      { id: "t4", title: "Zimmer aufräumen", created: 4 },
      { id: "t3", kind: "geburtstag", title: "Oma Test", bday: "11-10", created: 3 },
    ],
    days: {}, rev: Date.now(),
    running: running ? { start: now - 5.5 * H, segments: [{ start: now - 5.5 * H, activity: "Arbeiten", placeId: "p1", place: "Baustelle Hauptstraße", loc: null }], placeId: "p1", place: "Baustelle Hauptstraße", note: "", people: [], pauseStart: null, pauseMs: 0, inLoc: null } : null,
    settings: { weeklyTarget: 38.5, school: { days: [2], blocks: [] }, ...(dashboard ? { dashboard } : {}) },
  };
  return data;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true, ...opts });
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
    return { ctx, page };
  };
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };

  const { ctx, page } = await mk();
  const order = () => page.$$eval("#view-heute .dash-grid > .dw", (ws) => ws.map((w) => w.dataset.w));
  const open = async (now, opts = {}, extra = null) => {
    await page.clock.setFixedTime(now);
    await page.goto(BASE);
    await page.evaluate(([d, ex]) => {
      localStorage.clear(); sessionStorage.clear();
      localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d));
      localStorage.setItem("sk-a-material_items", JSON.stringify([
        { id: "m1", name: "Schuko-Steckdose", qty: 4, unit: "Stk", status: "brauche", placeId: "p1", place: "Baustelle Hauptstraße", dayKey: "2026-11-06" },
        { id: "m2", name: "NYM-J 3x1,5", qty: 25, unit: "m", status: "baustelle", placeId: "p1", place: "Baustelle Hauptstraße", dayKey: "2026-11-06" },
        { id: "m3", name: "Abzweigdose", qty: 2, unit: "Stk", status: "verbaut", placeId: "p1", dayKey: "2026-11-05" },
      ]));
      localStorage.setItem("sk-a-money_tx", JSON.stringify([{ id: "x1", type: "out", amount: 42.5, date: "2026-11-03", category: "essen", note: "Billa" }]));
      localStorage.setItem("sk-a-money_budget", JSON.stringify([{ id: "total", amount: 300 }]));
      localStorage.setItem("sk-a-school_exams", JSON.stringify([{ id: "x1", kind: "Test", subject: "Mathe", date: "2026-11-10" }]));
      localStorage.setItem("sk-a-school_tasks", JSON.stringify([{ id: "h1", title: "Arbeitsblatt Ohm", subject: "FK", due: "2026-11-12", done: false }]));
      if (ex && ex.lock) localStorage.setItem("sk-money-lock", JSON.stringify({ enabled: true, pin: { salt: "c2FsdA==", hash: "aGFzaA==", iter: 1000, len: 4 } }));
    }, [seed({ now, ...opts }), extra]);
    await page.reload();
    await page.click("#btn-local");
    await page.waitForSelector("#view-heute .dash-grid > .dw", { state: "visible" });
    await page.waitForTimeout(300);
  };

  /* ---------- Kontext: Arbeitstag vormittags ---------- */
  await open(MON_10);
  let o = await order();
  ok(o[0] === "agenda", "Mo 10:00, nicht eingestempelt → Termine zuerst (" + o.join(",") + ")");
  ok((await page.textContent(".dash-ctx")).includes("Dein Tag"), "Kontext-Label „Dein Tag“");
  ok((await page.textContent('[data-w="agenda"]')).includes("Zahnarzt"), "Nächster Termin aus echten Daten");
  ok((await page.textContent('[data-w="agenda"]')).includes("Werkzeug zurückgeben"), "Aufgabe heute");
  ok((await page.textContent('[data-w="agenda"]')).includes("Zimmer aufräumen"), "Aufgabe ohne Datum (To-do-Liste)");
  await page.click('[data-w="agenda"] [data-tick="t4"]');
  await page.waitForFunction(() => !document.querySelector('[data-w="agenda"]').textContent.includes("Zimmer aufräumen"), null, { timeout: 5000 });
  ok(true, "Aufgabe im Dashboard abgehakt → verschwindet");
  ok((await page.textContent('[data-w="calendar"]')).includes("Morgen"), "Kalender-Vorschau zeigt Morgen");
  ok((await page.textContent('[data-w="reminders"]')).includes("Oma Test"), "Geburtstag morgen in Erinnerungen");
  ok((await page.textContent('[data-w="site"]')).includes("Baustelle Hauptstraße"), "Letzte Baustelle");
  ok((await page.textContent('[data-w="site"]')).includes("Schuko-Steckdose") && !(await page.textContent('[data-w="site"]')).includes("Abzweigdose"), "Offenes Material der Baustelle (ohne Verbautes)");
  ok((await page.textContent('[data-w="money"]')).includes("42,50"), "Finanzen: Monatsausgaben");
  ok((await page.textContent('[data-w="money"]')).includes("300"), "Finanzen: Budget");
  ok((await page.textContent('[data-w="school"]')).includes("Mathe"), "Prüfung Mathe");
  ok((await page.textContent('[data-w="school"]')).includes("Arbeitsblatt Ohm"), "Hausaufgabe");
  ok((await page.textContent('[data-w="sync"]')).includes("Gespeichert auf diesem Gerät"), "Sync-Status lokal");
  ok((await page.textContent('[data-w="balance"]')).match(/[+−]\d+:\d\d h/), "Überstundenstand mit Vorzeichen");
  await page.screenshot({ path: path.join(OUT, "dash-390-dark.png"), fullPage: true });

  /* ---------- Kontext: eingestempelt ---------- */
  await open(MON_10, { running: true });
  o = await order();
  ok(o[0] === "site", "Eingestempelt → Baustelle zuerst (" + o.join(",") + ")");
  ok((await page.textContent('[data-w="site"]')).includes("läuft gerade"), "Laufende Baustelle");
  ok((await page.textContent('[data-w="tip"]')).includes("Seit 5 h keine Pause"), "Tipp: Seit 5 h keine Pause ☕");
  ok(await page.isVisible('#view-heute [data-r="clock"]') && (await page.textContent('#view-heute [data-r="pill"]')).length > 0, "Stempelkarte bleibt da");

  /* ---------- Kontext: Abend vor Schultag ---------- */
  await open(MON_19);
  o = await order();
  ok(o[0] === "school", "Mo 19:00, Di Berufsschule → Schule zuerst (" + o.join(",") + ")");
  ok((await page.textContent('[data-w="tip"]')).includes("Morgen Berufsschule"), "Tipp: Morgen Berufsschule 🎒");
  ok((await page.textContent('[data-w="school"]')).includes("Morgen Berufsschule"), "Schul-Widget: Morgen Berufsschule");

  /* ---------- Kontext: Wochenende ---------- */
  await open(SAT_11);
  o = await order();
  ok(o[0] === "agenda" && o[1] === "calendar", "Samstag → Kalender & Privates zuerst (" + o.join(",") + ")");
  ok((await page.textContent(".dash-ctx")).includes("Feierabend"), "Kontext-Label Freizeit");

  /* ---------- Geld-Sperre ---------- */
  await open(MON_10, {}, { lock: true });
  const money = await page.textContent('[data-w="money"]');
  ok(money.includes("🔒 Geld gesperrt") && !/€/.test(money) && !money.includes("42"), "Geld gesperrt → keine Beträge");

  /* ---------- Anpassen: ausblenden, ordnen, speichern ---------- */
  await open(MON_10);
  await page.click('[data-d="edit"]');
  await page.waitForSelector(".dash-edit", { state: "visible" });
  ok(!(await page.isVisible(".dash-grid")), "Anpassen-Modus zeigt die Liste");
  ok(await page.$eval('[data-mv="up"][data-id="sync"]', (b) => b.disabled), "Bei „Automatisch sortieren“ sind Pfeile aus");
  await page.uncheck('[data-tg="tip"]');
  await page.waitForTimeout(200);
  await page.uncheck("#dash-auto");
  await page.waitForFunction(() => !document.querySelector('[data-mv="up"][data-id="sync"]').disabled);
  for (let i = 0; i < 12; i++) { await page.click('[data-mv="up"][data-id="sync"]'); await page.waitForTimeout(60); } // Update 10: 13 Widgets (+ Haushalt, Wetter)
  ok(await page.$eval(".de-list .de-row", (r) => r.dataset.id) === "sync", "Sync ganz nach oben verschoben");
  await page.click('[data-mv="down"][data-id="sync"]');
  await page.waitForTimeout(100);
  ok(await page.$$eval(".de-list .de-row", (rs) => rs[1].dataset.id) === "sync", "Und eins runter");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}").settings?.dashboard);
  await page.waitForTimeout(800);
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}").settings?.dashboard);
  const sv = saved2 || saved;
  ok(sv && sv.auto === false && sv.hidden.includes("tip") && sv.order[1] === "sync", "Gespeichert in settings.dashboard");
  await page.screenshot({ path: path.join(OUT, "dash-edit-390-dark.png"), fullPage: false });
  await page.click('[data-d="done"]');
  o = await order();
  ok(!o.includes("tip") && o[1] === "sync", "Raster folgt eigener Reihenfolge, Tipp ausgeblendet (" + o.join(",") + ")");
  ok((await page.textContent(".dash-ctx")).includes("Eigene Reihenfolge"), "Label „Eigene Reihenfolge“");
  await page.reload();
  await page.waitForSelector("#view-heute .dash-grid > .dw", { state: "visible" });
  o = await order();
  ok(!o.includes("tip") && o[1] === "sync", "Nach Neuladen erhalten");
  // Standard wiederherstellen
  await page.click('[data-d="edit"]');
  await page.click('[data-d="reset"]');
  await page.waitForTimeout(200);
  await page.click('[data-d="done"]');
  o = await order();
  ok(o.includes("tip") && o[0] === "agenda", "↺ Standard stellt alles zurück");

  /* ---------- Einstellungs-Zentrale → Anpassen ---------- */
  await page.click("#btn-settings");
  await page.click('#settings-hub .sh-row[data-cat="aussehen"]');
  await page.click('[data-sh-act="dashboard"]');
  await page.waitForSelector(".dash-edit", { state: "visible" });
  ok(true, "Erscheinungsbild › Heute-Überblick anpassen öffnet den Anpassen-Modus");
  await page.click('[data-d="done"]');

  /* ---------- Offline ---------- */
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.waitForFunction(() => (document.querySelector('[data-w="sync"]') || {}).textContent?.includes("Offline"));
  ok(true, "Offline → „📴 Offline – wird später synchronisiert“");
  await ctx.setOffline(false);
  await ctx.close();

  /* ---------- Hell 390 + PC 1440 ---------- */
  const light = await mk({ colorScheme: "light" });
  {
    const p = light.page;
    await p.clock.setFixedTime(MON_10 + 0.5 * H);
    await p.goto(BASE);
    await p.evaluate((d) => { localStorage.clear(); localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d)); }, seed({ now: MON_10 }));
    await p.reload();
    await p.click("#btn-local");
    await p.waitForSelector("#view-heute .dash-grid > .dw", { state: "visible" });
    await p.waitForTimeout(400);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 390, "390 px: kein waagrechtes Scrollen (" + sw + ")");
    await p.screenshot({ path: path.join(OUT, "dash-390-light.png"), fullPage: true });
  }
  await light.ctx.close();
  const pc = await mk({ viewport: { width: 1440, height: 900 }, colorScheme: "light", hasTouch: false });
  {
    const p = pc.page;
    await p.clock.setFixedTime(MON_10);
    await p.goto(BASE);
    await p.evaluate((d) => { localStorage.clear(); localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d)); }, seed({ now: MON_10, running: true }));
    await p.reload();
    await p.click("#btn-local");
    await p.waitForSelector("#view-heute .dash-grid > .dw", { state: "visible" });
    await p.waitForTimeout(400);
    const cols = await p.$eval("#view-heute .dash-grid", (g) => getComputedStyle(g).gridTemplateColumns.split(" ").length);
    ok(cols === 2, "PC Heute: zwei Spalten");
    await p.screenshot({ path: path.join(OUT, "dash-1440-heute.png"), fullPage: true });
    await p.evaluate(() => { location.hash = "#eintraege"; });
    await p.waitForTimeout(600);
    ok(await p.isVisible("#view-heute .dash"), "PC Kalender-Seite: Dashboard in der rechten Spalte");
    ok(!(await p.isVisible('#view-heute [data-w="balance"]')), "Rechte Spalte: Überstunden nicht doppelt");
    const over = await p.$eval("#view-heute", (v) => v.scrollWidth - v.clientWidth);
    ok(over <= 1, "Rechte Spalte läuft nicht über (" + over + ")");
    await p.screenshot({ path: path.join(OUT, "dash-1440.png"), fullPage: true });
  }
  await pc.ctx.close();

  await browser.close();
  if (errors.length) { console.error("Konsolen-Fehler:\n" + errors.join("\n")); process.exit(1); }
  console.log("Alles grün ✔");
})().catch((e) => { console.error(e); process.exit(1); });
