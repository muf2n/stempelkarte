// Playwright-Test für den Papierkorb (Claude-Löschungen) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8865 &   then   node tests/trash-e2e.cjs [screenshot-dir]
// Testdaten: Serientermin mit Ausnahme, Papierkorb-Stapel (über js/alltag/db.js angelegt), einer davon abgelaufen.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8865/";
const OUT = process.argv[2] || require("os").tmpdir();
const DAY = 86400000;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name) => { await page.waitForTimeout(400); return page.screenshot({ path: path.join(OUT, name), fullPage: false }); };
  const local = () => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}"));
  const ls = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), k);

  await page.goto(BASE);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("sk-a-")) localStorage.removeItem(k);
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [], places: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 },
      todos: [{ id: "s1", kind: "termin", title: "Fußballtraining", date: "2026-11-02", time: "18:00", rrule: "FREQ=WEEKLY;BYDAY=MO", exdates: ["2026-12-07"], done: false, createdAt: 1 }],
    }));
  });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForTimeout(400);

  // Papierkorb über db.js befüllen (wie es der Worker in a_trash ablegt)
  await page.evaluate(async (DAY) => {
    const db = await import("./js/alltag/db.js");
    const tr = db.collection("trash");
    const now = Date.now();
    const s1 = { kind: "termin", title: "Fußballtraining", date: "2026-11-02", time: "18:00", rrule: "FREQ=WEEKLY;BYDAY=MO", done: false, createdAt: 1 };
    await tr.put({ id: "bA-0", batchId: "bA", by: "claude", deletedAt: now - 60000, op: "delete", path: "todos/t9", type: "termin", label: "Do, 03.12.2026 08:00 · Termin · „Zahnarzt“", data: { kind: "termin", title: "Zahnarzt", date: "2026-12-03", time: "08:00", done: false, createdAt: 2 } });
    await tr.put({ id: "bA-1", batchId: "bA", by: "claude", deletedAt: now - 60000, op: "delete", path: "a_money_tx/m1", type: "ausgabe", label: "Mo, 02.11.2026 · Ausgabe 12,50 € · essen · „Billa Jause“", data: { id: "m1", date: "2026-11-02", amount: 12.5, type: "out", category: "essen", note: "Billa Jause" } });
    for (let i = 0; i < 8; i++) await tr.put({ id: "bC-" + i, batchId: "bC", by: "claude", deletedAt: now - 3 * DAY, op: "delete", path: "entries/x" + i, type: "eintrag", label: `Mo, ${10 + i}.11.2026 · Schule`, data: { kind: "schule", start: now - (20 + i) * DAY, end: now - (20 + i) * DAY, pauseMin: 0, creditMin: 462 } });
    await tr.put({ id: "bB-0", batchId: "bB", by: "claude", deletedAt: now - 2 * DAY, op: "exdate", date: "2026-12-07", path: "todos/s1", type: "termin", label: "Mo, 07.12.2026 18:00 · Termin (nur diese Wiederholung) · „Fußballtraining“", data: s1 });
    await tr.put({ id: "bOld-0", batchId: "bOld", by: "claude", deletedAt: now - 40 * DAY, op: "delete", path: "todos/zz", label: "uralt", data: { kind: "todo", title: "uralt" } });
  }, DAY);

  /* ---------- über Übersicht → Einstellungen ---------- */
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForSelector("#ov-trash", { state: "attached" });
  await page.$eval("#ov-trash", (b) => b.scrollIntoView({ block: "center" }));
  ok((await page.textContent("#ov-trash")).includes("Papierkorb"), "Knopf „Papierkorb“ in Übersicht → Einstellungen");
  await page.click("#ov-trash");
  await page.waitForSelector(".pk-batch");
  ok((await page.$$(".pk-batch")).length === 3, "3 Stapel sichtbar (abgelaufener ausgeblendet)");
  await page.waitForTimeout(200);
  ok(!(await ls("sk-a-trash")).some((t) => t.batchId === "bOld"), "Abgelaufener Stapel (>30 Tage) wird entfernt");
  const first = await page.textContent(".pk-batch:first-child");
  ok(first.includes("2 Elemente") && first.includes("Zahnarzt") && first.includes("Billa") && first.includes("von Claude"), "Neuester Stapel oben, mit Beschriftungen");
  ok(first.includes("noch 30 Tage"), "Restlaufzeit angezeigt");
  ok((await page.textContent('.pk-batch[data-b="bC"]')).includes("und 2 weitere"), "Lange Stapel: „und N weitere“");
  await page.waitForFunction(() => document.getElementById("toast")?.hidden !== false, null, { timeout: 6000 }).catch(() => {});
  await shot("trash-390-dark.png");

  await page.click('.pk-batch[data-b="bA"] [data-pk="restore"]');
  await page.waitForFunction(() => !document.querySelector('.pk-batch[data-b="bA"]'));
  let st = await local();
  ok(st.todos.some((t) => t.id === "t9" && t.title === "Zahnarzt" && t.time === "08:00"), "Termin über store.saveTodo wiederhergestellt");
  const tx = await ls("sk-a-money_tx");
  ok(tx.length === 1 && tx[0].id === "m1" && tx[0].amount === 12.5, "Buchung über db.js wiederhergestellt");
  ok((await ls("sk-a-trash")).every((t) => t.batchId !== "bA"), "Stapel aus dem Papierkorb entfernt");
  ok((await page.textContent("#toast")).includes("2 Elemente wiederhergestellt"), "Toast nach Wiederherstellen");

  await page.click('.pk-batch[data-b="bB"] [data-pk="restore"]');
  await page.waitForFunction(() => !document.querySelector('.pk-batch[data-b="bB"]'));
  st = await local();
  const s1 = st.todos.find((t) => t.id === "s1");
  ok(s1 && Array.isArray(s1.exdates) && !s1.exdates.includes("2026-12-07") && s1.rrule === "FREQ=WEEKLY;BYDAY=MO", "Ausnahme (EXDATE) am Serientermin wieder entfernt");

  const del = '.pk-batch[data-b="bC"] [data-pk="purge"]';
  await page.click(del);
  ok((await page.textContent(del)).includes("Wirklich endgültig?"), "Endgültig löschen fragt nach");
  await page.click(del);
  await page.waitForSelector(".pk-empty");
  ok((await ls("sk-a-trash")).length === 0, "Papierkorb leer nach „Endgültig löschen“");
  st = await local();
  ok(!st.entries.some((e) => String(e.id).startsWith("x")), "Endgültig löschen stellt nichts wieder her");
  await shot("trash-390-dark-empty.png");
  await page.click(".sheet .close");

  /* ---------- über den Assistenten-Fuß ---------- */
  await page.evaluate(() => { location.hash = "#alltag/claude"; });
  await page.waitForSelector('.ai-foot [data-a="trash"]');
  await page.click('.ai-foot [data-a="trash"]');
  await page.waitForSelector(".sheet .pk-empty");
  ok(true, "Papierkorb auch über den Fuß des Assistenten erreichbar");

  ok(!errors.length, "keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
