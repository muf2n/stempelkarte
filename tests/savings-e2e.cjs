// Playwright-Test für Sparziele (Update 9): echtes Konto, Spar-Erinnerung nach dem Lohn, Aufrunden.
//   cd <worktree> && python3 -m http.server 8871 &   then   node tests/savings-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen; /bank/status wird simuliert (zwei Konten mit Salden + Verlauf).
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8871/";
const WORKER = "https://stempelkarte-mcp.lippa-florian.workers.dev";
const OUT = process.argv[2] || require("os").tmpdir();
const DAY = 86400e3;

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const T = key(today);
const monday = (() => { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return key(d); })();
const firstOfMonth = `${T.slice(0, 8)}01`;
const hist = [];
for (let i = 92; i >= 0; i -= 2) { const d = new Date(today.getTime() - i * DAY); hist.push({ d: key(d), a: Math.round((600 - i * 3.3) * 100) / 100 }); }
const at = today.getTime() - 25 * 60e3;
const STATUS = {
  linked: true, aspsp: "BAWAG", valid_until: new Date(Date.now() + 150 * DAY).toISOString(), daysLeft: 150, expired: false,
  accounts: [
    { uid: "acc-g", iban_last4: "3201", name: "Konto Florian", currency: "EUR", main: true, hash: "hg" },
    { uid: "acc-s", iban_last4: "8901", name: "Online Sparen", currency: "EUR", main: false, hash: "hs" },
  ],
  mainUid: "acc-g",
  balances: { "acc-g": { amount: 1234.56, currency: "EUR", date: T, at }, "acc-s": { amount: 600, currency: "EUR", date: T, at } },
  balanceHistory: { "acc-s": hist },
  lastSync: at, balance: { amount: 1234.56, currency: "EUR", at }, lastError: null,
};
// Buchungen: Lohn am Monatsersten (bzw. heute, falls heute der 1. ist) + Ausgaben dieser Woche
const tx = [
  { id: "sal", date: firstOfMonth, amount: 873.4, type: "in", category: "einkommen", note: "Lehrlingsentschädigung" },
  { id: "o1", date: monday, amount: 12.4, type: "out", category: "essen", note: "Billa" }, // 0,60
  { id: "o2", date: monday, amount: 3.1, type: "out", category: "essengehen", note: "Döner" }, // 0,90
  { id: "o3", date: T, amount: 7.2, type: "out", category: "auto", note: "OMV" }, // 0,80
  { id: "o4", date: T, amount: 23, type: "out", category: "freizeit", note: "Kino" }, // 0
];
const goals = [
  { id: "moped", name: "Moped", emoji: "🏍️", target: 1500, saved: 650, created: 1, color: "#14b8a6", reminder: { on: true, amount: 50, mode: "payday", day: null } },
  { id: "auto", name: "Auto", emoji: "🚗", target: 3000, saved: 0, created: 2, color: "#0ea5e9" },
];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await ctx.route(WORKER + "/**", (route) => {
    const r = route.request();
    const u = new URL(r.url());
    const cors = { "access-control-allow-origin": "http://localhost:8871", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const send = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (u.pathname === "/bank/status") return send(200, STATUS);
    return send(404, { error: "Nicht gefunden." });
  });
  await ctx.addInitScript(() => { window.__bankTestToken = "test-token"; });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(BASE);
  await page.click("#btn-local");
  await page.waitForTimeout(300);
  await page.evaluate(({ tx, goals }) => {
    localStorage.setItem("sk-a-money_tx", JSON.stringify(tx));
    localStorage.setItem("sk-a-money_goals", JSON.stringify(goals));
    localStorage.setItem("stempelkarte.money.tab", "uebersicht");
    localStorage.removeItem("stempelkarte.bank.status");
  }, { tx, goals });
  await page.goto(BASE + "#alltag/geld");
  await page.reload();
  await page.waitForSelector(".bk-card.bk-on", { timeout: 8000 });

  // 1) Banner nach dem Lohn
  const banner = page.locator(".sv-banner");
  await banner.waitFor({ timeout: 5000 });
  const btxt = (await banner.innerText()).replace(/\u00a0/g, " ");
  ok(/Lohn ist da!/.test(btxt) && /Leg diesen Monat 50,00 € für 🏍️ Moped zur Seite \(noch 850,00 € bis zum Ziel\)/.test(btxt), "Banner nach Lohn-Buchung: " + btxt.split("\n")[1]);
  ok((await page.locator(".bk-accs li").count()) === 1 && /Online Sparen/.test(await page.locator(".bk-accs").innerText()), "Bankkarte zeigt zweites Konto");
  await page.screenshot({ path: path.join(OUT, "sv-1-uebersicht-dark.png"), fullPage: false });
  await page.click('.sv-banner [data-sv="remdone"]');
  await page.waitForTimeout(300);
  ok((await page.locator(".sv-banner").count()) === 0, "Erledigt → Banner weg");
  const g1 = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_goals")).find((g) => g.id === "moped"));
  ok(g1.saved === 700 && g1.remindAck === new Date().toISOString().slice(0, 7), "Erledigt bucht 50 € ein (Stand 700) und merkt den Monat");

  // 2) Sparziel „Auto“ mit echtem Konto verbinden
  await page.click('.mn-tab[data-tab="ziele"]');
  await page.waitForSelector(".mn-goals");
  await page.click('.mn-goal-head[data-id="auto"]');
  await page.waitForSelector("#sv-link");
  await page.check("#sv-link");
  await page.selectOption("#sv-acc", "acc-s");
  await page.screenshot({ path: path.join(OUT, "sv-2-blatt-dark.png") });
  await page.click(".sheet [data-save], [data-save]");
  await page.waitForTimeout(400);
  const card = page.locator('.mn-goal[data-goal="auto"]');
  const ctxt = (await card.innerText()).replace(/\u00a0/g, " ");
  ok(/600,00 €/.test(ctxt) && /🏦 echt · aktualisiert \d\d:\d\d/.test(ctxt), "Verbundenes Ziel zeigt echten Kontostand 600 € + „🏦 echt · aktualisiert HH:MM“");
  ok(/Online Sparen ••8901/.test(ctxt), "Konto-Name + ••8901");
  ok(/Monate? bis zum Ziel/.test(ctxt), "Prognose aus dem Verlauf: " + (ctxt.match(/📈.*Ziel/) || [""])[0]);
  ok((await card.locator('[data-mn="deposit"]').count()) === 0 && /BAWAG-App/.test(ctxt), "Einzahlen gesperrt, Hinweis auf BAWAG-App");

  // 3) Aufrunden einschalten, Betrag, buchen
  await page.click('[data-sv="ruon"]');
  await page.waitForSelector(".sv-ru-amt");
  const amt = await page.locator(".sv-ru-amt").getAttribute("data-sv-amt");
  ok(amt === "2.30", "Aufrunden diese Woche = 2,30 € (ist " + amt + ")");
  const rtxt = (await page.locator(".sv-ru").innerText()).replace(/\u00a0/g, " ");
  ok(/Diese Woche hättest du durch Aufrunden 2,30 € sparen können/.test(rtxt), "Text „Diese Woche hättest du …“");
  await page.click('.sv-ru [data-sv="rustep"][data-step="5"]');
  await page.waitForTimeout(200);
  { const a5 = await page.locator(".sv-ru-amt").getAttribute("data-sv-amt"); ok(a5 === "9.30", "auf 5 € → 9,30 € (ist " + a5 + ")"); }
  await page.click('.sv-ru [data-sv="rustep"][data-step="1"]');
  await page.waitForTimeout(200);
  await page.selectOption('[data-sv-sel="rugoal"]', "auto");
  await page.waitForTimeout(200);
  ok(/per Überweisung in der BAWAG-App/.test(await page.locator(".sv-ru").innerText()), "Verbundenes Ziel: Hinweis statt Buchen");
  await page.selectOption('[data-sv-sel="rugoal"]', "moped");
  await page.waitForTimeout(200);
  await page.locator(".sv-ru").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "sv-3-ziele-dark.png"), fullPage: true });
  await page.click('[data-sv="rubook"]');
  await page.waitForTimeout(400);
  const g2 = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_goals")).find((g) => g.id === "moped"));
  ok(g2.saved === 702.3, "Aufrunden gebucht → Moped 702,30 € (ist " + g2.saved + ")");
  ok(/schon gebucht/.test(await page.locator(".sv-ru").innerText()), "danach „schon gebucht“, nicht doppelt");
  await page.screenshot({ path: path.join(OUT, "sv-4-gebucht-dark.png"), fullPage: true });

  // Desktop-Ansicht kurz
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "sv-5-desktop-dark.png") });

  ok(errors.length === 0, "keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
