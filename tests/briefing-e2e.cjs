// Playwright-Test: ☀️ Morgen-Briefing & 📅 Wochenrückblick (Update 10 F), lokaler Modus, feste Uhrzeit.
//   cd <worktree> && python3 -m http.server 9531 &   then   node tests/briefing-e2e.cjs [screenshot-dir]
// Angebot im Überblick (einmal pro Morgen), Blatt aus echten Daten (Wetter gestubbt, Einsatz, Material, Schule, Geburtstag),
// Vorlesen (Attrappe), „Von Jarvis zusammenfassen“ schickt NUR die Zusammenfassung an /chat (Modus "briefing", gestubbt),
// Wochenrückblick mit Geld-Sperre, Benachrichtigungszentrale, Einstellungen (Push Standard aus).
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:9531/";
const OUT = process.argv[2] || require("os").tmpdir();
const H = 3600e3;
const at = (y, m, d, h, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const MON7 = at(2026, 11, 9, 7, 15);
const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function forecast(now) {
  const d = new Date(now);
  const days = [0, 1, 2, 3].map((i) => key(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)));
  return {
    current: { temperature_2m: 4.4, weather_code: 63, wind_speed_10m: 12 },
    daily: { time: days, weather_code: [63, 2, 71, 0], temperature_2m_max: [6.2, 8, 2, 5], temperature_2m_min: [1.1, 4, -2.4, -1],
      precipitation_sum: [8, 0, 3, 0], precipitation_probability_max: [85, 10, 60, 0], wind_gusts_10m_max: [74, 20, 40, 20] },
  };
}

function seed(now) {
  return {
    entries: [
      { id: "e1", start: at(2026, 11, 2, 7), end: at(2026, 11, 2, 16), pauseMin: 30, kind: "work", placeId: "p1", place: "Baustelle Musterstraße" },
      { id: "e2", start: at(2026, 11, 3, 7), end: at(2026, 11, 3, 17), pauseMin: 30, kind: "work", placeId: "p1", place: "Baustelle Musterstraße" },
    ],
    places: [{ id: "p1", name: "Baustelle Musterstraße", lat: 48.2, lng: 16.37, radius: 150 }],
    todos: [
      { id: "t1", kind: "termin", title: "Baubesprechung", date: "2026-11-09", time: "09:30", location: "Büro", created: 1 },
      { id: "t2", kind: "termin", title: "Zahnarzt Test", date: "2026-11-09", time: "15:30", created: 2 },
      { id: "t3", kind: "termin", title: "Elternabend", date: "2026-11-12", time: "18:00", created: 3 },
      { id: "a1", title: "Rechnung zahlen", date: "2026-11-05", created: 4 },
      { id: "a2", title: "Erledigt letzte Woche", done: true, doneAt: at(2026, 11, 6, 12), created: 5 },
      { id: "ez", kind: "einsatz", title: "Einsatz", date: "2026-11-09", dateTo: "2026-11-13", placeId: "p1", people: ["Max"], createdAt: 6 },
      { id: "g1", kind: "geburtstag", title: "Oma Test", bday: "11-09", created: 7 },
    ],
    days: {}, rev: now, running: null,
    settings: { weeklyTarget: 38.5, school: { days: [2], blocks: [] } },
  };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const chats = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  async function mk(scheme, width, height, now) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800 });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.addInitScript(() => {
      window.__skAiTest = { token: "test", url: location.origin };
      const tts = (window.__tts = { spoken: [] });
      const ss = { speaking: false, pending: false, paused: false, getVoices: () => [{ name: "Test", lang: "de-DE", voiceURI: "t", localService: true }],
        addEventListener() {}, removeEventListener() {},
        speak(u) { tts.spoken.push(u.text); this.speaking = true; setTimeout(() => { this.speaking = false; u.onend && u.onend({}); }, 20); },
        cancel() { this.speaking = false; }, pause() {}, resume() {} };
      Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true });
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (/Content Security Policy|Refused to/.test(t)) errors.push("CSP: " + t);
      else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
    await page.route("https://api.open-meteo.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(forecast(now)) }));
    await page.route("**/chat", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      chats.push(body);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "Guten Morgen! Heute geht's in die Musterstraße – nimm die Steckdosen mit.", actions: [], usage: { usd: 0.01, capUsd: 5 } }) });
    });
    await page.clock.setFixedTime(now);
    await page.goto(BASE);
    await page.evaluate(([d]) => {
      localStorage.clear();
      localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d));
      localStorage.setItem("sk-weather", JSON.stringify({ src: "city", city: "Teststadt", lat: 47.07, lon: 15.44 }));
      localStorage.setItem("sk-a-material_items", JSON.stringify([
        { id: "m1", name: "Schuko-Steckdose", qty: 4, unit: "Stk", status: "brauche", placeId: "p1", place: "Baustelle Musterstraße", dayKey: "2026-11-06" },
        { id: "m2", name: "Abzweigdose", qty: 2, unit: "Stk", status: "verbaut", placeId: "p1", dayKey: "2026-11-05" },
      ]));
      localStorage.setItem("sk-a-school_exams", JSON.stringify([{ id: "x1", kind: "Test", subject: "Mathe", date: "2026-11-10" }]));
      localStorage.setItem("sk-a-lap_stats", JSON.stringify([{ id: "me", days: { "2026-11-07": { n: 5 }, "2026-11-08": { n: 3 } } }]));
      localStorage.setItem("sk-a-money_tx", JSON.stringify([{ id: "x1", type: "out", amount: 42.5, date: "2026-11-03", category: "essen" }]));
    }, [seed(now)]);
    await page.reload();
    await page.click("#btn-local");
    await page.waitForSelector("#view-heute .dash-grid > .dw", { state: "visible" });
    await page.waitForTimeout(300);
    return { ctx, page };
  }

  /* ---------- Morgen: Angebot + Blatt ---------- */
  let { ctx, page } = await mk("dark", 390, 844, MON7);
  ok(await page.isVisible("#view-heute .dash-offer"), "Angebot „Guten Morgen“ im Überblick sichtbar");
  ok((await page.textContent("#view-heute .dash-offer")).includes("Guten Morgen"), "… mit Gruß");
  ok((await page.textContent('#view-heute [data-d="profile"]')).includes("Standard"), "Profil-Chip zeigt Standard");
  await page.screenshot({ path: path.join(OUT, "briefing-offer-390-dark.png") });
  await page.click('#view-heute .dash-offer [data-d="brief-open"]');
  await page.waitForSelector(".sheet .bf-sec[data-sec='site']");
  await page.waitForTimeout(400);
  const txt = await page.textContent(".sheet .bf");
  ok(/Guten Morgen ☀️/.test(await page.textContent(".bf-title")), "Titel Guten Morgen");
  ok((await page.textContent(".bf-date")).includes("Montag, 9. November"), "Datum");
  ok(txt.includes("Baustelle Musterstraße") && txt.includes("laut Einsatzplan · mit Max"), "Baustelle aus dem Einsatzplan + Kollege");
  ok(txt.includes("Mitnehmen: 1 Material") && txt.includes("4 Stk Schuko-Steckdose") && !txt.includes("Abzweigdose"), "Material zum Mitnehmen (nur „brauche“)");
  ok(txt.includes("Baubesprechung") && txt.includes("09:30 · Büro") && txt.includes("Zahnarzt Test"), "Termine heute");
  ok(txt.includes("1 Aufgabe offen, 1 davon überfällig"), "Aufgaben mit überfällig");
  ok(txt.includes("Morgen Berufsschule") && txt.includes("Test Mathe"), "Schule morgen + Prüfung");
  ok(txt.includes("Oma Test hat Geburtstag"), "Geburtstag heute");
  ok(await page.isVisible(".sheet .bf-sec[data-sec='weather']") && /Regen|Sturm|Böen/i.test(txt), "Wetter mit Warnung");
  await page.screenshot({ path: path.join(OUT, "briefing-morning-390-dark.png") });
  // Vorlesen lokal
  await page.click('[data-bf="speak"]');
  await page.waitForFunction(() => window.__tts.spoken.join(" ").includes("Musterstraße"));
  const spoken = await page.evaluate(() => window.__tts.spoken.join(" "));
  ok(spoken.includes("Baustelle Musterstraße") && !/\p{Extended_Pictographic}/u.test(spoken), "🔊 Vorlesen ohne Emojis");
  // KI-Zusammenfassung
  ok(await page.isVisible('[data-bf="ai"]'), "🤖-Knopf sichtbar (Test-Haken)");
  ok((await page.textContent('[data-bf="ai"]')).includes("zusammenfassen"), "Knopf beschriftet");
  ok(chats.length === 0, "kein KI-Aufruf ohne Tipp");
  await page.click('[data-bf="ai"]');
  await page.waitForSelector(".bf-ai:not([hidden])");
  ok(chats.length === 1 && chats[0].mode === "briefing", "/chat im Modus briefing");
  const sent = chats[0].messages.map((m) => m.content).join("\n");
  ok(chats[0].messages.length === 1 && sent.includes("MORGEN-BRIEFING") && sent.includes("Baubesprechung"), "nur die Zusammenfassung gesendet");
  ok(!("image" in chats[0]) && !sent.includes("lat") && !sent.includes("16.37"), "keine Fotos/Koordinaten");
  ok((await page.textContent('[data-bf="aireply"]')).includes("Musterstraße"), "Antwort angezeigt");
  await page.waitForFunction(() => window.__tts.spoken.some((t) => /Musterstraße – nimm|Musterstraße, nimm|nimm die Steckdosen/.test(t)));
  ok(true, "Antwort vorgelesen");
  // Einstellungen: Push Standard aus
  await page.click(".bf-set summary");
  ok(!(await page.isChecked('[data-bf-set="push"]')) && await page.isChecked('[data-bf-set="offer"]'), "Push aus, Angebot an (Standard)");
  await page.check('[data-bf-set="push"]');
  await page.waitForTimeout(250);
  ok(await page.isVisible(".bf-time"), "Uhrzeit erscheint");
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).settings.briefing);
  ok(st && st.push === true && st.time === "06:30", "Push gespeichert");
  // Wochen-Reiter: Montag → letzte Woche
  await page.click('[data-bf-tab="weekly"]');
  await page.waitForSelector(".sheet .bf-sec[data-sec='work']");
  await page.waitForTimeout(300);
  const wk = await page.textContent(".sheet .bf");
  ok((await page.textContent(".bf-date")).includes("KW 45"), "Wochenrückblick KW 45");
  ok(wk.includes("18:00 h gearbeitet") && wk.includes("Überstunden −12:48 h"), "Stunden & Überstunden der Woche");
  ok(wk.includes("1 Aufgabe erledigt"), "Erledigtes");
  ok(wk.includes("LAP: 2 Lerntage"), "LAP-Lerntage");
  ok(wk.includes("Ausgaben 42,50 €"), "Finanzen ohne Sperre");
  ok(wk.includes("Elternabend"), "Nächste Woche");
  await page.screenshot({ path: path.join(OUT, "briefing-weekly-390-dark.png") });
  await page.click(".sheet .close");
  await page.waitForTimeout(200);
  ok(!(await page.isVisible("#view-heute .dash-offer")), "Angebot nach dem Ansehen weg (einmal pro Morgen)");
  await page.reload();
  await page.waitForSelector("#view-heute .dash-grid > .dw", { state: "visible" });
  await page.waitForTimeout(300);
  ok(!(await page.isVisible("#view-heute .dash-offer")), "… auch nach Neuladen");
  // Benachrichtigungszentrale
  await page.click("#btn-notify");
  await page.waitForSelector('[data-nt="go"][data-id^="brief:"]');
  ok(true, "Briefing in der Benachrichtigungszentrale");
  await page.click('[data-nt="go"][data-id^="brief:"]');
  await page.waitForSelector(".sheet .bf", { timeout: 4000 });
  ok(true, "… öffnet das Briefing");
  await page.click(".sheet .close");
  await ctx.close();

  /* ---------- Sonntag, PC hell, Geld-Sperre ---------- */
  ({ ctx, page } = await mk("light", 1440, 900, at(2026, 11, 8, 18)));
  await page.evaluate(() => localStorage.setItem("sk-money-lock", JSON.stringify({ enabled: true, pin: { salt: "c2FsdA==", hash: "aGFzaA==", iter: 1000, len: 4 } })));
  await page.reload();
  await page.waitForSelector("#view-heute .dash-grid > .dw", { state: "visible" });
  await page.waitForTimeout(400);
  ok(await page.isVisible("#view-heute .dash-offer") && (await page.textContent("#view-heute .dash-offer")).includes("Wochenrückblick"), "Sonntagabend: Wochenrückblick angeboten");
  await page.click('#view-heute .dash-offer [data-d="brief-open"]');
  await page.waitForSelector(".sheet .bf-sec[data-sec='money']");
  await page.waitForTimeout(300);
  const ws = await page.textContent(".sheet .bf");
  ok(ws.includes("Geld gesperrt") && !ws.includes("42,50"), "Geld-Sperre: keine Beträge");
  ok((await page.textContent(".bf-date")).includes("Mo 02.11. – So 08.11."), "Sonntag → diese Woche");
  await page.screenshot({ path: path.join(OUT, "briefing-weekly-1440-light.png") });
  await page.click(".sheet .close");
  await page.click('#view-heute [data-d="brief"]');
  await page.waitForSelector(".sheet .bf");
  ok(true, "„📅 Wochenrückblick“-Knopf öffnet das Blatt");
  await ctx.close();

  await browser.close();
  if (errors.length) { console.error("Konsolenfehler:\n" + errors.join("\n")); process.exit(1); }
  console.log("Alles gut ✔");
})().catch((e) => { console.error(e); process.exit(1); });
