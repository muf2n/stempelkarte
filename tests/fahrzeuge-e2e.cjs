// Playwright-Test für Alltag › 🚗 Fahrzeuge (Update 10) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8932 &   then   node tests/fahrzeuge-e2e.cjs [screenshot-dir]
// Kachel + Liste aus settings.vehicles (Fahrtenbuch, keine zweite Liste), Anlegen (auch im Fahrtenbuch), Pickerl mit Toleranzfrist
// und „Erledigt“, Service, Versicherung, km-Stand, Tankung je Fahrzeug (Unterwegs-Tankbuch, vehicleId), Verbrauch l/100 km und €/100 km,
// Kennzeichen ändern (km-Stand am Monatsanfang bleibt), Fahrzeugwahl im Unterwegs-Tankformular, globale Suche, Dashboard.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8932/";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const month = (off) => { const d = new Date(now.getFullYear(), now.getMonth() + off, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const day = (off) => { const d = new Date(now); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const mLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true });
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
  const shot = async (name) => { await page.waitForTimeout(350); return page.screenshot({ path: path.join(OUT, name), fullPage: true }); };
  const A = (n) => page.evaluate((n) => JSON.parse(localStorage.getItem("sk-a-" + n) || "[]"), n);
  const SET = () => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).settings);
  const sheet = ".sheet:last-child";
  const save = async () => { await page.click(`${sheet} [data-save]`); await page.waitForTimeout(300); };
  const odoMonth = month(-2);

  await page.goto(BASE);
  await page.evaluate(([odoMonth, d1, d2, d3]) => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, running: null, rev: Date.now(),
      settings: { weeklyTarget: 38.5, vehicles: [{ id: "v1", name: "Firmenbus", plate: "XX-123AB", type: "firma", odoStart: { [odoMonth]: 9800 } }], trips: { defaultVehicleId: "v1" } } }));
    localStorage.setItem("sk-a-travel_fuel", JSON.stringify([
      { id: "f1", date: d1, km: 10000, liters: 40, total: 64, full: true, station: "Teststation", vehicleId: "v1", booked: false },
      { id: "f2", date: d2, km: 10500, liters: 20, total: 32, full: false, station: "Teststation", vehicleId: "v1", booked: false },
      { id: "f3", date: d3, km: 11000, liters: 15, total: 24, full: true, station: "Teststation", booked: false },
    ]));
  }, [odoMonth, day(-40), day(-25), day(-10)]);
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(300);

  /* ---------- Kachel + Liste ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="fahrzeuge"]');
  ok((await page.textContent('.al-tile[data-id="fahrzeuge"]')).includes("Fahrzeuge"), "Kachel „🚗 Fahrzeuge“");
  await page.click('.al-tile[data-id="fahrzeuge"]');
  await page.waitForSelector(".fzg-card");
  ok((await page.evaluate(() => location.hash)) === "#alltag/fahrzeuge", "Route #alltag/fahrzeuge");
  const card = await page.textContent('.fzg-card[data-id="v1"]');
  ok(card.includes("Firmenbus") && card.includes("XX-123AB") && card.includes("11.000 km") && card.includes("3,5 l/100 km"), "Fahrzeug aus dem Fahrtenbuch mit km-Stand und Verbrauch (Tankung ohne Fahrzeug zählt zum Standard)");
  await shot("fahrzeuge-list-390-light.png");

  /* ---------- Detail Firmenbus: Tankbuch ---------- */
  await page.click('.fzg-card[data-id="v1"]');
  await page.waitForSelector(".fzg-hero");
  ok((await page.evaluate(() => location.hash)) === "#alltag/fahrzeuge/v1", "Detail-Route #alltag/fahrzeuge/v1");
  const fuelTxt = await page.textContent(".fzg-fuel");
  ok(fuelTxt.includes("3,5") && fuelTxt.includes("5,60 €") && fuelTxt.includes("3 Tankungen"), "Tankbuch: Ø 3,5 l/100 km und 5,60 € /100 km aus Volltankungen");
  ok((await page.$$(".fzg-reads li")).length === 4, "km-Stände aus Tankungen + Fahrtenbuch-Monatsanfang");
  await shot("fahrzeuge-detail-390-light.png");

  /* ---------- Pickerl ---------- */
  const tolMonth = month(-2);
  await page.click('[data-f="pickerl"]');
  await page.fill("#fzg-pm", tolMonth);
  await save();
  let info = (await A("fahrzeug_info")).find((x) => x.id === "v1");
  ok(info && info.pickerl.month === tolMonth, "Pickerl-Monat gespeichert");
  ok((await page.textContent(".fzg-pk")).includes("Toleranzfrist"), "2 Monate nach dem gelochten Monat → Toleranzfrist");
  await page.click(".fzg-pk summary");
  ok((await page.textContent(".fzg-pk details")).includes("vier Monate"), "Hinweis zur 4-Monats-Toleranz (ohne Gewähr)");
  await shot("fahrzeuge-pickerl-390-light.png");

  /* ---------- Dashboard zeigt Pickerl ---------- */
  await page.goto(BASE + "#heute");
  await page.waitForSelector('[data-w="faellig"]', { timeout: 5000 });
  ok((await page.textContent('[data-w="faellig"]')).includes("Pickerl Firmenbus"), "Dashboard: Pickerl in der Toleranzfrist");
  await page.goto(BASE + "#alltag/fahrzeuge/v1");
  await page.waitForSelector(".fzg-hero");

  await page.click('[data-f="pkdone"]');
  await page.waitForTimeout(300);
  info = (await A("fahrzeug_info")).find((x) => x.id === "v1");
  ok(info.pickerl.month === month(10), "✅ Erledigt → gleicher Monat ein Jahr später");
  ok((await page.textContent(".fzg-pk")).includes(mLabel(month(10))), "Pickerl zeigt neuen Monat");

  /* ---------- Service ---------- */
  await page.click('[data-f="service"]');
  await page.fill("#fzg-sk", "2000");
  await page.fill("#fzg-sm", "12");
  await page.fill("#fzg-skm", "9500");
  await save();
  info = (await A("fahrzeug_info")).find((x) => x.id === "v1");
  ok(info.service.lastKm === 2000 && info.service.everyKm === 9500 && info.service.everyMonths === 12, "Service gespeichert");
  ok((await page.textContent(".fzg-grid")).includes("noch 500 km"), "Service nach km: noch 500 km → bald");

  /* ---------- Versicherung + km-Stand ---------- */
  await page.click('[data-f="ins"]');
  await page.fill("#fzg-ic", "Muster Versicherung");
  await page.fill("#fzg-ip", "P-0042");
  await page.fill("#fzg-iu", day(20));
  await save();
  ok((await page.textContent(".fzg-grid")).includes("Muster Versicherung") && (await page.textContent(".fzg-grid")).includes("P-0042"), "Versicherung angezeigt");
  await page.click('[data-f="odo"]');
  await page.fill("#fzg-ok", "11.250");
  await page.fill("#fzg-on", "Reifenwechsel");
  await save();
  info = (await A("fahrzeug_info")).find((x) => x.id === "v1");
  ok(info.odo.length === 1 && info.odo[0].km === 11250, "km-Stand 11.250 gespeichert (deutsches Zahlenformat)");
  ok((await page.textContent(".fzg-big")) !== null && (await page.textContent(".fzg-grid")).includes("11.250 km"), "Aktueller km-Stand 11.250 km");
  ok((await page.textContent(".fzg-docs")).includes("Tresor"), "Dokumente-Hinweis auf den Tresor");

  /* ---------- Kennzeichen ändern: km-Stand Monatsanfang bleibt ---------- */
  await page.click('[data-f="edit"]');
  await page.fill("#fzg-p", "xx-124ab");
  await page.fill("#fzg-m", "Testmarke Kastenwagen");
  await save();
  let s = await SET();
  ok(s.vehicles.length === 1 && s.vehicles[0].plate === "XX-124AB" && s.vehicles[0].odoStart[odoMonth] === 9800, "Kennzeichen geändert, odoStart (Fahrtenbuch) bleibt erhalten");
  ok((await page.textContent(".fzg-hero")).includes("Testmarke Kastenwagen"), "Marke/Modell angezeigt");

  /* ---------- Neues Fahrzeug ---------- */
  await page.click('[data-f="back"]');
  await page.waitForSelector(".fzg-card");
  await page.click('.fzg-head [data-f="new"]');
  await page.fill("#fzg-n", "Kleinwagen");
  await page.fill("#fzg-p", "yy-9z");
  await page.click(`${sheet} [data-vt="privat"]`);
  await save();
  await page.waitForSelector(".fzg-hero");
  s = await SET();
  const v2 = s.vehicles.find((v) => v.name === "Kleinwagen");
  ok(s.vehicles.length === 2 && v2 && v2.plate === "YY-9Z" && v2.type === "privat" && s.trips.defaultVehicleId === "v1", "Neues Fahrzeug in settings.vehicles (Fahrtenbuch), Standard bleibt");
  ok((await page.evaluate(() => location.hash)) === "#alltag/fahrzeuge/" + v2.id, "Neues Fahrzeug öffnet das Detail");

  /* ---------- Tankung für den Kleinwagen ---------- */
  await page.click('[data-f="newfill"]');
  await page.waitForSelector("#uw-f-veh");
  ok((await page.inputValue("#uw-f-veh")) === v2.id, "Tankformular: Fahrzeug vorausgewählt");
  await page.fill("#uw-f-km", "50000");
  await page.fill("#uw-f-l", "30");
  await page.fill("#uw-f-e", "48,50");
  await save();
  const fills = await A("travel_fuel");
  ok(fills.length === 4 && fills.find((f) => f.km === 50000).vehicleId === v2.id, "Tankung mit vehicleId im Unterwegs-Tankbuch");
  ok((await page.textContent(".fzg-fuel")).includes("1 Tankung"), "Kleinwagen: 1 Tankung");
  await shot("fahrzeuge-detail2-390-light.png");

  /* ---------- Unterwegs-Tankformular hat Fahrzeugwahl ---------- */
  await page.click('[data-f="tankbuch"]');
  await page.waitForSelector(".uw-fuel");
  await page.click(`.uw-fill[data-id="${fills.find((f) => f.km === 50000).id}"]`);
  await page.waitForSelector("#uw-f-veh");
  ok((await page.inputValue("#uw-f-veh")) === v2.id, "Unterwegs › Tanken: Fahrzeugwahl im Formular");
  await page.click(`${sheet} .close`);
  await page.click(".uw-fab");
  await page.waitForSelector("#uw-f-veh");
  ok((await page.inputValue("#uw-f-veh")) === v2.id, "Neue Tankung übernimmt das zuletzt betankte Fahrzeug");
  await page.click(`${sheet} .close`);

  /* ---------- Suche ---------- */
  await page.click("#btn-search");
  await page.fill("#srch-q", "XX124AB");
  await page.waitForTimeout(300);
  ok((await page.$$eval(".srch-group[data-group]", (l) => l.map((g) => g.dataset.group))).includes("fahrzeuge"), "Universale Suche findet Fahrzeug per Kennzeichen");
  await page.click('.srch-group[data-group="fahrzeuge"] .srch-row');
  await page.waitForFunction(() => location.hash === "#alltag/fahrzeuge/v1");
  await page.waitForSelector(".fzg-hero");
  ok(true, "Suchtreffer öffnet das Fahrzeug");

  /* ---------- dunkel + PC ---------- */
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("fahrzeuge-detail-390-dark.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot("fahrzeuge-detail-1440-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await shot("fahrzeuge-detail-1440-light.png");
  await page.goto(BASE + "#alltag/fahrzeuge");
  await page.waitForSelector(".fzg-card");
  await shot("fahrzeuge-list-1440-light.png");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, "Kein waagrechtes Scrollen");

  ok(errors.length === 0, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("ALLE FAHRZEUG-TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
