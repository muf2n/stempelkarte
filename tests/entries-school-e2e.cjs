// Berufsschule im Reiter „Einträge“ (Update 9, Agent R): eine Karte je Schultag, Kopf = Karten, Freitag-Hinweis,
// eingeklappte Zukunftswochen, manueller Schuleintrag bearbeitbar, Überstundenkonto unverändert.
//   cd <worktree> && python3 -m http.server 8859 &   then   NODE_PATH=$(npm root -g) node tests/entries-school-e2e.cjs [screenshot-dir] [baseline]
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const BASE = "http://localhost:8859/";
const OUT = process.argv[2] || require("os").tmpdir();
const BASELINE = process.argv[3] === "baseline";

const T = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const work = (id, d, h1, h2, pause = 30, extra = {}) => ({ id, kind: "work", start: T(2026, 11, d, h1), end: T(2026, 11, d, h2), pauseMin: pause, placeId: null, place: "Baustelle Graz", note: "", inLoc: null, outLoc: null, ...extra });
const SEED = {
  entries: [
    { id: "k1", kind: "krank", start: T(2026, 11, 2), end: T(2026, 11, 2), pauseMin: 0, creditMin: 578, note: "", place: "", placeId: null, inLoc: null, outLoc: null },
    work("w1", 3, 7, 16, 30, { segments: [
      { start: T(2026, 11, 3, 7), end: T(2026, 11, 3, 8), activity: "Autofahren", place: "Firma", endPlace: "Baustelle Graz", km: 23 },
      { start: T(2026, 11, 3, 8), end: T(2026, 11, 3, 16), activity: "Arbeiten", place: "Baustelle Graz" }] }),
    work("w2", 4, 7, 16, 25),
    { id: "u1", kind: "urlaub", start: T(2026, 11, 12), end: T(2026, 11, 12), pauseMin: 0, creditMin: 578, note: "", place: "", placeId: null, inLoc: null, outLoc: null },
    { id: "s1", kind: "schule", start: T(2026, 11, 18), end: T(2026, 11, 18), pauseMin: 0, creditMin: 0, note: "1 Lehrjahr", place: "", placeId: null, inLoc: null, outLoc: null },
    { id: "s2", kind: "schule", start: T(2026, 11, 19), end: T(2026, 11, 19), pauseMin: 0, creditMin: 0, note: "1 Lehrjahr", place: "", placeId: null, inLoc: null, outLoc: null },
    work("w3", 24, 14, 17, 0, { note: "nach der Schule" }),
  ],
  places: [], todos: [], days: {}, running: null, rev: 1,
  settings: {
    workDays: [1, 2, 3, 4], weeklyTarget: 38.5, holidays: true, balanceStart: "2026-11-02",
    school: { days: [], blocks: [{ id: "sb1", from: "2026-11-18", to: "2026-12-23", label: "Berufschule" }] },
  },
};

let failures = 0;
const ok = (c, msg) => { if (c) console.log("  ✓ " + msg); else { failures++; console.log("  ✗ " + msg); } };

async function open(browser, { scheme = "light", now = "2026-11-05T10:00:00", seed = SEED } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, timezoneId: "Europe/Vienna", deviceScaleFactor: 2 });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await ctx.addInitScript((s) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.clear();
      localStorage.setItem("stempelkarte.local.v1", JSON.stringify(s));
      sessionStorage.setItem("seeded", "1");
    }
  }, seed);
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(now) });
  page.__errors = [];
  page.on("console", (m) => { if (m.type() === "error") if (!/ERR_FAILED/.test(m.text())) page.__errors.push(m.text()); });
  page.on("pageerror", (e) => page.__errors.push("pageerror: " + e.message));
  await page.goto(BASE);
  const b = await page.$("#btn-local");
  if (b && await b.isVisible()) await b.click();
  await page.waitForTimeout(600);
  page.listShot = async (name) => {
    await page.addStyleTag({ content: ".appbar,.tabbar,#toast{display:none!important}" });
    await page.locator('.ek-wrap').screenshot({ path: path.join(OUT, name) });
  };
  return { ctx, page };
}

async function saldo(page) {
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForTimeout(500);
  return (await page.textContent("#ov-saldo")).trim() + " | Monat " + (await page.textContent("#ov-bal-month")).trim();
}

async function gotoEntries(page, month) {
  await page.evaluate(() => { location.hash = "#eintraege"; });
  await page.waitForTimeout(400);
  if (month === "next") { await page.click('[data-act="next"]'); await page.waitForTimeout(300); }
}

(async () => {
  const browser = await chromium.launch();
  const res = {};
  for (const now of ["2026-11-05T10:00:00", "2026-11-26T18:00:00", "2026-12-30T12:00:00"]) {
    const { ctx, page } = await open(browser, { now });
    res[now] = await saldo(page);
    console.log("Saldo @" + now + ": " + res[now]);
    await ctx.close();
  }
  const f = path.join(OUT, "saldo.json");
  if (BASELINE) { fs.writeFileSync(f, JSON.stringify(res)); console.log("Baseline gespeichert"); await browser.close(); return; }
  const base = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {"2026-11-05T10:00:00": "−2:09 h | Monat −2:09 h", "2026-11-26T18:00:00": "−56:54 h | Monat −56:54 h", "2026-12-30T12:00:00": "−85:46 h | Monat −28:52 h"}; // Saldo vor der Änderung
  for (const k of Object.keys(base)) ok(base[k] === res[k], `Übersicht-Saldo @${k} unverändert (${base[k]} → ${res[k]})`);

  for (const scheme of ["light", "dark"]) {
    console.log(`— ${scheme}`);
    const { ctx, page } = await open(browser, { scheme });
    await gotoEntries(page);
    await page.listShot(`ek-${scheme}-nov.png`);
    const list = '[data-ref="list"]';
    // keine separaten 0:00-Schule-Karten
    const sepSchool = await page.$$eval(`${list} button.entry.ek-abs`, (els) => els.filter((e) => /Schule/.test(e.textContent)).length);
    ok(sepSchool === 0, "keine separaten Schule-Karten (manuelle Einträge zusammengeführt)");
    // eine Karte je Schultag
    const cards = await page.$$eval(`${list} .ek-schcard[data-day]`, (els) => els.map((e) => e.dataset.day));
    ok(cards.length === new Set(cards).size && cards.length >= 9, `eine Karte je Schultag (${cards.length})`);
    // eingeklappte Zukunftswochen
    const weeks = await page.$$(`${list} details.ek-schweek`);
    ok(weeks.length >= 2, `Zukunftswochen eingeklappt (${weeks.length})`);
    const wk1 = await page.textContent(`${list} details.ek-schweek:last-of-type summary`);
    console.log("    Woche:", wk1.replace(/\s+/g, " ").trim());
    ok(/Mi 18\.11\.–Fr 20\.11\./.test(wk1) && /3 Tage/.test(wk1) && /19:16 h/.test(wk1), "Wochenzeile 18.–20.11.: 3 Tage · 19:16 h");
    ok(!(await page.isVisible(`${list} .ek-schcard[data-day="2026-11-19"]`)), "Tage zunächst verborgen");
    // Freitag-Hinweis
    ok(await page.isVisible(`${list} .ek-schhint`), "Freitag-Hinweis sichtbar");
    const hintTxt = await page.textContent(`${list} .ek-schhint`);
    ok(/Freitag ist bei dir kein Arbeitstag/.test(hintTxt), "Hinweistext Freitag");
    ok((await page.$$(`${list} .ek-schhint`)).length === 1, "Hinweis nur einmal");
    // aufklappen
    await page.click(`${list} details.ek-schweek:last-of-type summary`);
    await page.waitForTimeout(250);
    ok(await page.isVisible(`${list} .ek-schcard[data-day="2026-11-19"]`), "Woche klappt auf");
    await page.listShot(`ek-${scheme}-nov-open.png`);
    // Kopf = Karten
    const pairs = await page.$$eval(`${list} .day`, (days) => days.filter((d) => d.offsetParent).map((d) => {
      const sum = d.querySelector(".day-h .sum");
      const ds = [...d.querySelectorAll(":scope > .entry .d, :scope > .entry.ek-schcard .d")].map((x) => x.textContent.trim());
      return { h: d.querySelector(".day-h").textContent.replace(/\s+/g, " ").trim(), sum: sum ? sum.textContent.trim() : null, ds };
    }));
    const toMin = (s) => { const m = /^(\d+):(\d{2}) h$/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : null; };
    let allEq = true;
    for (const p of pairs) {
      const nums = p.ds.map(toMin).filter((x) => x != null);
      const sm = toMin(p.sum);
      if (sm != null && nums.length && nums.reduce((a, b) => a + b, 0) !== sm) { allEq = false; console.log("    ≠", JSON.stringify(p)); }
      if (p.sum === "0:00 h" && /Mi|Do|Fr/.test(p.h) && /18\.11|19\.11|20\.11/.test(p.h)) { allEq = false; console.log("    0:00 an Schultag", JSON.stringify(p)); }
    }
    ok(allEq, "Kopfsumme = Summe der Karten (kein irreführendes 0:00 h)");
    const fri = pairs.find((p) => /20\.11\./.test(p.h));
    ok(fri && fri.sum === "Schule" && !fri.ds.some((x) => /0:00/.test(x)), `Freitag 20.11.: Pill „Schule“, kein 0:00 (${fri && fri.sum} / ${fri && fri.ds})`);
    const wed = pairs.find((p) => /18\.11\./.test(p.h));
    ok(wed && wed.sum === "9:38 h", `Mi 18.11.: Kopf 9:38 h (${wed && wed.sum})`);
    ok(await page.isVisible(`${list} .ek-schcard[data-day="2026-11-18"] .ek-schnote`), "Notiz „1 Lehrjahr“ in der Schulkarte");
    // andere Arten unverändert
    ok(await page.isVisible(`${list} button.entry[data-id="u1"]`), "Urlaub-Karte da");
    ok(await page.isVisible(`${list} button.entry[data-id="k1"]`), "Krank-Karte da");
    ok(await page.isVisible(`${list} button.entry[data-id="w1"]`), "Arbeit-Karte da");
    ok((await page.textContent(list)).includes("23 km"), "km-Zeile da");
    if (scheme === "light") {
      // Hinweis wegklicken (bleibt weg)
      await page.click(`${list} .ek-schhint [data-act="sch-hint-x"]`);
      await page.waitForTimeout(200);
      ok(!(await page.$(`${list} .ek-schhint`)), "Hinweis weggeklickt");
      await page.reload(); await page.waitForTimeout(700);
      await gotoEntries(page);
      ok(!(await page.$(`${list} .ek-schhint`)), "Hinweis bleibt weg (localStorage)");
      // manuellen Schuleintrag bearbeiten
      await page.click(`${list} details.ek-schweek:last-of-type summary`);
      await page.click(`${list} .ek-schcard[data-id="s1"]`);
      await page.waitForSelector("#ef-note");
      ok((await page.inputValue("#ef-note")) === "1 Lehrjahr", "Formular öffnet den manuellen Schuleintrag");
      await page.fill("#ef-note", "1. Lehrjahr · Klasse 1b");
      await page.click("#ef-save");
      await page.waitForTimeout(700);
      const st = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).entries.find((e) => e.id === "s1"));
      ok(st && st.note === "1. Lehrjahr · Klasse 1b" && st.kind === "schule", "Änderung gespeichert");
      const det = await page.$(`${list} details.ek-schweek:last-of-type`);
      if (det && !(await det.getAttribute("open"))) await page.click(`${list} details.ek-schweek:last-of-type summary`);
      ok((await page.textContent(`${list} .ek-schcard[data-day="2026-11-18"]`)).includes("Klasse 1b"), "neue Notiz in der Karte");
      // einzelner Tag gewählt
      await page.click('.cal-day[data-day="2026-11-20"]');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `ek-${scheme}-sel-fri.png`), fullPage: false });
      await page.click('.cal-day[data-day="2026-11-20"]');
    }
    // Dezember
    await page.click('[data-act="next"]'); await page.waitForTimeout(300);
    await page.listShot(`ek-${scheme}-dec.png`);
    ok(page.__errors.length === 0, "keine Konsolenfehler " + page.__errors.join(" | "));
    await ctx.close();
  }
  // Vergangenheit: 26.11. – Tage 18./19. vergangen, Woche 23.–27. teils
  {
    const { ctx, page } = await open(browser, { now: "2026-11-26T18:00:00", scheme: "dark" });
    await gotoEntries(page);
    await page.listShot(`ek-dark-past.png`);
    const tue = await page.$eval('[data-ref="list"] .ek-schcard[data-day="2026-11-24"]', (e) => e.closest(".day").querySelector(".day-h .sum").textContent.trim()).catch(() => null);
    ok(tue === "12:38 h", `Di 24.11.: Schule + Arbeit = 12:38 h (${tue})`);
    ok(!(await page.$('[data-ref="list"] .ek-schcard[data-day="2026-11-19"].plan')), "vergangene Tage nicht „geplant“");
    const sum = await page.textContent('[data-ref="sum"]');
    console.log("    Summe:", sum);
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `${failures} FEHLER` : "ALLES OK");
  process.exit(failures ? 1 : 0);
})();
