// Playwright-Test für das Fahrtenbuch (lokaler Modus).
//   cd <worktree> && python3 -m http.server 8858 &   then   node tests/fahrtenbuch-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen; router.project-osrm.org wird mit page.route gestubbt (Distanz = Luftlinie × 1,2).
// Testdaten: echte Adressen aus dem Screenshot (Graz / Seiersberg-Pirka), November 2026.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:8858/";
const OUT = process.argv[2] || require("os").tmpdir();

const BUERO = { lat: 47.0745, lng: 15.4010, addr: "Puchstraße 41, 8020 Graz" };
const WIENER = { lat: 47.1093, lng: 15.4118, addr: "Wiener Straße 286, 8051 Graz" };
const KLEIN = { lat: 47.1046, lng: 15.4226, addr: "Anton-Kleinoscheg-Straße, 8051 Graz" };
const FELD = { lat: 47.0240, lng: 15.4198, addr: "Feldkirchner Straße 11, 8054 Seiersberg-Pirka" };
const WEINH = { lat: 47.0790, lng: 15.4560, addr: "Weinholdstraße 13, 8010 Graz" };
const NEU = { lat: 47.0590, lng: 15.4700, addr: "Liebenauer Hauptstraße 2, 8041 Graz" };

function seed(extra = []) {
  const T = (d, h, m) => new Date(2026, 10, d, h, m).getTime();
  const W = (start, loc, place = "", placeId = null) => ({ start, activity: "Arbeiten", placeId, place, loc });
  const D = (start, loc, endLoc, place = "", endPlace = "", placeId = null) => ({ start, activity: "Autofahren", placeId, place, loc, endLoc, endPlace: endPlace || endLoc.addr });
  const close = (segs, end) => segs.map((s, i) => ({ ...s, end: segs[i + 1] ? segs[i + 1].start : end }));
  const e1 = { id: "e-mo", kind: "work", start: T(2, 6, 50), end: T(2, 15, 30), pauseMin: 30, placeId: "p-buero", place: "Büro", note: "", people: [], inLoc: BUERO, outLoc: BUERO,
    segments: close([
      W(T(2, 6, 50), BUERO, "Büro", "p-buero"),
      D(T(2, 6, 59), BUERO, WIENER, "Büro", "", "p-buero"),
      W(T(2, 7, 18), WIENER),
      D(T(2, 12, 10), KLEIN, BUERO, "", "Büro"),
      W(T(2, 12, 28), BUERO, "Büro", "p-buero"),
      D(T(2, 12, 46), BUERO, FELD, "Büro", "", "p-buero"),
      W(T(2, 12, 55), FELD),
      D(T(2, 13, 10), FELD, BUERO, "", "Büro"),
      W(T(2, 13, 15), BUERO, "Büro", "p-buero"),
    ], T(2, 15, 30)) };
  const e2 = { id: "e-di", kind: "work", start: T(3, 6, 50), end: T(3, 15, 0), pauseMin: 30, placeId: "p-buero", place: "Büro", note: "", people: [], inLoc: BUERO, outLoc: BUERO,
    segments: close([
      W(T(3, 6, 50), BUERO, "Büro", "p-buero"),
      D(T(3, 6, 58), BUERO, WEINH, "Büro", "", "p-buero"),
      W(T(3, 7, 16), WEINH),
      D(T(3, 14, 30), WEINH, BUERO, "", "Büro"),
      W(T(3, 14, 45), BUERO, "Büro", "p-buero"),
    ], T(3, 15, 0)) };
  return { e1, e2, extra };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const osrm = []; // {t, url}
  const makeCtx = async (opts) => {
    const ctx = await browser.newContext({ acceptDownloads: true, hasTouch: false, ...opts });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      if (u.hostname === "router.project-osrm.org") {
        osrm.push({ t: Date.now(), url: u.href });
        const m = u.pathname.match(/driving\/([\d.-]+),([\d.-]+);([\d.-]+),([\d.-]+)/);
        const [lng1, lat1, lng2, lat2] = m.slice(1).map(Number);
        const R = 6371008.8, rad = (d) => d * Math.PI / 180;
        const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
        const dist = 2 * R * Math.asin(Math.sqrt(h)) * 1.2;
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ code: "Ok", routes: [{ distance: Math.round(dist * 10) / 10, duration: 600 }] }) });
      }
      return route.abort();
    });
    return ctx;
  };
  const wire = (page) => {
    page.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    page.on("requestfailed", (r) => { const u = new URL(r.url()); if (u.hostname === "localhost") errors.push("lokal fehlgeschlagen: " + r.url()); });
    page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost") errors.push(r.status() + " " + r.url()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  };
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };

  const ctx = await makeCtx({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const page = await ctx.newPage();
  wire(page);
  const shot = async (name, full = false) => { await page.waitForTimeout(400); return page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const data = () => page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")));
  const start = async () => {
    await page.reload();
    const b = await page.$("#btn-local");
    if (b && await b.isVisible()) await b.click();
    await page.waitForTimeout(500);
  };
  const openLog = async () => {
    await page.evaluate(() => { location.hash = "#uebersicht"; });
    await page.waitForSelector('#trips-panel [data-tg-open="log"]', { state: "visible" });
    await page.click('#trips-panel [data-tg-open="log"]');
    await page.waitForSelector("#fb-root .fb-list", { state: "visible" });
    await page.waitForTimeout(300);
  };
  const closeSheet = async () => { await page.click(".sheet .close"); await page.waitForTimeout(150); };

  await page.goto(BASE);
  const { e1, e2 } = seed();
  await page.evaluate(({ e1, e2, BUERO }) => {
    localStorage.clear();
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
      entries: [e1, e2], todos: [], days: {},
      places: [{ id: "p-buero", name: "Büro", addr: BUERO.addr, lat: BUERO.lat, lng: BUERO.lng, radius: 150 }],
      running: null, rev: Date.now(),
      settings: { weeklyTarget: 38.5, allowance: { kmFactor: 1.3, kmRate: 0.5 }, apprentice: { name: "Florian Huber", company: "Elektro Maier" } },
    }));
  }, { e1, e2, BUERO });
  await start();

  /* ---------- Übersicht-Karte ---------- */
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForSelector('#trips-panel [data-tg="km"]', { state: "visible" });
  const label = await page.textContent('#trips-panel [data-tg="label"]');
  ok(/November 2026/.test(label), "Übersicht-Karte zeigt November 2026");
  ok((await page.textContent('#trips-panel [data-tg="trips"]')).includes("6 Fahrten"), "Übersicht: 6 Fahrten");

  /* ---------- Fahrtenbuch: Gruppierung + kompakte Zeilen ---------- */
  const t0 = osrm.length;
  await openLog();
  const groups = await page.$$eval(".fb-day", (els) => els.map((e) => ({ h: e.querySelector(".fb-dh").textContent.replace(/\s+/g, " ").trim(), n: e.querySelectorAll(".fb-row").length })));
  ok(groups.length === 2 && groups[0].n === 4 && groups[1].n === 2, "2 Tagesgruppen (4 + 2 Fahrten)");
  ok(/^Mo, 02\.11\. 4 Fahrten · (≈ )?[\d,]+ km$/.test(groups[0].h), `Tageskopf „${groups[0].h}“`);
  const rows = await page.$$eval(".fb-row", (els) => els.map((r) => {
    const b = r.getBoundingClientRect();
    const to = r.querySelector(".fb-to"), cs = getComputedStyle(to);
    return { h: b.height, w: b.width, sw: r.scrollWidth, cw: r.clientWidth, l1: r.querySelector(".fb-l1").textContent, l2: r.querySelector(".fb-l2").textContent,
      ell: cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap", title: r.title, ret: r.classList.contains("is-ret") };
  }));
  ok(rows.every((r) => r.h <= 72), `Zeilen kompakt (max. Höhe ${Math.max(...rows.map((r) => r.h)).toFixed(0)} px)`);
  ok(rows.every((r) => r.sw <= r.cw + 1 && r.ell), "kein Umbruch/Überlauf, Ellipse statt Zeilenumbruch");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById("fb-root").scrollWidth <= innerWidth), "keine waagrechte Seiten-Scrollleiste");
  ok(rows[0].l1.includes("Büro") && rows[0].l1.includes("Wiener Straße 286") && !rows[0].l1.includes("8051"), `Kurzadresse „${rows[0].l1.trim()}“`);
  ok(rows[0].l2.startsWith("8051 Graz") && rows[0].l2.includes("Baustelle"), `Ort klein darunter + Zweck „${rows[0].l2}“`);
  ok(rows[2].l1.includes("Feldkirchner Straße 11") && rows[2].l2.includes("8054 Seiersberg-Pirka"), "Seiersberg-Pirka als Ort");
  ok(!rows[1].l2.includes("Büro"), "Zweck wiederholt nicht das Ziel (Büro)");
  ok(rows[3].ret && rows[5].ret && !rows[0].ret && !rows[2].ret, "Rückfahrten markiert (Feldkirchner → Büro, Weinhold → Büro)");
  ok(rows[0].title.includes("Wiener Straße 286, 8051 Graz"), "volle Adresse im title");
  await shot("fb-390-light-list.png");

  /* ---------- OSRM: sequentiell, ≤ 1/s, Cache ---------- */
  await page.waitForFunction(() => {
    const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
    return d.entries.flatMap((e) => e.segments).filter((s) => s.activity === "Autofahren" && s.kmRoad != null).length >= 3;
  }, null, { timeout: 15000 });
  await page.evaluate(() => { const r = document.getElementById("fb-root"); r.scrollTop = r.scrollHeight; });
  await page.waitForFunction(() => {
    const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
    return d.entries.flatMap((e) => e.segments).filter((s) => s.activity === "Autofahren" && s.kmRoad != null).length === 6;
  }, null, { timeout: 20000 });
  const reqs = osrm.slice(t0);
  ok(reqs.length === 6, `6 OSRM-Anfragen (eine pro Fahrt): ${reqs.length}`);
  const gaps = reqs.slice(1).map((r, i) => r.t - reqs[i].t);
  ok(gaps.every((g) => g >= 950), `≥ 1 s Abstand zwischen Anfragen (min ${Math.min(...gaps)} ms)`);
  ok(reqs[0].url.includes("/route/v1/driving/15.401,47.0745;15.4118,47.1093?overview=false"), "URL-Format lng,lat;lng,lat?overview=false");
  const d1 = await data();
  const s1 = d1.entries.find((e) => e.id === "e-mo").segments[1];
  ok(s1.kmRoad > 0 && s1.kmRoadAt > 0 && s1.kmRoadFor, `kmRoad am Abschnitt gespeichert (${s1.kmRoad} km)`);
  await page.waitForTimeout(400);
  ok(await page.$$eval(".fb-row .fb-src-road", (e) => e.length) === 6, "alle Zeilen mit Straßen-Symbol");
  ok(!(await page.textContent(".fb-big strong")).includes("≈"), "Monatssumme ohne ≈ (alle Straße)");

  await start();
  const before = osrm.length;
  await openLog();
  await page.evaluate(() => { const r = document.getElementById("fb-root"); r.scrollTop = r.scrollHeight; });
  await page.waitForTimeout(2500);
  ok(osrm.length === before, "nach Neuladen keine zweite Anfrage (Cache)");

  /* ---------- Fahrzeuge + Kilometerstand ---------- */
  await page.click('#fb-root [data-fb="veh"]');
  await page.fill('.sheet [data-r="vn"]', "VW Caddy");
  await page.fill('.sheet [data-r="vp"]', "g-123ab");
  await page.click('.sheet [data-r="vadd"]');
  await page.waitForTimeout(300);
  await page.fill('.sheet [data-r="vn"]', "Golf");
  await page.fill('.sheet [data-r="vp"]', "GU-55XY");
  await page.click('.sheet [data-vt="privat"]');
  await page.click('.sheet [data-r="vadd"]');
  await page.waitForTimeout(300);
  const vCaddy = (await data()).settings.vehicles.find((v) => v.name === "VW Caddy");
  await page.fill(`.sheet [data-odo="${vCaddy.id}"]`, "45210");
  await page.press(`.sheet [data-odo="${vCaddy.id}"]`, "Tab");
  await page.waitForTimeout(400);
  await shot("fb-390-vehicles.png");
  const st = (await data()).settings;
  ok(st.vehicles.length === 2 && st.vehicles[0].plate === "G-123AB" && st.vehicles[1].type === "privat", "2 Fahrzeuge gespeichert (Kennzeichen groß)");
  ok(st.trips.defaultVehicleId === vCaddy.id, "erstes Fahrzeug = Standard");
  ok(st.vehicles[0].odoStart["2026-11"] === 45210, "Kilometerstand 1. November gespeichert");
  await closeSheet();

  /* ---------- Detail: anzeigen + bearbeiten ---------- */
  await page.click(".fb-row >> nth=0");
  await page.waitForSelector(".sheet .fb-det");
  const det = await page.textContent(".sheet .fb-det");
  ok(det.includes("Wiener Straße 286, 8051 Graz") && det.includes("Puchstraße 41, 8020 Graz"), "Detail: volle Adressen");
  ok(/06:59 – 07:18 · 0:19 h/.test(det), "Detail: Zeiten + Dauer");
  ok(det.includes("Straße") && /Kilometerstand 45\.210 → 45\.2\d\d/.test(det), "Detail: km-Quelle + Kilometerstand");
  const href = await page.getAttribute(".sheet .fb-maps", "href");
  ok(href === "https://www.google.com/maps/dir/?api=1&origin=47.0745,15.401&destination=47.1093,15.4118&travelmode=driving", "Google-Maps-Routenlink");
  ok(await page.inputValue('.sheet [data-r="purpose"]') === "Baustelle", "Standard-Zweck „Baustelle“");
  await shot("fb-390-detail.png");
  await page.click('.sheet [data-pchip="Material holen"]');
  ok(await page.getAttribute('.sheet [data-pchip="Material holen"]', "aria-pressed") === "true", "Zweck-Chip gewählt");
  await page.click('.sheet [data-art="priv"]');
  await page.selectOption('.sheet [data-r="veh"]', { label: "Golf (GU-55XY) · Privatauto" });
  await page.fill('.sheet [data-r="km"]', "12,5");
  await page.click('.sheet [data-r="save"]');
  await page.waitForTimeout(500);
  const sx = (await data()).entries.find((e) => e.id === "e-mo").segments[1];
  ok(sx.purpose === "Material holen" && sx.private === true && sx.vehicleId === st.vehicles[1].id && sx.km === 12.5, "Zweck/privat/Fahrzeug/km am Abschnitt gespeichert");
  ok(sx.kmRoad > 0, "kmRoad bleibt erhalten");
  const r0 = await page.$eval(".fb-row >> nth=0", (r) => ({ cls: r.className, km: r.querySelector(".fb-km b").textContent, man: !!r.querySelector(".fb-src-man"), l2: r.querySelector(".fb-l2").textContent }));
  ok(r0.cls.includes("is-priv") && r0.km === "12,5" && r0.man && r0.l2.includes("Material holen") && r0.l2.includes("privat"), "Zeile zeigt privat, ✎ 12,5 km, neuen Zweck");
  ok(/privat\s*12,5 km/.test(await page.textContent(".fb-split-l")), "Monatskopf: privat 12,5 km");
  // Zweck-Chip „Privat“ setzt Art privat; zweite Fahrt (Kleinoscheg → Büro) bekommt Default „Büro“
  await page.click(".fb-row >> nth=1");
  ok(await page.inputValue('.sheet [data-r="purpose"]') === "Büro", "Standard-Zweck = gespeicherter Zielort (Büro)");
  await closeSheet();

  /* ---------- Fahrt nachtragen ---------- */
  // a) eigener Eintrag (kein Eintrag am 04.11.)
  await page.click('#fb-root .fb-addtop');
  await page.fill('.sheet [data-r="date"]', "2026-11-04");
  await page.fill('.sheet [data-r="t1"]', "16:05");
  await page.fill('.sheet [data-r="t2"]', "16:25");
  await page.selectOption('.sheet [data-r="from"]', "p-buero");
  await page.selectOption('.sheet [data-r="to"]', "__free");
  await page.fill('.sheet [data-r="to-free"]', "Hauptplatz 1, 8010 Graz");
  await page.fill('.sheet [data-r="km"]', "4,2");
  await page.click('.sheet [data-pchip="Kunde"]');
  await shot("fb-390-manual.png");
  await page.click('.sheet [data-r="save"]');
  await page.waitForTimeout(500);
  let d2 = await data();
  const own = d2.entries.find((e) => e.tripOnly);
  ok(own && own.segments.length === 1 && own.segments[0].activity === "Autofahren" && own.segments[0].km === 4.2 && own.segments[0].purpose === "Kunde" && own.pauseMin === 0,
    "nachgetragene Fahrt als eigener Eintrag (beruflich, zählt als Arbeitszeit)");
  // b) in die Arbeitszeit am 03.11. eingefügt
  await page.click('#fb-root .fb-addtop');
  await page.fill('.sheet [data-r="date"]', "2026-11-03");
  await page.fill('.sheet [data-r="t1"]', "10:00");
  await page.fill('.sheet [data-r="t2"]', "10:20");
  await page.selectOption('.sheet [data-r="from"]', "__free");
  await page.fill('.sheet [data-r="from-free"]', "Weinholdstraße 13, 8010 Graz");
  await page.selectOption('.sheet [data-r="to"]', "__free");
  await page.fill('.sheet [data-r="to-free"]', "Lagerhaus, Conrad-von-Hötzendorf-Straße 100, 8010 Graz");
  await page.click('.sheet [data-pchip="Material holen"]');
  await page.click('.sheet [data-r="save"]');
  await page.waitForTimeout(500);
  d2 = await data();
  const di = d2.entries.find((e) => e.id === "e-di");
  ok(di.segments.length === 7 && di.segments[3].activity === "Autofahren" && di.segments[3].manualTrip, "nachgetragene Fahrt in Eintrag 03.11. eingefügt (Abschnitt geteilt)");
  ok(di.end - di.start === e2.end - e2.start && di.pauseMin === 30, "Arbeitszeit des Eintrags unverändert");
  const g2 = await page.$$eval(".fb-day", (els) => els.map((e) => e.querySelectorAll(".fb-row").length));
  ok(JSON.stringify(g2) === "[4,3,1]", `Gruppen jetzt ${JSON.stringify(g2)}`);
  ok(await page.$$eval(".fb-row .fb-km.none", (e) => e.length) === 1, "Fahrt ohne Koordinaten/km: „?“");

  /* ---------- Suche ---------- */
  await page.fill('#fb-root [data-fb="q"]', "feldkirchner");
  await page.waitForTimeout(150);
  ok(await page.$$eval(".fb-row", (e) => e.length) === 2, "Suche „feldkirchner“ → 2 Fahrten");
  await page.fill('#fb-root [data-fb="q"]', "material");
  await page.waitForTimeout(150);
  ok(await page.$$eval(".fb-row", (e) => e.length) === 2, "Suche Zweck „material“ → 2 Fahrten");
  await page.fill('#fb-root [data-fb="q"]', "");
  await page.waitForTimeout(150);

  /* ---------- Monatswechsel ---------- */
  await page.click('#fb-root [data-fb="prev"]');
  ok((await page.textContent("#fb-root .fb-mo")) === "Oktober 2026" && await page.$(".fb-empty"), "Monat zurück: Oktober leer");
  await page.click('#fb-root [data-fb="next"]');
  ok((await page.textContent("#fb-root .fb-mo")) === "November 2026", "wieder November");
  await page.evaluate(() => { document.getElementById("fb-root").scrollTop = 0; });
  await shot("fb-390-light.png");
  await page.screenshot({ path: path.join(OUT, "fb-390-light-full.png"), fullPage: false });

  /* ---------- CSV ---------- */
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('#fb-root [data-fb="csv"]')]);
  const csvPath = path.join(OUT, "fahrtenbuch.csv");
  await dl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, "utf8");
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  ok(csv.charCodeAt(0) === 0xFEFF, "CSV mit BOM");
  ok(lines[0] === "Datum;Abfahrt;Ankunft;Ausgangsort;Zielort;Zweck;gefahrene km;Kilometerstand Beginn;Kilometerstand Ende;Fahrzeug;Kennzeichen;beruflich/privat;km-Quelle", "CSV-Kopf klassisch");
  ok(dl.suggestedFilename() === "Fahrtenbuch-2026-11.csv", "Dateiname Fahrtenbuch-2026-11.csv");
  const first = lines[1].split(";");
  ok(first[0] === "02.11.2026" && first[3] === "Büro (Puchstraße 41, 8020 Graz)" && first[4] === "Wiener Straße 286, 8051 Graz" && first[5] === "Material holen" && first[6] === "12,5" && first[10] === "GU-55XY" && first[11] === "privat",
    "CSV-Zeile 1 (Privatfahrt mit Golf)");
  const second = lines[2].split(";");
  ok(second[7] === "45210" && second[9] === "VW Caddy" && second[10] === "G-123AB" && second[11] === "beruflich", "CSV: Kilometerstand + Standard-Fahrzeug (Caddy beginnt bei 45210)");
  ok(lines.some((l) => l.startsWith("Summe;")) && lines.some((l) => l.startsWith("davon privat;")) && lines.some((l) => l.startsWith("Kilometergeld;")), "CSV-Summen inkl. Kilometergeld");

  /* ---------- Druckansicht ---------- */
  await page.click('#fb-root [data-fb="print"]');
  await page.waitForSelector("#fbp-root .fbp-table");
  const prn = await page.$$eval("#fbp-root .fbp-tbody tr", (r) => r.length);
  ok(prn === 8, `Druckansicht: 8 Zeilen (${prn})`);
  const ptxt = await page.textContent("#fbp-root .fbp-paper");
  ok(ptxt.includes("Florian Huber") && ptxt.includes("Unterschrift Fahrer/in") && ptxt.includes("Monatssumme") && ptxt.includes("Kilometergeld"), "Kopf, Unterschrift, Monatssumme, Kilometergeld");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Druckansicht am Handy ohne Seiten-Scroll (Tabelle scrollt im Rahmen)");
  await shot("fbp-390-light.png");
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.screenshot({ path: path.join(OUT, "fbp-print.png"), fullPage: true });
  ok(await page.evaluate(() => getComputedStyle(document.getElementById("fb-root")).display === "none" && getComputedStyle(document.querySelector("#fbp-root .rp-actions")).display === "none"), "Druck: nur der Zettel");
  await page.pdf({ path: path.join(OUT, "fahrtenbuch.pdf"), format: "A4" });
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#fbp-root [data-fbp="close"]');
  await page.waitForTimeout(200);
  ok(!(await page.$("#fbp-root")) && await page.$("#fb-root"), "Druckansicht geschlossen, Fahrtenbuch offen");

  /* ---------- Übersicht-Karte mit neuen Summen ---------- */
  const fbKm = (await page.textContent("#fb-root .fb-big strong")).replace("≈ ", "");
  await page.click('#fb-root [data-fb="close"]');
  await page.waitForTimeout(300);
  ok(!(await page.$("#fb-root")), "Fahrtenbuch geschlossen");
  const cardKm = await page.textContent('#trips-panel [data-tg="km"]');
  const n1 = Number(fbKm.replace(".", "").replace(",", ".")), n2 = Number(cardKm.replace(/[^\d,]/g, "").replace(",", "."));
  ok(Math.abs(n1 - n2) < 0.6, `Übersicht-Karte = Fahrtenbuch-Summe (${cardKm.trim()} / ${fbKm})`);
  ok(!(await page.isHidden('#trips-panel [data-tg="kmgrow"]')), "Übersicht: Kilometergeld-Zeile (Privatauto vorhanden)");
  ok((await page.textContent('#trips-panel [data-tg="kmg"]')).includes("€"), "Kilometergeld in €");
  await page.screenshot({ path: path.join(OUT, "ov-trips-card.png"), clip: await page.$eval("#trips-panel", (e) => { e.scrollIntoView(); const b = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, b.y - 8), width: 390, height: Math.min(844 - Math.max(0, b.y - 8), b.height + 16) }; }) });

  /* ---------- Schalter aus → keine Anfragen ---------- */
  await page.waitForSelector("#al-road", { state: "attached" });
  ok(await page.isChecked("#al-road"), "„Straßen-km berechnen“ standardmäßig an");
  ok((await page.textContent("#allowance-panel")).includes("router.project-osrm.org"), "Datenschutz-Hinweis OSRM");
  await page.$eval("#al-road", (e) => e.scrollIntoView({ block: "center" }));
  await page.click("label:has(#al-road)");
  await page.waitForTimeout(400);
  ok((await data()).settings.trips.roadKm === false, "Schalter aus gespeichert");
  await page.screenshot({ path: path.join(OUT, "settings-road.png") });
  // neue Fahrt mit Koordinaten (ohne kmRoad) einschleusen
  await page.evaluate(({ BUERO, NEU }) => {
    const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1"));
    const T = (h, m) => new Date(2026, 10, 5, h, m).getTime();
    d.entries.push({ id: "e-do", kind: "work", start: T(7, 0), end: T(9, 0), pauseMin: 0, placeId: "p-buero", place: "Büro", segments: [
      { start: T(7, 0), end: T(7, 10), activity: "Arbeiten", placeId: "p-buero", place: "Büro", loc: BUERO },
      { start: T(7, 10), end: T(7, 30), activity: "Autofahren", placeId: "p-buero", place: "Büro", loc: BUERO, endLoc: NEU, endPlace: NEU.addr },
      { start: T(7, 30), end: T(9, 0), activity: "Arbeiten", place: "", loc: NEU },
    ] });
    localStorage.setItem("stempelkarte.local.v1", JSON.stringify(d));
  }, { BUERO, NEU });
  await start();
  const b2 = osrm.length;
  await openLog();
  await page.waitForTimeout(2500);
  ok(osrm.length === b2, "Schalter aus → keine OSRM-Anfrage");
  ok((await page.textContent('[data-fb="status"]')).includes("Straßen-km aus"), "Hinweis „Straßen-km aus“");
  const last = await page.$eval(".fb-day:last-child .fb-row", (r) => r.querySelector(".fb-km b").textContent);
  ok(last.startsWith("≈"), `neue Fahrt als Luftlinie „${last}“`);
  // wieder einschalten → wird geholt
  await page.click('#fb-root [data-fb="close"]');
  await page.$eval("#al-road", (e) => e.scrollIntoView({ block: "center" }));
  await page.click("label:has(#al-road)");
  await page.waitForTimeout(300);
  await openLog();
  await page.evaluate(() => { const r = document.getElementById("fb-root"); r.scrollTop = r.scrollHeight; });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).entries.find((e) => e.id === "e-do").segments[1].kmRoad > 0, null, { timeout: 8000 });
  ok(osrm.length === b2 + 1, "wieder an → genau 1 Anfrage für die neue Fahrt");

  /* ---------- Screenshots ---------- */
  await page.evaluate(() => { document.getElementById("fb-root").scrollTop = 0; });
  await shot("fb-390-light-final.png");
  await page.click(".fb-row >> nth=2");
  await shot("fb-390-light-detail2.png");
  await closeSheet();

  const saved = await page.evaluate(() => localStorage.getItem("stempelkarte.local.v1"));
  for (const [name, opts] of [["fb-390-dark", { viewport: { width: 390, height: 844 }, colorScheme: "dark" }], ["fb-1440", { viewport: { width: 1440, height: 900 }, colorScheme: "light" }], ["fb-1440-dark", { viewport: { width: 1440, height: 900 }, colorScheme: "dark" }]]) {
    const c2 = await makeCtx(opts);
    const p2 = await c2.newPage();
    wire(p2);
    await p2.goto(BASE);
    await p2.evaluate((s) => { localStorage.setItem("stempelkarte.local.v1", s); }, saved);
    await p2.reload();
    await p2.click("#btn-local");
    await p2.waitForTimeout(3000); // Toasts abwarten
    await p2.evaluate(() => { location.hash = "#uebersicht"; });
    await p2.waitForSelector('#trips-panel [data-tg-open="log"]', { state: "visible" });
    await p2.click('#trips-panel [data-tg-open="log"]');
    await p2.waitForSelector("#fb-root .fb-row");
    await p2.waitForTimeout(500);
    ok(await p2.evaluate(() => document.getElementById("fb-root").scrollWidth <= innerWidth), `${name}: kein Überlauf`);
    await p2.screenshot({ path: path.join(OUT, `${name}.png`) });
    await p2.click(".fb-row >> nth=0");
    await p2.waitForTimeout(400);
    await p2.screenshot({ path: path.join(OUT, `${name}-detail.png`) });
    await p2.click(".sheet .close");
    await p2.click('#fb-root [data-fb="print"]');
    await p2.waitForTimeout(500);
    await p2.screenshot({ path: path.join(OUT, `${name}-print.png`) });
    await c2.close();
  }

  ok(errors.length === 0, "keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("ALLE TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
