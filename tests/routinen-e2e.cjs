// Playwright-Test für Alltag › 🎯 Routinen & Ziele (Update 10 C) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8984 &   then   node tests/routinen-e2e.cjs [screenshot-dir]
// Gewohnheiten (anlegen täglich/wöchentlich/mehrmals, abhaken, Streak 🔥 aus vorhandenem Verlauf, Heatmap 8×7),
// Morgen-/Abendroutine (Vorschläge, abhaken, gestern Abgehaktes ist heute leer), Ziele (Meilensteine → %, manuell, erreicht),
// Dashboard, Suche, dunkel/PC.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8984/";
const OUT = process.argv[2] || require("os").tmpdir();
const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };
const inDays = (n) => daysAgo(-n);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true });
  await ctx.route("**/*", (route) => { const u = new URL(route.request().url()); return (u.hostname === "localhost" || u.hostname === "127.0.0.1") ? route.continue() : route.abort(); });
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
  const sheet = ".sheet:last-child";
  const T = key(new Date());

  await page.goto(BASE);
  await page.evaluate(({ d1, d2, d3 }) => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 } }));
    // vorhandene Gewohnheit mit 3 Tagen Serie (bis gestern)
    localStorage.setItem("sk-a-habits", JSON.stringify([{ id: "h0", title: "Lesen", emoji: "📖", freq: "daily", target: 1, log: { [d1]: 1, [d2]: 1, [d3]: 1 }, created: 1 }]));
  }, { d1: daysAgo(1), d2: daysAgo(2), d3: daysAgo(3) });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(300);

  /* ---------- Gewohnheiten ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="routinen"]');
  await page.click('.al-tile[data-id="routinen"]');
  await page.waitForSelector(".rt-habit");
  ok((await page.evaluate(() => location.hash)) === "#alltag/routinen", "Route #alltag/routinen");
  ok((await page.textContent(".rt-habit .rt-streak b")).trim() === "3", "Streak 🔥 3 (heute noch offen, Serie lebt)");
  ok((await page.$$(".rt-habit .rt-c")).length === 56, "Heatmap: 8 Wochen × 7 Tage");
  ok((await page.$$(".rt-habit .rt-c.l4")).length === 3, "Heatmap: 3 erledigte Tage");
  ok((await page.textContent(".rt-tab-n")).trim() === "1", "Reiter: 1 heute offen");
  await page.click('.rt-tap[data-id="h0"]');
  await page.waitForTimeout(300);
  ok((await page.textContent(".rt-habit .rt-streak b")).trim() === "4", "Abhaken → Streak 4");
  ok((await A("habits"))[0].log[T] === 1, "Log für heute gespeichert");
  ok((await page.$(".rt-habit.is-done")) && (await page.textContent(".rt-sub")).includes("alles geschafft"), "Alles geschafft 🎉");

  await page.click('[data-rt="habit-new"]');
  await page.waitForSelector("#rt-h-title");
  await page.fill("#rt-h-title", "Glas Wasser");
  await page.click(`${sheet} [data-emo="💧"]`);
  await page.fill("#rt-h-target", "3");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(300);
  await page.click('[data-rt="habit-new"]');
  await page.waitForSelector("#rt-h-title");
  await page.fill("#rt-h-title", "Sport");
  await page.click(`${sheet} [data-freq="weekly"]`);
  ok((await page.inputValue("#rt-h-target")) === "3", "Wöchentlich: Standard 3 Tage");
  await page.fill("#rt-h-target", "2");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(300);
  const hs = await A("habits");
  const water = hs.find((h) => h.title === "Glas Wasser"), sport = hs.find((h) => h.title === "Sport");
  ok(water && water.target === 3 && water.emoji === "💧" && sport && sport.freq === "weekly" && sport.target === 2, "Neue Gewohnheiten gespeichert");
  await page.click(`.rt-tap[data-id="${water.id}"]`);
  await page.waitForTimeout(200);
  await page.click(`.rt-tap[data-id="${water.id}"]`);
  await page.waitForTimeout(200);
  ok((await page.textContent(`.rt-tap[data-id="${water.id}"]`)).replace(/\s/g, "") === "2/3", "Mehrmals pro Tag: 2/3");
  await page.click(`.rt-tap[data-id="${sport.id}"]`);
  await page.waitForTimeout(250);
  ok((await page.textContent(".rt-habits")).includes("1/2 diese Woche"), "Wöchentlich: 1/2 diese Woche");
  await shot("routinen-habits-390-light.png");

  /* ---------- Routinen ---------- */
  await page.click('[data-tab="routines"]');
  await page.waitForSelector(".rt-rout");
  ok((await page.$$(".rt-rout")).length === 2, "Morgen- und Abendroutine");
  await page.click('[data-rt="rout-edit"][data-id="morgen"]');
  await page.waitForSelector("#rt-r-items");
  await page.click(`${sheet} [data-suggest]`);
  ok((await page.inputValue("#rt-r-items")).split("\n").length === 5, "Vorschläge eingefügt");
  await page.fill("#rt-r-items", "Zähne putzen\nBett machen");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector('.rt-rout input[data-r="morgen"]');
  const boxes = await page.$$('.rt-rout input[data-r="morgen"]');
  ok(boxes.length === 2, "Zwei Punkte in der Morgenroutine");
  await page.click('.rt-rout input[data-r="morgen"] >> nth=0');
  await page.waitForTimeout(250);
  ok((await page.textContent(".rt-rout")).includes("1/2 erledigt"), "1/2 erledigt");
  await page.click('.rt-rout input[data-r="morgen"] >> nth=1');
  await page.waitForTimeout(250);
  let r = (await A("routines")).find((x) => x.id === "morgen");
  ok(r.doneDay === T && r.doneIds.length === 2 && r.log[T] === 1, "Routine komplett: Tag geloggt");
  ok((await page.getAttribute(".rt-rout", "class")).includes("is-done"), "Routine als geschafft markiert");
  await shot("routinen-routines-390-light.png");
  // Tageswechsel simulieren: gestern abgehakt → heute leer
  await page.evaluate((y) => { const a = JSON.parse(localStorage.getItem("sk-a-routines")); a[0].doneDay = y; a[0].log = { [y]: 1 }; localStorage.setItem("sk-a-routines", JSON.stringify(a)); }, daysAgo(1));
  await page.reload();
  await page.waitForSelector('.rt-rout input[data-r="morgen"]');
  ok((await page.$$eval('.rt-rout input[data-r="morgen"]', (l) => l.filter((x) => x.checked).length)) === 0, "Neuer Tag: Routine wieder leer");
  ok((await page.textContent(".rt-rout")).includes("🔥 1 Tag"), "Routinen-Serie von gestern zählt");

  /* ---------- Ziele ---------- */
  await page.click('[data-tab="goals"]');
  await page.waitForSelector(".rt-empty");
  await page.click('.rt-empty [data-rt="goal-new"]');
  await page.waitForSelector("#rt-g-title");
  await page.fill("#rt-g-title", "Führerschein B");
  await page.click(`${sheet} [data-emo="🚗"]`);
  await page.fill("#rt-g-due", inDays(30));
  await page.fill("#rt-g-ms", "Theorie lernen\nFahrstunden\nPrüfung");
  ok(await page.$eval(`${sheet} [data-man]`, (x) => x.hidden), "Mit Meilensteinen kein manueller Regler");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".rt-goal");
  ok((await page.textContent(".rt-pct")).trim() === "0%", "Ziel 0 %");
  ok((await page.textContent(".rt-goal")).includes("noch 30 Tage"), "Frist: noch 30 Tage");
  await page.click(".rt-ms input >> nth=0");
  await page.waitForTimeout(300);
  ok((await page.textContent(".rt-pct")).trim() === "33%", "Meilenstein → 33 %");
  await page.click('[data-rt="goal-new"]');
  await page.waitForSelector("#rt-g-title");
  await page.fill("#rt-g-title", "Gitarre lernen");
  await page.$eval("#rt-g-prog", (x) => { x.value = "40"; x.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(300);
  ok((await page.$$eval(".rt-pct", (l) => l.map((x) => x.textContent.trim()))).includes("40%"), "Manueller Fortschritt 40 %");
  await shot("routinen-goals-390-light.png");
  const gs = await A("goals");
  const git = gs.find((g) => g.title === "Gitarre lernen");
  await page.click(`[data-rt="goal-edit"][data-id="${git.id}"]`);
  await page.waitForSelector("#rt-g-done");
  await page.check("#rt-g-done");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(300);
  ok((await A("goals")).find((g) => g.id === git.id).done === true, "Ziel als erreicht markiert");
  ok((await page.$$eval(".rt-goal", (l) => l.map((x) => x.className))).pop().includes("is-done"), "Erreichtes Ziel steht unten");

  /* ---------- Dashboard + Suche ---------- */
  await page.goto(BASE + "#heute");
  await page.waitForSelector('[data-w="haushalt"]', { timeout: 5000 });
  ok((await page.textContent('[data-w="haushalt"]')).includes("„Glas Wasser“ ist heute noch offen"), "Dashboard zeigt die offene Gewohnheit");
  await page.click("#btn-search");
  await page.fill("#srch-q", "führerschein");
  await page.waitForTimeout(300);
  ok((await page.$$eval(".srch-group[data-group]", (l) => l.map((g) => g.dataset.group))).includes("routinen"), "Suche findet das Ziel");
  await page.click('.srch-group[data-group="routinen"] .srch-row');
  await page.waitForFunction(() => location.hash === "#alltag/routinen");
  await page.waitForSelector(".rt-goal");
  ok((await page.getAttribute('[data-tab="goals"]', "aria-selected")) === "true", "Suchtreffer öffnet den Reiter Ziele");

  /* ---------- dunkel + PC ---------- */
  await page.click('[data-tab="habits"]');
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("routinen-habits-390-dark.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot("routinen-habits-1440-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await page.click('[data-tab="goals"]');
  await shot("routinen-goals-1440-light.png");
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "Kein waagrechtes Scrollen");

  ok(errors.length === 0, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("ALLE ROUTINEN-TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
