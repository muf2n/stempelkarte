// Playwright-Test 📸 Erfassen (lokaler Modus, Port 8967).
//   cd <worktree> && python3 -m http.server 8967 &   then   node tests/privat-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Standort: navigator.geolocation wird per addInitScript ersetzt
// (window.__geoPush(lat, lng) schickt eine Probe an alle watchPosition-Beobachter), Zeit per page.clock.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8967/";
const OUT = process.argv[2] || require("os").tmpdir();

const BUERO = { lat: 47.0745, lng: 15.4010, addr: "Musterstraße 41, 8020 Musterstadt" };
const HOME = { lat: 47.1093, lng: 15.4118 };
const T = (m, d, h, mi = 0) => new Date(2026, m - 1, d, h, mi).getTime();

const GEO_INIT = () => {
  const G = window.__geo = { pos: null, cbs: new Map(), id: 0 };
  const mk = (p) => ({ coords: { latitude: p.lat, longitude: p.lng, accuracy: p.acc || 8, speed: null, altitude: null, heading: null, altitudeAccuracy: null }, timestamp: Date.now() });
  const fake = {
    getCurrentPosition(ok, err) { if (!G.pos) { if (err) setTimeout(() => err({ code: 2, message: "kein Standort" }), 5); return; } setTimeout(() => ok(mk(G.pos)), 5); },
    watchPosition(ok) { const id = ++G.id; G.cbs.set(id, ok); return id; },
    clearWatch(id) { G.cbs.delete(id); },
  };
  try { Object.defineProperty(Navigator.prototype, "geolocation", { configurable: true, get: () => fake }); } catch (e) { /* egal */ }
  window.__geoSet = (lat, lng) => { G.pos = { lat, lng, acc: 8 }; };
  window.__geoPush = (lat, lng) => { G.pos = { lat, lng, acc: 8 }; for (const cb of G.cbs.values()) cb(mk(G.pos)); return G.cbs.size; };
};

function seedData(extraSettings = {}) {
  const W = (d, h1, h2) => ({ id: "w" + d, kind: "work", start: T(11, d, h1), end: T(11, d, h2), pauseMin: 30, placeId: "p-buero", place: "Büro", note: "", people: [],
    inLoc: BUERO, outLoc: BUERO, segments: [{ start: T(11, d, h1), end: T(11, d, h2), activity: "Arbeiten", placeId: "p-buero", place: "Büro", loc: BUERO }] });
  return {
    entries: [W(2, 7, 16), W(3, 7, 15)], todos: [], days: {},
    places: [{ id: "p-buero", name: "Büro", addr: BUERO.addr, lat: BUERO.lat, lng: BUERO.lng, radius: 150 }],
    running: null, rev: 1,
    settings: { weeklyTarget: 38.5, workDays: [1, 2, 3, 4, 5], balanceStart: "2026-11-02", askNoteOnOut: false, ...extraSettings },
  };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };

  async function open({ time, colorScheme = "light", seed = seedData(), name = "", viewport = { width: 390, height: 844 } }) {
    const ctx = await browser.newContext({ viewport, colorScheme, timezoneId: "Europe/Vienna", locale: "de-AT", permissions: ["geolocation"] });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.addInitScript(GEO_INIT);
    // Testbrowser hat keinen BarcodeDetector → simulieren (Kamera gibt es nicht; „Code aus Foto“ liefert window.__code)
    await ctx.addInitScript(() => {
      window.BarcodeDetector = class { static async getSupportedFormats() { return ["qr_code", "ean_13"]; } async detect() { return window.__code ? [window.__code] : []; } };
    });
    await ctx.addInitScript((data) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.clear();
        localStorage.setItem("stempelkarte.local.v1", JSON.stringify(data));
        sessionStorage.setItem("seeded", "1");
      }
    }, seed);
    const page = await ctx.newPage();
    page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource|Firebase|firestore|gstatic/i.test(msg.text())) errors.push(name + ": " + msg.text()); });
    page.on("pageerror", (e) => errors.push(name + " pageerror: " + e.message));
    await page.clock.install({ time });
    await page.goto(BASE + "#heute");
    const b = await page.waitForSelector("#btn-local", { state: "visible", timeout: 8000 }).catch(() => null);
    if (b) await b.click();
    await page.waitForSelector('#view-heute [data-pm="privat"]', { state: "visible" });
    await page.clock.runFor(1500);
    return { ctx, page };
  }
  const data = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")));
  const flush = async (page) => { await page.clock.runFor(600); };
  const { ctx, page } = await open({ time: T(11, 12, 10), name: "erfassen" });
  const sheet = (q) => page.waitForSelector(`.sheet ${q}`);
  const save = async () => { await page.click(".sheet [data-save]"); await flush(page); };
  await page.evaluate(() => { location.hash = "#alltag/erfassen"; });
  const png = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 40; c.height = 40; c.getContext("2d").fillRect(5, 5, 30, 30); return c.toDataURL("image/png").split(",")[1]; }), "base64");
  await page.waitForSelector(".ef");
  // 1) Werkzeug-Sticker (App-Link) aus Foto
  await page.evaluate(() => { window.__code = { rawValue: location.href.replace(/[?#].*$/, "") + "#alltag/werkzeug/abc123", format: "qr_code" }; });
  await page.setInputFiles('[data-ef="codeimg"]', { name: "qr.png", mimeType: "image/png", buffer: png });
  await page.waitForSelector(".ef-res");
  ok((await page.textContent(".ef-res")).includes("Werkzeug"), "Werkzeug-QR erkannt");
  ok(await page.$('[data-r="open"]') != null, "Knopf „In der App öffnen“ (nichts passiert automatisch)");
  await page.click('[data-r="open"]'); await flush(page);
  ok(await page.evaluate(() => location.hash === "#alltag/werkzeug/abc123"), "Öffnet das Werkzeug");
  // 2) Fremder Link mit App-Hash wird NICHT als App-Link behandelt
  await page.evaluate(() => { location.hash = "#alltag/erfassen"; window.__code = { rawValue: "https://evil.example/#alltag/werkzeug/x", format: "qr_code" }; });
  await page.waitForSelector(".ef");
  if (await page.$('[data-x="again"]')) await page.click('[data-x="again"]');
  await page.setInputFiles('[data-ef="codeimg"]', { name: "qr.png", mimeType: "image/png", buffer: png });
  await page.waitForSelector(".ef-res");
  ok((await page.textContent(".ef-res")).includes("Fremder Link"), "Fremder Link mit Warnung, kein App-Sprung");
  // 3) EAN → Vorrat
  await page.click('[data-x="again"]');
  await page.evaluate(() => { window.__code = { rawValue: "4006381333931", format: "ean_13" }; });
  await page.setInputFiles('[data-ef="codeimg"]', { name: "ean.png", mimeType: "image/png", buffer: png });
  await page.waitForSelector(".ef-res");
  ok((await page.textContent(".ef-res")).includes("Produkt-Strichcode"), "EAN erkannt");
  await page.click('[data-r="vorrat"]'); await sheet("#xf-name");
  await page.fill("#xf-name", "Textmarker"); await page.fill("#xf-qty", "2"); await save();
  const v = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-vorrat") || "[]"));
  ok(v.some((x) => x.name === "Textmarker" && x.qty === 2 && x.ean === "4006381333931"), "Im Vorrat mit EAN");
  // nochmal scannen → Menge erhöht statt doppelt
  await page.click('[data-r="vorrat"]'); await sheet("#xf-name"); await page.fill("#xf-name", "Textmarker"); await save();
  const v2 = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-vorrat") || "[]"));
  ok(v2.filter((x) => x.ean === "4006381333931").length === 1 && v2.find((x) => x.ean === "4006381333931").qty === 3, "Zweiter Scan erhöht die Menge");
  // 4) Dokument → PDF
  await page.click('.xu-tab[data-tab="pdf"]');
  const big = await page.evaluate(async () => { const c = document.createElement("canvas"); c.width = 600; c.height = 800; const g = c.getContext("2d"); g.fillStyle = "#ddd"; g.fillRect(0, 0, 600, 800); g.fillStyle = "#222"; g.font = "40px sans-serif"; g.fillText("Rechnung", 60, 120); return c.toDataURL("image/jpeg").split(",")[1]; });
  const jpg = Buffer.from(big, "base64");
  await page.setInputFiles('[data-ef="pages"]', [{ name: "s1.jpg", mimeType: "image/jpeg", buffer: jpg }, { name: "s2.jpg", mimeType: "image/jpeg", buffer: jpg }]);
  await page.waitForSelector(".ef-pages li:nth-child(2)");
  ok((await page.$$(".ef-pages li")).length === 2, "2 Seiten");
  await page.click('[data-pg="rot"][data-i="1"]'); await page.waitForTimeout(150);
  await page.click('[data-pg="up"][data-i="1"]'); await page.waitForTimeout(150);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-x="download"]')]);
  const fs = require("fs"); const pth = await dl.path(); const pdf = fs.readFileSync(pth);
  ok(pdf.slice(0, 8).toString() === "%PDF-1.4" && /\/Count 2/.test(pdf.toString("latin1")) && /%%EOF\s*$/.test(pdf.toString("latin1")), `Gültiges PDF mit 2 Seiten (${Math.round(pdf.length / 1024)} kB)`);
  ok(/\/MediaBox \[0 0 841\.89 595\.28\]/.test(pdf.toString("latin1")), "Gedrehte Seite im Querformat");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Kein horizontales Scrollen");
  await page.screenshot({ path: path.join(OUT, "erfassen-390.png"), fullPage: true });
  // 5) → Dokumente (Tresor nicht eingerichtet → freundlicher Hinweis, nichts geht verloren)
  await page.click('[data-x="todocs"]');
  await page.waitForFunction(() => location.hash.startsWith("#alltag/dokumente"));
  ok(true, "Weiter zu den Dokumenten");
  // 6) Teilen-Eingang (wie vom Service Worker abgelegt)
  await page.evaluate(async () => {
    const c = await caches.open("sk-share-v1");
    await c.put(new Request("share/meta"), new Response(JSON.stringify({ title: "Einkauf", text: "- Milch\n- Brot\n- Eier", url: "", files: [] })));
    location.hash = "#alltag/erfassen?share=1";
  });
  await page.waitForSelector(".ef-shtext");
  ok((await page.textContent(".ef-shtext")).includes("Brot"), "Geteilter Text kommt an");
  await page.click('[data-s="shop"]'); await flush(page);
  const shop = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-einkauf") || "[]").map((x) => x.name));
  ok(["Milch", "Brot", "Eier"].every((n) => shop.includes(n)), "Zeilen auf der Einkaufsliste");
  await page.click('[data-s="clear"]'); await flush(page);
  ok(!(await page.evaluate(async () => !!(await (await caches.open("sk-share-v1")).match("share/meta")))), "Verwerfen löscht den Eingang");
  await ctx.close();
  await browser.close();
  if (errors.length) { console.log(errors.join("\n")); throw new Error("Konsolenfehler"); }
  console.log("Erfassen: alles grün ✔");
})().catch((e) => { console.error(e); process.exit(1); });
