// Playwright-Test: Alltag › ⚡ Elektro-Tools (Update 10 F) – Umrechnen, Farbcode (beide Richtungen), Rechner (LAP-Rechner), Lexikon, Schaltzeichen,
// Direkt-Sprung aus der Universalen Suche (#alltag/elektro?tab=lexikon&q=…). 390 px dunkel + 1440 px hell.
//   cd <worktree> && python3 -m http.server 9532 &   then   node tests/elektro-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:9532/";
const OUT = process.argv[2] || require("os").tmpdir();

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  async function mk(scheme, width, height) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800 });
    await ctx.route("**/*", (route) => { const u = new URL(route.request().url()); return u.hostname === "localhost" ? route.continue() : route.abort(); });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (/Content Security Policy|Refused to/.test(t)) errors.push("CSP: " + t);
      else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
    await page.goto(BASE);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, rev: 1, settings: {} })); });
    await page.reload();
    await page.click("#btn-local");
    await page.waitForSelector("#view-heute .dash", { state: "attached" });
    return { ctx, page };
  }
  let { ctx, page } = await mk("dark", 390, 844);
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector('.al-tile[data-id="elektro"]');
  ok(true, "Kachel ⚡ Elektro-Tools im Alltag");
  await page.click('.al-tile[data-id="elektro"]');
  await page.waitForSelector(".el-tab");
  ok((await page.textContent(".al-title")).includes("Elektro-Tools"), "Kopfzeile");
  ok((await page.textContent(".el-safety")).includes("Elektrofachkraft"), "Sicherheitshinweis");

  // Umrechnen
  await page.fill('[data-u="val"]', "1500");
  await page.waitForTimeout(100);
  ok(await page.textContent('.el-res b[data-unit="A"]') === "1,5 A", "1500 mA = 1,5 A");
  await page.click('[data-grp="leistung"]');
  await page.fill('[data-u="val"]', "2,2");
  await page.selectOption('[data-u="from"]', "kW");
  await page.waitForTimeout(100);
  ok(await page.textContent('.el-res b[data-unit="W"]') === "2200 W", "2,2 kW = 2200 W");
  await page.click('[data-grp="querschnitt"]');
  await page.fill('[data-u="val"]', "2,5");
  await page.selectOption('[data-u="from"]', "mm²");
  await page.waitForTimeout(100);
  ok(await page.textContent('.el-res b[data-unit="AWG"]') === "AWG 13", "2,5 mm² ≈ AWG 13");
  ok((await page.textContent(".el-card")).includes("Näherung"), "AWG-Hinweis");
  await page.screenshot({ path: path.join(OUT, "elektro-units-390-dark.png") });

  // Farbcode
  await page.click('.el-tab[data-tab="farbcode"]');
  ok((await page.textContent('[data-c="value"]')).includes("4,7 kΩ ±5 %"), "Gelb-Violett-Rot-Gold = 4,7 kΩ");
  await page.selectOption('[data-band="2"]', "orange");
  ok((await page.textContent('[data-c="value"]')).includes("47 kΩ"), "Multiplikator Orange → 47 kΩ");
  await page.click('[data-bands="5"]');
  ok((await page.textContent('[data-c="value"]')).includes("10 kΩ ±1 %"), "5 Ringe: Braun-Schwarz-Schwarz-Rot-Braun = 10 kΩ ±1 %");
  await page.fill('[data-c="ohm"]', "220");
  await page.waitForTimeout(100);
  const enc = await page.textContent('[data-c="enc"]');
  ok(enc.includes("Rot – Rot – Braun – Gold") && enc.includes("Rot – Rot – Schwarz – Schwarz – Braun"), "220 Ω → Farbringe 4/5");
  await page.fill('[data-c="ohm"]', "4600");
  await page.waitForTimeout(100);
  ok((await page.textContent('[data-c="enc"]')).includes("Nächster Normwert (E24): 4,7 kΩ"), "E24-Normwert");
  await page.screenshot({ path: path.join(OUT, "elektro-color-390-dark.png"), fullPage: true });

  // Rechner (aus LAP)
  await page.click('.el-tab[data-tab="rechner"]');
  await page.fill('input[name="U"]', "230");
  await page.fill('input[name="R"]', "46");
  await page.waitForTimeout(100);
  ok((await page.textContent('[data-k="out"]')).includes("5 A"), "Ohm: 230 V / 46 Ω = 5 A");

  // Lexikon
  await page.click('.el-tab[data-tab="lexikon"]');
  const cnt = await page.textContent('[data-l="count"]');
  ok(/^(\d+) von \1 Begriffen$/.test(cnt) && Number(cnt.split(" ")[0]) >= 140, "Lexikon mit ≥140 Begriffen: " + cnt);
  await page.fill('[data-l="q"]', "schlupf");
  await page.waitForTimeout(100);
  ok((await page.textContent(".el-lx dt")).includes("Schlupf"), "Suche „schlupf“ → Schlupf zuerst");
  await page.fill('[data-l="q"]', "");
  await page.click('[data-lcat="schutz"]');
  ok((await page.textContent('[data-l="count"]')).startsWith("2") || (await page.$$(".el-lx")).length > 10, "Kategorie Schutz filtert");

  // Schaltzeichen
  await page.click('.el-tab[data-tab="zeichen"]');
  const n = (await page.$$(".el-sym")).length;
  ok(n >= 20, `${n} Schaltzeichen`);
  for (const id of ["widerstand", "taster", "lampe", "schuko", "fi", "ls", "motor", "trafo", "pe", "led", "relais"]) ok(await page.isVisible(`.el-sym[data-sym="${id}"] svg`), "Zeichen " + id);
  await page.fill('[data-s="q"]', "diode");
  await page.waitForTimeout(100);
  ok((await page.$$(".el-sym")).length === 3, "Suche „diode“ → Diode, LED, Z-Diode");
  await page.fill('[data-s="q"]', "");
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, "elektro-symbols-390-dark.png"), fullPage: true });
  await ctx.close();

  // PC hell + Direkt-Sprung (Suche)
  ({ ctx, page } = await mk("light", 1440, 900));
  await page.evaluate(() => { location.hash = "#alltag/elektro?tab=lexikon&q=" + encodeURIComponent("Schütz"); });
  await page.waitForSelector(".el-lx");
  ok(await page.inputValue('[data-l="q"]') === "Schütz", "Direkt-Sprung: Suchbegriff übernommen");
  ok((await page.textContent(".el-lx dt")).includes("Schütz"), "… Treffer oben");
  await page.screenshot({ path: path.join(OUT, "elektro-lexikon-1440-light.png") });
  await page.click('.el-tab[data-tab="zeichen"]');
  await page.screenshot({ path: path.join(OUT, "elektro-symbols-1440-light.png"), fullPage: true });
  // Universale Suche findet Lexikon-Begriff
  await page.keyboard.press("Escape");
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForTimeout(200);
  await page.evaluate(() => import("/js/views/search.js").then((m) => m.openSearch("Kurzschlussläufer")));
  await page.waitForSelector("#srch-q", { state: "visible" });
  await page.waitForTimeout(900);
  const hit = await page.$('.srch-row:has-text("Kurzschlussläufer")');
  ok(!!hit, "Universale Suche findet Lexikon-Begriff");
  await hit.click();
  await page.waitForSelector(".el-lx");
  ok(await page.inputValue('[data-l="q"]') === "Kurzschlussläufer", "… und springt ins Lexikon");
  await ctx.close();
  await browser.close();
  if (errors.length) { console.error("Konsolenfehler:\n" + errors.join("\n")); process.exit(1); }
  console.log("Alles gut ✔");
})().catch((e) => { console.error(e); process.exit(1); });
