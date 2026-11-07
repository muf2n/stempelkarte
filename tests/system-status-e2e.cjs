// Playwright-Test: 🖥️ System-Status (Update 10 F), lokaler Modus.
//   cd <worktree> && python3 -m http.server 9534 &   then   node tests/system-status-e2e.cjs [screenshot-dir]
// Version (Seite + Service Worker per MessageChannel), Was ist neu, Sync/Backup, Speicher (estimate, localStorage, IndexedDB),
// Offline-Cache (+ leeren & neu laden), Diagnose ohne Inhalte (Zwischenablage), „Überall abmelden“ im lokalen Modus nur erklärt.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:9534/";
const OUT = process.argv[2] || require("os").tmpdir();

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  async function mk(scheme, width, height) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800, permissions: ["clipboard-read", "clipboard-write"] });
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
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
        entries: [{ id: "e1", start: Date.now() - 9 * 3600e3, end: Date.now() - 1 * 3600e3, pauseMin: 30, kind: "work", place: "Baustelle Geheimweg 7", note: "Privatnotiz XYZ" }],
        places: [{ id: "p1", name: "Baustelle Geheimweg 7", lat: 48.2, lng: 16.37, radius: 150 }],
        todos: [{ id: "t1", title: "Arzttermin Geheim", date: "2026-11-09", created: 1 }],
        days: {}, rev: 1, running: null, settings: { weeklyTarget: 38.5, modules: { off: ["japanisch"] } },
      }));
    });
    await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);
    await page.reload();
    await page.click("#btn-local");
    await page.waitForSelector("#view-heute .dash", { state: "attached" });
    return { ctx, page };
  }
  let { ctx, page } = await mk("dark", 390, 844);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "system" } })));
  await page.waitForSelector("#system-panel .ss-grid");
  const pv = await page.textContent('[data-ss="page"]');
  ok(/^\d{8}-\d{4}$/.test(pv), "App-Version aus ?v= : " + pv);
  await page.waitForFunction(() => !/…/.test(document.querySelector('[data-ss="sw"]').textContent), null, { timeout: 5000 });
  const sw = await page.textContent('[data-ss="sw"]');
  ok(/^\d{8}-\d{4}/.test(sw), "Service-Worker-Version per Nachricht: " + sw);
  ok((await page.textContent('[data-ss="sync"]')).includes("nur dieses Gerät"), "Sync: lokaler Modus");
  ok((await page.textContent('[data-ss="backup"]')).includes("noch nie"), "Letztes Backup");
  await page.waitForFunction(() => document.querySelector('[data-ss="storage"]').textContent.includes("localStorage"));
  const stor = await page.textContent('[data-ss="storage"]');
  ok(/localStorage.*Einträge/.test(stor) && stor.includes("IndexedDB"), "Speicher: localStorage + IndexedDB");
  await page.waitForFunction(() => /Dateien|Kein Cache/.test(document.querySelector('[data-ss="caches"]').textContent));
  ok((await page.textContent('[data-ss="caches"]')).includes("stempelkarte-"), "Offline-Cache aufgelistet");
  ok((await page.textContent("#system-panel")).includes("lokal") || (await page.textContent("#system-panel")).includes("nur auf diesem Gerät"), "Überall abmelden: im lokalen Modus erklärt");
  ok(!(await page.$('[data-ss-act="revoke"]')), "… ohne Knopf");
  ok((await page.$$(".ss-log > li:not([hidden])")).length === 4, "Was ist neu: 4 neueste sichtbar");
  await page.click('[data-ss-act="more"]');
  ok((await page.$$(".ss-log > li:not([hidden])")).length > 10, "… ältere aufklappbar");
  // Diagnose
  await page.click('[data-ss-act="diag"]');
  await page.waitForSelector('[data-ss="diag"]:not([hidden])');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const d = JSON.parse(clip);
  ok(d.page === pv && d.counts.entries === 1 && d.counts.places === 1 && d.counts.todos === 1, "Diagnose: Versionen + Anzahlen");
  ok(d.flags.modulesOff.includes("japanisch") && d.flags.profile === "standard", "Diagnose: Schalter");
  ok(!/Geheim|Privatnotiz|48\.2|16\.37/.test(clip), "Diagnose ohne persönliche Inhalte");
  await page.screenshot({ path: path.join(OUT, "system-390-dark.png"), fullPage: true });
  // Cache leeren (Zweifach-Tipp) → neu laden
  await page.click('[data-ss-act="clear"]');
  ok((await page.textContent('[data-ss-act="clear"]')).includes("Wirklich"), "Cache leeren fragt nach");
  const nav = page.waitForNavigation();
  await page.click('[data-ss-act="clear"]');
  await nav;
  ok(true, "Cache geleert und neu geladen");
  await ctx.close();

  ({ ctx, page } = await mk("light", 1440, 900));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "system" } })));
  await page.waitForSelector("#system-panel .ss-grid");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "system-1440-light.png") });
  // Suche in den Einstellungen findet System-Status
  await page.fill("#sh-q", "cache");
  await page.waitForTimeout(150);
  ok(await page.isVisible('.sh-row[data-cat="system"]'), "Einstellungssuche „cache“ → System-Status");
  await ctx.close();
  await browser.close();
  if (errors.length) { console.error("Konsolenfehler:\n" + errors.join("\n")); process.exit(1); }
  console.log("Alles gut ✔");
})().catch((e) => { console.error(e); process.exit(1); });
