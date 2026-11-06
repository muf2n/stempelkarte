// Playwright-Test „Arbeitszeit-Pro“ (Update 10c) im lokalen Modus, feste Uhrzeit Fr 06.11.2026 10:00.
//   cd <worktree> && python3 -m http.server 8874 &   then   node tests/worktime-e2e.cjs [screenshot-dir]
// Prognose, Was-wäre-wenn, Konten, vergessene Stempelung → Nachtragen, Verlauf (Grund), Monatsabschluss
// (schließen, Bearbeiten fragt „Monat wieder öffnen?“), Excel-Export, Soll je Wochentag, Pausen-Erinnerung.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:8874/";
const OUT = process.argv[2] || require("os").tmpdir();
const NOW = new Date("2026-11-06T10:00:00").getTime();
const t = (s) => new Date(s).getTime();

function seed() {
  const w = (id, d, a, b, pause = 30, extra = {}) => ({ id, kind: "work", start: t(`${d}T${a}:00`), end: t(`${d}T${b}:00`), pauseMin: pause, placeId: null, place: "Firma", note: "", ...extra });
  return {
    entries: [
      w("e-okt", "2026-10-15", "07:00", "15:30"),
      w("e-mo", "2026-11-02", "07:00", "16:00"),
      w("e-di", "2026-11-03", "06:00", "19:30", 30, { note: "Montage" }), // 13,5 h → „sehr lange Schicht“
      w("e-mi", "2026-11-04", "07:00", "15:30"),
      // Do 05.11. fehlt → „Kein Eintrag“
    ],
    places: [], days: {}, running: null, rev: NOW,
    settings: { weeklyTarget: 40, workDays: [1, 2, 3, 4, 5], holidays: true, balanceStart: "2026-11-02",
      closedMonths: { "2026-09": { at: t("2026-10-01T08:00:00"), totals: { ist: 9000, soll: 9600, diff: -600, workDays: 20, urlaub: 1, krank: 0, za: 0 } } } },
  };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (viewport, colorScheme) => {
    const ctx = await browser.newContext({ viewport, colorScheme, hasTouch: viewport.width < 600, acceptDownloads: true });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const tx = msg.text();
      if (/Content Security Policy|Refused to/.test(tx)) errors.push("CSP: " + tx);
      else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(tx)) errors.push(tx);
    });
    page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.clock.setFixedTime(NOW);
    await page.goto(BASE);
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d)); }, seed());
    await page.reload();
    await page.click("#btn-local");
    await page.waitForSelector("#view-heute", { state: "visible" });
    await page.evaluate(() => { location.hash = "#uebersicht"; });
    await page.waitForSelector("#wt-forecast .wt-tile", { state: "visible" });
    return { ctx, page };
  };
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const local = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}"));
  // strenge CSP (kein eval) → im Node-Prozess abfragen
  const waitLocal = async (page, fn, arg) => {
    const f = new Function("d", "a", "return " + fn);
    for (let i = 0; i < 50; i++) {
      const d = await local(page);
      try { if (f(d, arg)) return; } catch { /* noch nicht */ }
      await page.waitForTimeout(100);
    }
    throw new Error("FEHLER: Zeitüberschreitung bei " + fn);
  };

  /* ======== Handy 390, dunkel ======== */
  let { ctx, page } = await mk({ width: 390, height: 844 }, "dark");
  const txt = (sel) => page.textContent(sel);

  // Prognose: Mo 8:30, Di 13:00, Mi 8:00 → 29:30 / 40:00 h
  ok((await txt("#wt-forecast .wt-tile")).includes("29:30") && (await txt("#wt-forecast .wt-tile")).includes("40:00"), "Prognose Woche: 29:30 / 40:00 h");
  ok((await txt("#wt-forecast .wt-tile")).includes("noch 10:30 h offen"), "Woche: noch 10:30 h offen");
  const saldo = (await txt("#ov-saldo")).trim();
  // Saldo: +0:30 +5:00 ±0 −8:00 (Do) = −2:30; Monatsende nach Soll bleibt gleich
  ok(saldo === "−2:30 h", "Überstundenkonto −2:30 h (" + saldo + ")");
  ok((await txt('#wt-forecast [data-r="eom"]')).includes("−2:30 h") && (await txt('#wt-forecast [data-r="eom"]')).includes("30.11."), "Kontostand am 30.11. −2:30 h");

  // Was-wäre-wenn: jeden Fr +30 Min bis 31.12. (Fr 06.11. … 18.12., 25.12. Christtag) → 7 × 0:30 = +3:30
  await page.click("#wt-wif > summary");
  await page.waitForSelector('[data-r="wif"] .wt-wif-q', { state: "visible" });
  let wif = await txt('[data-r="wif"]');
  ok(wif.includes("jeden Fr +0:30 h bis 31.12.2026"), "Was-wäre-wenn Standard: jeden Fr +0:30 h bis 31.12.");
  ok(wif.includes("+1:00 h") && wif.includes("7 Tage"), "→ +1:00 h statt −2:30 h, 7 Freitage");
  await page.fill("#wt-wif-min", "-15");
  await page.click('[data-wif-wd="1"]');
  wif = await txt('[data-r="wif"]');
  ok(wif.includes("jeden Mo, Fr −0:15 h"), "Regel geändert: Mo + Fr −0:15");

  // Konten
  const acc = await txt('#wt-accounts [data-r="acc"]');
  ok(acc.includes("Überstunden") && acc.includes("Minusstunden") && acc.includes("2:30 h") && acc.includes("Urlaub") && acc.includes("25") && acc.includes("Zeitausgleich"), "Konten: Über-/Minusstunden, Urlaub 25 Tage, Zeitausgleich");
  await page.screenshot({ path: path.join(OUT, "wt-390-dark-uebersicht.png"), fullPage: false });
  await page.locator("#worktime-panel").screenshot({ path: path.join(OUT, "wt-390-dark-panel.png") });

  // Vergessene Stempelungen: Do leer, Di 13,5 h
  const gaps = await txt("#wt-gaps");
  ok(gaps.includes("Do, 05.11.") && gaps.includes("Kein Eintrag"), "Lücke Do 05.11. erkannt");
  ok(gaps.includes("Di, 03.11.") && gaps.includes("Sehr lange Schicht (13:30 h)"), "Di 03.11.: sehr lange Schicht");

  // Nachtragen → Blatt mit Datum 05.11.
  await page.click('#wt-gaps .wt-gap-leer [data-gap]');
  await page.waitForSelector("#ef-date", { state: "visible" });
  ok(await page.inputValue("#ef-date") === "2026-11-05", "Nachtragen öffnet Blatt mit 05.11.");
  await page.fill("#ef-from", "07:00"); await page.fill("#ef-to", "15:30"); await page.fill("#ef-pause", "0");
  await page.waitForSelector("#ef-pausehint:not([hidden])");
  ok((await txt("#ef-pausehint")).includes("prüf deinen Kollektivvertrag"), "Pausenhinweis (AZG, Kollektivvertrag) bei 8:30 h ohne Pause");
  await page.fill("#ef-pause", "30");
  ok(await page.$eval("#ef-pausehint", (e) => e.hidden), "mit 30 min Pause kein Hinweis");
  await page.click("#ef-save");
  await waitLocal(page, "d.entries.some((e) => e.start === a)", t("2026-11-05T07:00:00"));
  let d = await local(page);
  const neu = d.entries.find((e) => e.start === t("2026-11-05T07:00:00"));
  ok(Array.isArray(neu.history) && neu.history.length === 1 && neu.history[0].by === "manuell" && neu.history[0].op === "neu", "neuer Eintrag: Verlauf „angelegt, manuell“");
  await page.waitForFunction(() => !document.querySelector("#wt-gaps .wt-gap-leer"));
  ok(true, "Lücke verschwindet nach dem Nachtragen");

  // Lange Schicht prüfen → Ende ändern mit Grund → Verlauf
  await page.click('#wt-gaps .wt-gap-lang [data-gap]');
  await page.waitForSelector("#ef-reason", { state: "visible" });
  ok(!(await page.$("#ef-hist")), "alter Eintrag ohne Verlauf → kein Verlauf-Bereich");
  await page.fill("#ef-to", "15:30");
  await page.fill("#ef-reason", "Ausstempeln vergessen");
  await page.click("#ef-save");
  await waitLocal(page, "(d.entries.find((e) => e.id === 'e-di') || {}).history", null);
  d = await local(page);
  const di = d.entries.find((e) => e.id === "e-di");
  ok(di.end === t("2026-11-03T15:30:00") && di.history[0].changes.some((c) => c.field === "end") && di.history[0].reason === "Ausstempeln vergessen", "Änderung protokolliert: Ende alt → neu + Grund");
  await page.evaluate(() => { location.hash = "#eintraege"; });
  await page.waitForSelector('button.entry[data-id="e-di"]', { state: "visible" });
  await page.click('button.entry[data-id="e-di"]');
  await page.waitForSelector("#ef-hist", { state: "visible" });
  await page.click("#ef-hist > summary");
  const hist = await txt("#ef-hist");
  ok(hist.includes("🕓 Verlauf") && hist.includes("Ende 19:30 → 15:30") && hist.includes("Ausstempeln vergessen") && hist.includes("von dir"), "🕓 Verlauf zeigt Ende 19:30 → 15:30, Grund, „von dir“");
  await page.locator(".sheet .box").last().screenshot({ path: path.join(OUT, "wt-390-dark-verlauf.png") });
  await page.click(".sheet .close");

  // Monatsabschluss Oktober
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForSelector('#wt-close [data-close="2026-10"]', { state: "visible" });
  ok((await txt("#wt-close")).includes("🔒 September 2026"), "September als abgeschlossen angezeigt (Snapshot)");
  await page.click('#wt-close [data-close="2026-10"]');
  await page.click('#wt-close [data-close="2026-10"]');
  await waitLocal(page, "d.settings.closedMonths && d.settings.closedMonths['2026-10']", null);
  d = await local(page);
  const oc = d.settings.closedMonths["2026-10"];
  ok(oc.totals.ist === 480 && oc.totals.soll === 21 * 480 && oc.totals.workDays === 1, "Oktober abgeschlossen mit Summen (Ist 8:00, Soll 168:00)");
  await page.waitForSelector('#wt-close [data-reopen="2026-10"]');
  ok((await txt("#wt-close")).includes("🔒 Oktober 2026"), "Oktober zeigt 🔒");

  // Oktober-Eintrag bearbeiten → „Monat wieder öffnen?“ – erst abbrechen, dann öffnen
  await page.evaluate(() => { location.hash = "#eintraege"; });
  await page.waitForSelector('[data-act="prev"]', { state: "visible" });
  await page.click('[data-act="prev"]');
  await page.waitForSelector('button.entry[data-id="e-okt"]', { state: "visible" });
  await page.click('button.entry[data-id="e-okt"]');
  await page.waitForSelector(".wt-closed-note", { state: "visible" });
  await page.fill("#ef-note", "Prüfung");
  await page.click("#ef-save");
  await page.waitForSelector('[data-wt="reopen"]', { state: "visible" });
  ok((await txt(".sheet:last-child h2")).includes("Monat wieder öffnen?"), "Bearbeiten im abgeschlossenen Monat fragt „Monat wieder öffnen?“");
  await page.click('[data-wt="keep"]');
  await page.waitForTimeout(300);
  d = await local(page);
  ok(!d.entries.find((e) => e.id === "e-okt").note && d.settings.closedMonths["2026-10"], "Abbrechen: nichts gespeichert, Monat bleibt zu");
  await page.click("#ef-save");
  await page.click('[data-wt="reopen"]');
  await waitLocal(page, "(d.entries.find((e) => e.id === 'e-okt') || {}).note === 'Prüfung'", null);
  d = await local(page);
  ok(d.settings.closedMonths["2026-10"] === null, "Monat wieder geöffnet (closedMonths['2026-10'] = null) und gespeichert");
  await ctx.close();

  /* ======== PC 1440, hell: Excel, Einstellungen ======== */
  ({ ctx, page } = await mk({ width: 1440, height: 900 }, "light"));
  await page.screenshot({ path: path.join(OUT, "wt-1440-light-uebersicht.png"), fullPage: false });
  await page.locator("#worktime-panel").screenshot({ path: path.join(OUT, "wt-1440-light-panel.png") });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#ov-xlsx")]);
  ok(dl.suggestedFilename() === "Arbeitszeiten-2026-11.xlsx", "Excel-Download Arbeitszeiten-2026-11.xlsx");
  const buf = fs.readFileSync(await dl.path());
  ok(buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from("xl/worksheets/sheet2.xml")) && buf.includes(Buffer.from("Monatsübersicht")), "xlsx ist ZIP mit 2 Blättern (Arbeitszeiten + Monat)");
  const [dc] = await Promise.all([page.waitForEvent("download"), page.click("#ov-csv")]);
  const csv = fs.readFileSync(await dc.path(), "utf8");
  ok(csv.charCodeAt(0) === 0xFEFF && csv.includes("Datum;Wochentag;Art"), "CSV mit BOM und Semikolon");

  // Einstellungen → Arbeitszeit: Soll Freitag 6 h
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "arbeitszeit" } })));
  await page.waitForSelector('#wt-settings [data-dh="5"]', { state: "visible" });
  ok((await page.getAttribute('#wt-settings [data-dh="5"]', "placeholder")) === "8", "Platzhalter Fr: 8 h (gleichmäßig)");
  await page.fill('#wt-settings [data-dh="5"]', "6");
  await page.press('#wt-settings [data-dh="5"]', "Tab");
  await waitLocal(page, "d.settings.dayHours && d.settings.dayHours['5'] === 6", null);
  await page.waitForFunction(() => document.querySelector('#wt-settings [data-dh="1"]').placeholder === "8,5");
  ok((await txt('#wt-settings [data-r="dh-sum"]')).includes("40 h pro Woche"), "Fr 6 h → Mo–Do je 8,5 h, Woche 40 h ✅");
  await page.fill("#wt-leave-label", "Urlaub 🌴");
  await page.press("#wt-leave-label", "Tab");
  await waitLocal(page, "d.settings.worktime && d.settings.worktime.leaveLabel === 'Urlaub 🌴'", null);
  await page.locator('.sh-page[data-page="arbeitszeit"]').screenshot({ path: path.join(OUT, "wt-1440-light-settings.png") });
  // Benachrichtigungen → Pausen-Erinnerung 5 h
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "benachrichtigungen" } })));
  await page.waitForSelector("#wt-pause-after", { state: "visible" });
  ok((await txt("#wt-pause-settings")).includes("Laut AZG") && (await txt("#wt-pause-settings")).includes("keine Rechtsauskunft"), "Pausen-Erinnerung mit AZG-Hinweis (keine Rechtsauskunft)");
  ok((await page.$$("#ov-pauserem")).length === 1, "vorhandener Pausen-Schalter bleibt (nicht verdoppelt)");
  await page.selectOption("#wt-pause-after", "300");
  await waitLocal(page, "d.settings.pauseAfterMin === 300", null);
  ok(true, "Pausen-Erinnerung nach 5:00 h gespeichert");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok((await txt('#wt-accounts [data-r="acc"]')).includes("Urlaub 🌴"), "Konten-Karte nutzt eigene Bezeichnung");
  await ctx.close();

  /* ======== Handy 390, hell: kurzer Blick ======== */
  ({ ctx, page } = await mk({ width: 390, height: 844 }, "light"));
  const ow = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(ow <= 390, "kein waagrechtes Scrollen bei 390 px (" + ow + ")");
  await page.locator("#worktime-panel").screenshot({ path: path.join(OUT, "wt-390-light-panel.png") });
  await ctx.close();

  await browser.close();
  if (errors.length) { console.error(errors.join("\n")); throw new Error("Konsole/CSP-Fehler: " + errors.length); }
  console.log("✓ keine Konsolen-/CSP-Fehler");
  console.log("ALLE TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
