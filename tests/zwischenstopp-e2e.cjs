// Playwright-Test für 📍 Zwischenstopps (lokaler Modus).
//   cd <worktree> && python3 -m http.server 8879 &   then   node tests/zwischenstopp-e2e.cjs [screenshot-dir]
// Geolocation gemockt (setGeolocation + grantPermissions); router.project-osrm.org gestubbt:
// Distanz = Summe der Luftlinien-Teilstrecken über ALLE Koordinaten × 1,2.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8879/";
const OUT = process.argv[2] || require("os").tmpdir();

const A = { lat: 47.0745, lng: 15.4010 };   // Start
const X = { lat: 47.0900, lng: 15.3800 };   // Umweg 1
const Y = { lat: 47.1000, lng: 15.4300 };   // Umweg 2
const Z = { lat: 47.0600, lng: 15.4500 };   // Umweg 3
const B = { lat: 47.0240, lng: 15.4198 };   // Ziel
const hav = (a, b) => {
  const R = 6371008.8, rad = (d) => d * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const route = (pts) => { let m = 0; for (let i = 1; i < pts.length; i++) m += hav(pts[i - 1], pts[i]); return Math.round(m * 1.2 * 10) / 10; };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const osrm = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await ctx.grantPermissions(["geolocation"], { origin: BASE.replace(/\/$/, "") });
  const setPos = (p, acc = 8) => ctx.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy: acc });
  await setPos(A);
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return r.continue();
    if (u.hostname === "router.project-osrm.org") {
      const m = u.pathname.match(/driving\/(.+)$/);
      const pts = m[1].split(";").map((s) => { const [lng, lat] = s.split(",").map(Number); return { lat, lng }; });
      osrm.push(pts.length);
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ code: "Ok", routes: [{ distance: route(pts), duration: 900 }] }) });
    }
    return r.abort();
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => console.error("CSP: " + e.violatedDirective + " " + e.blockedURI));
  });
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name) => { await page.waitForTimeout(300); return page.screenshot({ path: path.join(OUT, name) }); };
  const data = () => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")));
  const curSeg = async () => { const d = await data(); return d.running ? d.running.segments[d.running.segments.length - 1] : null; };
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };
  const start = async () => {
    await page.reload();
    const b = await page.$("#btn-local");
    if (b && await b.isVisible()) await b.click();
    await page.waitForSelector('[data-r="clock"]', { state: "visible" });
    await page.waitForTimeout(400);
  };
  // „App öffnen“: via-Zeitstempel 3 min zurückdatieren (2-min-Regel), dann neu laden (App-Start)
  const reopenAt = async (p) => {
    await setPos(p);
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
      const s = d.running.segments[d.running.segments.length - 1];
      (s.via || []).forEach((v) => { v.at -= 180000; });
      localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d));
    });
    await start();
  };

  await page.goto(BASE + "#heute");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [], todos: [], days: {}, places: [], running: null, rev: Date.now(),
      settings: { weeklyTarget: 38.5, autoLocate: true, allowance: { kmFactor: 1.3, kmRate: 0.5 } },
    }));
  });
  await start();

  /* ---------- Einstempeln + Autofahren ---------- */
  await page.click('[data-r="btns"] [data-act="in"]');
  ok(await waitFor(async () => !!(await data()).running), "eingestempelt");
  await page.waitForTimeout(1700); // Tipp-Sperre
  await page.click('[data-r="btns"] [data-act="seg"]');
  await page.click('.sheet .seg-chips [data-a="Autofahren"]');
  ok(await waitFor(async () => { const s = await curSeg(); return s && s.activity === "Autofahren" && s.loc; }), "Abschnitt „Autofahren“ mit Startpunkt");
  ok(await page.waitForSelector('[data-r="viaadd"]', { state: "visible", timeout: 5000 }).then(() => true, () => false), "Knopf „📍 Hier merken“ im Uhr-Kärtchen");
  ok(!(await curSeg()).via, "noch kein Zwischenstopp (Start = gleicher Ort)");

  /* ---------- 3× App öffnen an verschiedenen Orten ---------- */
  await reopenAt(X);
  ok(await waitFor(async () => ((await curSeg()).via || []).length === 1), "App-Start bei Umweg 1 → 1 Zwischenstopp");
  ok(await page.isVisible("text=📍 Zwischenstopp gemerkt"), "Toast „📍 Zwischenstopp gemerkt“");
  await reopenAt(Y);
  ok(await waitFor(async () => ((await curSeg()).via || []).length === 2), "App-Start bei Umweg 2 → 2 Zwischenstopps");
  // visibilitychange (zurück in den Vordergrund) – gleicher Ort → nichts (zu nah)
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1200);
  ok(((await curSeg()).via || []).length === 2, "gleicher Ort nochmal → kein doppelter Zwischenstopp");
  // ungenau → nicht gemerkt
  await setPos(Z, 400);
  await page.click('[data-r="viaadd"]');
  await page.waitForTimeout(1200);
  ok(((await curSeg()).via || []).length === 2, "Genauigkeit ± 400 m → nicht gemerkt");
  await reopenAt(Z);
  ok(await waitFor(async () => ((await curSeg()).via || []).length === 3), "App-Start bei Umweg 3 → 3 Zwischenstopps");
  const v3 = (await curSeg()).via;
  ok(v3.every((v) => Number.isFinite(v.at) && v.acc <= 150 && typeof v.lat === "number"), "via = [{lat,lng,at,acc}]");
  ok(await waitFor(async () => (await page.textContent('[data-r="segnow"]')).includes("📍 3 Zwischenstopps")), "Uhr-Kärtchen: „📍 3 Zwischenstopps“");
  await shot("via-390-clock.png");

  /* ---------- Standort aus → nichts merken, Knopf weg ---------- */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
    d.settings.autoLocate = false;
    d.running.segments[d.running.segments.length - 1].via.forEach((v) => { v.at -= 180000; });
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d));
  });
  await setPos({ lat: 47.0400, lng: 15.3900 });
  await start();
  await page.waitForTimeout(1500);
  ok(((await curSeg()).via || []).length === 3 && !(await page.isVisible('[data-r="viaadd"]')), "Standort-Funktionen aus → kein Zwischenstopp, kein Knopf");
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
    d.settings.autoLocate = true;
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d));
  });

  /* ---------- Fahrt beenden + ausstempeln ---------- */
  await setPos(B);
  await page.evaluate(() => { // 2-min-Regel greift → am Ziel kein weiterer Stopp beim Öffnen
    const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
    const v = d.running.segments[d.running.segments.length - 1].via; v[v.length - 1].at = Date.now();
    // realistische Zeiten: Schicht seit 60 min, Fahrt seit 40 min
    d.running.start -= 3600000; d.running.segments[0].start -= 3600000; d.running.segments[1].start -= 2400000;
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d));
  });
  await start();
  await page.waitForTimeout(1700);
  await page.click('[data-r="btns"] [data-act="seg"]');
  await page.click('.sheet .seg-chips [data-a="Arbeiten"]');
  ok(await waitFor(async () => { const s = await curSeg(); return s && s.activity === "Arbeiten"; }), "Fahrt beendet (Arbeiten am Ziel)");
  await page.waitForTimeout(1700);
  await page.click('[data-r="btns"] [data-act="out"]');
  ok(await waitFor(async () => { const d = await data(); return !d.running && d.entries.length === 1; }), "ausgestempelt");
  const drive = () => data().then((d) => d.entries[0].segments.find((s) => s.activity === "Autofahren"));
  const dv = await drive();
  ok(dv.via.length === 3 && dv.endLoc && Math.abs(dv.endLoc.lat - B.lat) < 1e-4, "Zwischenstopps überleben das Ausstempeln");

  /* ---------- Fahrtenbuch: Straßen-km über alle Punkte ---------- */
  const pts = [dv.loc, ...dv.via, dv.endLoc];
  const exp5 = Math.round(route(pts) / 10) / 100;
  await page.screenshot({ path: path.join(OUT, "via-390-after-out.png") });
  while (await page.$(".sheet .close")) { await page.click(".sheet .close"); await page.waitForTimeout(250); }
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForSelector('#trips-panel [data-tg-open="log"]', { state: "visible" });
  await page.click('#trips-panel [data-tg-open="log"]');
  await page.waitForSelector("#fb-root .fb-row", { state: "visible" });
  ok(await waitFor(async () => (await drive()).kmRoad != null), "Straßen-km geladen");
  const d1 = await drive();
  ok(osrm[osrm.length - 1] === 5, "OSRM-Anfrage mit 5 Koordinaten (Start + 3 Stopps + Ziel)");
  ok(Math.abs(d1.kmRoad - exp5) < 0.011, `kmRoad = gestubbte Mehrpunkt-Route (${d1.kmRoad} ≈ ${exp5})`);
  ok(d1.kmRoadFor.split(";").length === 5, "kmRoadFor über alle Punkte");
  ok(d1.kmRoad > Math.round(route([dv.loc, dv.endLoc]) / 10) / 100 * 1.5, "Umweg zählt (deutlich mehr als direkt)");
  await page.click("#fb-root .fb-row");
  await page.waitForSelector(".sheet .fb-via .via-list li");
  ok((await page.$$(".sheet .fb-via .via-list li")).length === 3, "Fahrt-Detail listet 3 Zwischenstopps");
  ok(/\d\d:\d\d/.test(await page.textContent(".sheet .fb-via .via-list li")), "Stopp mit Uhrzeit + Ort");
  const kmTxt0 = await page.textContent('.sheet [data-r="kmv"]');
  const href0 = await page.getAttribute(".sheet .fb-maps", "href");
  ok(href0 && href0.includes("&waypoints="), "Google-Maps-Route mit Wegpunkten");
  await shot("via-390-detail.png");

  /* ---------- Stopp entfernen → neu berechnet ---------- */
  await page.click('.sheet .fb-via [data-viadel="1"]');
  const exp4 = Math.round(route([pts[0], pts[1], pts[3], pts[4]]) / 10) / 100;
  ok(await waitFor(async () => { const d = await drive(); return d.via.length === 2 && d.kmRoad != null && Math.abs(d.kmRoad - exp4) < 0.011; }), `Stopp entfernt → Straßen-km neu (${exp4})`);
  ok(osrm[osrm.length - 1] === 4, "neue OSRM-Anfrage mit 4 Koordinaten");
  ok(await waitFor(async () => (await page.textContent('.sheet [data-r="kmv"]')) !== kmTxt0), "angezeigte km aktualisiert");
  ok((await page.$$(".sheet .fb-via .via-list li")).length === 2, "Detail zeigt noch 2 Stopps");
  await shot("via-390-detail-removed.png");

  /* ---------- Eintrag-Blatt: Stopps mit ✕ ---------- */
  await page.click('.sheet [data-r="entry"]');
  await page.waitForSelector(".sheet .ek-via .via-list li");
  ok((await page.$$(".sheet .ek-via .via-list li")).length === 2, "Eintrag-Blatt listet 2 Zwischenstopps");
  await page.click('.sheet [data-segvia="1:0"]').catch(async () => { await page.click(".sheet [data-segvia]"); });
  ok((await page.$$(".sheet .ek-via .via-list li")).length === 1, "✕ im Eintrag-Blatt entfernt Stopp (Vorschau)");
  await shot("via-390-entry.png");
  await page.click(".sheet #ef-save");
  ok(await waitFor(async () => (await drive()).via.length === 1), "Speichern übernimmt das Entfernen");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "keine waagrechte Scrollleiste");

  ok(errors.length === 0, "keine Konsolen-Fehler / CSP-Verstöße" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("Zwischenstopp-E2E: alles grün ✅");
})().catch((e) => { console.error(e); process.exit(1); });
