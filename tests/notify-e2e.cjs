// Playwright-Test für die 🔔 Benachrichtigungszentrale (Update 10) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8961 &   then   node tests/notify-e2e.cjs [screenshot-dir]
// Glocke mit Zähler, Liste aus echten Quellen, Wegwischen, Alle gelesen, Tipp → Ziel, Kategorien abschalten, Zurück/Escape, PC.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8961/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

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
  const shot = async (name) => { await page.waitForTimeout(350); return page.screenshot({ path: path.join(OUT, name), fullPage: false }); };
  const badge = () => page.$eval("#btn-notify .nt-badge", (b) => (b.hidden ? "" : b.textContent));
  const titles = () => page.$$eval("#nt-body .nt-tx b", (bs) => bs.map((b) => b.textContent));

  const today = key(day(0)), tomorrow = key(day(1)), past = key(day(-3)), inTwo = key(day(2));
  const bd = day(0);
  const startPast = day(-2); startPast.setHours(7, 0, 0, 0);
  await page.goto(BASE);
  await page.evaluate(({ today, tomorrow, past, inTwo, bday, start }) => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [{ id: "e1", kind: "work", start, end: null }], places: [], days: {}, running: null, rev: Date.now(),
      settings: { weeklyTarget: 38.5, balanceStart: past, backup: { lastManual: Date.now() - 30 * 86400000 } },
      todos: [
        { id: "t1", kind: "todo", title: "Rechnung zahlen", date: past, done: false, createdAt: 1 },
        { id: "t2", kind: "todo", title: "Werkzeug zurückgeben", date: today, time: "23:59", done: false, createdAt: 2 },
        { id: "c1", kind: "termin", title: "Zahnarzt", date: tomorrow, time: "09:30", done: false, createdAt: 3 },
        { id: "b1", kind: "geburtstag", title: "Oma", bday: bday, done: false, createdAt: 4 },
      ],
    }));
    localStorage.setItem("sk-a-school_exams", JSON.stringify([{ id: "x1", kind: "Schularbeit", subject: "Mathe", date: inTwo }]));
    localStorage.setItem("sk-a-material_items", JSON.stringify([{ id: "m1", name: "Kabel NYM 3x1,5", status: "brauche" }]));
    localStorage.setItem("sk-a-money_budget", JSON.stringify([{ id: "total", amount: 100 }]));
    localStorage.setItem("sk-a-money_tx", JSON.stringify([{ id: "x1", type: "out", amount: 95, date: today, category: "essen" }]));
  }, { today, tomorrow, past, inTwo, bday: `${pad(bd.getMonth() + 1)}-${pad(bd.getDate())}`, start: startPast.getTime() });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForSelector("#notify-layer", { state: "attached" });
  await page.waitForFunction(() => { const b = document.querySelector("#btn-notify .nt-badge"); return b && !b.hidden && Number(b.textContent.replace("+", "")) >= 6; });
  const n0 = await badge();
  ok(!!n0, "Glocke zeigt Zähler (" + n0 + ")");
  ok(await page.$eval("#btn-notify .nt-badge", (b) => b.classList.contains("hot")), "Dringendes → roter Zähler");
  ok(/neu/.test(await page.getAttribute("#btn-notify", "aria-label")), "Vorlesetext mit Anzahl");
  await shot("notify-bell-390-dark.png");

  /* ---------- Liste ---------- */
  await page.click("#btn-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  const t = await titles();
  for (const want of ["Rechnung zahlen", "Werkzeug zurückgeben", "Zahnarzt", "Oma hat heute Geburtstag 🎉", "Gesamtbudget fast aufgebraucht", "Schularbeit Mathe in 2 Tagen", "1 Sache noch zu besorgen", "Zeit für ein Backup"]) {
    ok(t.includes(want), "Liste enthält „" + want + "“");
  }
  ok(t.some((x) => /ohne Ende/.test(x)), "Vergessene Stempelung (Schicht ohne Ende)");
  ok((await page.textContent("#nt-body")).includes("95"), "Budget mit Betrag (Geld nicht gesperrt)");
  ok((await page.textContent("#nt-body .nt-gh")).includes("Jetzt wichtig"), "Gruppen nach Wichtigkeit");
  await shot("notify-panel-390-dark.png");

  /* ---------- Wegwischen ---------- */
  const before = (await titles()).length;
  await page.click('#nt-body .nt-item[data-id^="mat:"] .nt-dis');
  await page.waitForFunction((n) => document.querySelectorAll("#nt-body .nt-item").length === n - 1, before);
  ok(!(await titles()).includes("1 Sache noch zu besorgen"), "Wegwischen entfernt den Hinweis");
  ok(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("stempelkarte.notify.v1")).dismissed).some((k) => k.startsWith("mat:"))), "Weggewischt wird gemerkt");

  /* ---------- Alle gelesen ---------- */
  await page.click("#notify-layer .nt-all");
  await page.waitForFunction(() => document.querySelector("#btn-notify .nt-badge").hidden);
  ok(true, "„Alle gelesen“ → Zähler weg");
  ok(await page.$$eval("#nt-body .nt-item.unread", (x) => x.length) === 0, "keine ungelesenen mehr");

  /* ---------- Escape / Zurück ---------- */
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("notify-layer").hidden);
  ok(true, "Escape schließt");
  await page.click("#btn-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("notify-layer").hidden);
  ok(true, "Zurück (Android) schließt");

  /* ---------- Tipp → Ziel ---------- */
  await page.click("#btn-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  await page.click('#nt-body .nt-go[data-id^="todo:t1:"]');
  await page.waitForFunction(() => location.hash === "#agenda" && document.getElementById("notify-layer").hidden);
  await page.waitForSelector("#sheet-root .sheet", { state: "visible" });
  ok((await page.$eval("#sheet-root .sheet", (s) => s.querySelector("input") && [...s.querySelectorAll("input")].some((i) => i.value === "Rechnung zahlen"))), "Tipp auf Aufgabe → Planer mit geöffneter Aufgabe");
  await page.click("#sheet-root .sheet .close");
  await page.click("#btn-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  await page.click('#nt-body .nt-go[data-id^="backup:"]');
  await page.waitForSelector('.sh-page[data-page="backup"]', { state: "visible" });
  ok(await page.isVisible("#backup-panel .rm-title"), "Backup-Hinweis → Einstellungen › Backup & Daten");
  await page.click('.sh-page[data-page="backup"] .sh-back');
  await page.waitForFunction(() => document.getElementById("settings-hub").dataset.level === "list");

  /* ---------- Kategorien abschalten ---------- */
  await page.click('.sh-row[data-cat="benachrichtigungen"]');
  await page.waitForSelector("#notify-panel [data-nts=termine]", { state: "visible" });
  await shot("notify-settings-390-dark.png");
  await page.click('#notify-panel label:has([data-nts="termine"])');
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("stempelkarte.local.v1")).settings.notify || {}).off?.includes("termine"));
  ok(true, "Kategorie „Termine“ aus → gespeichert");
  await page.click("#nts-open");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  ok(!(await titles()).includes("Zahnarzt"), "Termin taucht nicht mehr auf");
  await page.click('#notify-layer [data-nt="prefs"]');
  await page.waitForSelector('.sh-page[data-page="benachrichtigungen"]', { state: "visible" });
  ok(true, "„Was soll hier auftauchen?“ → Einstellungen");
  await page.click('#notify-panel label:has([data-nts="termine"])');
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("settings-hub").hidden);

  /* ---------- PC, hell ---------- */
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForTimeout(300);
  ok(await page.isVisible("#pc-notify"), "PC: Glocke in der Kopfzeile");
  await page.click("#pc-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  const box = await page.$eval("#notify-layer .nt-panel", (e) => { const r = e.getBoundingClientRect(); return { w: r.width, right: innerWidth - r.right }; });
  ok(box.w <= 440 && box.right < 60, "PC: kleines Fenster rechts oben");
  ok((await titles()).includes("Zahnarzt"), "Termine wieder an");
  await shot("notify-panel-1440-light.png");
  await page.click("#notify-layer .nt-scrim", { position: { x: 100, y: 500 } });
  await page.waitForFunction(() => document.getElementById("notify-layer").hidden);
  ok(true, "PC: Klick daneben schließt");
  const sx = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(sx, "kein waagrechtes Scrollen");
  await page.setViewportSize({ width: 390, height: 844 });
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Handy: kein waagrechtes Scrollen");
  await shot("notify-bell-390-light.png");

  ok(!errors.length, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
