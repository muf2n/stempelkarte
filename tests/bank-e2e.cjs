// Playwright-Test für die Karte „Bankkonto (BAWAG)“ (Worker /bank/* wird per page.route simuliert).
//   cd <worktree> && python3 -m http.server 8848 &   then   node tests/bank-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen; Anmeldung über window.__bankTestToken (nur localhost).
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8848/";
const WORKER = "https://stempelkarte-mcp.lippa-florian.workers.dev";
const OUT = process.argv[2] || require("os").tmpdir();
const DAY = 86400e3;

const linked = (over = {}) => ({
  linked: true, aspsp: "BAWAG", valid_until: new Date(Date.now() + 150 * DAY).toISOString(), daysLeft: 150, expired: false,
  accounts: [{ iban_last4: "3201", name: "Konto Florian", currency: "EUR" }],
  lastSync: Date.now() - 2 * 3600e3, balance: { amount: 1234.56, currency: "EUR", at: Date.now() - 2 * 3600e3 }, lastError: null, ...over,
});

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const W = { status: { linked: false }, statusCode: 200, hits: [], sync: { imported: 2 }, finishAuth: null };

  async function newPage(opts, { token = "test-token" } = {}) {
    const ctx = await browser.newContext(opts);
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    // Simulierte Bank-Anmeldeseite: leitet sofort zur Rückruf-Seite zurück
    await ctx.route("https://enablebanking.example/**", (route) => {
      const u = new URL(route.request().url());
      const back = u.searchParams.get("deny") ? `${BASE}bank-callback.html?error=access_denied&state=S1` : `${BASE}bank-callback.html?code=CODE-1&state=S1`;
      return route.fulfill({ status: 302, headers: { location: back } });
    });
    await ctx.route(WORKER + "/**", async (route) => {
      const r = route.request();
      const u = new URL(r.url());
      const cors = { "access-control-allow-origin": "http://localhost:8848", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
      if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      W.hits.push(r.method() + " " + u.pathname);
      const send = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
      const auth = r.headers()["authorization"];
      if (u.pathname === "/bank/finish") {
        W.finishAuth = auth || null;
        const b = JSON.parse(r.postData() || "{}");
        if (b.code !== "CODE-1" || b.state !== "S1") return send(400, { error: "Ungültiger Rückruf" });
        W.status = linked();
        return send(200, { ok: true, imported: 37, status: W.status });
      }
      if (auth !== "Bearer test-token") return send(401, { error: "Bitte anmelden." });
      if (u.pathname === "/bank/status") return send(W.statusCode, W.statusCode === 200 ? W.status : { error: "Die Bankverbindung ist am Server noch nicht eingerichtet (ENABLEBANKING_APP_ID / ENABLEBANKING_KEY fehlen)." });
      if (u.pathname === "/bank/start") return send(200, { url: "https://enablebanking.example/auth?x=1" + (W.deny ? "&deny=1" : "") });
      if (u.pathname === "/bank/sync") { W.status = linked({ lastSync: Date.now() }); return send(200, { ...W.sync, status: W.status }); }
      if (u.pathname === "/bank/unlink") { W.status = { linked: false }; return send(200, { ok: true, linked: false }); }
      return send(404, { error: "Nicht gefunden." });
    });
    if (token) await ctx.addInitScript((t) => { window.__bankTestToken = t; }, token);
    const page = await ctx.newPage();
    page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return { ctx, page };
  }
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  async function openGeld(page, setup) {
    await page.goto(BASE);
    await page.click("#btn-local");
    await page.waitForTimeout(300);
    await page.evaluate((s) => {
      localStorage.setItem("stempelkarte.money.tab", "uebersicht");
      localStorage.removeItem("stempelkarte.bank.status");
      if (s && s.tx) localStorage.setItem("sk-a-money_tx", JSON.stringify(s.tx));
    }, setup || null);
    await page.goto(BASE + "#alltag/geld");
    await page.reload();
    await page.waitForSelector(".bk-card", { timeout: 8000 });
  }

  // 1) Lokaler Modus ohne Anmeldung
  {
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" }, { token: null });
    await openGeld(page);
    ok((await page.textContent(".bk-card")).includes("Nur mit Google-Anmeldung"), "Lokaler Modus: Hinweis „Nur mit Google-Anmeldung“");
    ok(!W.hits.length, "Lokaler Modus: kein Server-Aufruf");
    await ctx.close();
  }

  // 2) Nicht verbunden → Verbinden → (Bank) → Rückruf → verbunden
  const tk = Date.now();
  const today = new Date(); const tkey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const TX = [
    { id: "bk_aaa", date: tkey, amount: 23.4, type: "out", category: "essen", note: "BILLA DANKT 1234", src: "bank", bankRef: "E1", counterparty: "BILLA DANKT 1234", bankText: "POS 23,40", created: tk, updated: tk, bankSync: tk },
    { id: "m1", date: tkey, amount: 4.5, type: "out", category: "essengehen", note: "Leberkässemmel", created: tk, updated: tk },
  ];
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await openGeld(page, { tx: TX });
  await page.waitForSelector('[data-bk="connect"]');
  const txt = await page.textContent(".bk-card");
  ok(txt.includes("Mit BAWAG verbinden"), "Knopf „Mit BAWAG verbinden“");
  ok(txt.includes("Seite von BAWAG") && txt.includes("Passwort nie") && txt.includes("180 Tage"), "Erklärung (BAWAG-Seite, Passwort, 180 Tage)");
  await page.screenshot({ path: path.join(OUT, "bank-390-light-unlinked.png"), fullPage: true });

  await page.click('[data-bk="connect"]');
  await page.waitForURL(/bank-callback\.html/, { timeout: 8000 });
  await page.waitForSelector("#back:not([hidden])", { timeout: 15000 });
  const cb = await page.textContent("main");
  ok(/Verbunden/.test(cb) && /37 Buchungen/.test(cb), "Rückruf-Seite: verbunden, 37 Buchungen");
  ok(!page.url().includes("CODE-1"), "Code aus der Adresszeile entfernt");
  ok(W.finishAuth === null, "Ohne Anmeldung: finish nur mit state (kein Token)");
  await page.screenshot({ path: path.join(OUT, "bank-callback-390-light.png") });
  await page.click("#back");
  await page.waitForSelector(".bk-on", { timeout: 8000 });
  const on = (await page.textContent(".bk-card")).replace(/\s/g, " ");
  ok(on.includes("1.234,56 €") && on.includes("·· 3201") && on.includes("noch 150 Tage"), "Verbunden: Kontostand, ··3201, noch 150 Tage");
  ok(on.includes("Aktualisiert"), "Letzter Abgleich angezeigt");
  await page.screenshot({ path: path.join(OUT, "bank-390-light-linked.png"), fullPage: true });

  await page.click('[data-bk="sync"]');
  await page.waitForSelector("text=2 neue Buchungen von der Bank", { timeout: 5000 });
  ok(W.hits.includes("POST /bank/sync"), "Jetzt aktualisieren → /bank/sync + Meldung");

  // Buchungen: 🏦 nur bei Bank-Buchung
  await page.click('.mn-tab[data-tab="buchungen"]');
  await page.waitForTimeout(200);
  const rows = await page.$$eval(".mn-tx", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  ok(rows.some((r) => /BILLA/.test(r) && /🏦 Bank/.test(r)) && rows.some((r) => /Leberkäs/.test(r) && !/🏦/.test(r)), "Buchungsliste: 🏦 nur bei Bank-Buchungen");
  await page.screenshot({ path: path.join(OUT, "bank-390-light-list.png"), fullPage: true });
  await page.click('.mn-tx:has-text("BILLA")');
  await page.waitForSelector(".sheet >> text=Von der Bank übernommen");
  ok(true, "Buchung öffnen: Hinweis „Von der Bank übernommen“");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.click('.mn-tab[data-tab="uebersicht"]');
  await page.waitForSelector(".bk-on");

  // Trennen mit Bestätigung
  await page.click('[data-bk="unlink"]');
  ok((await page.textContent('[data-bk="unlink"]')).includes("Wirklich trennen?"), "Trennen fragt nach");
  ok(!W.hits.includes("POST /bank/unlink"), "Erster Tipp trennt noch nicht");
  await page.click('[data-bk="unlink"]');
  await page.waitForSelector('[data-bk="connect"]', { timeout: 5000 });
  ok(W.hits.includes("POST /bank/unlink"), "Zweiter Tipp → /bank/unlink, wieder „nicht verbunden“");

  // Abbruch bei der Bank
  W.deny = true;
  await page.click('[data-bk="connect"]');
  await page.waitForSelector("#back:not([hidden])", { timeout: 15000 });
  ok((await page.textContent("main")).includes("abgebrochen oder abgelehnt"), "Abbruch bei der Bank → deutsche Meldung");
  W.deny = false;
  await ctx.close();

  // 3) Weitere Zustände + Screenshots
  async function state(name, st, opts = { viewport: { width: 390, height: 844 }, colorScheme: "light" }, code = 200) {
    W.status = st; W.statusCode = code;
    const { ctx: c, page: p } = await newPage(opts);
    await openGeld(p, { tx: TX });
    await p.waitForFunction(() => !document.querySelector(".bk-card[aria-busy]"));
    await p.waitForTimeout(250);
    const t = await p.textContent(".bk-card");
    await p.locator(".bk-card").screenshot({ path: path.join(OUT, name + ".png") });
    if (/full/.test(name)) await p.screenshot({ path: path.join(OUT, name + "-page.png"), fullPage: true });
    await c.close();
    W.statusCode = 200;
    return t;
  }
  let t = await state("bank-390-light-expiring", linked({ daysLeft: 4, valid_until: new Date(Date.now() + 4.5 * DAY).toISOString() }));
  ok(t.includes("noch 4 Tage") && t.includes("Verbindung erneuern") && t.includes("läuft bald ab"), "Bald ablaufend: Hinweis + „Verbindung erneuern“");
  t = await state("bank-390-light-expired", linked({ daysLeft: -1, expired: true, lastError: { code: "EXPIRED_SESSION", msg: "Die Bankverbindung ist abgelaufen oder wurde beendet – bitte neu mit BAWAG verbinden." } }));
  ok(t.includes("Abgelaufen") && t.includes("Neu verbinden") && !t.includes("Jetzt aktualisieren"), "Abgelaufen: „Neu verbinden“, kein Aktualisieren");
  t = await state("bank-390-light-rate", linked({ lastError: { code: "ASPSP_RATE_LIMIT_EXCEEDED", msg: "Die Bank erlaubt nur wenige automatische Abrufe pro Tag. Der nächste Versuch kommt in ein paar Stunden von selbst." } }));
  ok(t.includes("wenige automatische Abrufe"), "Rate-Limit-Hinweis sichtbar");
  t = await state("bank-390-light-503", null, undefined, 503);
  ok(t.includes("noch nicht eingerichtet") && t.includes("Erneut versuchen"), "Server nicht eingerichtet → klare Meldung + Erneut versuchen");
  await state("bank-390-dark-linked-full", linked(), { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await state("bank-390-dark-unlinked-full", { linked: false }, { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await state("bank-1440-light-linked-full", linked(), { viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  // Rückruf-Seite dunkel (Fehlerfall ohne Parameter)
  {
    const { ctx: c, page: p } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    await p.goto(BASE + "bank-callback.html");
    await p.waitForSelector("#back:not([hidden])");
    ok((await p.textContent("main")).includes("Nichts zu tun"), "Rückruf-Seite ohne code → Hinweis");
    await p.screenshot({ path: path.join(OUT, "bank-callback-390-dark.png") });
    await c.close();
  }

  ok(errors.length === 0, "Keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
