// Playwright-Test: 👤 Profile & 🧩 Module ein/aus (Update 10 F), lokaler Modus.
//   cd <worktree> && python3 -m http.server 9533 &   then   node tests/profile-modules-e2e.cjs [screenshot-dir]
// Chip im Überblick → Profil „Arbeit“ (Widget-Reihenfolge, stumme Mitteilungen, Arbeit-Modus), Anpassung wird pro Profil gemerkt,
// zurück zu Standard; Einstellungen › Profile & Module: Modul „Geld“ aus → weg aus Alltag, Suche, Überblick, Mitteilungen – Daten bleiben.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:9533/";
const OUT = process.argv[2] || require("os").tmpdir();
const at = (y, m, d, h, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const NOW = at(2026, 11, 9, 10);

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
    await page.clock.setFixedTime(NOW);
    await page.goto(BASE);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
        entries: [{ id: "e1", start: Date.now() - 72 * 3600e3, end: Date.now() - 64 * 3600e3, pauseMin: 30, kind: "work", placeId: "p1", place: "Baustelle Hauptstraße" }],
        places: [{ id: "p1", name: "Baustelle Hauptstraße", lat: 48.2, lng: 16.37, radius: 150 }],
        todos: [{ id: "t1", title: "Werkzeug zurückgeben", date: "2026-11-09", created: 1 }],
        days: {}, rev: 1, running: null, settings: { weeklyTarget: 38.5 },
      }));
      localStorage.setItem("sk-a-money_tx", JSON.stringify([{ id: "x1", type: "out", amount: 42.5, date: "2026-11-03", category: "essen", note: "Billa Test" }]));
      localStorage.setItem("sk-a-money_budget", JSON.stringify([{ id: "total", amount: 300 }]));
      localStorage.setItem("sk-a-money_subs", JSON.stringify([{ id: "s1", name: "Streaming Test", amount: 9.99, interval: "monthly", next: "2026-11-10", active: true }]));
    });
    await page.reload();
    await page.click("#btn-local");
    await page.waitForSelector("#view-heute .dash-grid > .dw", { state: "visible" });
    await page.waitForTimeout(300);
    return { ctx, page };
  }
  const settings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).settings);
  const order = (page) => page.$$eval("#view-heute .dash-grid > .dw", (ws) => ws.map((w) => w.dataset.w));

  let { ctx, page } = await mk("dark", 390, 844);
  ok((await order(page)).includes("money"), "Standard: Finanzen-Widget da");
  await page.click('#view-heute [data-d="profile"]');
  await page.waitForSelector(".sheet .pf-item");
  ok((await page.$$(".sheet .pf-item")).length === 6, "6 Profile zur Auswahl");
  ok(await page.getAttribute('.sheet .pf-item[data-pf="standard"]', "aria-checked") === "true", "Standard aktiv");
  await page.screenshot({ path: path.join(OUT, "profile-switch-390-dark.png") });
  await page.click('.sheet .pf-item[data-pf="arbeit"]');
  await page.waitForTimeout(400);
  ok(!(await page.isVisible(".sheet .pf-item")), "Blatt schließt nach Wahl");
  ok((await page.textContent('#view-heute [data-d="profile"]')).includes("Arbeit"), "Chip zeigt 💼 Arbeit");
  let o = await order(page);
  ok(o[0] === "site" && !o.includes("money"), "Arbeit: Baustelle zuerst, Finanzen aus – " + o.join(","));
  let s = await settings(page);
  ok(s.profiles.active === "arbeit" && s.notify.off.includes("haushalt") && s.mode && s.mode.privat === false, "Profil gespeichert: stumme Kategorien + Arbeit-Modus");
  ok(Array.isArray(s.profiles.slots.standard.dashboard.order), "Standard-Stand gesichert");
  // Im Profil anpassen: Tipp ausblenden
  await page.click('#view-heute [data-d="edit"]');
  await page.uncheck('#view-heute [data-tg="tip"]');
  await page.waitForTimeout(200);
  await page.click('#view-heute [data-d="done"]');
  await page.screenshot({ path: path.join(OUT, "profile-arbeit-390-dark.png") });
  // Privat → zurück
  await page.click('#view-heute [data-d="profile"]');
  await page.click('.sheet .pf-item[data-pf="privat"]');
  await page.waitForTimeout(400);
  s = await settings(page);
  ok(s.mode.privat === true && s.profiles.slots.arbeit.dashboard.hidden.includes("tip"), "Privat: Privat-Modus an, Arbeit-Anpassung gemerkt");
  await page.click('#view-heute [data-d="profile"]');
  await page.click('.sheet .pf-item[data-pf="standard"]');
  await page.waitForTimeout(400);
  s = await settings(page);
  o = await order(page);
  ok(s.profiles.active === "standard" && s.mode.privat === false && o.includes("money") && o.includes("tip"), "Standard: eigener Stand zurück, Privat aus");

  // Einstellungen › Profile & Module
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "profile" } })));
  await page.waitForSelector("#profiles-panel .pf-mods");
  ok((await page.$$("#profiles-panel [data-mod]")).length >= 18, "Modul-Schalter für alle Alltag-Bereiche");
  await page.uncheck('#profiles-panel [data-mod="geld"]');
  await page.waitForTimeout(400);
  s = await settings(page);
  ok(s.modules.off.includes("geld"), "Modul Geld aus gespeichert");
  await page.screenshot({ path: path.join(OUT, "profile-settings-390-dark.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  o = await order(page);
  ok(!o.includes("money"), "Überblick: Finanzen-Widget weg");
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector(".al-grid");
  ok(!(await page.$('.al-tile[data-id="geld"]')) && !!(await page.$('.al-tile[data-id="elektro"]')), "Alltag: Geld-Kachel weg, andere da");
  await page.evaluate(() => { location.hash = "#alltag/geld"; });
  await page.waitForSelector(".al-off");
  ok(true, "Direkt-Link: freundlicher Hinweis statt Modul");
  // Suche
  await page.evaluate(() => import("/js/views/search.js").then((m) => m.openSearch("Billa")));
  await page.waitForTimeout(900);
  ok(!(await page.$('.srch-row:has-text("Billa Test")')), "Suche: Geld-Buchungen nicht durchsucht");
  await page.evaluate(() => import("/js/views/search.js").then((m) => m.close()));
  await page.waitForTimeout(200);
  // Mitteilungen: Abo-Erinnerung weg
  await page.click("#btn-notify");
  await page.waitForTimeout(400);
  ok(!(await page.textContent(".nt-body, .nt-list, body")).includes("Streaming Test"), "Mitteilungen: keine Geld-Hinweise");
  await page.keyboard.press("Escape");
  // Daten noch da + wieder einschalten
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_tx")).length === 1), "Daten bleiben gespeichert");
  await page.evaluate(() => { location.hash = "#alltag/geld"; });
  await page.waitForSelector("[data-al-on]");
  await page.click("[data-al-on]");
  await page.waitForTimeout(600);
  ok(!(await page.$(".al-off")) && !(await settings(page)).modules.off.includes("geld"), "Mit einem Tipp wieder eingeschaltet");
  await ctx.close();

  // PC hell: Einstellungsseite
  ({ ctx, page } = await mk("light", 1440, 900));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "profile" } })));
  await page.waitForSelector("#profiles-panel .pf-item");
  await page.click('#profiles-panel .pf-item[data-pf="fokus"]');
  await page.waitForTimeout(400);
  ok(await page.getAttribute('#profiles-panel .pf-item[data-pf="fokus"]', "aria-checked") === "true", "Fokus in den Einstellungen aktivierbar");
  ok((await page.textContent('[data-val="profile"]')).includes("Fokus"), "Wert rechts in der Liste");
  ok(await page.isVisible("#profiles-panel [data-pf-reset]"), "Zurücksetzen-Knopf");
  await page.screenshot({ path: path.join(OUT, "profile-settings-1440-light.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const fo = await order(page);
  ok(fo.length <= 2 && fo[0] === "agenda", "Fokus: nur Termine/Aufgaben (+ Tipp) – " + fo.join(","));
  await ctx.close();
  await browser.close();
  if (errors.length) { console.error("Konsolenfehler:\n" + errors.join("\n")); process.exit(1); }
  console.log("Alles gut ✔");
})().catch((e) => { console.error(e); process.exit(1); });
