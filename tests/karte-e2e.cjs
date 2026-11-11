// Playwright-Test für Alltag › 🗺️ Karte & Route (Update 10) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 8957 &   then   node tests/karte-e2e.cjs [screenshot-dir]
// Standort gemockt, Nominatim + routing.openstreetmap.de per page.route gestubbt, Kartenkacheln blockiert.
// Leaflet wird aus einer lokalen Kopie von leaflet@1.9.4 ausgeliefert (LEAFLET_DIR, sonst node_modules, sonst echtes Netz).
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:8957/";
const OUT = process.argv[2] || require("os").tmpdir();

function leafletDir() {
  const c = [process.env.LEAFLET_DIR, path.join(__dirname, "..", "node_modules", "leaflet", "dist")];
  try { c.push(path.dirname(require.resolve("leaflet/dist/leaflet.js"))); } catch { /* nicht installiert */ }
  return c.find((d) => d && fs.existsSync(path.join(d, "leaflet.js"))) || null;
}
const LDIR = leafletDir();

const ME = { latitude: 47.0707, longitude: 15.4395 };
const HAUPTPLATZ = { lat: 47.0712, lng: 15.4386 };
const SITE = { lat: 47.0601, lng: 15.4502 };
const DUR = { driving: 720, foot: 2460, bike: 905 };
const DIST = { driving: 4300, foot: 3100, bike: 3600 };

function osrm(profile, a, b) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return {
    code: "Ok",
    routes: [{ distance: DIST[profile], duration: DUR[profile], geometry: { type: "LineString", coordinates: [a, mid, b] },
      legs: [{ steps: [
        { distance: 300, duration: 40, name: "Lendplatz", maneuver: { type: "depart", bearing_after: 90, location: a } },
        { distance: 1200, duration: 200, name: "Hauptplatz", maneuver: { type: "turn", modifier: "left", location: mid } },
        { distance: 800, duration: 100, name: "Bahnhofgürtel", maneuver: { type: "roundabout", modifier: "right", exit: 2, location: [mid[0] + 0.001, mid[1]] } },
        { distance: 0, duration: 0, name: "", maneuver: { type: "arrive", modifier: "right", location: b } },
      ] }] }],
  };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const reqs = { osrm: [], nom: [], tiles: 0 };
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  async function newPage(scheme, width, height) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800, geolocation: ME, permissions: ["geolocation"], locale: "de-AT" });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      if (u.hostname === "unpkg.com" && u.pathname.startsWith("/leaflet@1.9.4/dist/")) {
        const f = LDIR && path.join(LDIR, u.pathname.replace("/leaflet@1.9.4/dist/", ""));
        if (f && fs.existsSync(f)) return route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*" }, contentType: f.endsWith(".css") ? "text/css" : f.endsWith(".png") ? "image/png" : "application/javascript", body: fs.readFileSync(f) });
        return route.continue();
      }
      if (/tile\.openstreetmap\.org$/.test(u.hostname)) { reqs.tiles++; return route.abort(); }
      if (/basemaps\.cartocdn\.com$/.test(u.hostname)) { reqs.carto = (reqs.carto || 0) + 1; return route.abort(); }
      if (u.hostname === "nominatim.openstreetmap.org") {
        const q = (u.searchParams.get("q") || "").toLowerCase();
        reqs.nom.push(q);
        let body = [];
        if (q.includes("hauptplatz")) body = [{ lat: String(HAUPTPLATZ.lat), lon: String(HAUPTPLATZ.lng), name: "Hauptplatz", display_name: "Hauptplatz, Innere Stadt, Graz, 8010, Österreich", address: { road: "Hauptplatz", postcode: "8010", city: "Graz" } }];
        else if (q.includes("annenstraße") || q.includes("annenstrasse")) body = [{ lat: "47.0716", lon: "15.4290", name: "", display_name: "Annenstraße 10, Graz", address: { road: "Annenstraße", house_number: "10", postcode: "8020", city: "Graz" } }];
        else if (q.includes("jakominiplatz")) body = [{ lat: "47.0667", lon: "15.4426", name: "Jakominiplatz", display_name: "Jakominiplatz, Graz", address: { postcode: "8010", city: "Graz" } }];
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
      }
      if (u.hostname === "routing.openstreetmap.de") {
        const m = /^\/routed-(car|foot|bike)\/route\/v1\/(driving|foot|bike)\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)$/.exec(u.pathname);
        reqs.osrm.push(u.pathname);
        if (!m || u.searchParams.get("steps") !== "true" || u.searchParams.get("geometries") !== "geojson" || u.searchParams.get("overview") !== "full") return route.fulfill({ status: 400, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ code: "InvalidUrl" }) });
        const a = [Number(m[3]), Number(m[4])], b = [Number(m[5]), Number(m[6])];
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(osrm(m[2], a, b)) });
      }
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (/Content Security Policy|Refused to/.test(t)) errors.push("CSP: " + t);
      else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return page;
  }
  const shot = async (p, name) => { await p.waitForTimeout(400); return p.screenshot({ path: path.join(OUT, name) }); };
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();

  async function seed(page) {
    await page.goto(BASE);
    await page.evaluate(({ SITE, today }) => {
      localStorage.clear();
      localStorage.setItem("stempelkarte.local.v1", JSON.stringify({
        places: [
          { id: "p1", name: "Baustelle Muster", addr: "Musterweg 1, 8010 Graz", lat: SITE.lat, lng: SITE.lng, radius: 150 },
          { id: "p2", name: "Firma Elektro Huber", addr: "Annenstraße 10, Graz", lat: 47.0716, lng: 15.4290, radius: 150 },
          { id: "p3", name: "Zuhause", lat: 47.08, lng: 15.42, radius: 100 },
        ],
        days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 }, entries: [],
        todos: [{ id: "t1", kind: "termin", title: "Kundentermin Jakomini", date: today, time: "23:30", location: "Jakominiplatz, Graz", done: false, createdAt: 1 }],
      }));
      localStorage.setItem("sk-a-kontakte", JSON.stringify([{ id: "k1", name: "Maria Gruber", type: "kunde", address: "Hauptplatz 1\n8010 Graz", phone: "", calls: [], jobs: [], placeIds: [] }]));
    }, { SITE, today });
    await page.reload();
    await page.click("#btn-local");
    await page.waitForTimeout(900);
  }

  /* ================= Handy 390 hell ================= */
  const page = await newPage("light", 390, 844);
  global.__page = page;
  await seed(page);
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="karte"]');
  ok(/Karte & Route/.test(await page.textContent('.al-tile[data-id="karte"]')), "Kachel 🗺️ Karte & Route in Alltag");
  await page.click('.al-tile[data-id="karte"]');
  await page.waitForSelector(".kr .kr-hello");
  await page.waitForSelector(".kr .leaflet-container", { timeout: 25000 });
  ok(/OpenStreetMap/.test(await page.textContent(".kr .leaflet-control-attribution")) && /Mitwirkende/.test(await page.textContent(".kr .leaflet-control-attribution")), "Attribution „© OpenStreetMap-Mitwirkende“ sichtbar");
  ok(await page.$eval(".kr .leaflet-control-attribution", (e) => { const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 0 && !!h && e.contains(h); }), "Attribution nicht verdeckt (über dem Sheet, unter dem Suchfeld)");
  await page.waitForSelector(".kr .leaflet-interactive", { timeout: 6000 }); // eigener Standort-Punkt
  const home = await page.textContent(".kr-sheet");
  ok(/Zuhause/.test(home) && /Firma/.test(home), "Schnellziele Zuhause + Firma");
  ok(/Baustelle Muster/.test(home), "Baustelle als Schnellziel");
  ok(/Maria Gruber/.test(home), "Kontakt mit Adresse als Schnellziel");
  ok(/Kundentermin Jakomini/.test(home), "heutiger Termin mit Adresse als Schnellziel");
  const box = await page.$eval(".kr", (e) => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, bottom: r.bottom }; });
  const tb = await page.$eval("#tabbar", (e) => e.getBoundingClientRect().top);
  ok(box.h > 500 && box.bottom <= tb + 1, `Karte füllt den Bildschirm bis zur Tableiste (${Math.round(box.h)} px)`);
  await shot(page, "karte-390-home.png");

  // Suche: kein Request beim Tippen, erst bei Enter
  await page.fill("#kr-q", "Hauptplatz Graz");
  await page.waitForTimeout(900);
  ok(reqs.nom.length === 0, "kein Nominatim-Aufruf beim Tippen (Nutzungsregeln)");
  ok(/Enter/.test(await page.textContent(".kr-sugg")), "Hinweis „Enter zum Suchen“");
  await page.press("#kr-q", "Enter");
  await page.waitForSelector(".kr-sugg .kr-pick:has(b:text-is(\"Hauptplatz\"))");
  ok(/Maria Gruber/.test(await page.textContent(".kr-sugg")), "lokaler Vorschlag (Kontakt) passt auch");
  ok(reqs.nom.length === 1, "genau 1 Nominatim-Aufruf");
  await shot(page, "karte-390-suche.png");
  await page.click(".kr-sugg .kr-pick:has(b:text-is(\"Hauptplatz\"))");
  await page.waitForFunction(() => ["car", "foot", "bike"].every((m) => /\d/.test((document.querySelector(`.kr-mode-t[data-t="${m}"]`) || {}).textContent || "")));
  const t = async (m) => (await page.textContent(`.kr-mode-t[data-t="${m}"]`)).trim();
  ok(await t("car") === "12 Min" && await t("foot") === "41 Min" && await t("bike") === "15 Min", `3 Dauern in den Reitern (${await t("car")} / ${await t("foot")} / ${await t("bike")})`);
  ok(reqs.osrm.length === 3, "3 Routen-Abfragen parallel");
  ok(reqs.osrm.every((p) => p.includes("15.4395,47.0707;15.4386,47.0712")), "Start = Standort, Ziel = Hauptplatz (lng,lat)");
  ok((await page.textContent('[data-r="destname"]')).includes("Hauptplatz"), "Ziel-Titel");
  ok((await page.textContent('[data-r="dur"]')).trim() === "12 Min" && (await page.textContent('[data-r="dist"]')).trim() === "4,3 km", "Auto: Dauer + Strecke");
  ok(/^🕐 Ankunft ca\. \d\d:\d\d$/.test((await page.textContent('[data-r="arr"]')).trim()), "Ankunftszeit");
  const nav = await page.getAttribute('[data-r="nav"]', "href");
  ok(nav === "https://www.google.com/maps/dir/?api=1&destination=47.0712,15.4386&travelmode=driving&dir_action=navigate", "Navigation starten → Google Maps (driving)");
  ok(await page.getAttribute('[data-r="nav"]', "target") === "_blank", "Navigation öffnet extern");
  ok(await page.$$eval(".kr .leaflet-overlay-pane path", (a) => a.length) >= 2, "Route als Linie auf der Karte");
  await page.click('[data-k="grip"]'); // Sheet hochziehen
  await page.waitForTimeout(350);
  await page.click('[data-r="steps"] summary');
  const steps = await page.$$eval(".kr-step .kr-step-t", (a) => a.map((x) => x.textContent));
  ok(steps[0] === "Losfahren Richtung Osten auf Lendplatz" && steps[1] === "Links abbiegen auf Hauptplatz" && steps[2] === "Im Kreisverkehr die 2. Ausfahrt nehmen auf Bahnhofgürtel" && /Ziel erreicht – es liegt rechts/.test(steps[3]), "Schritte auf Deutsch");
  await shot(page, "karte-390-route.png");

  // Modus wechseln – ohne neue Abfragen
  await page.click('.kr-mode[data-mode="foot"]');
  ok((await page.textContent('[data-r="dur"]')).trim() === "41 Min", "Zu Fuß: 41 Min");
  ok((await page.getAttribute('[data-r="nav"]', "href")).endsWith("travelmode=walking&dir_action=navigate"), "Navigation zu Fuß → walking");
  ok((await page.$$eval(".kr-step .kr-step-t", (a) => a[0].textContent)) === "Losgehen Richtung Osten auf Lendplatz", "Fuß: „Losgehen …“");
  await page.click('.kr-mode[data-mode="bike"]');
  ok((await page.getAttribute('[data-r="nav"]', "href")).endsWith("travelmode=bicycling&dir_action=navigate"), "Rad → bicycling");
  ok(reqs.osrm.length === 3, "Moduswechsel nutzt den Cache (keine neuen Abfragen)");
  await page.click('.kr-mode[data-mode="transit"]');
  await page.waitForSelector(".kr-oeffi");
  ok(/Öffi-Verbindungen/.test(await page.textContent(".kr-oeffi")), "Öffi-Karte");
  ok(await page.getAttribute('[data-r="gm-transit"]', "href") === "https://www.google.com/maps/dir/?api=1&origin=47.0707,15.4395&destination=47.0712,15.4386&travelmode=transit", "Öffis → Google Maps transit mit Start + Ziel");
  ok(await page.getAttribute('[data-r="scotty"]', "href") === "https://fahrplan.oebb.at/webapp/", "ÖBB Scotty-Link");
  await shot(page, "karte-390-oeffi.png");
  await page.click('.kr-mode[data-mode="car"]');
  await shot(page, "karte-390-sheet-gross.png");
  await page.click('[data-k="grip"]');
  ok((reqs.carto || 0) > 0, "OSM-Kacheln blockiert → Ersatz-Server CARTO wird verwendet");
  // „Zu meinem Standort“: Karte wegschieben, Knopf → zurück zum Standort mit Zoom ≥ 16
  const before = await page.evaluate(() => !!window.L);
  await page.click('[data-k="locate"]');
  await page.waitForTimeout(900);
  const c = await page.evaluate(() => { const map = document.querySelector(".kr .leaflet-container"), r = map.getBoundingClientRect(), sh = document.querySelector('[data-r="sheet"]').getBoundingClientRect();
    const dot = [...document.querySelectorAll(".kr .leaflet-interactive")].find((p) => p.getAttribute("fill") === "#1a73e8" && p.getAttribute("fill-opacity") === "1"); if (!dot) return null;
    const d = dot.getBoundingClientRect(), top = r.top + 104, bottom = sh.top; // sichtbarer Bereich zwischen Suchfeld und Sheet
    return { dx: Math.abs(d.x + d.width / 2 - (r.x + r.width / 2)), dy: Math.abs(d.y + d.height / 2 - (top + bottom) / 2), z: document.querySelector(".kr .leaflet-tile-container") ? 1 : 0 }; });
  ok(c && c.dx < 30 && c.dy < 30, "Standort-Knopf zentriert die Karte auf mich");
  ok(!!before, "Leaflet geladen");
  await shot(page, "karte-390-standort.png");
  // Einklappen per Wischen nach unten (Update 13)
  const gb = await page.$eval('[data-k="grip"]', (g) => { const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(gb.x, gb.y); await page.mouse.down(); await page.mouse.move(gb.x, gb.y + 120, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(350);
  ok(await page.getAttribute('[data-r="sheet"]', "data-collapsed") === "true", "Nach unten wischen klappt den Bereich ein");
  ok((await page.$eval('[data-r="sheet"]', (s) => s.getBoundingClientRect().height)) <= 95, "Eingeklappt nur noch schmal");
  await shot(page, "karte-390-eingeklappt.png");
  const gb2 = await page.$eval('[data-k="grip"]', (g) => { const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(gb2.x, gb2.y); await page.mouse.down(); await page.mouse.move(gb2.x, gb2.y - 150, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(350);
  ok(await page.getAttribute('[data-r="sheet"]', "data-collapsed") === "false", "Nach oben wischen öffnet wieder");

  // Mitlaufen
  await page.click('[data-k="follow"]');
  await page.waitForSelector('.kr-follow:not([hidden])');
  ok(/Links abbiegen auf Hauptplatz/.test(await page.textContent(".kr-follow")), "Mitlaufen zeigt den nächsten Schritt");
  await shot(page, "karte-390-mitlaufen.png");
  await page.click('[data-k="follow"]');
  ok(await page.isHidden(".kr-follow"), "Mitlaufen beendet");

  // Zuletzt
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-karte-recent") || "[]"));
  ok(rec.length === 1 && rec[0].name === "Hauptplatz", "Ziel in „Zuletzt“ (lokal)");
  await page.click('[data-k="clear"]');
  await page.waitForSelector(".kr-hello");
  ok(/Zuletzt/.test(await page.textContent(".kr-sheet")), "„Zuletzt“-Liste sichtbar");

  // Infoblatt
  await page.click('[data-k="info"]');
  await page.waitForSelector(".kr-info");
  ok(/FOSSGIS/.test(await page.textContent(".kr-info")) && /bleibt bei dir/.test(await page.textContent(".kr-info")), "Info: Datenschutz + FOSSGIS");
  await shot(page, "karte-390-info.png");
  await page.keyboard.press("Escape");

  // Start selbst wählen
  await page.click('.kr-pick >> text=Baustelle Muster');
  await page.waitForFunction(() => /\d/.test((document.querySelector('.kr-mode-t[data-t="car"]') || {}).textContent || ""));
  ok((await page.textContent('[data-r="destname"]')).includes("Baustelle Muster"), "Schnellziel Baustelle → Route");

  /* ---------- Integrationen ---------- */
  const n0 = reqs.osrm.length;
  await page.goto(BASE + "#orte/baustelle/p1");
  await page.waitForSelector('[data-st="route"]');
  await page.click('[data-st="route"]');
  await page.waitForFunction(() => location.hash === "#alltag/karte?place=p1");
  await page.waitForSelector('[data-r="destname"]');
  ok((await page.textContent('[data-r="destname"]')).includes("Baustelle Muster"), "Baustellen-Seite → 🗺️ Route öffnet Karte mit Ziel");
  await page.waitForFunction(() => /\d/.test((document.querySelector('.kr-mode-t[data-t="car"]') || {}).textContent || ""));
  ok(reqs.osrm.length === n0, "gleiche Route aus dem Cache");
  ok(reqs.osrm.slice(-1)[0].includes(`;${SITE.lng},${SITE.lat}`), "Ziel = Baustellen-Koordinaten");
  await shot(page, "karte-390-baustelle.png");

  await page.goto(BASE + "#orte");
  await page.waitForSelector('a.site-route[href="#alltag/karte?place=p2"]');
  await page.locator('a.site-route[href="#alltag/karte?place=p2"]').scrollIntoViewIfNeeded();
  ok(true, "Orte-Liste: 🗺️ Route-Link");
  await shot(page, "karte-390-orte.png");
  await page.click('a.site-route[href="#alltag/karte?place=p2"]');
  await page.waitForFunction(() => (document.querySelector('[data-r="destname"]') || {}).textContent?.includes("Firma Elektro Huber"));
  ok(true, "Orte-Liste → Karte mit Ziel");

  await page.goto(BASE + "#alltag/kontakte/k1");
  await page.waitForSelector("a[data-kt-route]");
  await page.click("a[data-kt-route]");
  await page.waitForFunction(() => (document.querySelector('[data-r="destname"]') || {}).textContent?.includes("Maria Gruber"));
  ok(reqs.nom.some((q) => q.includes("hauptplatz 1, 8010 graz")), "Kontakt-Adresse wird gesucht");
  ok(true, "Kontakt → 🗺️ Route");

  await page.goto(BASE + "#agenda");
  await page.waitForSelector(".ag-route");
  await page.click(".ag-route");
  await page.waitForFunction(() => (document.querySelector('[data-r="destname"]') || {}).textContent?.includes("Kundentermin Jakomini"));
  ok(true, "Termin mit Adresse → 🗺️ Route");

  /* ================= Desktop 1440 dunkel ================= */
  const dp = await newPage("dark", 1440, 900);
  await seed(dp);
  await dp.goto(BASE + "#alltag/karte?place=p1");
  await dp.waitForSelector('[data-r="destname"]');
  await dp.waitForFunction(() => /\d/.test((document.querySelector('.kr-mode-t[data-t="bike"]') || {}).textContent || ""));
  const lay = await dp.evaluate(() => {
    const s = document.querySelector(".kr-sheet").getBoundingClientRect(), m = document.querySelector(".kr-mapwrap").getBoundingClientRect();
    return { sw: s.width, mx: m.left, sx: s.left, bg: getComputedStyle(document.querySelector(".kr-sheet")).backgroundColor };
  });
  ok(lay.sw >= 380 && lay.sw <= 420 && lay.mx >= lay.sx + lay.sw - 2, "Desktop: Seitenleiste links + Karte rechts");
  ok(!/255, 255, 255/.test(lay.bg), "Dunkel: Seitenleiste dunkel");
  await dp.click('[data-r="steps"] summary');
  await shot(dp, "karte-1440-dunkel.png");
  await dp.click('.kr-mode[data-mode="transit"]');
  await shot(dp, "karte-1440-oeffi.png");
  await dp.goto(BASE + "#alltag/karte");
  await shot(dp, "karte-1440-home.png");

  /* ---------- Standort verweigert ---------- */
  const np = await (async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true });
    await ctx.route("**/*", (r) => { const u = new URL(r.request().url()); if (u.hostname === "localhost") return r.continue(); if (u.hostname === "unpkg.com" && LDIR) { const f = path.join(LDIR, u.pathname.replace("/leaflet@1.9.4/dist/", "")); if (fs.existsSync(f)) return r.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*" }, contentType: f.endsWith(".css") ? "text/css" : "application/javascript", body: fs.readFileSync(f) }); } return r.abort(); });
    const p = await ctx.newPage();
    p.on("console", (msg) => { const t = msg.text(); if (/Content Security Policy|Refused to/.test(t)) errors.push("CSP: " + t); else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return p;
  })();
  await seed(np);
  await np.goto(BASE + "#alltag/karte");
  await np.waitForSelector(".kr-loc");
  ok(/Darf ich deinen Standort verwenden/.test(await np.textContent(".kr-loc")), "freundliche Standort-Frage");
  await shot(np, "karte-390-dunkel-frage.png");

  ok(errors.length === 0, "keine Konsolenfehler / CSP-Verstöße" + (errors.length ? ":\n" + errors.join("\n") : ""));
  console.log(`(OSM-Kacheln blockiert: ${reqs.tiles}, CARTO-Ersatz: ${reqs.carto || 0}, Leaflet aus vendor/)`);
  await browser.close();
})().catch(async (e) => { console.error(e); try { await global.__page.screenshot({ path: path.join(OUT, "karte-fehler.png") }); } catch { /* egal */ } process.exit(1); });
