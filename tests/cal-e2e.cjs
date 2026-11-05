// Playwright-Test Kalender (Update 9): Termin-Editor, Ziehen/Dauer, Serien (nur diesen / alle folgenden),
// alle Ansichten inkl. Jahr, Suche, ICS-Import/-Export, Google Kalender (googleapis gestubbt), Tastenkürzel,
// lokale Erinnerung, bestehende Funktionen. Lokaler Modus, fremde Domains blockiert.
//   cd <worktree> && python3 -m http.server 8856 &   then   node tests/cal-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:8856/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addD = (k, n) => { const [y, m, d] = k.split("-").map(Number); return key(new Date(y, m - 1, d + n)); };
const wd = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };

const G_CALS = { items: [
  { id: "primary@gmail.com", summary: "Florian", backgroundColor: "#039BE5", primary: true, selected: true },
  { id: "feiertage#holiday", summary: "Feiertage in Österreich", backgroundColor: "#0B8043", selected: false },
] };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const now = new Date();
  const tK = key(now);
  const mon = addD(tK, -((wd(tK) + 6) % 7));
  let gCalls = 0;

  async function newPage(opts, gMode = "ok") {
    const ctx = await browser.newContext({ acceptDownloads: true, locale: "de-AT", timezoneId: "Europe/Vienna", ...opts });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      if (u.hostname === "www.googleapis.com" && u.pathname.startsWith("/calendar/v3/")) {
        gCalls++;
        const auth = route.request().headers().authorization || "";
        if (auth !== "Bearer TEST-TOKEN") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
        if (gMode === "403") return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: 403, message: "Google Calendar API has not been used in project 1 before or it is disabled.", status: "PERMISSION_DENIED", errors: [{ reason: "accessNotConfigured" }] } }) });
        if (u.pathname.endsWith("/users/me/calendarList")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(G_CALS) });
        const m = /\/calendars\/([^/]+)\/events$/.exec(u.pathname);
        if (m) {
          const cal = decodeURIComponent(m[1]);
          const tmin = u.searchParams.get("timeMin");
          const ok2 = u.searchParams.get("singleEvents") === "true" && u.searchParams.get("orderBy") === "startTime" && tmin && u.searchParams.get("timeMax");
          if (!ok2) return route.fulfill({ status: 400, body: "{}" });
          const items = cal === "primary@gmail.com" ? [
            { id: "g1", status: "confirmed", summary: "Google: Kino mit Anna", location: "Cineplexx Linz", htmlLink: "https://calendar.google.com/event?eid=g1",
              start: { dateTime: `${addD(tK, 1)}T19:00:00+01:00` }, end: { dateTime: `${addD(tK, 1)}T21:30:00+01:00` } },
            { id: "g2", status: "confirmed", summary: "Google: Skiurlaub", htmlLink: "https://calendar.google.com/event?eid=g2", colorId: "11",
              start: { date: addD(tK, 2) }, end: { date: addD(tK, 4) } },
          ] : [{ id: "h1", summary: "Hidden", start: { date: tK }, end: { date: addD(tK, 1) } }];
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items }) });
        }
        return route.fulfill({ status: 404, body: "{}" });
      }
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return { ctx, page };
  }
  const seed = (page, todos, settings = {}) => page.evaluate(({ todos, settings }) => {
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], days: {}, running: null, rev: 0, todos, settings: { weeklyTarget: 38.5, ...settings } }));
    localStorage.removeItem("stempelkarte.planerMode");
    localStorage.removeItem("stempelkarte.localReminders");
  }, { todos, settings });
  const start = async (page) => {
    await page.reload();
    await page.click("#btn-local", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#agenda"; });
    await page.waitForSelector(".pl-switch");
  };
  const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).todos);
  const flush = (page) => page.waitForTimeout(700); // lokales Speichern ist entprellt (250 ms)
  const hideToast = (page) => page.evaluate(() => { const t = document.getElementById("toast"); if (t) t.hidden = true; });
  const mode = async (page, m) => { await page.click(`[data-mode="${m}"]`); await page.waitForTimeout(200); };

  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE);
  // in 8 Minuten beginnender Termin mit 15-Min-Erinnerung → lokale Ersatz-Erinnerung (kein Push im lokalen Modus)
  const soon = new Date(Date.now() + 8 * 60000);
  await seed(page, [
    { id: "soon", kind: "termin", title: "Gleich: Teamrunde", date: key(soon), time: `${pad(soon.getHours())}:${pad(soon.getMinutes())}`, reminders: [15], remind: true, remindMin: 15, createdAt: 1 },
    { id: "bd", kind: "geburtstag", title: "Oma Hilde", bday: tK.slice(5), byear: 1950, time: "09:00", remind: true, remindDays: 1, date: null, createdAt: 2 },
    { id: "ez", kind: "einsatz", title: "Baustelle Hauptstraße", place: "Baustelle Hauptstraße", date: tK, dateTo: null, people: ["Anna"], createdAt: 3 },
    { id: "cd", kind: "termin", title: "Urlaub Kroatien", cat: "urlaub", countdown: true, date: addD(tK, 12), time: null, createdAt: 4 },
  ]);
  await start(page);
  await page.waitForFunction(() => /🔔 Termin: Gleich: Teamrunde/.test(document.getElementById("toast").textContent || ""), null, { timeout: 5000 });
  ok(true, "Lokale Ersatz-Erinnerung (App offen, kein Push) als Hinweis");
  const lr = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.localReminders") || "{}"));
  ok(Object.keys(lr).includes("soon"), "Lokale Erinnerung gemerkt (kein zweites Mal)");
  ok((await page.textContent("[data-r=cd]")).includes("Urlaub Kroatien"), "Countdown weiterhin da");

  // --- Termin anlegen über Tippen auf freie Stelle (Tag-Ansicht)
  await mode(page, "tag");
  await page.$eval("[data-pscroll=day]", (e) => { e.scrollTop = 8 * 56; });
  const slot = await page.$('[data-pslot][data-h="10"]');
  const sb = await slot.boundingBox();
  await page.mouse.click(sb.x + sb.width - 30, sb.y + 4);
  await page.waitForSelector(".sheet [data-r=title]");
  ok(await page.$eval(".sheet [data-r=time]", (i) => i.value) === "10:00" && await page.$eval(".sheet [data-r=endtime]", (i) => i.value) === "11:00", "Neuer Termin: Standard Ende +1 Std.");
  await page.fill(".sheet [data-r=title]", "Zahnarzt Kontrolle");
  await page.fill(".sheet [data-r=loc]", "Hauptplatz 1, Linz");
  ok((await page.getAttribute(".sheet [data-r=maps]", "href")).startsWith("https://www.google.com/maps/search/?api=1&query=Hauptplatz"), "Google-Maps-Link zum Ort");
  await page.selectOption(".sheet [data-r=remadd]", "1440");
  await page.click('.sheet [data-cal="arbeit"]');
  await page.click('.sheet [data-color="banane"]');
  await page.fill(".sheet [data-r=note]", "E-Card mitnehmen");
  await page.screenshot({ path: path.join(OUT, "cal-editor-1440.png") });
  await page.click(".sheet [data-r=save]");
  await flush(page);
  let todos = await stored(page);
  const z = todos.find((t) => t.title === "Zahnarzt Kontrolle");
  ok(z && z.kind === "termin" && z.date === tK && z.time === "10:00" && z.endTime === "11:00" && z.location === "Hauptplatz 1, Linz" && z.calendarId === "arbeit" && z.color === "banane", "Termin gespeichert (Ort, Kalender, Farbe)");
  ok(JSON.stringify(z.reminders) === "[30,1440]" && z.remind === true && z.remindMin === 30, "Mehrere Erinnerungen [30, 1440] + remind/remindMin für Push");
  ok(await page.$('.pl-blk[data-ev^="' + z.id + '|"]'), "Block im Tag-Raster");

  // --- Ziehen: +1 Std. (Maus) und Dauer +30 Min.
  const blkSel = `.pl-blk[data-ev^="${z.id}|"]`;
  await page.$eval(blkSel, (e) => e.scrollIntoView({ block: "center" }));
  let bb = await page.$eval(blkSel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(bb.x + bb.w / 2, bb.y + 12);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(bb.x + bb.w / 2, bb.y + 12 + i * 7);
  await page.mouse.up();
  await flush(page);
  todos = await stored(page);
  ok(todos.find((t) => t.id === z.id).time === "11:00" && todos.find((t) => t.id === z.id).endTime === "12:00", "Ziehen verschiebt um 1 Std. (15-Min-Raster)");
  ok(!(await page.$(".sheet")), "Nach dem Ziehen öffnet sich kein Blatt");
  await page.$eval(blkSel, (e) => e.scrollIntoView({ block: "center" }));
  bb = await page.$eval(`${blkSel} .pl-rsz`, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(bb.x + bb.w / 2, bb.y + bb.h / 2);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(bb.x + bb.w / 2, bb.y + bb.h / 2 + i * 7);
  await page.mouse.up();
  await flush(page);
  todos = await stored(page);
  ok(todos.find((t) => t.id === z.id).endTime === "12:30", "Griff unten verlängert um 30 Min.");

  // --- Bearbeiten + Duplizieren + Löschen
  await page.click(`${blkSel} .pl-blk-m`);
  await page.waitForSelector(".sheet [data-r=title]");
  ok(await page.$eval(".sheet [data-r=loc]", (i) => i.value) === "Hauptplatz 1, Linz", "Bearbeiten lädt Ort");
  await page.fill(".sheet [data-r=title]", "Zahnarzt Kontrolle (neu)");
  await page.click(".sheet [data-r=save]");
  await flush(page);
  ok((await stored(page)).some((t) => t.title === "Zahnarzt Kontrolle (neu)"), "Bearbeiten speichert");
  await page.click(`${blkSel} .pl-blk-m`);
  await page.waitForSelector(".sheet [data-r=dup]");
  await page.click(".sheet [data-r=dup]");
  await flush(page);
  ok((await stored(page)).filter((t) => t.title === "Zahnarzt Kontrolle (neu)").length === 2, "Duplizieren legt Kopie an");
  const copyId = (await stored(page)).filter((t) => t.title === "Zahnarzt Kontrolle (neu)").find((t) => t.id !== z.id).id;
  await page.click(`.pl-blk[data-ev^="${copyId}|"] .pl-blk-m`);
  await page.waitForSelector(".sheet [data-r=del]");
  await page.click(".sheet [data-r=del]");
  ok((await page.textContent(".sheet [data-r=del]")).includes("Wirklich"), "Löschen fragt nach");
  await page.click(".sheet [data-r=del]");
  await flush(page);
  ok(!(await stored(page)).some((t) => t.id === copyId), "Kopie gelöscht");

  // --- Serie anlegen: wöchentlich, 6 Termine, ab Montag dieser Woche
  await page.click('[data-pnew="termin"]');
  await page.waitForSelector(".sheet [data-r=repeat]");
  await page.fill(".sheet [data-r=title]", "Fußballtraining");
  await page.fill(".sheet [data-r=date]", mon);
  await page.fill(".sheet [data-r=time]", "18:00");
  await page.dispatchEvent(".sheet [data-r=time]", "change");
  const opts = await page.$$eval(".sheet [data-r=repeat] option", (os) => os.map((o) => o.textContent));
  ok(opts.includes("Wöchentlich am Montag") && opts.includes("Alle 2 Wochen am Montag") && opts.some((o) => /^Monatlich am \d+\.$/.test(o)) && opts.some((o) => /^Monatlich am (\d\.|letzten) Montag$/.test(o)) && opts.includes("Benutzerdefiniert …") && opts.includes("Jährlich am " + Number(mon.slice(8)) + ". " + ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"][Number(mon.slice(5, 7)) - 1]), "Wiederholen-Optionen passend zum Tag: " + opts.join(" | "));
  await page.selectOption(".sheet [data-r=repeat]", "weekly");
  await page.selectOption(".sheet [data-r=rend]", "count");
  await page.fill(".sheet [data-r=count]", "6");
  ok((await page.textContent(".sheet [data-r=rephint]")).includes("Wöchentlich am Montag, 6×"), "Wiederholung als Text");
  await page.click(".sheet [data-r=save]");
  await flush(page);
  todos = await stored(page);
  const ser = todos.find((t) => t.title === "Fußballtraining");
  ok(ser && ser.rrule === "FREQ=WEEKLY;BYDAY=MO;COUNT=6" && ser.date === mon, "Serie gespeichert (RRULE)");

  // --- Woche: Serie sichtbar; „nur diesen“ per Ziehen auf Dienstag
  await mode(page, "woche");
  await page.$eval("[data-pscroll=week]", (e) => { e.scrollTop = 15 * 44; });
  const sb1 = `.pl-blk[data-ev="${ser.id}|${mon}"]`;
  ok(await page.$(sb1), "Serie in der Woche");
  await page.$eval(sb1, (e) => e.scrollIntoView({ block: "center" }));
  bb = await page.$eval(sb1, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  const colW = await page.$eval(`[data-pcol="${mon}"]`, (e) => e.getBoundingClientRect().width);
  await page.mouse.move(bb.x + bb.w / 2, bb.y + 8);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(bb.x + bb.w / 2 + (colW * i) / 10, bb.y + 8);
  await page.mouse.up();
  await page.waitForSelector(".sheet [data-scope=one]");
  ok(await page.$(".sheet [data-scope=following]") && await page.$(".sheet [data-scope=all]"), "Serie: Abfrage Nur diesen / Diesen und alle folgenden / Alle");
  await page.click(".sheet [data-scope=one]");
  await flush(page);
  todos = await stored(page);
  let s1 = todos.find((t) => t.id === ser.id);
  ok(s1.overrides && s1.overrides[mon] && s1.overrides[mon].date === addD(mon, 1) && s1.overrides[mon].time === "18:00", "Nur dieser Termin auf Dienstag verschoben (override) " + JSON.stringify(s1.overrides) + " " + mon);
  ok(await page.$(`[data-pcol="${addD(mon, 1)}"] .pl-blk[data-ev="${ser.id}|${mon}"]`), "Verschobener Termin am Dienstag");

  // --- „Diesen und alle folgenden“: ab 3. Termin neue Uhrzeit
  const third = addD(mon, 14);
  await mode(page, "tag");
  await page.fill("[data-pjump]", third);
  await page.dispatchEvent("[data-pjump]", "change");
  await page.waitForTimeout(200);
  ok((await page.textContent(".pl-nav-t")).includes(String(Number(third.slice(8))) + "."), "Datum wählen springt zum Tag");
  await page.$eval("[data-pscroll=day]", (e) => { e.scrollTop = 15 * 56; });
  await page.click(`.pl-blk[data-ev="${ser.id}|${third}"] .pl-blk-m`);
  await page.waitForSelector(".sheet [data-r=title]");
  ok((await page.textContent(".sheet .cal-recinfo")).includes("Wöchentlich am Montag"), "Editor zeigt Serie");
  await page.fill(".sheet [data-r=time]", "19:00");
  await page.dispatchEvent(".sheet [data-r=time]", "change");
  ok(await page.$eval(".sheet [data-r=endtime]", (i) => i.value) === "20:00", "Ende rückt mit (Dauer bleibt)");
  await page.click(".sheet [data-r=save]");
  await page.waitForSelector(".sheet [data-scope=following]");
  await page.click(".sheet [data-scope=following]");
  await flush(page);
  todos = await stored(page);
  s1 = todos.find((t) => t.id === ser.id);
  const tail = todos.find((t) => t.title === "Fußballtraining" && t.id !== ser.id);
  ok(s1.rrule === "FREQ=WEEKLY;BYDAY=MO;COUNT=2" && tail && tail.rrule === "FREQ=WEEKLY;BYDAY=MO;COUNT=4" && tail.date === third && tail.time === "19:00", "Diesen und alle folgenden: Serie geteilt (2 + 4) " + JSON.stringify([s1.rrule, tail && tail.rrule, tail && tail.date, tail && tail.time, third]));

  // --- Löschen nur diesen (4. Termin)
  const fourth = addD(mon, 21);
  await page.fill("[data-pjump]", fourth);
  await page.dispatchEvent("[data-pjump]", "change");
  await page.waitForTimeout(200);
  await page.$eval("[data-pscroll=day]", (e) => { e.scrollTop = 15 * 56; });
  await page.click(`.pl-blk[data-ev="${tail.id}|${fourth}"] .pl-blk-m`);
  await page.waitForSelector(".sheet [data-r=del]");
  await page.click(".sheet [data-r=del]");
  await page.click(".sheet [data-r=del]");
  await page.waitForSelector(".sheet [data-scope=one]");
  await page.click(".sheet [data-scope=one]");
  await flush(page);
  ok(JSON.stringify((await stored(page)).find((t) => t.id === tail.id).exdates) === JSON.stringify([fourth]), "Nur diesen löschen → EXDATE");
  ok(!(await page.$(`.pl-blk[data-ev="${tail.id}|${fourth}"]`)), "Gelöschter Termin weg");

  // --- Mehrtägig ganztägig → Balken in Woche/Monat
  await page.click('[data-pnew="termin"]');
  await page.waitForSelector(".sheet [data-r=allday]");
  await page.fill(".sheet [data-r=title]", "Berufsschule Block");
  await page.check(".sheet [data-r=allday]");
  await page.fill(".sheet [data-r=date]", mon);
  await page.dispatchEvent(".sheet [data-r=date]", "change");
  await page.fill(".sheet [data-r=enddate]", addD(mon, 2));
  await page.dispatchEvent(".sheet [data-r=enddate]", "change");
  await page.click('.sheet [data-cal="berufsschule"]');
  await page.click(".sheet [data-r=save]");
  await flush(page);
  const blk = (await stored(page)).find((t) => t.title === "Berufsschule Block");
  ok(blk.allDay && blk.endDate === addD(mon, 2) && blk.time === null, "Mehrtägig ganztägig gespeichert");
  await mode(page, "woche");
  await page.click('[data-pnav="0"]').catch(() => {});
  await page.waitForTimeout(150);
  const bar = await page.$eval(`.pl-adb[data-popen^="ev:${blk.id}|"]`, (e) => e.style.gridColumn);
  ok(/^1 \/ 4$/.test(bar.replace(/\s+/g, " ")), "Woche: Balken über 3 Tage (" + bar + ")");
  await page.screenshot({ path: path.join(OUT, "cal-week-1440.png") });

  // --- Monat: Balken + „+n weitere“
  await page.evaluate(({ k }) => {
    const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
    for (let i = 0; i < 5; i++) d.todos.push({ id: "many" + i, kind: "termin", title: "Termin " + (i + 1), date: k, time: `${pad(8 + i)}:00`, createdAt: 100 + i });
    function pad(n) { return String(n).padStart(2, "0"); }
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d));
  }, { k: addD(tK, 3) });
  await start(page);
  await mode(page, "monat");
  ok(await page.$(`.pl-mbar[data-popen^="ev:${blk.id}|"]`), "Monat: mehrtägiger Balken");
  const more = await page.$(`.pl-mmore[data-psel="${addD(tK, 3)}"]`);
  ok(more && /^\+\d+ weitere$/.test(await more.textContent()), "Monat: „+n weitere“ (" + (more && await more.textContent()) + ")");
  await more.click();
  await page.waitForTimeout(150);
  ok((await page.textContent(".pl-selday")).includes("Termin 5"), "„weitere“ zeigt alle Termine des Tages");
  ok((await page.textContent(".pl-nav-t")).includes("KW"), "Monat zeigt KW");
  await page.screenshot({ path: path.join(OUT, "cal-month-1440.png") });

  // --- Jahr: Heat-Punkte, Tag antippen → Tag
  await mode(page, "jahr");
  ok((await page.$$(".pl-ym")).length === 12, "Jahr: 12 Monate");
  ok(await page.$(`.pl-yd.h4[data-pday="${addD(tK, 3)}"], .pl-yd.h3[data-pday="${addD(tK, 3)}"]`), "Jahr: viele Termine = starke Farbe");
  await page.screenshot({ path: path.join(OUT, "cal-year-1440.png") });
  await page.click(`.pl-yd[data-pday="${addD(tK, 3)}"]`);
  await page.waitForSelector("[data-pscroll=day]");
  ok(await page.evaluate(() => localStorage.getItem("stempelkarte.planerMode")) === "tag", "Jahr: Tag antippen → Tag-Ansicht");

  // --- 3 Tage + Termine-Liste + Tastenkürzel
  await page.keyboard.press("x");
  await page.waitForSelector("[data-pscroll=three]");
  ok((await page.$$(".pl-wh")).length === 3, "3 Tage (Taste X)");
  await page.keyboard.press("w");
  await page.waitForSelector("[data-pscroll=week]");
  ok(true, "Taste W → Woche");
  const wt = await page.textContent(".pl-nav-t");
  await page.keyboard.press("ArrowRight");
  ok((await page.textContent(".pl-nav-t")) !== wt, "Pfeil → nächste Woche");
  await page.keyboard.press("t");
  ok((await page.textContent(".pl-nav-t")) === wt, "Taste T → heute");
  await page.keyboard.press("m");
  await page.waitForSelector(".pl-mgrid2");
  await page.keyboard.press("j");
  await page.waitForSelector(".pl-year");
  await page.keyboard.press("d");
  await page.waitForSelector("[data-pscroll=day]");
  ok(true, "Tasten M/J/D wechseln Ansicht");
  await page.keyboard.press("n");
  await page.waitForSelector(".sheet [data-r=repeat]");
  ok(true, "Taste N → neuer Termin");
  await page.click(".sheet .close");
  await mode(page, "termine");
  const ag = await page.textContent(".pl-ag");
  ok(ag.includes("Fußballtraining") && ag.includes("Oma Hilde") && ag.includes("Termin 5") && ag.includes("KW"), "Termine-Liste mit Serien, Geburtstag, KW");
  await page.screenshot({ path: path.join(OUT, "cal-termine-1440.png") });

  // --- Suche (inkl. Serien)
  await page.keyboard.press("/");
  await page.waitForSelector(".sheet [data-r=q]");
  await page.fill(".sheet [data-r=q]", "fussball");
  await page.waitForTimeout(250);
  const res = await page.$$(".sheet .cal-resb");
  ok(res.length === 5, "Suche „fussball“ findet 5 Serientermine (ß = ss): " + res.length);
  await page.fill(".sheet [data-r=q]", "e-card");
  await page.waitForTimeout(250);
  ok((await page.textContent(".sheet .cal-res")).includes("Zahnarzt"), "Suche in Notizen");
  await page.click(".sheet .cal-resb");
  await page.waitForSelector(".sheet [data-r=title]");
  ok((await page.$eval(".sheet [data-r=title]", (i) => i.value)).startsWith("Zahnarzt"), "Treffer öffnet Termin");
  await page.click(".sheet .close");

  // --- ICS-Import (Vorschau, Kalender wählen, kein Duplikat bei erneutem Import)
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN",
    "BEGIN:VEVENT", "UID:imp-1@test", `DTSTART;TZID=Europe/Vienna:${addD(tK, 5).replace(/-/g, "")}T090000`, `DTEND;TZID=Europe/Vienna:${addD(tK, 5).replace(/-/g, "")}T100000`, "SUMMARY:Import: Lehrlingsstammtisch", "LOCATION:Gasthaus Post", "BEGIN:VALARM", "TRIGGER:-PT1H", "END:VALARM", "END:VEVENT",
    "BEGIN:VEVENT", "UID:imp-2@test", `DTSTART;VALUE=DATE:${addD(tK, 6).replace(/-/g, "")}`, "RRULE:FREQ=MONTHLY;COUNT=3", "SUMMARY:Import: Monatlich", "END:VEVENT",
    "END:VCALENDAR", ""].join("\r\n");
  const icsPath = path.join(OUT, "import-test.ics");
  fs.writeFileSync(icsPath, ics);
  const importOnce = async () => {
    await page.click('[data-pact="cals"]');
    await page.waitForSelector(".sheet [data-r=icsfile]", { state: "attached" });
    await page.setInputFiles(".sheet [data-r=icsfile]", icsPath);
    await page.waitForSelector(".sheet .cal-imp");
  };
  await importOnce();
  ok((await page.textContent(".sheet .cal-imp")).includes("Lehrlingsstammtisch"), "Import-Vorschau");
  await page.screenshot({ path: path.join(OUT, "cal-import-1440.png") });
  await page.click('.sheet:last-child [data-cal="berufsschule"]');
  await page.click(".sheet:last-child [data-r=go]");
  await flush(page);
  for (const s of await page.$$(".sheet .close")) await s.click().catch(() => {});
  todos = await stored(page);
  const imp = todos.find((t) => t.icsUid === "imp-1@test");
  ok(imp && imp.time === "09:00" && imp.location === "Gasthaus Post" && imp.calendarId === "berufsschule" && JSON.stringify(imp.reminders) === "[60]", "ICS importiert (Zeit, Ort, VALARM, Kalender)");
  ok(todos.find((t) => t.icsUid === "imp-2@test").rrule === "FREQ=MONTHLY;COUNT=3", "ICS-Serie importiert");
  await importOnce();
  ok((await page.textContent(".sheet:last-child")).includes("schon vorhanden"), "Erneuter Import erkennt vorhandene Termine (UID)");
  await page.click(".sheet:last-child [data-r=go]");
  await flush(page);
  for (const s of await page.$$(".sheet .close")) await s.click().catch(() => {});
  ok((await stored(page)).filter((t) => t.icsUid === "imp-1@test").length === 1, "Keine Duplikate nach erneutem Import");

  // --- ICS-Export (sichtbare Kalender) + einzelner Termin
  await page.click('[data-pact="cals"]');
  await page.waitForSelector(".sheet [data-r=export]");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".sheet [data-r=export]")]);
  const expPath = path.join(OUT, "export-test.ics");
  await dl.saveAs(expPath);
  const exp = fs.readFileSync(expPath, "utf8");
  ok(dl.suggestedFilename().endsWith(".ics") && exp.startsWith("BEGIN:VCALENDAR") && exp.includes("SUMMARY:Fußballtraining") && exp.includes("RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2") && exp.includes("EXDATE;TZID=Europe/Vienna:") && exp.includes("UID:imp-1@test"), "Export: .ics mit Serien, EXDATE, UID");
  // Kalender ausblenden → nicht im Export, nicht in der Ansicht
  await page.uncheck('.sheet [data-vis="berufsschule"]');
  await flush(page);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click(".sheet [data-r=export]")]);
  await dl2.saveAs(expPath);
  ok(!fs.readFileSync(expPath, "utf8").includes("Lehrlingsstammtisch"), "Ausgeblendeter Kalender nicht im Export");
  await page.click(".sheet .close");
  await mode(page, "termine");
  ok(!(await page.textContent(".pl-ag")).includes("Lehrlingsstammtisch"), "Ausgeblendeter Kalender unsichtbar");
  await page.click('[data-pact="cals"]');
  await page.check('.sheet [data-vis="berufsschule"]');
  await page.click('.sheet [data-colfor="privat"]');
  await page.click('.sheet [data-setcol="salbei"]');
  await page.fill(".sheet [data-r=newname]", "Fußballverein");
  await page.click(".sheet .cal-add button");
  await flush(page);
  const cs = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).settings.calendars);
  ok(cs.find((c) => c.id === "privat").color === "salbei" && cs.some((c) => c.name === "Fußballverein"), "Kalenderfarbe ändern, eigenen Kalender anlegen (settings.calendars) " + JSON.stringify(cs));
  await page.click(".sheet .close");
  await page.evaluate(() => { location.hash = "#agenda"; });
  await mode(page, "tag");
  await page.$eval("[data-pscroll=day]", (e) => { e.scrollTop = 8 * 56; });
  const zid = z.id;
  await page.click(`.pl-blk[data-ev^="${zid}|"] .pl-blk-m`).catch(async () => { await page.click('[data-pnav="0"]'); await page.click(`.pl-blk[data-ev^="${zid}|"] .pl-blk-m`); });
  await page.waitForSelector(".sheet [data-r=ics]");
  const [dl3] = await Promise.all([page.waitForEvent("download"), page.click(".sheet [data-r=ics]")]);
  await dl3.saveAs(expPath);
  const one = fs.readFileSync(expPath, "utf8");
  ok((one.match(/BEGIN:VEVENT/g) || []).length === 1 && one.includes("LOCATION:Hauptplatz 1\\, Linz") && one.includes("TRIGGER:-PT1440M"), "Einzelner Termin als .ics");
  await page.click(".sheet .close");

  // --- Google Kalender (gestubbt; Test-Token nur auf localhost)
  await page.evaluate(() => { window.__gcalTestToken = "TEST-TOKEN"; });
  await page.click('[data-pact="cals"]');
  await page.click(".sheet [data-r=gconnect]");
  await page.waitForSelector('.sheet [data-vis="g:primary@gmail.com"]');
  ok(!(await page.$eval('.sheet [data-vis="g:feiertage#holiday"]', (i) => i.checked)), "Google-Kalender: Auswahl wie in Google (nicht gewählte aus)");
  await page.click(".sheet .close");
  await mode(page, "woche");
  await page.waitForFunction(() => document.querySelector('[data-r=cal]').textContent.includes("Skiurlaub"), null, { timeout: 5000 });
  const wtxt = await page.textContent("[data-r=cal]");
  ok(wtxt.includes("Google: Skiurlaub") && !wtxt.includes("Hidden"), "Google-Termine (sichtbare Kalender) in der Woche");
  await page.$eval("[data-pscroll=week]", (e) => { e.scrollTop = 17 * 44; });
  const gb = await page.$('.pl-blk.is-ext:has-text("Kino")');
  ok(gb && !(await gb.getAttribute("data-ev")), "Google-Termin: eigener Stil, nicht ziehbar (nur lesen)");
  ok((await gb.getAttribute("style")).includes("#039BE5"), "Google-Farbe übernommen");
  await page.screenshot({ path: path.join(OUT, "cal-google-week-1440.png") });
  await gb.$eval(".pl-blk-m", (e) => e.click());
  await page.waitForSelector(".sheet [data-r=glink]");
  ok((await page.getAttribute(".sheet [data-r=glink]", "href")) === "https://calendar.google.com/event?eid=g1" && (await page.textContent(".sheet")).includes("Cineplexx"), "„In Google Kalender öffnen“ (htmlLink), nur lesen");
  ok(!(await page.$(".sheet [data-r=save]")), "Google-Termin ohne Speichern/Löschen");
  await page.click(".sheet .close");
  const calls = gCalls;
  await page.click('[data-pnav="1"]'); await page.click('[data-pnav="-1"]');
  await page.waitForTimeout(300);
  ok(gCalls === calls, "Google-Termine zwischengespeichert (kein erneuter Abruf)");
  ok(await page.evaluate(() => !!sessionStorage.getItem("stempelkarte.gcal.v1") && !JSON.stringify(localStorage).includes("Skiurlaub")), "Cache nur in sessionStorage, nicht dauerhaft");
  await page.keyboard.press("/");
  await page.fill(".sheet [data-r=q]", "kino");
  await page.waitForTimeout(250);
  ok((await page.textContent(".sheet .cal-res")).includes("Google: Kino mit Anna"), "Suche findet Google-Termine");
  await page.click(".sheet .close");
  await ctx.close();

  // --- Google 403 → Anleitung
  {
    const { ctx: c3, page: p } = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true }, "403");
    await p.goto(BASE);
    await seed(p, []);
    await start(p);
    await p.evaluate(() => { window.__gcalTestToken = "TEST-TOKEN"; });
    await mode(p, "monat");
    await p.click('[data-pact="cals"]');
    await p.click(".sheet [data-r=gconnect]");
    await p.waitForSelector(".sheet .cal-gmsg");
    const help = await p.textContent(".sheet .cal-ghelp");
    ok(await p.$eval(".sheet .cal-ghelp", (d) => d.open) && help.includes("Google Calendar API") && help.includes("stempelkarte-40682") && help.includes("calendar.readonly"), "403: Anleitung (API aktivieren, Scope) wird geöffnet");
    await p.screenshot({ path: path.join(OUT, "cal-google-403-390.png") });
    await c3.close();
  }

  // --- Screenshots Handy hell/dunkel, PC (frische Daten)
  const shots = async (opts, name) => {
    const { ctx: c2, page: p } = await newPage(opts);
    await p.goto(BASE);
    await seed(p, [
      { id: "s1", kind: "termin", title: "Fußballtraining", date: addD(mon, -14), time: "18:30", endTime: "20:00", rrule: "FREQ=WEEKLY;BYDAY=MO,WE", location: "Sportplatz", reminders: [15], remind: true, remindMin: 15, createdAt: 1 },
      { id: "s2", kind: "termin", title: "Zahnarzt", date: tK, time: "10:00", endTime: "11:00", calendarId: "privat", createdAt: 2 },
      { id: "s3", kind: "termin", title: "Teambesprechung", date: tK, time: "10:30", endTime: "12:00", calendarId: "arbeit", createdAt: 3 },
      { id: "s4", kind: "termin", title: "Blockschule", date: addD(tK, 1), endDate: addD(tK, 3), allDay: true, calendarId: "berufsschule", createdAt: 4 },
      { id: "s5", kind: "termin", title: "Urlaub Kroatien", cat: "urlaub", countdown: true, date: addD(tK, 12), endDate: addD(tK, 18), allDay: true, color: "banane", createdAt: 5 },
      { id: "s6", kind: "geburtstag", title: "Oma Hilde", bday: tK.slice(5), byear: 1950, time: "09:00", remind: true, remindDays: 1, date: null, createdAt: 6 },
      { id: "s7", kind: "einsatz", title: "Baustelle Hauptstraße", place: "Baustelle Hauptstraße", date: tK, dateTo: null, people: ["Anna"], createdAt: 7 },
      { id: "s8", kind: "todo", title: "Kabel bestellen", date: tK, time: "13:15", createdAt: 8 },
      { id: "s9", kind: "termin", title: "LAP Theorie", date: addD(tK, 3), time: "08:00", endTime: "12:00", calendarId: "berufsschule", reminders: [60, 1440], createdAt: 9 },
    ], { school: { days: [], blocks: [] } });
    await start(p);
    for (const m of ["list", "tag", "3tage", "woche", "monat", "jahr", "termine", "einsatz"]) {
      await mode(p, m);
      await p.waitForTimeout(250);
      await hideToast(p);
      if (m !== "list" && m !== "einsatz") {
        await p.$eval("[data-r=cal]", (e) => e.scrollIntoView({ block: "start" }));
        await p.waitForTimeout(120);
        await p.screenshot({ path: path.join(OUT, `cal-${m}-${name}.png`) });
        await p.evaluate(() => window.scrollTo(0, 0));
      } else await p.screenshot({ path: path.join(OUT, `cal-${m}-${name}.png`), fullPage: true });
    }
    await mode(p, "tag");
    await p.click('[data-pnew="termin"]');
    await p.waitForTimeout(300);
    await p.selectOption(".sheet [data-r=repeat]", "custom");
    await p.screenshot({ path: path.join(OUT, `cal-editor-${name}.png`) });
    await p.click(".sheet .close");
    await p.click('[data-pact="cals"]');
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(OUT, `cal-sheet-${name}.png`) });
    await c2.close();
  };
  await shots({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true }, "390-light");
  await shots({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true }, "390-dark");
  await shots({ viewport: { width: 1440, height: 900 }, colorScheme: "light" }, "1440");

  // --- Leistung: 1200 Termine (davon 400 Serien)
  {
    const { ctx: c4, page: p } = await newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(BASE);
    const many = [];
    for (let i = 0; i < 1200; i++) {
      many.push({ id: "p" + i, kind: "termin", title: "Termin " + i, date: addD(tK, (i % 400) - 300), time: `${pad(6 + (i % 14))}:${i % 2 ? "30" : "00"}`, endTime: `${pad(7 + (i % 14))}:00`,
        rrule: i % 3 === 0 ? ["FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,WE,FR", "FREQ=MONTHLY;BYDAY=2TU"][i % 9 / 3 | 0] : null, location: i % 5 ? "" : "Linz", createdAt: i });
    }
    await seed(p, many);
    await start(p);
    for (const m of ["tag", "3tage", "woche", "monat", "jahr", "termine", "list"]) {
      const ms = await p.evaluate(async (m) => { const t0 = performance.now(); document.querySelector(`[data-mode="${m}"]`).click(); return performance.now() - t0; }, m);
      ok(ms < (m === "jahr" ? 1200 : 500), `1200 Termine: ${m} in ${ms.toFixed(0)} ms`);
    }
    const sms = await p.evaluate(async () => {
      const K = await import("./js/cal-core.js");
      const todos = JSON.parse(localStorage.getItem("stempelkarte.local.v1")).todos;
      const t0 = performance.now();
      const r = K.searchEvents(todos, "linz", new Date().toISOString().slice(0, 10));
      return [performance.now() - t0, r.length];
    });
    ok(sms[0] < 600 && sms[1] > 0, `Suche über 1200 Termine ±1 Jahr: ${sms[0].toFixed(0)} ms, ${sms[1]} Treffer`);
    await c4.close();
  }

  await browser.close();
  ok(errors.length === 0, "Keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
})().catch((e) => { console.error(e); process.exit(1); });
