// Playwright-Test für die 📸 Galerie-Extras (Update 10, Phase D) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8977 &   then   node tests/galerie-extras-e2e.cjs [screenshot-dir]
// ⭐ Favorit (Filter + Abzeichen), Schlagwörter (hinzufügen/entfernen, Filter, Suche), ⬅️ Vorher / ➡️ Nachher im Vollbild,
// „🤖 Bild beschreiben“ über /chat (gestubbt, Test-Haken window.__skAiTest) – Notiz erst nach Bestätigung,
// Duplikat-Prüfung (gleiche Zeit+Maße bzw. gleicher Fingerabdruck) mit zweistufigem Löschen.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8977/";
const OUT = process.argv[2] || require("os").tmpdir();

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const chatBodies = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  async function newPage(scheme, width, height) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800 });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.addInitScript(() => { window.__skAiTest = { token: "test", url: location.origin }; });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (/Content Security Policy|Refused to/.test(t)) errors.push("CSP: " + t);
      else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.route("**/chat", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      chatBodies.push(body);
      await new Promise((r) => setTimeout(r, 150));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "**Unterverteiler** mit beschrifteten Sicherungen im Keller.", actions: [], usage: null }) });
    });
    return page;
  }
  const page = await newPage("light", 390, 844);
  const shot = async (name, p = page, full = true) => { await p.waitForTimeout(350); return p.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const idx = () => page.evaluate(async () => (await import("/js/photos.js")).listIndex({ refresh: true }));
  const full = (id) => page.evaluate(async (id) => { const p = await (await import("/js/photos.js")).getPhoto(id); return { note: p.note, phase: p.phase, fav: p.fav, tags: p.tags }; }, id);

  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 } }));
  });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(300);
  const t0 = Date.now() - 5 * 3600e3;
  await page.evaluate(async (t0) => {
    const ph = await import("/js/photos.js");
    const mk = (draw) => { const c = document.createElement("canvas"); c.width = 64; c.height = 48; const g = c.getContext("2d"); draw(g); return c.toDataURL("image/jpeg", 0.9); };
    const stripes = mk((g) => { for (let x = 0; x < 64; x += 8) { g.fillStyle = x % 16 ? "#111" : "#eee"; g.fillRect(x, 0, 8, 48); } });
    const grad = mk((g) => { const gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, "#000"); gr.addColorStop(1, "#fff"); g.fillStyle = gr; g.fillRect(0, 0, 64, 48); });
    const spot = mk((g) => { g.fillStyle = "#fff"; g.fillRect(0, 0, 64, 48); g.fillStyle = "#000"; g.fillRect(20, 10, 20, 20); });
    const add = (d, ts, w = 64, h = 48) => ph.addPhoto(null, { processed: { data: d, thumb: d, w, h }, ts, addr: "Musterweg 1, Graz" });
    await add(stripes, t0);              // A
    await add(stripes, t0 + 1000);       // B: Serienbild 1 s später, gleiche Maße → Duplikat von A
    await add(grad, t0 + 3600e3);        // C
    await add(grad, t0 + 7200e3);        // D: gleiches Bild 1 h später → Duplikat über den Fingerabdruck
    await add(spot, t0 + 9000e3);        // E: anderes Bild
  }, t0);

  await page.goto(BASE + "#alltag/galerie");
  await page.waitForSelector(".gl-tab");
  await page.click('.gl-tab[data-tab="alle"]');
  await page.waitForSelector(".gl-th");
  ok((await page.$$eval(".gl-th", (x) => x.length)) === 5, "5 Fotos in „Alle Fotos“");
  ok(!!(await page.$('[data-xf]')) && !!(await page.$('[data-g="dups"]')), "Chips „⭐ Favoriten“ und „🧹 Duplikate prüfen“");

  /* ---------- Vollbild: ⭐, Schlagwörter, Vorher/Nachher ---------- */
  await page.click(".gl-th >> nth=0"); // neuestes = E
  await page.waitForSelector(".ph-view .gx");
  const idE = (await idx()).sort((a, b) => b.ts - a.ts)[0].id;
  await page.click('.gx [data-gx="fav"]');
  await page.waitForFunction(() => document.querySelector('.gx [data-gx="fav"]').getAttribute("aria-pressed") === "true");
  ok((await full(idE)).fav === true && (await idx()).find((x) => x.id === idE).fav === true, "⭐ Favorit gespeichert (Foto + Index)");
  await page.fill('.gx [data-gx="tagin"]', "Keller, #Verteiler");
  await page.press('.gx [data-gx="tagin"]', "Enter");
  await page.waitForFunction(() => document.querySelectorAll(".gx-tag").length === 2);
  ok(JSON.stringify((await full(idE)).tags) === JSON.stringify(["Keller", "Verteiler"]), "Schlagwörter „Keller“, „Verteiler“");
  await page.click('.gx-tag:has-text("Verteiler") button');
  await page.waitForFunction(() => document.querySelectorAll(".gx-tag").length === 1);
  ok(JSON.stringify((await full(idE)).tags) === JSON.stringify(["Keller"]), "Schlagwort entfernt");
  await page.click('.gx [data-gx="ph"][data-v="vorher"]');
  await page.waitForFunction(() => document.querySelector('.gx [data-v="vorher"]').getAttribute("aria-pressed") === "true");
  ok((await full(idE)).phase === "vorher", "⬅️ Vorher markiert");
  await page.click('.gx [data-gx="ph"][data-v="nachher"]');
  await page.waitForFunction(() => document.querySelector('.gx [data-v="nachher"]').getAttribute("aria-pressed") === "true");
  ok((await full(idE)).phase === "nachher", "➡️ Nachher umgeschaltet");

  /* ---------- 🤖 Bild beschreiben ---------- */
  await page.click('.gx [data-gx="ai"]');
  await page.waitForSelector(".gx-ai-t");
  const body = chatBodies.at(-1);
  ok(body && body.image && /^image\/jpeg$/.test(body.image.type) && body.image.data.length > 100 && !body.image.data.startsWith("data:") && body.mode === "lehrer", "/chat mit Bild (ohne Werkzeuge)");
  ok((await page.textContent(".gx-ai-t")) === "Unterverteiler mit beschrifteten Sicherungen im Keller.", "Beschreibung angezeigt (ohne Markdown)");
  ok((await full(idE)).note === "", "Notiz bleibt leer bis zur Bestätigung");
  await shot("galerie-extras-viewer-390.png", page, false);
  await page.click('.gx-aibox [data-ai="set"]');
  await page.waitForFunction(() => document.querySelector('.ph-view [data-v="note"]').value.startsWith("Unterverteiler"));
  ok((await full(idE)).note === "Unterverteiler mit beschrifteten Sicherungen im Keller.", "Nach Bestätigung als Notiz gespeichert");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".ph-view", { state: "detached" });

  /* ---------- Filter ---------- */
  await page.waitForSelector(".gl-th-fav");
  ok((await page.$$eval(".gl-th-fav", (x) => x.length)) === 1, "⭐ Abzeichen auf der Kachel");
  await page.click("[data-xf]");
  await page.waitForFunction(() => document.querySelectorAll(".gl-th").length === 1);
  ok(true, "Filter „⭐ Favoriten“ → 1 Foto");
  await page.click("[data-xf]");
  await page.click('[data-xt="Keller"]');
  await page.waitForFunction(() => document.querySelectorAll(".gl-th").length === 1);
  ok(true, "Filter „#Keller“ → 1 Foto");
  await page.click('[data-xt="Keller"]');
  await page.waitForFunction(() => document.querySelectorAll(".gl-th").length === 5);
  await page.fill('[data-g="q"]', "#keller");
  await page.waitForFunction(() => document.querySelectorAll(".gl-th").length === 1);
  ok(true, "Suche nach „#keller“ findet das Foto (Schlagwort als Suchquelle)");
  await page.fill('[data-g="q"]', "");
  await page.waitForFunction(() => document.querySelectorAll(".gl-th").length === 5);
  await shot("galerie-extras-grid-390-light.png");

  /* ---------- Duplikate ---------- */
  await page.click('[data-g="dups"]');
  await page.waitForSelector(".gx-group");
  ok((await page.$$eval(".gx-group", (x) => x.length)) === 2, "2 Duplikat-Gruppen (Serienbild + gleiches Bild)");
  ok((await page.$$eval(".gx-gth.del", (x) => x.length)) === 2, "je Gruppe 1 Kopie zum Löschen vorgeschlagen");
  await shot("galerie-extras-dups-390-light.png", page, false);
  // umschalten: letzte behaltene Kopie kann nicht weg
  const keepBtn = await page.$(".gx-group:first-child .gx-gth:not(.del)");
  await keepBtn.click();
  ok((await page.$$eval(".gx-gth.del", (x) => x.length)) === 2, "Mindestens ein Foto pro Gruppe bleibt");
  const delBtn = '.gx-dup [data-dx="del"]';
  ok((await page.textContent(delBtn)).includes("2 Fotos löschen"), "Knopf „🗑️ 2 Fotos löschen“");
  await page.click(delBtn);
  ok((await page.textContent(delBtn)).includes("Wirklich"), "Löschen fragt nach");
  await page.click(delBtn);
  await page.waitForSelector(".gx-dup", { state: "detached" });
  await page.waitForFunction(() => document.querySelectorAll(".gl-th").length === 3);
  ok((await idx()).length === 3, "Duplikate gelöscht (3 Fotos übrig)");
  await page.click('[data-g="dups"]');
  await page.waitForSelector(".gx-dup-none");
  ok(true, "Danach: „Keine Duplikate gefunden“");
  await page.keyboard.press("Escape");

  /* ---------- 1440 dunkel ---------- */
  const big = await newPage("dark", 1440, 900);
  await big.goto(BASE);
  await big.evaluate((d) => { for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); }, await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))));
  await big.reload();
  const lb = await big.$("#btn-local");
  if (lb && await lb.isVisible()) await lb.click();
  await big.evaluate(async () => {
    const ph = await import("/js/photos.js");
    const c = document.createElement("canvas"); c.width = 64; c.height = 48; const g = c.getContext("2d"); g.fillStyle = "#0ea5e9"; g.fillRect(0, 0, 64, 48);
    const d = c.toDataURL("image/jpeg", 0.9);
    const { photo } = await ph.addPhoto(null, { processed: { data: d, thumb: d, w: 64, h: 48 }, ts: Date.now() - 60000 });
    await ph.updatePhoto(photo.id, { fav: true, tags: ["Bad", "Fertig"], phase: "nachher" });
  });
  await big.goto(BASE + "#alltag/galerie");
  await big.waitForSelector(".gl-th");
  await shot("galerie-extras-grid-1440-dark.png", big, false);
  await big.click(".gl-th >> nth=0");
  await big.waitForSelector(".ph-view .gx-tag");
  await shot("galerie-extras-viewer-1440-dark.png", big, false);

  ok(errors.length === 0, "keine Konsolen-Fehler / CSP-Verstöße" + (errors.length ? ":\n  " + errors.join("\n  ") : ""));
  await browser.close();
  console.log("\nAlle Galerie-Extras-Tests bestanden ✔");
})().catch((e) => { console.error(e); process.exit(1); });
