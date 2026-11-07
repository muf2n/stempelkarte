// Playwright-Test für 💾 Backup & Daten (Update 10) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8962 &   then   node tests/backup-e2e.cjs [screenshot-dir]
// Sichern (JSON, verschlüsselt), Inhalt ohne Tresor/Vorschaubilder, Wiederherstellen (Vorschau, Zusammenführen,
// Ersetzen mit Bestätigung + Sicherheitskopie), falsches Passwort, kaputte Datei, „Letztes Backup“, PC hell.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:8962/";
const OUT = process.argv[2] || require("os").tmpdir();
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "bk-"));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true, acceptDownloads: true });
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
  const shot = async (name) => { await page.waitForTimeout(350); return page.screenshot({ path: path.join(OUT, name), fullPage: false }); };
  const local = () => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}"));
  const download = async (click) => {
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), click()]);
    const p = path.join(TMP, d.suggestedFilename());
    await d.saveAs(p);
    return { name: d.suggestedFilename(), path: p, text: fs.readFileSync(p, "utf8") };
  };
  const openBackup = async () => {
    await page.click("#btn-settings");
    await page.waitForSelector("#settings-hub .sh-list", { state: "visible" });
    await page.click('.sh-row[data-cat="backup"]');
    await page.waitForSelector("#backup-panel #bk-save", { state: "visible" });
  };

  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [{ id: "e1", kind: "work", start: Date.now() - 86400000 * 2, end: Date.now() - 86400000 * 2 + 8 * 3600e3 }], places: [{ id: "p1", name: "Firma", lat: 48.2, lng: 16.3 }],
      days: { "2026-11-02": { note: "Tag" } }, running: null, rev: Date.now(),
      settings: { weeklyTarget: 38.5, backup: { lastManual: Date.now() - 20 * 86400000 } },
      todos: [{ id: "t1", kind: "todo", title: "Steuer machen", date: null, done: false, createdAt: 1 }],
    }));
    localStorage.setItem("sk-a-money_tx", JSON.stringify([{ id: "m1", amount: 12.5, type: "out", date: "2026-11-01", updated: 5 }]));
    localStorage.setItem("sk-a-photo_index", JSON.stringify([{ id: "ph1", thumb: "data:image/jpeg;base64,VORSCHAU", dayKey: "2026-11-01" }]));
    localStorage.setItem("sk-a-vault_items", JSON.stringify([{ id: "v1", ct: "TRESORGEHEIM" }]));
    localStorage.setItem("sk-a-vault_meta", JSON.stringify([{ id: "main", salt: "TRESORGEHEIM" }]));
  });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForSelector("#settings-hub", { state: "attached" });

  /* ---------- Status ---------- */
  await openBackup();
  ok((await page.textContent("#bk-last")).includes("vor 20 Tagen"), "„Letztes Backup: vor 20 Tagen“");
  ok(await page.$eval("#bk-status", (e) => e.classList.contains("warn")), "Älter als 14 Tage → Warnfarbe");
  ok((await page.textContent("#bk-auto")).includes("Google-Konto"), "Lokal: Hinweis zu automatischen Backups");
  await shot("backup-390-dark.png");

  /* ---------- Sichern (JSON) ---------- */
  const plain = await download(() => page.click("#bk-save"));
  ok(/^stempelkarte-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(plain.name), "Dateiname " + plain.name);
  const j = JSON.parse(plain.text);
  ok(j.format === "stempelkarte-backup" && j.v === 1, "Format stimmt");
  ok(j.collections.entries.length === 1 && j.collections.todos.length === 1 && j.collections.places.length === 1 && j.collections.days.length === 1, "Hauptdaten drin");
  ok(j.collections.a_money_tx[0].amount === 12.5, "Alltag-Daten drin");
  ok(j.collections.a_photo_index[0].dayKey === "2026-11-01" && !("thumb" in j.collections.a_photo_index[0]), "Foto-Index ohne Vorschaubild");
  ok(!plain.text.includes("TRESORGEHEIM") && !Object.keys(j.collections).some((k) => k.includes("vault")), "Tresor NICHT im Backup");
  ok(j.meta.settings.weeklyTarget === 38.5, "Einstellungen drin");
  await page.waitForFunction(() => document.getElementById("bk-last").textContent.startsWith("heute"));
  ok(!(await page.$eval("#bk-status", (e) => e.classList.contains("warn"))), "Nach dem Sichern: „heute“, keine Warnung");
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("stempelkarte.local.v1")).settings.backup || {}).lastManual > Date.now() - 60000);
  ok(true, "lastManual gespeichert");

  /* ---------- Sichern (verschlüsselt) ---------- */
  await page.click('label:has(#bk-enc)');
  ok(await page.isVisible("#bk-pw1"), "Passwortfelder erscheinen");
  await page.fill("#bk-pw1", "kurz");
  await page.fill("#bk-pw2", "kurz");
  await page.click("#bk-save");
  await page.waitForSelector(".toast, #toast", { state: "attached" }).catch(() => {});
  await page.fill("#bk-pw1", "Gutes Passwort 42");
  await page.fill("#bk-pw2", "Gutes Passwort 42");
  const enc = await download(() => page.click("#bk-save"));
  ok(enc.name.endsWith(".skbackup"), "Verschlüsselt → .skbackup");
  const ej = JSON.parse(enc.text);
  ok(ej.format === "stempelkarte-backup-enc" && ej.iter >= 310000 && ej.kdf === "PBKDF2-SHA256", "AES-GCM + PBKDF2 ≥ 310k (" + ej.iter + ")");
  ok(!enc.text.includes("Steuer") && !enc.text.includes("Firma"), "Kein Klartext in der verschlüsselten Datei");
  await page.click('label:has(#bk-enc)');

  /* ---------- Kaputte Datei ---------- */
  const bad = path.join(TMP, "kaputt.json");
  fs.writeFileSync(bad, JSON.stringify({ format: "stempelkarte-backup", v: 1, created: Date.now(), collections: { entries: [{ start: 1 }] } }));
  await page.setInputFiles("#bk-file", bad);
  await page.waitForFunction(() => /keine gültige ID/.test(document.body.textContent));
  ok(!(await page.$("#sheet-root .sheet")), "Kaputte Datei → Hinweis, keine Vorschau");

  /* ---------- Zusammenführen ---------- */
  await page.waitForTimeout(600); // entprelltes Speichern der App abwarten
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
    d.todos = [{ id: "t2", kind: "todo", title: "Neu nach dem Backup", done: false, createdAt: Date.now() }];
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d));
  });
  await page.reload();
  await page.waitForSelector("#settings-hub", { state: "attached" });
  await openBackup();
  await page.setInputFiles("#bk-file", plain.path);
  await page.waitForSelector("#sheet-root .bk-secs", { state: "visible" });
  const secs = await page.textContent("#sheet-root .bk-secs");
  ok(/Arbeitszeit-Einträge\s*2/.test(secs) && /Planer[^0-9]*1/.test(secs) && /Geld[^0-9]*1/.test(secs), "Vorschau mit Anzahl je Bereich");
  await shot("backup-preview-390-dark.png");
  await Promise.all([page.waitForEvent("load"), page.click("#bk-apply")]);
  await page.waitForSelector("#btn-local, #tabbar:not([hidden])", { state: "attached" });
  let d = await local();
  ok(d.todos.map((t) => t.id).sort().join() === "t1,t2", "Zusammenführen: altes zurück, neues bleibt");
  ok(JSON.parse(await page.evaluate(() => localStorage.getItem("sk-a-vault_items")))[0].ct === "TRESORGEHEIM", "Tresor unberührt");
  ok(JSON.parse(await page.evaluate(() => localStorage.getItem("sk-a-photo_index")))[0].thumb.includes("VORSCHAU"), "Vorschaubild bleibt erhalten");

  /* ---------- Ersetzen (verschlüsselt, mit Sicherheitskopie) ---------- */
  if (await page.isVisible("#btn-local")) await page.click("#btn-local");
  await page.waitForSelector("#settings-hub", { state: "attached" });
  await openBackup();
  await page.setInputFiles("#bk-file", enc.path);
  await page.waitForSelector("#bkx-pw", { state: "visible" });
  await page.fill("#bkx-pw", "falsch falsch");
  await page.click("#bkx-open");
  await page.waitForSelector(".bkx-err:not([hidden])");
  ok((await page.textContent(".bkx-err")).includes("Falsches Passwort"), "Falsches Passwort → Hinweis");
  await page.fill("#bkx-pw", "Gutes Passwort 42");
  await page.click("#bkx-open");
  await page.waitForSelector("#sheet-root .bk-secs", { state: "visible" });
  await page.click('label.bk-mode:has(input[value="replace"])');
  ok(await page.isVisible(".bk-confirm") && await page.$eval("#bk-apply", (b) => b.disabled), "Ersetzen: erst bestätigen (Knopf gesperrt)");
  await page.click('label:has(#bk-sure)');
  ok(!(await page.$eval("#bk-apply", (b) => b.disabled)), "Nach Häkchen freigegeben");
  await shot("backup-replace-390-dark.png");
  const [safety] = await Promise.all([page.waitForEvent("download"), page.waitForEvent("load"), page.click("#bk-apply")]);
  ok(/\.json$/.test(safety.suggestedFilename()), "Sicherheitskopie wird vorher heruntergeladen");
  const sp = path.join(TMP, "safety.json"); await safety.saveAs(sp);
  ok(JSON.parse(fs.readFileSync(sp, "utf8")).source === "safety" && JSON.parse(fs.readFileSync(sp, "utf8")).collections.todos.length === 2, "Sicherheitskopie enthält den Stand davor");
  await page.waitForSelector("#btn-local, #tabbar:not([hidden])", { state: "attached" });
  d = await local();
  ok(d.todos.map((t) => t.id).join() === "t1", "Ersetzen: Stand genau wie im Backup");
  ok(JSON.parse(await page.evaluate(() => localStorage.getItem("sk-a-vault_meta")))[0].salt === "TRESORGEHEIM", "Tresor auch beim Ersetzen unberührt");

  /* ---------- PC, hell ---------- */
  if (await page.isVisible("#btn-local")) await page.click("#btn-local");
  await page.waitForSelector("#settings-hub", { state: "attached" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "backup" } })));
  await page.waitForSelector("#backup-panel #bk-save", { state: "visible" });
  ok((await page.textContent('[data-val="backup"]')) === "heute", "Wert rechts in der Liste: „heute“");
  await shot("backup-1440-light.png");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "kein waagrechtes Scrollen");

  ok(!errors.length, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
