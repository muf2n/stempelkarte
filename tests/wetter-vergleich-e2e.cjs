// Playwright-Test für 🌦️ Wetter im Heute-Überblick und 📊 Vergleichsmodus in der Übersicht (Update 10, Phase D), lokaler Modus.
//   cd <worktree> && python3 -m http.server 8978 &   then   node tests/wetter-vergleich-e2e.cjs [screenshot-dir]
// Wetter: einmal fragen, Standort (gerundet auf 2 Nachkommastellen, nur auf dem Gerät), api.open-meteo.com per page.route gestubbt
// (die CSP muss den Host erlauben), heute + 3 Tage, Warnungen (Wind/Starkregen/Frost), 1 h Zwischenspeicher, offline letzter Stand,
// Stadt über die Einstellungen (Nominatim gestubbt), „Nein danke“ blendet aus.
// Vergleich: Woche/Monat, Soll/Ist, Aufgaben, Einnahmen/Ausgaben, Sport, Balken maßstabsgetreu, ▲/▼.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8978/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function forecast() {
  const d = new Date();
  const days = [0, 1, 2, 3].map((i) => key(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)));
  return {
    current: { temperature_2m: 7.4, weather_code: 2, wind_speed_10m: 12 },
    daily: { time: days, weather_code: [2, 63, 71, 0], temperature_2m_max: [9.6, 8, 2, 5], temperature_2m_min: [3.1, 4, -2.4, -1],
      precipitation_sum: [0, 24.5, 3, 0], precipitation_probability_max: [10, 95, 60, 0], wind_gusts_10m_max: [30, 72, 40, 20] },
  };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const meteo = [];
  let meteoFail = false;
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  async function newPage(scheme, width, height) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800, geolocation: { latitude: 47.070712, longitude: 15.439504 }, permissions: ["geolocation"] });
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
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.route("https://api.open-meteo.com/**", async (route) => {
      meteo.push(route.request().url());
      if (meteoFail) return route.fulfill({ status: 503, body: "" });
      await route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(forecast()) });
    });
    await page.route("https://nominatim.openstreetmap.org/search**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify([{ lat: "47.0707", lon: "15.4395", name: "Graz", display_name: "Graz, Steiermark, Österreich" }]) }));
    return page;
  }
  const page = await newPage("light", 390, 844);
  const shot = async (name, p = page, sel = null) => { await p.waitForTimeout(350); if (sel) return (await p.$(sel)).screenshot({ path: path.join(OUT, name) }); return p.screenshot({ path: path.join(OUT, name), fullPage: false }); };
  const W = '#view-heute [data-w="weather"]';

  // Daten für den Vergleich: diese + letzte Woche
  const now = new Date();
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const dayTs = (offset, h) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + offset, h).getTime();
  const entries = [];
  for (let i = -7; i < -2; i++) entries.push({ id: "p" + i, kind: "work", start: dayTs(i, 7), end: dayTs(i, 15), pauseMin: 0 });
  const todayOffset = (now.getDay() + 6) % 7;
  for (let i = 0; i < todayOffset; i++) entries.push({ id: "c" + i, kind: "work", start: dayTs(i, 7), end: dayTs(i, 17), pauseMin: 0 });

  await page.goto(BASE);
  await page.evaluate(({ entries, lastWeek, thisWeek, sportPrev, sportCur }) => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries, places: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 40, holidays: false },
      todos: [{ id: "t1", kind: "todo", title: "A", date: thisWeek, done: true, doneAt: Date.now() - 60000 }, { id: "t2", kind: "todo", title: "B", date: thisWeek }] }));
    localStorage.setItem("sk-a-money_tx", JSON.stringify([{ id: "m1", date: thisWeek, amount: 40, type: "out" }, { id: "m2", date: lastWeek, amount: 120, type: "out" }, { id: "m3", date: thisWeek, amount: 900, type: "in" }]));
    localStorage.setItem("sk-a-freizeit", JSON.stringify([{ id: "f1", cat: "sport", start: sportPrev, end: sportPrev + 30 * 60000 }, { id: "f2", cat: "sport", start: sportCur, end: sportCur + 90 * 60000 }]));
  }, { entries, lastWeek: key(new Date(dayTs(-5, 12))), thisWeek: key(now), sportPrev: dayTs(-4, 18), sportCur: Math.min(Date.now() - 2 * 3600e3, dayTs(todayOffset, 6)) });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForSelector("#view-heute .dash-grid > .dw", { state: "visible" });

  /* ---------- Wetter: einmal fragen ---------- */
  await page.waitForSelector(W);
  ok((await page.textContent(W)).includes("Magst du hier das Wetter sehen"), "Wetter fragt einmal nach (ohne Anfrage ins Netz)");
  ok(meteo.length === 0, "noch keine Wetter-Anfrage");
  await shot("wetter-ask-390-light.png", page, W);
  await page.click(`${W} [data-wx="geo"]`);
  await page.waitForSelector(`${W} .dw-wx-days li:nth-child(4)`);
  const u = new URL(meteo[0]);
  ok(u.searchParams.get("latitude") === "47.07" && u.searchParams.get("longitude") === "15.44", "Anfrage mit gerundeten Koordinaten (47.07 / 15.44)");
  const pref = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-weather")));
  ok(pref.src === "geo" && pref.lat === 47.07 && pref.lon === 15.44, "Ort nur auf dem Gerät, gerundet");
  const txt = await page.textContent(W);
  ok(txt.includes("7°") && txt.includes("Teils bewölkt"), "Aktuell 7° · Teils bewölkt");
  ok((await page.$$eval(`${W} .dw-wx-days li`, (x) => x.length)) === 4, "Heute + 3 Tage");
  const warn = await page.$$eval(`${W} .dw-wx-warn li`, (x) => x.map((l) => l.textContent));
  ok(warn.some((w) => /Morgen:.*Starker Wind/.test(w)) && warn.some((w) => /Starkregen/.test(w)) && warn.some((w) => /Frost/.test(w)), "Hinweise: Wind, Starkregen, Frost");
  await shot("wetter-390-light.png", page, W);

  /* ---------- Zwischenspeicher + offline ---------- */
  const n1 = meteo.length;
  await page.reload();
  await page.waitForSelector(`${W} .dw-wx-days li`);
  ok(meteo.length === n1, "Neu laden innerhalb 1 h: keine neue Anfrage (Cache)");
  meteoFail = true;
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem("sk-weather-cache")); c.at -= 2 * 3600e3; localStorage.setItem("sk-weather-cache", JSON.stringify(c)); });
  await page.reload();
  await page.waitForFunction((sel) => /offline/.test(document.querySelector(sel)?.textContent || ""), W);
  ok((await page.$$eval(`${W} .dw-wx-days li`, (x) => x.length)) === 4, "Server weg → letzter Stand mit „offline 📴“");
  meteoFail = false;

  /* ---------- Stadt über die Einstellungen ---------- */
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "aussehen" } })));
  await page.waitForSelector('[data-sh-act="wetter"]', { state: "visible" });
  await page.click('[data-sh-act="wetter"]');
  await page.waitForSelector('.sheet [data-wx="city"]');
  await page.fill('.sheet [data-wx="city"]', "Graz");
  await page.click('.sheet [data-wx="save"]');
  await page.waitForSelector('.sheet [data-wx="city"]', { state: "detached" });
  const p2 = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-weather")));
  ok(p2.src === "city" && p2.city === "Graz" && p2.lat === 47.07, "Stadt „Graz“ gespeichert (gerundet)");
  await page.keyboard.press("Escape");
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForFunction((sel) => /Graz/.test(document.querySelector(sel)?.textContent || ""), W);
  ok(true, "Widget zeigt „Graz“");

  /* ---------- Vergleich in der Übersicht ---------- */
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForSelector("#compare-panel .cmp-row");
  const rows = await page.$$eval("#compare-panel .cmp-row", (x) => x.map((r) => r.dataset.row));
  for (const r of ["ist", "soll", "over", "done", "planned", "income", "expense", "sport"]) ok(rows.includes(r), `Vergleich: Zeile „${r}“`);
  const istTxt = await page.textContent('#compare-panel [data-row="ist"] .cmp-v');
  ok(istTxt.includes(`${todayOffset * 10}:00 h`) && istTxt.includes("vorher 40:00 h"), "Arbeitsstunden diese ↔ letzte Woche: " + istTxt.trim());
  const sportD = await page.$eval('#compare-panel [data-row="sport"] .cmp-d', (e) => [e.textContent, e.className]);
  ok(sportD[0].startsWith("▲") && /good/.test(sportD[1]), "Sport ▲ (gut)");
  const expD = await page.$eval('#compare-panel [data-row="expense"] .cmp-d', (e) => [e.textContent, e.className]);
  ok(expD[0].startsWith("▼") && /good/.test(expD[1]), "Ausgaben ▼ (gut)");
  const widths = await page.$eval('#compare-panel [data-row="sport"] svg', (s) => [+s.querySelector(".cmp-cur").getAttribute("width"), +s.querySelector(".cmp-prev").getAttribute("width")]);
  ok(Math.abs(widths[0] - 100) < 0.01 && Math.abs(widths[1] - 100 / 3) < 0.01, "Balken maßstabsgetreu (90 min ↔ 30 min = 100 % ↔ 33 %)");
  await page.$eval("#compare-panel", (e) => e.scrollIntoView());
  await shot("vergleich-woche-390-light.png", page, "#compare-panel");
  await page.click('#compare-panel [data-cmp="month"]');
  await page.waitForFunction(() => document.querySelector('#compare-panel [data-cmp="month"]').getAttribute("aria-selected") === "true");
  ok((await page.textContent("#compare-panel .cmp-legend")).includes("bis jetzt"), "Monat ↔ Vormonat");

  /* ---------- „Nein danke“ ---------- */
  await page.evaluate(() => { localStorage.removeItem("sk-weather"); location.hash = "#heute"; });
  await page.reload();
  await page.waitForSelector(`${W} [data-wx="no"]`);
  await page.click(`${W} [data-wx="no"]`);
  await page.waitForSelector(W, { state: "detached" });
  ok(true, "„Nein danke“ blendet das Wetter aus");

  /* ---------- 1440 dunkel ---------- */
  const big = await newPage("dark", 1440, 900);
  await big.goto(BASE);
  const ls = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  ls["sk-weather"] = JSON.stringify({ src: "city", city: "Graz", lat: 47.07, lon: 15.44 });
  await big.evaluate((d) => { for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); }, ls);
  await big.reload();
  const lb = await big.$("#btn-local");
  if (lb && await lb.isVisible()) await lb.click();
  await big.waitForSelector('#view-heute [data-w="weather"] .dw-wx-days li');
  await shot("wetter-1440-dark.png", big);
  await big.evaluate(() => { location.hash = "#uebersicht"; });
  await big.waitForSelector("#compare-panel .cmp-row");
  await big.$eval("#compare-panel", (e) => e.scrollIntoView());
  await shot("vergleich-1440-dark.png", big);

  ok(errors.length === 0, "keine Konsolen-Fehler / CSP-Verstöße" + (errors.length ? ":\n  " + errors.join("\n  ") : ""));
  await browser.close();
  console.log("\nAlle Wetter- und Vergleich-Tests bestanden ✔");
})().catch((e) => { console.error(e); process.exit(1); });
