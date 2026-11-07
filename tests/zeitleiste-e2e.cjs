// Playwright-Test für Alltag › 🕰️ Zeitleiste (Update 10, Phase D) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8976 &   then   node tests/zeitleiste-e2e.cjs [screenshot-dir]
// Echte Ereignisse aus Arbeit, Schule, Terminen, Baustellen-Tagebuch, Fotos (Vorschaubilder), erledigten Aufgaben, Reisen,
// Freizeit; Tagesüberschriften, Filter-Chips, Nachladen Monat für Monat beim Scrollen, Tipp → Eintrag/Fotos/Baustelle, 1440 dunkel.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8976/";
const OUT = process.argv[2] || require("os").tmpdir();

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  async function newPage(scheme, width, height) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800 });
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
    return page;
  }
  const page = await newPage("light", 390, 844);
  const shot = async (name, p = page, full = true) => { await p.waitForTimeout(350); return p.screenshot({ path: path.join(OUT, name), fullPage: full }); };

  const now = new Date();
  const at = (dDays, h, m = 0) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dDays, h, m); return d.getTime(); };
  const key = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  // Schicht heute in der Vergangenheit (vor „jetzt“)
  const workStart = Math.min(at(0, 6), Date.now() - 3 * 3600e3), workEnd = workStart + 2 * 3600e3;
  const old = new Date(now.getFullYear(), now.getMonth() - 3, 10, 7).getTime(); // vor 3 Monaten
  const oldEnd = old + 8 * 3600e3;

  await page.goto(BASE);
  await page.evaluate((d) => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      places: [{ id: "p1", name: "Baustelle Muster", addr: "Musterweg 1", lat: 47, lng: 15, radius: 150 }], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 },
      entries: [
        { id: "w1", kind: "work", start: d.workStart, end: d.workEnd, pauseMin: 0, placeId: "p1", place: "Baustelle Muster" },
        { id: "w0", kind: "work", start: d.old, end: d.oldEnd, pauseMin: 30, place: "Werkstatt" },
        { id: "s1", kind: "schule", start: d.y8, end: d.y8 + 8 * 3600e3 },
      ],
      todos: [
        { id: "t1", kind: "todo", title: "Rechnung zahlen", date: d.yKey, done: true, doneAt: d.y18, createdAt: 1 },
        { id: "t2", kind: "termin", title: "Zahnarzt", date: d.yKey, time: "10:00", done: false, createdAt: 2 },
        { id: "t3", kind: "todo", title: "Offen", date: d.yKey, done: false, createdAt: 3 },
      ],
    }));
    localStorage.setItem("sk-a-site_log", JSON.stringify([{ id: "l1", placeId: "p1", ts: d.workStart + 3600e3, text: "Verteiler gesetzt und beschriftet" }]));
    localStorage.setItem("sk-a-freizeit", JSON.stringify([{ id: "z1", kind: "laufen", label: "Laufen", emoji: "🏃", cat: "sport", start: d.y18 + 3600e3, end: d.y18 + 3600e3 + 45 * 60e3 }]));
    localStorage.setItem("sk-a-travel_trips", JSON.stringify([{ id: "r1", title: "Split", dest: "Kroatien", from: d.oldKey, to: d.oldKey, emoji: "✈️" }]));
    localStorage.setItem("sk-a-school_exams", JSON.stringify([{ id: "x1", kind: "Schularbeit", subject: "Mathe", date: d.yKey, grade: "2" }]));
  }, { workStart, workEnd, old, oldEnd, oldKey: key(old), y8: at(-1, 8), y18: at(-1, 18), yKey: key(at(-1, 12)) });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(300);
  // 3 Fotos (heute, 2 an der Baustelle, 1 woanders)
  await page.evaluate(async (ts) => {
    const ph = await import("/js/photos.js");
    const mk = (color) => { const c = document.createElement("canvas"); c.width = 64; c.height = 48; const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, 64, 48); return c.toDataURL("image/jpeg", 0.8); };
    for (const [i, color, place] of [[0, "#e11d48", "Baustelle Muster"], [1, "#2563eb", "Baustelle Muster"], [2, "#16a34a", ""]]) {
      const d = mk(color);
      await ph.addPhoto(null, { processed: { data: d, thumb: d, w: 64, h: 48 }, ts: ts + i * 600e3, placeId: place ? "p1" : null, place, addr: place ? "" : "Hauptplatz 1, Graz" });
    }
  }, workStart + 1800e3);

  /* ---------- Kachel + Feed ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="zeitleiste"]');
  await page.click('.al-tile[data-id="zeitleiste"]');
  await page.waitForSelector(".tl-item");
  ok((await page.evaluate(() => location.hash)) === "#alltag/zeitleiste", "Route #alltag/zeitleiste");
  const heads = await page.$$eval(".tl-dh", (x) => x.map((h) => h.textContent));
  ok(heads[0] === "Heute" && heads.includes("Gestern"), "Tagesüberschriften „Heute“, „Gestern“");
  const titles = await page.$$eval(".tl-item b", (x) => x.map((b) => b.textContent));
  for (const want of ["Arbeit · Baustelle Muster", "2 Fotos · Baustelle Muster", "1 Foto · Hauptplatz 1", "Baustelle Muster", "Rechnung zahlen", "Zahnarzt", "Laufen", "Berufsschule", "Schularbeit Mathe"]) ok(titles.includes(want), `Eintrag „${want}“`);
  ok(!titles.includes("Offen"), "Offene Aufgaben erscheinen nicht (nur Erledigtes)");
  ok((await page.$$eval(".tl-fotos .tl-thumbs img", (x) => x.length)) === 3, "Vorschaubilder aus dem Foto-Index");
  const first = await page.$$eval(".tl-month:first-of-type .tl-day:first-of-type .tl-item b", (x) => x.map((b) => b.textContent));
  ok(first.length >= 3, "Heute: mehrere Einträge, neueste zuerst");
  await shot("zeitleiste-390-light.png");

  /* ---------- Filter ---------- */
  await page.click('.tl-chip[data-cat="fotos"]');
  await page.waitForFunction(() => [...document.querySelectorAll(".tl-item")].every((b) => b.classList.contains("tl-fotos")));
  ok((await page.$$eval(".tl-item", (x) => x.length)) === 2, "Filter „📸 Fotos“ zeigt nur Fotos");
  ok(await page.$eval('.tl-chip[data-cat="fotos"]', (b) => b.getAttribute("aria-pressed") === "true"), "Chip gedrückt");
  await page.click('.tl-chip[data-cat="arbeit"]');
  await page.waitForFunction(() => document.querySelectorAll(".tl-arbeit").length >= 1);
  ok((await page.$$eval(".tl-item", (x) => x.map((b) => b.className))).every((c) => /tl-(fotos|arbeit)/.test(c)), "Mehrere Kategorien kombinierbar");
  await page.click('.tl-chip[data-cat=""]');
  await page.waitForFunction(() => document.querySelectorAll(".tl-schule").length >= 1);
  ok(true, "„✨ Alles“ setzt den Filter zurück");

  /* ---------- Nachladen beim Scrollen ---------- */
  ok((await page.$$eval(".tl-mh", (x) => x.length)) >= 1, "Monatsüberschrift");
  for (let i = 0; i < 6 && !(await page.$(".tl-end")); i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
  }
  await page.waitForSelector(".tl-end");
  const months = await page.$$eval(".tl-mh", (x) => x.map((h) => h.textContent));
  ok(months.length >= 2, "Ältere Monate nachgeladen: " + months.join(", "));
  const allTitles = await page.$$eval(".tl-item b", (x) => x.map((b) => b.textContent));
  ok(allTitles.includes("Arbeit · Werkstatt") && allTitles.includes("Split"), "Schicht & Reise von vor 3 Monaten erscheinen");
  ok((await page.textContent(".tl-end")).includes("Das war's"), "Ende-Hinweis");
  await page.evaluate(() => window.scrollTo(0, 0));

  /* ---------- Tippen ---------- */
  await page.click('.tl-item[data-item="e:w1"]');
  await page.waitForSelector(".sheet .box");
  ok(true, "Tipp auf Schicht öffnet den Eintrag");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".sheet", { state: "detached" });
  await page.click(".tl-fotos >> nth=0");
  await page.waitForSelector(".ph-view img[src^='data:']");
  ok(true, "Tipp auf Fotos öffnet das Vollbild");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".ph-view", { state: "detached" });
  await page.click('.tl-item[data-item="l:l1"]');
  await page.waitForFunction(() => location.hash === "#orte/baustelle/p1");
  ok(true, "Tipp auf Tagebuch-Eintrag öffnet die Baustelle");

  /* ---------- 1440 dunkel ---------- */
  const big = await newPage("dark", 1440, 900);
  await big.goto(BASE);
  await big.evaluate((d) => { for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); }, await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))));
  await big.reload();
  const lb = await big.$("#btn-local");
  if (lb && await lb.isVisible()) await lb.click();
  await big.goto(BASE + "#alltag/zeitleiste");
  await big.waitForSelector(".tl-item");
  await shot("zeitleiste-1440-dark.png", big, false);

  ok(errors.length === 0, "keine Konsolen-Fehler / CSP-Verstöße" + (errors.length ? ":\n  " + errors.join("\n  ") : ""));
  await browser.close();
  console.log("\nAlle Zeitleiste-Tests bestanden ✔");
})().catch((e) => { console.error(e); process.exit(1); });
