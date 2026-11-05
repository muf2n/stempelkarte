// Playwright-Test für „Gmail dauerhaft verbinden (Server)“ – der Worker (/gmail/*) wird komplett simuliert.
//   cd <worktree> && python3 -m http.server 8869 &   then   node tests/gmail-server-e2e.cjs [screenshot-dir]
// Anmeldung über window.__skAiTest (nur localhost); Server-Erkennungen werden wie vom Worker in sk-a-money_gmail gelegt.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8869/";
const WORKER = "https://stempelkarte-mcp.lippa-florian.workers.dev";
const OUT = process.argv[2] || require("os").tmpdir();
const DAY = 86400e3;
const now = Date.now();
const key = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const SERVER_DETS = [
  { service: "Spotify", key: "spotify", category: "abos", via: null, amount: 10.99, currency: "EUR", interval: "month", intervalFound: true, nextDate: key(now + 10 * DAY), kind: "renewal", mailId: "sp1", mailDate: key(now - 2 * DAY), mailTs: now - 2 * DAY, subject: "Dein Spotify-Beleg", confidence: 0.95, src: "server" },
  { service: "Disney+", key: "disney", category: "abos", via: null, amount: 9.99, currency: "EUR", interval: "month", intervalFound: true, nextDate: key(now + 14 * DAY), kind: "trial", mailId: "dp1", mailDate: key(now - DAY), mailTs: now - DAY, subject: "Willkommen bei Disney+", confidence: 0.9, src: "server" },
];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const W = { status: { configured: true, connected: false }, calls: [] };

  async function newPage(opts) {
    const ctx = await browser.newContext(opts);
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.route(WORKER + "/gmail/**", async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname;
      W.calls.push(req.method() + " " + p);
      const cors = { "access-control-allow-origin": new URL(BASE).origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (req.headers()["authorization"] !== "Bearer test-id-token") return route.fulfill({ status: 401, headers: cors, contentType: "application/json", body: JSON.stringify({ error: "Bitte anmelden." }) });
      const json = (b, status = 200) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(b) });
      if (p === "/gmail/status") return json(W.status);
      if (p === "/gmail/start") return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=abc" });
      if (p === "/gmail/scan") { W.status = { ...W.status, lastScan: Date.now(), lastResult: { mails: 7, found: 2, added: 0, pending: 0 } }; return json({ mails: 7, found: 2, added: 0, pending: 0, status: W.status }); }
      if (p === "/gmail/disconnect") { W.status = { configured: true, connected: false }; return json({ ok: true, connected: false, revoked: true }); }
      return json({ error: "Nicht gefunden." }, 404);
    });
    await ctx.addInitScript(() => { window.__skAiTest = { token: "test-id-token" }; });
    const page = await ctx.newPage();
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return { ctx, page };
  }

  async function open(page, { dets = false, subs = [] } = {}) {
    await page.goto(BASE);
    await page.click("#btn-local");
    await page.waitForTimeout(300);
    await page.evaluate(({ dets, subs, SERVER_DETS }) => {
      localStorage.setItem("stempelkarte.money.tab", "abos");
      localStorage.removeItem("stempelkarte.gmail.server");
      localStorage.setItem("sk-a-money_subs", JSON.stringify(subs));
      localStorage.setItem("sk-a-money_gmail", JSON.stringify(dets ? [{ id: "meta", handled: [], serverDets: SERVER_DETS, serverScan: Date.now() - 3600e3 }] : []));
    }, { dets, subs, SERVER_DETS });
    await page.goto(BASE + "#alltag/geld");
    await page.reload();
    await page.waitForSelector(".gm-card", { timeout: 8000 });
    await page.waitForTimeout(400); // Status vom (simulierten) Server
  }

  /* 1) Nicht verbunden: beide Modi, Einrichtung */
  {
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    await open(page);
    const txt = (await page.textContent(".gm-card")).replace(/\s+/g, " ");
    ok(txt.includes("Dauerhaft verbinden (Server)"), "Modus „Dauerhaft verbinden (Server)“");
    ok(await page.isVisible('[data-gm="sv-connect"] >> text=Gmail dauerhaft verbinden'), "Knopf „Gmail dauerhaft verbinden“");
    ok(await page.isVisible('[data-gm="scan"] >> text=Mit Gmail verbinden'), "Sitzungs-Modus bleibt als Ausweg");
    ok(/verschlüsselt auf deinem eigenen Server/.test(txt) && /myaccount\.google\.com\/permissions/.test(txt), "Datenschutz-Hinweis (verschlüsselt, widerrufbar)");
    ok(await page.isVisible(".gm-setup summary"), "Einrichtungs-Anleitung vorhanden");
    await page.click(".gm-setup summary");
    const setup = await page.textContent(".gm-setup");
    ok(setup.includes("Web client (auto created by Google Service)") && setup.includes("https://stempelkarte-mcp.lippa-florian.workers.dev/gmail/callback") && setup.includes("GOOGLE_OAUTH_CLIENT_ID") && setup.includes("GOOGLE_OAUTH_CLIENT_SECRET") && setup.includes("GMAIL_ENC_KEY"), "Anleitung: Client, Weiterleitungs-URI, Secrets");
    await page.screenshot({ path: path.join(OUT, "gmail-server-off-390-dark.png"), fullPage: true });

    // Verbinden → /gmail/start, neues Fenster mit Google-Adresse
    const popupP = page.waitForEvent("popup", { timeout: 5000 });
    await page.click('[data-gm="sv-connect"]');
    const popup = await popupP;
    await popup.waitForTimeout(500);
    ok(W.calls.includes("POST /gmail/start"), "POST /gmail/start aufgerufen");
    const popupUrl = popup.url();
    ok(/accounts\.google\.com|about:blank|chrome-error/.test(popupUrl), "Google-Anmeldung im neuen Fenster geöffnet (" + popupUrl.slice(0, 40) + ")");
    await popup.close();
    // Zurück in der App → Status neu holen: jetzt verbunden
    W.status = { configured: true, connected: true, email: "lippa.florian@gmail.com", connectedAt: now - 3 * DAY, lastScan: now - 2 * 3600e3, lastError: null, needsReconnect: false, lastResult: { mails: 12, found: 0, added: 0, pending: 0 } };
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
    await page.waitForSelector(".gm-server", { timeout: 5000 });
    ok(true, "Nach Rückkehr: verbundene Ansicht");
    await ctx.close();
  }

  /* 2) Verbunden mit Server-Erkennungen */
  {
    W.status = { configured: true, connected: true, email: "lippa.florian@gmail.com", connectedAt: now - 3 * DAY, lastScan: now - 2 * 3600e3, lastError: null, needsReconnect: false, lastResult: { mails: 12, found: 2, added: 2, pending: 2 } };
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    await open(page, { dets: true });
    await page.waitForSelector(".gm-server");
    const sub = await page.textContent(".gm-last");
    ok(/^Dauerhaft verbunden seit \d\d\.\d\d\.\d{4} · zuletzt geprüft (heute|gestern), \d\d:\d\d$/.test(sub.trim()), "Status „Dauerhaft verbunden seit … · zuletzt geprüft …“ (" + sub.trim() + ")");
    ok(await page.isVisible('[data-gm="sv-scan"] >> text=Jetzt prüfen'), "Knopf „Jetzt prüfen“");
    ok(await page.isVisible('[data-gm="sv-disconnect"] >> text=Trennen'), "Knopf „Trennen“");
    ok(!(await page.$('[data-gm="scan"]')), "Sitzungs-Knopf ausgeblendet, solange dauerhaft verbunden");
    const items = await page.$$eval(".gm-item", (els) => els.map((e) => e.className + " :: " + e.innerText.replace(/\s+/g, " ")));
    ok(items.some((t) => /gm-new/.test(t) && /Neues Abo erkannt: Spotify/.test(t)), "Server-Vorschlag „Neues Abo erkannt: Spotify“ ohne eigenes Prüfen");
    ok(items.some((t) => /gm-trial/.test(t) && /Testzeitraum Disney\+/.test(t)), "Testzeitraum aus Server-Scan");
    await page.screenshot({ path: path.join(OUT, "gmail-server-on-390-dark.png"), fullPage: true });

    await page.click('.gm-item[data-key="spotify"] [data-gm="ok"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("sk-a-money_subs") || "[]").some((s) => s.name === "Spotify"));
    await page.waitForTimeout(300);
    ok(!(await page.$('.gm-item[data-key="spotify"]')), "Übernommen → Vorschlag weg");
    const meta = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_gmail"))[0]);
    ok(meta.handled.some((h) => h.k === "spotify|sp1") && Array.isArray(meta.serverDets), "handled mit service|mailId, serverDets bleiben");

    await page.click('[data-gm="sv-scan"]');
    await page.waitForFunction(() => !document.querySelector('[data-gm="sv-scan"][disabled]'));
    ok(W.calls.includes("POST /gmail/scan"), "„Jetzt prüfen“ → POST /gmail/scan");
    await page.waitForTimeout(200);

    await page.click('[data-gm="sv-disconnect"]');
    ok((await page.textContent('[data-gm="sv-disconnect"]')).includes("Wirklich trennen?"), "Trennen fragt nach");
    await page.click('[data-gm="sv-disconnect"]');
    await page.waitForSelector('[data-gm="sv-connect"]');
    ok(W.calls.includes("POST /gmail/disconnect"), "POST /gmail/disconnect");
    ok(await page.isVisible('[data-gm="scan"]'), "Nach Trennen: Sitzungs-Modus wieder da");
    await ctx.close();
  }

  /* 3) Freigabe abgelaufen */
  {
    W.status = { configured: true, connected: true, email: "lippa.florian@gmail.com", connectedAt: now - 30 * DAY, lastScan: now - 2 * DAY, needsReconnect: true, lastError: { code: "invalid_grant", msg: "abgelaufen" } };
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    await open(page);
    await page.waitForSelector(".gm-server");
    ok(await page.isVisible('[data-gm="sv-connect"] >> text=Gmail neu verbinden'), "Abgelaufen → „Gmail neu verbinden“");
    ok(await page.isVisible(".gm-err"), "Hinweis auf abgelaufene Freigabe");
    await page.screenshot({ path: path.join(OUT, "gmail-server-expired-390-dark.png"), fullPage: true });
    await ctx.close();
  }

  /* 4) Heller Modus, PC-Breite (verbunden) */
  {
    W.status = { configured: true, connected: true, email: "lippa.florian@gmail.com", connectedAt: now - 3 * DAY, lastScan: now - 2 * 3600e3, needsReconnect: false, lastResult: { mails: 12 } };
    const { ctx, page } = await newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
    await open(page, { dets: true });
    await page.waitForSelector(".gm-server");
    await page.screenshot({ path: path.join(OUT, "gmail-server-on-1280.png"), fullPage: true });
    await ctx.close();
  }

  await browser.close();
  const real = errors.filter((e) => !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(e));
  console.log("Konsolenfehler:", errors.length ? errors : "keine");
  if (real.length) { console.error("FEHLER: Konsolenfehler", real); process.exit(1); }
  console.log("Alles ok.");
})().catch((e) => { console.error(e); process.exit(1); });
