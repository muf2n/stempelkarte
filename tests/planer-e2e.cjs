// Playwright-Test für den Planer (Update 9): Ansichten Liste/Tag/Woche/Monat, Wischen, „Neu erstellen“,
// Geburtstage (über den Jahreswechsel), Countdown, Jetzt-Linie, Tippen-zum-Anlegen. Lokaler Modus.
//   cd <worktree> && python3 -m http.server 8852 &   then   node tests/planer-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8852/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };

  async function newPage(opts) {
    const ctx = await browser.newContext(opts);
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); }); // abgefangene fremde Domains
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return { ctx, page };
  }

  const now = new Date();
  const tK = key(now);
  const in12 = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 12));
  const nextJan3 = `${now.getFullYear() + 1}-01-03`;

  // Vorab: Arbeitseintrag heute (Abschnitte) + Berufsschule an einem Wochentag, über localStorage
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true });
  await page.goto(BASE);
  const wdSchool = (now.getDay() + 1) % 7 === 0 ? 1 : (now.getDay() + 1) % 7; // morgen (kein Sonntag)
  await page.evaluate(({ wdSchool }) => {
    const d = new Date(); d.setHours(7, 0, 0, 0);
    const s = d.getTime();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [{ id: "e1", start: s, end: s + 3 * 3600e3, pauseMin: 0, kind: "work", place: "Firma",
        segments: [{ start: s, end: s + 3600e3, activity: "Autofahren" }, { start: s + 3600e3, end: s + 3 * 3600e3, activity: "Arbeiten" }] }],
      places: [], todos: [
        // Bestand (altes Format) – muss unverändert funktionieren
        { id: "told", title: "Alte Aufgabe", kind: "todo", date: null, time: null, remind: false, done: false, note: "", createdAt: 1 },
      ], days: {}, running: null, rev: 0,
      settings: { weeklyTarget: 38.5, school: { days: [wdSchool], blocks: [] } },
    }));
    localStorage.removeItem("stempelkarte.planerMode");
  }, { wdSchool });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = "#agenda"; });
  await page.waitForSelector(".pl-switch");
  ok(await page.isVisible("[data-r=qc] .pl-qc"), "„Neu erstellen“-Reihe sichtbar");
  ok((await page.$$(".pl-qc-b")).length === 6, "6 Schnellknöpfe");
  ok((await page.textContent(".ag-lists")).includes("Alte Aufgabe"), "Bestehende Aufgabe in der Liste");

  // --- Bestehende Funktion: Schnelleingabe
  await page.fill("[data-r=qtext]", "Zahnarzt morgen 14:30");
  await page.press("[data-r=qtext]", "Enter");
  await page.waitForTimeout(400);
  ok((await page.textContent(".ag-lists")).includes("Zahnarzt"), "Schnelleingabe legt Termin an");

  // --- Quick-create Aufgabe
  await page.click('[data-pnew="aufgabe"]');
  await page.waitForSelector(".sheet [data-r=title]");
  await page.fill(".sheet [data-r=title]", "Werkzeug zurückbringen");
  await page.click(".sheet [data-r=save]");
  await page.waitForTimeout(350);
  ok((await page.textContent(".ag-lists")).includes("Werkzeug zurückbringen"), "Quick-create Aufgabe");

  // --- Quick-create Event mit Countdown (in 12 Tagen)
  await page.click('[data-pnew="event"]');
  await page.waitForSelector(".sheet [data-r=title]");
  ok(await page.$eval('.sheet [data-cat="event"]', (b) => b.getAttribute("aria-pressed") === "true"), "Event-Kategorie vorgewählt");
  ok(await page.$eval(".sheet [data-r=countdown]", (b) => b.checked), "Countdown vorgewählt");
  await page.fill(".sheet [data-r=title]", "Urlaub Kroatien");
  await page.click('.sheet [data-cat="urlaub"]');
  await page.fill(".sheet [data-r=date]", in12);
  await page.click(".sheet [data-r=save]");
  await page.waitForTimeout(400);
  const cd = await page.textContent("[data-r=cd]");
  ok(cd.includes("12") && cd.includes("Urlaub Kroatien") && cd.includes("🏖️"), "Countdown-Karte „noch 12 Tage – Urlaub Kroatien“");

  // --- Quick-create Erinnerung
  await page.click('[data-pnew="erinnerung"]');
  await page.waitForSelector(".sheet [data-r=title]");
  ok(await page.$eval(".sheet [data-r=remind]", (b) => b.checked), "Erinnerung: Erinnern an");
  await page.fill(".sheet [data-r=title]", "Lehrlingsentschädigung prüfen");
  await page.click(".sheet [data-r=save]");
  await page.waitForTimeout(300);

  // --- Quick-create Geburtstag (3. Jänner, Jahr 2008) → über Jahreswechsel
  await page.click('[data-pnew="geburtstag"]');
  await page.waitForSelector(".sheet [data-r=name]");
  await page.fill(".sheet [data-r=name]", "Max Muster");
  await page.selectOption(".sheet [data-r=d]", "3");
  await page.selectOption(".sheet [data-r=m]", "1");
  await page.fill(".sheet [data-r=y]", "2008");
  await page.waitForTimeout(100);
  const hint = await page.textContent(".sheet [data-r=age]");
  ok(hint.includes(`wird ${now.getFullYear() + 1 - 2008}`), "Formular zeigt nächstes Alter: " + hint);
  ok(await page.$eval(".sheet [data-r=rd]", (s) => s.value === "1") && await page.$eval(".sheet [data-r=rt]", (s) => s.value === "09:00"), "Erinnerung Standard 1 Tag vorher 09:00");
  await page.click(".sheet [data-r=save]");
  await page.waitForTimeout(400);
  // zweiter Geburtstag heute ohne Jahr
  await page.click('[data-pnew="geburtstag"]');
  await page.fill(".sheet [data-r=name]", "Oma Hilde");
  await page.selectOption(".sheet [data-r=d]", String(now.getDate()));
  await page.selectOption(".sheet [data-r=m]", String(now.getMonth() + 1));
  await page.click(".sheet [data-r=save]");
  await page.waitForTimeout(400);
  const bds = await page.textContent(".pl-bds");
  ok(bds.includes("Max Muster") && bds.includes(`wird ${now.getFullYear() + 1 - 2008}`), "Geburtstage-Liste mit Alter");
  ok(bds.includes("Oma Hilde") && bds.includes("Heute 🎉"), "Geburtstag heute mit „Heute 🎉“");
  ok(!(await page.textContent(".ag-nodate, .ag-lists")).includes("Ohne Datum") || !(await page.textContent(".ag-nodate")).includes("Max Muster"), "Geburtstag nicht unter „Ohne Datum“");
  const stored = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
    return d.todos.find((t) => t.title === "Max Muster");
  });
  ok(stored && stored.kind === "geburtstag" && stored.bday === "01-03" && stored.byear === 2008 && stored.remindDays === 1, "Geburtstag korrekt gespeichert (kind/bday/byear/remindDays)");
  await page.reload();
  await page.click("#btn-local").catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => { location.hash = "#agenda"; });
  await page.waitForSelector(".pl-bds");
  ok((await page.textContent(".pl-bds")).includes("Max Muster"), "Geburtstag übersteht Neuladen (normTodo)");

  // --- Quick-create Einsatz
  await page.click('[data-pnew="einsatz"]');
  await page.waitForSelector(".sheet [data-r=place]");
  await page.fill(".sheet [data-r=place]", "Baustelle Hauptstraße");
  await page.click(".sheet [data-r=save]");
  await page.waitForTimeout(400);

  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "pl-list-390-light.png"), fullPage: true });

  // --- Tag-Ansicht
  await page.click('[data-mode="tag"]');
  await page.waitForSelector(".pl-tl-scroll[data-pscroll=day]");
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => localStorage.getItem("stempelkarte.planerMode")) === "tag", "Ansicht gemerkt (localStorage)");
  const st = await page.$eval("[data-pscroll=day]", (e) => e.scrollTop);
  const hNow = now.getHours() + now.getMinutes() / 60;
  ok(st > 200 || hNow > 14, `Zeitleiste gescrollt (scrollTop ${st})`);
  ok(await page.$(".pl-now") !== null, "Jetzt-Linie vorhanden");
  const nowTop = await page.$eval(".pl-now", (e) => parseFloat(e.style.top));
  ok(Math.abs(nowTop - hNow * 56) < 3, "Jetzt-Linie an richtiger Position");
  const dayTxt = await page.textContent("[data-r=cal]");
  ok(dayTxt.includes("Autofahren") && dayTxt.includes("Arbeiten"), "Arbeitszeit-Blöcke nach Tätigkeit");
  ok(await page.$(".pl-blk.pl-a-autofahren") && await page.$(".pl-blk.pl-a-arbeiten"), "Blöcke farbig nach Tätigkeit");
  ok(dayTxt.includes("Oma Hilde") && dayTxt.includes("Baustelle Hauptstraße"), "Ganztägig: Geburtstag + Einsatz");
  ok(dayTxt.includes("Lehrlingsentschädigung prüfen"), "Erinnerung als Block im Tag");

  // Tippen auf freie Stelle → Termin um 20:00
  await page.$eval("[data-pscroll=day]", (e) => { e.scrollTop = 17 * 56; });
  const slot = await page.$('[data-pslot][data-h="20"]');
  await page.$eval("[data-r=cal]", (e) => e.scrollIntoView({ block: "end" }));
  await page.$eval("[data-pscroll=day]", (e) => { e.scrollTop = 17 * 56; });
  const bb = await slot.boundingBox();
  await page.mouse.click(bb.x + bb.width - 20, bb.y + 5);
  await page.waitForSelector(".sheet [data-r=time]");
  ok(await page.$eval(".sheet [data-r=time]", (i) => i.value) === "20:00", "Tippen auf freie Stelle → Termin um 20:00");
  ok(await page.$eval('.sheet [data-k="termin"]', (b) => b.getAttribute("aria-pressed") === "true"), "Art Termin vorgewählt");
  await page.fill(".sheet [data-r=title]", "Fußballtraining");
  await page.fill(".sheet [data-r=endtime]", "21:30");
  await page.click(".sheet [data-r=save]");
  await page.waitForTimeout(400);
  const blk = await page.$('.pl-blk:has-text("Fußballtraining")');
  ok(blk, "Neuer Termin als Block");
  const bh = await blk.evaluate((e) => parseFloat(e.style.height));
  ok(bh > 80, "Block 20:00–21:30 hoch genug (" + bh + "px)");
  ok(await page.$eval("[data-pscroll=day]", (e) => e.scrollTop) > 800, "Scrollposition bleibt nach Speichern");

  // Checkbox im Block
  const chk = await page.$('.pl-blk:has-text("Fußballtraining") .pl-chk');
  await chk.click();
  await page.waitForTimeout(400);
  ok(await page.$('.pl-blk.done:has-text("Fußballtraining")'), "Abhaken im Block");
  await page.click('.pl-blk:has-text("Fußballtraining") .pl-blk-m');
  await page.waitForSelector(".sheet [data-r=title]");
  ok(await page.$eval(".sheet [data-r=title]", (i) => i.value) === "Fußballtraining", "Block antippen öffnet Bearbeiten");
  await page.click(".sheet [data-r=toggle]");
  await page.waitForTimeout(300);
  // Arbeitseintrag öffnet Eintragsformular
  await page.$eval("[data-pscroll=day]", (e) => { e.scrollTop = 6 * 56; });
  await page.$eval(".pl-blk.pl-a-arbeiten .pl-blk-m", (e) => e.click());
  await page.waitForSelector(".sheet");
  ok(await page.$(".sheet"), "Arbeitszeit-Block öffnet Eintrag");
  await page.click(".sheet .close");
  await page.waitForTimeout(150);
  await page.$eval("[data-pscroll=day]", (e) => { e.scrollTop = 6 * 56 - 8; });
  await page.screenshot({ path: path.join(OUT, "pl-day-390-light.png"), fullPage: true });

  // Wischen → nächster Tag (Berufsschule morgen)
  const swipe = async (dx) => {
    const box = await page.$eval("[data-r=cal]", (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 60 }; });
    await page.evaluate(({ x, y, dx }) => {
      const el = document.querySelector("[data-r=cal]");
      const t = (cx) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
      el.dispatchEvent(new TouchEvent("touchstart", { touches: [t(x)], changedTouches: [t(x)], bubbles: true }));
      el.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [t(x + dx)], bubbles: true }));
    }, { ...box, dx });
    await page.waitForTimeout(250);
  };
  const t1 = await page.textContent(".pl-nav-t");
  await swipe(-150);
  const t2 = await page.textContent(".pl-nav-t");
  ok(t2.includes("Morgen") && t1 !== t2, "Wischen links → nächster Tag");
  const tomorrowTxt = await page.textContent("[data-r=cal]");
  ok(tomorrowTxt.includes("Berufsschule"), "Berufsschule am Schultag (ganztägig)");
  ok(tomorrowTxt.includes("Zahnarzt"), "Termin von morgen im Tag");
  await swipe(150);
  ok((await page.textContent(".pl-nav-t")).includes("Heute"), "Wischen rechts → zurück");

  // --- Woche
  await page.click('[data-mode="woche"]');
  await page.waitForSelector("[data-pscroll=week]");
  ok((await page.$$(".pl-wh")).length === 7, "Woche: 7 Spalten");
  ok((await page.$$("[data-pscroll=week] .pl-blk")).length >= 3, "Woche: kompakte Blöcke");
  ok(await page.$("[data-pscroll=week] .pl-now"), "Woche: Jetzt-Linie");
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "pl-week-390-light.png"), fullPage: true });
  const w1 = await page.textContent(".pl-nav-t");
  await swipe(-150);
  ok((await page.textContent(".pl-nav-t")) !== w1, "Woche: Wischen → nächste Woche");
  await page.click('[data-pnav="0"]');
  // Tag in Woche antippen → Tag-Ansicht
  await page.click(`.pl-wh[data-pday="${tK}"]`);
  await page.waitForSelector("[data-pscroll=day]");
  ok(true, "Wochentag antippen → Tag-Ansicht");

  // --- Monat
  await page.click('[data-mode="monat"]');
  await page.waitForSelector(".pl-mgrid");
  const tCell = await page.$(`.pl-mc[data-psel="${tK}"]`);
  ok(await tCell.$(".pl-dots i.pl-t-geburtstag") && await tCell.$(".pl-dots i.pl-t-einsatz"), "Monat: farbige Punkte (Geburtstag, Einsatz) heute");
  ok(await page.$(`.pl-mc[data-psel="${in12}"] .pl-dots i.pl-t-event`), "Monat: Event-Punkt");
  ok((await page.textContent(".pl-selday")).includes("Oma Hilde"), "Monat: Tagesliste mit Symbolen");
  ok(await page.isVisible(".pl-below .pl-bds"), "Monat: Geburtstage-Abschnitt");
  await page.screenshot({ path: path.join(OUT, "pl-month-390-light.png"), fullPage: true });
  // Über den Jahreswechsel zum Jänner nächsten Jahres wischen
  for (let i = 0; i < 14 && !(await page.$(`.pl-mc[data-psel="${nextJan3}"]:not(.out)`)); i++) await swipe(-150);
  const jan = await page.$(`.pl-mc[data-psel="${nextJan3}"]`);
  ok(jan && await jan.$(".pl-dots i.pl-t-geburtstag"), "Geburtstag 3. Jänner im nächsten Jahr (Jahreswechsel)");
  ok(await page.$(`.pl-mc[data-psel="${now.getFullYear() + 1}-01-01"].hol`), "Neujahr als Feiertag markiert");
  await jan.click();
  await page.waitForTimeout(200);
  ok((await page.textContent(".pl-selday")).includes(`wird ${now.getFullYear() + 1 - 2008}`), "Alter im Jänner korrekt");
  // ein Jahr weiter: wieder da, Alter +1
  for (let i = 0; i < 12; i++) await swipe(-150);
  const jan2 = await page.$(`.pl-mc[data-psel="${now.getFullYear() + 2}-01-03"]`);
  await jan2.click();
  await page.waitForTimeout(200);
  ok((await page.textContent(".pl-selday")).includes(`wird ${now.getFullYear() + 2 - 2008}`), "Jährliche Wiederholung (+1 Jahr)");
  await page.click('[data-pnav="0"]');
  await page.waitForTimeout(200);

  // Birthday öffnen und bearbeiten
  await page.click('.pl-bd:has-text("Max Muster")');
  await page.waitForSelector(".sheet [data-r=name]");
  ok(await page.$eval(".sheet [data-r=y]", (i) => i.value) === "2008", "Geburtstag bearbeiten: Werte geladen");
  await page.click(".sheet .close");

  // --- Liste & Einsatzplan weiterhin
  await page.click('[data-mode="einsatz"]');
  await page.waitForSelector(".ez-grid");
  ok(!(await page.isVisible("[data-r=qc]")), "Einsatzplan: Schnellknöpfe ausgeblendet");
  ok((await page.textContent("[data-r=eznext]")).includes("Baustelle Hauptstraße"), "Einsatzplan zeigt Einsatz");
  await page.click('[data-mode="list"]');
  await page.waitForSelector(".ag-strip");
  ok(await page.$(`.ag-day[data-day="${tK}"] .pl-dots i.pl-t-geburtstag`), "Liste: Monatsleiste mit farbigen Punkten");
  await page.click(`.ag-day[data-day="${tK}"]`);
  await page.waitForTimeout(200);
  ok((await page.textContent(".ag-sel")).includes("Oma Hilde"), "Liste: Tag gewählt zeigt Geburtstag");
  await page.click(`.ag-day[data-day="${tK}"]`);
  // Mein Tag zählt Geburtstage nicht als Aufgaben
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForTimeout(400);
  const md = await page.textContent(".md-t-agenda").catch(() => "");
  console.log("  Mein Tag:", md.replace(/\s+/g, " ").trim());
  await page.evaluate(() => { location.hash = "#agenda"; });
  await page.waitForTimeout(300);

  // viele Einträge: Leistung
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
    const base = new Date();
    for (let i = 0; i < 600; i++) {
      const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + (i % 60) - 20);
      const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      d.todos.push({ id: "perf" + i, title: "Test " + i, kind: i % 3 ? "termin" : "todo", date: k, time: `${String(6 + (i % 14)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`, remind: false, done: false, note: "", createdAt: 10 + i });
      if (i < 150) d.todos.push({ id: "pb" + i, title: "Person " + i, kind: "geburtstag", bday: `${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, byear: 1990 + (i % 20), date: null, time: "09:00", remind: true, remindDays: 1, done: false, createdAt: 1000 + i });
    }
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d));
  });
  await page.reload();
  await page.click("#btn-local").catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => { location.hash = "#agenda"; });
  for (const m of ["tag", "woche", "monat", "list"]) {
    const ms = await page.evaluate(async (m) => {
      const t0 = performance.now();
      document.querySelector(`[data-mode="${m}"]`).click();
      return performance.now() - t0;
    }, m);
    ok(ms < 400, `750 Einträge: Ansicht ${m} in ${ms.toFixed(0)} ms`);
  }
  await page.click('[data-mode="tag"]');
  await page.waitForTimeout(300);
  await ctx.close();

  // --- Screenshots dunkel + PC (frische Daten aus dem ersten Lauf ohne Leistungsdaten)
  const shots = async (opts, name) => {
    const { ctx: c2, page: p } = await newPage(opts);
    await p.goto(BASE);
    await p.evaluate(({ wdSchool, in12 }) => {
      const d = new Date(); d.setHours(7, 0, 0, 0);
      const s = d.getTime();
      const tk = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
      const today = tk(new Date());
      localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
        entries: [{ id: "e1", start: s, end: s + 3 * 3600e3, pauseMin: 0, kind: "work", segments: [{ start: s, end: s + 3600e3, activity: "Autofahren" }, { start: s + 3600e3, end: s + 3 * 3600e3, activity: "Arbeiten" }] }],
        places: [], days: {}, running: null, rev: 0,
        todos: [
          { id: "a", title: "Urlaub Kroatien", kind: "termin", cat: "urlaub", countdown: true, date: in12, time: null, remind: false, done: false, createdAt: 1 },
          { id: "b", title: "LAP Theorie", kind: "termin", cat: "pruefung", countdown: true, date: tk(new Date(Date.now() + 30 * 864e5)), time: "08:00", remind: false, done: false, createdAt: 2 },
          { id: "c", title: "Teambesprechung", kind: "termin", date: today, time: "11:00", endTime: "12:00", remind: true, remindMin: 30, done: false, createdAt: 3 },
          { id: "d", title: "Prüfprotokoll schreiben", kind: "todo", date: today, time: "13:00", remind: false, done: true, createdAt: 4 },
          { id: "f", title: "Kabel bestellen", kind: "todo", date: today, time: "13:15", remind: false, done: false, createdAt: 5 },
          { id: "g", title: "Oma Hilde", kind: "geburtstag", bday: today.slice(5), byear: 1950, time: "09:00", remind: true, remindDays: 1, date: null, done: false, createdAt: 6 },
          { id: "h", title: "Max Muster", kind: "geburtstag", bday: "01-03", byear: 2008, time: "09:00", remind: true, remindDays: 1, date: null, done: false, createdAt: 7 },
          { id: "i", title: "Baustelle Hauptstraße", kind: "einsatz", place: "Baustelle Hauptstraße", date: today, dateTo: null, people: ["Anna"], done: false, createdAt: 8 },
          { id: "j", title: "Fußballtraining", kind: "termin", date: today, time: "18:30", endTime: "20:00", remind: false, done: false, createdAt: 9 },
        ],
        settings: { weeklyTarget: 38.5, school: { days: [wdSchool], blocks: [] } },
      }));
      localStorage.removeItem("stempelkarte.planerMode");
    }, { wdSchool, in12 });
    await p.reload();
    await p.click("#btn-local");
    await p.waitForTimeout(400);
    await p.evaluate(() => { location.hash = "#agenda"; });
    await p.waitForSelector(".pl-switch");
    for (const m of ["list", "tag", "woche", "monat"]) {
      await p.click(`[data-mode="${m}"]`);
      await p.waitForTimeout(450);
      await p.evaluate(() => { const t = document.getElementById("toast"); if (t) t.hidden = true; });
      await p.screenshot({ path: path.join(OUT, `pl-${m}-${name}.png`), fullPage: true });
      if (m !== "list") {
        await p.$eval("[data-r=cal]", (e) => e.scrollIntoView({ block: "start" }));
        await p.waitForTimeout(150);
        await p.screenshot({ path: path.join(OUT, `pl-${m}-${name}-view.png`) });
        await p.evaluate(() => window.scrollTo(0, 0));
      }
    }
    await p.click('[data-pnew="geburtstag"]');
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, `pl-bdform-${name}.png`) });
    await p.click(".sheet .close");
    await p.click('[data-mode="list"]');
    await p.click('.ag-item .ag-main');
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, `pl-todoform-${name}.png`) });
    await c2.close();
  };
  await shots({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true }, "390-light");
  await shots({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true }, "390-dark");
  await shots({ viewport: { width: 1440, height: 900 }, colorScheme: "light" }, "1440");

  await browser.close();
  ok(errors.length === 0, "Keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
})().catch((e) => { console.error(e); process.exit(1); });
