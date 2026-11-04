// Playwright-Test für „Abos aus Gmail erkennen“ (Gmail wird komplett simuliert).
//   cd <worktree> && python3 -m http.server 8847 &   then   node tests/gmail-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen; gmail.googleapis.com liefert Fixture-JSON; Token über window.__gmailTestToken (nur localhost).
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8847/";
const OUT = process.argv[2] || require("os").tmpdir();

const DAY = 86400e3;
const now = Date.now();
const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");
const fmt = (ms) => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };

const MAILS = [
  { id: "sp1", from: "Spotify <no-reply@spotify.com>", subject: "Dein Spotify-Beleg", ago: 20, html: true,
    text: `<p>Danke für deine Zahlung!</p><table><tr><td>Premium Individual</td><td>10,99&nbsp;&euro;</td></tr></table><p>Dein Abo verlängert sich automatisch. Nächste Zahlung am ${fmt(now + 10 * DAY)}.</p>` },
  { id: "sp0", from: "Spotify <no-reply@spotify.com>", subject: "Dein Spotify-Beleg", ago: 50, text: "Premium Individual 9,99 € pro Monat. Abo verlängert." },
  { id: "dp1", from: "Disney+ <disneyplus@mail.disneyplus.com>", subject: "Willkommen bei Disney+", ago: 3,
    text: `Dein kostenloser Testzeitraum hat begonnen. Dein Testzeitraum endet am ${fmt(now + 14 * DAY)}. Danach 9,99 € monatlich.` },
  { id: "cr1", from: "Crunchyroll <hello@info.crunchyroll.com>", subject: "Your free trial is ending soon", ago: 1,
    text: `Your free trial ends on ${fmt(now + 6 * DAY)}. After that, you'll be charged €6.99/month.` },
  { id: "nf1", from: "Netflix <info@mailer.netflix.com>", subject: "Dein Abo wurde gekündigt", ago: 2,
    text: `Schade, dass du gehst. Dein Netflix-Abo wurde gekündigt. Du kannst Netflix noch bis ${fmt(now + 12 * DAY)} nutzen.` },
  { id: "fi1", from: "FitInn <info@fitinn.at>", subject: "Preisanpassung deiner Mitgliedschaft", ago: 4,
    text: `Ab ${fmt(now + 30 * DAY)} beträgt dein Beitrag 24,90 € statt 22,90 € pro Monat.` },
  { id: "am1", from: "Amazon.de <bestellbestaetigung@amazon.de>", subject: "Ihre Amazon.de Bestellung", ago: 5,
    text: "Vielen Dank für Ihre Bestellung. Bestellnummer 302-1234567. Gesamtbetrag: 12,99 €. Lieferung Donnerstag." },
];

function gmailMsg(m) {
  const part = { mimeType: m.html ? "text/html" : "text/plain", headers: [{ name: "Content-Type", value: (m.html ? "text/html" : "text/plain") + "; charset=UTF-8" }], body: { data: b64(m.text) } };
  return {
    id: m.id, threadId: m.id, internalDate: String(now - m.ago * DAY), snippet: "",
    payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }, { name: "Date", value: new Date(now - m.ago * DAY).toUTCString() }], parts: [part] },
  };
}

let gmailMode = "ok"; // "ok" | "403"
const gmailHits = [];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function newPage(opts) {
    const ctx = await browser.newContext(opts);
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      if (process.env.LOGABORT) console.log("abort", u.href.slice(0, 90));
      return route.abort();
    });
    await ctx.route("https://gmail.googleapis.com/**", async (route) => {
      const u = new URL(route.request().url());
      gmailHits.push(u.pathname);
      const auth = route.request().headers()["authorization"];
      if (auth !== "Bearer test-token") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
      if (gmailMode === "403") return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } }) });
      if (/\/messages$/.test(u.pathname)) {
        if (!u.searchParams.get("q").includes("newer_than:400d")) throw new Error("Query fehlt");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: MAILS.map((m) => ({ id: m.id, threadId: m.id })), resultSizeEstimate: MAILS.length }) });
      }
      const id = decodeURIComponent(u.pathname.split("/").pop());
      const m = MAILS.find((x) => x.id === id);
      if (!m) return route.fulfill({ status: 404, body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(gmailMsg(m)) });
    });
    await ctx.addInitScript(() => { window.__gmailTestToken = "test-token"; });
    const page = await ctx.newPage();
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return { ctx, page };
  }

  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };

  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await page.goto(BASE);
  await page.click("#btn-local");
  await page.waitForTimeout(400);
  // Vorhandene Abos (Netflix, FitInn) direkt anlegen
  await page.evaluate(() => {
    const t = Date.now();
    const d = new Date(t + 9 * 86400e3);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    localStorage.setItem("sk-a-money_subs", JSON.stringify([
      { id: "s_nf", name: "Netflix", amount: 13.99, interval: "month", next: k, day: d.getDate(), category: "abos", paused: false, created: t, updated: t },
      { id: "s_fi", name: "FitInn", amount: 22.9, interval: "month", next: k, day: d.getDate(), category: "freizeit", paused: false, created: t, updated: t },
    ]));
    localStorage.setItem("stempelkarte.money.tab", "abos");
  });
  await page.goto(BASE + "#alltag/geld");
  await page.reload();
  await page.waitForSelector(".gm-card", { timeout: 8000 });
  ok(await page.isVisible("text=Mails werden nur auf deinem Gerät gelesen und nicht gespeichert"), "Datenschutz-Hinweis sichtbar");
  ok((await page.textContent(".gm-scan")).includes("Mit Gmail verbinden"), "Knopf „Mit Gmail verbinden“");

  await page.click(".gm-scan");
  await page.waitForSelector(".gm-list .gm-item", { timeout: 8000 });
  const items = await page.$$eval(".gm-item", (els) => els.map((e) => e.className + " :: " + e.innerText.replace(/\s+/g, " ")));
  console.log(items.join("\n"));
  ok(items.some((t) => /gm-new/.test(t) && /Neues Abo erkannt: Spotify/.test(t) && /10,99 €\/Monat · nächste Zahlung/.test(t)), "Spotify als neues Abo (neueste Mail, 10,99 €)");
  ok(items.some((t) => /gm-trial/.test(t) && /Testzeitraum Disney\+ endet am/.test(t)), "Disney+-Testzeitraum");
  ok(items.some((t) => /gm-cancel/.test(t) && /Gekündigt erkannt: Netflix/.test(t)), "Netflix-Kündigung");
  ok(items.some((t) => /gm-price/.test(t) && /24,90 € statt 22,90 €/.test(t)), "FitInn-Preisänderung");
  ok(!items.some((t) => /Amazon/.test(t)), "Amazon-Bestellung nicht als Abo");
  ok(gmailHits.filter((p) => /messages\/.+/.test(p)).length === MAILS.length, "Nachrichten einzeln geladen");
  await page.screenshot({ path: path.join(OUT, "gmail-390-light.png"), fullPage: true });

  // Übernehmen → money_subs + Abos-Liste
  await page.click('.gm-item[data-key="spotify"] [data-gm="ok"]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sk-a-money_subs") || "[]").some((s) => s.name === "Spotify"));
  const sp = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_subs")).filter((s) => s.name === "Spotify"));
  ok(sp.length === 1 && sp[0].amount === 10.99 && sp[0].interval === "month" && sp[0].source === "gmail", "Übernehmen legt money_subs-Eintrag an");
  await page.waitForTimeout(300);
  ok(await page.isVisible('.mn-subs >> text=Spotify'), "Spotify in der Abos-Liste");
  ok(!(await page.$('.gm-item[data-key="spotify"]')), "Spotify-Vorschlag verschwindet");

  // Ignorieren
  await page.click('.gm-item[data-key="disney"] [data-gm="ignore"]');
  await page.waitForTimeout(300);
  ok(!(await page.$('.gm-item[data-key="disney"]')), "Disney+ ignoriert");

  // Abo beenden
  await page.click('.gm-item[data-key="netflix"] [data-gm="ok"]');
  await page.waitForTimeout(300);
  const nf = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_subs")).find((s) => s.id === "s_nf"));
  ok(nf.paused === true && !!nf.ended, "Netflix beendet (paused + ended)");
  ok(await page.isVisible('.mn-subs >> text=/beendet/'), "Liste zeigt „beendet“");

  // Preis aktualisieren
  await page.click('.gm-item[data-key="fitinn"] [data-gm="ok"]');
  await page.waitForTimeout(300);
  const fi = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_subs")).find((s) => s.id === "s_fi"));
  ok(fi.amount === 24.9 && fi.priceHistory && fi.priceHistory[0].amount === 22.9, "FitInn-Preis aktualisiert, alter Preis in priceHistory");

  // Testzeitraum-Erinnerung → Todo
  await page.click('.gm-item[data-key="crunchyroll"] [data-gm="ok"]');
  await page.waitForTimeout(600);
  const todo = await page.evaluate(() => (JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}").todos || []).find((t) => /Crunchyroll/.test(t.title)));
  const exp = new Date(now + 4 * DAY);
  const expKey = `${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, "0")}-${String(exp.getDate()).padStart(2, "0")}`;
  ok(todo && todo.kind === "todo" && todo.remind === true && todo.date === expKey, "Erinnerung 2 Tage vor Testende als Todo (" + (todo && todo.date) + ")");

  // Neu prüfen → keine Duplikate, nichts kommt wieder
  await page.click(".gm-scan");
  await page.waitForFunction(() => !document.querySelector(".gm-scan[disabled]"));
  await page.waitForTimeout(300);
  const again = await page.$$eval(".gm-item", (els) => els.length);
  const spCount = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_subs")).filter((s) => /spotify/i.test(s.name)).length);
  ok(again === 0 && spCount === 1, "Rescan: keine Vorschläge, kein doppeltes Spotify");
  ok(await page.isVisible(".gm-none"), "„Nichts Neues“-Meldung");

  // Nach Neuladen bleibt Ignorieren bestehen
  await page.reload();
  await page.waitForSelector(".gm-card");
  ok((await page.textContent(".gm-scan")).includes("Mails prüfen"), "Nach Neuladen: „Mails prüfen“ (verbunden)");
  ok((await page.textContent(".gm-last")).includes("Zuletzt geprüft"), "Letzter Scan angezeigt");
  await page.click(".gm-scan");
  await page.waitForFunction(() => !document.querySelector(".gm-scan[disabled]"));
  await page.waitForTimeout(300);
  ok(!(await page.$('.gm-item[data-key="disney"]')), "Ignoriert bleibt ignoriert nach Neuladen");
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_gmail"))[0]);
  ok(meta.connected === true && meta.lastScan > 0 && !JSON.stringify(meta).includes("Premium"), "Meta enthält nur Status, keine Mail-Inhalte");

  // 403 → Freigabe-Hinweis
  gmailMode = "403";
  await page.click(".gm-scan");
  await page.waitForSelector(".gm-err");
  ok((await page.textContent(".gm-err")).includes("Gmail-Zugriff noch nicht freigegeben – siehe Anleitung"), "403 → Hinweis „noch nicht freigegeben“");
  ok(await page.$eval(".gm-help", (d) => d.open), "Anleitung aufgeklappt");
  gmailMode = "ok";
  await page.screenshot({ path: path.join(OUT, "gmail-390-light-403.png"), fullPage: true });

  // Frische Ansicht mit Treffern für Screenshots (dunkel + PC)
  async function shots(opts, name) {
    const { ctx: c2, page: p2 } = await newPage(opts);
    await p2.goto(BASE);
    await p2.click("#btn-local");
    await p2.waitForTimeout(300);
    await p2.evaluate(() => localStorage.setItem("stempelkarte.money.tab", "abos"));
    await p2.goto(BASE + "#alltag/geld");
    await p2.reload();
    await p2.waitForSelector(".gm-card");
    await p2.click(".gm-scan");
    await p2.waitForSelector(".gm-list .gm-item");
    await p2.screenshot({ path: path.join(OUT, name), fullPage: true });
    await c2.close();
  }
  await shots({ viewport: { width: 390, height: 844 }, colorScheme: "dark" }, "gmail-390-dark.png");
  await shots({ viewport: { width: 1440, height: 900 }, colorScheme: "light" }, "gmail-1440.png");

  // Wöchentlicher Hinweis (verbunden, kein Token, letzter Scan > 7 Tage)
  {
    const { ctx: c3, page: p3 } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
    await p3.addInitScript(() => { delete window.__gmailTestToken; });
    await p3.goto(BASE);
    await p3.click("#btn-local");
    await p3.waitForTimeout(300);
    await p3.evaluate(() => {
      localStorage.setItem("sk-a-money_gmail", JSON.stringify([{ id: "meta", connected: true, lastScan: Date.now() - 9 * 86400e3, handled: [] }]));
      localStorage.setItem("stempelkarte.money.tab", "uebersicht");
      localStorage.removeItem("stempelkarte.gmail.hint");
    });
    await p3.goto(BASE + "#alltag/geld");
    await p3.reload();
    await p3.waitForSelector(".mn-hero");
    ok(await p3.isVisible(".gm-hint"), "Wochen-Hinweis „Mails prüfen“ sichtbar (ohne Popup)");
    await p3.screenshot({ path: path.join(OUT, "gmail-hint-390.png") });
    await p3.reload();
    await p3.waitForSelector(".mn-hero");
    ok(!(await p3.isVisible(".gm-hint")), "Hinweis höchstens 1× pro Woche");
    await c3.close();
  }

  await ctx.close();
  await browser.close();
  const real = errors.filter((e) => !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(e));
  console.log("Konsolenfehler:", errors.length ? errors : "keine");
  if (real.length) { console.error("FEHLER: Konsolenfehler", real); process.exit(1); }
  console.log("ALLES OK");
})().catch((e) => { console.error(e); process.exit(1); });
