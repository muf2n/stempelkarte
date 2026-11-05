// Playwright-Test Kalender-Links (iCal, dauerhaft) + Google-OAuth-Token über Neuladen + 401 → kleiner Knopf.
// Lokaler Modus, Worker /ics und googleapis gestubbt (Test-Haken __skAiTest / __gcalTestToken nur auf localhost).
//   cd <worktree> && python3 -m http.server 8867 &   then   node tests/ical-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8867/";
const OUT = process.argv[2] || require("os").tmpdir();
const WORKER = "stempelkarte-mcp.lippa-florian.workers.dev";

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addD = (k, n) => { const [y, m, d] = k.split("-").map(Number); return key(new Date(y, m - 1, d + n)); };
const wdOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
const ics = (k) => k.replace(/-/g, "");

const CAL = "lippa.florian@gmail.com";
const FEED_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CAL)}/private-0123456789abcdef0123456789abcdef/basic.ics`;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const tK = key(new Date());
  // Feed relativ zu heute: wöchentliche Serie (heutiger Wochentag, seit 3 Wochen, nächste Woche EXDATE),
  // mehrtägiger Ganztagstermin, Termin heute 15:00 UTC, VTIMEZONE + gefaltete Zeile + escaped Komma.
  const BY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][wdOf(tK)];
  const FEED_ICS = [
    "BEGIN:VCALENDAR", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "VERSION:2.0", "X-WR-TIMEZONE:Europe/Vienna",
    "BEGIN:VTIMEZONE", "TZID:Europe/Vienna", "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE",
    "BEGIN:VEVENT", `DTSTART;TZID=Europe/Vienna:${ics(addD(tK, -21))}T183000`, `DTEND;TZID=Europe/Vienna:${ics(addD(tK, -21))}T200000`,
    `RRULE:FREQ=WEEKLY;BYDAY=${BY}`, `EXDATE;TZID=Europe/Vienna:${ics(addD(tK, 7))}T183000`, "UID:train01abc@google.com", "SUMMARY:iCal Fußballtraining",
    "LOCATION:Sporthalle\\, Eingang Süd", "END:VEVENT",
    "BEGIN:VEVENT", `DTSTART;VALUE=DATE:${ics(addD(tK, 1))}`, `DTEND;VALUE=DATE:${ics(addD(tK, 4))}`, "UID:ski01abc@google.com", "SUMMARY:iCal Skikurs", "END:VEVENT",
    "BEGIN:VEVENT", `DTSTART:${ics(tK)}T150000Z`, `DTEND:${ics(tK)}T160000Z`, "UID:zahn01abc@google.com", "SUMMARY:iCal Zahnarzt Dr. Huber\\, Kontrolle",
    "DESCRIPTION:Bitte e-card mitnehmen – falls verhindert mindestens 24 Stunden vorher a", " bsagen.", "END:VEVENT",
    "END:VCALENDAR", "",
  ].join("\r\n");

  const S = { icsCalls: [], icsMode: "ok", gCalls: [], gMode: "ok" };
  const G_CALS = { items: [
    { id: CAL, summary: "Florian (OAuth)", backgroundColor: "#039BE5", primary: true, selected: true },
    { id: "verein@group.calendar.google.com", summary: "Verein", backgroundColor: "#8E24AA", selected: true },
  ] };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-expose-headers": "x-ics-fetched-at, x-ics-cache" };

  async function newPage(opts = {}) {
    const ctx = await browser.newContext({ locale: "de-AT", timezoneId: "Europe/Vienna", viewport: { width: 390, height: 844 }, hasTouch: true, ...opts });
    await ctx.addInitScript(() => { window.__skAiTest = { token: "ID-TOKEN-TEST" }; });
    await ctx.route("**/*", (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      if (u.hostname === WORKER && u.pathname === "/ics") {
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        S.icsCalls.push({ url: u.toString(), auth: req.headers().authorization || "" });
        if (S.icsMode === "down") return route.fulfill({ status: 503, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ error: "nicht erreichbar" }) });
        if ((req.headers().authorization || "") !== "Bearer ID-TOKEN-TEST") return route.fulfill({ status: 401, headers: cors, body: "{}" });
        return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/calendar; charset=utf-8", "x-ics-fetched-at": String(Date.now() - 3 * 60000) }, body: FEED_ICS });
      }
      if (u.hostname === "www.googleapis.com" && u.pathname.startsWith("/calendar/v3/")) {
        const auth = req.headers().authorization || "";
        S.gCalls.push(auth);
        if (S.gMode === "401" || auth !== "Bearer TEST-TOKEN") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: 401 } }) });
        if (u.pathname.endsWith("/users/me/calendarList")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(G_CALS) });
        const m = /\/calendars\/([^/]+)\/events$/.exec(u.pathname);
        if (m) {
          const cal = decodeURIComponent(m[1]);
          const items = cal === CAL
            ? [{ id: "dup1", status: "confirmed", summary: "OAuth-Doppel Zahnarzt", start: { dateTime: `${tK}T16:00:00+01:00` }, end: { dateTime: `${tK}T17:00:00+01:00` } }]
            : [{ id: "v1", status: "confirmed", summary: "Verein Sitzung", htmlLink: "https://calendar.google.com/event?eid=v1", start: { dateTime: `${addD(tK, 1)}T19:00:00+01:00` }, end: { dateTime: `${addD(tK, 1)}T20:00:00+01:00` } }];
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
  const seed = (page) => page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], days: {}, running: null, rev: 0, todos: [], settings: { weeklyTarget: 38.5, school: { days: [], blocks: [] } } }));
  });
  const start = async (page) => {
    await page.click("#btn-local", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#agenda"; });
    await page.waitForSelector(".pl-switch");
  };
  const mode = async (page, m) => { await page.click(`[data-mode="${m}"]`); await page.waitForTimeout(250); };
  const calText = (page) => page.textContent("[data-r=cal]");
  const hideToast = (page) => page.evaluate(() => { const t = document.getElementById("toast"); if (t) t.hidden = true; });

  for (const scheme of ["light", "dark"]) {
    S.icsCalls = []; S.gCalls = []; S.icsMode = "ok"; S.gMode = "ok";
    const { ctx, page } = await newPage({ colorScheme: scheme });
    await page.goto(BASE);
    await seed(page);
    await page.reload();
    await start(page);
    await mode(page, "monat");

    // --- Feed anlegen
    await page.click('[data-pact="cals"]');
    await page.waitForSelector(".sheet [data-r=feedform]");
    const help = await page.textContent(".sheet .cal-ical");
    ok(help.includes("Privatadresse im iCal-Format") && help.includes("Kalender integrieren") && help.includes("am PC") && help.includes("Geheim halten"), "Anleitung: Schritte, PC-Hinweis, geheim halten");
    await page.$eval(".sheet .cal-ical", (e) => e.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(500);
    await hideToast(page);
    await page.screenshot({ path: path.join(OUT, `ical-help-390-${scheme}.png`) });
    await page.fill(".sheet [data-r=furl]", "https://calendar.google.com/calendar/u/0/r");
    await page.click(".sheet [data-r=fadd]");
    await page.waitForSelector(".sheet .cal-gmsg");
    ok((await page.textContent(".sheet .cal-gmsg")).includes("Privatadresse"), "Falsche Google-Adresse → verständlicher Hinweis");
    await page.fill(".sheet [data-r=furl]", "http://example.com/a.ics");
    await page.click(".sheet [data-r=fadd]");
    ok((await page.textContent(".sheet .cal-gmsg")).includes("https"), "Nur https erlaubt");
    await page.fill(".sheet [data-r=furl]", FEED_URL);
    await page.fill(".sheet [data-r=fname]", "Mein Google");
    await page.click('.sheet [data-fcol="basilikum"]');
    await page.click(".sheet [data-r=fadd]");
    await page.waitForFunction(() => /Verbunden über iCal-Link · aktualisiert vor 3 Min\./.test((document.querySelector(".sheet .cal-fstat") || {}).textContent || ""), null, { timeout: 5000 });
    ok(true, "Statuszeile „Verbunden über iCal-Link · aktualisiert vor 3 Min.“");
    const sheetTxt = await page.textContent(".sheet");
    ok(sheetTxt.includes("calendar.google.com/…/basic.ics") && !sheetTxt.includes("private-0123") && !(await page.inputValue(".sheet [data-r=furl]")), "Adresse maskiert, Feld geleert");
    const call = S.icsCalls[S.icsCalls.length - 1];
    ok(call && /\/ics\?id=f[a-z0-9]+/.test(call.url) && !call.url.includes("calendar.google.com") && call.auth === "Bearer ID-TOKEN-TEST", "Abruf über Worker /ics?id=… mit ID-Token, ohne Adresse in der Anfrage");
    const st = await page.evaluate(() => ({ local: localStorage.getItem("stempelkarte.local.v1"), feeds: localStorage.getItem("stempelkarte.ical.local") }));
    ok(!st.local.includes("private-0123") && st.feeds.includes("private-0123"), "Adresse nicht in den Einstellungen/Snapshot (eigener Speicher)");
    await page.$eval(".sheet .cal-feeds", (e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(OUT, `ical-sheet-feeds-390-${scheme}.png`) });
    await page.click(".sheet .close");

    // --- Monat / Woche
    await page.waitForFunction(() => document.querySelector("[data-r=cal]").textContent.includes("iCal Skikurs"), null, { timeout: 5000 });
    let txt = await calText(page);
    ok(txt.includes("iCal Fußballtraining") && txt.includes("iCal Skikurs"), "Monat: Feed-Termine sichtbar");
    await hideToast(page);
    await page.screenshot({ path: path.join(OUT, `ical-month-390-${scheme}.png`) });
    await mode(page, "woche");
    txt = await calText(page);
    ok(txt.includes("iCal Zahnarzt Dr. Huber, Kontrolle") && txt.includes("iCal Fußballtraining"), "Woche: Feed-Termine (escaped Komma) sichtbar");
    const blk = await page.$('.pl-blk.is-ext:has-text("iCal Zahnarzt")');
    ok(blk && !(await blk.getAttribute("data-ev")), "Feed-Termin nur lesen (nicht ziehbar)");
    await page.$eval("[data-r=cal]", (e) => e.scrollIntoView({ block: "start" }));
    await page.$eval("[data-pscroll=week]", (e) => { e.scrollTop = 14.5 * (Number(e.dataset.h) || 56); });
    await page.waitForTimeout(150);
    await hideToast(page);
    await page.screenshot({ path: path.join(OUT, `ical-week-390-${scheme}.png`) });
    await blk.$eval(".pl-blk-m", (e) => e.click());
    await page.waitForSelector(".sheet .cal-gev");
    const gl = await page.getAttribute(".sheet [data-r=glink]", "href");
    ok(gl && gl.startsWith("https://calendar.google.com/calendar/event?eid=") && (await page.textContent(".sheet")).includes("Mein Google · nur lesen"), "Termin-Blatt: „In Google Kalender öffnen“ + Kalendername");
    ok((await page.textContent(".sheet")).includes("24 Stunden vorher absagen"), "Gefaltete Beschreibung korrekt");
    await page.click(".sheet .close");
    await mode(page, "tag");
    // nächste Woche: EXDATE → kein Training
    await mode(page, "woche");
    await page.click('[data-pnav="1"]');
    await page.waitForTimeout(250);
    ok(!(await calText(page)).includes("iCal Fußballtraining"), "EXDATE: Training nächste Woche entfällt");
    await page.click('[data-pnav="1"]');
    await page.waitForTimeout(250);
    ok((await calText(page)).includes("iCal Fußballtraining"), "Serie läuft danach weiter");

    // --- Neuladen: Termine wieder da, ohne Neuverbinden (Worker sogar offline → Zwischenspeicher)
    S.icsMode = "down";
    await page.reload();
    await start(page);
    await mode(page, "monat");
    await page.waitForFunction(() => document.querySelector("[data-r=cal]").textContent.includes("iCal Skikurs"), null, { timeout: 5000 });
    ok(!(await page.$(".pl-greconnect")), "Nach dem Neuladen: Feed-Termine aus dem Zwischenspeicher, kein „neu verbinden“");
    S.icsMode = "ok";

    if (scheme === "light") {
      // --- OAuth: Token über Neuladen, Doppel ausgeblendet
      await page.evaluate(() => { window.__gcalTestToken = "TEST-TOKEN"; });
      await page.click('[data-pact="cals"]');
      await page.click(".sheet [data-r=gconnect]");
      await page.waitForSelector('.sheet [data-vis="g:verein@group.calendar.google.com"]');
      ok(!(await page.$(`.sheet [data-vis="g:${CAL}"]`)) && (await page.textContent(".sheet")).includes("schon über den iCal-Link"), "OAuth-Doppel des Feed-Kalenders ausgeblendet");
      await page.click(".sheet .close");
      await mode(page, "woche");
      await page.waitForFunction(() => document.querySelector("[data-r=cal]").textContent.includes("Verein Sitzung"), null, { timeout: 5000 });
      ok(!(await calText(page)).includes("OAuth-Doppel"), "Woche: OAuth-Doppel nicht gezeigt, Feed bevorzugt");
      const tokStored = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.gcal.tok") || "null"));
      ok(tokStored && tokStored.token === "TEST-TOKEN" && tokStored.exp > Date.now() + 50 * 60000, "OAuth-Token mit Ablaufzeit gespeichert");
      await page.evaluate(() => { sessionStorage.removeItem("stempelkarte.gcal.v1"); });
      S.gCalls = [];
      await page.reload(); // ohne Test-Haken: nur das gespeicherte Token
      await start(page);
      await mode(page, "woche");
      await page.waitForFunction(() => document.querySelector("[data-r=cal]").textContent.includes("Verein Sitzung"), null, { timeout: 5000 });
      ok(S.gCalls.length > 0 && S.gCalls.every((a) => a === "Bearer TEST-TOKEN") && !(await page.$(".pl-greconnect")), "Nach Neuladen: Google ohne Neuverbinden (gespeichertes Token)");

      // --- 401: Token still verwerfen, kleiner Knopf
      S.gMode = "401";
      await page.evaluate(() => { sessionStorage.removeItem("stempelkarte.gcal.v1"); });
      await page.reload();
      await start(page);
      await mode(page, "woche");
      await page.waitForSelector(".pl-greconnect", { timeout: 5000 });
      ok(!(await page.$(".pl-gstat.bad")) && !(await page.$('[role=alert]')) && (await page.textContent(".pl-greconnect")).includes("Google neu verbinden"), "401 → kleiner Knopf „Google neu verbinden“, kein großer Fehler");
      ok(await page.evaluate(() => !localStorage.getItem("stempelkarte.gcal.tok") && !sessionStorage.getItem("stempelkarte.gcal.tok")), "401 → Token verworfen");
      ok((await calText(page)).includes("iCal Zahnarzt"), "Feed-Termine bleiben trotz Google-401");
      await hideToast(page);
      await page.screenshot({ path: path.join(OUT, `ical-401-chip-390.png`) });
      // Feed entfernen
      await page.click('[data-pact="cals"]');
      await page.click(".sheet [data-delfeed]");
      await page.click(".sheet [data-delfeed]");
      await page.waitForFunction(() => !document.querySelector(".sheet .cal-feeds"));
      ok(await page.evaluate(() => !localStorage.getItem("stempelkarte.ical.local").includes("private")), "Kalender-Link entfernen");
      await page.click(".sheet .close");
    }
    await ctx.close();
  }
  ok(errors.length === 0, "Keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
