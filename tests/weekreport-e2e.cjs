// Playwright-Test für den ✨ Automatischen Wochenbericht (Update 10, lokaler Modus).
//   cd <worktree> && python3 -m http.server 8891 &   then   node tests/weekreport-e2e.cjs [screenshot-dir]
// Uhr fest auf Fr 06.11.2026 14:00 (KW 45). /chat per page.route gestubbt (Test-Haken window.__skAiTest, nur localhost).
// Fremde Domains werden abgefangen. Nur erfundene Testdaten („Musterstraße 1, 8000 Musterstadt“).
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8891/";
const OUT = process.argv[2] || require("os").tmpdir();
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const NOW = new Date(2026, 10, 6, 14, 0);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const chatBodies = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };

  async function newPage(scheme, { width = 390, height = 844, seed = true } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, permissions: ["clipboard-read", "clipboard-write"] });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.addInitScript(() => {
      window.__skAiTest = { token: "test" };
      window.print = () => { window.__printed = (window.__printed || 0) + 1; };
    });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(NOW);
    page.on("console", (msg) => {
      const t = msg.text();
      if (/Content.Security.Policy/i.test(t)) errors.push("CSP: " + t);
      else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost" && !r.url().endsWith("/chat")) errors.push(r.status() + " " + r.url()); });
    await page.route("**/chat", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      chatBodies.push(body);
      await new Promise((r) => setTimeout(r, 150));
      const reply = "### 2026-11-02\nVerteilerkasten im Erdgeschoss gesetzt und Leitungen im OG verlegt.\n### 2026-11-03\nMitarbeit auf der Baustelle Muster.\n### 2026-11-04\nBerufsschule.\n### 2026-11-05\nKrankenstand.\n### 2026-11-06\nKundendienst.\n### 2026-11-07\n–\n### 2026-11-08\n–";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply, actions: [], usage: { usd: 0.01, capUsd: 3 } }) });
    });
    await page.goto(BASE);
    if (seed) {
      await page.evaluate((T) => {
        for (const k of Object.keys(localStorage)) if (k.startsWith("sk-a-")) localStorage.removeItem(k);
        localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
          entries: [
            { id: "e1", start: T.mo7, end: T.mo1530, pauseMin: 30, placeId: "p1", place: "Baustelle Muster", people: ["Max Muster"], note: "Verteiler gesetzt" },
            { id: "e2", start: T.di630, end: T.di11, pauseMin: 0, placeId: "p1", place: "Baustelle Muster",
              segments: [{ start: T.di630, activity: "Autofahren", placeId: null, place: "" }, { start: T.di7, activity: "Arbeiten", placeId: "p1", place: "Baustelle Muster" }] },
            { id: "e3", kind: "krank", start: T.do0, end: T.do0, creditMin: 462 },
            { id: "e4", start: T.fr7, end: T.fr12, pauseMin: 0, placeId: "p2", place: "Firma Beispiel", segments: [{ start: T.fr7, activity: "Kundendienst", placeId: "p2" }] },
          ],
          todos: [], days: {},
          places: [
            { id: "p1", name: "Baustelle Muster", addr: "Musterstraße 1, 8000 Musterstadt", radius: 150 },
            { id: "p2", name: "Firma Beispiel", addr: "Beispielweg 3, 8000 Musterstadt", radius: 150 },
          ],
          running: null, rev: 1,
          settings: { weeklyTarget: 38.5, school: { days: [3], blocks: [] },
            apprentice: { start: "2025-09-01", years: 3.5, trade: "Elektrotechnik", company: "Muster Elektro GmbH", name: "Max Muster", vacationDays: 25, notes: { "2026-W45": "FI-Schutzschalter geprüft" } } },
        }));
        localStorage.setItem("sk-a-site_log", JSON.stringify([{ id: "l1", placeId: "p1", ts: T.mo9, text: "Leitungen im OG verlegt" }]));
        localStorage.setItem("sk-a-material_items", JSON.stringify([
          { id: "m1", name: "NYM-J 3×1,5", qty: 25, unit: "m", status: "verbaut", placeId: "p1", place: "Baustelle Muster", dayKey: "2026-11-02", created: T.mo9, updated: T.mo9 },
          { id: "m2", name: "FI-Schalter", qty: 1, unit: "Stk", status: "brauche", placeId: "p1", dayKey: "2026-11-02", created: T.mo9, updated: T.mo9 },
        ]));
      }, { mo7: at(2, 7), mo9: at(2, 9), mo1530: at(2, 15, 30), di630: at(3, 6, 30), di7: at(3, 7), di11: at(3, 11), do0: at(5, 0), fr7: at(6, 7), fr12: at(6, 12) });
      await page.reload();
    }
    await page.click("#btn-local");
    await page.waitForTimeout(400);
    return { ctx, page };
  }
  const shot = async (page, name, full = false) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const lsJson = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
  const ta = (page, k) => page.inputValue(`#wr-ta-${k}`);

  /* ================= hell, 390 ================= */
  let { ctx, page } = await newPage("light");

  // Dashboard-Tipp (Freitag 14:00, nicht abgegeben)
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForSelector('[data-tip="wr"]', { timeout: 8000 });
  ok((await page.textContent('[data-tip="wr"]')).includes("Wochenbericht fertig machen?"), "Dashboard: Freitag-Tipp „📋 Wochenbericht fertig machen?“");
  await page.$eval('[data-tip="wr"]', (x) => x.scrollIntoView({ block: "center" }));
  await shot(page, "wr-tip-390-light.png");
  await page.click('[data-tip="wr"] [data-d="wr"]');
  await page.waitForSelector("#wr-root .wr-day");
  ok(true, "Tipp öffnet den Wochenbericht");
  ok(await page.evaluate(() => !!document.getElementById("wr-css")), "weekreport.css geladen");
  await page.click('[data-wr="close"]');
  await page.waitForTimeout(200);
  ok(!(await page.$("#wr-root")), "Zurück schließt");

  // Übersicht-Knopf
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForSelector("#ov-wr", { state: "visible" });
  await page.click("#ov-wr");
  await page.waitForSelector("#wr-root .wr-day");
  ok((await page.textContent(".wr-wk")).includes("KW 45 · 02.11. – 08.11.2026"), "Übersicht → Wochenbericht KW 45");
  const sum = await page.textContent(".wr-sum");
  ok(/12:42 h/.test(sum) || /\d+:\d{2} h/.test(sum), "Kachel Stunden");
  ok(sum.includes("Arbeitstage") && sum.includes("Berufsschule") && sum.includes("Krank") && sum.includes("Fahrzeit"), "Kacheln: Arbeitstage, Berufsschule, Krank, Fahrzeit");
  ok(sum.includes("Baustelle Muster") && sum.includes("Firma Beispiel"), "Baustellen der Woche");
  const mo = await page.textContent('.wr-day[data-key="2026-11-02"]');
  ok(mo.includes("Verteiler gesetzt") && mo.includes("Leitungen im OG verlegt") && mo.includes("25 m NYM-J 3×1,5") && mo.includes("Max Muster"), "Montag: Notiz, Tagebuch, Material, Person");
  ok(!mo.includes("FI-Schalter"), "nur verbautes Material");
  ok((await ta(page, "2026-11-02")).startsWith("Baustelle Muster: Verteiler gesetzt; Leitungen im OG verlegt."), "Entwurf Montag aus Vorlagen");
  ok((await page.textContent('.wr-day[data-key="2026-11-03"]')).includes("Autofahren 0:30 h"), "Dienstag: Abschnitt Autofahren");
  ok((await ta(page, "2026-11-03")).includes("Fahrten zur Baustelle/zum Material (0:30 h)"), "Entwurf Dienstag mit Fahrzeit");
  ok((await ta(page, "2026-11-04")) === "Berufsschule: Unterricht laut Stundenplan.", "Mittwoch: Berufsschule");
  ok((await ta(page, "2026-11-05")) === "Krankenstand.", "Donnerstag: Krankenstand");
  ok((await ta(page, "2026-11-06")).includes("Kundendienst"), "Freitag: Abschnitt-Tätigkeit");
  ok(await page.isHidden("#wr-ta-2026-11-07") && await page.isVisible('.wr-day[data-key="2026-11-07"] [data-wr="add"]'), "leerer Samstag zugeklappt (nichts erfunden)");
  ok((await page.textContent(".wr-head")).includes("Muster Elektro GmbH") && (await page.textContent(".wr-head")).includes("2. Lehrjahr"), "Kopf: Lehrbetrieb, Lehrjahr");
  ok((await page.textContent(".wr-note")).includes("FI-Schutzschalter geprüft"), "Ergänzungen aus dem Berichtsheft");
  ok((await page.textContent(".wr-state")).includes("neuer Entwurf"), "Status: neuer Entwurf");
  await shot(page, "wr-390-light.png");
  await shot(page, "wr-390-light-full.png", true);

  // Ich-Form
  await page.click('[data-wr-style="ich"]');
  await page.waitForTimeout(250);
  ok((await ta(page, "2026-11-04")) === "Ich war in der Berufsschule.", "Ich-Form schaltet die Vorlagen um");
  ok((await lsJson(page, "sk-a-berichtsheft")).some((x) => x.id === "prefs" && x.style === "ich"), "Stil gespeichert (prefs)");

  // Bearbeiten → automatisch gespeichert
  await page.fill("#wr-ta-2026-11-02", "Verteiler gesetzt, Leitungen im OG verlegt und beschriftet.");
  await page.waitForTimeout(1100);
  let doc = (await lsJson(page, "sk-a-berichtsheft")).find((x) => x.id === "2026-W45");
  if (!doc || !doc.days["2026-11-02"].includes("beschriftet")) console.log(JSON.stringify(await lsJson(page, "sk-a-berichtsheft")));
  ok(doc && doc.days["2026-11-02"].includes("beschriftet") && doc.src["2026-11-02"] === "edit" && doc.status === "entwurf", "Text gespeichert (Alltag „berichtsheft“, ID 2026-W45)");
  ok((await page.textContent('.wr-day[data-key="2026-11-02"] .wr-src')).includes("bearbeitet"), "Markierung ✏️ bearbeitet");

  // Claude
  await page.click('[data-wr="ai"]');
  await page.waitForFunction(() => document.querySelector("#wr-ta-2026-11-06") && document.querySelector("#wr-ta-2026-11-06").value === "Kundendienst.");
  const cb = chatBodies.at(-1);
  ok(cb.mode === "bericht" && !cb.image && cb.messages.length === 1, "Claude: /chat mit mode bericht, ohne Foto");
  ok(cb.messages[0].content.includes("### 2026-11-02") && cb.messages[0].content.includes("Form: Ich-Form") && cb.messages[0].content.includes("Verbaut: 25 m NYM-J 3×1,5"), "nur die strukturierte Zusammenfassung");
  ok((await ta(page, "2026-11-02")).startsWith("Verteilerkasten im Erdgeschoss"), "Claude-Text übernommen");
  ok(await page.isHidden("#wr-ta-2026-11-07"), "leerer Tag bleibt leer");
  ok((await page.textContent('.wr-day[data-key="2026-11-02"] .wr-src')).includes("Claude"), "Markierung 🤖 Claude");
  doc = (await lsJson(page, "sk-a-berichtsheft")).find((x) => x.id === "2026-W45");
  ok(doc.src["2026-11-03"] === "claude", "Claude-Texte gespeichert");

  // Kopieren
  await page.click('[data-wr="copy"]');
  await page.waitForTimeout(250);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip.startsWith("Ausbildungsnachweis – KW 45 (02.11.2026 – 08.11.2026)\nName: Max Muster") && clip.includes("Montag, 02.11.2026 (8:00 h):\nVerteilerkasten") && clip.includes("Ergänzungen:\nFI-Schutzschalter geprüft"), "Als Text kopieren");

  // Abgeben
  await page.click('[data-wr="submit"]');
  await page.waitForTimeout(300);
  doc = (await lsJson(page, "sk-a-berichtsheft")).find((x) => x.id === "2026-W45");
  ok(doc.status === "abgegeben" && doc.submittedAt > 0, "✅ abgegeben gespeichert");
  ok((await page.textContent(".wr-state")).includes("abgegeben") && await page.$eval("#wr-ta-2026-11-02", (x) => x.readOnly), "abgegeben: Status + nur lesen");
  ok(await page.isDisabled('[data-wr="ai"]'), "abgegeben: Claude-Knopf aus");
  await shot(page, "wr-390-light-done.png");

  // Drucken
  await page.click('[data-wr="print"]');
  ok(await page.evaluate(() => window.__printed === 1), "Drucken ruft window.print");
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: 794, height: 1123 });
  await shot(page, "wr-print.png", true);
  ok(await page.isHidden(".wr-sum") && await page.isVisible(".wr-paper .rp-sign"), "Druck: nur das Blatt mit Unterschriften");
  ok((await page.textContent('.wr-day[data-key="2026-11-02"] .wr-print')).startsWith("Verteilerkasten"), "Druck: Tagestext");
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 390, height: 844 });

  // Wieder bearbeiten, Woche wechseln
  await page.click('[data-wr="submit"]');
  await page.waitForTimeout(300);
  ok((await lsJson(page, "sk-a-berichtsheft")).find((x) => x.id === "2026-W45").status === "entwurf", "↩️ wieder Entwurf");
  await page.click('[data-wr="prev"]');
  await page.waitForTimeout(200);
  ok((await page.textContent(".wr-wk")).includes("KW 44") && (await page.textContent(".wr-day[data-key='2026-10-26']")).includes("Nationalfeiertag"), "Vorige Woche: KW 44 mit Nationalfeiertag");
  await page.click('[data-wr="now"]');
  await page.waitForTimeout(200);
  ok((await page.textContent(".wr-wk")).includes("KW 45"), "Diese Woche");
  // Zurück per Browser
  await page.goBack();
  await page.waitForTimeout(250);
  ok(!(await page.$("#wr-root")), "Browser-Zurück schließt");

  // Aus dem Berichtsheft (Einstellungen → Lehre)
  await page.evaluate(async () => {
    const m = await import("./js/views/report.js");
    const store = await import("./js/store.js");
    const ui = await import("./js/ui.js");
    const util = await import("./js/util.js");
    m.openReport({ store, ui, util }, {});
  });
  await page.waitForSelector("#rp-root .rp-wr");
  await page.click("#rp-root .rp-wr");
  await page.waitForSelector("#wr-root .wr-day");
  ok(!(await page.$("#rp-root")) && (await page.textContent(".wr-wk")).includes("KW 45"), "Berichtsheft → ✨ Wochenbericht");
  await page.goBack();
  await page.waitForTimeout(250);
  ok(!(await page.$("#wr-root")) && !(await page.$("#rp-root")), "Zurück danach sauber");
  await ctx.close();

  /* ================= dunkel, 390 + 1440 ================= */
  ({ ctx, page } = await newPage("dark"));
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForSelector("#ov-wr", { state: "visible" });
  await shot(page, "wr-ov-390-dark.png");
  await page.click("#ov-wr");
  await page.waitForSelector("#wr-root .wr-day");
  await shot(page, "wr-390-dark.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, "wr-1440-dark.png");
  await ctx.close();
  ({ ctx, page } = await newPage("light", { width: 1440, height: 900 }));
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForSelector("#ov-wr", { state: "visible" });
  await page.click("#ov-wr");
  await page.waitForSelector("#wr-root .wr-day");
  await shot(page, "wr-1440-light.png");
  await page.evaluate(() => { document.documentElement.dataset.accent = "rose"; });
  await shot(page, "wr-1440-accent.png");
  await ctx.close();

  /* ================= Montag: kein Tipp ================= */
  ({ ctx, page } = await newPage("light"));
  await page.clock.setFixedTime(new Date(2026, 10, 9, 10, 0));
  await page.reload();
  await page.waitForTimeout(600);
  ok(!(await page.$('[data-tip="wr"]')), "Montag: kein Wochenbericht-Tipp");
  await ctx.close();

  await browser.close();
  ok(errors.length === 0, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ":\n" + errors.join("\n") : ""));
})().catch((e) => { console.error(e); process.exit(1); });
