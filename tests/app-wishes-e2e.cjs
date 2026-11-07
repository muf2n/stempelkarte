// Playwright-Test für 💡 App-Wünsche (Einstellungen › Sonstiges) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 9433 &   then   node tests/app-wishes-e2e.cjs [screenshot-dir]
// Anlegen (mit Bereich/Wichtig), Doppelte abgelehnt, Status-Filter, Umgesetzt/Verwerfen/Wieder offen, Bearbeiten, Löschen,
// „📋 Alle offenen kopieren“ (saubere Liste), globale Suche öffnet die Seite, 390/1440 hell/dunkel, keine Konsolenfehler.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:9433/";
const OUT = process.argv[2] || require("os").tmpdir();

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.route("**/*", (route) => { const u = new URL(route.request().url()); return u.hostname === "localhost" ? route.continue() : route.abort(); });
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
  const A = () => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-app_wishes") || "[]"));
  const P = ".sh-page[data-page=\"wuensche\"]";

  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 } })); });
  await page.reload();
  await page.click("#btn-local");
  await page.waitForSelector("#settings-hub", { state: "attached" });

  await page.click("#btn-settings");
  await page.waitForSelector('#settings-hub .sh-row[data-cat="wuensche"]', { state: "visible" });
  ok((await page.textContent('#settings-hub .sh-row[data-cat="wuensche"]')).includes("💡"), "Eintrag „💡 App-Wünsche“ in der Zentrale");
  await page.click('#settings-hub .sh-row[data-cat="wuensche"]');
  await page.waitForSelector(`${P} .aw-form`);
  ok((await page.textContent(`${P} .aw-empty`)).includes("Noch keine Wünsche"), "Leerer Zustand");
  ok(await page.$eval(`${P} [data-aw="copy"]`, (b) => b.disabled), "Kopieren ohne offene Wünsche aus");

  await page.click(`${P} [data-aw="add"]`);
  ok(await page.isVisible(`${P} .aw-err`), "Leerer Wunsch → Hinweis");
  await page.fill("#aw-text", "Im Planer Aufgaben per Wischen abhaken");
  await page.fill("#aw-area", "Planer");
  await page.selectOption("#aw-prio", "wichtig");
  await page.click(`${P} [data-aw="add"]`);
  await page.waitForSelector(`${P} .aw-item`);
  await page.fill("#aw-text", "Größere Schrift im Stundenzettel");
  await page.click(`${P} [data-aw="add"]`);
  await page.waitForFunction(() => document.querySelectorAll('.sh-page[data-page="wuensche"] .aw-item').length === 2);
  await page.fill("#aw-text", "im planer aufgaben per wischen abhaken");
  await page.click(`${P} [data-aw="add"]`);
  ok((await page.textContent(`${P} .aw-err`)).includes("gibt's schon"), "Doppelter Wunsch abgelehnt");
  await page.fill("#aw-text", "");
  let w = await A();
  ok(w.length === 2 && w.every((x) => x.status === "offen" && x.source === "app") && w.find((x) => x.prio === "wichtig").area === "Planer", "Gespeichert: offen, Quelle app, Bereich, Wichtig");
  ok((await page.textContent(`${P} .aw-item`)).includes("Wichtig"), "Wichtige stehen oben");
  await shot("wishes-390-light.png");

  await page.click(`${P} [data-aw="copy"]`);
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip === "Offene App-Wünsche für die Stempelkarte (2):\n\n1. [WICHTIG] [Planer] Im Planer Aufgaben per Wischen abhaken\n2. Größere Schrift im Stundenzettel", "📋 Saubere Liste kopiert");

  const idSchrift = w.find((x) => x.text.startsWith("Größere")).id;
  await page.click(`${P} .aw-item[data-id="${idSchrift}"] [data-aw="done"]`);
  await page.waitForFunction(() => document.querySelectorAll('.sh-page[data-page="wuensche"] .aw-item').length === 1);
  ok((await A()).find((x) => x.id === idSchrift).status === "umgesetzt", "Als umgesetzt markiert (verschwindet aus „Offen“)");
  await page.click(`${P} [data-aw-f="umgesetzt"]`);
  ok((await page.$$(`${P} .aw-item`)).length === 1, "Filter „Umgesetzt“");
  await page.click(`${P} [data-aw="reopen"]`);
  await page.waitForTimeout(200);
  ok((await A()).find((x) => x.id === idSchrift).status === "offen", "Wieder offen");
  await page.click(`${P} [data-aw-f="offen"]`);
  await page.click(`${P} .aw-item[data-id="${idSchrift}"] [data-aw="drop"]`);
  await page.waitForTimeout(200);
  ok((await A()).find((x) => x.id === idSchrift).status === "verworfen", "Verworfen");
  await page.click(`${P} [data-aw-f="alle"]`);
  ok((await page.$$(`${P} .aw-item`)).length === 2, "Filter „Alle“");

  await page.click(`${P} .aw-item[data-id="${idSchrift}"] [data-aw="edit"]`);
  await page.waitForSelector("#aw-e-text");
  await page.fill("#aw-e-text", "Größere Schrift im Stundenzettel (PDF)");
  await page.selectOption("#aw-e-status", "offen");
  await page.click(".sheet:last-child button[type=submit]");
  await page.waitForTimeout(300);
  w = await A();
  ok(w.find((x) => x.id === idSchrift).text.endsWith("(PDF)") && w.find((x) => x.id === idSchrift).status === "offen", "Bearbeiten (Text + Status)");

  await page.click(`${P} .aw-item[data-id="${idSchrift}"] [data-aw="del"]`);
  await page.click(`${P} .aw-item[data-id="${idSchrift}"] [data-aw="del"]`);
  await page.waitForTimeout(300);
  ok((await A()).length === 1, "Löschen (zweimal tippen)");

  /* ---------- Globale Suche ---------- */
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("settings-hub").hidden);
  await page.click("#btn-search");
  await page.fill("#srch-q", "wischen");
  await page.waitForSelector('.srch-group[data-group="wuensche"]');
  await page.click('.srch-group[data-group="wuensche"] [data-key], .srch-group[data-group="wuensche"] button');
  await page.waitForSelector(`${P} .aw-item`, { state: "visible" });
  ok(true, "Globale Suche findet den Wunsch und öffnet die Seite");

  for (const [scheme, wd, h] of [["dark", 390, 844], ["light", 1440, 900], ["dark", 1440, 900]]) {
    await page.setViewportSize({ width: wd, height: h });
    await page.emulateMedia({ colorScheme: scheme });
    await shot(`wishes-${wd}-${scheme}.png`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Kein waagrechtes Scrollen (${wd} ${scheme})`);
  }
  ok(errors.length === 0, "Keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ":\n" + errors.join("\n") : ""));
  await browser.close();
  console.log("\nAlle App-Wünsche-Tests bestanden ✓");
})().catch((e) => { console.error(e); process.exit(1); });
