// Playwright-Test für Alltag › 🧠 Notizbuch + 🤖 „Was Claude sich merkt“ + 🆘 Notfallkarte (Update 10 C) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8985 &   then   node tests/notizen-e2e.cjs [screenshot-dir]
// Notizen: anlegen, sichere Darstellung (kein HTML, nur https-Links), [[Titel]] → neue Notiz anlegen → Link + Rückverweis,
// Favorit/Anpinnen, Schlagwort-/Sammlungsfilter, Volltextsuche, Deep-Link, Diktat (simulierte Spracherkennung), globale Suche.
// Gedächtnis: merken, Geheimnis wird abgelehnt, Bereich sperren/freigeben, bearbeiten/löschen.
// Notfallkarte: leer, ausfüllen, tel:-Link, Claude-Freigabe (Standard aus). Dunkel/PC.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8985/";
const OUT = process.argv[2] || require("os").tmpdir();

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true });
  await ctx.route("**/*", (route) => { const u = new URL(route.request().url()); return (u.hostname === "localhost" || u.hostname === "127.0.0.1") ? route.continue() : route.abort(); });
  await ctx.addInitScript(() => {
    // simulierte Spracherkennung (Diktat)
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "diktierter Satz" }], { isFinal: true })] }), 50); setTimeout(() => this.onend && this.onend(), 120); }
      stop() { if (this.onend) setTimeout(() => this.onend(), 0); }
    };
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (/Content Security Policy|Refused to/.test(t)) errors.push("CSP: " + t);
    else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
  });
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("dialog", (d) => { errors.push("dialog: " + d.message()); d.dismiss(); });
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name) => { await page.waitForTimeout(350); return page.screenshot({ path: path.join(OUT, name), fullPage: true }); };
  const A = (n) => page.evaluate((n) => JSON.parse(localStorage.getItem("sk-a-" + n) || "[]"), n);
  const sheet = ".sheet:last-child";

  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], todos: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 } }));
  });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(300);

  /* ---------- Notizen ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="notizen"]');
  await page.click('.al-tile[data-id="notizen"]');
  await page.waitForSelector(".nb-empty");
  ok((await page.textContent(".nb-empty")).includes("Notizbuch ist noch leer"), "Leeres Notizbuch");
  await page.click('.nb-top [data-nb="new"]');
  await page.waitForSelector("#nb-f-title");
  await page.fill("#nb-f-title", "Werkstatt-Ideen");
  await page.fill("#nb-f-text", "# Plan\n**Wichtig:** Regal bauen\n- Holz kaufen\n- [x] Schrauben\nSiehe [[Materialliste]] und https://example.org/a?b=1&c=2.\n<img src=x onerror=alert(1)> [böse](javascript:alert(1))");
  await page.click(`${sheet} [data-dict]`);
  await page.waitForTimeout(400);
  const dv = await page.inputValue("#nb-f-text");
  ok(dv.endsWith("diktierter Satz"), "Diktat fügt Text ein");
  await page.fill("#nb-f-tags", "Werkstatt, #Holz");
  await page.fill("#nb-f-coll", "Projekte");
  await shot("notizen-editor-390-light.png");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".nb-art");
  let notes = await A("notes");
  const n1 = notes[0];
  ok(notes.length === 1 && n1.tags.join() === "Werkstatt,Holz" && n1.coll === "Projekte", "Notiz gespeichert (Schlagworte, Sammlung)");
  ok((await page.evaluate(() => location.hash)) === "#alltag/notizen/" + n1.id, "Detail-Route");
  const body = await page.innerHTML(".nb-body");
  ok(body.includes("<h3>Plan</h3>") && body.includes("<strong>Wichtig:</strong>") && body.includes("<li>☑️ Schrauben</li>"), "Markdown-light dargestellt");
  ok(!(await page.$(".nb-body img")) && !(await page.$('.nb-body a[href^="javascript"]')), "Kein HTML, keine javascript-Links");
  ok((await page.getAttribute('.nb-body a[target="_blank"]', "href")) === "https://example.org/a?b=1&c=2", "https-Link sicher verlinkt");
  // [[Materialliste]] → neue Notiz anlegen
  await page.click(".nb-wl-new");
  await page.waitForSelector("#nb-f-title");
  ok((await page.inputValue("#nb-f-title")) === "Materialliste", "Unbekannter [[Link]] → neue Notiz mit Titel");
  await page.fill("#nb-f-text", "3 m Kabel");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(400);
  notes = await A("notes");
  const n2 = notes.find((n) => n.title === "Materialliste");
  ok((await page.evaluate(() => location.hash)) === "#alltag/notizen/" + n2.id, "Neue Notiz geöffnet");
  ok((await page.textContent(".nb-back-links")).includes("Werkstatt-Ideen"), "Rückverweis „Verweist hierher“");
  await page.click(".nb-back-links a");
  await page.waitForFunction((id) => location.hash === "#alltag/notizen/" + id, n1.id);
  await page.waitForSelector(".nb-wl:not(.nb-wl-new)");
  await page.click(".nb-wl:not(.nb-wl-new)");
  await page.waitForFunction((id) => location.hash === "#alltag/notizen/" + id, n2.id);
  ok(true, "[[Link]] öffnet die verknüpfte Notiz");
  await page.click('[data-nb="pin"]');
  await page.click('[data-nb="fav"]');
  await page.waitForTimeout(300);
  notes = await A("notes");
  ok(notes.find((n) => n.id === n2.id).pinned && notes.find((n) => n.id === n2.id).fav, "Anpinnen + Favorit");
  await page.click(".nb-back");
  await page.waitForSelector(".nb-card");
  ok((await page.$$eval(".nb-card b", (l) => l.map((x) => x.textContent)))[0].includes("Materialliste"), "Angepinnt steht oben");
  await page.click('[data-tag="Holz"]');
  ok((await page.$$(".nb-card")).length === 1, "Schlagwort-Filter");
  await page.click('[data-f="alle"]');
  await page.click('[data-f="fav"]');
  ok((await page.$$(".nb-card")).length === 1, "Favoriten-Filter");
  await page.click('[data-f="alle"]');
  await page.fill("#nb-q", "regal");
  await page.waitForTimeout(150);
  ok((await page.$$(".nb-card")).length === 1 && (await page.textContent(".nb-card")).includes("Werkstatt"), "Volltextsuche");
  await page.fill("#nb-q", "");
  await shot("notizen-list-390-light.png");
  // Deep-Link
  await page.goto(BASE + "#alltag/notizen/" + n1.id);
  await page.reload();
  await page.waitForSelector(".nb-art");
  ok((await page.textContent(".nb-art h3")).includes("Werkstatt-Ideen"), "Deep-Link nach Neuladen");
  await shot("notizen-detail-390-light.png");

  /* ---------- Gedächtnis ---------- */
  await page.click('[data-tab="memory"]');
  await page.waitForSelector(".nb-mem-add");
  ok((await page.evaluate(() => location.hash)) === "#alltag/notizen", "Gedächtnis-Reiter");
  await page.fill("#nb-m-text", "Mein Passwort ist sonne123");
  await page.click('.nb-mem-add [type="submit"]');
  await page.waitForTimeout(250);
  ok((await A("ai_memory")).length === 0, "Passwort wird abgelehnt");
  await page.fill("#nb-m-text", "Ist im 2. Lehrjahr als Elektriker");
  await page.selectOption("#nb-m-area", "arbeit");
  await page.click('.nb-mem-add [type="submit"]');
  await page.waitForSelector('.nb-mem-g[data-area="arbeit"]');
  await page.fill("#nb-m-text", "Mag keinen Koriander");
  await page.selectOption("#nb-m-area", "vorlieben");
  await page.press("#nb-m-text", "Enter");
  await page.waitForSelector('.nb-mem-g[data-area="vorlieben"]');
  let mem = await A("ai_memory");
  ok(mem.length === 2 && mem.every((m) => m.allowed === true), "Zwei Fakten, standardmäßig freigegeben");
  await page.click('[data-marea="vorlieben"]');
  await page.waitForTimeout(300);
  mem = await A("ai_memory");
  ok(mem.find((m) => m.area === "vorlieben").allowed === false && mem.find((m) => m.area === "arbeit").allowed === true, "Bereich „Vorlieben“ für Claude gesperrt");
  ok((await page.textContent('.nb-mem-g[data-area="vorlieben"]')).includes("nicht freigegeben"), "Gesperrt sichtbar markiert");
  await page.fill("#nb-m-text", "Isst gern Pizza");
  await page.selectOption("#nb-m-area", "vorlieben");
  await page.click('.nb-mem-add [type="submit"]');
  await page.waitForTimeout(300);
  ok((await A("ai_memory")).find((m) => m.text === "Isst gern Pizza").allowed === false, "Neuer Fakt erbt die Sperre des Bereichs");
  await shot("notizen-memory-390-light.png");
  await page.click('.nb-mem-g[data-area="arbeit"] [data-medit]');
  await page.waitForSelector("#nb-me-text");
  await page.fill("#nb-me-text", "Ist im 3. Lehrjahr als Elektriker");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(300);
  ok((await A("ai_memory")).some((m) => m.text === "Ist im 3. Lehrjahr als Elektriker"), "Fakt bearbeitet");
  await page.click('.nb-mem-g[data-area="arbeit"] [data-medit]');
  await page.waitForSelector("#nb-me-text");
  await page.click(`${sheet} [data-del]`);
  await page.click(`${sheet} [data-del]`);
  await page.waitForTimeout(300);
  ok((await A("ai_memory")).length === 2, "Fakt gelöscht");

  /* ---------- globale Suche ---------- */
  await page.goto(BASE + "#heute");
  await page.waitForTimeout(300);
  await page.click("#btn-search");
  await page.fill("#srch-q", "kabel");
  await page.waitForTimeout(300);
  ok((await page.$$eval(".srch-group[data-group]", (l) => l.map((g) => g.dataset.group))).includes("notizen"), "Universale Suche findet Notizen");
  await page.click('.srch-group[data-group="notizen"] .srch-row');
  await page.waitForFunction((id) => location.hash === "#alltag/notizen/" + id, n2.id);
  await page.waitForSelector(".nb-art");
  ok(true, "Suchtreffer öffnet die Notiz");

  /* ---------- Notfallkarte ---------- */
  await page.goto(BASE + "#alltag/notfall");
  await page.waitForSelector(".nf-empty");
  ok((await page.textContent(".nf")).includes("Sperrbildschirm"), "Hinweis zum Sperrbildschirm");
  ok(!(await page.isChecked('input[data-nf="ai"]')), "Claude-Freigabe standardmäßig aus");
  await page.click('.nf-empty [data-nf="edit"]');
  await page.waitForSelector("#nf-blood");
  await page.selectOption("#nf-blood", "A+");
  await page.fill("#nf-all", "Testallergie");
  await page.fill("#nf-med", "Testmedikament 5 mg");
  await page.fill("#nf-ins", "Testkasse");
  await page.fill(`${sheet} .nf-kf[data-k="0"] [data-kn]`, "Erika Beispiel");
  await page.fill(`${sheet} .nf-kf[data-k="0"] [data-kr]`, "Mutter");
  await page.fill(`${sheet} .nf-kf[data-k="0"] [data-kp]`, "0043 1 234 567");
  await page.fill(`${sheet} .nf-kf[data-k="1"] [data-kp]`, "abc");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(200);
  ok(!!(await page.$("#nf-blood")), "Ungültige Telefonnummer wird nicht gespeichert");
  await page.fill(`${sheet} .nf-kf[data-k="1"] [data-kp]`, "");
  await page.click(`${sheet} [data-addk]`);
  ok((await page.$$(`${sheet} .nf-kf`)).length === 3, "Weiterer Kontakt");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".nf-card");
  const card = (await A("notfall"))[0];
  ok(card.id === "card" && card.blood === "A+" && card.contacts.length === 1 && card.claudeAllowed === false, "Notfallkarte gespeichert (ohne Freigabe)");
  ok((await page.getAttribute(".nf-call", "href")) === "tel:+431234567", "Anrufen-Link tel:");
  ok((await page.textContent(".nf-blood")).includes("A+") && (await page.textContent(".nf-warn")).includes("Testallergie"), "Karte zeigt Blutgruppe und Allergien");
  await page.click('input[data-nf="ai"]');
  await page.waitForTimeout(300);
  ok((await A("notfall"))[0].claudeAllowed === true, "Claude-Freigabe eingeschaltet");
  await shot("notfall-390-light.png");

  /* ---------- Backup-Liste ---------- */
  const inBackup = await page.evaluate(async () => { const m = await import("/js/backup-core.js"); return ["haushalt", "habits", "routines", "goals", "notes", "ai_memory", "notfall"].every((n) => m.ALLTAG.includes(n)); });
  ok(inBackup, "Alle neuen Sammlungen sind im Backup");

  /* ---------- dunkel + PC ---------- */
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("notfall-390-dark.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot("notfall-1440-dark.png");
  await page.goto(BASE + "#alltag/notizen/" + n1.id);
  await page.waitForSelector(".nb-art");
  await shot("notizen-detail-1440-dark.png");
  await page.click('[data-tab="memory"]');
  await page.waitForSelector(".nb-mem-g");
  await shot("notizen-memory-1440-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await page.click('[data-tab="notes"]');
  await page.waitForSelector(".nb-card");
  await shot("notizen-list-1440-light.png");
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "Kein waagrechtes Scrollen");

  ok(errors.length === 0, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("ALLE NOTIZEN-TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
