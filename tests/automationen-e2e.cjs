// Playwright-Test für Alltag › ⚡ Automationen (Update 10, Phase D) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8975 &   then   node tests/automationen-e2e.cjs [screenshot-dir]
// Kachel + Route, Vorlagen (ein Tipp), Material → Einkaufsliste „Baustelle“ (echte Ausführung, Verlauf ✅), eigene Regel im Editor
// (WENN Arbeitsbeginn, NUR Wochentage, DANN Hinweis + Aufgabe), Einstempeln → Hinweis in der 🔔 Mitteilungen + Aufgabe angelegt,
// Duplikat-Schutz (auch nach Neuladen), Tippen auf den Hinweis öffnet die Baustelle, Aus/Ein, Bearbeiten, Duplizieren,
// Löschen (zweistufig), Fehleranzeige, Link aus den Einstellungen, globale Suche, 1440 dunkel.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8975/";
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
    page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return page;
  }
  const page = await newPage("light", 390, 844);
  const shot = async (name, p = page) => { await p.waitForTimeout(350); return p.screenshot({ path: path.join(OUT, name), fullPage: true }); };
  const A = (n) => page.evaluate((n) => JSON.parse(localStorage.getItem("sk-a-" + n) || "[]"), n);
  const S = () => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}"));
  const sheet = ".sheet:last-child";

  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [{ id: "p1", name: "Baustelle Muster", addr: "Musterweg 1", lat: 47, lng: 15, radius: 150 }], todos: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 } }));
  });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(300);

  /* ---------- Kachel, leer → Vorlagen ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="automationen"]');
  ok((await page.textContent('.al-tile[data-id="automationen"]')).includes("Automationen"), "Kachel „⚡ Automationen“");
  await page.click('.al-tile[data-id="automationen"]');
  await page.waitForSelector(".au-tpl");
  ok((await page.evaluate(() => location.hash)) === "#alltag/automationen", "Route #alltag/automationen");
  ok(await page.$eval('.au-tab[data-tab="vorlagen"]', (b) => b.getAttribute("aria-selected") === "true"), "Ohne Regeln startet der Reiter „Vorlagen“");
  const nTpl = await page.$$eval(".au-tpl", (x) => x.length);
  ok(nTpl >= 4 && nTpl <= 6, `${nTpl} fertige Vorlagen`);
  await shot("automationen-vorlagen-390-light.png");

  /* ---------- Vorlage Material → Einkaufsliste: echte Ausführung ---------- */
  await page.click('[data-tpl="material"]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sk-a-automations") || "[]").length === 1);
  let rules = await A("automations");
  ok(rules[0].enabled && rules[0].tpl === "material" && rules[0].trigger.type === "material" && rules[0].actions[0].type === "einkauf", "Vorlage als aktive Regel gespeichert");
  await page.waitForSelector('[data-tpl="material"]', { state: "detached" });
  ok((await page.textContent(".au-tpl:nth-child(2)")).includes("Aktiv"), "Vorlage zeigt „✔️ Aktiv“");
  await page.waitForTimeout(150);
  await page.evaluate(async () => {
    const db = await import("/js/alltag/db.js");
    await db.collection("material_items").put({ name: "NYM-J 3x1,5", qty: 50, unit: "m", status: "brauche", placeId: "p1", place: "Baustelle Muster" });
    await db.collection("material_items").put({ name: "Abzweigdose", qty: 4, unit: "Stk", status: "verbaut" });
  });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sk-a-einkauf") || "[]").length === 1, null, { timeout: 8000 });
  const ek = await A("einkauf");
  ok(ek[0].listId === "baustelle" && ek[0].name === "NYM-J 3x1,5" && ek[0].qty === 50 && ek[0].unit === "m", "Fehlendes Material → Einkaufsliste „Baustelle“ (nur „brauche“)");
  let logs = await A("automation_log");
  ok(logs.length === 1 && logs[0].ok && /Baustelle/.test(logs[0].done[0]), "Verlauf: ✅ mit Beschreibung");
  // gleiches Material nochmal geändert → läuft nicht doppelt
  await page.evaluate(async () => { const db = await import("/js/alltag/db.js"); const m = db.collection("material_items").all().find((x) => x.status === "brauche"); await db.collection("material_items").patch(m.id, { qty: 60 }); window.dispatchEvent(new Event("sk:automation-check")); });
  await page.waitForTimeout(1200);
  ok((await A("einkauf")).length === 1 && (await A("automation_log")).length === 1, "Duplikat-Schutz: gleicher Anlass läuft nicht nochmal");

  /* ---------- Eigene Regel im Editor ---------- */
  await page.click('.au-tab[data-tab="regeln"]');
  await page.waitForSelector(".au-rule");
  await page.click('[data-au="new"]');
  await page.waitForSelector(`${sheet} #au-trigger`);
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(`${sheet} [data-errs]:not([hidden])`);
  ok((await page.textContent(`${sheet} [data-errs]`)).includes("Text"), "Validierung: Hinweis ohne Text wird nicht gespeichert");
  await page.fill(`${sheet} [data-f="name"]`, "Guten Morgen Baustelle");
  await page.selectOption(`${sheet} #au-trigger`, "clock_in");
  await page.fill(`${sheet} [data-f="a.0.text"]`, "Servus auf {ort}! 👷");
  await page.selectOption(`${sheet} [data-addc]`, "weekday");
  await page.waitForSelector(`${sheet} [data-cwd="0"]`);
  // alle Wochentage einschalten (Sa + So dazu), damit der Test an jedem Tag läuft
  for (const v of ["6", "0"]) await page.click(`${sheet} [data-cwd="0"][data-v="${v}"]`);
  await page.selectOption(`${sheet} [data-adda]`, "task");
  await page.waitForSelector(`${sheet} [data-f="a.1.text"]`);
  await page.fill(`${sheet} [data-f="a.1.text"]`, "Fotos von {ort} machen 📸");
  await page.selectOption(`${sheet} [data-adda]`, "open");
  await shot("automationen-editor-390-light.png");
  await page.click(`${sheet} [data-save]`);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sk-a-automations") || "[]").length === 2);
  rules = await A("automations");
  const own = rules.find((r) => r.name === "Guten Morgen Baustelle");
  ok(own && own.trigger.type === "clock_in" && own.conds[0].days.length === 7 && own.actions.map((a) => a.type).join() === "hint,task,open", "Regel mit WENN/NUR/DANN gespeichert");
  ok((await page.textContent(`.au-rule[data-id="${own.id}"]`)).includes("Du stempelst ein"), "Karte zeigt den WENN-Satz");

  /* ---------- Einstempeln → Hinweis + Aufgabe ---------- */
  await page.evaluate(async () => { const t = await import("/js/timer.js"); await t.clockIn({ placeId: "p1", place: "Baustelle Muster" }); });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sk-a-automation_log") || "[]").length === 2, null, { timeout: 8000 });
  const st = await S();
  const task = (st.todos || []).find((t) => t.src === "automation");
  ok(task && task.title === "Fotos von Baustelle Muster machen 📸" && task.kind === "todo", "Aufgabe aus Vorlage-Text angelegt ({ort} ersetzt)");
  await page.waitForFunction(() => { const b = document.querySelector("#btn-notify .nt-badge"); return b && !b.hidden; });
  await page.click("#btn-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  const titles = await page.$$eval("#nt-body .nt-tx b", (bs) => bs.map((b) => b.textContent));
  ok(titles.includes("Servus auf Baustelle Muster! 👷"), "Hinweis in der 🔔 Benachrichtigungszentrale");
  ok(titles.includes("Baustelle Muster öffnen?"), "„Seite vorschlagen“ als Mitteilung");
  await shot("automationen-notify-390-light.png");
  await page.click('#nt-body .nt-item[data-id^="auto:"] .nt-go >> text=Baustelle Muster öffnen?');
  await page.waitForFunction(() => location.hash === "#orte/baustelle/p1");
  ok(true, "Tipp auf den Vorschlag öffnet die Baustellenseite");

  /* ---------- Duplikat-Schutz nach Neuladen ---------- */
  await page.reload();
  await page.waitForTimeout(1800);
  ok((await A("automation_log")).length === 2 && (await S()).todos.filter((t) => t.src === "automation").length === 1, "Nach Neuladen läuft nichts doppelt");

  /* ---------- Aus/Ein, Bearbeiten, Duplizieren, Löschen ---------- */
  await page.goto(BASE + "#alltag/automationen");
  await page.waitForSelector(`.au-rule[data-id="${own.id}"]`);
  ok((await page.textContent(`.au-rule[data-id="${own.id}"] .au-st`)).includes("zuletzt"), "Status „zuletzt …“ an der Regel");
  await page.click(`.au-rule[data-id="${own.id}"] .au-sw`);
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem("sk-a-automations")).find((r) => r.id === id).enabled === false, own.id);
  ok(await page.$eval(`.au-rule[data-id="${own.id}"]`, (e) => e.classList.contains("off")), "Ausschalten (Karte grau)");
  await page.click(`.au-rule[data-id="${own.id}"] .au-sw`);
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem("sk-a-automations")).find((r) => r.id === id).enabled === true, own.id);
  ok(true, "Wieder einschalten");
  await page.click(`[data-edit="${own.id}"]`);
  await page.waitForSelector(`${sheet} [data-f="name"]`);
  ok((await page.inputValue(`${sheet} [data-f="a.0.text"]`)) === "Servus auf {ort}! 👷", "Bearbeiten lädt die Regel");
  await page.fill(`${sheet} [data-f="name"]`, "Morgen-Check");
  await page.click(`${sheet} [data-save]`);
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem("sk-a-automations")).find((r) => r.id === id).name === "Morgen-Check", own.id);
  ok(true, "Bearbeitet und gespeichert");
  await page.click(`[data-dup="${own.id}"]`);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sk-a-automations")).length === 3);
  rules = await A("automations");
  const copy = rules.find((r) => r.name === "Morgen-Check (Kopie)");
  ok(copy && copy.enabled === false && (copy.seen || []).length === 0, "Duplizieren: pausierte Kopie ohne Verlauf");
  await page.click(`[data-del="${copy.id}"]`);
  ok((await page.textContent(`[data-del="${copy.id}"]`)).includes("Wirklich"), "Löschen fragt nach");
  await page.click(`[data-del="${copy.id}"]`);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sk-a-automations")).length === 2);
  ok(true, "Zweiter Tipp löscht");

  /* ---------- Fehleranzeige + Verlauf ---------- */
  await page.evaluate(async (rid) => {
    const db = await import("/js/alltag/db.js");
    await db.collection("automation_log").put({ id: "al_testfehler", ruleId: rid, key: rid + "|x", ts: Date.now() + 1000, ok: false, error: "Privat-Modus nicht verfügbar.", name: "Morgen-Check", emoji: "⚡", done: [], hints: [] });
  }, own.id);
  await page.waitForSelector(`.au-rule[data-id="${own.id}"] .au-err`);
  ok((await page.textContent(`.au-rule[data-id="${own.id}"] .au-err`)).includes("Privat-Modus"), "Fehler wird an der Regel angezeigt");
  await page.click('.au-tab[data-tab="verlauf"]');
  await page.waitForSelector(".au-li.bad");
  ok((await page.$$eval(".au-li", (x) => x.length)) === 3, "Verlauf zeigt alle Läufe (✅ und ⚠️)");
  await shot("automationen-verlauf-390-light.png");
  await page.click('.au-tab[data-tab="regeln"]');
  await shot("automationen-regeln-390-light.png");

  /* ---------- Einstellungen → Automationen ---------- */
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "benachrichtigungen" } })));
  await page.waitForSelector('[data-sh-act="automationen"]', { state: "visible" });
  await page.click('[data-sh-act="automationen"]');
  await page.waitForFunction(() => location.hash === "#alltag/automationen");
  ok(true, "Link „⚡ Automationen“ in Einstellungen › Benachrichtigungen");

  /* ---------- Globale Suche ---------- */
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+k");
  const sIn = await page.waitForSelector("#srch-q, .srch input[type=search]", { timeout: 4000 }).catch(() => null);
  if (sIn) {
    await sIn.fill("Morgen-Check");
    await page.waitForFunction(() => /Morgen-Check/.test(document.querySelector(".srch, #search-layer")?.textContent || ""), null, { timeout: 4000 });
    ok(true, "Automation in der globalen Suche");
    await page.keyboard.press("Escape");
  }

  /* ---------- 1440 dunkel ---------- */
  const big = await newPage("dark", 1440, 900);
  await big.goto(BASE);
  await big.evaluate((d) => { for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); }, await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))));
  await big.goto(BASE + "#alltag/automationen");
  await big.reload();
  const lb = await big.$("#btn-local");
  if (lb && await lb.isVisible()) await lb.click();
  await big.waitForSelector(".au-rule");
  await shot("automationen-regeln-1440-dark.png", big);
  await big.click('[data-au="new"]');
  await big.waitForSelector(`${sheet} #au-trigger`);
  await big.selectOption(`${sheet} #au-trigger`, "termin");
  await big.waitForSelector(`${sheet} [data-f="t.amount"]`);
  await shot("automationen-editor-1440-dark.png", big);

  ok(errors.length === 0, "keine Konsolen-Fehler / CSP-Verstöße" + (errors.length ? ":\n  " + errors.join("\n  ") : ""));
  await browser.close();
  console.log("\nAlle Automationen-Tests bestanden ✔");
})().catch((e) => { console.error(e); process.exit(1); });
