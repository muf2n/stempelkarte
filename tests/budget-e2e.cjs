// Playwright-Test „Budget-Warnungen“: Budget setzen, Ausgaben über 80 % / 100 % → Banner + STOPP-Abzeichen,
// „Kann ich mir das leisten?“ Ja / Knapp / Nein, „Trotzdem kaufen & eintragen“, Warn-Schalter, Hinweis „Sperre bei der Bank“.
//   cd <worktree> && python3 -m http.server 8870 &   then   node tests/budget-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8870/";
const OUT = process.argv[2] || require("os").tmpdir();

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const nb = (s) => String(s || "").replace(/ /g, " ");

  async function newPage(opts) {
    const ctx = await browser.newContext(opts);
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    const page = await ctx.newPage();
    // abgefangene fremde Domains (Schriften, Firebase-SDK) erzeugen „Failed to load resource“ – keine App-Fehler
    page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return { ctx, page };
  }
  const sheet = (page) => page.locator(".sheet").last();
  const txs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_tx") || "[]"));

  async function addTx(page, amount, note) {
    await page.click(".mn-tab[data-tab=buchungen]");
    await page.click(".mn-fab");
    for (const k of String(amount)) await sheet(page).locator(`[data-key="${k}"]`).click();
    await page.fill("#mn-note", note);
    await sheet(page).locator("[data-save]").click();
    await page.waitForTimeout(350);
  }

  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await page.goto(BASE);
  await page.click("#btn-local");
  await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.setItem("stempelkarte.money.tab", "budget"));
  await page.goto(BASE + "#alltag/geld");
  await page.waitForSelector(".mn-page[data-tab=budget]");
  ok(await page.isVisible(".mn-bankhint >> text=BAWAG-App → Karten → Limits"), "Hinweis „Echte Sperre geht nur bei der Bank“ (ohne Link)");
  ok(await page.locator(".mn-bankhint a").count() === 0, "Hinweis ohne Deep-Link");
  ok(await page.isChecked(".mn-alertcfg [data-bga=on]") && await page.isChecked("[data-bga=at80]"), "Warn-Schalter standardmäßig an");

  /* 1) Budget setzen */
  await page.click("[data-mn=editbudget]");
  await page.fill('[data-b="essen"]', "200");
  await page.fill('[data-b="essengehen"]', "100");
  await sheet(page).locator("[data-save]").click();
  await page.waitForTimeout(400);
  ok(await page.locator(".mn-bud").count() === 2, "Zwei Budgets angelegt");

  /* 2) Ausgabe über 80 % → Banner */
  await addTx(page, 170, "Billa Wocheneinkauf");
  await page.waitForSelector(".mn-alert");
  let banner = nb(await page.textContent(".mn-alert"));
  ok(/⚠️ Budget Essen & Einkauf fast aufgebraucht: 170 € von 200 € – noch 30 € bis Monatsende \(\d+ Tage?\)/.test(banner), "80 %-Banner: " + banner.slice(0, 90));
  ok(await page.locator(".mn-alert.warn").count() === 1, "Banner gelb (Warnung)");
  await page.screenshot({ path: path.join(OUT, "budget-80-dark.png") });
  await page.click("[data-bg=dismiss]");
  ok(await page.locator(".mn-alert").count() === 0, "Banner schließbar");
  // Neu laden → nicht doppelt
  await page.reload();
  await page.waitForSelector(".mn-page");
  await page.waitForTimeout(500);
  ok(await page.locator(".mn-alert").count() === 0, "80 % nach Neuladen nicht nochmal");

  /* 3) Über 100 % → STOPP-Banner + Abzeichen */
  await addTx(page, 54, "Hofer");
  await page.waitForSelector(".mn-alert.stop");
  banner = nb(await page.textContent(".mn-alert"));
  ok(/🛑 Budget Essen & Einkauf überschritten um 24 € – STOPP, nichts mehr für Essen & Einkauf ausgeben diesen Monat/.test(banner), "STOPP-Banner: " + banner.slice(0, 100));
  ok(banner.includes("kann deine Karte nicht sperren"), "Ehrlich: App sperrt keine Karte");
  await page.click("[data-bg=tobudget]");
  await page.waitForSelector(".mn-page[data-tab=budget]");
  const stopp = page.locator(".mn-bud.over .mn-stopp");
  ok(await stopp.count() === 1 && (await stopp.textContent()) === "STOPP", "Rotes STOPP-Abzeichen bei Essen & Einkauf");
  await page.screenshot({ path: path.join(OUT, "budget-stopp-dark.png"), fullPage: true });
  // weitere Ausgabe → „überschritten um“
  await addTx(page, 6, "Spar Semmel");
  await page.waitForSelector(".mn-alert.stop");
  banner = nb(await page.textContent(".mn-alert"));
  ok(/🛑 Budget Essen & Einkauf überschritten um 30 €/.test(banner) && !banner.includes("STOPP, nichts"), "Jede weitere Ausgabe: „überschritten um 30 €“");
  await page.click("[data-bg=dismiss]");

  /* 4) „Kann ich mir das leisten?“ */
  await addTx(page, 62, "Döner");
  await page.waitForTimeout(300);
  if (await page.locator(".mn-alert").count()) await page.click("[data-bg=dismiss]"); // evtl. Tempo-Hinweis
  await page.click(".mn-tab[data-tab=uebersicht]");
  ok(await page.isVisible(".mn-afford-row [data-bg=afford]"), "Knopf in der Übersicht");
  await page.click(".mn-tab[data-tab=budget]");
  await page.click(".mn-budget-btns [data-bg=afford]");
  await page.fill("#mn-af-note", "Pizza 12 €");
  await page.waitForTimeout(150);
  let res = nb(await sheet(page).locator(".mn-af-head").textContent());
  ok(res === "✅ Ja – danach noch 26 € im Budget Essen gehen", "Ja: " + res);
  ok(await sheet(page).locator(".mn-cat[aria-pressed=true]").textContent().then((t) => t.includes("Essen gehen")), "Kategorie aus „Pizza“ erkannt");
  await page.screenshot({ path: path.join(OUT, "budget-afford-ja-dark.png") });
  await page.fill("#mn-af-amt", "35");
  res = nb(await sheet(page).locator(".mn-af-head").textContent());
  ok(/^⚠️ Knapp – danach nur noch 3 € im Budget Essen gehen/.test(res), "Knapp: " + res);
  await page.screenshot({ path: path.join(OUT, "budget-afford-knapp-dark.png") });
  await page.fill("#mn-af-amt", "52");
  res = nb(await sheet(page).locator(".mn-af-head").textContent());
  ok(/^🛑 Nein – damit wärst du 14 € über dem Budget Essen gehen \(noch \d+ Tage? im Monat\)/.test(res), "Nein: " + res);
  ok((await sheet(page).locator("[data-af=buy]").textContent()) === "Trotzdem kaufen & eintragen", "„Trotzdem kaufen & eintragen“");
  await page.screenshot({ path: path.join(OUT, "budget-afford-nein-dark.png") });
  const before = (await txs(page)).length;
  await sheet(page).locator("[data-af=buy]").click();
  await page.waitForTimeout(500);
  const after = await txs(page);
  ok(after.length === before + 1 && after.some((t) => t.note === "Pizza" && t.amount === 52 && t.category === "essengehen"), "Trotzdem gekauft → gebucht (Pizza, 52 €, Essen gehen)");
  await page.waitForSelector(".mn-alert.stop");
  ok(/Budget Essen gehen überschritten um 14 €/.test(nb(await page.textContent(".mn-alert"))), "Danach sofort STOPP-Banner für Essen gehen");

  /* 5) Schalter aus → kein Banner */
  await page.click("[data-bg=dismiss]");
  await page.click(".mn-tab[data-tab=budget]");
  await page.click(".mn-alertcfg label:has([data-bga=on])");
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}").settings);
  ok(st && st.money && st.money.alerts && st.money.alerts.on === false, "settings.money.alerts.on = false gespeichert");
  await addTx(page, 3, "Billa");
  ok(await page.locator(".mn-alert").count() === 0, "Warnungen aus → kein Banner");
  await page.click(".mn-tab[data-tab=budget]");
  await page.click(".mn-alertcfg label:has([data-bga=on])");
  await page.waitForTimeout(200);

  /* Screenshots hell + PC */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: path.join(OUT, "budget-light.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click(".mn-budget-btns [data-bg=afford]");
  await page.fill("#mn-af-note", "Kino 9 €");
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, "budget-desktop.png") });

  ok(errors.length === 0, "Keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
